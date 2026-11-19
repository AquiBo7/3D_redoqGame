// core/saveStore.ts —— 分层 localStorage 存档
// 单局章节存档与全局多周目元数据使用两个独立 key，均带版本号。
// 本模块属于 core，严格禁止 import three.js。

import { isRole, isSceneId } from '../data/storySchema';
import type { LogType, Role, SceneId } from '../data/storySchema';
import {
  createInitialMetaProgress,
  createInitialStoryState,
} from './state';
import type { MetaProgress, StoryState } from './state';

export const CHAPTER_SAVE_KEY = 'yitiaojietu.ch1.save.v1';
export const META_SAVE_KEY = 'yitiaojietu.meta.v1';
export const CHAPTER_SAVE_VERSION = 1 as const;
export const META_SAVE_VERSION = 1 as const;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ChapterSave {
  version: 1;
  chapterId: 'ch1';
  savedAt: number;
  sceneId: SceneId;
  role: Role;
  state: StoryState;
  /** 已在结尾占位页结束；继续游戏时直接重展示结尾 */
  completed: boolean;
}

interface MetaSaveV1 {
  version: 1;
  unlockedRoles: Role[];
  unlockedEndings: string[];
}

function getDefaultStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  return storage === undefined ? getDefaultStorage() : storage;
}

function readJson(key: string, storage: StorageLike | null): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown, storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const LOG_TYPES: readonly LogType[] = ['choice', 'observe', 'ignore', 'system'];

function isLogType(value: unknown): value is LogType {
  return typeof value === 'string' && (LOG_TYPES as readonly string[]).includes(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStoryState(value: unknown): value is StoryState {
  if (!isRecord(value)) return false;
  if (value.momReply !== null && typeof value.momReply !== 'string') return false;
  if (value.reasonText !== null && typeof value.reasonText !== 'string') return false;
  if (!isFiniteNumber(value.phoneIgnored)) return false;
  if (!isFiniteNumber(value.trust)) return false;
  if (!isFiniteNumber(value.harm)) return false;

  const booleanKeys = [
    'seenBag',
    'seenHandoff',
    'noticedTyper',
    'handedPen',
    'seenCrossedOut',
    'picked',
    'seenFatherWatching',
  ] as const;
  for (const key of booleanKeys) {
    if (typeof value[key] !== 'boolean') return false;
  }

  if (!Array.isArray(value.log)) return false;
  return value.log.every((entry) => {
    if (!isRecord(entry)) return false;
    return (
      isFiniteNumber(entry.timestamp) &&
      isSceneId(entry.sceneId) &&
      isLogType(entry.type) &&
      typeof entry.summary === 'string'
    );
  });
}

function isChapterSave(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.version === CHAPTER_SAVE_VERSION &&
    value.chapterId === 'ch1' &&
    isFiniteNumber(value.savedAt) &&
    isSceneId(value.sceneId) &&
    isRole(value.role) &&
    isStoryState(value.state) &&
    (value.completed === undefined || typeof value.completed === 'boolean')
  );
}

export function loadChapterSave(storage?: StorageLike | null): ChapterSave | null {
  const raw = readJson(CHAPTER_SAVE_KEY, resolveStorage(storage));
  if (!isChapterSave(raw) || !isRecord(raw)) return null;
  return {
    version: CHAPTER_SAVE_VERSION,
    chapterId: 'ch1',
    savedAt: raw.savedAt as number,
    sceneId: raw.sceneId as SceneId,
    role: raw.role as Role,
    state: raw.state as StoryState,
    completed: raw.completed === true,
  };
}

export function hasChapterSave(storage?: StorageLike | null): boolean {
  return loadChapterSave(storage) !== null;
}

export function saveChapterSave(save: ChapterSave, storage?: StorageLike | null): boolean {
  return writeJson(CHAPTER_SAVE_KEY, save, resolveStorage(storage));
}

export function clearChapterSave(storage?: StorageLike | null): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.removeItem(CHAPTER_SAVE_KEY);
  } catch {
    // localStorage 不可用时静默忽略，游戏仍可继续运行
  }
}

function normalizeMeta(meta: MetaProgress): MetaProgress {
  const roles = Array.from(new Set<Role>(['bystander', ...meta.unlockedRoles]));
  const endings = Array.from(new Set(meta.unlockedEndings.filter((id) => id.length > 0)));
  return { unlockedRoles: roles, unlockedEndings: endings };
}

function isMetaSave(value: unknown): value is MetaSaveV1 {
  if (!isRecord(value)) return false;
  if (value.version !== META_SAVE_VERSION) return false;
  if (!Array.isArray(value.unlockedRoles) || !value.unlockedRoles.every(isRole)) return false;
  if (!Array.isArray(value.unlockedEndings)) return false;
  return value.unlockedEndings.every((id) => typeof id === 'string');
}

export function loadMetaProgress(storage?: StorageLike | null): MetaProgress {
  const raw = readJson(META_SAVE_KEY, resolveStorage(storage));
  if (!isMetaSave(raw)) return createInitialMetaProgress();
  return normalizeMeta({
    unlockedRoles: raw.unlockedRoles,
    unlockedEndings: raw.unlockedEndings,
  });
}

export function saveMetaProgress(meta: MetaProgress, storage?: StorageLike | null): boolean {
  const normalized = normalizeMeta(meta);
  const payload: MetaSaveV1 = {
    version: META_SAVE_VERSION,
    unlockedRoles: normalized.unlockedRoles,
    unlockedEndings: normalized.unlockedEndings,
  };
  return writeJson(META_SAVE_KEY, payload, resolveStorage(storage));
}

export function unlockRole(role: Role, storage?: StorageLike | null): MetaProgress {
  const meta = loadMetaProgress(storage);
  if (meta.unlockedRoles.includes(role)) return meta;
  const next: MetaProgress = {
    ...meta,
    unlockedRoles: [...meta.unlockedRoles, role],
  };
  saveMetaProgress(next, storage);
  return normalizeMeta(next);
}

export function unlockEnding(endingId: string, storage?: StorageLike | null): MetaProgress {
  const meta = loadMetaProgress(storage);
  if (meta.unlockedEndings.includes(endingId)) return meta;
  const next: MetaProgress = {
    ...meta,
    unlockedEndings: [...meta.unlockedEndings, endingId],
  };
  saveMetaProgress(next, storage);
  return normalizeMeta(next);
}

export function resetMetaProgress(storage?: StorageLike | null): MetaProgress {
  const meta = createInitialMetaProgress();
  saveMetaProgress(meta, storage);
  return meta;
}

/** 测试 / 调试辅助：生成一份合法的初始存档状态 */
export function createEmptyChapterSave(overrides?: Partial<ChapterSave>): ChapterSave {
  return {
    version: CHAPTER_SAVE_VERSION,
    chapterId: 'ch1',
    savedAt: 0,
    sceneId: 'S1',
    role: 'bystander',
    state: createInitialStoryState(),
    completed: false,
    ...overrides,
  };
}
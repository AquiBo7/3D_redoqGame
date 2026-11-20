// core/saveStore.ts —— 分层 localStorage 存档
// 单局存档、全局元数据和三个章节检查点使用独立 key，兼容 v1 旧存档。
// 本模块属于 core，严格禁止 import three.js。

import { isRole, isSceneId } from '../data/storySchema';
import type { LogType, Role, SceneId } from '../data/storySchema';
import {
  createInitialMetaProgress,
  createInitialStoryState,
} from './state';
import type { LogEntry, MetaProgress, StoryState } from './state';

export const CHAPTER_SAVE_KEY = 'yitiaojietu.ch1.save.v1';
export const META_SAVE_KEY = 'yitiaojietu.meta.v1';
export const CHAPTER_SAVE_VERSION = 1 as const;
export const META_SAVE_VERSION = 1 as const;
export const CHECKPOINT_SAVE_KEYS = {
  ch2_canteen: 'yitiaojietu.checkpoint.ch2_canteen.v1',
  ch3_morning: 'yitiaojietu.checkpoint.ch3_morning.v1',
  ch4_platform: 'yitiaojietu.checkpoint.ch4_platform.v1',
} as const;
export type CheckpointKey = keyof typeof CHECKPOINT_SAVE_KEYS;

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

interface MetaSaveV1 extends MetaProgress {
  version: 1;
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

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function nullableChoice<T extends string>(...choices: T[]): (value: unknown) => value is T | null {
  return (value): value is T | null => value === null || choices.some((choice) => choice === value);
}

function isLogArray(value: unknown): value is LogEntry[] {
  return Array.isArray(value) && value.every((entry: unknown) => {
    if (!isRecord(entry)) return false;
    return (
      isFiniteNumber(entry.timestamp) &&
      isSceneId(entry.sceneId) &&
      isLogType(entry.type) &&
      typeof entry.summary === 'string'
    );
  });
}

// 映射类型强制每个状态字段都有对应验证器，避免扩容后漏验新字段。
const STATE_VALIDATORS: { [K in keyof StoryState]: (value: unknown) => value is StoryState[K] } = {
  momReply: isNullableString,
  phoneIgnored: isFiniteNumber,
  seenBag: isBoolean,
  seenHandoff: isBoolean,
  noticedTyper: isBoolean,
  handedPen: isBoolean,
  reasonText: isNullableString,
  seenCrossedOut: isBoolean,
  picked: isBoolean,
  seenFatherWatching: isBoolean,
  noticedPhoneBehind: isBoolean,
  noticedPhoto: isBoolean,
  likedPhoto: isBoolean,
  roommateReply: isNullableString,
  pointedOut: isBoolean,
  canteenSeen: isFiniteNumber,
  postChoice: nullableChoice('explain', 'wait', 'joke'),
  addedHer: isBoolean,
  listened: isBoolean,
  evidence: isBoolean,
  seat: nullableChoice('beside', 'front', 'far'),
  teacherTalked: isBoolean,
  tellTeacher: nullableChoice('told', 'ask_her', 'think'),
  visitedStairwell: isBoolean,
  askedAboutFather: isBoolean,
  fatherKnows: isBoolean,
  clues: isStringArray,
  wrongAsks: isFiniteNumber,
  foundAyuanWay: nullableChoice('recognize', 'relay', 'shout'),
  yuanState: nullableChoice('unprepared', 'guarded', 'hostile'),
  yuanScore: isFiniteNumber,
  yuanKeys: isStringArray,
  route: nullableChoice('team', 'deleteOnly', 'breakdown'),
  postDeleted: isBoolean,
  joined: isBoolean,
  phrase: isNullableString,
  stage1Tries: isFiniteNumber,
  crystalHits: isFiniteNumber,
  kills: isFiniteNumber,
  helpedByAyuan: isBoolean,
  apologized: isBoolean,
  soloRepair: isBoolean,
  trust: isFiniteNumber,
  harm: isFiniteNumber,
  ending: nullableChoice('joined', 'bystander', 'worst', 'best', 'middle'),
  log: isLogArray,
};

const LEGACY_STATE_KEYS = [
  'momReply', 'phoneIgnored', 'seenBag', 'seenHandoff', 'noticedTyper', 'handedPen',
  'reasonText', 'seenCrossedOut', 'picked', 'seenFatherWatching', 'trust', 'harm', 'log',
] as const;

function isStoryState(value: unknown): value is StoryState {
  if (!isRecord(value)) return false;
  return (Object.keys(STATE_VALIDATORS) as (keyof StoryState)[])
    .every((key) => STATE_VALIDATORS[key](value[key]));
}

function migrateStoryState(value: unknown): StoryState | null {
  if (!isRecord(value)) return null;
  // 旧字段缺失依然是损坏存档；仅为后续版本新增字段填默认值。
  if (!LEGACY_STATE_KEYS.every((key) => Object.prototype.hasOwnProperty.call(value, key))) return null;
  // 存在的非法值不能被默认值吞掉（包括 null、错误枚举和非有限数）。
  const migrated: unknown = { ...createInitialStoryState(), ...value };
  return isStoryState(migrated) ? migrated : null;
}

function parseChapterSave(raw: unknown): ChapterSave | null {
  if (!isRecord(raw) ||
    raw.version !== CHAPTER_SAVE_VERSION ||
    raw.chapterId !== 'ch1' ||
    !isFiniteNumber(raw.savedAt) ||
    !isSceneId(raw.sceneId) ||
    !isRole(raw.role) ||
    (raw.completed !== undefined && typeof raw.completed !== 'boolean')) return null;

  const state = migrateStoryState(raw.state);
  if (!state) return null;
  return {
    version: CHAPTER_SAVE_VERSION,
    chapterId: 'ch1',
    savedAt: raw.savedAt,
    sceneId: raw.sceneId,
    role: raw.role,
    state,
    completed: raw.completed === true,
  };
}

export function loadChapterSave(storage?: StorageLike | null): ChapterSave | null {
  return parseChapterSave(readJson(CHAPTER_SAVE_KEY, resolveStorage(storage)));
}

export function saveCheckpoint(
  key: CheckpointKey,
  save: ChapterSave,
  storage?: StorageLike | null,
): boolean {
  return writeJson(CHECKPOINT_SAVE_KEYS[key], save, resolveStorage(storage));
}

export function loadCheckpoint(key: CheckpointKey, storage?: StorageLike | null): ChapterSave | null {
  return parseChapterSave(readJson(CHECKPOINT_SAVE_KEYS[key], resolveStorage(storage)));
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
  const achievements = Array.from(new Set(meta.achievements.filter((id) => id.length > 0)));
  return { unlockedRoles: roles, unlockedEndings: endings, achievements };
}

export function loadMetaProgress(storage?: StorageLike | null): MetaProgress {
  const raw = readJson(META_SAVE_KEY, resolveStorage(storage));
  if (!isRecord(raw) || raw.version !== META_SAVE_VERSION ||
    !Array.isArray(raw.unlockedRoles) || !raw.unlockedRoles.every(isRole) ||
    !isStringArray(raw.unlockedEndings)) return createInitialMetaProgress();

  const achievements: unknown = 'achievements' in raw ? raw.achievements : [];
  if (!isStringArray(achievements)) return createInitialMetaProgress();
  return normalizeMeta({
    unlockedRoles: raw.unlockedRoles,
    unlockedEndings: raw.unlockedEndings,
    achievements,
  });
}

export function saveMetaProgress(meta: MetaProgress, storage?: StorageLike | null): boolean {
  const normalized = normalizeMeta(meta);
  const payload: MetaSaveV1 = {
    version: META_SAVE_VERSION,
    unlockedRoles: normalized.unlockedRoles,
    unlockedEndings: normalized.unlockedEndings,
    achievements: normalized.achievements,
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

/** 只记录成就，不在存储层推导结局或自动解锁其他成就。 */
export function unlockAchievement(id: string, storage?: StorageLike | null): MetaProgress {
  const meta = loadMetaProgress(storage);
  if (meta.achievements.includes(id)) return meta;
  const next: MetaProgress = { ...meta, achievements: [...meta.achievements, id] };
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
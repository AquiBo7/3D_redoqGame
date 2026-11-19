import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHAPTER_SAVE_KEY,
  META_SAVE_KEY,
  clearChapterSave,
  createEmptyChapterSave,
  hasChapterSave,
  loadChapterSave,
  loadMetaProgress,
  resetMetaProgress,
  saveChapterSave,
  saveMetaProgress,
  unlockEnding,
  unlockRole,
} from './saveStore';
import type { StorageLike } from './saveStore';

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

describe('分层存档', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('单局存档写入独立 key，并可完整读回', () => {
    const save = createEmptyChapterSave({
      sceneId: 'S5',
      role: 'victim',
      savedAt: 999,
      state: { ...createEmptyChapterSave().state, trust: 2, seenBag: true },
    });

    expect(saveChapterSave(save, storage)).toBe(true);
    expect(storage.getItem(CHAPTER_SAVE_KEY)).not.toBeNull();
    expect(storage.getItem(META_SAVE_KEY)).toBeNull();
    expect(loadChapterSave(storage)).toEqual(save);
    expect(hasChapterSave(storage)).toBe(true);
  });

  it('旧存档缺少 completed 字段时按未完成读取', () => {
    const legacy: Record<string, unknown> = { ...createEmptyChapterSave() };
    delete legacy.completed;
    storage.setItem(CHAPTER_SAVE_KEY, JSON.stringify(legacy));

    const loaded = loadChapterSave(storage);
    expect(loaded?.completed).toBe(false);
  });

  it('completed=true 能被持久化（S9 结尾继续游戏用）', () => {
    saveChapterSave(createEmptyChapterSave({ sceneId: 'S9', completed: true }), storage);
    expect(loadChapterSave(storage)?.completed).toBe(true);
  });

  it('版本号不匹配时拒绝读取', () => {
    storage.setItem(CHAPTER_SAVE_KEY, JSON.stringify({ ...createEmptyChapterSave(), version: 2 }));
    expect(loadChapterSave(storage)).toBeNull();
  });

  it('JSON 损坏或字段缺失时返回 null', () => {
    storage.setItem(CHAPTER_SAVE_KEY, '{not-json');
    expect(loadChapterSave(storage)).toBeNull();

    const broken = createEmptyChapterSave();
    const withBrokenState = { ...broken, state: { ...broken.state, harm: '20' } };
    storage.setItem(CHAPTER_SAVE_KEY, JSON.stringify(withBrokenState));
    expect(loadChapterSave(storage)).toBeNull();
  });

  it('清空单局存档不影响多周目元数据', () => {
    saveChapterSave(createEmptyChapterSave(), storage);
    unlockRole('victim', storage);

    clearChapterSave(storage);

    expect(loadChapterSave(storage)).toBeNull();
    expect(storage.getItem(CHAPTER_SAVE_KEY)).toBeNull();
    expect(loadMetaProgress(storage).unlockedRoles).toEqual(['bystander', 'victim']);
  });

  it('多周目元数据独立读写、去重并始终包含旁观者', () => {
    saveMetaProgress({ unlockedRoles: [], unlockedEndings: ['', 'ending-a'] }, storage);
    expect(JSON.parse(storage.getItem(META_SAVE_KEY) ?? '{}')).toEqual({
      version: 1,
      unlockedRoles: ['bystander'],
      unlockedEndings: ['ending-a'],
    });

    storage.removeItem(META_SAVE_KEY);
    expect(loadMetaProgress(storage)).toEqual({
      unlockedRoles: ['bystander'],
      unlockedEndings: [],
    });

    unlockRole('victim', storage);
    const meta = unlockRole('victim', storage);
    expect(meta.unlockedRoles).toEqual(['bystander', 'victim']);

    expect(unlockEnding('ending-a', storage).unlockedEndings).toEqual(['ending-a']);
    expect(loadMetaProgress(storage)).toEqual({
      unlockedRoles: ['bystander', 'victim'],
      unlockedEndings: ['ending-a'],
    });
  });

  it('重置多周目元数据后恢复默认', () => {
    unlockRole('perpetrator', storage);
    unlockEnding('ending-a', storage);

    expect(resetMetaProgress(storage)).toEqual({
      unlockedRoles: ['bystander'],
      unlockedEndings: [],
    });
    expect(loadMetaProgress(storage).unlockedRoles).toEqual(['bystander']);
  });

  it('localStorage 不可用（null）时不抛错且返回安全默认值', () => {
    expect(loadChapterSave(null)).toBeNull();
    expect(hasChapterSave(null)).toBe(false);
    expect(saveChapterSave(createEmptyChapterSave(), null)).toBe(false);
    expect(() => clearChapterSave(null)).not.toThrow();
    expect(loadMetaProgress(null).unlockedRoles).toEqual(['bystander']);
  });

  it('写入配额异常时静默失败', () => {
    const throwing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };

    expect(saveChapterSave(createEmptyChapterSave(), throwing)).toBe(false);
    expect(() => clearChapterSave(throwing)).not.toThrow();
    expect(() => saveMetaProgress(loadMetaProgress(throwing), throwing)).not.toThrow();
  });
});
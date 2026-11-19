import { beforeEach, describe, expect, it } from 'vitest';
import type { Role, SceneId } from '../data/storySchema';
import { EventBus } from './eventBus';
import { GameEngine } from './gameEngine';
import {
  CHAPTER_SAVE_KEY,
  META_SAVE_KEY,
  createEmptyChapterSave,
  loadChapterSave,
  loadMetaProgress,
  saveChapterSave,
  unlockRole,
} from './saveStore';
import type { StorageLike } from './saveStore';
import type { UrlParams } from './urlParams';

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

function makeParams(overrides: Partial<UrlParams> = {}): UrlParams {
  return {
    debug: false,
    lite: false,
    modelViewer: false,
    phonePreview: false,
    role: 'bystander' as Role,
    scene: null as SceneId | null,
    ...overrides,
  };
}

describe('GameEngine URL 直达与隔离调试', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('?scene=S7 直接进入隔离调试会话且不写正式存档', () => {
    const bus = new EventBus();
    const engine = new GameEngine({
      bus,
      storage,
      params: makeParams({ debug: true, scene: 'S7', role: 'victim' }),
    });
    engine.attach();

    expect(engine.initFromUrl()).toBe(true);
    const snapshot = engine.getDebugSnapshot();
    expect(snapshot).toMatchObject({
      sceneId: 'S7',
      role: 'victim',
      started: true,
      debugSession: true,
      ended: false,
    });
    expect(storage.data.size).toBe(0);

    engine.jumpTo('S8');
    expect(engine.getDebugSnapshot().sceneId).toBe('S8');
    expect(engine.isDebugSession()).toBe(true);
    expect(storage.getItem(CHAPTER_SAVE_KEY)).toBeNull();
  });

  it('未指定 ?scene 时不会自动开始', () => {
    const engine = new GameEngine({
      bus: new EventBus(),
      storage,
      params: makeParams(),
    });

    expect(engine.initFromUrl()).toBe(false);
    expect(engine.getDebugSnapshot().started).toBe(false);
    expect(storage.data.size).toBe(0);
  });

  it('正式开始游戏会清空旧单局存档并写入 S1 自动存档', () => {
    saveChapterSave(createEmptyChapterSave({ sceneId: 'S5' }), storage);
    const bus = new EventBus();
    const engine = new GameEngine({ bus, storage, params: makeParams({ role: 'perpetrator' }) });
    engine.attach();

    bus.emit('game:start');

    const snapshot = engine.getDebugSnapshot();
    expect(snapshot).toMatchObject({ sceneId: 'S1', role: 'perpetrator', debugSession: false });
    const save = loadChapterSave(storage);
    expect(save).toMatchObject({ sceneId: 'S1', role: 'perpetrator', completed: false });
    expect(engine.isDebugSession()).toBe(false);
  });

  it('继续游戏读取存档场景与状态，并保持正式存档模式', () => {
    const state = { ...createEmptyChapterSave().state, trust: 5, seenBag: true };
    saveChapterSave(
      createEmptyChapterSave({ sceneId: 'S3', role: 'perpetrator', state, savedAt: 100 }),
      storage,
    );

    const engine = new GameEngine({
      bus: new EventBus(),
      storage,
      params: makeParams(),
    });
    engine.continueGame();

    const snapshot = engine.getDebugSnapshot();
    expect(snapshot).toMatchObject({ sceneId: 'S3', role: 'perpetrator', debugSession: false });
    expect(snapshot.state.trust).toBe(5);
    expect(snapshot.state.seenBag).toBe(true);
    expect(loadChapterSave(storage)?.sceneId).toBe('S3');
  });

  it('无存档时“继续游戏”退化为新开一局', () => {
    const engine = new GameEngine({ bus: new EventBus(), storage, params: makeParams() });
    engine.continueGame();

    expect(engine.getDebugSnapshot().sceneId).toBe('S1');
    expect(loadChapterSave(storage)?.sceneId).toBe('S1');
  });

  it('已完成存档继续时重放章节结尾事件', () => {
    const bus = new EventBus();
    const chapterEnds: string[] = [];
    bus.on('game:chapterEnd', (payload) => chapterEnds.push(payload.sceneId));

    saveChapterSave(createEmptyChapterSave({ sceneId: 'S9', completed: true }), storage);
    const engine = new GameEngine({ bus, storage, params: makeParams() });
    engine.continueGame();

    expect(chapterEnds).toEqual(['S9']);
    expect(engine.getDebugSnapshot().ended).toBe(true);
    expect(loadChapterSave(storage)?.completed).toBe(true);
  });

  it('调试跳关保留状态但不覆盖正式存档', () => {
    const engine = new GameEngine({ bus: new EventBus(), storage, params: makeParams() });
    engine.startNewGame();
    const before = storage.getItem(CHAPTER_SAVE_KEY);

    engine.jumpTo('S5');

    expect(engine.getDebugSnapshot()).toMatchObject({ sceneId: 'S5', debugSession: true });
    expect(storage.getItem(CHAPTER_SAVE_KEY)).toBe(before);
  });

  it('调试清空存档并重开 S1：恢复正式模式且保留多周目元数据', () => {
    unlockRole('victim', storage);
    const engine = new GameEngine({ bus: new EventBus(), storage, params: makeParams() });
    engine.startNewGame();
    engine.jumpTo('S6');

    engine.clearChapterSaveAndRestart();

    const snapshot = engine.getDebugSnapshot();
    expect(snapshot).toMatchObject({ sceneId: 'S1', debugSession: false });
    expect(snapshot.state.trust).toBe(0);
    expect(loadChapterSave(storage)?.sceneId).toBe('S1');
    expect(loadMetaProgress(storage).unlockedRoles).toEqual(['bystander', 'victim']);
  });

  it('重置多周目元数据只影响 META key', () => {
    unlockRole('perpetrator', storage);
    const engine = new GameEngine({ bus: new EventBus(), storage, params: makeParams() });
    engine.startNewGame();

    const meta = engine.resetMetaProgress();

    expect(meta).toEqual({ unlockedRoles: ['bystander'], unlockedEndings: [] });
    expect(loadMetaProgress(storage).unlockedRoles).toEqual(['bystander']);
    expect(storage.getItem(META_SAVE_KEY)).not.toBeNull();
    expect(loadChapterSave(storage)?.sceneId).toBe('S1');
  });

  it('dispose 后不再响应总线事件', () => {
    const bus = new EventBus();
    const engine = new GameEngine({ bus, storage, params: makeParams() });
    engine.attach();
    engine.dispose();

    bus.emit('game:start');

    expect(engine.getDebugSnapshot().started).toBe(false);
    expect(storage.data.size).toBe(0);
  });

  it('storage=null 时仍可运行（不持久化）', () => {
    const bus = new EventBus();
    const engine = new GameEngine({ bus, storage: null, params: makeParams() });
    engine.attach();

    expect(() => bus.emit('game:start')).not.toThrow();
    expect(engine.getDebugSnapshot()).toMatchObject({ sceneId: 'S1', started: true });
  });
});
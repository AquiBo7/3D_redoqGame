import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role, SceneId } from '../data/storySchema';
import { EventBus } from './eventBus';
import { GameEngine } from './gameEngine';
import {
  CHAPTER_SAVE_KEY,
  CHECKPOINT_SAVE_KEYS,
  META_SAVE_KEY,
  createEmptyChapterSave,
  loadChapterSave,
  loadCheckpoint,
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

  it.each([
    ['S9', 'S10'],
    ['S10', 'S11'],
  ] as const)('已完成的旧 %s 非结局存档只迁移至紧接的 %s', (sceneId, nextScene) => {
    const bus = new EventBus();
    const chapterEnds: string[] = [];
    const transitions: SceneId[] = [];
    bus.on('game:chapterEnd', (payload) => chapterEnds.push(payload.sceneId));
    bus.on('scene:transition', (payload) => transitions.push(payload.toSceneId));
    const state = { ...createEmptyChapterSave().state, noticedPhoto: true, likedPhoto: true, trust: 3 };
    saveChapterSave(createEmptyChapterSave({ sceneId, state, role: 'victim', completed: true }), storage);
    const engine = new GameEngine({ bus, storage, params: makeParams() });
    engine.continueGame();

    expect(transitions).toEqual([nextScene]);
    expect(chapterEnds).toEqual([]);
    expect(engine.getDebugSnapshot()).toMatchObject({
      sceneId: nextScene, role: 'victim', state, ended: false, debugSession: false,
    });
    expect(loadChapterSave(storage)).toMatchObject({ sceneId: nextScene, state, completed: false });
  });

  it('真正的 E1 结局存档继续时重放结尾而不迁移', () => {
    const bus = new EventBus();
    const chapterEnds: string[] = [];
    bus.on('game:chapterEnd', (payload) => chapterEnds.push(payload.sceneId));
    const state = { ...createEmptyChapterSave().state, postChoice: 'joke' as const, ending: 'joined' as const };
    saveChapterSave(createEmptyChapterSave({ sceneId: 'E1', state, completed: true }), storage);
    const engine = new GameEngine({ bus, storage, params: makeParams() });
    engine.continueGame();

    expect(chapterEnds).toEqual(['E1']);
    expect(engine.getDebugSnapshot()).toMatchObject({ sceneId: 'E1', state, ended: true });
    expect(loadChapterSave(storage)).toMatchObject({ sceneId: 'E1', state, completed: true });
  });

  it.each(['s9-look', 's9-ignore'])('S9 %s 经总线进入 S10，字幕回执进入未完成的真实 S11', (choiceId) => {
    const bus = new EventBus();
    const chapterEnds: string[] = [];
    const intertitles: string[] = [];
    bus.on('game:chapterEnd', (payload) => chapterEnds.push(payload.sceneId));
    bus.on('ui:showIntertitle', (payload) => intertitles.push(payload.stepId));
    const engine = new GameEngine({ bus, storage, params: makeParams(), now: () => 1000 });
    engine.attach();
    engine.startNewGame('S9');
    bus.emit('ui:chooseOption', { stepId: 's9-choice', choiceId });
    if (choiceId === 's9-look') {
      const before = engine.getDebugSnapshot().state;
      bus.emit('ui:phoneAction', { phoneId: 's9-phone', action: 'reply', optionId: 'unknown-option' });
      expect(engine.getDebugSnapshot().state).toEqual(before);
      for (const optionId of ['s9-notice-photo', 's9-like-photo']) {
        bus.emit('ui:phoneAction', { phoneId: 's9-phone', action: 'reply', optionId });
        const once = engine.getDebugSnapshot().state;
        bus.emit('ui:phoneAction', { phoneId: 's9-phone', action: 'reply', optionId });
        expect(engine.getDebugSnapshot().state).toEqual(once);
      }
      expect(engine.getDebugSnapshot()).toMatchObject({ sceneId: 'S9', ended: false });
      bus.emit('ui:phoneAction', { phoneId: 's9-phone', action: 'close' });
    }

    expect(engine.getDebugSnapshot()).toMatchObject({ sceneId: 'S10', ended: false, debugSession: false });
    expect(chapterEnds).toEqual([]);
    expect(intertitles).toEqual(['s10-days']);
    expect(loadChapterSave(storage)).toMatchObject({
      sceneId: 'S10', completed: false,
      state: { noticedPhoto: choiceId === 's9-look', likedPhoto: choiceId === 's9-look', harm: 20 },
    });
    const pendingSave = storage.getItem(CHAPTER_SAVE_KEY);
    bus.emit('ui:dialogueEnd', { stepId: 's9-end' });
    expect(storage.getItem(CHAPTER_SAVE_KEY)).toBe(pendingSave);
    expect(chapterEnds).toEqual([]);

    bus.emit('ui:dialogueEnd', { stepId: 's10-days' });
    expect(engine.getDebugSnapshot()).toMatchObject({ sceneId: 'S11', ended: false });
    expect(chapterEnds).toEqual([]);
    expect(loadChapterSave(storage)).toMatchObject({ sceneId: 'S11', completed: false });
    const s11Save = storage.getItem(CHAPTER_SAVE_KEY);
    const s11Snapshot = engine.getDebugSnapshot();
    bus.emit('ui:dialogueEnd', { stepId: 's10-days' });
    expect(engine.getDebugSnapshot()).toEqual(s11Snapshot);
    expect(chapterEnds).toEqual([]);
    expect(storage.getItem(CHAPTER_SAVE_KEY)).toBe(s11Save);
    engine.dispose();
  });

  it('未完成 S10 存档继续时重放字幕，照片状态保留且不会提前触发结尾', () => {
    const state = { ...createEmptyChapterSave().state, noticedPhoto: true, likedPhoto: true };
    saveChapterSave(createEmptyChapterSave({ sceneId: 'S10', state, completed: false }), storage);
    const bus = new EventBus();
    const intertitles: string[] = [];
    const chapterEnds: string[] = [];
    bus.on('ui:showIntertitle', (payload) => intertitles.push(payload.stepId));
    bus.on('game:chapterEnd', (payload) => chapterEnds.push(payload.sceneId));
    const engine = new GameEngine({ bus, storage, params: makeParams() });
    engine.attach();
    bus.emit('ui:continueGame');
    expect(engine.getDebugSnapshot()).toMatchObject({ sceneId: 'S10', ended: false });
    expect(engine.getDebugSnapshot().state).toEqual(state);
    expect(intertitles).toEqual(['s10-days']);
    expect(chapterEnds).toEqual([]);
    expect(loadChapterSave(storage)?.completed).toBe(false);
    bus.emit('ui:dialogueEnd', { stepId: 's10-days' });
    expect(chapterEnds).toEqual([]);
    expect(engine.getDebugSnapshot()).toMatchObject({ sceneId: 'S11', ended: false });
    expect(loadChapterSave(storage)).toMatchObject({
      sceneId: 'S11', completed: false, state: { noticedPhoto: true, likedPhoto: true },
    });
    engine.dispose();
  });

  it('自动保存 S12 入场检查点；真实玩笑结局后恢复前置选择、清除后续观察且保留 A5', () => {
    const bus = new EventBus();
    const chapterEnds: string[] = [];
    bus.on('game:chapterEnd', ({ sceneId }) => chapterEnds.push(sceneId));
    const engine = new GameEngine({ bus, storage, params: makeParams(), now: () => 1000 });
    engine.attach();
    engine.startNewGame('S9');
    bus.emit('ui:chooseOption', { stepId: 's9-choice', choiceId: 's9-look' });
    bus.emit('ui:phoneAction', { phoneId: 's9-phone', action: 'reply', optionId: 's9-like-photo' });
    bus.emit('ui:phoneAction', { phoneId: 's9-phone', action: 'close' });
    bus.emit('ui:dialogueEnd', { stepId: 's10-days' });
    bus.emit('ui:dialogueEnd', { stepId: 's11-roommate' });
    bus.emit('ui:phoneAction', { phoneId: 's11-phone', action: 'close' });
    bus.emit('ui:chooseOption', { stepId: 's11-reply', choiceId: 's11-classmate' });
    expect(loadCheckpoint('ch2_canteen', storage)).toBeNull();
    bus.emit('ui:dialogueEnd', { stepId: 's11-classmate-reply' });

    const checkpoint = loadCheckpoint('ch2_canteen', storage);
    expect(checkpoint).toMatchObject({
      sceneId: 'S12', completed: false, savedAt: 1000,
      state: { likedPhoto: true, roommateReply: '这是我们班的吧。', pointedOut: true,
        harm: 23, canteenSeen: 0, postChoice: null, ending: null },
    });
    expect(checkpoint?.state).toEqual(engine.getDebugSnapshot().state);
    expect(checkpoint).toEqual(loadChapterSave(storage));
    const checkpointRaw = storage.getItem(CHECKPOINT_SAVE_KEYS.ch2_canteen);
    for (const zoneId of ['canteen-whisper-1', 'canteen-whisper-2', 'canteen-whisper-3']) {
      bus.emit('scene:enterZone', { sceneId: 'S12', zoneId });
    }
    expect(engine.getDebugSnapshot().state.canteenSeen).toBe(3);
    expect(storage.getItem(CHECKPOINT_SAVE_KEYS.ch2_canteen)).toBe(checkpointRaw);
    bus.emit('scene:interact', { sceneId: 'S12', targetId: 'window-three' });
    bus.emit('ui:dialogueEnd', { stepId: 's12-vibration' });
    bus.emit('ui:dialogueEnd', { stepId: 's13-message' });
    bus.emit('ui:phoneAction', { phoneId: 's13-phone', action: 'close' });
    bus.emit('ui:dialogueEnd', { stepId: 's13-that-is-you' });
    bus.emit('ui:chooseOption', { stepId: 's14-choice', choiceId: 's14-joke' });
    expect(chapterEnds).toEqual([]);
    bus.emit('ui:dialogueEnd', { stepId: 's14-joke-blackout' });
    expect(chapterEnds).toEqual(['E1']);
    expect(loadChapterSave(storage)).toMatchObject({
      sceneId: 'E1', completed: true, state: { canteenSeen: 3, postChoice: 'joke', ending: 'joined' },
    });
    expect(loadMetaProgress(storage)).toMatchObject({ unlockedEndings: ['joined'], achievements: ['A5'] });
    const metaRaw = storage.getItem(META_SAVE_KEY);
    expect(storage.getItem(CHECKPOINT_SAVE_KEYS.ch2_canteen)).toBe(checkpointRaw);

    expect(engine.restoreCheckpoint('ch2_canteen')).toBe(true);
    expect(engine.getDebugSnapshot()).toMatchObject({
      sceneId: 'S12', state: checkpoint?.state, ended: false, debugSession: false,
    });
    expect(loadChapterSave(storage)).toEqual(checkpoint);
    expect(storage.getItem(META_SAVE_KEY)).toBe(metaRaw);
    expect(chapterEnds).toEqual(['E1']);
    // 恢复到窗口等待步骤，旧观察触发器也应重新可用。
    bus.emit('scene:enterZone', { sceneId: 'S12', zoneId: 'canteen-whisper-1' });
    expect(engine.getDebugSnapshot().state.canteenSeen).toBe(1);
    expect(storage.getItem(CHECKPOINT_SAVE_KEYS.ch2_canteen)).toBe(checkpointRaw);
    engine.dispose();
  });

  it.each(['url', 'jump'] as const)('%s 调试进入 S12 不创建或覆盖任何检查点', (mode) => {
    const bus = new EventBus();
    // URL 路径验证无存档时不创建；跳关路径验证已有正式检查点不被覆盖。
    if (mode === 'jump') {
      const formal = new GameEngine({ bus: new EventBus(), storage, params: makeParams() });
      formal.startNewGame('S12');
    }
    const before = new Map(storage.data);
    const write = vi.spyOn(storage, 'setItem');
    const engine = new GameEngine({
      bus, storage, params: makeParams(mode === 'url' ? { debug: true, scene: 'S12' } : {}),
    });
    engine.attach();
    if (mode === 'url') expect(engine.initFromUrl()).toBe(true);
    else engine.jumpTo('S12');
    expect(engine.getDebugSnapshot()).toMatchObject({ sceneId: 'S12', debugSession: true });
    bus.emit('scene:enterZone', { sceneId: 'S12', zoneId: 'canteen-whisper-1' });
    bus.emit('scene:interact', { sceneId: 'S12', targetId: 'window-three' });
    bus.emit('ui:dialogueEnd', { stepId: 's12-vibration' });
    expect(engine.getDebugSnapshot().sceneId).toBe('S13');
    engine.jumpTo('S12');
    expect(write).not.toHaveBeenCalled();
    expect(storage.data).toEqual(before);
    write.mockRestore();
    engine.dispose();
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

    expect(meta).toEqual({ unlockedRoles: ['bystander'], unlockedEndings: [], achievements: [] });
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
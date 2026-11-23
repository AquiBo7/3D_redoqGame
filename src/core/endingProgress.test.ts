import { describe, expect, it, vi } from 'vitest';
import { chapter1 } from '../data/story';
import { CHAPTER_PRESETS } from '../data/chapterPresets';
import type { EndingId } from '../data/achievements';
import { EventBus } from './eventBus';
import { GameEngine } from './gameEngine';
import { CHAPTER_SAVE_KEY, CHECKPOINT_SAVE_KEYS, createEmptyChapterSave, loadChapterSave, loadCheckpoint, loadMetaProgress, saveChapterSave, saveCheckpoint } from './saveStore';
import type { StorageLike } from './saveStore';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}
const params = { debug: false, lite: false, modelViewer: false, phonePreview: false, night: false, role: 'bystander' as const, scene: null };
function setup() {
  const storage = new MemoryStorage();
  const bus = new EventBus();
  const engine = new GameEngine({ storage, bus, params });
  engine.attach();
  return { storage, bus, engine };
}
function completed(storage: StorageLike, ending: EndingId) {
  const save = createEmptyChapterSave({ sceneId: 'E1', completed: true });
  save.state.ending = ending;
  saveChapterSave(save, storage);
}

describe('结局元数据与标题生命周期', () => {
  it.each([['best', 'A1'], ['middle', 'A2'], ['worst', 'A3'], ['bystander', 'A4'], ['joined', 'A5']] as const)('%s只记录对应成就，不重复通知', (ending, achievement) => {
    const { storage, bus, engine } = setup();
    const notifications: string[][] = [];
    bus.on('meta:changed', ({ newlyUnlocked }) => { if (newlyUnlocked.length) notifications.push(newlyUnlocked); });
    completed(storage, ending);
    engine.continueGame();
    expect(loadMetaProgress(storage)).toMatchObject({ unlockedEndings: [ending], achievements: [achievement] });
    engine.continueGame();
    expect(notifications).toEqual([[achievement]]);
  });

  it('第五个结局同时记录当前成就与A6，独立于单局重开', () => {
    const { storage, bus, engine } = setup();
    const notifications: string[][] = [];
    bus.on('meta:changed', ({ newlyUnlocked }) => notifications.push(newlyUnlocked));
    for (const ending of ['joined', 'worst', 'middle', 'bystander', 'best'] as const) {
      completed(storage, ending);
      engine.continueGame();
    }
    expect(notifications[notifications.length - 1]).toEqual(['A1', 'A6']);
    expect(loadMetaProgress(storage).achievements).toHaveLength(6);
    bus.emit('game:start');
    expect(loadMetaProgress(storage).achievements).toHaveLength(6);
    expect(loadChapterSave(storage)?.state.ending).toBeNull();
  });

  it('调试完成不污染任何正式成就或存档', () => {
    const { storage, engine } = setup();
    completed(storage, 'joined');
    const before = [...storage.data.entries()];
    engine.jumpTo('E1');
    expect([...storage.data.entries()]).toEqual(before);
    expect(loadMetaProgress(storage).achievements).toEqual([]);
  });

  it('返回标题不清存档，取消迟到UI事件，继续可再次进入', () => {
    const { storage, bus, engine } = setup();
    bus.emit('game:start');
    const before = storage.getItem(CHAPTER_SAVE_KEY);
    const title = vi.fn();
    bus.on('game:title', title);
    bus.emit('ui:returnTitle');
    expect(title).toHaveBeenCalledWith({ hasSave: true });
    bus.emit('ui:dialogueEnd', { stepId: 's1-caption' });
    bus.emit('scene:interact', { sceneId: 'S1', targetId: 'phone' });
    expect(engine.getDebugSnapshot().started).toBe(false);
    expect(storage.getItem(CHAPTER_SAVE_KEY)).toBe(before);
    bus.emit('ui:continueGame');
    expect(engine.getDebugSnapshot().started).toBe(true);
  });

  it('元数据请求只读且使用引擎注入的存储', () => {
    const { storage, bus, engine } = setup();
    completed(storage, 'worst');
    engine.continueGame();
    const meta = vi.fn();
    const before = [...storage.data.entries()];
    bus.on('meta:changed', meta);
    bus.emit('ui:requestMeta');
    expect(meta).toHaveBeenCalledWith({ meta: loadMetaProgress(storage), newlyUnlocked: [] });
    expect([...storage.data.entries()]).toEqual(before);
  });
});

describe('章节选择预设与检查点隔离', () => {
  it.each(CHAPTER_PRESETS.filter((item) => item.id !== 'ch5'))('$id可进入真实章节且前置变量明确', (preset) => {
    const { storage, bus, engine } = setup();
    bus.emit('ui:selectChapter', { chapterId: preset.id });
    expect(engine.getDebugSnapshot()).toMatchObject({ sceneId: preset.sceneId, started: true, debugSession: false });
    expect(loadChapterSave(storage)?.sceneId).toBe(preset.sceneId);
    for (const [key, value] of Object.entries(preset.state)) expect(engine.getDebugSnapshot().state[key as keyof typeof preset.state]).toEqual(value);
    expect(chapter1.scenes[preset.sceneId]).toBeDefined();
    expect(engine.getDebugSnapshot().state.fatherKnows).toBe(false);
  });

  it('第五章预览隔离存档和成就，可返回标题继续原进度', () => {
    const { storage, bus, engine } = setup();
    bus.emit('ui:selectChapter', { chapterId: 'ch3' });
    const before = [...storage.data.entries()];
    bus.emit('ui:selectChapter', { chapterId: 'ch5' });
    expect(engine.getDebugSnapshot()).toMatchObject({ sceneId: 'E1', debugSession: true });
    expect([...storage.data.entries()]).toEqual(before);
    bus.emit('ui:returnTitle');
    bus.emit('ui:continueGame');
    expect(engine.getDebugSnapshot()).toMatchObject({ sceneId: 'C1', debugSession: false });
  });

  it('预设数组独立克隆，不会被后续选项污染', () => {
    const { bus, engine } = setup();
    const before = JSON.stringify(CHAPTER_PRESETS);
    bus.emit('ui:selectChapter', { chapterId: 'ch4' });
    const state = engine.getDebugSnapshot().state;
    state.clues.push('测试');
    state.yuanKeys.push('force');
    expect(JSON.stringify(CHAPTER_PRESETS)).toBe(before);
  });

  it('新一局清除上一局检查点，当前章节生成正确的入口快照', () => {
    const { storage, bus, engine } = setup();
    for (const key of Object.keys(CHECKPOINT_SAVE_KEYS) as Array<keyof typeof CHECKPOINT_SAVE_KEYS>) {
      saveCheckpoint(key, createEmptyChapterSave({ sceneId: 'D1' }), storage);
    }
    bus.emit('game:start');
    expect(engine.restoreCheckpoint('ch4_platform')).toBe(false);
    expect(loadCheckpoint('ch2_canteen', storage)).toBeNull();
    bus.emit('ui:selectChapter', { chapterId: 'ch3' });
    expect(loadCheckpoint('ch3_morning', storage)?.sceneId).toBe('C1');
    bus.emit('ui:selectChapter', { chapterId: 'ch4' });
    expect(loadCheckpoint('ch3_morning', storage)).toBeNull();
    expect(loadCheckpoint('ch4_platform', storage)?.state.evidence).toBe(true);
  });
});

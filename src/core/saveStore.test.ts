import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHAPTER_SAVE_KEY,
  CHECKPOINT_SAVE_KEYS,
  META_SAVE_KEY,
  clearChapterSave,
  createEmptyChapterSave,
  hasChapterSave,
  loadChapterSave,
  loadCheckpoint,
  loadMetaProgress,
  resetMetaProgress,
  saveChapterSave,
  saveCheckpoint,
  saveMetaProgress,
  unlockAchievement,
  unlockEnding,
  unlockRole,
} from './saveStore';
import type { CheckpointKey, StorageLike } from './saveStore';
import { createInitialMetaProgress, createInitialStoryState } from './state';
import type { StoryState } from './state';
import { SCENE_IDS } from '../data/storySchema';

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

// 真正的旧版结构，不使用新默认值掩盖迁移遗漏。
function legacySave() {
  return {
    version: 1, chapterId: 'ch1', savedAt: 42, sceneId: 'S7', role: 'bystander',
    state: {
      momReply: '马上出门。', phoneIgnored: 2, seenBag: true, seenHandoff: true,
      noticedTyper: false, handedPen: true, reasonText: '起晚了', seenCrossedOut: true,
      picked: true, seenFatherWatching: false, trust: 2, harm: 17,
      log: [{ timestamp: 40, sceneId: 'S7', type: 'choice', summary: '递过笔。' }],
    },
  };
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

  it('三个章节检查点独立持久化且不会被清空单局存档影响', () => {
    const keys = Object.keys(CHECKPOINT_SAVE_KEYS) as CheckpointKey[];
    const scenes = ['S12', 'C1', 'D1'] as const;
    const current = createEmptyChapterSave({ sceneId: 'S8' });
    saveChapterSave(current, storage);
    unlockAchievement('A1', storage);
    keys.forEach((key, index) => {
      expect(loadCheckpoint(key, storage)).toBeNull();
      const save = createEmptyChapterSave({ sceneId: scenes[index], state: {
        ...createInitialStoryState(), trust: index + 1, clues: ['保留线索'],
      } });
      expect(saveCheckpoint(key, save, storage)).toBe(true);
      expect(loadCheckpoint(key, storage)).toEqual(save);
    });
    expect(loadChapterSave(storage)).toEqual(current);
    clearChapterSave(storage);
    keys.forEach((key, index) => {
      const loaded = loadCheckpoint(key, storage);
      expect(loaded?.sceneId).toBe(scenes[index]);
      expect(loaded?.state.trust).toBe(index + 1);
      loaded?.state.clues.push('不污染快照');
      expect(loadCheckpoint(key, storage)?.state.clues).toEqual(['保留线索']);
    });
    expect(loadMetaProgress(storage).achievements).toEqual(['A1']);
  });

  it('检查点拒绝损坏数据，并兼容旧版状态及不可用存储', () => {
    const key: CheckpointKey = 'ch2_canteen';
    storage.setItem(CHECKPOINT_SAVE_KEYS[key], JSON.stringify(legacySave()));
    expect(loadCheckpoint(key, storage)?.state).toEqual({ ...createInitialStoryState(), ...legacySave().state });
    storage.setItem(CHECKPOINT_SAVE_KEYS[key], '{broken');
    expect(loadCheckpoint(key, storage)).toBeNull();
    expect(saveCheckpoint(key, createEmptyChapterSave(), null)).toBe(false);
    expect(loadCheckpoint(key, null)).toBeNull();
    const throwing: StorageLike = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => undefined,
    };
    expect(saveCheckpoint(key, createEmptyChapterSave(), throwing)).toBe(false);
    expect(loadCheckpoint(key, throwing)).toBeNull();
  });

  it('旧存档缺少 completed 字段时按未完成读取', () => {
    const legacy: Record<string, unknown> = { ...createEmptyChapterSave() };
    delete legacy.completed;
    storage.setItem(CHAPTER_SAVE_KEY, JSON.stringify(legacy));

    const loaded = loadChapterSave(storage);
    expect(loaded?.completed).toBe(false);
  });

  it('v1 旧字段完整保留，所有缺失的新字段与 completed 使用默认值', () => {
    const legacy = legacySave();
    const raw = JSON.stringify(legacy);
    storage.setItem(CHAPTER_SAVE_KEY, raw);
    const loaded = loadChapterSave(storage);
    expect(loaded).toEqual({
      ...legacy, completed: false, state: { ...createInitialStoryState(), ...legacy.state },
    });
    expect(storage.getItem(CHAPTER_SAVE_KEY)).toBe(raw);
    if (!loaded) throw new Error('旧存档迁移失败');
    loaded.state.clues.push('新线索');
    loaded.state.yuanKeys.push('fact');
    expect(loadChapterSave(storage)?.state.clues).toEqual([]);
    expect(loadChapterSave(storage)?.state.yuanKeys).toEqual([]);
    expect(saveChapterSave(loaded, storage)).toBe(true);
    expect(loadChapterSave(storage)).toEqual(loaded);
  });

  it('部分新增字段已存在时保留合法值，只补齐真正缺失的字段', () => {
    const legacy = legacySave();
    storage.setItem(CHAPTER_SAVE_KEY, JSON.stringify({
      ...legacy, state: { ...legacy.state, visitedStairwell: true, yuanScore: -1, clues: ['小票'] },
    }));
    expect(loadChapterSave(storage)?.state).toEqual({
      ...createInitialStoryState(), ...legacy.state, visitedStairwell: true, yuanScore: -1, clues: ['小票'],
    });
  });

  it.each(Object.keys(legacySave().state))('旧必需字段 %s 缺失仍按损坏处理', (key) => {
    const legacy = legacySave();
    const state: Record<string, unknown> = { ...legacy.state };
    delete state[key];
    storage.setItem(CHAPTER_SAVE_KEY, JSON.stringify({ ...legacy, state }));
    expect(loadChapterSave(storage)).toBeNull();
  });

  it.each(SCENE_IDS)('新旧节点 %s 和日志场景均能持久化', (sceneId) => {
    const save = createEmptyChapterSave({ sceneId, state: {
      ...createInitialStoryState(),
      log: [{ sceneId, timestamp: 1, type: 'system', summary: '进入场景。' }],
    } });
    expect(saveChapterSave(save, storage)).toBe(true);
    expect(loadChapterSave(storage)).toEqual(save);
  });

  it('新字段、枚举及全部数组可往返，加载副本与输入存档互不污染', () => {
    const save = createEmptyChapterSave({ sceneId: 'D2', state: {
      ...createInitialStoryState(), newsSeen: true, helpedPasserby: true,
      noticedPhoneBehind: true, noticedPhoto: true, likedPhoto: true,
      roommateReply: '先看完整。', pointedOut: true, canteenSeen: 3, postChoice: 'explain',
      addedHer: true, listened: true, evidence: true, seat: 'front', teacherTalked: true,
      tellTeacher: 'told', visitedStairwell: true, askedAboutFather: true, fatherKnows: false,
      clues: ['小票', '橙色手机壳'], wrongAsks: 2, foundAyuanWay: 'recognize', yuanState: 'unprepared',
      yuanScore: 3, yuanKeys: ['fact', 'empathy', 'company'], route: 'team', postDeleted: true,
      joined: true, phrase: '一起想办法。', stage1Tries: 5, crystalHits: 4, kills: 20,
      helpedByAyuan: true, apologized: true, soloRepair: false, ending: 'best',
      finalAnswer: 'tired', draftReactions: ['你先问了我。谢谢。'],
      log: [{ sceneId: 'D2', timestamp: 2, type: 'choice', summary: '说明事实。' }],
    } });
    saveChapterSave(save, storage);
    const loaded = loadChapterSave(storage);
    expect(loaded).toEqual(save);
    if (!loaded) throw new Error('存档读取失败');
    loaded.state.clues.push('另一条线索');
    loaded.state.yuanKeys.push('noise');
    loaded.state.draftReactions.push('副本反应');
    loaded.state.log[0].summary = '副本日志';
    expect(loadChapterSave(storage)).toEqual(save);
    expect(save.state.clues).toEqual(['小票', '橙色手机壳']);
    expect(save.state.draftReactions).toEqual(['你先问了我。谢谢。']);
  });

  const invalidFields: Array<[keyof StoryState, unknown]> = [
    ['newsSeen', 'true'], ['helpedPasserby', 1], ['finalAnswer', 'other'], ['draftReactions', [1]], ['draftReactions', 'bad'],
    ['noticedPhoneBehind', 'true'], ['noticedPhoto', 1], ['likedPhoto', null], ['roommateReply', 3],
    ['pointedOut', 'false'], ['canteenSeen', '3'], ['postChoice', 'other'], ['addedHer', null],
    ['listened', []], ['evidence', 1], ['seat', 'near'], ['teacherTalked', {}], ['tellTeacher', 'later'],
    ['visitedStairwell', 'false'], ['askedAboutFather', 0], ['fatherKnows', null], ['clues', ['小票', 1]],
    ['wrongAsks', null], ['foundAyuanWay', 'other'], ['yuanState', 'calm'], ['yuanScore', '1'],
    ['yuanKeys', ['fact', false]], ['route', 'other'], ['postDeleted', 1], ['joined', 'true'],
    ['phrase', false], ['stage1Tries', '5'], ['crystalHits', null], ['kills', {}],
    ['helpedByAyuan', 'false'], ['apologized', 0], ['soloRepair', []], ['ending', 'unknown'],
    ['clues', '小票'], ['yuanKeys', null], ['harm', '20'],
    ['log', [{ timestamp: 1, sceneId: 'E2', type: 'system', summary: '未知场景' }]],
    ['log', [{ timestamp: '1', sceneId: 'D1', type: 'system', summary: '时间类型错误' }]],
    ['log', [{ timestamp: 1, sceneId: 'D1', type: 'bad', summary: '日志类型错误' }]],
    ['log', [{ timestamp: 1, sceneId: 'D1', type: 'system', summary: null }]],
  ];
  it.each(invalidFields)('拒绝非法字段 %s=%j，不用迁移默认值吞掉损坏', (key, value) => {
    const legacy = legacySave();
    storage.setItem(CHAPTER_SAVE_KEY, JSON.stringify({ ...legacy, state: { ...legacy.state, [key]: value } }));
    expect(loadChapterSave(storage)).toBeNull();
  });

  it.each(['canteenSeen', 'wrongAsks', 'yuanScore', 'stage1Tries', 'crystalHits', 'kills', 'harm'])
    ('拒绝 JSON 可解析但非有限的数值 %s', (key) => {
      // JSON 数字溢出可解析为 Infinity，不能只依赖 typeof number。
      const save = createEmptyChapterSave({ state: { ...createInitialStoryState(), [key]: 987654321 } });
      storage.setItem(CHAPTER_SAVE_KEY, JSON.stringify(save).replace('987654321', '1e999'));
      expect(loadChapterSave(storage)).toBeNull();
    });

  it('存档只记录阈值，不替剧情推导证据、路线或结局', () => {
    const save = createEmptyChapterSave({ state: {
      ...createInitialStoryState(), picked: true, trust: 7, harm: 70,
      seat: 'far', tellTeacher: 'think', yuanScore: 5, yuanKeys: ['fact', 'empathy', 'company'],
      stage1Tries: 5, wrongAsks: 4,
    } });
    saveChapterSave(save, storage);
    expect(loadChapterSave(storage)).toEqual(save);
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
    saveMetaProgress({ unlockedRoles: [], unlockedEndings: ['', 'ending-a'], achievements: [] }, storage);
    expect(JSON.parse(storage.getItem(META_SAVE_KEY) ?? '{}')).toEqual({
      version: 1,
      unlockedRoles: ['bystander'],
      unlockedEndings: ['ending-a'],
      achievements: [],
    });

    storage.removeItem(META_SAVE_KEY);
    expect(loadMetaProgress(storage)).toEqual({
      unlockedRoles: ['bystander'],
      unlockedEndings: [],
      achievements: [],
    });

    unlockRole('victim', storage);
    const meta = unlockRole('victim', storage);
    expect(meta.unlockedRoles).toEqual(['bystander', 'victim']);

    expect(unlockEnding('ending-a', storage).unlockedEndings).toEqual(['ending-a']);
    expect(loadMetaProgress(storage)).toEqual({
      unlockedRoles: ['bystander', 'victim'],
      unlockedEndings: ['ending-a'],
      achievements: [],
    });
  });

  it('旧元数据缺少 achievements 时迁移为空数组，并保留解锁项', () => {
    storage.setItem(META_SAVE_KEY, JSON.stringify({
      version: 1, unlockedRoles: ['victim'], unlockedEndings: ['best'],
    }));
    expect(loadMetaProgress(storage)).toEqual({
      unlockedRoles: ['bystander', 'victim'], unlockedEndings: ['best'], achievements: [],
    });
  });

  it.each([null, 'A1', [1], ['A1', null], {}])('拒绝非法 achievements=%j 并恢复安全默认值', (achievements) => {
    storage.setItem(META_SAVE_KEY, JSON.stringify({
      version: 1, unlockedRoles: ['victim'], unlockedEndings: ['best'], achievements,
    }));
    expect(loadMetaProgress(storage)).toEqual(createInitialMetaProgress());
  });

  it('成就独立持久化、去重、不改章节也不自动推导其他成就', () => {
    const save = createEmptyChapterSave();
    saveChapterSave(save, storage);
    unlockRole('victim', storage);
    unlockEnding('best', storage);
    for (const id of ['A1', 'A1', 'A2', 'A3', 'A4', 'A5', '']) unlockAchievement(id, storage);
    const meta = loadMetaProgress(storage);
    expect(meta).toEqual({
      unlockedRoles: ['bystander', 'victim'], unlockedEndings: ['best'], achievements: ['A1', 'A2', 'A3', 'A4', 'A5'],
    });
    expect(loadChapterSave(storage)).toEqual(save);
    meta.achievements.push('A6');
    expect(loadMetaProgress(storage).achievements).not.toContain('A6');
  });

  it('保存元数据不会修改输入数组', () => {
    const meta = { unlockedRoles: [], unlockedEndings: ['best', 'best', ''], achievements: ['A1', 'A1', ''] };
    saveMetaProgress(meta, storage);
    expect(meta).toEqual({ unlockedRoles: [], unlockedEndings: ['best', 'best', ''], achievements: ['A1', 'A1', ''] });
    expect(loadMetaProgress(storage)).toEqual({
      unlockedRoles: ['bystander'], unlockedEndings: ['best'], achievements: ['A1'],
    });
  });

  it('重置多周目元数据后恢复默认', () => {
    unlockRole('perpetrator', storage);
    unlockEnding('ending-a', storage);
    unlockAchievement('A1', storage);

    expect(resetMetaProgress(storage)).toEqual({
      unlockedRoles: ['bystander'],
      unlockedEndings: [],
      achievements: [],
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
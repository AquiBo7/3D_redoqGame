import { describe, expect, it } from 'vitest';
import type { BooleanStateKey, Condition, NumericStateKey, StoryEffect, StoryVariables } from '../data/storySchema';
import {
  applyStoryEffect,
  createInitialMetaProgress,
  createInitialStoryState,
  evaluateCondition,
} from './state';
import type { StoryState } from './state';

function apply(state: StoryState, effect: StoryEffect): ReturnType<typeof applyStoryEffect> {
  return applyStoryEffect(state, effect, 'S1', 123456);
}

describe('createInitialStoryState', () => {
  it('初始化执行总纲 2.1 全部字段及楼梯间访问标记', () => {
    expect(createInitialStoryState()).toEqual({
      newsSeen: false,
      helpedPasserby: false,
      momReply: null,
      phoneIgnored: 0,
      seenBag: false,
      seenHandoff: false,
      noticedTyper: false,
      handedPen: false,
      reasonText: null,
      seenCrossedOut: false,
      picked: false,
      seenFatherWatching: false,
      noticedPhoneBehind: false,
      noticedPhoto: false,
      likedPhoto: false,
      roommateReply: null,
      pointedOut: false,
      canteenSeen: 0,
      postChoice: null,
      addedHer: false,
      listened: false,
      evidence: false,
      seat: null,
      teacherTalked: false,
      tellTeacher: null,
      visitedStairwell: false,
      askedAboutFather: false,
      fatherKnows: false,
      clues: [],
      wrongAsks: 0,
      foundAyuanWay: null,
      yuanState: null,
      yuanScore: 0,
      yuanKeys: [],
      route: null,
      postDeleted: false,
      joined: false,
      phrase: null,
      stage1Tries: 0,
      crystalHits: 0,
      kills: 0,
      helpedByAyuan: false,
      apologized: false,
      soloRepair: false,
      trust: 0,
      harm: 20,
      ending: null,
      finalAnswer: null,
      draftReactions: [],
      log: [],
    });
  });

  it('多周目元数据默认只解锁旁观者', () => {
    expect(createInitialMetaProgress()).toEqual({
      unlockedRoles: ['bystander'],
      unlockedEndings: [],
      achievements: [],
    });
  });
});

describe('序列条件', () => {
  it('精确匹配顺序和长度，不改变记录', () => {
    const state = { ...createInitialStoryState(), yuanKeys: ['fact', 'empathy', 'company'] };
    expect(evaluateCondition({ key: 'yuanKeys', matches: ['fact', 'empathy', 'company'] }, state, 'bystander')).toBe(true);
    expect(evaluateCondition({ key: 'yuanKeys', matches: ['empathy', 'fact', 'company'] }, state, 'bystander')).toBe(false);
    expect(evaluateCondition({ key: 'yuanKeys', matches: ['fact', 'empathy'] }, state, 'bystander')).toBe(false);
    expect(state.yuanKeys).toEqual(['fact', 'empathy', 'company']);
  });

  it('集合条件允许重复正向类型，拒绝夹杂逼迫或干扰', () => {
    const condition: Condition = { key: 'yuanKeys', only: ['fact', 'empathy', 'company'] };
    for (const keys of [['fact', 'fact', 'company'], ['empathy', 'company']]) {
      expect(evaluateCondition(condition, { ...createInitialStoryState(), yuanKeys: keys }, 'bystander')).toBe(true);
    }
    for (const keys of [['fact', 'force', 'company'], ['noise', 'fact', 'company']]) {
      expect(evaluateCondition(condition, { ...createInitialStoryState(), yuanKeys: keys }, 'bystander')).toBe(false);
    }
    expect(evaluateCondition({ key: 'clues', matches: [] }, createInitialStoryState(), 'bystander')).toBe(true);
  });
});

describe('变量数组隔离', () => {
  it('每次创建状态与元数据都生成独立数组', () => {
    const first = createInitialStoryState();
    const second = createInitialStoryState();
    first.clues.push('07:52 小票');
    first.yuanKeys.push('fact');
    first.log.push({ timestamp: 1, sceneId: 'C5', type: 'observe', summary: '记下一条线索。' });
    expect(second).toEqual(createInitialStoryState());

    const meta = createInitialMetaProgress();
    meta.achievements.push('A1');
    meta.unlockedRoles.push('victim');
    meta.unlockedEndings.push('best');
    expect(createInitialMetaProgress()).toEqual({
      unlockedRoles: ['bystander'], unlockedEndings: [], achievements: [],
    });
  });
});

describe('applyStoryEffect', () => {
  it('应用 set / add 并返回被修改字段', () => {
    const initial = createInitialStoryState();
    const result = apply(initial, {
      set: {
        momReply: '起了起了。',
        seenBag: true,
        handedPen: true,
        reasonText: '起晚了',
      },
      add: { trust: 2, phoneIgnored: 1, harm: -3 },
    });

    expect(result.state.momReply).toBe('起了起了。');
    expect(result.state.seenBag).toBe(true);
    expect(result.state.handedPen).toBe(true);
    expect(result.state.reasonText).toBe('起晚了');
    expect(result.state.trust).toBe(2);
    expect(result.state.phoneIgnored).toBe(1);
    expect(result.state.harm).toBe(17);
    expect(result.changedKeys).toEqual(
      expect.arrayContaining(['momReply', 'seenBag', 'handedPen', 'reasonText', 'trust', 'phoneIgnored', 'harm']),
    );
  });

  it('追加结构化 log（时间戳 / 场景 / 类型 / 摘要）', () => {
    const result = apply(createInitialStoryState(), {
      log: [
        { type: 'choice', summary: '把笔递给了林夏。' },
        { type: 'observe', summary: '注意到爸爸提着两个大袋子。' },
      ],
    });

    expect(result.state.log).toEqual([
      { timestamp: 123456, sceneId: 'S1', type: 'choice', summary: '把笔递给了林夏。' },
      { timestamp: 123456, sceneId: 'S1', type: 'observe', summary: '注意到爸爸提着两个大袋子。' },
    ]);
    expect(result.changedKeys).toEqual(['log']);
  });

  it('不修改传入的旧状态', () => {
    const initial = createInitialStoryState();
    const result = apply(initial, { set: { picked: true }, log: { type: 'choice', summary: '捡起药袋。' } });

    expect(initial.picked).toBe(false);
    expect(initial.log).toHaveLength(0);
    expect(result.state).not.toBe(initial);
    expect(result.state.log).not.toBe(initial.log);
  });

  it('无变化时返回原状态引用与空变更列表', () => {
    const initial = createInitialStoryState();
    const result = apply(initial, {
      set: { seenBag: false },
      add: { trust: 0, phoneIgnored: 0 },
    });

    expect(result.state).toBe(initial);
    expect(result.changedKeys).toEqual([]);
  });

  it('set 支持所有非 log 变量，包括数值初始化和数组赋值', () => {
    const set: StoryVariables = {
      newsSeen: true, helpedPasserby: true,
      momReply: '马上出门。', phoneIgnored: 1, seenBag: true, seenHandoff: true,
      noticedTyper: true, handedPen: true, reasonText: '起晚了', seenCrossedOut: true,
      picked: true, seenFatherWatching: true, noticedPhoneBehind: true, noticedPhoto: true,
      likedPhoto: true, roommateReply: '先看完整。', pointedOut: true, canteenSeen: 2,
      postChoice: 'wait', addedHer: true, listened: true, evidence: true, seat: 'beside',
      teacherTalked: true, tellTeacher: 'ask_her', visitedStairwell: true,
      askedAboutFather: true, fatherKnows: true, clues: ['小票'], wrongAsks: 1,
      foundAyuanWay: 'relay', yuanState: 'hostile', yuanScore: -1, yuanKeys: ['fact'],
      route: 'team', postDeleted: true, joined: true, phrase: '一起想办法。',
      stage1Tries: 3, crystalHits: 4, kills: 20, helpedByAyuan: true,
      apologized: true, soloRepair: true, trust: 7, harm: 10, ending: 'best',
      finalAnswer: 'wrong', draftReactions: ['你先问了我。谢谢。'],
    };
    const result = apply(createInitialStoryState(), { set, add: { yuanScore: 2 } });
    expect(result.state).toEqual({ ...set, yuanScore: 1, log: [] });
    expect(result.changedKeys.sort()).toEqual(Object.keys(set).sort());
    expect(result.state.clues).not.toBe(set.clues);
    expect(result.state.yuanKeys).not.toBe(set.yuanKeys);
    expect(result.state.draftReactions).not.toBe(set.draftReactions);
  });

  it('pushDraftReaction 去重保序且隔离数组', () => {
    const first = apply(createInitialStoryState(), {
      pushDraftReaction: ['那天，我看到有人点开了我的头像。', '你先问了我。谢谢。', '那天，我看到有人点开了我的头像。'],
    });
    expect(first.state.draftReactions).toEqual([
      '那天，我看到有人点开了我的头像。',
      '你先问了我。谢谢。',
    ]);
    expect(first.changedKeys).toEqual(['draftReactions']);
    const dup = apply(first.state, { pushDraftReaction: '你先问了我。谢谢。' });
    expect(dup.state).toBe(first.state);
    expect(dup.changedKeys).toEqual([]);
  });

  it('所有数值均可通过 add 增减，先 set 再 add 且不截断剧情阈值', () => {
    const increments: Record<NumericStateKey, number> = {
      phoneIgnored: 2, canteenSeen: 5, wrongAsks: 9, yuanScore: -2,
      stage1Tries: 6, crystalHits: 12, kills: 25, trust: 7, harm: -80,
    };
    const result = apply(createInitialStoryState(), { add: increments });
    for (const key of Object.keys(increments) as NumericStateKey[]) {
      expect(result.state[key]).toBe(createInitialStoryState()[key] + increments[key]);
    }
    expect(result.changedKeys.sort()).toEqual(Object.keys(increments).sort());
    expect(result.state.evidence).toBe(false);
    expect(result.state.route).toBeNull();
    expect(result.state.ending).toBeNull();
  });

  it('支持将字符串、枚举与布尔变量重置为 null / false', () => {
    const initial = apply(createInitialStoryState(), {
      set: { postChoice: 'explain', roommateReply: '看看吧。', ending: 'best', visitedStairwell: true },
    }).state;
    expect(apply(initial, {
      set: { postChoice: null, roommateReply: null, ending: null, visitedStairwell: false },
    }).state).toEqual(createInitialStoryState());
  });

  it('pushClue 去重且保留首次顺序，重复线索不产生变更', () => {
    const clues = ['小票', '橙色手机壳', '小票'];
    const first = apply(createInitialStoryState(), { pushClue: clues });
    const second = apply(first.state, { pushClue: '台阶背影' });
    expect(second.state.clues).toEqual(['小票', '橙色手机壳', '台阶背影']);
    expect(first.state.clues).toEqual(['小票', '橙色手机壳']);
    expect(clues).toEqual(['小票', '橙色手机壳', '小票']);
    expect(second.changedKeys).toEqual(['clues']);
    const duplicate = apply(second.state, { pushClue: ['小票', '台阶背影'] });
    expect(duplicate).toEqual({ state: second.state, changedKeys: [] });
    expect(duplicate.state).toBe(second.state);
  });

  it('pushYuanKey 保留三轮顺序与重复类型，不自动判定路线', () => {
    let state = createInitialStoryState();
    for (const key of ['fact', 'fact', 'company', 'force']) {
      const result = apply(state, { pushYuanKey: key });
      expect(result.changedKeys).toEqual(['yuanKeys']);
      state = result.state;
    }
    expect(state.yuanKeys).toEqual(['fact', 'fact', 'company', 'force']);
    expect(state.route).toBeNull();
    expect(state.ending).toBeNull();
    expect(state.harm).toBe(20);
  });

  it('set 与 push 同时应用时不污染效果数组，并复制未修改的数组与日志条目', () => {
    const initial = apply(createInitialStoryState(), {
      pushClue: '原线索', pushYuanKey: 'empathy', log: { type: 'system', summary: '进入对峙。' },
    }).state;
    const clues = ['新线索'];
    const yuanKeys = ['fact'];
    const result = apply(initial, { set: { clues, yuanKeys }, pushClue: '小票', pushYuanKey: 'company' });
    expect(result.state.clues).toEqual(['新线索', '小票']);
    expect(result.state.yuanKeys).toEqual(['fact', 'company']);
    expect(result.changedKeys).toEqual(['clues', 'yuanKeys']);
    expect(clues).toEqual(['新线索']);
    expect(yuanKeys).toEqual(['fact']);
    expect(initial.clues).toEqual(['原线索']);
    expect(initial.yuanKeys).toEqual(['empathy']);

    const copied = apply(initial, { add: { trust: 1 } }).state;
    copied.clues.push('其他线索');
    copied.yuanKeys.push('noise');
    copied.log[0].summary = '修改副本';
    expect(initial.clues).toEqual(['原线索']);
    expect(initial.yuanKeys).toEqual(['empathy']);
    expect(initial.log[0].summary).toBe('进入对峙。');
  });

  it('未提供效果时直接返回原状态', () => {
    const initial = createInitialStoryState();
    const result = applyStoryEffect(initial, undefined, 'S1', 1);
    expect(result.state).toBe(initial);
    expect(result.changedKeys).toEqual([]);
  });
});

describe('evaluateCondition', () => {
  const state: StoryState = {
    ...createInitialStoryState(),
    phoneIgnored: 2,
    trust: 3,
    harm: 10,
    momReply: '马上出门。',
    seenBag: true,
  };

  const cases: Array<[string, Condition | undefined, boolean]> = [
    ['未配置条件视为通过', undefined, true],
    ['all 全真', { all: [{ key: 'seenBag', equals: true }, { key: 'trust', op: '>=', value: 3 }] }, true],
    ['all 有假', { all: [{ key: 'seenBag', equals: true }, { key: 'phoneIgnored', op: '>', value: 5 }] }, false],
    ['any 有真', { any: [{ key: 'picked', equals: true }, { key: 'trust', op: '>', value: 0 }] }, true],
    ['any 全假', { any: [{ key: 'picked', equals: true }, { key: 'phoneIgnored', op: '<', value: 0 }] }, false],
    ['not 取反', { not: { key: 'picked', equals: true } }, true],
    ['角色匹配字符串', { role: 'bystander' }, true],
    ['角色匹配数组', { role: ['victim', 'bystander'] }, true],
    ['角色不匹配', { role: 'perpetrator' }, false],
    ['数值 >', { key: 'phoneIgnored', op: '>', value: 1 }, true],
    ['数值 >=', { key: 'phoneIgnored', op: '>=', value: 2 }, true],
    ['数值 ==', { key: 'harm', op: '==', value: 10 }, true],
    ['数值 !=', { key: 'harm', op: '!=', value: 10 }, false],
    ['数值 <=', { key: 'trust', op: '<=', value: 3 }, true],
    ['数值 <', { key: 'trust', op: '<', value: 3 }, false],
    ['字符串 ==', { key: 'momReply', op: '==', value: '马上出门。' }, true],
    ['字符串 !=', { key: 'momReply', op: '!=', value: null }, true],
    ['布尔不匹配', { key: 'seenBag', equals: false }, false],
  ];

  it.each(cases)('%s', (_name, condition, expected) => {
    expect(evaluateCondition(condition, state, 'bystander')).toBe(expected);
  });

  const newBooleans: BooleanStateKey[] = [
    'newsSeen', 'helpedPasserby',
    'noticedPhoneBehind', 'noticedPhoto', 'likedPhoto', 'pointedOut', 'addedHer', 'listened',
    'evidence', 'teacherTalked', 'visitedStairwell', 'askedAboutFather', 'fatherKnows',
    'postDeleted', 'joined', 'helpedByAyuan', 'apologized', 'soloRepair',
  ];
  it.each(newBooleans)('支持新增布尔条件 %s', (key) => {
    expect(evaluateCondition({ key, equals: true }, { ...state, [key]: true }, 'bystander')).toBe(true);
    expect(evaluateCondition({ key, equals: false }, { ...state, [key]: true }, 'bystander')).toBe(false);
  });

  const newStrings: Condition[] = [
    { key: 'roommateReply', op: '==', value: '先看完整。' },
    { key: 'postChoice', op: '==', value: 'wait' },
    { key: 'seat', op: '==', value: 'far' },
    { key: 'tellTeacher', op: '==', value: 'think' },
    { key: 'foundAyuanWay', op: '==', value: 'recognize' },
    { key: 'yuanState', op: '==', value: 'guarded' },
    { key: 'route', op: '==', value: 'deleteOnly' },
    { key: 'phrase', op: '==', value: '一起想办法。' },
    { key: 'ending', op: '==', value: 'middle' },
    { key: 'finalAnswer', op: '==', value: 'tired' },
  ];
  it.each(newStrings)('支持新增字符串 / 枚举条件 $key', (condition) => {
    if (!('key' in condition) || !('value' in condition)) throw new Error('应为字符串条件');
    expect(evaluateCondition(condition, { ...state, [condition.key]: condition.value }, 'bystander')).toBe(true);
    expect(evaluateCondition(condition, state, 'bystander')).toBe(false);
  });

  const newNumbers: NumericStateKey[] = ['canteenSeen', 'wrongAsks', 'yuanScore', 'stage1Tries', 'crystalHits', 'kills'];
  it.each(newNumbers)('支持新增数值条件 %s', (key) => {
    expect(evaluateCondition({ key, op: '>=', value: 3 }, { ...state, [key]: 3 }, 'bystander')).toBe(true);
    expect(evaluateCondition({ key, op: '<', value: 3 }, { ...state, [key]: 3 }, 'bystander')).toBe(false);
  });

  it('旁观线三条件可由数据组合，但求值不自动设置结局', () => {
    const state = apply(createInitialStoryState(), { set: { seat: 'far', tellTeacher: 'think' } }).state;
    const condition: Condition = { all: [
      { key: 'seat', op: '==', value: 'far' },
      { key: 'tellTeacher', op: '==', value: 'think' },
      { key: 'visitedStairwell', equals: false },
    ] };
    expect(evaluateCondition(condition, state, 'bystander')).toBe(true);
    expect(evaluateCondition(condition, { ...state, visitedStairwell: true }, 'bystander')).toBe(false);
    expect(state.ending).toBeNull();
  });

  it.each([1, 3, 5, 7])('信任阈值 %i 只参与显式条件计算，不推导剧情', (threshold) => {
    const initial = createInitialStoryState();
    const state = apply(initial, { set: { picked: true }, add: { trust: threshold } }).state;
    const condition: Condition = { key: 'trust', op: '>=', value: threshold };
    expect(evaluateCondition(condition, state, 'bystander')).toBe(true);
    expect(evaluateCondition(condition, { ...state, trust: threshold - 1 }, 'bystander')).toBe(false);
    expect(state).toEqual({ ...initial, picked: true, trust: threshold });
  });
});
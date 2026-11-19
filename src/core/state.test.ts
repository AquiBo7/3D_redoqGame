import { describe, expect, it } from 'vitest';
import type { Condition, StoryEffect } from '../data/storySchema';
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
  it('初始化 GDD 第 7 节的 13 个字段', () => {
    expect(createInitialStoryState()).toEqual({
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
      trust: 0,
      harm: 20,
      log: [],
    });
  });

  it('多周目元数据默认只解锁旁观者', () => {
    expect(createInitialMetaProgress()).toEqual({
      unlockedRoles: ['bystander'],
      unlockedEndings: [],
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
});
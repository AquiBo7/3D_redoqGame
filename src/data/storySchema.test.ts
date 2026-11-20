import { describe, expect, expectTypeOf, it } from 'vitest';
import { isSceneId, SCENE_IDS } from './storySchema';
import type {
  ChapterStory, Condition, NumericStateKey, PhoneSection, SceneDef, SceneId, SceneKey,
  SpeakerId, StateSet, StoryStep, StoryVariables,
} from './storySchema';
import type { StoryState } from '../core/state';

// 只验证类型契约，不执行后续阶段尚未实现的步骤。
describe('全五章 schema 契约', () => {
  it('声明完整的 27 个节点并拒绝其他节点', () => {
    expect(SCENE_IDS).toEqual([
      'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12', 'S13', 'S14',
      'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'E1',
    ]);
    expect(new Set(SCENE_IDS).size).toBe(27);
    for (const id of SCENE_IDS) expect(isSceneId(id)).toBe(true);
    for (const id of ['S0', 'S15', 'C7', 'D7', 'E2', 's1', 1, null]) expect(isSceneId(id)).toBe(false);
  });

  it('保留八种场景、九位说话人，场景可缺省而角色必须完整', () => {
    expectTypeOf<SceneKey>().toEqualTypeOf<
      'room' | 'street' | 'gate' | 'desk' | 'building' | 'canteen' | 'interior' | 'stage2d'
    >();
    expectTypeOf<SpeakerId>().toEqualTypeOf<
      'linxia' | 'father' | 'volunteer' | 'mom' | 'xiaochen' | 'ayuan' | 'teacher' | 'admin' | 'passerby'
    >();
    expectTypeOf<ChapterStory['scenes']>().toEqualTypeOf<Partial<Record<SceneId, SceneDef>>>();
    expectTypeOf<ChapterStory['characters']>().toEqualTypeOf<Record<SpeakerId, { name: string }>>();
  });

  it('变量为 schema 单一来源，set 覆盖全部变量且不允许写 log', () => {
    expectTypeOf<Omit<StoryState, 'log'>>().toEqualTypeOf<StoryVariables>();
    expectTypeOf<StateSet>().toEqualTypeOf<Partial<StoryVariables>>();
    expectTypeOf<NumericStateKey>().toEqualTypeOf<
      'phoneIgnored' | 'canteenSeen' | 'wrongAsks' | 'yuanScore' | 'stage1Tries' | 'crystalHits' | 'kills' | 'trust' | 'harm'
    >();
    expectTypeOf<Extract<Condition, { key: 'postChoice' }>['value']>()
      .toEqualTypeOf<'explain' | 'wait' | 'joke' | null>();
  });

  it('支持字幕、双小游戏、美术展示与步骤跳转的最小及可选参数', () => {
    const steps: StoryStep[] = [
      { kind: 'intertitle', id: 'days', lines: ['几天后'] },
      { kind: 'intertitle', id: 'morning', lines: ['第二天'], lineDurationMs: 1200, skippable: true,
        when: { key: 'likedPhoto', equals: true }, effects: { add: { trust: 1 } } },
      { kind: 'minigame', id: 'bubble', game: 'bubble' },
      { kind: 'minigame', id: 'crystal', game: 'crystal', effects: { add: { crystalHits: 1 } } },
      { kind: 'art', id: 'receipt', assetId: 'prop_pharmacy_receipt' },
      { kind: 'goto', id: 'skip', target: 'next-step', when: { key: 'evidence', equals: true } },
    ];
    expect(steps.map((step) => step.kind)).toEqual(['intertitle', 'intertitle', 'minigame', 'minigame', 'art', 'goto']);
  });

  it('照片包含资源、可选热区及动作标识，本阶段不引入 post', () => {
    const minimal: PhoneSection = { kind: 'photo', id: 'album', title: '合照', assetId: 'future_asset' };
    const photo: PhoneSection = {
      ...minimal,
      hotspot: { x: 0.2, y: 0.4, width: 0.1, height: 0.15 },
      likeActionId: 'like-photo', noticeActionId: 'notice-photo',
    };
    expect(photo.hotspot?.width).toBe(0.1);
    expectTypeOf<PhoneSection['kind']>().toEqualTypeOf<'alarm' | 'chat' | 'memo' | 'notice' | 'photo'>();
  });
});

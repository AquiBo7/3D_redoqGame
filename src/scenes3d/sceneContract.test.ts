// scenes3d/sceneContract.test.ts —— 剧情数据与 3D 场景注册表的契约一致性校验
// 保证 wait 步骤 / 触发器的目标 id 真实存在于对应场景定义中，防止剧情推进死锁；
// 保证 cutscene key 均在过场播放器支持列表内。

import { describe, expect, it } from 'vitest';
import { chapter1 } from '../data/story';
import type { SceneId, SceneKey, StoryStep } from '../data/storySchema';
import { getSceneDefinition, getSceneRuntime } from './index';
import { CHARACTER_MODELS } from './modelManifest';

const SCENE_IDS: SceneId[] = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'];

/** 过场播放器支持的 key（与 CutscenePlayer 的 switch 分支保持一致） */
const SUPPORTED_CUTSCENE_KEYS = new Set(['s1-wake', 's3-run', 'school-gate-panorama']);

const EXPECTED_SCENE_KEYS: Record<SceneId, SceneKey> = {
  S1: 'room',
  S2: 'room',
  S3: 'room',
  S4: 'street',
  S5: 'gate',
  S6: 'gate',
  S7: 'desk',
  S8: 'building',
  S9: 'building',
};

describe('剧情数据 ↔ 3D 场景注册表契约', () => {
  it('每个 sceneId 的 sceneKey 与故事数据一致', () => {
    for (const sceneId of SCENE_IDS) {
      expect(getSceneDefinition(sceneId).sceneKey).toBe(chapter1.scenes[sceneId].sceneKey);
      expect(getSceneDefinition(sceneId).sceneKey).toBe(EXPECTED_SCENE_KEYS[sceneId]);
    }
  });

  it('同一 sceneKey 的 sceneId 共享同一 build 函数（切场景不重建几何体）', () => {
    expect(getSceneDefinition('S1').build).toBe(getSceneDefinition('S2').build);
    expect(getSceneDefinition('S2').build).toBe(getSceneDefinition('S3').build);
    expect(getSceneDefinition('S5').build).toBe(getSceneDefinition('S6').build);
    expect(getSceneDefinition('S8').build).toBe(getSceneDefinition('S9').build);
  });

  it('wait 步骤的 interactId 存在于对应场景的 interactables 中', () => {
    for (const sceneId of SCENE_IDS) {
      const scene = chapter1.scenes[sceneId];
      const definition = getSceneDefinition(sceneId);
      const interactableIds = new Set((definition.interactables ?? []).map((item) => item.id));

      for (const step of scene.steps) {
        if (step.kind !== 'wait' || !('interactId' in step.waitFor)) continue;
        expect(interactableIds.has(step.waitFor.interactId), `场景 ${sceneId} 缺少交互物`).toBe(true);
      }
    }
  });

  it('wait 步骤的 zoneId 存在于对应场景的 zones 中', () => {
    for (const sceneId of SCENE_IDS) {
      const scene = chapter1.scenes[sceneId];
      const definition = getSceneDefinition(sceneId);
      const zoneIds = new Set((definition.zones ?? []).map((item) => item.id));

      for (const step of scene.steps) {
        if (step.kind !== 'wait' || !('zoneId' in step.waitFor)) continue;
        expect(zoneIds.has(step.waitFor.zoneId), `场景 ${sceneId} 缺少区域`).toBe(true);
      }
    }
  });

  it('gazeHotspot / interact 触发器的 target 存在于对应场景定义中', () => {
    for (const sceneId of SCENE_IDS) {
      const scene = chapter1.scenes[sceneId];
      const definition = getSceneDefinition(sceneId);
      const hotspotIds = new Set((definition.hotspots ?? []).map((item) => item.id));
      const interactableIds = new Set((definition.interactables ?? []).map((item) => item.id));

      for (const trigger of scene.triggers ?? []) {
        if (trigger.event === 'scene:gazeHotspot') {
          expect(hotspotIds.has(trigger.target ?? ''), `场景 ${sceneId} 缺少热点 ${trigger.target}`).toBe(
            true,
          );
        } else if (trigger.event === 'scene:interact') {
          expect(
            interactableIds.has(trigger.target ?? ''),
            `场景 ${sceneId} 缺少交互物 ${trigger.target}`,
          ).toBe(true);
        }
      }
    }
  });

  it('所有 cutscene 步骤的 key 均在过场播放器支持列表内', () => {
    for (const sceneId of SCENE_IDS) {
      for (const step of chapter1.scenes[sceneId].steps) {
        if (step.kind !== 'cutscene') continue;
        expect(SUPPORTED_CUTSCENE_KEYS.has(step.key), `不支持的过场 key：${step.key}`).toBe(true);
      }
    }
  });

  it('S6 开场 CG 具备全景锚点且可跳过', () => {
    const s6 = chapter1.scenes.S6;
    const cgStep = s6.steps.find(
      (step): step is Extract<StoryStep, { kind: 'cutscene' }> =>
        step.kind === 'cutscene' && step.key === 'school-gate-panorama',
    );
    expect(cgStep?.skippable).toBe(true);
    expect(getSceneDefinition('S6').panoramaAnchor).toBeDefined();
  });

  it('S7 药袋交互物与剧情触发器一一对应，且 desk 运行时存在', () => {
    const definition = getSceneDefinition('S7');
    expect((definition.interactables ?? []).some((item) => item.id === 'medicine-bag')).toBe(true);

    const s7 = chapter1.scenes.S7;
    const trigger = s7.triggers?.find((item) => item.id === 's7-medicine-bag');
    expect(trigger?.event).toBe('scene:interact');
    expect(trigger?.target).toBe('medicine-bag');

    expect(getSceneRuntime('S7')).not.toBeNull();
  });

  it('运行时装按 sceneKey 共享实例（同 key 的 sceneId 返回同一运行时）', () => {
    expect(getSceneRuntime('S5')).toBe(getSceneRuntime('S6'));
    expect(getSceneRuntime('S8')).toBe(getSceneRuntime('S9'));
    expect(getSceneRuntime('S4')).not.toBe(getSceneRuntime('S7'));
  });

  it('requiredModels 只引用角色清单内的模型 id', () => {
    const known = new Set(CHARACTER_MODELS.map((entry) => entry.id));
    for (const sceneId of SCENE_IDS) {
      for (const id of getSceneDefinition(sceneId).requiredModels ?? []) {
        expect(known.has(id), `场景 ${sceneId} 引用了未知角色模型 ${id}`).toBe(true);
      }
    }
  });

  it('首屏房间零角色预载，户外场景按锁定映射声明角色', () => {
    for (const sceneId of ['S1', 'S2', 'S3'] as const) {
      expect(getSceneDefinition(sceneId).requiredModels ?? []).toHaveLength(0);
    }
    expect(getSceneDefinition('S4').requiredModels).toEqual(['volunteer', 'ayuan']);
    expect(getSceneDefinition('S5').requiredModels).toEqual(['linxia', 'father', 'ayuan', 'volunteer']);
    expect(getSceneDefinition('S6').requiredModels).toEqual(['linxia', 'father', 'ayuan', 'volunteer']);
    expect(getSceneDefinition('S7').requiredModels).toEqual(['volunteer', 'linxia', 'father']);
    expect(getSceneDefinition('S8').requiredModels).toEqual(['linxia', 'father']);
    expect(getSceneDefinition('S9').requiredModels).toEqual(['linxia', 'father']);
  });
});

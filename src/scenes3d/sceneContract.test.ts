// scenes3d/sceneContract.test.ts —— 剧情数据与 3D 场景注册表的契约一致性校验
// 保证 wait 步骤 / 触发器的目标 id 真实存在于对应场景定义中，防止剧情推进死锁；
// 保证 cutscene key 均在过场播放器支持列表内。

import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { posePiggybackPassenger } from './characterAnimation';
import { chapter1 } from '../data/story';
import type { SceneId, SceneKey, StoryStep } from '../data/storySchema';
import { getSceneDefinition, getSceneRuntime, prepareSceneModule } from './index';
import { CHARACTER_MODELS } from './modelManifest';

const configuredSceneIds = Object.keys(chapter1.scenes) as SceneId[];

function sceneOf(sceneId: SceneId) {
  const scene = chapter1.scenes[sceneId];
  expect(scene, `缺少已配置场景 ${sceneId}`).toBeDefined();
  return scene!;
}

/** 过场播放器支持的 key（与 CutscenePlayer 的 switch 分支保持一致） */
const SUPPORTED_CUTSCENE_KEYS = new Set(['s1-wake', 's3-run', 'school-gate-panorama', 'platform-approach']);

const EXPECTED_SCENE_KEYS: Partial<Record<SceneId, SceneKey>> = {
  S1: 'room',
  S2: 'room',
  S3: 'room',
  S4: 'street',
  S5: 'gate',
  S6: 'gate',
  S7: 'desk',
  S8: 'building',
  S9: 'building',
  S10: 'stage2d', S11: 'stage2d', S12: 'canteen', S13: 'canteen',
  S14: 'stage2d', C1: 'stage2d', E1: 'stage2d',
  C2: 'interior', C3: 'interior', C4: 'interior', C5: 'interior', C6: 'interior',
  D1: 'interior', D2: 'stage2d', D3: 'stage2d', D4: 'stage2d', D5: 'stage2d', D6: 'interior',
};

beforeAll(async () => {
  await Promise.all(configuredSceneIds.map(prepareSceneModule));
});

describe('背负姿态', () => {
  it('模型仍在占位时等待骨骼加载', () => {
    expect(posePiggybackPassenger(new THREE.Group())).toBe(false);
  });

  it.each([0, Math.PI, -1.2])('朝向 %f 下屈膝抱肩且不改变共享母本', (yaw) => {
    const template = new THREE.Group();
    for (const [base, middle, tip, side] of [
      ['L_Thigh', 'L_Calf', 'L_Foot', -1],
      ['R_Thigh', 'R_Calf', 'R_Foot', 1],
      ['L_Upperarm', 'L_Forearm', 'L_Hand', -1],
      ['R_Upperarm', 'R_Forearm', 'R_Hand', 1],
    ] as const) {
      const joint = new THREE.Bone();
      joint.name = base;
      joint.position.set(side * 0.2, base.includes('Thigh') ? 0.8 : 1.3, 0);
      joint.rotation.set(0.3, -0.2, 0.15);
      const elbow = new THREE.Bone();
      elbow.name = middle;
      elbow.position.y = -0.3;
      const end = new THREE.Bone();
      end.name = tip;
      end.position.y = -0.3;
      elbow.add(end);
      joint.add(elbow);
      template.add(joint);
    }
    const instance = template.clone(true);
    instance.rotation.y = yaw;
    instance.position.set(2, 0.42, -3);
    instance.scale.setScalar(1.7);
    const before = template.children.map((bone) => bone.quaternion.clone());
    expect(posePiggybackPassenger(instance)).toBe(true);
    for (const [base, tip, target] of [
      ['L_Thigh', 'L_Calf', new THREE.Vector3(-0.38, -0.35, 0.85)],
      ['R_Thigh', 'R_Calf', new THREE.Vector3(0.38, -0.35, 0.85)],
      ['L_Calf', 'L_Foot', new THREE.Vector3(0, -0.95, -0.3)],
      ['R_Calf', 'R_Foot', new THREE.Vector3(0, -0.95, -0.3)],
      ['L_Upperarm', 'L_Forearm', new THREE.Vector3(-0.1, -0.18, 0.98)],
      ['R_Upperarm', 'R_Forearm', new THREE.Vector3(0.1, -0.18, 0.98)],
    ] as const) {
      const direction = instance.getObjectByName(tip)!.getWorldPosition(new THREE.Vector3())
        .sub(instance.getObjectByName(base)!.getWorldPosition(new THREE.Vector3())).normalize();
      expect(direction.dot(target.clone().transformDirection(instance.matrixWorld))).toBeCloseTo(1, 8);
    }
    expect(instance.position.toArray()).toEqual([2, 0.42, -3]);
    expect(instance.rotation.y).toBe(yaw);
    template.children.forEach((bone, index) => expect(bone.quaternion.equals(before[index])).toBe(true));
  });
});

describe('剧情数据 ↔ 3D 场景注册表契约', () => {
  it('每个 sceneId 的 sceneKey 与故事数据一致', () => {
    for (const sceneId of configuredSceneIds) {
      expect(getSceneDefinition(sceneId).sceneKey).toBe(sceneOf(sceneId).sceneKey);
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
    for (const sceneId of configuredSceneIds) {
      const scene = sceneOf(sceneId);
      const definition = getSceneDefinition(sceneId);
      const interactableIds = new Set((definition.interactables ?? []).map((item) => item.id));

      for (const step of scene.steps) {
        if (step.kind !== 'wait' || !('interactId' in step.waitFor)) continue;
        expect(interactableIds.has(step.waitFor.interactId), `场景 ${sceneId} 缺少交互物`).toBe(true);
      }
    }
  });

  it('wait 步骤的 zoneId 存在于对应场景的 zones 中', () => {
    for (const sceneId of configuredSceneIds) {
      const scene = sceneOf(sceneId);
      const definition = getSceneDefinition(sceneId);
      const zoneIds = new Set((definition.zones ?? []).map((item) => item.id));

      for (const step of scene.steps) {
        if (step.kind !== 'wait' || !('zoneId' in step.waitFor)) continue;
        expect(zoneIds.has(step.waitFor.zoneId), `场景 ${sceneId} 缺少区域`).toBe(true);
      }
    }
  });

  it('gazeHotspot / interact 触发器的 target 存在于对应场景定义中', () => {
    for (const sceneId of configuredSceneIds) {
      const scene = sceneOf(sceneId);
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
    for (const sceneId of configuredSceneIds) {
      for (const step of sceneOf(sceneId).steps) {
        if (step.kind !== 'cutscene') continue;
        expect(SUPPORTED_CUTSCENE_KEYS.has(step.key), `不支持的过场 key：${step.key}`).toBe(true);
      }
    }
  });

  it('S6 开场 CG 具备全景锚点且可跳过', () => {
    const s6 = sceneOf('S6');
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

    const s7 = sceneOf('S7');
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

  it('校园美术保留校门与教学楼的导航和观察契约', () => {
    const gate = getSceneDefinition('S5');
    const building = getSceneDefinition('S8');
    expect(gate.spawn).toEqual({ x: 0, z: 7.6, yaw: 0, pitchDeg: -4 });
    expect(gate.nav.bounds).toEqual({ minX: -5.6, maxX: 5.6, minZ: -5.5, maxZ: 8.6 });
    expect(gate.nav.obstacles.map((item) => item.id)).toEqual([
      'gate-column-0', 'gate-column-1', 'gate-column-2',
      'gate-crowd-0', 'gate-crowd-1', 'gate-crowd-2', 'gate-crowd-3', 'gate-typer',
    ]);
    expect(gate.hotspots?.map(({ id, position }) => ({ id, position }))).toEqual([
      { id: 'typer', position: { x: -3.6, y: 1.35, z: 7.95 } },
      { id: 'handoff-moment', position: { x: -0.45, y: 1.45, z: 2.45 } },
      { id: 'father-bags', position: { x: -0.55, y: 0.6, z: 0.7 } },
      { id: 'guard-steps', position: { x: -5.85, y: 1.45, z: -1.65 } },
    ]);
    expect(gate.panoramaAnchor).toEqual({
      position: { x: 0, y: 3.6, z: 5.6 }, lookAt: { x: 0, y: 1.7, z: 1.4 },
    });
    expect(building.nav.bounds).toEqual({ minX: -5.8, maxX: 5.8, minZ: -49.2, maxZ: 9 });
    expect(building.hotspots?.map((hotspot) => hotspot.id)).toEqual(['look-back-father', 'phone-behind']);
    expect(building.hotspots?.find((hotspot) => hotspot.id === 'look-back-father')).toEqual({
      id: 'look-back-father', position: { x: 0, y: 1.5, z: 8.6 },
      maxDistance: 45, maxAngleDeg: 12, requireLineOfSight: false,
    });
    expect(building.hotspots?.find((hotspot) => hotspot.id === 'phone-behind')).toEqual({
      id: 'phone-behind', position: {
        x: 6.45 + Math.sin(-2.58) * 0.3,
        y: -0.055 + 0.9 + 0.325,
        z: -10 + Math.cos(-2.58) * 0.3,
      },
      maxDistance: 9, maxAngleDeg: 12, dwellMs: 2000, requireLineOfSight: true,
    });
    expect(building.zones).toEqual([{
      id: 'building-entrance', kind: 'box', center: { x: 0, y: 0.9, z: -46 },
      size: { x: 7, y: 3.6, z: 5 },
    }]);
  });

  it('台阶逐级抬升，台顶与门后平台连续；出口与脚步配置不耦合剧情', async () => {
    const { sampleGroundHeight } = await import('../world/navMath');
    const gate = getSceneDefinition('S5');
    for (let step = 0; step < 6; step += 1) {
      expect(sampleGroundHeight({ x: 0, z: 6 - (step + 0.5) * 0.55 }, gate.nav.surfaces)).toBeCloseTo((step + 1) * 0.07);
    }
    for (const z of [2.45, 1.2, 0, -5]) {
      expect(sampleGroundHeight({ x: 0, z }, gate.nav.surfaces)).toBeCloseTo(0.42);
    }
    expect(getSceneDefinition('S3').exitAnchor?.stopDistance).toBeGreaterThan(0);
    expect(getSceneDefinition('S1').footstepSurface).toBe('wood');
    expect(gate.footstepActors).toContain('carryGroup');
    expect(getSceneDefinition('S8').footstepActors).toContain('linxia');
  });

  it('requiredModels 只引用角色清单内的模型 id', () => {
    const known = new Set(CHARACTER_MODELS.map((entry) => entry.id));
    for (const sceneId of configuredSceneIds) {
      for (const id of getSceneDefinition(sceneId).requiredModels ?? []) {
        expect(known.has(id), `场景 ${sceneId} 引用了未知角色模型 ${id}`).toBe(true);
      }
    }
  });

  it('首屏房间零角色预载，户外场景按锁定映射声明角色', () => {
    for (const sceneId of ['S1', 'S2', 'S3'] as const) {
      expect(getSceneDefinition(sceneId).requiredModels ?? []).toHaveLength(0);
    }
    expect(getSceneDefinition('S4').requiredModels).toEqual([
      'studentMale', 'studentFemale', 'studentMale2', 'studentMale3', 'studentMale4', 'studentMale5', 'studentFemale1', 'studentFemale2', 'studentFemale3', 'studentFemale4',
    ]);
    expect(getSceneDefinition('S5').requiredModels).toEqual([
      'linxia', 'fatherCarry', 'ayuan', 'studentFemale', 'studentMale', 'studentMale2', 'studentMale3', 'studentFemale3', 'studentFemale4', 'securityGuard',
    ]);
    expect(getSceneDefinition('S6').requiredModels).toEqual([
      'linxia', 'fatherCarry', 'ayuan', 'studentFemale', 'studentMale', 'studentMale2', 'studentMale3', 'studentFemale3', 'studentFemale4', 'securityGuard',
    ]);
    expect(getSceneDefinition('S7').requiredModels).toEqual(['studentFemale2', 'linxia', 'father', 'studentFemale', 'studentMale']);
    expect(getSceneDefinition('S8').requiredModels).toEqual(['linxia', 'father', 'studentFemale', 'studentMale']);
    expect(getSceneDefinition('S9').requiredModels).toEqual(['linxia', 'father', 'studentFemale', 'studentMale']);
  });
});

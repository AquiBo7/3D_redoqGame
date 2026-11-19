// scenes3d/shared.test.ts —— 角色装填工厂契约：模型未预载时的胶囊体降级、外层朝向、手持道具与朝向计算
// 纯 Node 环境（无 WebGL、无浏览器），验证弱网 / 单测环境零报错兜底。

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createCharacterActor, yawToward } from './shared';

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
}

describe('createCharacterActor', () => {
  it.each(['linxia', 'father', 'fatherCarry', 'ayuan', 'studentFemale', 'studentMale', 'volunteer'] as const)('%s 占位与道具仅叙事主角投影，全员接收阴影', (id) => {
    const actor = createCharacterActor(id, 1.7, 0xffffff, { props: [{ kind: 'phone' }] });
    const expected = ['linxia', 'father', 'fatherCarry'].includes(id);
    for (const mesh of collectMeshes(actor)) {
      expect(mesh.castShadow).toBe(expected);
      expect(mesh.receiveShadow).toBe(true);
    }
  });

  it('可显式关闭主角投影且不影响接收阴影', () => {
    const actor = createCharacterActor('linxia', 1.62, 0xffffff, { castShadow: false, props: [{ kind: 'phone' }] });
    expect(collectMeshes(actor).every((mesh) => !mesh.castShadow && mesh.receiveShadow)).toBe(true);
  });

  it('模型未预载时回退胶囊体，不抛错且外层朝向默认 0（面向 +Z）', () => {
    const actor = createCharacterActor('linxia', 1.62, 0xd9c98f);
    expect(actor).toBeInstanceOf(THREE.Group);
    expect(actor.userData.actorModelId).toBe('linxia');
    expect(actor.rotation.y).toBe(0);
    // 胶囊体 = 身体 + 头，至少两个网格
    expect(collectMeshes(actor).length).toBeGreaterThanOrEqual(2);
  });

  it('外层 yaw 生效（π 面向 -Z），手持道具会挂载到姿态组', () => {
    const actor = createCharacterActor('ayuan', 1.68, 0x8f9aa3, {
      yaw: Math.PI,
      props: [{ kind: 'phone', color: 0xd98a4a }],
    });
    expect(actor.rotation.y).toBeCloseTo(Math.PI);
    // 胶囊体两个网格 + 手机方块
    expect(collectMeshes(actor).length).toBeGreaterThanOrEqual(3);
  });

  it('袋子道具与双手侧挂载（左右各一）', () => {
    const actor = createCharacterActor('father', 1.78, 0x8f8578, {
      yaw: Math.PI,
      props: [
        { kind: 'bag', side: 'left' },
        { kind: 'bag', side: 'right' },
      ],
    });
    const meshes = collectMeshes(actor);
    expect(meshes.length).toBeGreaterThanOrEqual(4);
    const bagXs = meshes
      .filter((mesh) => mesh.geometry instanceof THREE.BoxGeometry)
      .map((mesh) => mesh.position.x);
    expect(bagXs.some((x) => x < 0)).toBe(true);
    expect(bagXs.some((x) => x > 0)).toBe(true);
  });
});

describe('yawToward', () => {
  it('0 → +Z，π → -Z，π/2 → +X', () => {
    expect(yawToward({ x: 0, z: 0 }, { x: 0, z: 1 })).toBeCloseTo(0, 6);
    expect(Math.abs(yawToward({ x: 0, z: 0 }, { x: 0, z: -1 }))).toBeCloseTo(Math.PI, 6);
    expect(yawToward({ x: 0, z: 0 }, { x: 1, z: 0 })).toBeCloseTo(Math.PI / 2, 6);
  });
});
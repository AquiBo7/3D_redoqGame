// world/resources.test.ts —— 身高标准化数学验证：任意包围盒 → 目标身高 + 脚底归零 + XZ 居中

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { normalizeModelToHeight } from './resources';

/** 造一个带几何的节点：尺寸 size，位于 position（scale 可选），返回 group 与其包围盒测量 */
function makeBoxRoot(size: THREE.Vector3, position: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();
  group.position.copy(position);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z));
  mesh.position.set(0, 0, 0);
  group.add(mesh);
  group.updateWorldMatrix(true, true);
  return group;
}

function measure(root: THREE.Object3D): THREE.Box3 {
  root.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(root);
}

describe('normalizeModelToHeight', () => {
  it('脚底在 y=0 的模型：等比缩放到目标身高且脚底保持 0', () => {
    // 模拟 Tripo 标准导出：高 0.98m、XZ 有偏移、脚底贴地
    const root = makeBoxRoot(new THREE.Vector3(0.3, 0.98, 0.2), new THREE.Vector3(0.4, 0, -0.6));
    normalizeModelToHeight(root, 1.62);

    const box = measure(root);
    expect(box.max.y - box.min.y).toBeCloseTo(1.62, 4);
    expect(box.min.y).toBeCloseTo(0, 4);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 4);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 4);
  });

  it('垂直居中的模型：同样归零脚底并缩放到目标身高', () => {
    // 模拟部分导出器：包围盒关于 y=0 对称（男同学1 原始即居中）
    const root = makeBoxRoot(new THREE.Vector3(0.2, 0.98, 0.25), new THREE.Vector3(0, 0, 0));
    normalizeModelToHeight(root, 1.68);

    const box = measure(root);
    expect(box.max.y - box.min.y).toBeCloseTo(1.68, 4);
    expect(box.min.y).toBeCloseTo(0, 4);
    expect(box.max.y).toBeCloseTo(1.68, 4);
  });

  it('带父级缩放时仍按世界包围盒归一（根节点 scale 不等于 1）', () => {
    const parent = new THREE.Group();
    parent.scale.setScalar(2);
    const root = makeBoxRoot(new THREE.Vector3(0.3, 0.49, 0.2), new THREE.Vector3(0.1, 0, 0.2));
    parent.add(root);

    normalizeModelToHeight(root, 1.74);
    const box = measure(parent);
    // 世界高度：0.49 × 2(父) × (1.74/0.98)(自身) = 1.74
    expect(box.max.y - box.min.y).toBeCloseTo(1.74, 4);
    expect(box.min.y).toBeCloseTo(0, 4);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 4);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 4);
  });

  it('空包围盒（无几何）不报错、不改变变换', () => {
    const root = new THREE.Group();
    const before = { position: root.position.clone(), scale: root.scale.clone() };
    normalizeModelToHeight(root, 1.62);
    expect(root.position.equals(before.position)).toBe(true);
    expect(root.scale.equals(before.scale)).toBe(true);
  });

  it('非法目标身高抛错', () => {
    const root = makeBoxRoot(new THREE.Vector3(0.3, 0.98, 0.2), new THREE.Vector3(0, 0, 0));
    expect(() => normalizeModelToHeight(root, 0)).toThrow();
    expect(() => normalizeModelToHeight(root, -1)).toThrow();
  });
});

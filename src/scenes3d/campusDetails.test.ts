import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./materials', () => {
  const material = () => new THREE.MeshStandardMaterial();
  return {
    getPavingMaterial: material, getPlasterMaterial: material,
    getBarkMaterial: material, getFoliageMaterial: material,
    getWindowGlassMaterial: material, getWoodFloorMaterial: material,
  };
});
vi.mock('./shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('./shared')>();
  return { ...original, createTextSign: (_text: string, w: number, h: number) =>
    new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial()) };
});

import { getSceneDefinition, getSceneRuntime } from './index';

const roots: THREE.Group[] = [];
beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) });
});
afterEach(() => {
  for (const root of roots) {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }
  roots.length = 0;
  vi.unstubAllGlobals();
});

function build(id: 'S5' | 'S8') {
  const root = new THREE.Group();
  roots.push(root);
  const definition = getSceneDefinition(id);
  const built = definition.build(root);
  root.updateMatrixWorld(true);
  return { root, built, definition };
}

describe('校园精装几何与运行契约', () => {
  it('S5 真实演员朝向和前倾符合左后方观察，两位路人从台阶外起步', () => {
    const { built } = build('S5');
    const typer = built.actors!.typer;
    expect(typer.position.toArray()).toEqual([-3.6, 0, 7.95]);
    expect(typer.rotation.y).toBeCloseTo(Math.atan2(3.4, -5.15));
    expect(typer.children[0].rotation.x).toBe(0.02);
    expect(built.actors!['student-walker'].position.toArray()).toEqual([-2.85, 0, 8.2]);
    expect(built.actors!['student-walker-right'].position.toArray()).toEqual([2.85, 0, 7.4]);
    expect(built.actors!['student-walker'].rotation.y).toBe(Math.PI);
    expect(built.actors!['student-walker-right'].rotation.y).toBe(Math.PI);
  });
  it.each(['S5', 'S8'] as const)('%s 每个新增实体的完整几何与风摆幅避开中央视线', (id) => {
    const { root } = build(id);
    let details = 0;
    root.traverse((object) => {
      if (!object.userData.campusDetail) return;
      details += 1;
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.geometry.computeBoundingBox();
        const check = (matrix: THREE.Matrix4) => {
          const bounds = child.geometry.boundingBox!.clone().applyMatrix4(matrix);
          const material = Array.isArray(child.material) ? child.material[0] : child.material;
          if (material.userData.windTime) bounds.expandByScalar(child.userData.meadow ? 0.09 : 0.04);
          expect(bounds.min.x > 1.2 || bounds.max.x < -1.2, `${id} ${object.name}/${child.name}: ${bounds.min.x}..${bounds.max.x}`).toBe(true);
        };
        if (child instanceof THREE.InstancedMesh) {
          const matrix = new THREE.Matrix4();
          for (let i = 0; i < child.count; i += 1) {
            child.getMatrixAt(i, matrix);
            check(matrix.clone().premultiply(child.matrixWorld));
          }
        } else check(child.matrixWorld);
      });
    });
    expect(details).toBeGreaterThan(5);
  });

  it.each(['S5', 'S8'] as const)('%s 草花仅两个批次，风时钟由共享场景运行时推进', (id) => {
    const { root } = build(id);
    const meadows = root.children.filter((child) => child.userData.meadow) as THREE.InstancedMesh[];
    expect(meadows).toHaveLength(2);
    expect(meadows.map((mesh) => mesh.userData.meadow).sort()).toEqual(['flowers', 'grass']);
    expect(meadows.find((mesh) => mesh.userData.meadow === 'grass')!.count).toBeGreaterThan(1000);
    expect(meadows.find((mesh) => mesh.userData.meadow === 'flowers')!.count).toBeGreaterThan(50);
    const material = meadows[0].material as THREE.Material;
    const time = material.userData.windTime as { value: number };
    const before = time.value;
    getSceneRuntime(id)!.tick!(0.2);
    expect(time.value).toBeCloseTo(before + 0.2);
  });

  it('S8 路线与回头视线不被静态环境挡住，入口可沿中央实际到达', () => {
    const { root, built, definition } = build('S8');
    const environment = root.children.filter((child) => !Object.values(built.actors ?? {}).includes(child));
    for (const z of [-1, -12, -25, -37, -43]) {
      const from = new THREE.Vector3(0.2, 1.6, z);
      const to = new THREE.Vector3(0, 1.5, 8.6);
      const ray = new THREE.Raycaster(from, to.clone().sub(from).normalize(), 0, from.distanceTo(to) - 0.6);
      expect(ray.intersectObjects(environment, true)).toHaveLength(0);
    }
    for (const z of [-1, -12, -25, -37, -43.5]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(0.5, 0.7, z), new THREE.Vector3(0, 0, -1), 0, 0.3);
      expect(ray.intersectObjects(environment, true)).toHaveLength(0);
    }
    expect(definition.zones?.[0].center).toEqual({ x: 0, y: 0.9, z: -46 });
    expect(definition.nav.obstacles.map(({ id }) => id)).toEqual([
      'building-tree-0', 'building-tree-1', 'building-tree-2', 'building-tree-3', 'building-facade', 'building-father',
    ]);
  });
});

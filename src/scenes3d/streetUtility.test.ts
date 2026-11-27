import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveMovement } from '../world/navMath';
import { getSceneDefinition } from './index';

vi.mock('./materials', () => {
  const material = () => new THREE.MeshStandardMaterial();
  return {
    createContactShadowDiscBatch: () => null,
    getAsphaltMaterial: material,
    getPavingMaterial: material,
    getPlasterMaterial: material,
    getBarkMaterial: material,
    getFoliageMaterial: material,
    getWindowGlassMaterial: material,
    getWoodFloorMaterial: material,
    getFacadeBrickMaterial: material,
    getFacadeConcreteMaterial: material,
    getFacadeTileMaterial: material,
    getFacadeWindowMaterial: material,
    getStoreInteriorMaterial: material,
    getBakeryInteriorMaterial: material,
    getWarmLampGlowMaterial: () => ({ map: new THREE.Texture() }),
  };
});

const roots: THREE.Group[] = [];

function buildStreet(): THREE.Group {
  const root = new THREE.Group();
  roots.push(root);
  getSceneDefinition('S4').build(root);
  root.updateMatrixWorld(true);
  return root;
}

function batch(root: THREE.Object3D, name: string): THREE.InstancedMesh {
  let found: THREE.InstancedMesh | null = null;
  root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh && object.name === name) found = object;
  });
  expect(found, name).toBeTruthy();
  return found!;
}

function instances(mesh: THREE.InstancedMesh): Array<{ position: THREE.Vector3; scale: THREE.Vector3 }> {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const result: Array<{ position: THREE.Vector3; scale: THREE.Vector3 }> = [];
  for (let index = 0; index < mesh.count; index += 1) {
    mesh.getMatrixAt(index, matrix);
    matrix.decompose(position, rotation, scale);
    result.push({ position: position.clone(), scale: scale.clone() });
  }
  return result;
}

function near(entries: ReturnType<typeof instances>, x: number, z: number) {
  return entries.filter((entry) => Math.abs(entry.position.x - x) < 1e-5 && Math.abs(entry.position.z - z) < 1e-5);
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
});

afterEach(() => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  for (const root of roots) {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  roots.length = 0;
  vi.unstubAllGlobals();
});

describe('S4 水果店电线杆', () => {
  it('前景杆沿街面右移约 4m，旧位只保留对侧杆', () => {
    const root = buildStreet();
    const poles = instances(batch(root, 'street-utility-poles'));
    expect(near(poles, 1.95, 7)).toHaveLength(1);
    expect(near(poles, 2.3, 11)).toHaveLength(0);
    expect(near(poles, -2.3, 11)).toHaveLength(1);
    expect(poles).toHaveLength(8);
  });

  it('新杆有 0.25m 高、直径 0.5m 混凝土基座与两道黄色反光条', () => {
    const root = buildStreet();
    const base = near(instances(batch(root, 'street-utility-pole-bases')), 1.95, 7)[0];
    expect(base.position.y).toBeCloseTo(0.125, 6);
    expect(base.scale.x).toBeCloseTo(0.5, 6);
    expect(base.scale.y).toBeCloseTo(0.25, 6);
    const bands = near(instances(batch(root, 'street-utility-yellow-bands')), 1.95, 7);
    expect(bands).toHaveLength(2);
    expect(bands.every((band) => band.position.y >= 0.33)).toBe(true);
    const yellow = batch(root, 'street-utility-yellow-bands').material as THREE.MeshStandardMaterial;
    expect(yellow.metalness).toBeGreaterThan(0.4);
  });

  it('横担平行街道，绝缘子与首段电线沿 Z 排列且弧垂 0.44m', () => {
    const root = buildStreet();
    const arms = near(instances(batch(root, 'street-utility-crossarms')), 1.95, 7);
    expect(arms).toHaveLength(1);
    expect(arms[0].scale.x).toBeCloseTo(0.09, 6);
    expect(arms[0].scale.z).toBeCloseTo(0.9, 6);
    const insulators = near(instances(batch(root, 'street-utility-insulators')), 1.95, 7);
    expect(insulators).toHaveLength(0);
    expect(near(instances(batch(root, 'street-utility-insulators')), 1.95, 6.68)).toHaveLength(1);
    expect(near(instances(batch(root, 'street-utility-insulators')), 1.95, 7.32)).toHaveLength(1);

    const wire = root.getObjectByName('street-utility-wire-1-0-0') as THREE.Mesh;
    expect(wire).toBeTruthy();
    wire.geometry.computeBoundingBox();
    expect(wire.geometry.boundingBox!.max.y).toBeCloseTo(6.178, 2);
    expect(wire.geometry.boundingBox!.min.y).toBeCloseTo(5.722, 2);
  });

  it('挂饰最低点离地至少 2.2m，且入口仍保留可通行宽度', () => {
    const root = buildStreet();
    const tassels = instances(batch(root, 'street-pole-knot-tassels'))
      .filter((entry) => Math.abs(entry.position.z - 7) < 1e-5);
    expect(tassels.length).toBeGreaterThan(0);
    for (const tassel of tassels) expect(tassel.position.y - tassel.scale.y / 2).toBeGreaterThanOrEqual(2.2 - 1e-6);

    const definition = getSceneDefinition('S4');
    const pole = definition.nav.obstacles.find((obstacle) => obstacle.id === 'street-utility-pole-1')!;
    expect(pole).toMatchObject({ shape: 'circle', centerX: 1.95, centerZ: 7, radius: 0.2 });
    const blocked = resolveMovement({ x: 0.5, z: 7 }, { x: 2, z: 0 }, definition.nav.bounds, definition.nav.obstacles, 0.32);
    expect(blocked.x).toBeLessThan(1.43);
  });
});

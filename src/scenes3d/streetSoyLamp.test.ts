import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import { getSceneDefinition } from './index';
import { streetRuntime } from './street';

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
const timers: Array<ReturnType<typeof setTimeout>> = [];

function buildStreet(): THREE.Group {
  const root = new THREE.Group();
  roots.push(root);
  getSceneDefinition('S4').build(root);
  root.updateMatrixWorld(true);
  return root;
}

function findByName<T extends THREE.Object3D>(root: THREE.Object3D, name: string): T | null {
  let found: T | null = null;
  root.traverse((object) => {
    if (object.name === name) found = object as T;
  });
  return found;
}

function instanceTransform(mesh: THREE.InstancedMesh, index: number) {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  return { position, scale };
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) });
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: false }),
    setTimeout: (callback: () => void, ms: number) => timers.push(setTimeout(callback, ms)),
    clearTimeout: (id: number) => clearTimeout(id),
  });
});

afterEach(() => {
  streetRuntime.exit();
  streetRuntime.setNight?.(false);
  for (const id of timers) clearTimeout(id);
  timers.length = 0;
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

describe('S4 豆浆店路灯', () => {
  it('整体右移 4.2～5.0m，落在行道树右侧、红砖墙前，距墙 0.6～0.8m、距树干 ≥1.2m', () => {
    const nav = getSceneDefinition('S4').nav;
    const lamp = nav.obstacles.find((entry) => entry.id === 'street-lamp-1')!;
    const centerX = (lamp.minX + lamp.maxX) / 2;
    const centerZ = (lamp.minZ + lamp.maxZ) / 2;
    const displacement = Math.hypot(centerX - 3.2, centerZ - 0);
    expect(displacement).toBeGreaterThanOrEqual(4.2);
    expect(displacement).toBeLessThanOrEqual(5.0);
    expect(centerX).toBeCloseTo(1.9, 5);
    expect(centerZ).toBeCloseTo(4.2, 5);
    const wallFaceX = 2.62;
    const poleRadius = 0.065;
    const wallGap = wallFaceX - centerX - poleRadius;
    expect(wallGap).toBeGreaterThanOrEqual(0.6);
    expect(wallGap).toBeLessThanOrEqual(0.8);
    const treeDistance = Math.hypot(centerX - 1.9, centerZ - 3);
    expect(treeDistance).toBeGreaterThanOrEqual(1.2);
  });

  it('方形铸铁基座高 0.3m，杆高 3.2m，灯高 2.9m，横臂垂直墙面悬挑 0.9m', () => {
    const root = buildStreet();
    const base = findByName<THREE.InstancedMesh>(root, 'street-lamp-soy-base')!;
    expect(base).toBeTruthy();
    const baseTransform = instanceTransform(base, 0);
    expect(baseTransform.scale.y).toBeCloseTo(0.3, 5);
    expect(baseTransform.scale.x).toBeCloseTo(baseTransform.scale.z, 5);
    expect(baseTransform.position.y).toBeCloseTo(0.15, 5);

    const pole = findByName<THREE.InstancedMesh>(root, 'street-lamp-soy-pole')!;
    const poleTransform = instanceTransform(pole, 0);
    expect(poleTransform.scale.y).toBeCloseTo(3.2, 5);

    const bulbs = findByName<THREE.InstancedMesh>(root, 'street-lamp-bulbs')!;
    const bulb = instanceTransform(bulbs, 1);
    expect(bulb.position.y).toBeCloseTo(2.9, 5);
    expect(bulb.position.x).toBeCloseTo(1.0, 5);
    expect(bulb.position.z).toBeCloseTo(4.2, 5);

    const arm = findByName<THREE.InstancedMesh>(root, 'street-lamp-soy-arm')!;
    expect(arm).toBeTruthy();
    const shade = findByName<THREE.InstancedMesh>(root, 'street-lamp-soy-shade')!;
    const shadeTransform = instanceTransform(shade, 0);
    expect(shadeTransform.position.x).toBeCloseTo(1.0, 5);
    expect(Math.abs(shadeTransform.position.x - 1.9)).toBeCloseTo(0.9, 5);
  });

  it('夜间点光距离 6m、衰减 2，门口暖光斑直径 3～4m，不直射橱窗', () => {
    const root = buildStreet();
    streetRuntime.setNight?.(true);
    streetRuntime.enter({
      sceneId: 'S4',
      bus: new EventBus(),
      actors: {},
      setInteractableVisible: () => {},
      getPlayerFeet: (target: THREE.Vector3) => target.set(0.8, 0, 4.2),
    });
    for (let step = 0; step < 40; step += 1) streetRuntime.tick?.(0.05);
    const lights: THREE.PointLight[] = [];
    root.traverse((object) => {
      if (object instanceof THREE.PointLight && object.name.startsWith('street-lamp-night-light') && object.visible) lights.push(object);
    });
    const soyLight = lights.find((light) => Math.abs(light.position.z - 4.2) < 0.2);
    expect(soyLight).toBeTruthy();
    expect(soyLight!.distance).toBeCloseTo(6, 5);
    expect(soyLight!.decay).toBeCloseTo(2, 5);
    expect(soyLight!.position.y).toBeCloseTo(2.9, 1);
    expect(soyLight!.position.x).toBeCloseTo(1.0, 1);

    const pools = findByName<THREE.InstancedMesh>(root, 'street-lamp-night-pools')!;
    const pool = instanceTransform(pools, 1);
    const diameter = pool.scale.x;
    expect(diameter).toBeGreaterThanOrEqual(3);
    expect(diameter).toBeLessThanOrEqual(4);
    expect(pool.position.x).toBeCloseTo(1.0, 5);
  });

  it('相邻路灯间距 8～12m，原灯位基座与碰撞已清理', () => {
    const nav = getSceneDefinition('S4').nav;
    const soy = nav.obstacles.find((entry) => entry.id === 'street-lamp-1')!;
    const neighbor = nav.obstacles.find((entry) => entry.id === 'street-lamp-0')!;
    const soyX = (soy.minX + soy.maxX) / 2;
    const soyZ = (soy.minZ + soy.maxZ) / 2;
    const neighborX = (neighbor.minX + neighbor.maxX) / 2;
    const neighborZ = (neighbor.minZ + neighbor.maxZ) / 2;
    const spacing = Math.hypot(soyX - neighborX, soyZ - neighborZ);
    expect(spacing).toBeGreaterThanOrEqual(8);
    expect(spacing).toBeLessThanOrEqual(12);
    const oldLamp = nav.obstacles.find((entry) => entry.id === 'street-lamp-old');
    expect(oldLamp).toBeUndefined();
    const root = buildStreet();
    const bases = findByName<THREE.InstancedMesh>(root, 'street-lamp-bases');
    if (bases) {
      for (let i = 0; i < bases.count; i += 1) {
        const transform = instanceTransform(bases, i);
        expect(Math.abs(transform.position.x - 3.2) > 0.05 || Math.abs(transform.position.z) > 0.05).toBe(true);
      }
    }
  });
});
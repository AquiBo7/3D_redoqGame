// S4 夜间路灯红线：白天一个字节不多，夜里灯泡亮到辉光阈值之上、点光跟着最近的灯走、明暗按秒呼吸
// 这里量的是"接没接进 bloom、灯数是否受控、帧率无关"，不是好不好看。

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/eventBus';

vi.mock('./materials', () => {
  // 无头环境没有真 2D Canvas：整模块换成纯色哑光材质，光晕贴图给一张空 Texture
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

import { getSceneDefinition } from './index';
import { streetRuntime } from './street';

/** WorldApp 里 UnrealBloomPass 的亮度阈值：低于它自发光再高也不会晕开 */
const BLOOM_THRESHOLD = 1.25;
const LAMP_COUNT = 5;
const DAY_EMISSIVE = 1.15;

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

function bulbsMaterial(root: THREE.Group): THREE.MeshStandardMaterial {
  const bulbs = findByName<THREE.InstancedMesh>(root, 'street-lamp-bulbs');
  expect(bulbs, 'street-lamp-bulbs').toBeTruthy();
  return bulbs!.material as THREE.MeshStandardMaterial;
}

function nightLights(root: THREE.Group): THREE.PointLight[] {
  const found: THREE.PointLight[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.PointLight && object.name.startsWith('street-lamp-night-light')) found.push(object);
  });
  return found;
}

function contextAt(x: number, z: number) {
  return {
    sceneId: 'S4' as const,
    bus: new EventBus(),
    actors: {},
    setInteractableVisible: () => {},
    getPlayerFeet: (target: THREE.Vector3) => target.set(x, 0, z),
  };
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) });
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: false }),
    // 这里的裸 setTimeout 是 Node 的定时器，不能写成 window.setTimeout（那会调回本桩函数自己）
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

describe('S4 夜间路灯', () => {
  it('白天不开夜态：没有夜间件、没有额外点光，灯泡自发光仍是 1.15', () => {
    const root = buildStreet();
    expect(findByName(root, 'street-lamp-night-pools')).toBeNull();
    expect(findByName(root, 'street-lamp-night-beams')).toBeNull();
    expect(nightLights(root)).toHaveLength(0);
    expect(bulbsMaterial(root).emissiveIntensity).toBeCloseTo(DAY_EMISSIVE, 6);
  });

  it('夜里灯泡抬到辉光阈值之上并换成暖橙黄，地面光斑与光柱各一盏灯一份', () => {
    const root = buildStreet();
    streetRuntime.setNight?.(true);
    const emissive = bulbsMaterial(root).emissiveIntensity;
    expect(emissive).toBeGreaterThan(BLOOM_THRESHOLD);

    const pools = findByName<THREE.InstancedMesh>(root, 'street-lamp-night-pools');
    expect(pools, 'street-lamp-night-pools').toBeTruthy();
    expect(pools!.count).toBe(LAMP_COUNT);
    const poolMaterial = pools!.material as THREE.MeshBasicMaterial;
    expect(poolMaterial.blending).toBe(THREE.AdditiveBlending);
    expect(poolMaterial.depthWrite).toBe(false);
    pools!.getMatrixAt(0, new THREE.Matrix4());
    const matrix = new THREE.Matrix4();
    pools!.getMatrixAt(0, matrix);
    const poolPosition = new THREE.Vector3().setFromMatrixPosition(matrix);
    expect(poolPosition.y).toBeCloseTo(0.024, 6);
    expect(Math.abs(poolPosition.x)).toBeCloseTo(2.05, 2);

    const beams = findByName<THREE.InstancedMesh>(root, 'street-lamp-night-beams');
    expect(beams, 'street-lamp-night-beams').toBeTruthy();
    expect(beams!.count).toBe(LAMP_COUNT);
    beams!.geometry.computeBoundingBox();
    const box = beams!.geometry.boundingBox!;
    // 柱体在本地是从灯笼口往下收的开口锥，顶点色上亮下灭
    const color = beams!.geometry.getAttribute('color') as THREE.BufferAttribute;
    const position = beams!.geometry.getAttribute('position') as THREE.BufferAttribute;
    let topBrightness = 0;
    let bottomBrightness = 0;
    for (let index = 0; index < position.count; index += 1) {
      if (position.getY(index) > box.max.y - 1e-6) topBrightness = Math.max(topBrightness, color.getX(index));
      if (position.getY(index) < box.min.y + 1e-6) bottomBrightness = Math.max(bottomBrightness, color.getX(index));
    }
    expect(topBrightness).toBeGreaterThan(0.9);
    expect(bottomBrightness).toBeLessThan(0.02);
  });

  it('点光只给最近的几盏：灯数受质量档控制，位置落在灯腔里而不是玩家脚下', () => {
    const root = buildStreet();
    streetRuntime.setNight?.(true);
    streetRuntime.enter(contextAt(0, -30));
    const lights = nightLights(root).filter((light) => light.visible);
    expect(lights.length).toBeGreaterThan(0);
    expect(lights.length).toBeLessThanOrEqual(3);
    for (let step = 0; step < 40; step += 1) streetRuntime.tick?.(0.05);
    for (const light of lights) {
      expect(light.castShadow).toBe(false);
      expect(light.position.y).toBeGreaterThan(3);
      expect(light.intensity).toBeGreaterThan(1);
      expect(Math.abs(light.position.x)).toBeLessThanOrEqual(2.06);
    }
    // 玩家站在 z = -30，最近的一盏必须被点亮到身边
    const nearest = Math.min(...lights.map((light) => Math.abs(light.position.z + 30)));
    expect(nearest).toBeLessThan(0.6);
  });

  it('明暗呼吸按累计秒算：同一段时间不论切多少帧，节律一致', () => {
    const root = buildStreet();
    streetRuntime.setNight?.(true);
    streetRuntime.enter(contextAt(0, -10));
    for (let step = 0; step < 20; step += 1) streetRuntime.tick?.(0.05);
    const pools = findByName<THREE.InstancedMesh>(root, 'street-lamp-night-pools')!;
    const beams = findByName<THREE.InstancedMesh>(root, 'street-lamp-night-beams')!;
    const bulb = bulbsMaterial(root);
    const coarseOpacity = (pools.material as THREE.MeshBasicMaterial).opacity;
    const coarseBeam = (beams.material as THREE.MeshBasicMaterial).opacity;
    const coarseBulb = bulb.emissiveIntensity;

    streetRuntime.exit();
    streetRuntime.setNight?.(false);
    const root2 = buildStreet();
    streetRuntime.setNight?.(true);
    streetRuntime.enter(contextAt(0, -10));
    for (let step = 0; step < 1; step += 1) streetRuntime.tick?.(1);
    const pools2 = findByName<THREE.InstancedMesh>(root2, 'street-lamp-night-pools')!;
    const beams2 = findByName<THREE.InstancedMesh>(root2, 'street-lamp-night-beams')!;
    expect((pools2.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(coarseOpacity, 6);
    expect((beams2.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(coarseBeam, 6);
    expect(bulbsMaterial(root2).emissiveIntensity).toBeCloseTo(coarseBulb, 6);
  });

  it('关掉夜态回到白天值：不残留点光强度，灯泡自发光回到 1.15', () => {
    const root = buildStreet();
    streetRuntime.setNight?.(true);
    streetRuntime.enter(contextAt(0, -10));
    streetRuntime.tick?.(0.5);
    expect(bulbsMaterial(root).emissiveIntensity).toBeGreaterThan(BLOOM_THRESHOLD);
    streetRuntime.setNight?.(false);
    expect(bulbsMaterial(root).emissiveIntensity).toBeCloseTo(DAY_EMISSIVE, 6);
    for (const light of nightLights(root)) expect(light.visible).toBe(false);
    expect((findByName<THREE.InstancedMesh>(root, 'street-lamp-night-pools')!).visible).toBe(false);
  });
});

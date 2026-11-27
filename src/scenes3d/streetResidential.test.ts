import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSceneDefinition } from './index';
import { buildStreetResidentialBuilding, RESIDENTIAL_FOOTPRINT } from './streetResidential';

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

function meshBounds(mesh: THREE.Mesh, target: THREE.Box3): void {
  const geometry = mesh.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const local = geometry.boundingBox!;
  if (mesh instanceof THREE.InstancedMesh) {
    const instance = new THREE.Matrix4();
    for (let i = 0; i < mesh.count; i += 1) {
      mesh.getMatrixAt(i, instance);
      const world = new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, instance);
      target.union(local.clone().applyMatrix4(world));
    }
  } else {
    target.union(local.clone().applyMatrix4(mesh.matrixWorld));
  }
}

function groupBounds(group: THREE.Object3D): THREE.Box3 {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) meshBounds(object, box);
  });
  return box;
}

function triangleCount(group: THREE.Object3D): number {
  let total = 0;
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry;
    const faces = geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3;
    total += faces * (object instanceof THREE.InstancedMesh ? object.count : 1);
  });
  return total;
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

describe('S4 转角纯装饰居民楼', () => {
  it('包络严格 6m×8m，檐口 6.5m、脊高 8.2m，两层窗排', () => {
    const root = new THREE.Group();
    roots.push(root);
    const group = buildStreetResidentialBuilding(root, []);
    const box = groupBounds(group);
    expect(box.min.x).toBeCloseTo(RESIDENTIAL_FOOTPRINT.minX, 5);
    expect(box.max.x).toBeCloseTo(RESIDENTIAL_FOOTPRINT.maxX, 5);
    expect(box.min.z).toBeCloseTo(RESIDENTIAL_FOOTPRINT.minZ, 5);
    expect(box.max.z).toBeCloseTo(RESIDENTIAL_FOOTPRINT.maxZ, 5);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y).toBeCloseTo(RESIDENTIAL_FOOTPRINT.ridgeY, 5);
    const shell = group.getObjectByName('residential-shell') as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const windowRows = new Set<number>();
    for (let i = 0; i < shell.count; i += 1) {
      shell.getMatrixAt(i, matrix);
      matrix.decompose(position, quaternion, scale);
      if (Math.abs(scale.x - 0.03) < 1e-6 && scale.y > 1 && scale.z > 1) {
        windowRows.add(Math.round(position.y * 10) / 10);
      }
    }
    expect(windowRows.has(1.7)).toBe(true);
    expect(windowRows.has(4.7)).toBe(true);
  });

  it('门窗及生活构件位于墙体外侧，避免遮挡与共面闪烁', () => {
    const root = new THREE.Group();
    roots.push(root);
    const group = buildStreetResidentialBuilding(root, []);
    const shell = group.getObjectByName('residential-shell') as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    shell.getMatrixAt(0, matrix);
    matrix.decompose(position, quaternion, scale);
    const wallHalfWidth = scale.x / 2;
    let checked = 0;
    group.traverse((object) => {
      if (!(object instanceof THREE.InstancedMesh) || object.name === 'residential-roof') return;
      for (let i = object === shell ? 1 : 0; i < object.count; i += 1) {
        object.getMatrixAt(i, matrix);
        matrix.decompose(position, quaternion, scale);
        if (position.x === 0) continue;
        expect(Math.abs(position.x) - scale.x / 2, `${object.name}[${i}]`).toBeGreaterThanOrEqual(wallHalfWidth - 1e-6);
        expect(Math.abs(position.x) + scale.x / 2).toBeGreaterThan(wallHalfWidth + 0.01);
        checked += 1;
      }
    });
    expect(checked).toBeGreaterThan(60);
    const warm = group.getObjectByName('residential-warm-window') as THREE.Mesh;
    warm.geometry.computeBoundingBox();
    expect(warm.position.x + warm.geometry.boundingBox!.min.x).toBeGreaterThan(wallHalfWidth);
    const poster = group.getObjectByName('residential-faded-poster') as THREE.InstancedMesh;
    poster.getMatrixAt(0, matrix);
    matrix.decompose(position, quaternion, scale);
    expect(position.z - scale.z / 2).toBeGreaterThan(0.63);
    expect(position.z + scale.z / 2).toBeLessThan(1.61);
  });

  it('三角面 ≤1500、材质 ≤2，且至少五项生活痕迹与全套构件', () => {
    const root = new THREE.Group();
    roots.push(root);
    const group = buildStreetResidentialBuilding(root, []);
    expect(triangleCount(group)).toBeLessThanOrEqual(1500);
    const materials = new Set<THREE.Material>();
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    expect(materials.size).toBeLessThanOrEqual(2);
    for (const name of [
      'residential-window-planter',
      'residential-doormat',
      'residential-bench',
      'residential-faded-poster',
      'residential-warm-window',
      'residential-roof',
    ]) {
      expect(group.getObjectByName(name), name).toBeTruthy();
    }
    const warm = group.getObjectByName('residential-warm-window') as THREE.Mesh;
    const warmMaterial = warm.material as THREE.MeshStandardMaterial;
    expect(warmMaterial.emissiveIntensity).toBeGreaterThan(0);
    const shell = group.getObjectByName('residential-shell') as THREE.InstancedMesh;
    expect(shell.count).toBeGreaterThan(60);
  });

  it('实例缓冲随几何释放一次，重复清理和移除不泄漏', () => {
    const root = new THREE.Group();
    roots.push(root);
    const group = buildStreetResidentialBuilding(root, []);
    const releases: ReturnType<typeof vi.spyOn>[] = [];
    const geometries = new Set<THREE.BufferGeometry>();
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      if (object instanceof THREE.InstancedMesh) releases.push(vi.spyOn(object, 'dispose'));
    });
    geometries.forEach((geometry) => geometry.dispose());
    geometries.forEach((geometry) => geometry.dispose());
    root.remove(group);
    expect(releases.length).toBeGreaterThan(5);
    releases.forEach((release) => expect(release).toHaveBeenCalledTimes(1));
  });

  it('无店招、菜单、价目牌、收银台、商品、营业灯箱或橱窗等商业元素', () => {
    const root = new THREE.Group();
    roots.push(root);
    const group = buildStreetResidentialBuilding(root, []);
    const forbidden = /shop|sign|menu|price|cashier|product|lightbox|showcase|store|commercial/i;
    group.traverse((object) => {
      expect(forbidden.test(object.name)).toBe(false);
    });
  });

  it('街道集成：盒碰撞等于自身包络，与红砖楼留 1.2m 巷道，不侵入主通路', () => {
    const nav = getSceneDefinition('S4').nav;
    const obstacle = nav.obstacles.find((entry) => entry.id === 'street-residential-building');
    expect(obstacle).toBeTruthy();
    expect(obstacle!.minX).toBe(RESIDENTIAL_FOOTPRINT.minX);
    expect(obstacle!.maxX).toBe(RESIDENTIAL_FOOTPRINT.maxX);
    expect(obstacle!.minZ).toBe(RESIDENTIAL_FOOTPRINT.minZ);
    expect(obstacle!.maxZ).toBe(RESIDENTIAL_FOOTPRINT.maxZ);
    const heritage = nav.obstacles.find((entry) => entry.id === 'street-heritage-left')!;
    expect(heritage.minX - obstacle!.maxX).toBeCloseTo(1.2, 5);
    const bounds = Array.isArray(nav.bounds) ? nav.bounds[0] : nav.bounds;
    expect(obstacle!.maxX).toBeLessThan(bounds.minX);
    expect(bounds.maxX - bounds.minX).toBeGreaterThanOrEqual(1.5);
  });

  it('替换原左侧远景盒，不遮挡东侧豆浆灯箱、井盖、消防栓与学生 NPC', () => {
    const root = buildStreet();
    const group = root.getObjectByName('street-residential-building');
    expect(group).toBeTruthy();
    let oldWing = false;
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const world = new THREE.Vector3();
      object.getWorldPosition(world);
      if (Math.abs(world.x + 16.5) < 0.05 && Math.abs(world.z - 13.5) < 0.05 && world.y > 1) oldWing = true;
    });
    expect(oldWing).toBe(false);
    const box = groupBounds(group!);
    for (const keyX of [2.05, 2.62, 1.9, -1.95]) {
      expect(keyX).toBeGreaterThan(box.max.x);
    }
  });
});
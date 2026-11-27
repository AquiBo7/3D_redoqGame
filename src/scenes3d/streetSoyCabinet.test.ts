import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSceneDefinition } from './index';
import { SOY_DISPLAY_CABINET } from './streetShops';

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
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
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

describe('S4 豆浆主题展示柜', () => {
  it('位于橱窗与门之间，1.2m×0.55m×1.6m，柜背距墙 0.05m，正面平行人行道', () => {
    const root = buildStreet();
    const group = findByName<THREE.Group>(root, 'soy-display-cabinet');
    expect(group).toBeTruthy();
    const glass = findByName<THREE.Mesh>(root, 'soy-cabinet-glass')!;
    expect(glass.position.z).toBeCloseTo(SOY_DISPLAY_CABINET.centerZ, 5);
    expect(glass.position.y).toBeCloseTo(1.0, 5);
    const glassGeometry = glass.geometry as THREE.BoxGeometry;
    expect(glassGeometry.parameters.height).toBeCloseTo(0.9, 5);
    const faceX = 2.62;
    const backX = faceX - SOY_DISPLAY_CABINET.backGap;
    const frontX = backX - SOY_DISPLAY_CABINET.depthX;
    expect(glass.position.x).toBeCloseTo(frontX, 5);
    expect(backX).toBeCloseTo(2.57, 5);
    expect(frontX).toBeCloseTo(2.02, 5);
    const glassMaterial = glass.material as THREE.MeshStandardMaterial;
    expect(glassMaterial.opacity).toBeCloseTo(0.18, 5);
    expect(glassMaterial.transparent).toBe(true);
  });

  it('下部 0.55m、三层展示区、顶部 0.15m，8～10 件几何商品与黄豆篮、立牌', () => {
    const root = buildStreet();
    const boxes = findByName<THREE.InstancedMesh>(root, 'soy-cabinet-boxes')!;
    const cyls = findByName<THREE.InstancedMesh>(root, 'soy-cabinet-cyls')!;
    expect(cyls.count).toBeGreaterThanOrEqual(8);
    let baseHeight = 0;
    let topHeight = 0;
    let shelfCount = 0;
    let basket = false;
    let mat = false;
    for (let i = 0; i < boxes.count; i += 1) {
      const { scale } = instanceTransform(boxes, i);
      if (Math.abs(scale.y - 0.55) < 1e-6 && Math.abs(scale.z - 1.2) < 1e-6) baseHeight = scale.y;
      if (Math.abs(scale.y - 0.15) < 1e-6 && Math.abs(scale.z - 1.2) < 1e-6) topHeight = scale.y;
      if (Math.abs(scale.y - 0.03) < 1e-6 && Math.abs(scale.z - 1.1) < 1e-6) shelfCount += 1;
      if (Math.abs(scale.y - 0.1) < 1e-6 && Math.abs(scale.z - 0.18) < 1e-6) basket = true;
      if (Math.abs(scale.y - 0.03) < 1e-6 && Math.abs(scale.z - 1.3) < 1e-6) mat = true;
    }
    expect(baseHeight).toBeCloseTo(0.55, 5);
    expect(topHeight).toBeCloseTo(0.15, 5);
    expect(shelfCount).toBe(3);
    expect(basket).toBe(true);
    expect(mat).toBe(true);
    const tag = findByName<THREE.Mesh>(root, 'soy-cabinet-price-tag');
    expect(tag).toBeTruthy();
    const strip = findByName<THREE.Mesh>(root, 'soy-cabinet-light-strip')!;
    const stripMaterial = strip.material as THREE.MeshStandardMaterial;
    expect(stripMaterial.emissive.getHex()).toBe(0xffe3b0);
    expect(stripMaterial.emissiveIntensity).toBeGreaterThan(0);
  });

  it('整体不超过 2000 三角面和 2 个材质，图集分离价牌、哑光区域与灯带', () => {
    const root = buildStreet();
    const group = findByName<THREE.Group>(root, 'soy-display-cabinet')!;
    const materials = new Set<THREE.Material>();
    let triangles = 0;
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      const count = object.geometry.index?.count ?? object.geometry.getAttribute('position').count;
      triangles += count / 3 * (object instanceof THREE.InstancedMesh ? object.count : 1);
    });
    expect(triangles).toBeLessThanOrEqual(2000);
    expect(materials.size).toBe(2);
    const boxes = findByName<THREE.InstancedMesh>(group, 'soy-cabinet-boxes')!;
    const strip = findByName<THREE.Mesh>(group, 'soy-cabinet-light-strip')!;
    const tag = findByName<THREE.Mesh>(group, 'soy-cabinet-price-tag')!;
    const opaque = boxes.material as THREE.MeshStandardMaterial;
    expect(strip.material).toBe(opaque);
    expect(tag.material).toBe(opaque);
    expect(opaque.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(opaque.emissiveMap).toBeInstanceOf(THREE.CanvasTexture);
    expect(boxes.geometry.getAttribute('uv').getX(0)).toBe(0.25);
    expect(boxes.geometry.getAttribute('uv').getY(0)).toBe(0.75);
    expect(strip.geometry.getAttribute('uv').getX(0)).toBe(0.75);
    expect(strip.geometry.getAttribute('uv').getY(0)).toBe(0.75);
    const tagUv = tag.geometry.getAttribute('uv');
    for (let i = 0; i < tagUv.count; i += 1) expect(tagUv.getY(i)).toBeLessThanOrEqual(0.5);
  });

  it('共享不透明材质重复清理时，两张私有图集各释放一次', () => {
    const root = buildStreet();
    const boxes = findByName<THREE.InstancedMesh>(root, 'soy-cabinet-boxes')!;
    const material = boxes.material as THREE.MeshStandardMaterial;
    const releaseColor = vi.spyOn(material.map!, 'dispose');
    const releaseEmission = vi.spyOn(material.emissiveMap!, 'dispose');
    material.dispose();
    material.dispose();
    expect(releaseColor).toHaveBeenCalledTimes(1);
    expect(releaseEmission).toHaveBeenCalledTimes(1);
  });

  it('纯装饰不可交互，不新增实时点光，碰撞厚 0.3m，柜前净宽 ≥0.9m，主通路 ≥1.5m', () => {
    const root = buildStreet();
    const group = findByName<THREE.Group>(root, 'soy-display-cabinet')!;
    let pointLights = 0;
    group.traverse((object) => {
      if (object instanceof THREE.PointLight) pointLights += 1;
    });
    expect(pointLights).toBe(0);
    const definition = getSceneDefinition('S4');
    expect(definition.interactables?.some((entry) => entry.id.includes('cabinet'))).toBe(false);
    const obstacle = definition.nav.obstacles.find((entry) => entry.id === 'street-soy-display-cabinet')!;
    expect(obstacle).toBeTruthy();
    expect(obstacle.maxX - obstacle.minX).toBeCloseTo(0.3, 5);
    expect(obstacle.minZ).toBeCloseTo(SOY_DISPLAY_CABINET.centerZ - 0.6, 5);
    expect(obstacle.maxZ).toBeCloseTo(SOY_DISPLAY_CABINET.centerZ + 0.6, 5);

    const boxes = findByName<THREE.InstancedMesh>(root, 'soy-cabinet-boxes')!;
    let apronMinX = Infinity;
    for (let i = 0; i < boxes.count; i += 1) {
      const { position, scale } = instanceTransform(boxes, i);
      if (Math.abs(scale.y - 0.01) < 1e-6 && Math.abs(scale.z - 2.0) < 1e-6) {
        apronMinX = Math.min(apronMinX, position.x - scale.x / 2);
      }
    }
    const frontX = 2.02;
    expect(frontX - apronMinX).toBeGreaterThanOrEqual(0.9);
    const bounds = Array.isArray(definition.nav.bounds) ? definition.nav.bounds[0] : definition.nav.bounds;
    expect(bounds.maxX - bounds.minX).toBeGreaterThanOrEqual(1.5);
    expect(obstacle.minX).toBeGreaterThan(1.5);
  });
});
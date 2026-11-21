// scenes3d/street.ts —— 上学街道（S4 自由移动开始）
// 进入 S4 后调度两次手机震动（间隔 ≥ 20s）；离开 S4 时 streetRuntime.exit() 必须清除未触发的定时器。

import * as THREE from 'three';
import type { SceneId } from '../data/storySchema';
import type { ObstacleAabb } from '../world/navMath';
import type {
  NavigationConfig,
  SceneRuntime,
  SceneRuntimeContext,
  SceneSpawn,
  WorldSceneDefinition,
} from '../world/worldSceneTypes';
import {
  addBox,
  addGround,
  createActorAnimation,
  createCharacterActor,
  createMatteMaterial,
  createTextSign,
  startIdleMotion,
  yawToward,
} from './shared';
import type { CharacterAnimationController } from './characterAnimation';
import type { BoxSize, Vec3 } from './shared';
import {
  getAsphaltMaterial,
  getBarkMaterial,
  getFacadeBrickMaterial,
  getFacadeConcreteMaterial,
  getFacadeTileMaterial,
  getFacadeWindowMaterial,
  getFoliageMaterial,
  getPavingMaterial,
  getPlasterMaterial,
  getStoreInteriorMaterial,
  getWindowGlassMaterial,
} from './materials';

type FacadeKind = 'tile' | 'concrete' | 'brick' | 'plaster';
type ParapetStyle = 'flat' | 'stepped' | 'cornice';
type AwningTone = 'teal' | 'terracotta' | 'slate';

interface BuildingSpec {
  center: Vec3;
  size: BoxSize;
  color: number;
  facade: FacadeKind;
  parapetStyle: ParapetStyle;
  shopName: string;
  signBackground: string;
  signForeground: string;
  signWidth: number;
  signHeight: number;
  awningTone: AwningTone;
  hasBalcony: boolean;
  hasOverhang: boolean;
  hasWaterTank: boolean;
  hasAFrame?: boolean;
  /** 侧墙（+Z 朝向来路方向）专属海报与配件，打破建筑侧面空白与同质化 */
  sidePoster: {
    text: string;
    background: string;
    foreground: string;
    width: number;
    height: number;
    centerY: number;
    accentColor: number;
  };
  sideFeature: 'meter' | 'flue' | 'bookcase' | 'louver';
  storeInteriorTint: number;
}

/** 两侧街楼（差异化层高、退界、立面材质与虚构校园周边业态），坐标数据化 */
const BUILDINGS: BuildingSpec[] = [
  {
    center: { x: -7.05, y: 2.8, z: 6 },
    size: { w: 9, h: 5.6, d: 8.6 },
    color: 0x8e9a95,
    facade: 'tile',
    parapetStyle: 'stepped',
    shopName: '街角便利店',
    signBackground: '#efe0be',
    signForeground: '#2a443e',
    signWidth: 2.1,
    signHeight: 0.48,
    awningTone: 'teal',
    hasBalcony: false,
    hasOverhang: true,
    hasWaterTank: false,
    sidePoster: {
      text: '24h 便利 · 热饮便当',
      background: '#e5dbc4',
      foreground: '#27433d',
      width: 2.3,
      height: 0.72,
      centerY: 2.45,
      accentColor: 0x456b64,
    },
    sideFeature: 'meter',
    storeInteriorTint: 0xf4ecdc,
  },
  {
    center: { x: -7.24, y: 4.9, z: -6 },
    size: { w: 9, h: 9.8, d: 9.0 },
    color: 0x9b8475,
    facade: 'brick',
    parapetStyle: 'cornice',
    shopName: '清晨早餐铺',
    signBackground: '#f2d9b1',
    signForeground: '#4b2f21',
    signWidth: 2.15,
    signHeight: 0.5,
    awningTone: 'terracotta',
    hasBalcony: true,
    hasOverhang: false,
    hasWaterTank: true,
    hasAFrame: true,
    sidePoster: {
      text: '现磨豆浆 · 手工包点',
      background: '#ebd3ae',
      foreground: '#4e3121',
      width: 2.4,
      height: 0.76,
      centerY: 2.55,
      accentColor: 0x8c5642,
    },
    sideFeature: 'flue',
    storeInteriorTint: 0xffe4bc,
  },
  {
    center: { x: -7.0, y: 3.4, z: -18 },
    size: { w: 9, h: 6.8, d: 8.5 },
    color: 0x8c979f,
    facade: 'concrete',
    parapetStyle: 'flat',
    shopName: '学府文具打印',
    signBackground: '#dde6ec',
    signForeground: '#273c4b',
    signWidth: 2.35,
    signHeight: 0.46,
    awningTone: 'slate',
    hasBalcony: false,
    hasOverhang: true,
    hasWaterTank: false,
    hasAFrame: true,
    sidePoster: {
      text: '证件照快印 · 装订',
      background: '#d8e2e8',
      foreground: '#263a49',
      width: 2.25,
      height: 0.68,
      centerY: 2.35,
      accentColor: 0x4a6375,
    },
    sideFeature: 'meter',
    storeInteriorTint: 0xe3edf2,
  },
  {
    center: { x: -7.18, y: 4.4, z: -30 },
    size: { w: 9, h: 8.8, d: 8.8 },
    color: 0x859992,
    facade: 'tile',
    parapetStyle: 'stepped',
    shopName: '康安药房',
    signBackground: '#dcece4',
    signForeground: '#1e4a3d',
    signWidth: 1.95,
    signHeight: 0.5,
    awningTone: 'teal',
    hasBalcony: true,
    hasOverhang: false,
    hasWaterTank: true,
    hasAFrame: true,
    sidePoster: {
      text: '常备医药 · 校园便民',
      background: '#d6e6de',
      foreground: '#1e4a3d',
      width: 2.3,
      height: 0.72,
      centerY: 2.5,
      accentColor: 0x3b7265,
    },
    sideFeature: 'louver',
    storeInteriorTint: 0xdff2ec,
  },
  {
    center: { x: 7.12, y: 3.7, z: 0 },
    size: { w: 9, h: 7.4, d: 8.8 },
    color: 0x9c8876,
    facade: 'brick',
    parapetStyle: 'cornice',
    shopName: '晨光豆浆',
    signBackground: '#f1dcb8',
    signForeground: '#4d3523',
    signWidth: 1.95,
    signHeight: 0.48,
    awningTone: 'terracotta',
    hasBalcony: false,
    hasOverhang: false,
    hasWaterTank: false,
    sidePoster: {
      text: '清晨热粥 · 现炸油条',
      background: '#ead2ac',
      foreground: '#4c3220',
      width: 2.45,
      height: 0.78,
      centerY: 2.5,
      accentColor: 0x8e5942,
    },
    sideFeature: 'flue',
    storeInteriorTint: 0xffe2b6,
  },
  {
    center: { x: 7.02, y: 2.7, z: -12 },
    size: { w: 9, h: 5.4, d: 8.6 },
    color: 0x999d95,
    facade: 'plaster',
    parapetStyle: 'stepped',
    shopName: '校园书屋',
    signBackground: '#e9e2cf',
    signForeground: '#2e3e36',
    signWidth: 1.9,
    signHeight: 0.46,
    awningTone: 'teal',
    hasBalcony: false,
    hasOverhang: true,
    hasWaterTank: false,
    sidePoster: {
      text: '秋季教材 · 校园书单',
      background: '#e4ddca',
      foreground: '#2c3d35',
      width: 2.35,
      height: 0.74,
      centerY: 2.42,
      accentColor: 0x526b61,
    },
    sideFeature: 'bookcase',
    storeInteriorTint: 0xf1e8d6,
  },
  {
    center: { x: 7.26, y: 5.4, z: -24 },
    size: { w: 9, h: 10.8, d: 9.0 },
    color: 0x8a959b,
    facade: 'concrete',
    parapetStyle: 'cornice',
    shopName: '街角便利店',
    signBackground: '#e6e4d5',
    signForeground: '#2b4046',
    signWidth: 2.1,
    signHeight: 0.48,
    awningTone: 'slate',
    hasBalcony: true,
    hasOverhang: false,
    hasWaterTank: true,
    sidePoster: {
      text: '冷热饮品 · 校园日用',
      background: '#dfe0d3',
      foreground: '#293e45',
      width: 2.3,
      height: 0.72,
      centerY: 2.52,
      accentColor: 0x4c6674,
    },
    sideFeature: 'louver',
    storeInteriorTint: 0xeef0e4,
  },
  {
    center: { x: 7.08, y: 3.5, z: -36 },
    size: { w: 9, h: 7.0, d: 8.5 },
    color: 0x8f989e,
    facade: 'tile',
    parapetStyle: 'flat',
    shopName: '学府文具打印',
    signBackground: '#e1e8ec',
    signForeground: '#2b3d4a',
    signWidth: 2.35,
    signHeight: 0.46,
    awningTone: 'slate',
    hasBalcony: false,
    hasOverhang: false,
    hasWaterTank: false,
    hasAFrame: true,
    sidePoster: {
      text: '开学文具 · 彩印复印',
      background: '#dce4e9',
      foreground: '#293b48',
      width: 2.3,
      height: 0.7,
      centerY: 2.4,
      accentColor: 0x4a6375,
    },
    sideFeature: 'meter',
    storeInteriorTint: 0xe5eef3,
  },
];

/** 路灯灯柱（XZ 位置） */
const LAMP_POSTS: Array<{ x: number; z: number }> = [
  { x: -3.2, z: 10 },
  { x: 3.2, z: 0 },
  { x: -3.2, z: -10 },
  { x: 3.2, z: -20 },
  { x: -3.2, z: -30 },
];

/** 行李 + 迎新志愿者 / 新生 3D 角色组合（两人面对面自然交谈，不机械同向） */
const STREET_NPCS = [
  {
    group: { x: 4.4, z: -7 },
    greeterModel: 'volunteer',
    greeterColor: 0x8f8578,
    studentModel: 'ayuan',
    studentColor: 0x8f9aa3,
    luggage: { x: 3.6, z: -7.6 },
  },
  {
    group: { x: -4.6, z: -24 },
    greeterModel: 'volunteer',
    greeterColor: 0x867d70,
    studentModel: 'ayuan',
    studentColor: 0x93a0a8,
    luggage: { x: -5.4, z: -24.6 },
  },
] as const;

const SPAWN: SceneSpawn = { x: 0, z: 14, yaw: 0, pitchDeg: -5 };

/** 校门台阶触发区（box，居中于街道尽头） */
const STAIRS_ZONE_CENTER = { x: 0, y: 0, z: -40.5 } as const;

const TARGET_GUIDE = { x: 0, y: 2.4, z: -40.5 } as const;

function buildingObstacles(): ObstacleAabb[] {
  return BUILDINGS.map((building, index) => ({
    id: `street-building-${index}`,
    minX: building.center.x - building.size.w / 2,
    maxX: building.center.x + building.size.w / 2,
    minZ: building.center.z - building.size.d / 2,
    maxZ: building.center.z + building.size.d / 2,
    height: building.size.h,
  }));
}

const NAV: NavigationConfig = {
  groundY: 0,
  bounds: { minX: -5.5, maxX: 5.5, minZ: -45.5, maxZ: 15.5 },
  obstacles: [
    ...buildingObstacles(),
    ...LAMP_POSTS.map((post, index) => ({
      id: `street-lamp-${index}`,
      minX: post.x - 0.22,
      maxX: post.x + 0.22,
      minZ: post.z - 0.22,
      maxZ: post.z + 0.22,
      height: 4,
    })),
    ...STREET_NPCS.map((npc, index) => ({
      id: `street-npc-${index}`,
      minX: npc.group.x - 0.55,
      maxX: npc.group.x + 0.55,
      minZ: npc.group.z - 0.55,
      maxZ: npc.group.z + 0.55,
      height: 1.8,
    })),
  ],
};

interface BoxInstanceSpec {
  position: Vec3;
  scale: Vec3;
  rotation?: Vec3;
}

function bindInstancedDispose(geometry: THREE.BufferGeometry, mesh: THREE.InstancedMesh): void {
  const release = (): void => {
    mesh.dispose();
    geometry.removeEventListener('dispose', release);
  };
  geometry.addEventListener('dispose', release);
}

function createBoxInstances(
  parent: THREE.Object3D,
  name: string,
  specs: BoxInstanceSpec[],
  material: THREE.Material,
  castShadow = false,
): THREE.InstancedMesh | null {
  if (specs.length === 0) return null;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, specs.length);
  const transform = new THREE.Object3D();
  specs.forEach((spec, index) => {
    transform.position.set(spec.position.x, spec.position.y, spec.position.z);
    transform.scale.set(spec.scale.x, spec.scale.y, spec.scale.z);
    const rotation = spec.rotation ?? { x: 0, y: 0, z: 0 };
    transform.rotation.set(rotation.x, rotation.y, rotation.z);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  bindInstancedDispose(geometry, mesh);
  parent.add(mesh);
  return mesh;
}

function createCylinderInstances(
  parent: THREE.Object3D,
  name: string,
  specs: BoxInstanceSpec[],
  material: THREE.Material,
  castShadow = false,
): THREE.InstancedMesh | null {
  if (specs.length === 0) return null;
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 10);
  const mesh = new THREE.InstancedMesh(geometry, material, specs.length);
  const transform = new THREE.Object3D();
  specs.forEach((spec, index) => {
    transform.position.set(spec.position.x, spec.position.y, spec.position.z);
    transform.scale.set(spec.scale.x, spec.scale.y, spec.scale.z);
    const rotation = spec.rotation ?? { x: 0, y: 0, z: 0 };
    transform.rotation.set(rotation.x, rotation.y, rotation.z);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  bindInstancedDispose(geometry, mesh);
  parent.add(mesh);
  return mesh;
}

interface SegmentInstanceSpec {
  from: Vec3;
  to: Vec3;
  radius: number;
}

function createSegmentCylinderInstances(
  parent: THREE.Object3D,
  name: string,
  segments: SegmentInstanceSpec[],
  material: THREE.Material,
  castShadow = false,
  radialSegments = 7,
): THREE.InstancedMesh | null {
  if (segments.length === 0) return null;
  const geometry = new THREE.CylinderGeometry(1, 1, 1, radialSegments);
  const mesh = new THREE.InstancedMesh(geometry, material, segments.length);
  const up = new THREE.Vector3(0, 1, 0);
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const midpoint = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4();

  segments.forEach((segment, index) => {
    start.set(segment.from.x, segment.from.y, segment.from.z);
    end.set(segment.to.x, segment.to.y, segment.to.z);
    direction.subVectors(end, start);
    const length = Math.max(0.001, direction.length());
    midpoint.addVectors(start, end).multiplyScalar(0.5);
    quaternion.setFromUnitVectors(up, direction.normalize());
    scale.set(segment.radius, length, segment.radius);
    matrix.compose(midpoint, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  });

  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  bindInstancedDispose(geometry, mesh);
  parent.add(mesh);
  return mesh;
}

function buildStreetGround(parent: THREE.Object3D): void {
  addGround(parent, 110, 0x74867b);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(3.3, 76),
    getAsphaltMaterial({ repeatX: 2, repeatY: 32 }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.006, -22.5);
  road.receiveShadow = true;
  parent.add(road);

  const paving = getPavingMaterial({ repeatX: 2, repeatY: 32 });
  for (const side of [-1, 1]) {
    const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 61), paving);
    sidewalk.position.set(side * 2.07, 0.02, -15);
    sidewalk.receiveShadow = true;
    parent.add(sidewalk);
  }

  const curbSpecs: BoxInstanceSpec[] = [];
  const laneSpecs: BoxInstanceSpec[] = [];
  const crosswalkSpecs: BoxInstanceSpec[] = [];
  const tactileBases: BoxInstanceSpec[] = [];
  const tactileRibs: BoxInstanceSpec[] = [];
  for (const side of [-1, 1]) {
    curbSpecs.push({
      position: { x: side * 1.57, y: 0.055, z: -15 },
      scale: { x: 0.14, y: 0.11, z: 61 },
    });
    tactileBases.push({
      position: { x: side * 1.88, y: 0.067, z: -15 },
      scale: { x: 0.27, y: 0.014, z: 59 },
    });
    for (let z = 14; z >= -44; z -= 0.38) {
      tactileRibs.push({
        position: { x: side * 1.88, y: 0.078, z },
        scale: { x: 0.22, y: 0.01, z: 0.035 },
      });
    }
  }
  for (let z = 12; z >= -36; z -= 4) {
    laneSpecs.push({ position: { x: 0, y: 0.014, z }, scale: { x: 0.11, y: 0.012, z: 1.6 } });
  }
  for (let index = 0; index < 7; index += 1) {
    crosswalkSpecs.push({
      position: { x: -1.35 + index * 0.45, y: 0.016, z: -38.6 },
      scale: { x: 0.24, y: 0.014, z: 2.15 },
    });
  }
  const paint = createMatteMaterial(0xd8d3c4, 0.76);
  createBoxInstances(parent, 'street-curbs', curbSpecs, createMatteMaterial(0xaaa99f));
  createBoxInstances(parent, 'street-lane-dashes', laneSpecs, paint);
  createBoxInstances(parent, 'street-crosswalk', crosswalkSpecs, paint);
  createBoxInstances(parent, 'street-tactile-bases', tactileBases, createMatteMaterial(0xc8a83f, 0.82));
  createBoxInstances(parent, 'street-tactile-ribs', tactileRibs, createMatteMaterial(0xe0be52, 0.78));

  const drainBases: BoxInstanceSpec[] = [];
  const drainBars: BoxInstanceSpec[] = [];
  const guardPosts: BoxInstanceSpec[] = [];
  const guardRails: BoxInstanceSpec[] = [];
  for (const side of [-1, 1]) {
    for (const z of [8, -8, -24, -36]) {
      const x = side * 1.43;
      drainBases.push({ position: { x, y: 0.016, z }, scale: { x: 0.28, y: 0.018, z: 0.52 } });
      for (let index = 0; index < 6; index += 1) {
        drainBars.push({
          position: { x: x - 0.11 + index * 0.044, y: 0.03, z },
          scale: { x: 0.017, y: 0.018, z: 0.46 },
        });
      }
    }
    for (const centerZ of [-3, -29]) {
      guardRails.push({
        position: { x: side * 1.64, y: 0.46, z: centerZ },
        scale: { x: 0.045, y: 0.055, z: 3.4 },
      });
      for (const offsetZ of [-1.55, 0, 1.55]) {
        guardPosts.push({
          position: { x: side * 1.64, y: 0.27, z: centerZ + offsetZ },
          scale: { x: 0.045, y: 0.48, z: 0.045 },
        });
      }
    }
  }
  createBoxInstances(parent, 'street-drain-bases', drainBases, createMatteMaterial(0x252f33));
  createBoxInstances(parent, 'street-drain-bars', drainBars, createMatteMaterial(0x657273, 0.45));
  createBoxInstances(parent, 'street-guard-posts', guardPosts, createMatteMaterial(0x6f7e80, 0.45));
  createBoxInstances(parent, 'street-guard-rails', guardRails, createMatteMaterial(0x879497, 0.4));

  const bollards: BoxInstanceSpec[] = [];
  const bollardBands: BoxInstanceSpec[] = [];
  for (const side of [-1, 1]) {
    for (const z of [-36.9, -40.2]) {
      bollards.push({
        position: { x: side * 1.4, y: 0.35, z },
        scale: { x: 0.055, y: 0.7, z: 0.055 },
      });
      for (const y of [0.25, 0.47]) {
        bollardBands.push({
          position: { x: side * 1.4, y, z },
          scale: { x: 0.058, y: 0.11, z: 0.058 },
        });
      }
    }
  }
  createCylinderInstances(parent, 'street-bollards', bollards, createMatteMaterial(0x293033, 0.48), true);
  createCylinderInstances(parent, 'street-bollard-bands', bollardBands, createMatteMaterial(0xe1b746, 0.55));

  const manhole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.022, 24),
    createMatteMaterial(0x465256, 0.42),
  );
  manhole.position.set(-0.78, 0.02, -17.5);
  parent.add(manhole);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.29, 0.012, 5, 24),
    createMatteMaterial(0x788487, 0.38),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(-0.78, 0.035, -17.5);
  parent.add(ring);
}

function buildStreetBuildings(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  const facadeMaterials: Record<FacadeKind, THREE.MeshStandardMaterial> = {
    tile: getFacadeTileMaterial({ repeatX: 3, repeatY: 2 }),
    concrete: getFacadeConcreteMaterial({ repeatX: 2, repeatY: 2 }),
    brick: getFacadeBrickMaterial({ repeatX: 3, repeatY: 2 }),
    plaster: getPlasterMaterial({ repeatX: 3, repeatY: 2 }),
  };
  const windowGlassMaterial = getFacadeWindowMaterial();
  const storeInteriorMaterial = getStoreInteriorMaterial();
  const frameMaterial = createMatteMaterial(0x455459, 0.72);
  const darkMetalMaterial = new THREE.MeshStandardMaterial({ color: 0x3b474b, roughness: 0.56, metalness: 0.42 });
  const trimMaterial = createMatteMaterial(0xb0aea4, 0.84);
  const copingMaterial = createMatteMaterial(0xc2bfb4, 0.86);
  const plinthMaterial = createMatteMaterial(0x7c8485, 0.88);
  const metalMaterial = createMatteMaterial(0x58696c, 0.52);
  const shutterMaterial = new THREE.MeshStandardMaterial({ color: 0x8a9294, roughness: 0.62, metalness: 0.32 });
  const waterTankMaterial = new THREE.MeshStandardMaterial({ color: 0xbac3c6, roughness: 0.36, metalness: 0.65 });
  const awningMaterials: Record<AwningTone, THREE.MeshStandardMaterial> = {
    teal: createMatteMaterial(0x456b64, 0.8),
    terracotta: createMatteMaterial(0x8c5642, 0.82),
    slate: createMatteMaterial(0x4a6375, 0.8),
  };
  const stripeMaterial = createMatteMaterial(0xddd4bc, 0.84);
  const copperMaterial = new THREE.MeshStandardMaterial({ color: 0x8f674c, roughness: 0.52, metalness: 0.48 });
  const doorBackMaterial = createMatteMaterial(0x3a4345, 0.9);
  const storeGlowMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe4af,
    emissive: 0xffc77d,
    emissiveIntensity: 0.9,
    roughness: 0.5,
  });
  const shopGlassMaterial = new THREE.MeshStandardMaterial({
    color: 0xbcd4d6,
    roughness: 0.16,
    metalness: 0.14,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });

  const plinths: BoxInstanceSpec[] = [];
  const shopPiers: BoxInstanceSpec[] = [];
  const beltCourses: BoxInstanceSpec[] = [];
  const overhangs: BoxInstanceSpec[] = [];
  const frames: BoxInstanceSpec[] = [];
  const windows: BoxInstanceSpec[] = [];
  const mullions: BoxInstanceSpec[] = [];
  const sills: BoxInstanceSpec[] = [];
  const lintels: BoxInstanceSpec[] = [];
  const balconies: BoxInstanceSpec[] = [];
  const rails: BoxInstanceSpec[] = [];
  const airConditioners: BoxInstanceSpec[] = [];
  const acGrilles: BoxInstanceSpec[] = [];
  const acBrackets: BoxInstanceSpec[] = [];
  const acPipeSegments: SegmentInstanceSpec[] = [];
  const awningByTone: Record<AwningTone, BoxInstanceSpec[]> = { teal: [], terracotta: [], slate: [] };
  const valanceByTone: Record<AwningTone, BoxInstanceSpec[]> = { teal: [], terracotta: [], slate: [] };
  const awningStripes: BoxInstanceSpec[] = [];
  const awningStruts: SegmentInstanceSpec[] = [];
  const signBoxes: BoxInstanceSpec[] = [];
  const signTrims: BoxInstanceSpec[] = [];
  const parapets: BoxInstanceSpec[] = [];
  const copings: BoxInstanceSpec[] = [];
  const parapetCrests: BoxInstanceSpec[] = [];
  const rooftopBulkheads: BoxInstanceSpec[] = [];
  const rooftopTanks: BoxInstanceSpec[] = [];
  const rooftopTankLegs: BoxInstanceSpec[] = [];
  const rooftopHvac: BoxInstanceSpec[] = [];
  const downpipes: BoxInstanceSpec[] = [];
  const storeBacks: BoxInstanceSpec[] = [];
  const doorBacks: BoxInstanceSpec[] = [];
  const shopGlassPanes: BoxInstanceSpec[] = [];
  const storeFrames: BoxInstanceSpec[] = [];
  const doorHandles: BoxInstanceSpec[] = [];
  const doorSteps: BoxInstanceSpec[] = [];
  const shutterBoxes: BoxInstanceSpec[] = [];
  const shutterSlats: BoxInstanceSpec[] = [];
  const shelves: BoxInstanceSpec[] = [];
  const goodsWarm: BoxInstanceSpec[] = [];
  const goodsCool: BoxInstanceSpec[] = [];
  const goodsLight: BoxInstanceSpec[] = [];
  const ceilingLights: BoxInstanceSpec[] = [];
  const aFrameFrames: BoxInstanceSpec[] = [];
  const aFrameBoards: BoxInstanceSpec[] = [];
  const sidePosterFrames: BoxInstanceSpec[] = [];
  const sidePosterTrims: BoxInstanceSpec[] = [];
  const sideUtilityBoxes: BoxInstanceSpec[] = [];
  const sideFlueBoxes: BoxInstanceSpec[] = [];
  const sideFluePipes: BoxInstanceSpec[] = [];
  const sideBladeBrackets: BoxInstanceSpec[] = [];
  const sideBladePlates: Array<BoxInstanceSpec & { color: number }> = [];
  const storeBackColors: number[] = [];

  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

  for (const [index, building] of BUILDINGS.entries()) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(building.size.w, building.size.h, building.size.d),
      facadeMaterials[building.facade],
    );
    wall.position.set(building.center.x, building.center.y, building.center.z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    parent.add(wall);
    occluders.push(wall);

    const side = building.center.x > 0 ? -1 : 1;
    const halfW = building.size.w / 2;
    const halfD = building.size.d / 2;
    const faceX = building.center.x + side * halfW;

    // 底层石材勒脚与立面门头左右壁柱，形成真实凹陷门廊框体；勒脚与层间腰线同步包绕 +Z / -Z 侧墙
    plinths.push(
      {
        position: { x: faceX + side * 0.04, y: 0.16, z: building.center.z },
        scale: { x: 0.08, y: 0.32, z: building.size.d - 0.06 },
      },
      {
        position: { x: building.center.x, y: 0.16, z: building.center.z + halfD + 0.035 },
        scale: { x: building.size.w + 0.08, y: 0.32, z: 0.07 },
      },
      {
        position: { x: building.center.x, y: 0.16, z: building.center.z - halfD - 0.035 },
        scale: { x: building.size.w + 0.08, y: 0.32, z: 0.07 },
      },
    );
    for (const pierZ of [-2.22, 2.08]) {
      shopPiers.push({
        position: { x: faceX + side * 0.12, y: 1.48, z: building.center.z + pierZ },
        scale: { x: 0.24, y: 2.96, z: 0.28 },
      });
    }

    // 层间腰线与挑出二层檐口，打破整块盒体平直剪影（正立面与侧墙连续包边）
    beltCourses.push(
      {
        position: { x: faceX + side * 0.08, y: 2.94, z: building.center.z },
        scale: { x: 0.16, y: 0.1, z: building.size.d + 0.06 },
      },
      {
        position: { x: building.center.x, y: 2.94, z: building.center.z + halfD + 0.045 },
        scale: { x: building.size.w + 0.1, y: 0.095, z: 0.09 },
      },
      {
        position: { x: building.center.x, y: 2.94, z: building.center.z - halfD - 0.045 },
        scale: { x: building.size.w + 0.1, y: 0.095, z: 0.09 },
      },
    );
    for (const beltY of [4.62, 6.32, 8.02, 9.72]) {
      if (beltY + 0.35 >= building.size.h) continue;
      beltCourses.push(
        {
          position: { x: faceX + side * 0.045, y: beltY, z: building.center.z },
          scale: { x: 0.09, y: 0.065, z: building.size.d + 0.02 },
        },
        {
          position: { x: building.center.x, y: beltY, z: building.center.z + halfD + 0.03 },
          scale: { x: building.size.w + 0.06, y: 0.06, z: 0.06 },
        },
      );
    }
    if (building.hasOverhang && building.size.h >= 5.2) {
      const overhangH = building.size.h - 3.05;
      overhangs.push({
        position: { x: faceX + side * 0.09, y: 3.05 + overhangH / 2, z: building.center.z },
        scale: { x: 0.18, y: overhangH, z: building.size.d - 0.6 },
      });
    }

    // 屋顶女儿墙、压顶包边、阶梯山墙/挑檐及楼顶设备剪影
    const parapetH = building.parapetStyle === 'stepped' ? 0.38 : 0.32;
    const parapetY = building.size.h + parapetH / 2;
    parapets.push(
      {
        position: { x: building.center.x, y: parapetY, z: building.center.z - (halfD - 0.08) },
        scale: { x: building.size.w, y: parapetH, z: 0.16 },
      },
      {
        position: { x: building.center.x, y: parapetY, z: building.center.z + (halfD - 0.08) },
        scale: { x: building.size.w, y: parapetH, z: 0.16 },
      },
      {
        position: { x: building.center.x - (halfW - 0.08), y: parapetY, z: building.center.z },
        scale: { x: 0.16, y: parapetH, z: building.size.d },
      },
      {
        position: { x: building.center.x + (halfW - 0.08), y: parapetY, z: building.center.z },
        scale: { x: 0.16, y: parapetH, z: building.size.d },
      },
    );
    const copingY = building.size.h + parapetH + 0.035;
    copings.push(
      {
        position: { x: faceX - side * 0.04, y: copingY, z: building.center.z },
        scale: { x: 0.24, y: 0.07, z: building.size.d + 0.08 },
      },
      {
        position: { x: building.center.x, y: copingY, z: building.center.z - (halfD - 0.08) },
        scale: { x: building.size.w + 0.06, y: 0.07, z: 0.22 },
      },
      {
        position: { x: building.center.x, y: copingY, z: building.center.z + (halfD - 0.08) },
        scale: { x: building.size.w + 0.06, y: 0.07, z: 0.22 },
      },
    );
    if (building.parapetStyle === 'stepped') {
      parapetCrests.push(
        {
          position: { x: faceX - side * 0.08, y: building.size.h + parapetH + 0.24, z: building.center.z },
          scale: { x: 0.18, y: 0.44, z: 3.4 },
        },
        {
          position: { x: faceX - side * 0.08, y: building.size.h + parapetH + 0.48, z: building.center.z },
          scale: { x: 0.24, y: 0.07, z: 3.55 },
        },
      );
    } else if (building.parapetStyle === 'cornice') {
      copings.push({
        position: { x: faceX + side * 0.15, y: building.size.h - 0.06, z: building.center.z },
        scale: { x: 0.34, y: 0.12, z: building.size.d + 0.14 },
      });
    }
    if (building.hasWaterTank) {
      const tankX = building.center.x + side * 1.4;
      const tankZ = building.center.z - 1.75;
      rooftopTanks.push({
        position: { x: tankX, y: building.size.h + 1.05, z: tankZ },
        scale: { x: 0.52, y: 1.18, z: 0.52 },
      });
      for (const lx of [-0.32, 0.32]) {
        for (const lz of [-0.32, 0.32]) {
          rooftopTankLegs.push({
            position: { x: tankX + lx, y: building.size.h + 0.28, z: tankZ + lz },
            scale: { x: 0.06, y: 0.56, z: 0.06 },
          });
        }
      }
      rooftopBulkheads.push({
        position: { x: building.center.x - side * 0.8, y: building.size.h + 0.75, z: building.center.z + 1.5 },
        scale: { x: 2.3, y: 1.5, z: 2.6 },
      });
    } else {
      rooftopHvac.push({
        position: { x: building.center.x + side * 1.85, y: building.size.h + 0.36, z: building.center.z + 1.4 },
        scale: { x: 0.85, y: 0.72, z: 1.05 },
      });
    }

    // 外墙落水管
    for (const offsetZ of [-(halfD - 0.38), halfD - 0.38]) {
      downpipes.push({
        position: { x: faceX + side * 0.13, y: building.size.h / 2, z: building.center.z + offsetZ },
        scale: { x: 0.035, y: building.size.h, z: 0.035 },
      });
    }

    // 上层住宅/办公窗阵列（配窗框、窗帘反光玻璃、窗棂、窗台与窗眉）
    const winFaceX = faceX + (building.hasOverhang ? side * 0.18 : 0);
    for (const offsetZ of [-2.55, 0, 2.55]) {
      for (const y of [3.72, 5.42, 7.12, 8.82]) {
        if (y + 0.68 >= building.size.h) continue;
        const z = building.center.z + offsetZ;
        frames.push({
          position: { x: winFaceX + side * 0.025, y, z },
          scale: { x: 0.05, y: 1.18, z: 1.12 },
        });
        windows.push({
          position: { x: winFaceX + side * 0.055, y, z },
          scale: { x: 0.032, y: 1.02, z: 0.94 },
        });
        mullions.push(
          {
            position: { x: winFaceX + side * 0.078, y, z },
            scale: { x: 0.024, y: 1.03, z: 0.035 },
          },
          {
            position: { x: winFaceX + side * 0.078, y: y + 0.16, z },
            scale: { x: 0.024, y: 0.035, z: 0.94 },
          },
        );
        sills.push({
          position: { x: winFaceX + side * 0.11, y: y - 0.61, z },
          scale: { x: 0.24, y: 0.075, z: 1.18 },
        });
        lintels.push({
          position: { x: winFaceX + side * 0.09, y: y + 0.62, z },
          scale: { x: 0.18, y: 0.065, z: 1.18 },
        });
      }
    }

    // 临街商铺三层景深门头：
    // 第一层：内凹暖光橱窗（z: center - 1.92 .. center + 0.62，宽 2.54m）
    const winCenterZ = building.center.z - 0.65;
    storeBacks.push({
      position: { x: faceX + side * 0.035, y: 1.02, z: winCenterZ },
      scale: { x: 0.04, y: 1.56, z: 2.52 },
    });
    storeBackColors.push(building.storeInteriorTint);
    shopGlassPanes.push({
      position: { x: faceX + side * 0.36, y: 1.02, z: winCenterZ },
      scale: { x: 0.018, y: 1.52, z: 2.48 },
    });
    for (const offsetZ of [-1.27, 0, 1.27]) {
      storeFrames.push({
        position: { x: faceX + side * 0.38, y: 1.02, z: winCenterZ + offsetZ },
        scale: { x: 0.055, y: 1.6, z: 0.055 },
      });
    }
    for (const y of [0.24, 1.8]) {
      storeFrames.push({
        position: { x: faceX + side * 0.38, y, z: winCenterZ },
        scale: { x: 0.055, y: 0.055, z: 2.6 },
      });
    }
    for (const shelfY of [0.56, 0.94, 1.32]) {
      shelves.push({
        position: { x: faceX + side * 0.17, y: shelfY, z: winCenterZ },
        scale: { x: 0.24, y: 0.05, z: 2.18 },
      });
      for (let item = 0; item < 9; item += 1) {
        const target = (item + index) % 3 === 0 ? goodsWarm : (item + index) % 3 === 1 ? goodsCool : goodsLight;
        target.push({
          position: {
            x: faceX + side * 0.27,
            y: shelfY + 0.125,
            z: winCenterZ - 0.96 + item * 0.24,
          },
          scale: { x: 0.12, y: 0.18 + ((item + index) % 3) * 0.035, z: 0.13 },
        });
      }
    }
    ceilingLights.push({
      position: { x: faceX + side * 0.2, y: 1.72, z: winCenterZ },
      scale: { x: 0.12, y: 0.04, z: 1.85 },
    });

    // 第二层：侧边内凹入户玻璃门 + 门把手 + 门槛 + 上方卷闸门箱
    const doorCenterZ = building.center.z + 1.28;
    doorBacks.push({
      position: { x: faceX + side * 0.03, y: 0.96, z: doorCenterZ },
      scale: { x: 0.04, y: 1.72, z: 1.06 },
    });
    shopGlassPanes.push({
      position: { x: faceX + side * 0.26, y: 1.04, z: doorCenterZ },
      scale: { x: 0.018, y: 1.54, z: 0.96 },
    });
    for (const offsetZ of [-0.52, 0.52]) {
      storeFrames.push({
        position: { x: faceX + side * 0.28, y: 0.98, z: doorCenterZ + offsetZ },
        scale: { x: 0.055, y: 1.72, z: 0.055 },
      });
    }
    for (const y of [0.16, 1.82]) {
      storeFrames.push({
        position: { x: faceX + side * 0.28, y, z: doorCenterZ },
        scale: { x: 0.055, y: 0.055, z: 1.1 },
      });
    }
    doorHandles.push({
      position: { x: faceX + side * 0.31, y: 0.98, z: doorCenterZ - 0.32 },
      scale: { x: 0.03, y: 0.26, z: 0.03 },
    });
    doorSteps.push({
      position: { x: faceX + side * 0.22, y: 0.06, z: doorCenterZ },
      scale: { x: 0.42, y: 0.12, z: 1.2 },
    });

    // 贯穿橱窗与入口门上方的卷闸门收容箱
    shutterBoxes.push({
      position: { x: faceX + side * 0.17, y: 1.94, z: building.center.z - 0.06 },
      scale: { x: 0.32, y: 0.22, z: 3.92 },
    });
    shutterSlats.push({
      position: { x: faceX + side * 0.335, y: 1.94, z: building.center.z - 0.06 },
      scale: { x: 0.018, y: 0.04, z: 3.84 },
    });

    // 第三层：外挑双色条纹斜坡遮阳篷 + 金属斜撑 + 立体外凸灯箱招牌（位于遮阳篷正上方）
    const awningCenterZ = building.center.z - 0.06;
    const awningWidth = 3.88;
    awningByTone[building.awningTone].push({
      position: { x: faceX + side * 0.45, y: 2.18, z: awningCenterZ },
      scale: { x: 0.86, y: 0.065, z: awningWidth },
      rotation: { x: 0, y: 0, z: -side * 0.16 },
    });
    for (let stripe = -4; stripe <= 4; stripe += 2) {
      awningStripes.push({
        position: { x: faceX + side * 0.45, y: 2.22, z: awningCenterZ + stripe * 0.42 },
        scale: { x: 0.86, y: 0.018, z: 0.2 },
        rotation: { x: 0, y: 0, z: -side * 0.16 },
      });
    }
    valanceByTone[building.awningTone].push({
      position: { x: faceX + side * 0.86, y: 2.04, z: awningCenterZ },
      scale: { x: 0.05, y: 0.17, z: awningWidth },
    });
    for (const end of [-1, 1]) {
      awningStruts.push({
        from: { x: faceX + side * 0.08, y: 1.82, z: awningCenterZ + end * 1.72 },
        to: { x: faceX + side * 0.81, y: 2.1, z: awningCenterZ + end * 1.72 },
        radius: 0.015,
      });
    }

    // 3D 外凸灯箱壳体与压条，安装在遮阳篷正上方（y=2.58），视线无遮挡且不过曝
    const signCenterY = 2.58;
    signBoxes.push({
      position: { x: faceX + side * 0.12, y: signCenterY, z: awningCenterZ },
      scale: { x: 0.18, y: building.signHeight + 0.1, z: building.signWidth + 0.18 },
    });
    for (const trimOffsetY of [-(building.signHeight / 2 + 0.055), building.signHeight / 2 + 0.055]) {
      signTrims.push({
        position: { x: faceX + side * 0.15, y: signCenterY + trimOffsetY, z: awningCenterZ },
        scale: { x: 0.22, y: 0.032, z: building.signWidth + 0.24 },
      });
    }
    const sign = createTextSign(building.shopName, building.signWidth, building.signHeight, {
      background: building.signBackground,
      foreground: building.signForeground,
    });
    sign.position.set(faceX + side * 0.22, signCenterY, awningCenterZ);
    sign.rotation.y = side * Math.PI / 2;
    sign.castShadow = false;
    if (sign.material instanceof THREE.MeshStandardMaterial) {
      sign.material.emissive.set(0xffcf94);
      sign.material.emissiveMap = sign.material.map;
      sign.material.emissiveIntensity = 0.22;
      sign.material.roughness = 0.88;
      sign.material.envMapIntensity = 0.3;
    }
    parent.add(sign);

    // 精选商铺门口小黑板立牌（紧贴商铺外侧，不挤占通行道）
    if (building.hasAFrame) {
      const boardZ = building.center.z + 2.85;
      const boardX = faceX + side * 0.34;
      for (const tilt of [-1, 1]) {
        aFrameFrames.push({
          position: { x: boardX + tilt * 0.08, y: 0.38, z: boardZ },
          scale: { x: 0.035, y: 0.74, z: 0.48 },
          rotation: { x: 0, y: 0, z: -tilt * 0.2 },
        });
        aFrameBoards.push({
          position: { x: boardX + tilt * 0.095, y: 0.41, z: boardZ },
          scale: { x: 0.014, y: 0.56, z: 0.4 },
          rotation: { x: 0, y: 0, z: -tilt * 0.2 },
        });
      }
    }

    // 二层小阳台（避开招牌高度，坐落于腰线之上）
    if (building.hasBalcony) {
      const z = building.center.z;
      balconies.push({
        position: { x: faceX + side * 0.36, y: 3.06, z },
        scale: { x: 0.72, y: 0.09, z: 2.2 },
      });
      for (let railIndex = 0; railIndex < 8; railIndex += 1) {
        rails.push({
          position: { x: faceX + side * 0.72, y: 3.38, z: z - 1.02 + railIndex * 0.29 },
          scale: { x: 0.035, y: 0.54, z: 0.035 },
        });
      }
      rails.push({
        position: { x: faceX + side * 0.72, y: 3.66, z },
        scale: { x: 0.05, y: 0.045, z: 2.18 },
      });
      for (const end of [-1, 1]) {
        rails.push({
          position: { x: faceX + side * 0.37, y: 3.66, z: z + end * 1.06 },
          scale: { x: 0.7, y: 0.045, z: 0.04 },
        });
      }
    }

    // 外挂空调外机、金属托架与批处理冷凝管线
    const acLevels = building.size.h >= 8.5 ? [4.45, 7.65] : [Math.min(building.size.h - 0.85, 4.45)];
    for (const [levelIdx, acY] of acLevels.entries()) {
      const acZ = building.center.z + (levelIdx % 2 === 0 ? 1.4 : -1.4);
      airConditioners.push({
        position: { x: winFaceX + side * 0.21, y: acY, z: acZ },
        scale: { x: 0.36, y: 0.38, z: 0.58 },
      });
      for (const offsetY of [-0.1, 0, 0.1]) {
        acGrilles.push({
          position: { x: winFaceX + side * 0.4, y: acY + offsetY, z: acZ },
          scale: { x: 0.018, y: 0.025, z: 0.45 },
        });
      }
      for (const offsetZ of [-0.22, 0.22]) {
        acBrackets.push({
          position: { x: winFaceX + side * 0.2, y: acY - 0.22, z: acZ + offsetZ },
          scale: { x: 0.38, y: 0.035, z: 0.035 },
        });
      }
      acPipeSegments.push(
        {
          from: { x: winFaceX + side * 0.34, y: acY - 0.14, z: acZ + 0.22 },
          to: { x: winFaceX + side * 0.16, y: acY - 0.58, z: acZ + 0.38 },
          radius: 0.013,
        },
        {
          from: { x: winFaceX + side * 0.16, y: acY - 0.58, z: acZ + 0.38 },
          to: { x: winFaceX + side * 0.12, y: Math.max(2.96, acY - 1.35), z: acZ + 0.42 },
          radius: 0.012,
        },
      );
    }

    // 侧墙差异化视觉细节（+Z 朝向主角行走视线 + -Z 背面窗格），彻底消除侧面大白墙/纯砖墙空白
    const frontSideZ = building.center.z + halfD;
    const posterX = faceX - side * 1.55;
    const poster = building.sidePoster;
    sidePosterFrames.push({
      position: { x: posterX, y: poster.centerY, z: frontSideZ + 0.032 },
      scale: { x: poster.width + 0.14, y: poster.height + 0.14, z: 0.055 },
    });
    sidePosterTrims.push(
      {
        position: { x: posterX, y: poster.centerY + poster.height / 2 + 0.08, z: frontSideZ + 0.055 },
        scale: { x: poster.width + 0.2, y: 0.04, z: 0.085 },
      },
      {
        position: { x: posterX, y: poster.centerY - poster.height / 2 - 0.08, z: frontSideZ + 0.055 },
        scale: { x: poster.width + 0.2, y: 0.035, z: 0.08 },
      },
    );
    const sideSign = createTextSign(poster.text, poster.width, poster.height, {
      background: poster.background,
      foreground: poster.foreground,
    });
    sideSign.position.set(posterX, poster.centerY, frontSideZ + 0.066);
    sideSign.castShadow = false;
    if (sideSign.material instanceof THREE.MeshStandardMaterial) {
      sideSign.material.roughness = 0.96;
      sideSign.material.metalness = 0;
      sideSign.material.envMapIntensity = 0.2;
    }
    parent.add(sideSign);

    // 侧墙楼道磨砂窗（高度与列数按建筑层高差异排布，复用全局窗框/玻璃 InstancedMesh，0 额外 DrawCall）
    const sideWindowXs = building.size.h >= 7.0
      ? [faceX - side * 1.35, faceX - side * 3.15]
      : [faceX - side * 2.45];
    for (const sideWinX of sideWindowXs) {
      for (const sideWinY of [3.82, 5.55, 7.28, 9.0]) {
        if (sideWinY + 0.68 >= building.size.h) continue;
        for (const zDir of [1, -1]) {
          const wallZ = building.center.z + zDir * halfD;
          frames.push({
            position: { x: sideWinX, y: sideWinY, z: wallZ + zDir * 0.025 },
            scale: { x: 0.96, y: 1.1, z: 0.05 },
          });
          windows.push({
            position: { x: sideWinX, y: sideWinY, z: wallZ + zDir * 0.054 },
            scale: { x: 0.8, y: 0.94, z: 0.03 },
          });
          mullions.push(
            {
              position: { x: sideWinX, y: sideWinY, z: wallZ + zDir * 0.075 },
              scale: { x: 0.032, y: 0.95, z: 0.022 },
            },
            {
              position: { x: sideWinX, y: sideWinY + 0.14, z: wallZ + zDir * 0.075 },
              scale: { x: 0.8, y: 0.03, z: 0.022 },
            },
          );
          sills.push({
            position: { x: sideWinX, y: sideWinY - 0.58, z: wallZ + zDir * 0.09 },
            scale: { x: 1.04, y: 0.07, z: 0.18 },
          });
          lintels.push({
            position: { x: sideWinX, y: sideWinY + 0.58, z: wallZ + zDir * 0.075 },
            scale: { x: 1.04, y: 0.06, z: 0.14 },
          });
        }
      }
    }

    // 侧墙差异化功能构件：早餐铺排烟罩+竖向镀锌烟道 / 便利店&打印店电表箱+穿线管 / 书屋木框橱窗 / 药房百叶风口
    const featureX = faceX - side * 3.35;
    if (building.sideFeature === 'flue') {
      const flueH = Math.max(2.6, building.size.h - 2.15);
      sideFlueBoxes.push(
        {
          position: { x: featureX, y: 1.95, z: frontSideZ + 0.16 },
          scale: { x: 0.72, y: 0.42, z: 0.32 },
        },
        {
          position: { x: featureX, y: 2.15 + flueH / 2, z: frontSideZ + 0.12 },
          scale: { x: 0.26, y: flueH, z: 0.22 },
        },
      );
      sideFluePipes.push({
        position: { x: featureX + side * 0.45, y: 1.4, z: frontSideZ + 0.08 },
        scale: { x: 0.04, y: 2.6, z: 0.04 },
      });
    } else if (building.sideFeature === 'meter') {
      sideUtilityBoxes.push(
        {
          position: { x: posterX + side * 0.45, y: 1.38, z: frontSideZ + 0.075 },
          scale: { x: 0.48, y: 0.58, z: 0.14 },
        },
        {
          position: { x: featureX, y: 1.48, z: frontSideZ + 0.065 },
          scale: { x: 0.34, y: 0.44, z: 0.12 },
        },
      );
      sideFluePipes.push(
        {
          position: { x: posterX + side * 0.45, y: 0.72, z: frontSideZ + 0.05 },
          scale: { x: 0.025, y: 1.3, z: 0.025 },
        },
        {
          position: { x: featureX, y: 2.35, z: frontSideZ + 0.05 },
          scale: { x: 0.022, y: 1.8, z: 0.022 },
        },
      );
    } else if (building.sideFeature === 'bookcase') {
      sidePosterFrames.push({
        position: { x: featureX, y: 1.52, z: frontSideZ + 0.045 },
        scale: { x: 1.24, y: 0.96, z: 0.08 },
      });
      sideUtilityBoxes.push({
        position: { x: featureX, y: 1.52, z: frontSideZ + 0.088 },
        scale: { x: 1.08, y: 0.8, z: 0.02 },
      });
    } else {
      for (const louverY of [1.42, 1.58, 1.74, 1.9]) {
        sideFlueBoxes.push({
          position: { x: featureX, y: louverY, z: frontSideZ + 0.06 },
          scale: { x: 0.68, y: 0.055, z: 0.1 },
        });
      }
      sideUtilityBoxes.push({
        position: { x: posterX - side * 0.55, y: 1.28, z: frontSideZ + 0.07 },
        scale: { x: 0.42, y: 0.5, z: 0.13 },
      });
    }

    // 街角挑出竖式小侧招（隔栋错落，严格避开人行道 x ∈ [-2.1, 2.1]，增添街景纵深层次）
    if (index === 0 || index === 1 || index === 3 || index === 4 || index === 5 || index === 6) {
      const bladeY = index % 2 === 0 ? 3.55 : 3.92;
      const bladeZ = frontSideZ - 0.42;
      const bladeX = faceX + side * 0.34;
      sideBladeBrackets.push(
        {
          position: { x: faceX + side * 0.18, y: bladeY + 0.44, z: bladeZ },
          scale: { x: 0.36, y: 0.035, z: 0.04 },
        },
        {
          position: { x: faceX + side * 0.18, y: bladeY - 0.44, z: bladeZ },
          scale: { x: 0.36, y: 0.035, z: 0.04 },
        },
      );
      sideBladePlates.push({
        position: { x: bladeX, y: bladeY, z: bladeZ },
        scale: { x: 0.32, y: 1.02, z: 0.06 },
        color: poster.accentColor,
      });
    }

    if ((index === 0 || index === 4 || index === 5) && (!coarsePointer || index === 5)) {
      const light = new THREE.PointLight(0xffbe72, 1.4, 3.8, 2);
      light.position.set(faceX + side * 0.9, 1.35, winCenterZ);
      parent.add(light);
    }
  }

  createBoxInstances(parent, 'street-building-plinths', plinths, plinthMaterial);
  createBoxInstances(parent, 'street-shop-piers', shopPiers, plinthMaterial, true);
  createBoxInstances(parent, 'street-belt-courses', beltCourses, trimMaterial);
  createBoxInstances(parent, 'street-building-overhangs', overhangs, copingMaterial, true);
  createBoxInstances(parent, 'street-window-recesses', frames, frameMaterial);
  createBoxInstances(parent, 'street-window-glass', windows, windowGlassMaterial);
  createBoxInstances(parent, 'street-window-mullions', mullions, trimMaterial);
  createBoxInstances(parent, 'street-window-sills', sills, trimMaterial);
  createBoxInstances(parent, 'street-window-lintels', lintels, copingMaterial);
  createBoxInstances(parent, 'street-balcony-slabs', balconies, trimMaterial, true);
  createBoxInstances(parent, 'street-balcony-rails', rails, metalMaterial);
  createBoxInstances(parent, 'street-ac-units', airConditioners, createMatteMaterial(0xb4bab5, 0.68), true);
  createBoxInstances(parent, 'street-ac-grilles', acGrilles, frameMaterial);
  createBoxInstances(parent, 'street-ac-brackets', acBrackets, darkMetalMaterial);
  createSegmentCylinderInstances(parent, 'street-ac-pipes', acPipeSegments, copperMaterial);
  createBoxInstances(parent, 'street-shop-awnings-teal', awningByTone.teal, awningMaterials.teal, true);
  createBoxInstances(parent, 'street-shop-awnings-terracotta', awningByTone.terracotta, awningMaterials.terracotta, true);
  createBoxInstances(parent, 'street-shop-awnings-slate', awningByTone.slate, awningMaterials.slate, true);
  createBoxInstances(parent, 'street-shop-valances-teal', valanceByTone.teal, awningMaterials.teal);
  createBoxInstances(parent, 'street-shop-valances-terracotta', valanceByTone.terracotta, awningMaterials.terracotta);
  createBoxInstances(parent, 'street-shop-valances-slate', valanceByTone.slate, awningMaterials.slate);
  createBoxInstances(parent, 'street-shop-awning-stripes', awningStripes, stripeMaterial);
  createSegmentCylinderInstances(parent, 'street-awning-struts', awningStruts, darkMetalMaterial);
  createBoxInstances(parent, 'street-sign-boxes', signBoxes, darkMetalMaterial);
  createBoxInstances(parent, 'street-sign-trims', signTrims, metalMaterial);
  createBoxInstances(parent, 'street-roof-parapets', parapets, trimMaterial, true);
  createBoxInstances(parent, 'street-roof-copings', copings, copingMaterial);
  createBoxInstances(parent, 'street-roof-crests', parapetCrests, trimMaterial, true);
  createBoxInstances(parent, 'street-rooftop-bulkheads', rooftopBulkheads, plinthMaterial, true);
  createCylinderInstances(parent, 'street-rooftop-tanks', rooftopTanks, waterTankMaterial, true);
  createBoxInstances(parent, 'street-rooftop-tank-legs', rooftopTankLegs, darkMetalMaterial);
  createBoxInstances(parent, 'street-rooftop-hvac', rooftopHvac, createMatteMaterial(0x9ea5a4, 0.72), true);
  createCylinderInstances(parent, 'street-downpipes', downpipes, frameMaterial, true);
  const storeBacksMesh = createBoxInstances(parent, 'street-store-backs', storeBacks, storeInteriorMaterial);
  if (storeBacksMesh) {
    const tintColor = new THREE.Color();
    storeBackColors.forEach((hex, idx) => {
      storeBacksMesh.setColorAt(idx, tintColor.setHex(hex));
    });
    if (storeBacksMesh.instanceColor) storeBacksMesh.instanceColor.needsUpdate = true;
  }
  createBoxInstances(parent, 'street-door-backs', doorBacks, doorBackMaterial);
  const shopGlassMesh = createBoxInstances(parent, 'street-shop-glass', shopGlassPanes, shopGlassMaterial);
  if (shopGlassMesh) shopGlassMesh.renderOrder = 2;
  createBoxInstances(parent, 'street-store-frames', storeFrames, darkMetalMaterial);
  createBoxInstances(parent, 'street-door-handles', doorHandles, waterTankMaterial);
  createBoxInstances(parent, 'street-door-steps', doorSteps, copingMaterial);
  createBoxInstances(parent, 'street-shutter-boxes', shutterBoxes, shutterMaterial);
  createBoxInstances(parent, 'street-shutter-slats', shutterSlats, darkMetalMaterial);
  createBoxInstances(parent, 'street-store-shelves', shelves, createMatteMaterial(0x8c7357, 0.78));
  createBoxInstances(parent, 'street-store-goods-warm', goodsWarm, createMatteMaterial(0xc98462, 0.72));
  createBoxInstances(parent, 'street-store-goods-cool', goodsCool, createMatteMaterial(0x6e9b9a, 0.7));
  createBoxInstances(parent, 'street-store-goods-light', goodsLight, createMatteMaterial(0xd6bd75, 0.74));
  createBoxInstances(parent, 'street-store-ceiling-lights', ceilingLights, storeGlowMaterial);
  createBoxInstances(parent, 'street-aframe-frames', aFrameFrames, createMatteMaterial(0x7c5f44, 0.84), true);
  createBoxInstances(parent, 'street-aframe-boards', aFrameBoards, createMatteMaterial(0x364341, 0.92));
  createBoxInstances(parent, 'street-side-poster-frames', sidePosterFrames, darkMetalMaterial, true);
  createBoxInstances(parent, 'street-side-poster-trims', sidePosterTrims, metalMaterial);
  createBoxInstances(parent, 'street-side-utility-boxes', sideUtilityBoxes, createMatteMaterial(0xa7adaa, 0.72), true);
  createBoxInstances(parent, 'street-side-flue-boxes', sideFlueBoxes, shutterMaterial, true);
  createCylinderInstances(parent, 'street-side-flue-pipes', sideFluePipes, frameMaterial);
  createBoxInstances(parent, 'street-side-blade-brackets', sideBladeBrackets, darkMetalMaterial);
  const bladePlatesMesh = createBoxInstances(
    parent,
    'street-side-blade-plates',
    sideBladePlates,
    createMatteMaterial(0xffffff, 0.82),
    true,
  );
  if (bladePlatesMesh) {
    const bladeColor = new THREE.Color();
    sideBladePlates.forEach((plate, idx) => {
      bladePlatesMesh.setColorAt(idx, bladeColor.setHex(plate.color));
    });
    if (bladePlatesMesh.instanceColor) bladePlatesMesh.instanceColor.needsUpdate = true;
  }
}

function buildVendingMachines(parent: THREE.Object3D): void {
  const glass = new THREE.MeshStandardMaterial({
    color: 0xa8c9cd,
    roughness: 0.16,
    metalness: 0.1,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
  });
  const panel = new THREE.MeshStandardMaterial({
    color: 0x34565c,
    emissive: 0x5f9b9b,
    emissiveIntensity: 0.45,
    roughness: 0.44,
  });
  const drinkColors = [0xe78a68, 0x78a9a0, 0xe2c064, 0x88a8c1];
  const placements: Array<{ buildingIndex: number; z: number; bodyColor: number; lightEmissive: number }> = [
    { buildingIndex: 0, z: 2.85, bodyColor: 0x4f817d, lightEmissive: 0x8fd6c8 },
    { buildingIndex: 4, z: -3.15, bodyColor: 0xb76850, lightEmissive: 0xff9c66 },
    { buildingIndex: 5, z: -8.85, bodyColor: 0x4f7480, lightEmissive: 0x8fd6c8 },
  ];

  for (const placement of placements) {
    const building = BUILDINGS[placement.buildingIndex];
    const side = building.center.x > 0 ? -1 : 1;
    const faceX = building.center.x + side * (building.size.w / 2);
    const z = placement.z;
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: placement.bodyColor,
      roughness: 0.52,
      metalness: 0.26,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 1.55, 0.78), bodyMaterial);
    body.position.set(faceX + side * 0.28, 0.82, z);
    body.castShadow = true;
    parent.add(body);

    const display = new THREE.Mesh(new THREE.BoxGeometry(0.018, 1.03, 0.58), panel);
    display.position.set(faceX + side * 0.52, 0.91, z);
    parent.add(display);
    const drinksGeometry = new THREE.BoxGeometry(0.035, 0.14, 0.1);
    const drinks = new THREE.InstancedMesh(
      drinksGeometry,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0.18 }),
      12,
    );
    const transform = new THREE.Object3D();
    for (let index = 0; index < 12; index += 1) {
      const row = Math.floor(index / 4);
      const column = index % 4;
      transform.position.set(
        faceX + side * 0.54,
        0.58 + row * 0.29,
        z - 0.21 + column * 0.14,
      );
      transform.updateMatrix();
      drinks.setMatrixAt(index, transform.matrix);
      drinks.setColorAt(index, new THREE.Color(drinkColors[(index + placement.buildingIndex) % drinkColors.length]));
    }
    drinks.instanceMatrix.needsUpdate = true;
    if (drinks.instanceColor) drinks.instanceColor.needsUpdate = true;
    drinks.computeBoundingBox();
    drinks.computeBoundingSphere();
    bindInstancedDispose(drinksGeometry, drinks);
    parent.add(drinks);

    const front = new THREE.Mesh(new THREE.BoxGeometry(0.012, 1.04, 0.6), glass);
    front.position.set(faceX + side * 0.565, 0.91, z);
    front.renderOrder = 3;
    parent.add(front);
    const lightBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.09, 0.62),
      new THREE.MeshStandardMaterial({
        color: 0xffd8a0,
        emissive: placement.lightEmissive,
        emissiveIntensity: 0.85,
        roughness: 0.5,
      }),
    );
    lightBar.position.set(faceX + side * 0.54, 1.52, z);
    parent.add(lightBar);
  }
}

function buildStreetTrees(parent: THREE.Object3D): void {
  const trees = [
    { x: -1.9, z: 9, height: 2.25, slender: false },
    { x: 1.9, z: 3, height: 2.52, slender: true },
    { x: -1.9, z: -14, height: 2.4, slender: true },
    { x: 1.9, z: -27, height: 2.18, slender: false },
  ];
  const clusterOffsets = [
    { x: -0.24, y: 2.38, z: -0.22, s: 0.42 },
    { x: 0.18, y: 2.45, z: 0.24, s: 0.5 },
    { x: -0.08, y: 2.62, z: 0.38, s: 0.43 },
    { x: 0.25, y: 2.72, z: -0.28, s: 0.46 },
    { x: -0.3, y: 2.83, z: 0.12, s: 0.38 },
    { x: 0.04, y: 2.94, z: -0.04, s: 0.52 },
    { x: 0.32, y: 3.08, z: 0.18, s: 0.36 },
    { x: -0.2, y: 3.18, z: -0.25, s: 0.4 },
    { x: 0.08, y: 3.38, z: 0.1, s: 0.38 },
    { x: -0.04, y: 3.55, z: -0.06, s: 0.28 },
  ];
  const pitBeds: BoxInstanceSpec[] = [];
  const pitBorders: BoxInstanceSpec[] = [];
  const pitGrates: BoxInstanceSpec[] = [];
  const trunks: BoxInstanceSpec[] = [];
  const branches: SegmentInstanceSpec[] = [];
  const bark = getBarkMaterial({ repeatX: 2, repeatY: 3 });
  const crownsGeometry = new THREE.IcosahedronGeometry(1, 1);
  const crowns = new THREE.InstancedMesh(
    crownsGeometry,
    getFoliageMaterial({ repeatX: 2, repeatY: 2 }),
    trees.length * clusterOffsets.length,
  );
  bindInstancedDispose(crownsGeometry, crowns);
  const transform = new THREE.Object3D();
  let crownIndex = 0;

  for (const [treeIndex, tree] of trees.entries()) {
    pitBeds.push({
      position: { x: tree.x, y: 0.065, z: tree.z },
      scale: { x: 0.62, y: 0.035, z: 0.7 },
    });
    for (const side of [-1, 1]) {
      pitBorders.push(
        {
          position: { x: tree.x + side * 0.34, y: 0.1, z: tree.z },
          scale: { x: 0.06, y: 0.1, z: 0.76 },
        },
        {
          position: { x: tree.x, y: 0.1, z: tree.z + side * 0.38 },
          scale: { x: 0.74, y: 0.1, z: 0.06 },
        },
      );
      pitGrates.push({
        position: { x: tree.x + side * 0.21, y: 0.086, z: tree.z },
        scale: { x: 0.03, y: 0.016, z: 0.64 },
      });
    }
    trunks.push({
      position: { x: tree.x, y: tree.height / 2 + 0.04, z: tree.z },
      scale: { x: 0.09, y: tree.height, z: 0.09 },
    });

    const inward = tree.x > 0 ? -1 : 1;
    const yShift = tree.height - 2.25;
    for (const branch of [
      { x: inward * 0.27, y: 2.6 + yShift, z: -0.25 },
      { x: -inward * 0.18, y: 2.75 + yShift, z: 0.28 },
      { x: inward * 0.12, y: 3.02 + yShift, z: 0.08 },
    ]) {
      branches.push({
        from: { x: tree.x, y: 1.55 + yShift * 0.6, z: tree.z },
        to: { x: tree.x + branch.x, y: branch.y, z: tree.z + branch.z },
        radius: 0.032,
      });
    }

    const xStretch = tree.slender ? 0.74 : 0.96;
    const yStretch = tree.slender ? 1.18 : 0.96;
    const zStretch = tree.slender ? 0.88 : 1.12;
    const palette = tree.slender
      ? [0x5e7d65, 0x6f8b6d, 0x809a75, 0x54725c]
      : [0x6d8564, 0x7f936d, 0x91a174, 0x627c62];

    for (const [clusterIndex, cluster] of clusterOffsets.entries()) {
      const scale = cluster.s * (0.9 + ((treeIndex + clusterIndex) % 4) * 0.055);
      transform.position.set(
        tree.x + cluster.x * inward * (tree.slender ? 0.78 : 1.05),
        cluster.y + yShift + (tree.slender ? 0.14 : 0),
        tree.z + cluster.z * (tree.slender ? 0.85 : 1.05),
      );
      transform.scale.set(scale * xStretch, scale * yStretch, scale * zStretch);
      transform.rotation.set(clusterIndex * 0.31, treeIndex * 0.72 + clusterIndex * 0.47, 0.1);
      transform.updateMatrix();
      crowns.setMatrixAt(crownIndex, transform.matrix);
      crowns.setColorAt(crownIndex, new THREE.Color(palette[(treeIndex + clusterIndex) % palette.length]));
      crownIndex += 1;
    }
  }

  createBoxInstances(parent, 'street-tree-pits', pitBeds, createMatteMaterial(0x514c3e, 0.94));
  createBoxInstances(parent, 'street-tree-pit-borders', pitBorders, createMatteMaterial(0x99998e));
  createBoxInstances(parent, 'street-tree-pit-grates', pitGrates, createMatteMaterial(0x586264, 0.72));
  createCylinderInstances(parent, 'street-tree-trunks', trunks, bark, true);
  createSegmentCylinderInstances(parent, 'street-tree-branches', branches, bark, true, 6);
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  crowns.name = 'street-tree-leaf-clusters';
  crowns.castShadow = true;
  crowns.receiveShadow = true;
  parent.add(crowns);
}

function buildStreetLamps(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  const metal = new THREE.MeshStandardMaterial({ color: 0x626c70, roughness: 0.68, metalness: 0.32 });
  const shadeMaterial = createMatteMaterial(0x717a76, 0.72);
  const glowMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe1a8,
    emissive: 0xffc875,
    emissiveIntensity: 1.15,
    roughness: 0.5,
    metalness: 0,
  });

  const poles: BoxInstanceSpec[] = [];
  const bases: BoxInstanceSpec[] = [];
  const arms: SegmentInstanceSpec[] = [];
  const shadeGeometry = new THREE.CylinderGeometry(0.08, 0.22, 0.18, 10, 1, true);
  const shades = new THREE.InstancedMesh(shadeGeometry, shadeMaterial, LAMP_POSTS.length);
  bindInstancedDispose(shadeGeometry, shades);
  const bulbGeometry = new THREE.SphereGeometry(0.09, 10, 7);
  const bulbs = new THREE.InstancedMesh(bulbGeometry, glowMaterial, LAMP_POSTS.length);
  bindInstancedDispose(bulbGeometry, bulbs);
  const transform = new THREE.Object3D();

  LAMP_POSTS.forEach((post, index) => {
    poles.push({ position: { x: post.x, y: 2, z: post.z }, scale: { x: 0.065, y: 4, z: 0.065 } });
    bases.push({ position: { x: post.x, y: 0.09, z: post.z }, scale: { x: 0.145, y: 0.18, z: 0.145 } });
    const headX = post.x - Math.sign(post.x) * 1.15;
    arms.push({
      from: { x: post.x, y: 4.02, z: post.z },
      to: { x: headX, y: 4.02, z: post.z },
      radius: 0.025,
    });
    transform.position.set(headX, 4.1, post.z);
    transform.rotation.set(0, 0, 0);
    transform.scale.set(1, 1, 1);
    transform.updateMatrix();
    shades.setMatrixAt(index, transform.matrix);

    transform.position.set(headX, 3.99, post.z);
    transform.updateMatrix();
    bulbs.setMatrixAt(index, transform.matrix);
  });

  const poleMesh = createCylinderInstances(parent, 'street-lamp-poles', poles, metal, true);
  if (poleMesh) occluders.push(poleMesh);
  createCylinderInstances(parent, 'street-lamp-bases', bases, metal);
  createSegmentCylinderInstances(parent, 'street-lamp-arms', arms, metal, true, 6);
  shades.instanceMatrix.needsUpdate = true;
  shades.name = 'street-lamp-shades';
  shades.computeBoundingBox();
  shades.computeBoundingSphere();
  bulbs.instanceMatrix.needsUpdate = true;
  bulbs.name = 'street-lamp-bulbs';
  bulbs.computeBoundingBox();
  bulbs.computeBoundingSphere();
  parent.add(shades, bulbs);
}

function buildUtilityPoles(parent: THREE.Object3D): void {
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x4a5150, roughness: 0.78, metalness: 0.08 });
  const wireMaterial = new THREE.MeshBasicMaterial({ color: 0x263238 });
  const ceramicMaterial = new THREE.MeshStandardMaterial({ color: 0xa9c0bd, roughness: 0.3, metalness: 0.08 });
  const yellowMaterial = createMatteMaterial(0xd8ae38, 0.58);
  const blackMaterial = createMatteMaterial(0x252b2c, 0.62);
  const poles: BoxInstanceSpec[] = [];
  const crossarms: BoxInstanceSpec[] = [];
  const insulators: BoxInstanceSpec[] = [];
  const yellowBands: BoxInstanceSpec[] = [];
  const blackBands: BoxInstanceSpec[] = [];
  const zPositions = [11, -5, -21, -37];

  for (const side of [-1, 1]) {
    const x = side * 2.3;
    for (const z of zPositions) {
      poles.push({ position: { x, y: 3.1, z }, scale: { x: 0.072, y: 6.2, z: 0.072 } });
      crossarms.push({ position: { x, y: 5.72, z }, scale: { x: 0.9, y: 0.075, z: 0.09 } });
      for (const offsetX of [-0.32, 0.32]) {
        insulators.push({
          position: { x: x + offsetX, y: 5.84, z },
          scale: { x: 0.045, y: 0.16, z: 0.045 },
        });
      }
      for (let band = 0; band < 6; band += 1) {
        const target = band % 2 === 0 ? yellowBands : blackBands;
        target.push({
          position: { x, y: 0.24 + band * 0.17, z },
          scale: { x: 0.085, y: 0.17, z: 0.085 },
        });
      }
    }

    for (let span = 0; span < zPositions.length - 1; span += 1) {
      for (const offsetX of [-0.32, 0.32]) {
        const startZ = zPositions[span];
        const endZ = zPositions[span + 1];
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(x + offsetX, 5.92, startZ),
          new THREE.Vector3(x + offsetX, 5.48, startZ * 0.66 + endZ * 0.34),
          new THREE.Vector3(x + offsetX, 5.48, startZ * 0.34 + endZ * 0.66),
          new THREE.Vector3(x + offsetX, 5.92, endZ),
        ]);
        parent.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.008, 3, false), wireMaterial));
      }
    }
  }

  for (const z of [-5, -21]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-2.62, 5.75, z),
      new THREE.Vector3(0, 5.08, z + 0.25),
      new THREE.Vector3(2.62, 5.75, z),
    ]);
    parent.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.007, 3, false), wireMaterial));
  }

  createCylinderInstances(parent, 'street-utility-poles', poles, poleMaterial, true);
  createBoxInstances(parent, 'street-utility-crossarms', crossarms, poleMaterial, true);
  createCylinderInstances(parent, 'street-utility-insulators', insulators, ceramicMaterial);
  createCylinderInstances(parent, 'street-utility-yellow-bands', yellowBands, yellowMaterial);
  createCylinderInstances(parent, 'street-utility-black-bands', blackBands, blackMaterial);
}

function buildStreetProps(parent: THREE.Object3D): void {
  // 双格分类垃圾桶（批处理 InstancedMesh）
  const binBodies: BoxInstanceSpec[] = [];
  const binHoods: BoxInstanceSpec[] = [];
  const binRecyclable: BoxInstanceSpec[] = [];
  const binOther: BoxInstanceSpec[] = [];
  for (const position of [
    { x: -2.1, z: 4 },
    { x: 2.1, z: -18 },
    { x: -2.1, z: -33 },
  ]) {
    const inward = position.x > 0 ? -1 : 1;
    binBodies.push({ position: { x: position.x, y: 0.36, z: position.z }, scale: { x: 0.34, y: 0.6, z: 0.68 } });
    binHoods.push({ position: { x: position.x, y: 0.72, z: position.z }, scale: { x: 0.38, y: 0.14, z: 0.72 } });
    binRecyclable.push({
      position: { x: position.x + inward * 0.176, y: 0.44, z: position.z - 0.16 },
      scale: { x: 0.02, y: 0.28, z: 0.26 },
    });
    binOther.push({
      position: { x: position.x + inward * 0.176, y: 0.44, z: position.z + 0.16 },
      scale: { x: 0.02, y: 0.28, z: 0.26 },
    });
  }
  createBoxInstances(parent, 'street-bins-body', binBodies, createMatteMaterial(0x556463, 0.8), true);
  createBoxInstances(parent, 'street-bins-hood', binHoods, createMatteMaterial(0x3f4c4c, 0.76));
  createBoxInstances(parent, 'street-bins-recyclable', binRecyclable, createMatteMaterial(0x4a7ea1, 0.72));
  createBoxInstances(parent, 'street-bins-other', binOther, createMatteMaterial(0x5c7c60, 0.74));

  // 停靠路边的低多边形校园自行车（3 辆批处理，仅 3 个 DrawCall）
  const bikeSpots = [
    { x: 2.12, z: 6.5, dir: 1 },
    { x: -2.12, z: -10.6, dir: -1 },
    { x: 2.12, z: -30.5, dir: 1 },
  ];
  const bicycleMaterial = new THREE.MeshStandardMaterial({ color: 0x627c7d, roughness: 0.6, metalness: 0.34 });
  const tireMaterial = createMatteMaterial(0x2f3537, 0.88);
  const wheelGeometry = new THREE.TorusGeometry(0.31, 0.024, 6, 16);
  const wheels = new THREE.InstancedMesh(wheelGeometry, tireMaterial, bikeSpots.length * 2);
  bindInstancedDispose(wheelGeometry, wheels);
  const bikeFrameSegments: SegmentInstanceSpec[] = [];
  const bikeSaddles: BoxInstanceSpec[] = [];
  const transform = new THREE.Object3D();

  bikeSpots.forEach((spot, index) => {
    const rear = { x: spot.x, y: 0.38, z: spot.z + spot.dir * 0.55 };
    const front = { x: spot.x, y: 0.38, z: spot.z - spot.dir * 0.55 };
    const crank = { x: spot.x, y: 0.44, z: spot.z + spot.dir * 0.05 };
    const seat = { x: spot.x, y: 0.88, z: spot.z + spot.dir * 0.25 };
    const handle = { x: spot.x, y: 0.92, z: spot.z - spot.dir * 0.38 };

    for (const [wheelOffset, point] of [rear, front].entries()) {
      transform.position.set(point.x, point.y, point.z);
      transform.rotation.set(0, Math.PI / 2, 0);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      wheels.setMatrixAt(index * 2 + wheelOffset, transform.matrix);
    }
    for (const [from, to] of [
      [rear, crank],
      [crank, front],
      [crank, seat],
      [seat, rear],
      [seat, handle],
      [handle, front],
    ] as const) {
      bikeFrameSegments.push({ from, to, radius: 0.017 });
    }
    bikeFrameSegments.push({
      from: { x: spot.x - 0.14, y: 0.98, z: spot.z - spot.dir * 0.42 },
      to: { x: spot.x + 0.14, y: 0.98, z: spot.z - spot.dir * 0.42 },
      radius: 0.014,
    });
    bikeSaddles.push({
      position: { x: spot.x, y: 0.91, z: spot.z + spot.dir * 0.28 },
      scale: { x: 0.16, y: 0.045, z: 0.25 },
    });
  });

  wheels.instanceMatrix.needsUpdate = true;
  wheels.name = 'street-bike-wheels';
  wheels.castShadow = true;
  wheels.receiveShadow = true;
  wheels.computeBoundingBox();
  wheels.computeBoundingSphere();
  parent.add(wheels);
  createSegmentCylinderInstances(parent, 'street-bike-frames', bikeFrameSegments, bicycleMaterial, true, 6);
  createBoxInstances(parent, 'street-bike-saddles', bikeSaddles, createMatteMaterial(0x3c4344, 0.84));

  const signPole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.8, 7), bicycleMaterial);
  signPole.position.set(-2.1, 0.96, -34);
  parent.add(signPole);
  const trafficSign = createTextSign('学校区域', 0.74, 0.34, {
    background: '#5e737c',
    foreground: '#ece8dc',
  });
  trafficSign.position.set(-2.1, 1.86, -34);
  trafficSign.castShadow = false;
  if (trafficSign.material instanceof THREE.MeshStandardMaterial) {
    trafficSign.material.roughness = 0.92;
    trafficSign.material.envMapIntensity = 0.28;
  }
  parent.add(trafficSign);
}

function buildStreetFarEnclosure(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  const wallMaterial = getPlasterMaterial({ repeatX: 3, repeatY: 1 });
  const campusGround = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 55),
    createMatteMaterial(0x718276, 0.96),
  );
  campusGround.rotation.x = -Math.PI / 2;
  campusGround.position.set(0, -0.015, -57);
  campusGround.receiveShadow = true;
  parent.add(campusGround);
  const campusPath = new THREE.Mesh(
    new THREE.PlaneGeometry(5.4, 26),
    getPavingMaterial({ repeatX: 4, repeatY: 18 }),
  );
  campusPath.rotation.x = -Math.PI / 2;
  campusPath.position.set(0, 0.008, -56.5);
  campusPath.receiveShadow = true;
  parent.add(campusPath);

  const sidePillars: BoxInstanceSpec[] = [];
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(8.6, 2.5, 0.36), wallMaterial);
    wall.position.set(side * 6.25, 1.25, -44.85);
    wall.castShadow = true;
    wall.receiveShadow = true;
    parent.add(wall);
    occluders.push(wall);
    addBox(parent, { x: side * 6.25, y: 2.55, z: -44.85 }, { w: 8.75, h: 0.12, d: 0.48 }, 0x969c96);

    addBox(
      parent,
      { x: side * 5.85, y: 0.72, z: -14.5 },
      { w: 0.28, h: 1.44, d: 61 },
      0x87958b,
      { castShadow: true },
    );
    addBox(
      parent,
      { x: side * 5.85, y: 1.47, z: -14.5 },
      { w: 0.38, h: 0.09, d: 61 },
      0xa3aaa0,
      { castShadow: false },
    );
    for (let z = 14; z >= -44; z -= 5.8) {
      sidePillars.push({
        position: { x: side * 5.85, y: 0.88, z },
        scale: { x: 0.48, y: 1.76, z: 0.48 },
      });
    }
  }
  createBoxInstances(parent, 'street-side-wall-pillars', sidePillars, createMatteMaterial(0x919b91), true);

  const sideWings = [
    { center: { x: -11, y: 4.5, z: 13 }, size: { w: 9, h: 9, d: 11 } },
    { center: { x: 11, y: 5, z: 12 }, size: { w: 9, h: 10, d: 13 } },
    { center: { x: -13, y: 5.5, z: -15 }, size: { w: 10, h: 11, d: 18 } },
    { center: { x: 13, y: 4.5, z: -18 }, size: { w: 10, h: 9, d: 17 } },
    { center: { x: -12, y: 5, z: -42 }, size: { w: 11, h: 10, d: 15 } },
    { center: { x: 12, y: 6, z: -43 }, size: { w: 11, h: 12, d: 16 } },
  ];
  for (const wing of sideWings) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(wing.size.w, wing.size.h, wing.size.d), wallMaterial);
    mesh.position.set(wing.center.x, wing.center.y, wing.center.z);
    mesh.receiveShadow = true;
    parent.add(mesh);
    addBox(
      parent,
      { x: wing.center.x, y: wing.size.h + 0.16, z: wing.center.z },
      { w: wing.size.w + 0.25, h: 0.32, d: wing.size.d + 0.25 },
      0x7d8b86,
      { castShadow: false },
    );
  }

  const school = new THREE.Mesh(new THREE.BoxGeometry(22, 10, 8), wallMaterial);
  school.position.set(0, 5, -65);
  school.receiveShadow = true;
  parent.add(school);
  addBox(parent, { x: 0, y: 10.25, z: -65 }, { w: 22.6, h: 0.5, d: 8.6 }, 0x778c91, {
    castShadow: false,
  });
  addBox(parent, { x: 0, y: 1.1, z: -60.94 }, { w: 3.2, h: 2.2, d: 0.12 }, 0x536f75, {
    castShadow: false,
  });
  const schoolWindows: BoxInstanceSpec[] = [];
  for (const x of [-8.5, -6, -3.5, 3.5, 6, 8.5]) {
    for (const y of [2.3, 4.5, 6.7, 8.5]) {
      schoolWindows.push({
        position: { x, y, z: -60.94 },
        scale: { x: 1.15, y: 1.25, z: 0.08 },
      });
    }
  }
  createBoxInstances(parent, 'street-distant-school-windows', schoolWindows, getWindowGlassMaterial());

  const silhouettes = [
    { center: { x: -16, y: 5, z: -57 }, size: { w: 10, h: 10, d: 10 }, color: 0x718b8d },
    { center: { x: 16, y: 6, z: -60 }, size: { w: 11, h: 12, d: 10 }, color: 0x7c9294 },
    { center: { x: 0, y: 6, z: -79 }, size: { w: 18, h: 12, d: 8 }, color: 0x879c9c },
  ];
  for (const building of silhouettes) {
    addBox(parent, building.center, building.size, building.color, { castShadow: false });
  }

  occluders.push(addBox(parent, { x: -1.6, y: 2.1, z: -44.8 }, { w: 0.7, h: 4.2, d: 0.7 }, 0x7f8f92));
  occluders.push(addBox(parent, { x: 1.6, y: 2.1, z: -44.8 }, { w: 0.7, h: 4.2, d: 0.7 }, 0x7f8f92));
  occluders.push(addBox(parent, { x: 0, y: 4.15, z: -44.8 }, { w: 4.6, h: 0.5, d: 0.6 }, 0x7f8f92));
}

function buildStreetEnvironment(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  buildStreetGround(parent);
  buildStreetBuildings(parent, occluders);
  buildVendingMachines(parent);
  buildStreetTrees(parent);
  buildStreetLamps(parent, occluders);
  buildUtilityPoles(parent);
  buildStreetProps(parent);
  buildStreetFarEnclosure(parent, occluders);
}

function buildStreet(parent: THREE.Object3D): {
  occluders: THREE.Object3D[];
  actors: Record<string, THREE.Object3D>;
} {
  const occluders: THREE.Object3D[] = [];
  const actors: Record<string, THREE.Object3D> = {};
  buildStreetEnvironment(parent, occluders);

  // 行李与迎新志愿者 / 新生（面对面交谈，站位与碰撞盒保持不变）
  for (const [index, npc] of STREET_NPCS.entries()) {
    const studentPos = { x: npc.group.x - 0.75, z: npc.group.z + 0.15 };
    const greeter = createCharacterActor(npc.greeterModel, 1.72, npc.greeterColor, {
      yaw: yawToward(npc.group, studentPos),
    });
    greeter.position.set(npc.group.x, 0, npc.group.z);
    const student = createCharacterActor(npc.studentModel, 1.62, npc.studentColor, {
      yaw: yawToward(studentPos, npc.group),
    });
    student.position.set(studentPos.x, 0, studentPos.z);
    const luggage = addBox(
      parent,
      { x: npc.luggage.x, y: 0.28, z: npc.luggage.z },
      { w: 0.55, h: 0.56, d: 0.36 },
      0x7e8696,
    );
    parent.add(greeter, student);
    occluders.push(greeter, student, luggage);
    actors[`npc-${index}-greeter`] = greeter;
    actors[`npc-${index}-student`] = student;
  }

  // 举牌放在角色右侧斜前方，错开 5 号商铺暖光灯（z=-12.65）避免脸部过曝，且不遮挡挥手动作
  const volunteer = createCharacterActor('volunteer', 1.66, 0xb08a72, { yaw: -0.35 });
  volunteer.position.set(1.88, 0, -13.75);
  const signAssembly = new THREE.Group();
  signAssembly.name = 'street-volunteer-sign';
  signAssembly.position.set(0.98, 1.06, -13.25);
  signAssembly.rotation.y = -0.22;

  const signBack = new THREE.Mesh(
    new THREE.BoxGeometry(1.34, 0.54, 0.036),
    createMatteMaterial(0x364743, 0.9),
  );
  signBack.castShadow = true;
  signBack.receiveShadow = true;

  const sign = createTextSign('新生报到 →', 1.26, 0.46, {
    background: '#dfd8c6',
    foreground: '#2b3e38',
  });
  sign.position.set(0, 0, 0.022);
  sign.castShadow = false;
  if (sign.material instanceof THREE.MeshStandardMaterial) {
    sign.material.roughness = 0.96;
    sign.material.metalness = 0;
    sign.material.envMapIntensity = 0.22;
  }

  const signPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.024, 1.12, 8),
    createMatteMaterial(0x645d52, 0.78),
  );
  signPole.position.set(0, -0.56, -0.01);
  signPole.castShadow = true;

  const signBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.19, 0.04, 10),
    createMatteMaterial(0x3d4648, 0.84),
  );
  signBase.position.set(0, -1.1, -0.01);
  signBase.receiveShadow = true;

  signAssembly.add(signBack, sign, signPole, signBase);
  parent.add(volunteer, signAssembly);
  occluders.push(volunteer, signBack);
  actors['sign-volunteer'] = volunteer;

  return { occluders, actors };
}

/** 手机震动预告文案（概括表达，无真实应用名） */
const VIBRATION_PREVIEWS = {
  'street-vibration-1': '迎新群：@所有人 新生报到 9:00 截止，请抓紧～',
  'street-vibration-2': '迎新群：有人@你，快看群消息。',
} as const;

const vibrationTimers: number[] = [];
/** 站立 NPC 的呼吸 / 微摆清理函数，exit 必杀避免补间泄漏 */
let idleDisposers: Array<() => void> = [];
interface StreetAnimatedNpc {
  actor: THREE.Object3D;
  clips: readonly string[];
  switchSec: number;
  timer: number;
  clipIndex: number;
  controller: CharacterAnimationController | null;
}
let streetAnimatedNpcs: StreetAnimatedNpc[] = [];

function stopIdleMotions(): void {
  for (const dispose of idleDisposers) dispose();
  idleDisposers = [];
}

function disposeStreetAnimations(): void {
  for (const entry of streetAnimatedNpcs) entry.controller?.dispose();
  streetAnimatedNpcs = [];
}

function startStreetIdleMotions(actors: Record<string, THREE.Object3D>): void {
  let index = 0;
  for (const id of [
    'npc-0-greeter',
    'npc-0-student',
    'npc-1-greeter',
    'npc-1-student',
    'sign-volunteer',
  ]) {
    const actor = actors[id];
    if (!actor) continue;
    idleDisposers.push(
      startIdleMotion(actor, {
        breathAmp: 0.005,
        swayAmp: 0.004,
        period: 2.7 + index * 0.27,
      }),
    );
    index += 1;
  }
  disposeStreetAnimations();
  const specs: Array<{ id: string; clips: readonly string[]; switchSec: number }> = [
    { id: 'sign-volunteer', clips: ['wave_goodbye_02', 'wait', 'agree'], switchSec: 7.5 },
    { id: 'npc-0-greeter', clips: ['agree', 'wait'], switchSec: 8.5 },
    { id: 'npc-1-greeter', clips: ['wait', 'agree'], switchSec: 9.2 },
  ];
  for (const spec of specs) {
    const actor = actors[spec.id];
    if (!actor) continue;
    const entry: StreetAnimatedNpc = {
      actor,
      clips: spec.clips,
      switchSec: spec.switchSec,
      timer: 0,
      clipIndex: 0,
      controller: createActorAnimation(actor),
    };
    entry.controller?.play(entry.clips[0], { fadeIn: 0.35, timeScale: 0.88, loop: true });
    streetAnimatedNpcs.push(entry);
  }
}

/** S4 运行时装：进入后 4s / 26s 各震动一次（间隔 22s ≥ 20s）；驱动迎新女老师周期挥手与待机 */
export const streetRuntime: SceneRuntime = {
  enter(context: SceneRuntimeContext): void {
    if (context.sceneId !== 'S4') return;
    stopIdleMotions();
    startStreetIdleMotions(context.actors);
    const schedule: Array<{ id: keyof typeof VIBRATION_PREVIEWS; delayMs: number }> = [
      { id: 'street-vibration-1', delayMs: 4000 },
      { id: 'street-vibration-2', delayMs: 26000 },
    ];
    for (const item of schedule) {
      vibrationTimers.push(
        window.setTimeout(() => {
          context.bus.emit('ui:phoneVibrate', {
            vibrationId: item.id,
            preview: VIBRATION_PREVIEWS[item.id],
          });
        }, item.delayMs),
      );
    }
  },

  tick(dtSeconds: number): void {
    if (dtSeconds <= 0) return;
    for (const entry of streetAnimatedNpcs) {
      if (!entry.actor.visible) continue;
      if (!entry.controller) {
        entry.controller = createActorAnimation(entry.actor);
        entry.controller?.play(entry.clips[entry.clipIndex], { fadeIn: 0.35, timeScale: 0.88, loop: true });
      }
      if (!entry.controller) continue;
      entry.timer += dtSeconds;
      if (entry.timer >= entry.switchSec) {
        entry.timer = 0;
        entry.clipIndex = (entry.clipIndex + 1) % entry.clips.length;
        entry.controller.play(entry.clips[entry.clipIndex], { fadeIn: 0.45, timeScale: 0.88, loop: true });
      }
      entry.controller.update(dtSeconds);
    }
  },

  exit(): void {
    stopIdleMotions();
    disposeStreetAnimations();
    for (const timer of vibrationTimers) window.clearTimeout(timer);
    vibrationTimers.length = 0;
  },
};

export function createStreetDefinition(_sceneId: SceneId): WorldSceneDefinition {
  return {
    sceneKey: 'street',
    spawn: SPAWN,
    nav: NAV,
    // 进 S4 时按需预载：举牌志愿者 + 路边与新生交谈的志愿者 / 阿远
    requiredModels: ['volunteer', 'ayuan'],
    zones: [
      {
        id: 'stairs',
        kind: 'box',
        center: STAIRS_ZONE_CENTER,
        size: { x: 10, y: 3, z: 9 },
      },
    ],
    targetGuides: [{ id: 's4-gate-guide', position: TARGET_GUIDE }],
    fog: { color: 0xb9c6d2, near: 16, far: 68 },
    build: buildStreet,
  };
}

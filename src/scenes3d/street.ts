// scenes3d/street.ts —— 上学街道（S4 自由移动开始）
// 进入 S4 后调度两次手机震动（间隔 ≥ 20s）；离开 S4 时 streetRuntime.exit() 必须清除未触发的定时器。

import * as THREE from 'three';
import type { SceneId } from '../data/storySchema';
import type { ObstacleAabb } from '../world/navMath';
import type {
  HotspotConfig,
  InteractableConfig,
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
import type { CharacterModelId } from './modelManifest';
import type { BoxSize, Vec3 } from './shared';
import { createCanopyCardBatch } from './canopy';
import type { CanopyCardSpec } from './canopy';
import { canopyBudget, getQualityTier } from '../world/quality';
import type { PropModelAsset } from '../world/resources';
import { SHARED_RESOURCE_FLAG, loadPropModel } from '../world/resources';
import {
  createContactShadowDiscBatch,
  getAsphaltMaterial,
  getBarkMaterial,
  getFacadeBrickMaterial,
  getFacadeConcreteMaterial,
  getFacadeTileMaterial,
  getFacadeWindowMaterial,
  getPavingMaterial,
  getPlasterMaterial,
  getStoreInteriorMaterial,
  getWarmLampGlowMaterial,
  getWindowGlassMaterial,
} from './materials';

type FacadeKind = 'tile' | 'concrete' | 'brick' | 'plaster';
type ParapetStyle = 'flat' | 'stepped' | 'cornice';
type AwningTone = 'teal' | 'terracotta' | 'slate' | 'bakery';

interface BuildingSpec {
  center: Vec3;
  size: BoxSize;
  color: number;
  facade: FacadeKind;
  /** 立面贴图上的整体调色（乘法叠加），用于把某栋楼的门面单独改色 */
  facadeTint?: number;
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
  /**
   * 甜品面包店专属陈设（对应提示词包的"必须保留"清单）：
   * 招牌右端三块蛋糕图案、立面白色装饰线、波浪垂边、门口两盆陶土小松树、粉色 A 字小黑板、橱窗甜品剪影。
   */
  bakeryDressing?: boolean;
  /** 拱顶单栋铺面：半圆柱桶拱起拱于墙顶，拱面开小窗，人行道摆水果堆头 */
  barrelRoof?: {
    /** 拱顶哑光色 */
    color: number;
    /** 拱高相对半径的压缩比，1 为完整半圆 */
    riseScale: number;
    /** 桶拱沿进深方向（垂直临街面）的长度 */
    depth: number;
    /** 拱面小窗相对 center.z 的横向偏移 */
    windowOffsetsZ: number[];
    /** 拱面小窗离地高度 */
    windowY: number;
  };
}

/** 两侧街楼（差异化层高、退界、立面材质与虚构校园周边业态），坐标数据化 */
const BUILDINGS: BuildingSpec[] = [
  {
    center: { x: -7.05, y: 2.8, z: 6 },
    size: { w: 9, h: 5.6, d: 8.6 },
    color: 0x8e9a95,
    facade: 'tile',
    facadeTint: 0xa5d8c0,
    parapetStyle: 'stepped',
    shopName: '甜品面包店',
    signBackground: '#f7ecd4',
    signForeground: '#2f6b58',
    signWidth: 2.4,
    signHeight: 0.52,
    awningTone: 'bakery',
    hasBalcony: false,
    hasOverhang: true,
    hasWaterTank: false,
    hasAFrame: true,
    bakeryDressing: true,
    sidePoster: {
      text: '现烤面包 · 甜品',
      background: '#eaf3e6',
      foreground: '#2c5348',
      width: 2.3,
      height: 0.72,
      centerY: 2.45,
      accentColor: 0x4f8d76,
    },
    sideFeature: 'meter',
    storeInteriorTint: 0xffe7cd,
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
  {
    // 街角水果店：右前景转角空位（晨光豆浆 +Z 山墙之后），单层拱顶铺面
    // center.z 取 9.6 是为了让门头招牌避开 (2.3, 11) 电线杆的视线遮挡，同时与隔壁留 2.4 m 巷道
    center: { x: 6.8, y: 1.7, z: 9.6 },
    size: { w: 8.4, h: 3.4, d: 5.6 },
    color: 0x7fa39a,
    facade: 'plaster',
    facadeTint: 0x7fc6bb,
    parapetStyle: 'flat',
    shopName: '校园水果店',
    signBackground: '#f7ecd4',
    signForeground: '#2c5c3a',
    signWidth: 2.05,
    signHeight: 0.5,
    awningTone: 'teal',
    hasBalcony: false,
    hasOverhang: false,
    hasWaterTank: false,
    hasAFrame: true,
    sidePoster: {
      text: '新鲜水果 · 现榨果汁',
      background: '#eef4e2',
      foreground: '#3d6b3a',
      width: 2.2,
      height: 0.68,
      centerY: 2.32,
      accentColor: 0x4d8a5c,
    },
    sideFeature: 'meter',
    storeInteriorTint: 0xffe9c4,
    barrelRoof: {
      color: 0xe08a3c,
      riseScale: 0.62,
      depth: 4.4,
      windowOffsetsZ: [-1.12, 1.12],
      windowY: 4.3,
    },
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

/** 双格分类垃圾桶位表（人行道外缘，与电线杆、自行车错开） */
const BIN_SPOTS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -2.1, z: 4 },
  { x: 2.1, z: -18 },
  { x: -2.1, z: -33 },
];

/** prop_street_lamp 实测灯笼玻璃腔在 y 3.15–4.20：自发光灯泡挪进腔体中部，不能留在原 1.15m 悬臂端 */
const LAMP_PROP_BULB_Y = 3.66;
/**
 * 道具路灯的摆放内移：楼体内墙面实测在 |x| 2.50–2.74（楼体中心 ±7.0 / ±7.24，宽 9），
 * 而铸铁路灯的杆身半宽 0.379 —— 沿用 LAMP_POSTS 的 ±3.2 会把整根灯杆埋进墙体，
 * 程序化灯只露出伸到 |x| 2.05 的悬臂和灯罩，所以原来看不出这个问题。
 * 道具实例统一内移到 |x| = 2.05（外沿 2.43，仍留墙面间隙）；
 * LAMP_POSTS 位表、obstacle 生成与程序化回退一律保持原坐标不动。
 */
const LAMP_PROP_X = 2.05;
/** 只取桶身（y > 0.2，摊在地上的盖子不算）逐段扫描实测：两桶各占自身 X 的 -0.82..-0.10 与 0.10..0.82，桶心在 ±0.46 */
const BIN_PROP_CELLS: readonly [number, number] = [-0.46, 0.46];
/**
 * 程序化分类桶尺寸（米）。桶身是上下等径的直筒，外壁半径 BIN_RADIUS，
 * 母线剖面绕轴回转成一个完整闭合的实心容器：口沿有 3.6 cm 厚环面并内外倒圆角，
 * 内壁向下收到封闭内底（看得见投料口深度），底面平整、与侧壁之间一道小圆角。
 */
const BIN = {
  radius: 0.28,
  rimRadius: 0.301,
  height: 0.757,
  radialSegments: 24,
  /** 投料口：内底半径 / 内壁上口半径 / 内底高度 */
  mouthFloorRadius: 0.176,
  mouthTopRadius: 0.238,
  mouthFloorY: 0.585,
  /** 遮檐：弧面半径、竖向压扁系数、安装高度（后端埋进口沿环带，不做悬浮薄壳） */
  visorRadius: 0.3,
  visorFlatten: 0.3,
  visorY: 0.74,
  visorWidth: 0.47,
  /** 侧面附件盒体：贴进桶壁 3 cm，不外露接缝 */
  box: { x: 0.3, y: 0.42, w: 0.1, h: 0.2, d: 0.17 },
  /** 丝印标志贴在半径略大于外壁的圆弧片上，跟着桶面弯，不会两头翘起 */
  logoRadius: 0.284,
  logoHeight: 0.26,
  logoY: 0.45,
  logoArc: 0.92,
} as const;
/**
 * 两只桶的配色：可回收·暖黄渐变在内、其他·草绿在外（沿用原分类牌的分格顺序）。
 * mouth 是投料口内壁与内底，rim 是口沿环面，shade 是遮檐与侧盒（同色压深一档）。
 */
const BIN_TONES = {
  recyclable: { top: 0xf5cb4a, bottom: 0xdfa019, mouth: 0x33261a, rim: 0x6b4a22, shade: 0xd99a15 },
  other: { top: 0x63c42a, bottom: 0x3e9b10, mouth: 0x1b2e10, rim: 0x2f5a1c, shade: 0x358a0d },
} as const;
type BinVariant = keyof typeof BIN_TONES;

/** 行李 + 迎新学长学姐 / 新生 3D 角色组合（两人面对面自然交谈，使用互不重复的非主线同学模型） */
const STREET_NPCS: ReadonlyArray<{
  group: { x: number; z: number };
  greeterModel: CharacterModelId;
  greeterColor: number;
  studentModel: CharacterModelId;
  studentColor: number;
  luggage: { x: number; z: number };
}> = [
  {
    group: { x: 4.4, z: -7 },
    greeterModel: 'studentMale',
    greeterColor: 0x8f8578,
    studentModel: 'studentFemale4',
    studentColor: 0x8f9aa3,
    luggage: { x: 3.6, z: -7.6 },
  },
  {
    group: { x: -4.6, z: -24 },
    greeterModel: 'studentFemale3',
    greeterColor: 0x867d70,
    studentModel: 'studentMale3',
    studentColor: 0x93a0a8,
    luggage: { x: -5.4, z: -24.6 },
  },
];

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

/**
 * 临街窗色六分：暖黄（有人开灯）/ 冷蓝（反天空）/ 深灰（拉帘）/ 墨绿（贴膜）/ 亮白（反光）/ 纯黑（空房）。
 * 权重 2:3:2:1:1:1，刻意不做均匀随机——均匀随机在立面上读起来是噪点而不是住户。
 * 取 z 与 y 联合的确定性哈希：只用 z 会让同一列从底到顶一个颜色，变成竖条纹。
 */
const WINDOW_TONES: ReadonlyArray<{ hex: number; weight: number }> = [
  { hex: 0xf2d9a8, weight: 2 },
  { hex: 0x9fb6c4, weight: 3 },
  { hex: 0x3a4247, weight: 2 },
  { hex: 0x4e6656, weight: 1 },
  { hex: 0xe6edf0, weight: 1 },
  { hex: 0x1e2426, weight: 1 },
];
const WINDOW_TONE_WEIGHT_TOTAL = WINDOW_TONES.reduce((sum, tone) => sum + tone.weight, 0);

function deterministicUnit(key: number): number {
  const scaled = Math.sin(key * 12.9898) * 43758.5453;
  return scaled - Math.floor(scaled);
}

function pickWindowTone(z: number, y: number): number {
  const slot = deterministicUnit(z * 7.13 + y * 0.41) * WINDOW_TONE_WEIGHT_TOTAL;
  let acc = 0;
  for (const tone of WINDOW_TONES) {
    acc += tone.weight;
    if (slot < acc) return tone.hex;
  }
  return WINDOW_TONES[1].hex;
}

/** 重点窗：靠玩家路线（z 在 −30 到 12）的低层窗才做窗帘/外机，远处一律留白省面数 */
function pickWindowDetail(z: number, y: number): 'curtain' | 'unit' | null {
  if (z < -30 || z > 12 || y > 5.6) return null;
  const roll = deterministicUnit(z * 3.71 + y * 9.17);
  if (roll < 0.28) return 'curtain';
  if (roll < 0.52) return 'unit';
  return null;
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

/** 水果堆头用的球体批次：scale 当半径，一个 DrawCall 内靠实例色换苹果/橙/葡萄/西瓜 */
function createSphereInstances(
  parent: THREE.Object3D,
  name: string,
  specs: BoxInstanceSpec[],
  material: THREE.Material,
  castShadow = false,
): THREE.InstancedMesh | null {
  if (specs.length === 0) return null;
  const geometry = new THREE.SphereGeometry(1, 10, 7);
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

/** 带锥度的树干批次：底粗顶细，避免电线杆感；scale.x/z 作为底部半径 */
function createTrunkInstances(
  parent: THREE.Object3D,
  name: string,
  specs: BoxInstanceSpec[],
  material: THREE.Material,
): void {
  if (specs.length === 0) return;
  const geometry = new THREE.CylinderGeometry(0.56, 1, 1, 8, 2, true);
  const mesh = new THREE.InstancedMesh(geometry, material, specs.length);
  const transform = new THREE.Object3D();
  specs.forEach((spec, index) => {
    transform.position.set(spec.position.x, spec.position.y, spec.position.z);
    transform.scale.set(spec.scale.x, spec.scale.y, spec.scale.z);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  bindInstancedDispose(geometry, mesh);
  parent.add(mesh);
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

  // 井盖：1 → 4，盖体与边框各合成 1 批（DrawCall 与原来单只的两张 Mesh 持平）
  const manholeSpots: Array<{ x: number; z: number }> = [
    { x: -0.78, z: -17.5 },
    { x: 0.95, z: -8.4 },
    { x: -1.05, z: 4.2 },
    { x: 0.72, z: -28.6 },
  ];
  const manholeSpecs: BoxInstanceSpec[] = manholeSpots.map((spot) => ({
    position: { x: spot.x, y: 0.02, z: spot.z },
    scale: { x: 0.34, y: 0.022, z: 0.34 },
  }));
  const ringSpecs: BoxInstanceSpec[] = manholeSpots.map((spot) => ({
    position: { x: spot.x, y: 0.035, z: spot.z },
    scale: { x: 0.3, y: 0.024, z: 0.3 },
  }));
  createCylinderInstances(parent, 'street-manholes', manholeSpecs, createMatteMaterial(0x465256, 0.42));
  createCylinderInstances(parent, 'street-manhole-rings', ringSpecs, createMatteMaterial(0x788487, 0.38));

  // 胎迹与沥青补缝：全部用有厚度的薄盒（与车道虚线同一套路），不引入 polygonOffset
  const trackSpecs: BoxInstanceSpec[] = [];
  for (const x of [-1.15, -0.55, 0.55, 1.15]) {
    trackSpecs.push({ position: { x, y: 0.01, z: -16 }, scale: { x: 0.16, y: 0.008, z: 58 } });
  }
  createBoxInstances(parent, 'street-road-tracks', trackSpecs, createMatteMaterial(0x2f383c, 0.34));
  const patchSpecs: BoxInstanceSpec[] = [
    { position: { x: -0.45, y: 0.011, z: -12.2 }, scale: { x: 0.9, y: 0.01, z: 0.42 }, rotation: { x: 0, y: 0.12, z: 0 } },
    { position: { x: 0.8, y: 0.011, z: -21.5 }, scale: { x: 0.7, y: 0.01, z: 1.1 }, rotation: { x: 0, y: -0.05, z: 0 } },
    { position: { x: -1.15, y: 0.011, z: 1.5 }, scale: { x: 0.5, y: 0.01, z: 0.8 }, rotation: { x: 0, y: 0.2, z: 0 } },
  ];
  createBoxInstances(parent, 'street-road-patches', patchSpecs, createMatteMaterial(0x3b4448, 0.5));
}

function buildStreetBuildings(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  const facadeMaterials: Record<FacadeKind, THREE.MeshStandardMaterial> = {
    tile: getFacadeTileMaterial({ repeatX: 3, repeatY: 2 }),
    concrete: getFacadeConcreteMaterial({ repeatX: 2, repeatY: 2 }),
    brick: getFacadeBrickMaterial({ repeatX: 3, repeatY: 2 }),
    plaster: getPlasterMaterial({ repeatX: 3, repeatY: 2 }),
  };
  // 改色用的克隆必须解除 SHARED 标记，否则场景卸载时这份副本不会被 dispose
  const tintFacade = (source: THREE.MeshStandardMaterial, color: number): THREE.MeshStandardMaterial => {
    const material = source.clone();
    delete material.userData[SHARED_RESOURCE_FLAG];
    material.color.setHex(color);
    return material;
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
    bakery: createMatteMaterial(0xa8493f, 0.8),
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
  const windows: Array<BoxInstanceSpec & { color: number }> = [];
  const windowDetails: Array<BoxInstanceSpec & { color: number }> = [];
  const mullions: BoxInstanceSpec[] = [];
  const sills: BoxInstanceSpec[] = [];
  const lintels: BoxInstanceSpec[] = [];
  const balconies: BoxInstanceSpec[] = [];
  const rails: BoxInstanceSpec[] = [];
  const airConditioners: BoxInstanceSpec[] = [];
  const acGrilles: BoxInstanceSpec[] = [];
  const acBrackets: BoxInstanceSpec[] = [];
  const acPipeSegments: SegmentInstanceSpec[] = [];
  const awningByTone: Record<AwningTone, BoxInstanceSpec[]> = { teal: [], terracotta: [], slate: [], bakery: [] };
  const valanceByTone: Record<AwningTone, BoxInstanceSpec[]> = { teal: [], terracotta: [], slate: [], bakery: [] };
  const awningStripes: BoxInstanceSpec[] = [];
  const awningStruts: SegmentInstanceSpec[] = [];
  const signBoxes: BoxInstanceSpec[] = [];
  const signTrims: BoxInstanceSpec[] = [];
  const signGlows: BoxInstanceSpec[] = [];
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
  const fruitCrates: BoxInstanceSpec[] = [];
  const fruitBalls: Array<BoxInstanceSpec & { color: number }> = [];
  // 甜品面包店专属（BUILDINGS[0]）：批次共用，避免为单栋店再加 DrawCall
  const aFrameFrameColors: number[] = [];
  const bakeryPots: BoxInstanceSpec[] = [];
  const bakeryTrees: BoxInstanceSpec[] = [];
  const bakeryTrims: Array<BoxInstanceSpec & { color: number }> = [];
  const bakeryScallops: BoxInstanceSpec[] = [];
  const bakeryDesserts: Array<BoxInstanceSpec & { color: number }> = [];

  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

  for (const [index, building] of BUILDINGS.entries()) {
    const sharedFacade = facadeMaterials[building.facade];
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(building.size.w, building.size.h, building.size.d),
      building.facadeTint === undefined ? sharedFacade : tintFacade(sharedFacade, building.facadeTint),
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
    // 拱顶铺面在墙顶直接起拱，这一段整体跳过，否则女儿墙会在拱脚处横插一道腰线
    if (building.barrelRoof === undefined) {
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
          color: pickWindowTone(z, y),
        });
        const frontDetail = pickWindowDetail(z, y);
        if (frontDetail === 'curtain') {
          windowDetails.push({
            position: {
              x: winFaceX + side * 0.04,
              y,
              z: z + (deterministicUnit(z * 2.3 + y) < 0.5 ? -0.235 : 0.235),
            },
            scale: { x: 0.014, y: 0.94, z: 0.46 },
            color: 0x2b3336,
          });
        } else if (frontDetail === 'unit') {
          windowDetails.push({
            position: { x: winFaceX + side * 0.15, y: y - 0.86, z: z + 0.3 },
            scale: { x: 0.26, y: 0.34, z: 0.5 },
            color: 0xb9beba,
          });
        }
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
    const sign = building.bakeryDressing
      ? createBakerySign(building.shopName, building.signWidth, building.signHeight, {
          background: building.signBackground,
          foreground: building.signForeground,
        })
      : createTextSign(building.shopName, building.signWidth, building.signHeight, {
          background: building.signBackground,
          foreground: building.signForeground,
          resolution: 320,
        });
    sign.position.set(faceX + side * 0.22, signCenterY, awningCenterZ);
    sign.rotation.y = side * Math.PI / 2;
    sign.castShadow = false;
    if (sign.material instanceof THREE.MeshStandardMaterial) {
      sign.material.emissive.set(0xffcf94);
      sign.material.emissiveMap = sign.material.map;
      sign.material.emissiveIntensity = building.hasAFrame ? 0.42 : 0.22;
      sign.material.roughness = 0.88;
      sign.material.envMapIntensity = 0.3;
    }
    parent.add(sign);
    // 牌面暖光溢出：贴在压条正上方、比牌身窄的一小段墙——宽出牌面会读成"挂了块板"
    signGlows.push({
      position: { x: faceX + side * 0.03, y: signCenterY + building.signHeight / 2 + 0.2, z: awningCenterZ },
      scale: { x: 0.012, y: 0.26, z: Math.max(building.signWidth - 0.24, 0.4) },
    });

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
        // 面包店要"粉色 A 字小黑板"：架子上粉，板面仍是墨绿黑板
        aFrameFrameColors.push(building.bakeryDressing ? 0xe3a0b1 : 0x7c5f44);
        aFrameBoards.push({
          position: { x: boardX + tilt * 0.095, y: 0.41, z: boardZ },
          scale: { x: 0.014, y: 0.56, z: 0.4 },
          rotation: { x: 0, y: 0, z: -tilt * 0.2 },
        });
      }
    }

    // 甜品面包店陈设：波浪垂边 / 立面白色装饰线 / 门口陶土小松树 / 橱窗甜品剪影
    if (building.bakeryDressing) {
      // 篷边下沿一排圆盘压在原直边垂板外侧，读成红白条纹末端的波浪口
      const scallopCount = 24;
      for (let s = 0; s < scallopCount; s += 1) {
        bakeryScallops.push({
          position: {
            x: faceX + side * 0.885,
            y: 1.945,
            z: awningCenterZ - awningWidth / 2 + (s + 0.5) * (awningWidth / scallopCount),
          },
          // 圆柱绕 Z 转 90° 后：局部 X→世界 −Y、局部 Y→世界 X（厚度）、局部 Z 不变
          scale: { x: 0.072, y: 0.05, z: 0.072 },
          rotation: { x: 0, y: 0, z: Math.PI / 2 },
        });
      }
      // 白色装饰线：店面两侧壁柱 + 遮阳篷与招牌之间的腰线
      for (const end of [-1, 1]) {
        bakeryTrims.push({
          position: { x: faceX + side * 0.05, y: 1.32, z: awningCenterZ + end * (awningWidth / 2 + 0.1) },
          scale: { x: 0.07, y: 2.64, z: 0.2 },
          color: 0xf2efe6,
        });
      }
      bakeryTrims.push({
        position: { x: faceX + side * 0.05, y: 2.34, z: awningCenterZ },
        scale: { x: 0.06, y: 0.12, z: awningWidth + 0.44 },
        color: 0xf2efe6,
      });
      // 玻璃双开门：青绿门框（中梃把单扇切成两叶）+ 右侧第二支门把手
      bakeryTrims.push({
        position: { x: faceX + side * 0.29, y: 1.04, z: doorCenterZ },
        scale: { x: 0.05, y: 1.6, z: 0.05 },
        color: 0x4f9e86,
      });
      for (const y of [0.16, 1.82]) {
        bakeryTrims.push({
          position: { x: faceX + side * 0.29, y, z: doorCenterZ },
          scale: { x: 0.05, y: 0.05, z: 1.06 },
          color: 0x4f9e86,
        });
      }
      bakeryTrims.push({
        position: { x: faceX + side * 0.31, y: 0.98, z: doorCenterZ + 0.32 },
        scale: { x: 0.03, y: 0.26, z: 0.03 },
        color: 0xd8ded9,
      });
      // 门口两盆陶土盆小松树，左右让开玻璃门
      for (const end of [-1, 1]) {
        const potZ = doorCenterZ + end * 0.86;
        const potX = faceX + side * 0.62;
        bakeryPots.push({ position: { x: potX, y: 0.14, z: potZ }, scale: { x: 0.17, y: 0.28, z: 0.17 } });
        bakeryTrees.push({ position: { x: potX, y: 0.56, z: potZ }, scale: { x: 0.22, y: 0.26, z: 0.22 } });
      }
      // 橱窗前沿一排甜品剪影（布丁/粉奶油/草莓/马卡龙/泡芙），只占一个批次
      const dessertTones = [0xe8c37a, 0xefa8c4, 0xd9556a, 0xa8d8c4, 0xf7ecd4];
      dessertTones.forEach((hex, i) => {
        bakeryDesserts.push({
          position: {
            x: faceX + side * 0.33,
            y: 1.03,
            z: winCenterZ - 0.72 + i * 0.36,
          },
          scale: { x: 0.13, y: 0.15, z: 0.13 },
          color: hex,
        });
      });
      // 门玻璃上的粉色海报（提示词"玻璃双开门…粉海报"），复用甜品剪影批次
      bakeryDesserts.push({
        position: { x: faceX + side * 0.275, y: 1.2, z: doorCenterZ - 0.26 },
        scale: { x: 0.012, y: 0.44, z: 0.34 },
        color: 0xf0a0b8,
      });
    }

    // 拱顶单栋铺面：半圆柱桶拱 + 拱面小窗 + 人行道水果堆头（街角水果店专属）
    if (building.barrelRoof) {
      const roof = building.barrelRoof;
      const radius = building.size.d / 2;
      // 圆柱轴默认沿 Y：thetaStart=π 只留 sinθ≤0 的半侧，绕 Z 反转 90° 后轴进 +X、弧面朝上
      const vaultGeometry = new THREE.CylinderGeometry(radius, radius, roof.depth, 26, 1, false, Math.PI, Math.PI);
      vaultGeometry.rotateZ(-Math.PI / 2);
      const vault = new THREE.Mesh(vaultGeometry, createMatteMaterial(roof.color, 0.85));
      vault.position.set(faceX - side * (roof.depth / 2), building.size.h, building.center.z);
      vault.scale.y = roof.riseScale;
      vault.castShadow = true;
      vault.receiveShadow = true;
      parent.add(vault);
      occluders.push(vault);

      for (const offsetZ of roof.windowOffsetsZ) {
        const z = building.center.z + offsetZ;
        frames.push({
          position: { x: faceX + side * 0.03, y: roof.windowY, z },
          scale: { x: 0.06, y: 0.76, z: 0.76 },
        });
        windows.push({
          position: { x: faceX + side * 0.06, y: roof.windowY, z },
          scale: { x: 0.03, y: 0.6, z: 0.6 },
          color: 0x9dbfc9,
        });
        sills.push({
          position: { x: faceX + side * 0.09, y: roof.windowY - 0.43, z },
          scale: { x: 0.16, y: 0.06, z: 0.82 },
        });
      }

      // 果堆：靠窗一条长果槽 + 人行道两组木箱，球体同批换色换形，只多一个 DrawCall
      const fruitTones = [0xc4463f, 0xe2892c, 0xd9c24a, 0x7fa65a, 0x7a5a92, 0x3f7f4a];
      const addFruitPile = (
        x: number,
        topY: number,
        z: number,
        rows: number,
        cols: number,
        spanZ: number,
        seed: number,
      ): void => {
        for (let row = 0; row < rows; row += 1) {
          for (let col = 0; col < cols; col += 1) {
            const radius = 0.095 + deterministicUnit(seed * 3.7 + row * 1.9 + col * 5.1) * 0.035;
            const banana = (row + col + seed) % 6 === 2;
            fruitBalls.push({
              position: {
                x: x + (row - (rows - 1) / 2) * 0.17,
                y: topY + radius * 0.9,
                z: z + (cols === 1 ? 0 : (col - (cols - 1) / 2) * (spanZ / (cols - 1))),
              },
              scale: banana
                ? { x: radius * 0.72, y: radius * 0.6, z: radius * 2.2 }
                : { x: radius, y: radius * 0.92, z: radius },
              color: banana ? 0xe6c33f : fruitTones[(row * 2 + col + seed) % fruitTones.length],
            });
          }
        }
      };

      const binX = faceX + side * 0.58;
      fruitCrates.push({ position: { x: binX, y: 0.28, z: winCenterZ }, scale: { x: 0.46, y: 0.32, z: 2 } });
      addFruitPile(binX, 0.44, winCenterZ, 2, 5, 1.5, 1);

      const crateX = faceX + side * 0.42;
      const stackZ = building.center.z - 2.05;
      fruitCrates.push({ position: { x: crateX, y: 0.22, z: stackZ }, scale: { x: 0.52, y: 0.44, z: 0.8 } });
      fruitCrates.push({ position: { x: crateX, y: 0.64, z: stackZ }, scale: { x: 0.44, y: 0.4, z: 0.66 } });
      addFruitPile(crateX, 0.44, stackZ, 2, 2, 0.5, 2);
      addFruitPile(crateX, 0.84, stackZ, 2, 2, 0.42, 3);

      const soloZ = building.center.z + 0.55;
      fruitCrates.push({ position: { x: crateX, y: 0.2, z: soloZ }, scale: { x: 0.5, y: 0.4, z: 0.92 } });
      addFruitPile(crateX, 0.4, soloZ, 2, 3, 0.62, 4);
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

    // 外挂空调外机、金属托架与批处理冷凝管线（拱顶铺面只有一层，山墙不挂外机）
    const flatShop = building.barrelRoof !== undefined;
    const acLevels: number[] = flatShop
      ? []
      : building.size.h >= 8.5
        ? [4.45, 7.65]
        : [Math.min(building.size.h - 0.85, 4.45)];
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
      resolution: 320,
    });
    sideSign.position.set(posterX, poster.centerY, frontSideZ + 0.066);
    sideSign.castShadow = false;
    if (sideSign.material instanceof THREE.MeshStandardMaterial) {
      sideSign.material.roughness = 0.96;
      sideSign.material.metalness = 0;
      sideSign.material.envMapIntensity = 0.2;
      sideSign.material.emissive.set(0xffd9a8);
      sideSign.material.emissiveMap = sideSign.material.map;
      sideSign.material.emissiveIntensity = 0.3;
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
            color: pickWindowTone(sideWinX + zDir * 0.7, sideWinY),
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
    if (index === 0 || index === 1 || index === 3 || index === 4 || index === 5 || index === 6 || index === 8) {
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

    if (
      (index === 0 || index === 4 || index === 5 || index === 8) &&
      (!coarsePointer || index === 5)
    ) {
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
  const windowGlassMesh = createBoxInstances(parent, 'street-window-glass', windows, windowGlassMaterial);
  if (windowGlassMesh) {
    const windowTone = new THREE.Color();
    windows.forEach((win, index) => {
      windowGlassMesh.setColorAt(index, windowTone.setHex(win.color));
    });
    if (windowGlassMesh.instanceColor) windowGlassMesh.instanceColor.needsUpdate = true;
  }
  createBoxInstances(parent, 'street-window-details', windowDetails, createMatteMaterial(0xffffff, 0.74), true);
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
  createBoxInstances(parent, 'street-shop-awnings-bakery', awningByTone.bakery, awningMaterials.bakery, true);
  createBoxInstances(parent, 'street-shop-valances-teal', valanceByTone.teal, awningMaterials.teal);
  createBoxInstances(parent, 'street-shop-valances-terracotta', valanceByTone.terracotta, awningMaterials.terracotta);
  createBoxInstances(parent, 'street-shop-valances-slate', valanceByTone.slate, awningMaterials.slate);
  // 甜品店垂边复用篷面条纹的奶白，红篷白边才读得出是甜品店而非早餐铺
  createBoxInstances(parent, 'street-shop-valances-bakery', valanceByTone.bakery, stripeMaterial);
  createBoxInstances(parent, 'street-shop-awning-stripes', awningStripes, stripeMaterial);
  createSegmentCylinderInstances(parent, 'street-awning-struts', awningStruts, darkMetalMaterial);
  createBoxInstances(parent, 'street-sign-boxes', signBoxes, darkMetalMaterial);
  createBoxInstances(parent, 'street-sign-trims', signTrims, metalMaterial);
  createBoxInstances(
    parent,
    'street-sign-glows',
    signGlows,
    new THREE.MeshStandardMaterial({
      color: 0x1a1208,
      emissive: 0xffb877,
      emissiveIntensity: 0.32,
      roughness: 0.9,
      metalness: 0,
    }),
  );
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
  const aFrameFramesMesh = createBoxInstances(parent, 'street-aframe-frames', aFrameFrames, createMatteMaterial(0xffffff, 0.84), true);
  if (aFrameFramesMesh) {
    const frameColor = new THREE.Color();
    aFrameFrameColors.forEach((hex, index) => {
      aFrameFramesMesh.setColorAt(index, frameColor.setHex(hex));
    });
    if (aFrameFramesMesh.instanceColor) aFrameFramesMesh.instanceColor.needsUpdate = true;
  }
  createBoxInstances(parent, 'street-aframe-boards', aFrameBoards, createMatteMaterial(0x364341, 0.92));
  // 面包店陈设批次：陶土盆 / 球冠小松树 / 白色装饰线 / 波浪垂边 / 橱窗甜品
  createCylinderInstances(parent, 'street-bakery-pots', bakeryPots, createMatteMaterial(0xb86a49, 0.86), true);
  createSphereInstances(parent, 'street-bakery-trees', bakeryTrees, createMatteMaterial(0x4f7a4a, 0.9), true);
  const bakeryTrimsMesh = createBoxInstances(parent, 'street-bakery-trims', bakeryTrims, createMatteMaterial(0xffffff, 0.82));
  if (bakeryTrimsMesh) {
    const trimColor = new THREE.Color();
    bakeryTrims.forEach((item, index) => {
      bakeryTrimsMesh.setColorAt(index, trimColor.setHex(item.color));
    });
    if (bakeryTrimsMesh.instanceColor) bakeryTrimsMesh.instanceColor.needsUpdate = true;
  }
  createCylinderInstances(parent, 'street-bakery-scallops', bakeryScallops, awningMaterials.bakery);
  const bakeryDessertsMesh = createBoxInstances(parent, 'street-bakery-desserts', bakeryDesserts, createMatteMaterial(0xffffff, 0.8));
  if (bakeryDessertsMesh) {
    const dessertColor = new THREE.Color();
    bakeryDesserts.forEach((item, index) => {
      bakeryDessertsMesh.setColorAt(index, dessertColor.setHex(item.color));
    });
    if (bakeryDessertsMesh.instanceColor) bakeryDessertsMesh.instanceColor.needsUpdate = true;
  }
  createBoxInstances(parent, 'street-side-poster-frames', sidePosterFrames, darkMetalMaterial, true);
  createBoxInstances(parent, 'street-side-poster-trims', sidePosterTrims, metalMaterial);
  // 灰盒子三色分区：横电表箱 / 竖表箱 / 橱窗背板，明度拉开 ≥25；正面补门缝竖线与黄色警示牌
  const utilityTones = [0xc2c7c2, 0x7f8683, 0x9aa19d];
  const utilityDetails: Array<BoxInstanceSpec & { color: number }> = [];
  const utilityColors: number[] = sideUtilityBoxes.map((box, index) => {
    const faceZ = box.position.z + box.scale.z / 2 + 0.006;
    const wide = box.scale.x > box.scale.y;
    utilityDetails.push({
      position: { x: box.position.x - box.scale.x * 0.18, y: box.position.y, z: faceZ },
      scale: { x: 0.012, y: box.scale.y * 0.72, z: 0.012 },
      color: 0x2f3735,
    });
    if (wide) {
      utilityDetails.push({
        position: { x: box.position.x + box.scale.x * 0.26, y: box.position.y - box.scale.y * 0.28, z: faceZ },
        scale: { x: 0.09, y: 0.055, z: 0.012 },
        color: 0xd9a531,
      });
    }
    return utilityTones[wide ? 0 : index % 3 === 1 ? 1 : 2];
  });
  const utilityMesh = createBoxInstances(parent, 'street-side-utility-boxes', sideUtilityBoxes, createMatteMaterial(0xffffff, 0.72), true);
  if (utilityMesh) {
    const utilityColor = new THREE.Color();
    utilityColors.forEach((hex, index) => {
      utilityMesh.setColorAt(index, utilityColor.setHex(hex));
    });
    if (utilityMesh.instanceColor) utilityMesh.instanceColor.needsUpdate = true;
  }
  const utilityDetailMesh = createBoxInstances(parent, 'street-utility-details', utilityDetails, createMatteMaterial(0xffffff, 0.8));
  if (utilityDetailMesh) {
    const detailColor = new THREE.Color();
    utilityDetails.forEach((part, index) => {
      utilityDetailMesh.setColorAt(index, detailColor.setHex(part.color));
    });
    if (utilityDetailMesh.instanceColor) utilityDetailMesh.instanceColor.needsUpdate = true;
  }
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
  createBoxInstances(parent, 'street-fruit-crates', fruitCrates, createMatteMaterial(0xb07c4a, 0.82), true);
  const fruitMesh = createSphereInstances(
    parent,
    'street-fruit-balls',
    fruitBalls,
    createMatteMaterial(0xffffff, 0.42),
  );
  if (fruitMesh) {
    const fruitColor = new THREE.Color();
    fruitBalls.forEach((ball, idx) => {
      fruitMesh.setColorAt(idx, fruitColor.setHex(ball.color));
    });
    if (fruitMesh.instanceColor) fruitMesh.instanceColor.needsUpdate = true;
  }
}

function buildVendingMachines(parent: THREE.Object3D): void {
  const tier = getQualityTier();
  const glass = new THREE.MeshStandardMaterial({
    color: 0xa8c9cd,
    roughness: 0.3,
    metalness: 0.1,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
  });
  const panel = new THREE.MeshStandardMaterial({
    color: 0x2b3b3e,
    emissive: 0x5f9b9b,
    emissiveIntensity: 0.28,
    roughness: 0.5,
  });
  const drinkMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0.12,
    emissive: 0x2e2e2e,
  });
  const drinkColors = [0xe78a68, 0x78a9a0, 0xe2c064, 0x88a8c1];
  const placements: Array<{ buildingIndex: number; z: number; bodyColor: number; lightEmissive: number }> = [
    { buildingIndex: 0, z: 2.85, bodyColor: 0x4f817d, lightEmissive: 0x8fd6c8 },
    { buildingIndex: 4, z: -3.15, bodyColor: 0xb76850, lightEmissive: 0xff9c66 },
    { buildingIndex: 5, z: -8.85, bodyColor: 0x4f7480, lightEmissive: 0x8fd6c8 },
  ];

  // 三种瓶型：瓶（带颈带盖的回转体）/ 罐（收口易拉罐）/ 盒（利乐砖）
  const bottleGeometry = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.03, 0),
      new THREE.Vector2(0.034, 0.022),
      new THREE.Vector2(0.031, 0.104),
      new THREE.Vector2(0.014, 0.126),
      new THREE.Vector2(0.017, 0.152),
      new THREE.Vector2(0, 0.152),
    ],
    8,
  );
  const canGeometry = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.024, 0),
      new THREE.Vector2(0.026, 0.014),
      new THREE.Vector2(0.026, 0.101),
      new THREE.Vector2(0.021, 0.115),
      new THREE.Vector2(0, 0.115),
    ],
    8,
  );
  const cartonGeometry = new THREE.BoxGeometry(0.052, 0.128, 0.038);

  const bottles: Array<{ p: Vec3; color: number }> = [];
  const cans: Array<{ p: Vec3; color: number }> = [];
  const cartons: Array<{ p: Vec3; color: number }> = [];
  const doorParts: Array<BoxInstanceSpec & { color: number }> = [];
  const lamps: Vec3[] = [];
  const contacts: Array<{ x: number; z: number; radius: number }> = [];
  const shelfRows = [0.55, 0.845, 1.14];
  const typeCycle = ['bottle', 'can', 'carton', 'bottle'] as const;

  for (const placement of placements) {
    const building = BUILDINGS[placement.buildingIndex];
    const side = building.center.x > 0 ? -1 : 1;
    const faceX = building.center.x + side * (building.size.w / 2);
    const z = placement.z;
    // 机身朝向 ±x，纵深只在这条轴上：z 是沿街道的横向，改 z 做不出"往里看"
    const at = (offset: number): number => faceX + side * offset;

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: placement.bodyColor,
      roughness: 0.52,
      metalness: 0.26,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 1.55, 0.78), bodyMaterial);
    body.position.set(at(0.28), 0.82, z);
    body.castShadow = true;
    parent.add(body);

    // 背板：自发光从 0.45 压到 0.28——饮料就贴在它前面 3cm，0.45 时整排货被逆光照成剪影
    const display = new THREE.Mesh(new THREE.BoxGeometry(0.012, 1.03, 0.58), panel);
    display.position.set(at(0.516), 0.91, z);
    parent.add(display);

    if (tier !== 'low') {
      // 货道格架：横向三条 + 竖向三道，让背板读出"一层一层有货道"
      for (const shelfY of [0.7, 0.995, 1.29]) {
        doorParts.push({
          position: { x: at(0.528), y: shelfY, z },
          scale: { x: 0.008, y: 0.022, z: 0.56 },
          color: 0x26302f,
        });
      }
      for (const gap of [-0.14, 0, 0.14]) {
        doorParts.push({
          position: { x: at(0.552), y: 0.93, z: z + gap },
          scale: { x: 0.062, y: 0.8, z: 0.012 },
          color: 0x3a4446,
        });
      }
    }
    // 底部价签条
    doorParts.push({
      position: { x: at(0.566), y: 0.575, z },
      scale: { x: 0.045, y: 0.042, z: 0.56 },
      color: 0xf0e6cc,
    });

    shelfRows.forEach((rowY, rowIndex) => {
      for (let column = 0; column < 4; column += 1) {
        const kind = typeCycle[column];
        const color = drinkColors[(rowIndex * 4 + column + placement.buildingIndex) % drinkColors.length];
        const item = { p: { x: at(0.552), y: rowY, z: z - 0.21 + column * 0.14 }, color };
        if (kind === 'bottle') bottles.push(item);
        else if (kind === 'can') cans.push(item);
        else cartons.push({ p: { x: item.p.x, y: rowY + 0.064, z: item.p.z }, color });
      }
    });

    // 门框四边：玻璃嵌进门内，整扇门不再悬在机身前面
    for (const dz of [-0.305, 0.305]) {
      doorParts.push({
        position: { x: at(0.585), y: 0.91, z: z + dz },
        scale: { x: 0.03, y: 1.06, z: 0.022 },
        color: 0x2a3234,
      });
    }
    for (const dy of [0.4, 1.42]) {
      doorParts.push({
        position: { x: at(0.585), y: dy, z },
        scale: { x: 0.03, y: 0.022, z: 0.63 },
        color: 0x2a3234,
      });
    }

    const front = new THREE.Mesh(new THREE.BoxGeometry(0.012, 1.02, 0.6), glass);
    front.position.set(at(0.588), 0.91, z);
    front.renderOrder = 1;
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
    lightBar.position.set(at(0.54), 1.52, z);
    parent.add(lightBar);

    // 轮廓特征（只留两个凸起/凹口，不堆细节）：取货口凹台 + 投币面板 + 面板上的工作灯
    doorParts.push({
      position: { x: at(0.522), y: 0.3, z: z - 0.12 },
      scale: { x: 0.02, y: 0.12, z: 0.34 },
      color: 0x23282a,
    });
    doorParts.push({
      position: { x: at(0.528), y: 1.05, z: z + 0.345 },
      scale: { x: 0.03, y: 0.22, z: 0.1 },
      color: 0xc9ced0,
    });
    lamps.push({ x: at(0.548), y: 1.16, z: z + 0.345 });

    contacts.push({ x: at(0.28), z, radius: 0.42 });
  }

  const addDrinkBatch = (
    name: string,
    geometry: THREE.BufferGeometry,
    items: Array<{ p: Vec3; color: number }>,
  ): void => {
    if (items.length === 0) return;
    const mesh = new THREE.InstancedMesh(geometry, drinkMaterial, items.length);
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    items.forEach((item, index) => {
      transform.position.set(item.p.x, item.p.y, item.p.z);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      mesh.setColorAt(index, color.setHex(item.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    bindInstancedDispose(geometry, mesh);
    parent.add(mesh);
  };
  addDrinkBatch('street-vend-bottles', bottleGeometry, bottles);
  addDrinkBatch('street-vend-cans', canGeometry, cans);
  addDrinkBatch('street-vend-cartons', cartonGeometry, cartons);

  const doorMesh = createBoxInstances(parent, 'street-vend-door', doorParts, createMatteMaterial(0xffffff, 0.72), true);
  if (doorMesh) {
    const doorColor = new THREE.Color();
    doorParts.forEach((part, index) => {
      doorMesh.setColorAt(index, doorColor.setHex(part.color));
    });
    if (doorMesh.instanceColor) doorMesh.instanceColor.needsUpdate = true;
  }

  if (lamps.length > 0) {
    const lampGeometry = new THREE.BoxGeometry(0.014, 0.02, 0.02);
    const lampMesh = new THREE.InstancedMesh(
      lampGeometry,
      new THREE.MeshStandardMaterial({
        color: 0xff5a4a,
        emissive: 0xff5a4a,
        emissiveIntensity: 1.2,
        roughness: 0.5,
      }),
      lamps.length,
    );
    const transform = new THREE.Object3D();
    lamps.forEach((position, index) => {
      transform.position.set(position.x, position.y, position.z);
      transform.updateMatrix();
      lampMesh.setMatrixAt(index, transform.matrix);
    });
    lampMesh.instanceMatrix.needsUpdate = true;
    lampMesh.name = 'street-vend-lamps';
    lampMesh.castShadow = false;
    lampMesh.computeBoundingBox();
    lampMesh.computeBoundingSphere();
    bindInstancedDispose(lampGeometry, lampMesh);
    parent.add(lampMesh);
  }

  const contactMesh = createContactShadowDiscBatch('street-vend-contact', contacts);
  if (contactMesh) parent.add(contactMesh);
}

function buildStreetTrees(parent: THREE.Object3D): void {
  const trees = [
    { x: -1.9, z: 9, height: 2.25, slender: false },
    { x: 1.9, z: 3, height: 2.52, slender: true },
    { x: -1.9, z: -14, height: 2.4, slender: true },
    { x: 1.9, z: -27, height: 2.18, slender: false },
  ];
  const pitBeds: BoxInstanceSpec[] = [];
  const pitBorders: BoxInstanceSpec[] = [];
  const pitGrates: BoxInstanceSpec[] = [];
  const trunks: BoxInstanceSpec[] = [];
  const branches: SegmentInstanceSpec[] = [];
  const bark = getBarkMaterial({ repeatX: 2, repeatY: 3 });
  // 行道树树皮压暗成灰褐：原色偏浅，近看像刷了漆的木方，不像树
  const trunkBark = bark.clone();
  trunkBark.color.setHex(0x8b8273);
  // 卡片树冠：每棵树 4/7/10 张（按设备档位），全部合并成 1 个 InstancedMesh
  const canopyTier = canopyBudget(getQualityTier());
  const cardSpecs: CanopyCardSpec[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

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
      scale: { x: tree.slender ? 0.072 : 0.084, y: tree.height + 0.25, z: tree.slender ? 0.072 : 0.084 },
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

    // 树冠参数：细高树收窄、圆冠树放宽；卡片尺寸略大于冠幅，靠重叠吃出体积
    // 明度染色：贴图本身已烘焙四层明暗，这里只做轻微的冷暖差，避免把树压暗
    const palette = tree.slender
      ? [0xe4ebdc, 0xeef4e7, 0xd8e2cf, 0xf4f8ee]
      : [0xe8ecd9, 0xf1f4e4, 0xdde3ce, 0xf6f8ec];
    const canopyCenterY = tree.height + (tree.slender ? 0.86 : 0.72);
    const canopyRadius = tree.slender ? 0.6 : 0.78;
    const cardScale = tree.slender ? 1.62 : 1.78;

    for (let card = 0; card < canopyTier.cards; card += 1) {
      const t = (card + 0.5) / canopyTier.cards;
      const angle = card * goldenAngle * 2 + treeIndex * 1.37;
      const ring = canopyRadius * (0.42 + 0.58 * Math.sin(Math.PI * t));
      cardSpecs.push({
        x: tree.x + Math.cos(angle) * ring * 0.92,
        y: canopyCenterY + (t - 0.5) * (tree.slender ? 1.18 : 1.02),
        z: tree.z + Math.sin(angle) * ring * 0.6,
        scale: cardScale * (0.9 + ((card * 5 + treeIndex) % 4) * 0.05),
        yaw: angle + Math.PI / 2,
        tilt: (card % 3 - 1) * 0.16,
        tint: palette[(treeIndex + card) % palette.length],
      });
    }
  }

  createBoxInstances(parent, 'street-tree-pits', pitBeds, createMatteMaterial(0x514c3e, 0.94));
  createBoxInstances(parent, 'street-tree-pit-borders', pitBorders, createMatteMaterial(0x99998e));
  createBoxInstances(parent, 'street-tree-pit-grates', pitGrates, createMatteMaterial(0x586264, 0.72));
  createTrunkInstances(parent, 'street-tree-trunks', trunks, trunkBark);
  createSegmentCylinderInstances(parent, 'street-tree-branches', branches, trunkBark, true, 6);
  // 保留旧批次名，外部若有按名字查找的验收脚本不会断
  parent.add(createCanopyCardBatch(cardSpecs, {
    name: 'street-tree-leaf-clusters',
    texture: {
      size: canopyTier.textureSize,
      seed: 5,
      aniso: canopyTier.anisotropy,
      density: 0.92,
    },
    alphaTest: canopyTier.alphaTest,
  }));
}

/** 场景代次：切场景后仍在途的道具回调必须作废，不能往复用的 levelGroup 里补挂上一代的几何 */
let streetGeneration = 0;
/** 道具实例网格：几何与材质由 resources 的道具缓存共享，离开 S4 时必须显式释放 instanceMatrix */
const streetPropMeshes: THREE.InstancedMesh[] = [];

/** 用道具几何按位表建一个 InstancedMesh：位姿只带位移与 yaw，底面已贴 y = 0 */
function createPropInstances(
  parent: THREE.Object3D,
  name: string,
  asset: PropModelAsset,
  specs: ReadonlyArray<{ x: number; z: number; yaw: number }>,
  override?: { geometry?: THREE.BufferGeometry; material?: THREE.Material },
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    override?.geometry ?? asset.geometry,
    override?.material ?? asset.material,
    specs.length,
  );
  const transform = new THREE.Object3D();
  specs.forEach((spec, index) => {
    transform.position.set(spec.x, 0, spec.z);
    transform.rotation.set(0, spec.yaw, 0);
    transform.scale.set(1, 1, 1);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  parent.add(mesh);
  streetPropMeshes.push(mesh);
  return mesh;
}

/** 热替换成功后拆掉被顶替的程序化批次：几何与材质都是本场景局部创建的，可以直接释放 */
function retireProceduralBatches(
  meshes: Array<THREE.InstancedMesh | null>,
  materials: THREE.Material[],
): void {
  for (const mesh of meshes) {
    if (!mesh) continue;
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
    mesh.dispose();
  }
  for (const material of materials) material.dispose();
}

/** 一只桶的摆位：世界 XZ、朝向（本地 +Z 指向街道中心）与分色 */
interface BinPlacement {
  x: number;
  z: number;
  yaw: number;
  variant: BinVariant;
}

/**
 * 桶位表：完全沿用双格摆放点 BIN_SPOTS 与格心偏移 BIN_PROP_CELLS（沿街道轴线 ±0.46），
 * 一个桶位一只桶，位置与替换前逐字一致，只换样貌。
 */
function buildBinPlacements(): BinPlacement[] {
  const cells: BinPlacement[] = [];
  for (const spot of BIN_SPOTS) {
    const yaw = spot.x > 0 ? -Math.PI / 2 : Math.PI / 2;
    BIN_PROP_CELLS.forEach((offset, index) => {
      cells.push({
        x: spot.x,
        z: spot.z + offset,
        yaw,
        variant: index === 0 ? 'recyclable' : 'other',
      });
    });
  }
  return cells;
}

/** 通用桶件批次：几何已把部件摆进桶的本地坐标，实例只补位移与朝向 */
function createBinInstances(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placements: BinPlacement[],
  colorPerInstance?: THREE.Color[],
): THREE.InstancedMesh | null {
  if (placements.length === 0) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  const transform = new THREE.Object3D();
  placements.forEach((placement, index) => {
    transform.position.set(placement.x, 0, placement.z);
    transform.rotation.set(0, placement.yaw, 0);
    transform.scale.set(1, 1, 1);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    if (colorPerInstance) mesh.setColorAt(index, colorPerInstance[index]);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  bindInstancedDispose(geometry, mesh);
  parent.add(mesh);
  return mesh;
}

/**
 * 夜间路灯（?night=1 才启用）：灯泡自发光抬到辉光阈值 1.25 以上真正接进 bloom、
 * 离玩家最近的几盏挂真点光源、地面一摊中心亮的暖光斑、一道自灯笼下散的薄雾光柱，全部按 dt 呼吸。
 * 白天不进这套：街道默认灯光、材质与 draw call 与改动前逐字一致。
 */
const NIGHT_LAMP = {
  bulbEmissive: 3.1,
  bulbColor: 0xffb35c,
  dayBulbColor: 0xffc875,
  dayBulbEmissive: 1.15,
  lightColor: 0xffb066,
  lightIntensity: 26,
  lightDistance: 10.5,
  lightDecay: 2,
  poolRadius: 3.05,
  poolY: 0.024,
  poolOpacity: 0.62,
  // 光柱只挂在灯笼下方一段：拉到地面会变成探照灯的白色三角，硬边还穿墙
  beamOpacity: 0.085,
  beamBottomRadius: 0.78,
  beamTopRadius: 0.1,
  beamFloorY: 2.05,
  followEasePerSecond: 5,
} as const;

let streetNightEnabled = false;
let streetNightTime = 0;
let streetNightRoot: THREE.Object3D | null = null;
let streetNightContext: SceneRuntimeContext | null = null;
let streetBulbMaterial: THREE.MeshStandardMaterial | null = null;
const streetLampSpots: THREE.Vector3[] = [];
const nightPointLights: THREE.PointLight[] = [];
let nightPoolMesh: THREE.InstancedMesh | null = null;
let nightBeamMesh: THREE.InstancedMesh | null = null;
let nightPoolMaterial: THREE.MeshBasicMaterial | null = null;
let nightBeamMaterial: THREE.MeshBasicMaterial | null = null;
const scratchNightFeet = new THREE.Vector3();

/** 灯位变更（程序化灯 → GLB 灯笼腔）后重建夜间件；同代重复调用只会保留一套 */
function setStreetLampSpots(spots: ReadonlyArray<{ x: number; y: number; z: number }>): void {
  streetLampSpots.length = 0;
  for (const spot of spots) streetLampSpots.push(new THREE.Vector3(spot.x, spot.y, spot.z));
  if (nightPoolMesh || nightBeamMesh) {
    // 灯位整体迁移时旧的光斑 / 光柱要按新位置重排，不能留在原悬臂端
    nightPoolMesh?.parent?.remove(nightPoolMesh as THREE.Object3D);
    nightBeamMesh?.parent?.remove(nightBeamMesh as THREE.Object3D);
    nightPoolMesh = null;
    nightBeamMesh = null;
  }
  applyStreetNight();
}

function placeStreetNightDecals(root: THREE.Object3D): void {
  const glowMap = getWarmLampGlowMaterial().map;
  if (!glowMap) return;
  const transform = new THREE.Object3D();

  nightPoolMaterial = new THREE.MeshBasicMaterial({
    map: glowMap,
    color: NIGHT_LAMP.lightColor,
    transparent: true,
    opacity: NIGHT_LAMP.poolOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const poolGeometry = new THREE.PlaneGeometry(1, 1);
  const pools = new THREE.InstancedMesh(poolGeometry, nightPoolMaterial, streetLampSpots.length);
  streetLampSpots.forEach((spot, index) => {
    transform.position.set(spot.x, NIGHT_LAMP.poolY, spot.z);
    transform.rotation.set(-Math.PI / 2, 0, 0);
    transform.scale.set(NIGHT_LAMP.poolRadius * 2, NIGHT_LAMP.poolRadius * 2, 1);
    transform.updateMatrix();
    pools.setMatrixAt(index, transform.matrix);
  });
  pools.instanceMatrix.needsUpdate = true;
  pools.name = 'street-lamp-night-pools';
  pools.castShadow = false;
  pools.receiveShadow = false;
  pools.raycast = () => {};
  pools.computeBoundingBox();
  pools.computeBoundingSphere();
  bindInstancedDispose(poolGeometry, pools);
  root.add(pools);
  nightPoolMesh = pools;

  // 光柱用顶点色做上亮下灭的渐变，而不是自定义 shader：避开 r187 批次 define 变更的老坑
  const beamHeight = Math.max(0.2, LAMP_PROP_BULB_Y - NIGHT_LAMP.beamFloorY);
  const beamGeometry = new THREE.CylinderGeometry(
    NIGHT_LAMP.beamTopRadius, NIGHT_LAMP.beamBottomRadius, beamHeight, 14, 1, true,
  );
  const beamPositions = beamGeometry.getAttribute('position');
  const beamColors = new Float32Array(beamPositions.count * 3);
  for (let index = 0; index < beamPositions.count; index += 1) {
    const heightRatio = (beamPositions.getY(index) + beamHeight / 2) / beamHeight;
    const fade = heightRatio * heightRatio;
    beamColors[index * 3] = 1 * fade;
    beamColors[index * 3 + 1] = 0.72 * fade;
    beamColors[index * 3 + 2] = 0.42 * fade;
  }
  beamGeometry.setAttribute('color', new THREE.BufferAttribute(beamColors, 3));
  nightBeamMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: NIGHT_LAMP.beamOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const beams = new THREE.InstancedMesh(beamGeometry, nightBeamMaterial, streetLampSpots.length);
  streetLampSpots.forEach((spot, index) => {
    transform.position.set(spot.x, NIGHT_LAMP.beamFloorY + beamHeight / 2, spot.z);
    transform.rotation.set(0, 0, 0);
    transform.scale.set(1, 1, 1);
    transform.updateMatrix();
    beams.setMatrixAt(index, transform.matrix);
  });
  beams.instanceMatrix.needsUpdate = true;
  beams.name = 'street-lamp-night-beams';
  beams.castShadow = false;
  beams.receiveShadow = false;
  beams.raycast = () => {};
  beams.computeBoundingBox();
  beams.computeBoundingSphere();
  bindInstancedDispose(beamGeometry, beams);
  root.add(beams);
  nightBeamMesh = beams;
}

/** 点光只给离玩家最近的几盏：低档 1 盏、中档 2 盏、高档 3 盏，阴影全部仍由月光那一盏负责 */
function nightLightSlots(): number {
  const tier = getQualityTier();
  return tier === 'low' ? 1 : tier === 'mid' ? 2 : 3;
}

function applyStreetNight(): void {
  if (streetBulbMaterial) {
    streetBulbMaterial.emissiveIntensity = streetNightEnabled
      ? NIGHT_LAMP.bulbEmissive * 1.0
      : NIGHT_LAMP.dayBulbEmissive;
    streetBulbMaterial.emissive.setHex(
      streetNightEnabled ? NIGHT_LAMP.bulbColor : NIGHT_LAMP.dayBulbColor,
    );
  }
  const root = streetNightRoot;
  if (!streetNightEnabled || !root || streetLampSpots.length === 0) {
    if (nightPoolMesh) nightPoolMesh.visible = false;
    if (nightBeamMesh) nightBeamMesh.visible = false;
    for (const light of nightPointLights) light.visible = false;
    return;
  }
  if (!nightPoolMesh) placeStreetNightDecals(root);
  const slots = nightLightSlots();
  while (nightPointLights.length < slots) {
    const light = new THREE.PointLight(
      NIGHT_LAMP.lightColor, 0, NIGHT_LAMP.lightDistance, NIGHT_LAMP.lightDecay,
    );
    light.castShadow = false;
    light.name = `street-lamp-night-light-${nightPointLights.length}`;
    root.add(light);
    nightPointLights.push(light);
  }
  if (nightPoolMesh) nightPoolMesh.visible = true;
  if (nightBeamMesh) nightBeamMesh.visible = true;
  tickStreetNight(0);
}

/** 呼吸 / 闪烁按累计秒计算：帧率高低只影响采样密度，不影响明暗节律 */
function tickStreetNight(dtSeconds: number): void {
  if (!streetNightEnabled || streetLampSpots.length === 0) return;
  streetNightTime += dtSeconds;
  const breath = 1
    + Math.sin(streetNightTime * 1.9) * 0.06
    + Math.sin(streetNightTime * 5.3) * 0.025;
  if (streetBulbMaterial) streetBulbMaterial.emissiveIntensity = NIGHT_LAMP.bulbEmissive * breath;
  if (nightPoolMaterial) nightPoolMaterial.opacity = NIGHT_LAMP.poolOpacity * breath;
  if (nightBeamMaterial) nightBeamMaterial.opacity = NIGHT_LAMP.beamOpacity * breath;

  const hasPlayer = Boolean(streetNightContext?.getPlayerFeet);
  if (hasPlayer && streetNightContext?.getPlayerFeet) streetNightContext.getPlayerFeet(scratchNightFeet);
  const ranked = streetLampSpots
    .map((spot, index) => ({
      index,
      distance: hasPlayer
        ? (spot.x - scratchNightFeet.x) ** 2 + (spot.z - scratchNightFeet.z) ** 2
        : index,
    }))
    .sort((a, b) => a.distance - b.distance);
  const ease = 1 - Math.exp(-NIGHT_LAMP.followEasePerSecond * Math.max(0, dtSeconds));
  nightPointLights.forEach((light, slot) => {
    const winner = ranked[slot];
    if (!winner) {
      light.visible = false;
      return;
    }
    const spot = streetLampSpots[winner.index];
    if (light.position.lengthSq() === 0) light.position.copy(spot);
    else light.position.lerp(spot, ease);
    // 相位跟着灯走：光斑从一盏换到另一盏时明暗连续，不出现整条街同频闪
    const phase = winner.index * 1.7;
    const local = 1
      + Math.sin(streetNightTime * 2.3 + phase) * 0.055
      + Math.sin(streetNightTime * 6.1 + phase * 2) * 0.02;
    light.intensity = NIGHT_LAMP.lightIntensity * local * breath;
    light.visible = true;
  });
}

function resetStreetNightRig(): void {
  streetNightRoot = null;
  streetNightContext = null;
  streetBulbMaterial = null;
  nightPoolMesh = null;
  nightBeamMesh = null;
  nightPoolMaterial = null;
  nightBeamMaterial = null;
  nightPointLights.length = 0;
  streetLampSpots.length = 0;
  // 呼吸节律按场景重新起相：跨场累计会让同一段时间在不同帧率下算出不同相位
  streetNightTime = 0;
}

function buildStreetLamps(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  const generation = streetGeneration;
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
  const baseMesh = createCylinderInstances(parent, 'street-lamp-bases', bases, metal);
  const armMesh = createSegmentCylinderInstances(parent, 'street-lamp-arms', arms, metal, true, 6);
  shades.instanceMatrix.needsUpdate = true;
  shades.name = 'street-lamp-shades';
  shades.computeBoundingBox();
  shades.computeBoundingSphere();
  bulbs.instanceMatrix.needsUpdate = true;
  bulbs.name = 'street-lamp-bulbs';
  bulbs.computeBoundingBox();
  bulbs.computeBoundingSphere();
  parent.add(shades, bulbs);

  // 夜间件的挂点：程序化灯的灯泡在悬臂端 3.99，GLB 到货后会整体换成灯笼腔
  streetNightRoot = parent;
  streetBulbMaterial = glowMaterial;
  setStreetLampSpots(LAMP_POSTS.map((post) => ({
    x: post.x - Math.sign(post.x) * 1.15,
    y: 3.99,
    z: post.z,
  })));

  // 复古铸铁路灯：加载成功才顶替灯柱 / 灯座 / 灯臂 / 灯罩四组实例，失败就保留上面这套程序化灯，不留空洞
  loadPropModel('streetLamp').then((asset) => {
    if (!asset || generation !== streetGeneration) return;
    // 成品铸铁路臂沿自身 X 对称伸出 ±0.38，与原程序化悬臂同轴，因此 yaw 取 0
    const lampSpots = LAMP_POSTS.map((post) => ({ x: Math.sign(post.x) * LAMP_PROP_X, z: post.z }));
    const lamps = createPropInstances(
      parent,
      'street-lamp-props',
      asset,
      lampSpots.map((spot) => ({ x: spot.x, z: spot.z, yaw: 0 })),
    );
    const slot = poleMesh ? occluders.indexOf(poleMesh) : -1;
    if (slot >= 0) occluders[slot] = lamps;
    else occluders.push(lamps);
    retireProceduralBatches([poleMesh, baseMesh, armMesh, shades], [metal, shadeMaterial]);

    // GLB 里没有发光体：自发光灯泡实例挪进灯笼玻璃腔，夜里灯还是靠它亮着
    lampSpots.forEach((spot, index) => {
      transform.position.set(spot.x, LAMP_PROP_BULB_Y, spot.z);
      transform.rotation.set(0, 0, 0);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      bulbs.setMatrixAt(index, transform.matrix);
    });
    bulbs.instanceMatrix.needsUpdate = true;

    setStreetLampSpots(lampSpots.map((spot) => ({ x: spot.x, y: LAMP_PROP_BULB_Y, z: spot.z })));

    const contacts = createContactShadowDiscBatch(
      'street-lamp-contact',
      lampSpots.map((spot) => ({ x: spot.x, z: spot.z, radius: 0.3, y: 0.02 })),
    );
    if (contacts) parent.add(contacts);
  });
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

/** 顶点级抖动用的稳定哈希：同一个坐标永远算出同一个数，重涂不会每次进场景换花色 */
function binGrain(x: number, y: number, z: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * 桶身母线（半径 r, 高度 y）：从桶底圆心出发，向外经小圆角爬上上下等径的直筒外壁，
 * 翻过有厚度的水平口沿（内外侧都倒圆），沿内壁向下收到封闭内底的圆心。
 * 首尾两点都落在回转轴上，绕轴一圈得到的是一张**闭合实心**回转体的表面：
 * 没有缺口、没有薄壳、没有需要补的底面，从桶底到口沿是一根连续的母线。
 * 顺序不能反：母线自下而上绕轴，法线才朝外（单测会逐顶点验一遍朝外）。
 */
const BIN_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.2, 0],
  [0.262, 0.008],
  [BIN.radius, 0.024],
  [BIN.radius, 0.712],
  [BIN.rimRadius, 0.742],
  [0.285, BIN.height],
  [0.266, BIN.height],
  [0.249, 0.752],
  [BIN.mouthTopRadius, 0.723],
  [0.206, 0.604],
  [BIN.mouthFloorRadius, BIN.mouthFloorY],
  [0, BIN.mouthFloorY],
];

/**
 * 桶身顶点色：外壁按 y 走暖黄 / 草绿的竖向渐变，投料口内壁与内底压成近黑的深色，
 * 口沿环面上暗金棕 / 墨绿；再补两道沿方位角 ±90°（桶身两侧）的竖向柔光带、
 * 靠墙一侧压暗 8% 和 ±3.5% 的微磨砂抖动，读成哑光注塑塑料。
 * 分色必须走顶点色：两只桶共用同一套 UV，贴图画法必然把它们刷成同色。
 */
function paintBinBody(variant: BinVariant): THREE.BufferGeometry {
  const points = BIN_PROFILE.map(([radius, height]) => new THREE.Vector2(radius, height));
  const geometry = new THREE.LatheGeometry(points, BIN.radialSegments);
  const position = geometry.getAttribute('position');
  const tones = BIN_TONES[variant];
  const colors = new Float32Array(position.count * 3);
  const body = new THREE.Color();
  const top = new THREE.Color(tones.top);
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const radius = Math.hypot(x, z);
    body.setHex(tones.bottom).lerp(top, Math.max(0, Math.min(1, y / BIN.height)));
    if (y > 0.5 && radius < 0.243) body.setHex(tones.mouth);
    else if (y > BIN.height - 0.02 && radius >= 0.243) body.setHex(tones.rim);
    else {
      // 两道竖向柔光带：与朝街方向（本地 +Z）成 ±90° 的两个方位上各压出一条长条亮边
      const azimuth = Math.abs(Math.abs(Math.atan2(x, z)) - Math.PI / 2);
      const sheen = Math.exp(-(azimuth * azimuth) / (2 * 0.045));
      const back = Math.max(0, -Math.cos(Math.atan2(x, z)));
      body.multiplyScalar((1 + 0.13 * sheen) * (1 - 0.08 * back) * (0.965 + 0.035 * binGrain(x, y, z)));
    }
    colors[index * 3] = body.r;
    colors[index * 3 + 1] = body.g;
    colors[index * 3 + 2] = body.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** 挤出实体：轮廓在 XY 平面（x 是本地 Z、y 是高度），挤出方向沿 X，倒角让边缘不带锋利硬边 */
function extrudeBinPart(
  outline: THREE.Vector2[],
  width: number,
  bevel: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: 2,
    steps: 1,
  });
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(width / 2, 0, 0);
  return geometry;
}

/** 圆角矩形轮廓（居中，用于侧面盒体） */
function roundedRectOutline(width: number, height: number, radius: number): THREE.Vector2[] {
  const halfW = width / 2 - radius;
  const halfH = height / 2 - radius;
  const corners: Array<[number, number]> = [[halfW, halfH], [-halfW, halfH], [-halfW, -halfH], [halfW, -halfH]];
  const points: THREE.Vector2[] = [];
  for (let corner = 0; corner < corners.length; corner += 1) {
    const [cx, cy] = corners[corner];
    const start = (Math.PI / 2) * corner;
    for (let step = 0; step <= 3; step += 1) {
      const angle = start + (step * Math.PI) / 6;
      points.push(new THREE.Vector2(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius));
    }
  }
  return points;
}

/**
 * 弧形遮檐：一段约 123° 的等厚圆弧护板，后端在桶身顶部靠墙一侧埋进口沿环带（不做悬浮薄壳），
 * 向前悬出盖在投料口上方（帽檐式），前端自由边收在投料口之内、留出投放间隙，厚度均匀。
 * 压扁系数刻意小：檐面贴着桶顶走，不抬成一片悬在半空的大板。
 */
function createBinVisor(): THREE.BufferGeometry {
  const thickness = 0.026;
  const rise = BIN.visorRadius * BIN.visorFlatten;
  const outer: THREE.Vector2[] = [];
  const inner: THREE.Vector2[] = [];
  const from = Math.PI;
  const to = 1.0;
  for (let index = 0; index <= 18; index += 1) {
    const phi = from - ((from - to) * index) / 18;
    outer.push(new THREE.Vector2(Math.cos(phi) * BIN.visorRadius, Math.sin(phi) * rise));
    inner.push(new THREE.Vector2(Math.cos(phi) * (BIN.visorRadius - thickness), Math.sin(phi) * (rise - thickness)));
  }
  const geometry = extrudeBinPart(outer.concat(inner.reverse()), BIN.visorWidth, 0.006);
  geometry.translate(0, BIN.visorY, 0);
  return geometry;
}

/** 侧面投递盒：六面封闭的圆角盒体，内侧吃进桶壁 3 cm，外露部分是个规整的凸出附件 */
function createBinSideBox(): THREE.BufferGeometry {
  const geometry = extrudeBinPart(
    roundedRectOutline(BIN.box.d, BIN.box.h, 0.02),
    BIN.box.w - 0.012,
    0.006,
  );
  geometry.translate(BIN.box.x, BIN.box.y, 0);
  return geometry;
}

/** 循环回收标志：三条带折痕的箭头首尾相接围成三角，外圈一道细环 */
function drawRecycleSymbol(
  context: CanvasRenderingContext2D,
  size: number,
  palette: { body: string; fold: string; edge: string; ring: string },
): void {
  const center = size / 2;
  const radius = size * 0.27;
  const width = size * 0.072;
  const vertices: Array<[number, number]> = [];
  for (let i = 0; i < 3; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / 3;
    vertices.push([center + Math.cos(angle) * radius, center + Math.sin(angle) * radius]);
  }
  for (let i = 0; i < 3; i += 1) {
    const from = vertices[i];
    const to = vertices[(i + 1) % 3];
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    const px = -uy;
    const py = ux;
    // 带身：0.16 – 0.6 段，箭头另画；三条箭头之间留出明显的错位口，远景才不会糊成一整块三角
    const start = 0.16;
    const end = 0.6;
    const head = 0.2;
    const band = (t0: number, t1: number, half: number, fill: string): void => {
      const a0 = from[0] + dx * t0;
      const a1 = from[1] + dy * t0;
      const b0 = from[0] + dx * t1;
      const b1 = from[1] + dy * t1;
      context.beginPath();
      context.moveTo(a0 + px * half, a1 + py * half);
      context.lineTo(b0 + px * half, b1 + py * half);
      context.lineTo(b0 - px * half, b1 - py * half);
      context.lineTo(a0 - px * half, a1 - py * half);
      context.closePath();
      context.fillStyle = fill;
      context.fill();
    };
    const mid = (start + end) / 2;
    // 折痕：后半段压深一档，读成折弯的金属片
    band(start, mid, width / 2, palette.body);
    band(mid, end, width / 2, palette.fold);
    context.beginPath();
    context.moveTo(from[0] + dx * start + px * width / 2, from[1] + dy * start + py * width / 2);
    context.lineTo(from[0] + dx * end + px * width / 2, from[1] + dy * end + py * width / 2);
    context.moveTo(from[0] + dx * start - px * width / 2, from[1] + dy * start - py * width / 2);
    context.lineTo(from[0] + dx * end - px * width / 2, from[1] + dy * end - py * width / 2);
    context.lineWidth = Math.max(1, size * 0.012);
    context.strokeStyle = palette.edge;
    context.stroke();
    // 箭头：从 end 往前收成三角形，比带身宽一档
    const tipT = end + head;
    context.beginPath();
    context.moveTo(from[0] + dx * tipT, from[1] + dy * tipT);
    context.lineTo(from[0] + dx * end + px * width * 1.6, from[1] + dy * end + py * width * 1.6);
    context.lineTo(from[0] + dx * end - px * width * 1.6, from[1] + dy * end - py * width * 1.6);
    context.closePath();
    context.fillStyle = palette.body;
    context.fill();
    context.strokeStyle = palette.edge;
    context.lineWidth = Math.max(1, size * 0.01);
    context.stroke();
  }
  context.beginPath();
  context.arc(center, center, radius * 1.42, 0, Math.PI * 2);
  context.lineWidth = Math.max(1, size * 0.014);
  context.strokeStyle = palette.ring;
  context.stroke();
}

/**
 * 丝印回收标志贴图：可回收桶用绿色实心、其他垃圾桶用银白金属质感并叠一层错位的深绿重影。
 * 只留不透明像素，透明处交给 alphaTest 丢弃，这样标志读起来是"浮在桶面上的一层丝印"。
 * 每次进场景新建、随材质一起释放：贴图不属于跨场景共享资源。
 */
/**
 * 面包店招牌牌面：左侧中文店名、右侧三块蛋糕（布丁塔 / 粉奶油 / 草莓奶油）。
 * 不走 createTextSign——它只画居中文字，出不来提示词清单里"长方形招牌 + 三个蛋糕图案"这条识别特征。
 * 无头环境没有真 2D Canvas，context 为 null 时退回纯色牌面，与 createBinLogoTexture 同一套容错。
 */
function createBakerySign(
  text: string,
  width: number,
  height: number,
  options: { background: string; foreground: string },
): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * 320);
  canvas.height = Math.ceil(height * 320);
  const context = canvas.getContext('2d');
  if (context) {
    const w = canvas.width;
    const h = canvas.height;
    const cy = h / 2;
    context.fillStyle = options.background;
    context.fillRect(0, 0, w, h);
    const frame = Math.max(4, Math.round(h * 0.05));
    context.strokeStyle = options.foreground;
    context.lineWidth = frame;
    context.strokeRect(frame / 2 + 3, frame / 2 + 3, w - frame - 6, h - frame - 6);

    const fontSize = Math.round(h * 0.44);
    context.fillStyle = options.foreground;
    context.font = `700 ${fontSize}px "YT Sans", "Microsoft YaHei", sans-serif`;
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillText(text, Math.round(w * 0.05), cy + fontSize * 0.03, Math.round(w * 0.5));

    // 三块蛋糕靠右排开，间距按牌高推，保证最后一块不压到文字区
    for (let i = 0; i < 3; i += 1) {
      const cx = w - h * 0.54 - i * h * 0.46;
      if (i === 0) {
        // 布丁塔：焦糖顶 + 塔身 + 一颗樱桃
        context.fillStyle = '#d9a05b';
        context.fillRect(cx - h * 0.15, cy - h * 0.02, h * 0.3, h * 0.18);
        context.fillStyle = '#f0c874';
        context.beginPath();
        context.arc(cx, cy - h * 0.02, h * 0.15, Math.PI, 0);
        context.fill();
        context.fillStyle = '#c8443f';
        context.beginPath();
        context.arc(cx, cy - h * 0.2, h * 0.05, 0, Math.PI * 2);
        context.fill();
      } else if (i === 1) {
        // 粉奶油蛋糕：粉胚 + 奶白顶
        context.fillStyle = '#eda6c0';
        context.fillRect(cx - h * 0.15, cy - h * 0.08, h * 0.3, h * 0.24);
        context.fillStyle = '#fff4e2';
        context.fillRect(cx - h * 0.15, cy - h * 0.16, h * 0.3, h * 0.09);
      } else {
        // 草莓奶油蛋糕：白胚 + 红草莓 + 绿叶
        context.fillStyle = '#fff6e8';
        context.fillRect(cx - h * 0.15, cy - h * 0.08, h * 0.3, h * 0.24);
        context.fillStyle = '#d9556a';
        context.beginPath();
        context.arc(cx, cy - h * 0.13, h * 0.055, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#4f8d5a';
        context.fillRect(cx - h * 0.02, cy - h * 0.21, h * 0.05, h * 0.03);
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  if (context) {
    material.map = texture;
  } else {
    texture.dispose();
  }
  material.addEventListener('dispose', () => texture.dispose());
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.castShadow = true;
  return mesh;
}

function createBinLogoTexture(kind: 'green' | 'metal'): THREE.CanvasTexture | null {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  if (kind === 'green') {
    context.shadowColor = 'rgba(0, 0, 0, 0.4)';
    context.shadowBlur = 3;
    context.shadowOffsetY = 2;
    drawRecycleSymbol(context, size, {
      body: '#2fa24a', fold: '#1c7a35', edge: '#7fe07a', ring: '#3dae55',
    });
  } else {
    // 叠印重影：先按错位的深绿画一遍，再在上面压镀铬主体
    context.globalAlpha = 0.55;
    context.translate(-size * 0.035, -size * 0.045);
    drawRecycleSymbol(context, size, {
      body: '#1b2e10', fold: '#1b2e10', edge: '#2f5a1c', ring: '#22401a',
    });
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.shadowColor = 'rgba(0, 0, 0, 0.35)';
    context.shadowBlur = 2;
    context.shadowOffsetY = 2;
    drawRecycleSymbol(context, size, {
      body: '#ffffff', fold: '#b9c0c6', edge: '#8e979e', ring: '#ffffff',
    });
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * 丝印标志：贴在半径略大于外壁的一小段圆弧片上（圆心角 logoArc，中心正对本地 +Z 即朝街一侧），
 * 跟着桶面一起弯，两端不会像平面贴片那样翘起脱离桶壁。
 */
function createBinLogoDecals(
  parent: THREE.Object3D,
  name: string,
  kind: 'green' | 'metal',
  placements: BinPlacement[],
): THREE.InstancedMesh | null {
  const texture = createBinLogoTexture(kind);
  if (!texture || placements.length === 0) return null;
  const geometry = new THREE.CylinderGeometry(
    BIN.logoRadius,
    BIN.logoRadius,
    BIN.logoHeight,
    12,
    1,
    true,
    -BIN.logoArc / 2,
    BIN.logoArc,
  );
  geometry.translate(0, BIN.logoY, 0);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    alphaTest: 0.42,
    roughness: 0.82,
    metalness: kind === 'metal' ? 0.35 : 0,
  });
  material.addEventListener('dispose', () => texture.dispose());
  const mesh = createBinInstances(parent, name, geometry, material, placements);
  if (mesh) {
    // 贴在桶面上的印刷层不参与投影，否则会在桶身上再压出一道弧形暗边
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  }
  return mesh;
}

/**
 * 双格分类垃圾桶（全程序化闭合实体）：
 * 桶身是一根连续母线绕轴回转出的实心容器——上下等径直筒、平底与小圆角、
 * 有厚度的水平口沿（内外侧都倒圆）、口沿内收再向下延到封闭内底，投料口看得见深度且不穿孔；
 * 顶后接一段等厚弧形遮檐向前悬出盖住投料口，侧面凸出六面封闭的圆角投递盒。
 * 六只桶共 6 个批次（两色桶身各 1、遮檐 1、侧盒 1、两色丝印各 1），桶位仍走原位表。
 */
function buildTrashcans(parent: THREE.Object3D): void {
  const placements = buildBinPlacements();
  const shell = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.02,
  });
  (Object.keys(BIN_TONES) as BinVariant[]).forEach((variant) => {
    createBinInstances(
      parent,
      `street-bins-body-${variant}`,
      paintBinBody(variant),
      shell,
      placements.filter((placement) => placement.variant === variant),
    );
  });

  const hardware = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.05 });
  const shade = placements.map((placement) => new THREE.Color(BIN_TONES[placement.variant].shade));
  createBinInstances(parent, 'street-bins-visor', createBinVisor(), hardware, placements, shade);
  createBinInstances(parent, 'street-bins-flap-box', createBinSideBox(), hardware, placements, shade);

  createBinLogoDecals(
    parent,
    'street-bin-logo-recyclable',
    'green',
    placements.filter((placement) => placement.variant === 'recyclable'),
  );
  createBinLogoDecals(
    parent,
    'street-bin-logo-other',
    'metal',
    placements.filter((placement) => placement.variant === 'other'),
  );

  const contacts = createContactShadowDiscBatch(
    'street-bin-contact',
    placements.map((placement) => ({ x: placement.x, z: placement.z, radius: 0.3, y: 0.02 })),
  );
  if (contacts) parent.add(contacts);
}

function buildStreetProps(parent: THREE.Object3D): void {
  // 双格分类垃圾桶（原位表，全程序化闭合实体）
  buildTrashcans(parent);

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
  const bikeWireParts: BoxInstanceSpec[] = [];
  const transform = new THREE.Object3D();

  bikeSpots.forEach((spot, index) => {
    // 轮底原本陷进人行道 0.014 m：先把整车抬到贴地，否则加了脚撑反而坐实穿模
    const rear = { x: spot.x, y: 0.396, z: spot.z + spot.dir * 0.55 };
    const front = { x: spot.x, y: 0.396, z: spot.z - spot.dir * 0.55 };
    const crank = { x: spot.x, y: 0.456, z: spot.z + spot.dir * 0.05 };
    const seat = { x: spot.x, y: 0.896, z: spot.z + spot.dir * 0.25 };
    const handle = { x: spot.x, y: 0.936, z: spot.z - spot.dir * 0.38 };

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
      from: { x: spot.x - 0.14, y: 0.996, z: spot.z - spot.dir * 0.42 },
      to: { x: spot.x + 0.14, y: 0.996, z: spot.z - spot.dir * 0.42 },
      radius: 0.014,
    });
    // 脚撑：从曲柄侧下方斜到地面，与车架同批（0 新增 DrawCall）
    bikeFrameSegments.push({
      from: { x: spot.x, y: 0.5, z: spot.z + spot.dir * 0.2 },
      to: { x: spot.x - 0.1, y: 0.062, z: spot.z + spot.dir * 0.24 },
      radius: 0.012,
    });
    bikeSaddles.push({
      position: { x: spot.x, y: 0.926, z: spot.z + spot.dir * 0.28 },
      scale: { x: 0.16, y: 0.045, z: 0.25 },
    });

    // 辐条（每轮 6 根）+ 前车筐：都是细件，合成 1 批
    for (const point of [rear, front]) {
      for (let spoke = 0; spoke < 6; spoke += 1) {
        bikeWireParts.push({
          position: { x: point.x, y: point.y, z: point.z },
          scale: { x: 0.008, y: 0.29, z: 0.012 },
          rotation: { x: (spoke * Math.PI) / 3, y: 0, z: 0 },
        });
      }
    }
    const basketZ = spot.z - spot.dir * 0.54;
    for (const dz of [-0.09, 0.09]) {
      bikeWireParts.push({
        position: { x: spot.x, y: 0.93, z: basketZ + dz },
        scale: { x: 0.24, y: 0.14, z: 0.012 },
      });
    }
    for (const dx of [-0.12, 0.12]) {
      bikeWireParts.push({
        position: { x: spot.x + dx, y: 0.93, z: basketZ },
        scale: { x: 0.012, y: 0.14, z: 0.19 },
      });
    }
    bikeWireParts.push({
      position: { x: spot.x, y: 0.865, z: basketZ },
      scale: { x: 0.24, y: 0.014, z: 0.19 },
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
  createBoxInstances(parent, 'street-bike-wires', bikeWireParts, createMatteMaterial(0xb9c0bf, 0.62));

  const signPole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.8, 7), bicycleMaterial);
  signPole.position.set(-2.1, 0.96, -34);
  parent.add(signPole);
  const trafficSign = createTextSign('学校区域', 0.74, 0.34, {
    background: '#5e737c',
    foreground: '#ece8dc',
    resolution: 320,
  });
  trafficSign.position.set(-2.1, 1.86, -34);
  trafficSign.castShadow = false;
  if (trafficSign.material instanceof THREE.MeshStandardMaterial) {
    trafficSign.material.roughness = 0.92;
    trafficSign.material.envMapIntensity = 0.28;
    trafficSign.material.emissive.set(0xdfe9ee);
    trafficSign.material.emissiveMap = trafficSign.material.map;
    trafficSign.material.emissiveIntensity = 0.34;
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

/** S4 街道三处可选伏笔的观察热点与帮忙交互点 */
const S4_HOTSPOTS: HotspotConfig[] = [
  { id: 'convenience-scroller', position: { x: 2.05, y: 1.35, z: -24.2 }, maxDistance: 10, maxAngleDeg: 18 },
  { id: 'father-suitcase', position: { x: -1.95, y: 1.2, z: -1.55 }, maxDistance: 10, maxAngleDeg: 18 },
  { id: 'fallen-bicycle', position: { x: -1.78, y: 0.9, z: -26.4 }, maxDistance: 12, maxAngleDeg: 20 },
];

const S4_INTERACTABLES: InteractableConfig[] = [
  { id: 'help-passerby', position: { x: -1.78, y: 0.7, z: -26.4 }, lightOffsetY: 0.35, maxDistance: 4.5 },
];

/** 程序化简易自行车（倒地状态，玩家帮忙后在运行时扶正） */
function buildFallenBicycle(): THREE.Group {
  const bike = new THREE.Group();
  bike.name = 'street-fallen-bicycle';
  const frameMat = createMatteMaterial(0x4b6b78, 0.78);
  const tireMat = createMatteMaterial(0x2d3236, 0.94);
  const wheelGeo = new THREE.TorusGeometry(0.28, 0.032, 8, 18);
  for (const offsetZ of [-0.46, 0.46]) {
    const wheel = new THREE.Mesh(wheelGeo, tireMat);
    wheel.position.set(0, 0.28, offsetZ);
    wheel.rotation.y = Math.PI / 2;
    wheel.castShadow = true;
    bike.add(wheel);
  }
  const topBar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.72), frameMat);
  topBar.position.set(0, 0.56, 0);
  topBar.castShadow = true;
  const seatPost = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.36, 0.04), frameMat);
  seatPost.position.set(0, 0.48, -0.22);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.22), tireMat);
  seat.position.set(0, 0.68, -0.22);
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.04), frameMat);
  stem.position.set(0, 0.52, 0.36);
  const handlebar = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.035, 0.035), tireMat);
  handlebar.position.set(0, 0.74, 0.36);
  bike.add(topBar, seatPost, seat, stem, handlebar);
  return bike;
}

/** 街道三处叙事伏笔：便利店刷手机路人、父子拎箱子、摔倒自行车与举手机围观人群（全部使用非主线差异化路人模型，避免与后续阿远/林夏父亲撞脸） */
function buildStreetForeshadowings(
  parent: THREE.Object3D,
  actors: Record<string, THREE.Object3D>,
): void {
  // 1. 便利店门口：低头刷手机随手一划的路人
  const scroller = createCharacterActor('studentMale2', 1.72, 0x6b7b84, {
    yaw: -1.45,
    leanRad: 0.04,
    props: [{ kind: 'phone', color: 0x3b4147, side: 'right' }],
  });
  scroller.name = 'street-convenience-scroller';
  scroller.position.set(2.05, 0, -24.2);
  parent.add(scroller);
  actors['foreshadow-scroller'] = scroller;

  // 2. 路边：爸爸帮孩子拎箱子（使用稳重非主线男同学放大身高饰演路人家长，不撞脸林夏爸爸）
  const dadPos = { x: -2.05, z: -1.2 };
  const kidPos = { x: -2.05, z: -1.95 };
  const dad = createCharacterActor('studentMale4', 1.78, 0x737c75, { yaw: yawToward(dadPos, kidPos) });
  dad.name = 'street-foreshadow-father';
  dad.position.set(dadPos.x, 0, dadPos.z);
  const kid = createCharacterActor('studentFemale', 1.56, 0x9aa296, { yaw: yawToward(kidPos, dadPos) });
  kid.name = 'street-foreshadow-child';
  kid.position.set(kidPos.x, 0, kidPos.z);
  const suitcase = addBox(
    parent,
    { x: -1.78, y: 0.31, z: -1.55 },
    { w: 0.44, h: 0.62, d: 0.28 },
    0x6d7c8a,
  );
  suitcase.name = 'street-foreshadow-suitcase';
  parent.add(dad, kid);
  actors['foreshadow-dad'] = dad;
  actors['foreshadow-kid'] = kid;

  // 3. 路边摔倒的自行车 + 4 名举着手机拍照的围观者（5 人 5 套互不重复的非主线同学模型）
  const bikePos = { x: -1.78, z: -26.4 };
  const bike = buildFallenBicycle();
  bike.position.set(bikePos.x, 0.12, bikePos.z);
  bike.rotation.set(0, 0.35, Math.PI * 0.44);
  parent.add(bike);
  actors['fallen-bike'] = bike;

  const cyclistPos = { x: -2.22, z: -26.85 };
  const cyclist = createCharacterActor('studentFemale', 1.62, 0x859099, { yaw: yawToward(cyclistPos, bikePos) });
  cyclist.name = 'street-fallen-cyclist';
  cyclist.position.set(cyclistPos.x, 0, cyclistPos.z);
  parent.add(cyclist);
  actors['fallen-cyclist'] = cyclist;

  const onlookers: ReadonlyArray<{ x: number; z: number; model: CharacterModelId; color: number; h: number }> = [
    { x: -2.35, z: -25.15, model: 'studentMale3', color: 0x8b867d, h: 1.71 },
    { x: -2.42, z: -27.75, model: 'studentFemale4', color: 0x7c878f, h: 1.63 },
    { x: -1.52, z: -25.0, model: 'studentMale2', color: 0x748188, h: 1.72 },
    { x: -1.52, z: -27.85, model: 'studentFemale3', color: 0x91887c, h: 1.64 },
  ];
  onlookers.forEach((spec, index) => {
    const onlooker = createCharacterActor(spec.model, spec.h, spec.color, {
      yaw: yawToward(spec, bikePos),
      props: [{ kind: 'phone', color: 0x343a40, side: 'right' }],
    });
    onlooker.name = `street-bike-onlooker-${index}`;
    onlooker.position.set(spec.x, 0, spec.z);
    parent.add(onlooker);
    actors[`bike-onlooker-${index}`] = onlooker;
  });
}

function buildStreet(parent: THREE.Object3D): {
  occluders: THREE.Object3D[];
  actors: Record<string, THREE.Object3D>;
} {
  const occluders: THREE.Object3D[] = [];
  const actors: Record<string, THREE.Object3D> = {};
  streetGeneration += 1;
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
    resolution: 320,
  });
  sign.position.set(0, 0, 0.022);
  sign.castShadow = false;
  if (sign.material instanceof THREE.MeshStandardMaterial) {
    sign.material.roughness = 0.96;
    sign.material.metalness = 0;
    sign.material.envMapIntensity = 0.22;
    sign.material.emissive.set(0xfff0d2);
    sign.material.emissiveMap = sign.material.map;
    sign.material.emissiveIntensity = 0.3;
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

  buildStreetForeshadowings(parent, actors);

  return { occluders, actors };
}

/** 手机震动预告文案（概括表达，无真实应用名） */
const VIBRATION_PREVIEWS = {
  'street-vibration-1': '迎新群：@所有人 新生报到 9:00 截止，请抓紧～',
  'street-vibration-2': '迎新群：有人@你，快看群消息。',
} as const;

const vibrationTimers: number[] = [];
let unsubHelpInteract: (() => void) | null = null;
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

/** 道具实例的几何与材质归 resources 的道具缓存共享，这里只释放每代场景自己产生的 instanceMatrix */
function disposeStreetPropMeshes(): void {
  for (const mesh of streetPropMeshes) mesh.dispose();
  streetPropMeshes.length = 0;
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
    { id: 'npc-0-greeter', clips: ['agree', 'greet_04', 'fold_arms'], switchSec: 8.5 },
    { id: 'npc-0-student', clips: ['look_around', 'fold_arms', 'afraid'], switchSec: 8.8 },
    { id: 'npc-1-greeter', clips: ['agree', 'laugh_01'], switchSec: 9.2 },
    { id: 'npc-1-student', clips: ['wait', 'cheer', 'make_a_call_02'], switchSec: 8.2 },
    { id: 'foreshadow-dad', clips: ['agree', 'look_around', 'make_a_call_02'], switchSec: 9.0 },
    { id: 'foreshadow-kid', clips: ['wait', 'agree', 'idle'], switchSec: 7.8 },
    { id: 'foreshadow-scroller', clips: ['wait', 'laugh_02'], switchSec: 8.4 },
    { id: 'bike-onlooker-0', clips: ['make_a_call_02', 'cheer', 'wait'], switchSec: 7.4 },
    { id: 'bike-onlooker-1', clips: ['look_around', 'fold_arms'], switchSec: 8.6 },
    { id: 'bike-onlooker-2', clips: ['laugh_02', 'wait'], switchSec: 7.9 },
    { id: 'bike-onlooker-3', clips: ['laugh_01', 'agree'], switchSec: 8.3 },
  ];
  for (const spec of specs) {
    const actor = actors[spec.id];
    if (!actor) continue;
    const controller = createActorAnimation(actor);
    const available = controller ? spec.clips.filter((c) => controller.hasAnimation(c)) : spec.clips;
    const entry: StreetAnimatedNpc = {
      actor,
      clips: available.length > 0 ? available : spec.clips,
      switchSec: spec.switchSec,
      timer: 0,
      clipIndex: 0,
      controller: available.length > 0 ? controller : null,
    };
    if (entry.controller) {
      entry.controller.play(entry.clips[0], { fadeIn: 0.35, timeScale: 0.88, loop: true });
    } else if (controller) {
      controller.dispose();
    }
    streetAnimatedNpcs.push(entry);
  }
}

/** S4 运行时装：进入后 4s / 26s 各震动一次（间隔 22s ≥ 20s）；驱动迎新女老师周期挥手与待机 */
export const streetRuntime: SceneRuntime = {
  enter(context: SceneRuntimeContext): void {
    if (context.sceneId !== 'S4') return;
    streetNightContext = context;
    applyStreetNight();
    stopIdleMotions();
    startStreetIdleMotions(context.actors);
    unsubHelpInteract?.();
    unsubHelpInteract = context.bus.on('scene:interact', ({ sceneId, targetId }) => {
      if (sceneId !== 'S4' || targetId !== 'help-passerby') return;
      const bike = context.actors['fallen-bike'];
      if (bike) {
        bike.rotation.z = 0;
        bike.position.y = 0;
      }
      context.setInteractableVisible('help-passerby', false);
    });
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
    tickStreetNight(dtSeconds);
    for (const entry of streetAnimatedNpcs) {
      if (!entry.actor.visible) continue;
      if (!entry.controller) {
        const created = createActorAnimation(entry.actor);
        if (created) {
          const available = entry.clips.filter((c) => created.hasAnimation(c));
          if (available.length > 0) {
            entry.clips = available;
            entry.clipIndex = 0;
            entry.controller = created;
            entry.controller.play(entry.clips[0], { fadeIn: 0.35, timeScale: 0.88, loop: true });
          } else {
            created.dispose();
          }
        }
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

  /** ?night=1 由 WorldApp 在建场后一次性下发；重复调用只切可见性，不重建夜间件 */
  setNight(enabled: boolean): void {
    streetNightEnabled = enabled;
    applyStreetNight();
  },

  exit(): void {
    // 先作废本代场景：仍在途的道具回调不能再往复用的 levelGroup 里补挂几何
    streetGeneration += 1;
    resetStreetNightRig();
    stopIdleMotions();
    disposeStreetAnimations();
    disposeStreetPropMeshes();
    for (const timer of vibrationTimers) window.clearTimeout(timer);
    vibrationTimers.length = 0;
    unsubHelpInteract?.();
    unsubHelpInteract = null;
  },
};

export function createStreetDefinition(_sceneId: SceneId): WorldSceneDefinition {
  return {
    sceneKey: 'street',
    spawn: SPAWN,
    nav: NAV,
    // 进 S4 时按需预载：唯一迎新举牌女老师 + 7 位互不重复的非主线同学模型（不再混入主线阿远）
    requiredModels: [
      'volunteer',
      'studentMale',
      'studentFemale',
      'studentMale2',
      'studentMale3',
      'studentMale4',
      'studentFemale3',
      'studentFemale4',
    ],
    interactables: S4_INTERACTABLES,
    hotspots: S4_HOTSPOTS,
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

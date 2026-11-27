// scenes3d/room.ts —— 程序化暖调卧室（S1 起床 / S2 手机教学 / S3 出门）
// 坐标与站位全部数据化（ROOM_PROPS / SPAWN / PER_SCENE），后续替换正式 .glb 时只改 build 内部实现。

import * as THREE from 'three';
import type { SceneId } from '../data/storySchema';
import { parseUrlParams } from '../core/urlParams';
import type { ObstacleAabb } from '../world/navMath';
import type {
  InteractableConfig,
  HotspotConfig,
  NavigationConfig,
  SceneRuntime,
  SceneRuntimeContext,
  SceneSpawn,
  TargetGuideConfig,
  WorldSceneDefinition,
} from '../world/worldSceneTypes';
import { addBox, createMatteMaterial } from './shared';
import type { BoxSize, Vec3 } from './shared';
import { SHARED_RESOURCE_FLAG } from '../world/resources';
import {
  getAsphaltMaterial,
  getBarkMaterial,
  getDocumentLabelMaterial,
  getFacadeConcreteMaterial,
  getFacadeWindowMaterial,
  getFabricMaterial,
  getPavingMaterial,
  getPlasterMaterial,
  getPortraitMaterial,
  getScreenLogoMaterial,
  getStoreInteriorMaterial,
  getWarmLampGlowMaterial,
  getWoodFloorMaterial,
} from './materials';
import type { CanopyCardSpec } from './canopy';
import { canopyBudget, getQualityTier } from '../world/quality';

interface PropSpec {
  id: string;
  center: { x: number; y: number; z: number };
  size: BoxSize;
  color: number;
}

/** 房间道具坐标表（交互锚点直接引用这些位置，保证光点与几何体对齐） */
const ROOM_PROPS: Record<string, PropSpec> = {
  bed: { id: 'bed', center: { x: -2.85, y: 0.225, z: -3.1 }, size: { w: 1.05, h: 0.45, d: 2.2 }, color: 0xa8a3ae },
  pillow: { id: 'pillow', center: { x: -2.85, y: 0.52, z: -4.02 }, size: { w: 0.9, h: 0.14, d: 0.4 }, color: 0xd7d2c8 },
  desk: { id: 'desk', center: { x: 2.7, y: 0.375, z: -2.2 }, size: { w: 1.5, h: 0.75, d: 0.8 }, color: 0x8d8378 },
  chair: { id: 'chair', center: { x: 2.4, y: 0.23, z: -0.9 }, size: { w: 0.5, h: 0.46, d: 0.5 }, color: 0x8d8378 },
  chairBack: { id: 'chairBack', center: { x: 2.42, y: 0.83, z: -0.68 }, size: { w: 0.5, h: 0.74, d: 0.08 }, color: 0x8d8378 },
  suitcase: { id: 'suitcase', center: { x: 1.75, y: 0.275, z: 3.1 }, size: { w: 0.75, h: 0.55, d: 0.35 }, color: 0x7e8696 },
  door: { id: 'door', center: { x: 3.39, y: 1.1, z: 2.7 }, size: { w: 0.12, h: 2.2, d: 1.1 }, color: 0x6d5a48 },
};

/** 居家化布置位表（衣柜 / 书架贴右墙 +X，画像 / 地毯 / 脚垫按参考机位摆放） */
const WARDROBE = {
  xFront: 2.82, xBack: 3.4, zNear: 0.29, zFar: 1.49, height: 2.2,
  /** 右门扇敞开角度：既露出挂在里面的文化衫，也不伸进房门的开启弧 */
  doorOpenRad: (55 * Math.PI) / 180,
} as const;

const BOOKSHELF = { xFront: 3.1, xBack: 3.4, zNear: -1.7, zFar: -0.6, height: 1.7 } as const;

/** 梳妆区贴 +Z 墙（房门与小推车右侧、朝 -X 墙角那一段）：背板贴墙，台面朝房间中央 */
const DRESSER = { xCenter: -1.55, width: 1.1, zBack: 3.3, depth: 0.42, height: 0.75 } as const;
const DRESSER_STOOL = { x: -1.38, z: 3.09, radius: 0.17, seatY: 0.44 } as const;
const DRESSER_MIRROR = { x: -1.55, y: 1.5, z: 3.268, radius: 0.27 } as const;
const FLOOR_LAMP = { x: -2.6, z: 3.05, baseRadius: 0.16 } as const;

const RUG = { center: { x: 0, z: -0.85 }, w: 2, d: 1.5 } as const;
const FOOT_MAT = { center: { x: -2.5, z: -1.68 }, radius: 0.3 } as const;

/** 两幅画像：同款细原木框 40×50cm、中心离地 1.5m，并排挂在床头那面橙墙，以床的正中线（x −2.85）对称 */
const PORTRAITS = [
  { kind: 'her' as const, wall: 'z' as const, center: { x: -3.15, y: 1.5, z: -6.2825 } },
  { kind: 'father' as const, wall: 'z' as const, center: { x: -2.55, y: 1.5, z: -6.2825 } },
] as const;

/** 文化衫改挂衣柜内，光点与注视锚点落在敞开的柜门口 */
const SHIRT_ANCHOR = { x: 2.78, y: 1.6, z: 1.14 } as const;

const ROOM_WALLS = [
  { center: { x: 0, y: 1.4, z: 3.4 }, size: { w: 7.4, h: 2.8, d: 0.2 } },
  { center: { x: -3.5, y: 1.4, z: -1.5 }, size: { w: 0.2, h: 2.8, d: 9.8 } },
  { center: { x: 3.5, y: 1.4, z: -1.5 }, size: { w: 0.2, h: 2.8, d: 9.8 } },
] as const;

const BACK_WALL_SEGMENTS = [
  { center: { x: -1.3, y: 1.4, z: -6.4 }, size: { w: 4.8, h: 2.8, d: 0.2 } },
  { center: { x: 3.1, y: 1.4, z: -6.4 }, size: { w: 1.2, h: 2.8, d: 0.2 } },
  { center: { x: 1.8, y: 0.65, z: -6.4 }, size: { w: 1.4, h: 1.3, d: 0.2 } },
  { center: { x: 1.8, y: 2.65, z: -6.4 }, size: { w: 1.4, h: 0.3, d: 0.2 } },
] as const;

/** 窗（真实墙洞开口）：窗框 + 分隔窗扇 + 微反光玻璃 + 褶皱窗帘 */
const WINDOW = { center: { x: 1.8, y: 1.9, z: -6.32 }, size: { w: 1.4, h: 1.2, d: 0.06 } } as const;

/** S1/S2/S3 共用出生点（同 sceneKey 切换时不重置站位） */
const SPAWN: SceneSpawn = { x: -1.6, z: 0.2, yaw: 0.35, pitchDeg: -8 };

/** 房间障碍物：床、书桌、椅、行李箱、衣柜（含敞开的门扇）、书架、梳妆台与落地灯 */
const OBSTACLES: ObstacleAabb[] = [
  { id: 'room-bed', minX: -3.38, maxX: -2.32, minZ: -4.2, maxZ: -2.0, height: 0.45 },
  { id: 'room-desk', minX: 1.95, maxX: 3.45, minZ: -2.6, maxZ: -1.8, height: 0.75 },
  { id: 'room-chair', minX: 2.15, maxX: 2.65, minZ: -1.15, maxZ: -0.65, height: 0.46 },
  { id: 'room-suitcase', minX: 1.375, maxX: 2.125, minZ: 2.92, maxZ: 3.28, height: 0.55 },
  { id: 'room-wastebasket', minX: -3.28, maxX: -2.88, minZ: -1.94, maxZ: -1.56, height: 0.34 },
  { id: 'room-wardrobe', minX: 2.82, maxX: 3.4, minZ: 0.29, maxZ: 1.49, height: 2.2 },
  { id: 'room-wardrobe-door', minX: 2.32, maxX: 2.84, minZ: 1.14, maxZ: 1.5, height: 2.2 },
  { id: 'room-bookshelf', minX: 3.1, maxX: 3.4, minZ: -1.7, maxZ: -0.6, height: 1.7 },
  {
    id: 'room-dresser',
    minX: DRESSER.xCenter - DRESSER.width / 2, maxX: DRESSER.xCenter + DRESSER.width / 2,
    minZ: DRESSER.zBack - DRESSER.depth - 0.02, maxZ: DRESSER.zBack, height: DRESSER.height,
  },
  {
    id: 'room-floor-lamp',
    minX: FLOOR_LAMP.x - FLOOR_LAMP.baseRadius, maxX: FLOOR_LAMP.x + FLOOR_LAMP.baseRadius,
    minZ: FLOOR_LAMP.z - FLOOR_LAMP.baseRadius, maxZ: FLOOR_LAMP.z + FLOOR_LAMP.baseRadius, height: 1.6,
  },
];

const NAV: NavigationConfig = {
  groundY: 0,
  bounds: { minX: -3.3, maxX: 3.3, minZ: -6.2, maxZ: 3.2 },
  obstacles: OBSTACLES,
};

const TRIM_COLOR = 0x59412e;
const WOOD_COLOR = 0x8f7f6d;
const BOOK_COLORS = { brick: 0xa44735, forest: 0x365b44, yellow: 0xd7a841, lake: 0x397c89 } as const;

/** 居家配色：原木 + 暖白 + 浅灰 + 米白，点缀绿植，不出现黑色大块家具 */
const OAK_LIGHT = 0xbfa07a;
const OAK_FRAME = 0xa3855c;
const WARM_WHITE = 0xf2ece0;
const LINEN = 0xeae3d4;
const RUG_GRAY = 0xdedad0;
const RATTAN = 0xc9a06a;
const HANDLE_BLACK = 0x2b2b2c;
const SHELF_BOOK_TINTS = [0xa44735, 0x365b44, 0xd7a841, 0x397c89, 0xb0916a, 0x7d8b7e, 0xc9b28c, 0x8c7f92] as const;

interface BoxPart { center: Vec3; size: BoxSize; rotationX?: number; rotationY?: number; rotationZ?: number }

/** 现有清理入口释放几何时，同步释放实例矩阵/颜色缓冲；不需要修改 world。 */
function releaseInstancesWithGeometry(mesh: THREE.InstancedMesh): void {
  const release = () => {
    mesh.dispose();
    mesh.geometry.removeEventListener('dispose', release);
  };
  mesh.geometry.addEventListener('dispose', release);
}

/** 仅在一次 build 内复用单位盒几何与调色板；不打全局共享标记，随房间网格清理。 */
function createRoomDetails() {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const palette = new Map<string, THREE.MeshStandardMaterial>();
  const matte = (color: number, roughness = 0.92): THREE.MeshStandardMaterial => {
    const key = `${color}:${roughness}`;
    let material = palette.get(key);
    if (!material) { material = createMatteMaterial(color, roughness); palette.set(key, material); }
    return material;
  };
  const box = (parent: THREE.Object3D, name: string, center: Vec3, size: BoxSize,
    material: THREE.Material, castShadow = false): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(center.x, center.y, center.z);
    mesh.scale.set(size.w, size.h, size.d);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const batch = (parent: THREE.Object3D, name: string, parts: BoxPart[], material: THREE.Material): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(geometry, material, parts.length);
    releaseInstancesWithGeometry(mesh);
    mesh.name = name;
    mesh.receiveShadow = true;
    const transform = new THREE.Object3D();
    parts.forEach((part, index) => {
      transform.position.set(part.center.x, part.center.y, part.center.z);
      transform.scale.set(part.size.w, part.size.h, part.size.d);
      transform.rotation.set(part.rotationX ?? 0, part.rotationY ?? 0, part.rotationZ ?? 0);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    parent.add(mesh);
    return mesh;
  };
  /** 一批多色：书脊这类"同形不同色"的散件用实例色，整面书架的书只占两个绘制批次 */
  const batchColored = (parent: THREE.Object3D, name: string,
    parts: (BoxPart & { color: number })[], roughness = 0.9): THREE.InstancedMesh => {
    const mesh = batch(parent, name, parts, matte(0xffffff, roughness));
    const tint = new THREE.Color();
    parts.forEach((part, index) => {
      tint.setHex(part.color);
      mesh.setColorAt(index, tint);
    });
    mesh.instanceColor!.needsUpdate = true;
    return mesh;
  };
  return { box, batch, batchColored, matte };
}
type RoomDetails = ReturnType<typeof createRoomDetails>;

/** 克隆只拥有染色材质；共享贴图仍由 materials 缓存管理，绝不修改其他场景墙色。 */
function tintForRoom(source: THREE.MeshStandardMaterial, color: number): THREE.MeshStandardMaterial {
  const material = source.clone();
  delete material.userData[SHARED_RESOURCE_FLAG];
  material.color.setHex(color);
  return material;
}

function addTexturedBox(
  parent: THREE.Object3D,
  center: Vec3,
  size: BoxSize,
  material: THREE.Material,
  castShadow = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.w, size.h, size.d), material);
  mesh.position.set(center.x, center.y, center.z);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

type LightQuad = [Vec3, Vec3, Vec3, Vec3];

/** 多块柔边光斑合成一个网格：百叶光纹只占墙 / 地板两个绘制批次。 */
function createSoftLightBatch(quads: LightQuad[], opacity: number): THREE.Mesh {
  const columns = 4;
  const rows = 8;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (const [nearLeft, nearRight, farLeft, farRight] of quads) {
    const offset = positions.length / 3;
    for (let row = 0; row <= rows; row += 1) {
      const v = row / rows;
      for (let column = 0; column <= columns; column += 1) {
        const u = column / columns;
        const nearX = nearLeft.x + (nearRight.x - nearLeft.x) * u;
        const nearY = nearLeft.y + (nearRight.y - nearLeft.y) * u;
        const nearZ = nearLeft.z + (nearRight.z - nearLeft.z) * u;
        const farX = farLeft.x + (farRight.x - farLeft.x) * u;
        const farY = farLeft.y + (farRight.y - farLeft.y) * u;
        const farZ = farLeft.z + (farRight.z - farLeft.z) * u;
        positions.push(
          nearX + (farX - nearX) * v,
          nearY + (farY - nearY) * v,
          nearZ + (farZ - nearZ) * v,
        );
        const alpha = Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * 0.72;
        colors.push(1, 1, 1, alpha);
      }
    }
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const a = offset + row * (columns + 1) + column;
        const b = a + 1;
        const c = a + columns + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({
    color: 0xffdca8,
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  return mesh;
}

function buildShell(parent: THREE.Object3D, occluders: THREE.Object3D[], details: RoomDetails): void {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 9.4),
    getWoodFloorMaterial({ repeatX: 2, repeatY: 12 }),
  );
  floor.name = 'room-oak-floor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -1.5);
  floor.receiveShadow = true;
  parent.add(floor);

  const plaster = getPlasterMaterial({ repeatX: 3, repeatY: 1 });
  const creamWall = tintForRoom(plaster, 0xf1ece1);
  const terracottaWall = tintForRoom(plaster, 0xc46d45);
  ROOM_WALLS.forEach((wall, index) => {
    const mesh = details.box(parent, `room-cream-wall-${index}`, wall.center, wall.size, creamWall);
    occluders.push(mesh);
  });
  BACK_WALL_SEGMENTS.forEach((wall, index) => {
    const mesh = details.box(parent, `room-terracotta-wall-${index}`, wall.center, wall.size, terracottaWall);
    occluders.push(mesh);
  });
  addTexturedBox(
    parent,
    { x: 0, y: 2.86, z: -1.5 },
    { w: 7.4, h: 0.12, d: 9.8 },
    getPlasterMaterial({ repeatX: 3, repeatY: 4 }),
    false,
  );

  for (const z of [-6.27, 3.27]) {
    details.box(parent, `room-dark-skirting-z-${z}`, { x: 0, y: 0.075, z },
      { w: 6.75, h: 0.15, d: 0.045 }, details.matte(TRIM_COLOR));
    addBox(parent, { x: 0, y: 2.71, z }, { w: 6.75, h: 0.09, d: 0.055 }, TRIM_COLOR, {
      castShadow: false,
    });
  }
  for (const x of [-3.37, 3.37]) {
    details.box(parent, `room-dark-skirting-x-${x}`, { x, y: 0.075, z: -1.5 },
      { w: 0.045, h: 0.15, d: 9.45 }, details.matte(TRIM_COLOR));
    addBox(parent, { x, y: 2.71, z: -1.5 }, { w: 0.055, h: 0.09, d: 9.45 }, TRIM_COLOR, {
      castShadow: false,
    });
    for (const z of [-6.25, 3.25]) {
      addBox(parent, { x, y: 1.4, z }, { w: 0.055, h: 2.8, d: 0.055 }, TRIM_COLOR, {
        castShadow: false,
      });
    }
  }
}

/* ============================================================================
 * 窗外远景（S1 第一幕）
 *
 * 相机在窗前朝 −Z 望，可见范围由窗洞（x 1.1~2.5、y 1.27~2.53）决定，越远张得越开：
 *   z −16 行道树 ≈ x −2.6~6.4 / y −1.8~6.5
 *   z −30 老公寓 ≈ x −7.7~11.3 / y −3.3~14.7
 * 所以远景按深度分五层铺开，每层都落在上面这圈可视楔形里，转视角时不会露出边界。
 * 贴图全部逐像素程序化生成（只用 createImageData/putImageData，与 Node 单测的 canvas stub 兼容），
 * 新增网络体积 0 KB；远景一律不进 occluders、不进碰撞，纯观看内容。
 * ========================================================================== */

const EXTERIOR = {
  sillZ: -6.18,
  leafZ: -9.4,
  treeZ: -16.4,
  road: { near: -19.6, far: -27.4 },
  buildingZ: -30,
  farBlockZ: -40,
  backdropZ: -46,
} as const;

function extHash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const extClamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const extSmooth = (t: number): number => t * t * (3 - 2 * t);
const extFade = (t: number, edge0: number, edge1: number): number => extSmooth(extClamp01((t - edge0) / (edge1 - edge0)));

/** 与 materials.ts 同一套周期值噪声：uv∈[0,1) 时贴图四边严格无缝 */
function extNoise(u: number, v: number, periodX: number, periodY: number, seed: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const wrap = (value: number, period: number): number => ((value % period) + period) % period;
  const sx = extSmooth(x - x0);
  const sy = extSmooth(y - y0);
  const n00 = extHash(wrap(x0, periodX), wrap(y0, periodY), seed);
  const n10 = extHash(wrap(x0 + 1, periodX), wrap(y0, periodY), seed);
  const n01 = extHash(wrap(x0, periodX), wrap(y0 + 1, periodY), seed);
  const n11 = extHash(wrap(x0 + 1, periodX), wrap(y0 + 1, periodY), seed);
  return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
}

type Rgba = [number, number, number, number];

const exteriorTextures = new Map<string, THREE.CanvasTexture>();

function paintExteriorTexture(
  key: string,
  width: number,
  height: number,
  colorAt: (u: number, v: number) => Rgba,
): THREE.CanvasTexture {
  const cacheKey = `${key}:${width}x${height}`;
  const cached = exteriorTextures.get(cacheKey);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前环境不支持 2D Canvas，无法生成窗外远景贴图');
  const image = context.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y += 1) {
    // 画布行向下，统一翻成"v=0 在底"，地平线 / 勒脚积垢这类按高度写的图层才直观
    const v = (height - 1 - y) / height;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = colorAt(x / width, v);
      const i = (y * width + x) * 4;
      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
      data[i + 3] = Math.max(0, Math.min(255, a));
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  texture.userData[SHARED_RESOURCE_FLAG] = true;
  exteriorTextures.set(cacheKey, texture);
  return texture;
}

/** 橡木百叶：顺纹长条 + 弯曲年轮 + 两颗节疤 + 晒白与磨圆的棱边 */
function blindOakColor(u: number, v: number): Rgba {
  const bend = extNoise(u, v, 2, 4, 301);
  const ring = 0.5 + 0.5 * Math.sin((v * 7 + bend * 1.9) * Math.PI * 2);
  const fibre = extNoise(u, v, 128, 10, 303);
  const speck = extHash(Math.floor(u * 512), Math.floor(v * 128), 307);
  const knot = (ku: number, kv: number, radius: number): number => {
    const dx = (u - ku) * 3.1;
    const dy = (v - kv) * 2.4;
    const d = Math.hypot(dx, dy) / radius;
    return d < 1 ? (0.42 + 0.58 * Math.abs(Math.sin(d * 9))) * (1 - d * 0.5) : 0;
  };
  const edgeWear = extFade(Math.abs(v - 0.5) * 2, 0.74, 1) * 0.42;
  const sunBleach = extFade(u, 0.02, 0.62) * 0.05;
  const tone = 0.92 + ring * 0.06 + fibre * 0.11 + speck * 0.05 + sunBleach - edgeWear
    - Math.min(1, knot(0.31, 0.4, 0.15) + knot(0.76, 0.62, 0.11)) * 0.24;
  const value = extClamp01(tone);
  return [255 * value, 247 * value, 233 * value, 255];
}

/** 脏玻璃：擦拭雾团 + 两枚掌印（带五指）+ 干涸雨点与其下拖水痕 */
function glassDirtColor(u: number, v: number): Rgba {
  const cloud = extNoise(u, v, 5, 4, 401);
  let alpha = Math.max(0, cloud - 0.57) * 118;
  const palm = (pu: number, pv: number, size: number, tilt: number): number => {
    const du = u - pu;
    const dv = v - pv;
    const x = du * Math.cos(tilt) + dv * Math.sin(tilt);
    const y = -du * Math.sin(tilt) + dv * Math.cos(tilt);
    const body = (x * x) / (size * size) + (y * y) / (size * size * 1.45);
    let value = body < 1 ? (1 - body) * 0.86 : 0;
    for (let finger = 0; finger < 5; finger += 1) {
      const fx = (finger - 2) * size * 0.44;
      const fy = size * 1.12 + (finger % 2) * size * 0.14;
      const d = Math.hypot((x - fx) / (size * 0.26), (y - fy) / (size * 0.62));
      if (d < 1) value = Math.max(value, (1 - d) * 0.7);
    }
    return value;
  };
  alpha += palm(0.29, 0.33, 0.1, 0.14) * 76 + palm(0.68, 0.55, 0.082, -0.22) * 58;
  const cellU = Math.floor(u * 15);
  const cellV = Math.floor(v * 11);
  const exists = extHash(cellU, cellV, 409) > 0.44;
  if (exists) {
    const jx = (u * 15) % 1 - (0.24 + extHash(cellU, cellV, 403) * 0.5);
    const jy = (v * 11) % 1 - (0.22 + extHash(cellU, cellV, 407) * 0.46);
    const drop = Math.hypot(jx, jy * 1.25);
    if (drop < 0.19) alpha += (0.19 - drop) * 250;
    if (jy > 0 && jy < 0.72 && Math.abs(jx) < 0.032) alpha += (0.72 - jy) * 40;
  }
  return [238, 243, 241, Math.min(150, alpha)];
}

/** 混凝土外墙水渍：竖向流痕（每条从不同高度起流）+ 窗台 / 阳台板底挂痕 + 勒脚积垢 */
function facadeStainColor(u: number, v: number): Rgba {
  const lane = Math.floor(u * 46);
  const laneSeed = extHash(lane, 0, 421);
  const fx = (u * 46) % 1;
  const halfWidth = 0.16 + laneSeed * 0.3;
  const flow = extNoise(u, v, 10, 3, 431);
  let alpha = 0;
  if (laneSeed > 0.36 && Math.abs(fx - 0.5) < halfWidth) {
    const start = 0.16 + extHash(lane, 1, 433) * 0.74;
    if (v > start) alpha += (0.34 + flow * 0.46) * 118 * (1 - (v - start) * 0.3);
    alpha *= extFade(0.5 - Math.abs(fx - 0.5) / halfWidth, 0, 0.5);
  }
  for (const band of [0.17, 0.41, 0.65, 0.89]) {
    alpha += Math.max(0, 1 - Math.abs(v - band) * 24) * 44;
  }
  alpha += Math.max(0, 0.1 - v) * 600;
  const tone = 0.55 + flow * 0.35;
  return [98 * tone, 94 * tone, 86 * tone, Math.min(168, alpha)];
}

/** 远景底图：贴地暖雾 → 80 米外灰绿树线 → 细卷云，上半透明退出交给真天穹 */
function backdropColor(u: number, v: number): Rgba {
  const skyT = extFade(v, 0.3, 0.92);
  let r = 231 + (204 - 231) * skyT;
  let g = 224 + (219 - 224) * skyT;
  let b = 209 + (233 - 209) * skyT;
  let alpha = 255 * (1 - extFade(v, 0.5, 0.86));
  const ridge = 0.29 + extNoise(u, 0.5, 7, 1, 441) * 0.13 + extNoise(u, 0.5, 23, 1, 443) * 0.05;
  if (v < ridge) {
    const depth = extClamp01((ridge - v) / 0.24);
    const leaf = extNoise(u, v, 60, 30, 447);
    r = r * (1 - depth * 0.5) + (126 + leaf * 36) * depth * 0.5;
    g = g * (1 - depth * 0.44) + (140 + leaf * 32) * depth * 0.44;
    b = b * (1 - depth * 0.56) + (114 + leaf * 26) * depth * 0.56;
    alpha = Math.max(alpha, 255 * (0.4 + depth * 0.6));
  }
  for (let band = 0; band < 4; band += 1) {
    const centre = 0.6 + band * 0.075 + extHash(band, 7, 451) * 0.03;
    const thickness = 0.012 + extHash(band, 11, 453) * 0.018;
    const wobble = (extNoise(u, centre, 3, 1, 457 + band) - 0.5) * 0.05;
    const wisps = extNoise(u * 3, centre, 40, 1, 459 + band);
    const d = Math.abs(v - (centre + wobble)) / thickness;
    if (d < 1) {
      const strength = (1 - d) * (0.4 + wisps * 0.6);
      r = Math.min(255, r + strength * 30);
      g = Math.min(255, g + strength * 27);
      b = Math.min(255, b + strength * 22);
      alpha = Math.max(alpha, strength * 96);
    }
  }
  return [r, g, b, alpha];
}

interface OrientedSegment {
  from: Vec3;
  to: Vec3;
  radius: number;
}

/**
 * 逆光叶簇：叶片按格撒在椭圆轮廓里，叶缘透光偏黄绿、主脉压深。
 * 卡片用 MeshBasic 是刻意的——窗外植被要的是"被太阳打穿"的亮度，受实时光照会压成暗绿块。
 */
function leafClusterColor(seed: number, cells: number, warm: number): (u: number, v: number) => Rgba {
  return (u, v) => {
    const radius = Math.hypot(u - 0.5, v - 0.5) * 2;
    const wobble = 0.76 + extNoise(u, v, 3, 3, seed + 7) * 0.3;
    if (radius > wobble) return [0, 0, 0, 0];
    const cx = u * cells;
    const cy = v * cells;
    const ix = Math.floor(cx);
    const iy = Math.floor(cy);
    let coverage = 0;
    let tone = 0;
    let along = 0;
    let across = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const gx = ix + dx;
        const gy = iy + dy;
        const drop = extHash(gx, gy, seed);
        if (drop < 0.12) continue;
        const lean = extHash(gx, gy, seed + 11);
        const spin = extHash(gx, gy, seed + 23);
        const size = extHash(gx, gy, seed + 37);
        const ox = gx + 0.5 + (drop - 0.5) * 0.6 - cx;
        const oy = gy + 0.5 + (lean - 0.5) * 0.6 - cy;
        const ca = Math.cos(spin * Math.PI);
        const sa = Math.sin(spin * Math.PI);
        const px = ox * ca + oy * sa;
        const py = -ox * sa + oy * ca;
        const half = 0.2 + size * 0.16;
        const t = py / half;
        if (t <= -1 || t >= 1) continue;
        const width = (0.46 - Math.abs(t - 0.12) * 0.4) * (0.7 + size * 0.5);
        const q = Math.abs(px) / Math.max(0.03, width);
        if (q >= 1) continue;
        const inside = 1 - q * q;
        if (inside > coverage) {
          coverage = inside;
          tone = size;
          along = t;
          across = q;
        }
      }
    }
    if (coverage <= 0.06) return [0, 0, 0, 0];
    const vein = Math.abs(across) < 0.14 && Math.abs(along) < 0.86 ? 0.66 : 1;
    const rim = 0.9 + across * across * 0.26;
    const tip = 1 + along * 0.14;
    const speck = 0.92 + extNoise(u, v, 44, 44, seed + 51) * 0.16;
    const fade = 1 - extFade(radius / Math.max(0.2, wobble), 0.7, 1) * 0.5;
    const k = vein * rim * tip * speck * fade;
    return [(146 + tone * 54) * k * warm, (182 + tone * 40) * k, (74 + tone * 44) * k, 255];
  };
}

/** 一批不受光的叶卡合并成 1 个实例批次：轮廓、朝向、染色逐张给，贴图整批共用 */
function createLeafCardBatch(
  parent: THREE.Object3D,
  name: string,
  specs: CanopyCardSpec[],
  textureKey: string,
  colorAt: (u: number, v: number) => Rgba,
  alphaTest: number,
): THREE.InstancedMesh {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    map: paintExteriorTexture(textureKey, 256, 256, colorAt),
    alphaTest,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, specs.length));
  mesh.name = name;
  const transform = new THREE.Object3D();
  const tint = new THREE.Color();
  specs.forEach((spec, index) => {
    transform.position.set(spec.x, spec.y, spec.z);
    transform.rotation.set((spec.tilt ?? 0) * 0.6, spec.yaw, spec.tilt ?? 0);
    transform.scale.set(spec.scale, spec.scale * 1.08, spec.scale);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.setColorAt(index, tint.setHex(spec.tint ?? 0xffffff));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  mesh.computeBoundingSphere();
  releaseInstancesWithGeometry(mesh);
  parent.add(mesh);
  return mesh;
}

/** 一批任意朝向的圆柱合并成一个实例批次（树干分枝、水箱支腿、晾衣绳） */
function createSegmentBatch(
  parent: THREE.Object3D,
  name: string,
  segments: OrientedSegment[],
  material: THREE.Material,
  radialSegments = 6,
): THREE.InstancedMesh {
  const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, radialSegments, 1, true);
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, segments.length));
  mesh.name = name;
  mesh.receiveShadow = true;
  const up = new THREE.Vector3(0, 1, 0);
  const direction = new THREE.Vector3();
  const transform = new THREE.Object3D();
  segments.forEach((segment, index) => {
    direction.set(segment.to.x - segment.from.x, segment.to.y - segment.from.y, segment.to.z - segment.from.z);
    const length = direction.length() || 1;
    transform.position.set(
      (segment.from.x + segment.to.x) / 2,
      (segment.from.y + segment.to.y) / 2,
      (segment.from.z + segment.to.z) / 2,
    );
    transform.quaternion.setFromUnitVectors(up, direction.divideScalar(length));
    transform.scale.set(segment.radius * 2, length, segment.radius * 2);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = false;
  releaseInstancesWithGeometry(mesh);
  parent.add(mesh);
  return mesh;
}

/** 街道断面：近侧人行道 → 路缘石 → 柏油路（含虚线）→ 远侧人行道 */
function buildExteriorStreet(parent: THREE.Object3D, details: RoomDetails): void {
  const near = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 13.4),
    getPavingMaterial({ repeatX: 8, repeatY: 3 }),
  );
  near.name = 'room-ext-sidewalk-near';
  near.rotation.x = -Math.PI / 2;
  near.position.set(1.8, -0.02, -12.9);
  near.receiveShadow = true;
  parent.add(near);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(34, EXTERIOR.road.near - EXTERIOR.road.far),
    getAsphaltMaterial({ repeatX: 8, repeatY: 2 }),
  );
  road.name = 'room-ext-road';
  road.rotation.x = -Math.PI / 2;
  road.position.set(1.8, -0.03, (EXTERIOR.road.near + EXTERIOR.road.far) / 2);
  road.receiveShadow = true;
  parent.add(road);

  const far = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 2.8),
    getPavingMaterial({ repeatX: 8, repeatY: 1 }),
  );
  far.name = 'room-ext-sidewalk-far';
  far.rotation.x = -Math.PI / 2;
  far.position.set(1.8, -0.02, (EXTERIOR.road.far + EXTERIOR.buildingZ) / 2);
  far.receiveShadow = true;
  parent.add(far);

  details.batch(parent, 'room-ext-curbs', [
    { center: { x: 1.8, y: 0.05, z: EXTERIOR.road.near }, size: { w: 34, h: 0.14, d: 0.16 } },
    { center: { x: 1.8, y: 0.05, z: EXTERIOR.road.far }, size: { w: 34, h: 0.14, d: 0.16 } },
  ], details.matte(0xbdb8ac, 0.94));

  const dashes = Array.from({ length: 9 }, (_, index) => ({
    center: { x: -12 + index * 3.6, y: 0.012, z: (EXTERIOR.road.near + EXTERIOR.road.far) / 2 },
    size: { w: 1.5, h: 0.02, d: 0.14 },
  }));
  details.batch(parent, 'room-ext-road-markings', dashes, details.matte(0xd8d2c2, 0.9));

  // 树池：行道树脚下的方格铺装与铸铁篦子
  details.batch(parent, 'room-ext-tree-pits', [
    { center: { x: 2.95, y: 0.006, z: EXTERIOR.treeZ }, size: { w: 1.5, h: 0.012, d: 1.5 } },
    { center: { x: -1.2, y: 0.006, z: -18.6 }, size: { w: 1.6, h: 0.012, d: 1.6 } },
    { center: { x: 7.2, y: 0.006, z: -15.2 }, size: { w: 1.3, h: 0.012, d: 1.3 } },
  ], details.matte(0x514c3e, 0.95));
}

/** 成年行道树：真树干 + 5~6 根主分枝 + 4~6 个彼此独立的叶簇，逆光侧染暖黄 */
function buildExteriorTrees(parent: THREE.Object3D): void {
  const tier = canopyBudget(getQualityTier());
  const bark = getBarkMaterial({ repeatX: 1, repeatY: 3 });
  const trunkBark = bark.clone();
  delete trunkBark.userData[SHARED_RESOURCE_FLAG];
  trunkBark.color.setHex(0x5e5545);

  const trees = [
    { x: 2.95, z: EXTERIOR.treeZ, trunkTop: 3.4, radius: 0.2, seed: 31, reach: 1.5 },
    { x: -1.2, z: -18.6, trunkTop: 4.15, radius: 0.24, seed: 47, reach: 1.7 },
    { x: 7.2, z: -15.2, trunkTop: 2.95, radius: 0.17, seed: 59, reach: 1.3 },
  ];
  const clusterCount = tier.cards >= 10 ? 6 : tier.cards >= 7 ? 5 : 4;
  // 逆光：叶簇靠太阳一侧（−X）透亮偏黄绿，背阴一侧压成冷灰绿
  const litTints = [0xf7f2cf, 0xeef0c6, 0xe4ebc0];
  const shadeTints = [0xc9d7b6, 0xb8c9a8, 0xa7b99a];
  const trunks: OrientedSegment[] = [];
  const branches: OrientedSegment[] = [];
  const cards: CanopyCardSpec[] = [];

  trees.forEach((tree, treeIndex) => {
    trunks.push({
      from: { x: tree.x, y: 0, z: tree.z },
      to: { x: tree.x + (extHash(tree.seed, 3, 501) - 0.5) * 0.3, y: tree.trunkTop, z: tree.z },
      radius: tree.radius,
    });
    const crownY = tree.trunkTop + tree.reach * 0.62;
    for (let cluster = 0; cluster < clusterCount; cluster += 1) {
      const angle = cluster * 2.399 + treeIndex * 1.13;
      const spread = tree.reach * (0.34 + 0.66 * Math.sin((Math.PI * (cluster + 0.5)) / clusterCount));
      const cx = tree.x + Math.cos(angle) * spread;
      const cz = tree.z + Math.sin(angle) * spread * 0.55;
      const cy = crownY + (cluster / Math.max(1, clusterCount - 1) - 0.5) * tree.reach * 1.05
        + (extHash(tree.seed, cluster, 503) - 0.5) * 0.3;
      branches.push({
        from: { x: tree.x, y: tree.trunkTop * (0.78 + extHash(tree.seed, cluster, 507) * 0.2), z: tree.z },
        to: { x: cx, y: cy - tree.reach * 0.42, z: cz },
        radius: tree.radius * 0.34,
      });
      // 每簇 3 张互夹约 60° 的卡片，转视角时才有厚度而不是贴纸
      for (let card = 0; card < 3; card += 1) {
        const yaw = angle + card * 1.047 + (extHash(tree.seed + cluster, card, 509) - 0.5) * 0.3;
        cards.push({
          x: cx + (card - 1) * 0.22,
          y: cy,
          z: cz + (card - 1) * 0.16,
          scale: tree.reach * (1.28 + ((card * 5 + cluster) % 3) * 0.07),
          yaw,
          tilt: (card % 3 - 1) * 0.2,
          tint: cx < tree.x
            ? litTints[(treeIndex + card) % litTints.length]
            : shadeTints[(treeIndex + card) % shadeTints.length],
        });
      }
    }
  });

  const trunkGeometry = new THREE.CylinderGeometry(0.62, 1, 1, 8, 2, true);
  const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkBark, trunks.length);
  trunkMesh.name = 'room-ext-tree-trunks';
  const transform = new THREE.Object3D();
  trunks.forEach((trunk, index) => {
    const length = trunk.to.y - trunk.from.y;
    transform.position.set(trunk.from.x, trunk.from.y + length / 2, trunk.from.z);
    transform.rotation.set(0, index * 0.7, 0);
    transform.scale.set(trunk.radius * 2, length, trunk.radius * 2);
    transform.updateMatrix();
    trunkMesh.setMatrixAt(index, transform.matrix);
  });
  trunkMesh.instanceMatrix.needsUpdate = true;
  trunkMesh.receiveShadow = true;
  trunkMesh.castShadow = false;
  releaseInstancesWithGeometry(trunkMesh);
  parent.add(trunkMesh);

  createSegmentBatch(parent, 'room-ext-tree-branches', branches, trunkBark);
  createLeafCardBatch(parent, 'room-ext-tree-clusters', cards, 'leaf-tree',
    leafClusterColor(101, 11, 1), tier.alphaTest);
}

/** 1970 年代老混凝土公寓：分格外墙 + 窗群 + 阳台晾衣 + 空调外机 + 屋顶水箱 + 藤蔓柱 */
function buildExteriorApartment(parent: THREE.Object3D, details: RoomDetails): void {
  const faceZ = EXTERIOR.buildingZ;
  const width = 17;
  const height = 11.6;
  const centreX = 1;
  const columns = [-6.1, -3, 0.1, 3.2, 6.3];
  const floors = [1.75, 4.45, 7.15, 9.85];

  addTexturedBox(parent, { x: centreX, y: height / 2 - 0.1, z: faceZ - 1.6 },
    { w: width, h: height, d: 3.2 }, getFacadeConcreteMaterial({ repeatX: 5, repeatY: 3 }), false);

  // 窗洞：深灰洞圈 + 带窗帘层次的窗格 + 窗台滴水线
  const frames = Array.from({ length: columns.length * floors.length }, (_, index) => {
    const x = columns[index % columns.length];
    const y = floors[Math.floor(index / columns.length)];
    return { center: { x, y, z: faceZ + 0.02 }, size: { w: 1.76, h: 1.86, d: 0.1 } };
  });
  details.batch(parent, 'room-ext-window-reveals', frames, details.matte(0x4d4f52, 0.9));
  const panes = frames.map((frame) => ({
    center: { x: frame.center.x, y: frame.center.y, z: faceZ + 0.06 },
    size: { w: 1.52, h: 1.62, d: 0.1 },
  }));
  details.batch(parent, 'room-ext-window-panes', panes, getFacadeWindowMaterial());
  details.batch(parent, 'room-ext-window-sills', panes.map((pane) => ({
    center: { x: pane.center.x, y: pane.center.y - 0.92, z: faceZ + 0.12 },
    size: { w: 1.92, h: 0.1, d: 0.26 },
  })), details.matte(0xc9c4b8, 0.92));

  // 阳台：只出现在第 2、4 列，板 + 铁栏 + 锈顶扶手
  const balconyColumns = [-3, 3.2];
  const balconyFloors = [4.45, 7.15, 9.85];
  const slabs: BoxPart[] = [];
  const parapets: BoxPart[] = [];
  for (const x of balconyColumns) {
    for (const y of balconyFloors) {
      slabs.push({ center: { x, y: y - 0.95, z: faceZ + 0.55 }, size: { w: 2.5, h: 0.14, d: 1.1 } });
      parapets.push({ center: { x, y: y - 0.55, z: faceZ + 1.06 }, size: { w: 2.5, h: 0.62, d: 0.07 } });
      for (const side of [-1.2, 1.2]) {
        slabs.push({ center: { x: x + side, y: y - 0.55, z: faceZ + 0.55 }, size: { w: 0.08, h: 0.62, d: 1.1 } });
      }
    }
  }
  const rust = details.matte(0x8a6a52, 0.78);
  details.batch(parent, 'room-ext-balcony-slabs', slabs, rust);
  details.batch(parent, 'room-ext-balcony-parapets', parapets, rust);

  // 晾晒：栏杆上的衣物（多色实例）与其上方的晾衣绳
  const laundry: Array<BoxPart & { color: number }> = [];
  const lines: OrientedSegment[] = [];
  const laundryColors = [0xcbb49c, 0x93a4ad, 0xd8d1bd, 0x9d7f6e, 0xb6a37f, 0x8f9c86];
  let laundrySeed = 0;
  for (const x of balconyColumns) {
    for (const y of balconyFloors) {
      lines.push({
        from: { x: x - 1.1, y: y - 0.12, z: faceZ + 1.02 },
        to: { x: x + 1.1, y: y - 0.14, z: faceZ + 1.02 },
        radius: 0.012,
      });
      for (let i = 0; i < 3; i += 1) {
        laundry.push({
          center: { x: x - 0.78 + i * 0.78, y: y - 0.42, z: faceZ + 1.08 },
          size: { w: 0.42, h: 0.5, d: 0.03 },
          color: laundryColors[(laundrySeed += 1) % laundryColors.length],
        });
      }
    }
  }
  details.batchColored(parent, 'room-ext-laundry', laundry);
  createSegmentBatch(parent, 'room-ext-laundry-lines', lines, details.matte(0x6f6a62, 0.9));

  // 阳台盆栽与藤蔓柱
  const pots: BoxPart[] = [];
  for (const x of balconyColumns) {
    for (const y of balconyFloors) {
      pots.push({ center: { x: x + 0.96, y: y - 0.68, z: faceZ + 0.86 }, size: { w: 0.26, h: 0.26, d: 0.26 } });
    }
  }
  details.batch(parent, 'room-ext-balcony-pots', pots, details.matte(0xa4623c, 0.92));

  const vineCards: CanopyCardSpec[] = [];
  for (let row = 0; row < 9; row += 1) {
    const y = 0.6 + row * 0.86;
    vineCards.push({
      x: -6.1 + (extHash(row, 2, 511) - 0.5) * 0.5,
      y,
      z: faceZ + 0.24,
      scale: 0.9 + extHash(row, 5, 513) * 0.35,
      yaw: row * 1.1,
      tilt: (row % 3 - 1) * 0.24,
      tint: [0xdfe7cf, 0xccd8bc, 0xe6ecd8][row % 3],
    });
  }
  createLeafCardBatch(parent, 'room-ext-vine-column', vineCards, 'leaf-vine',
    leafClusterColor(181, 8, 0.86), 0.42);

  // 空调外机与支架、冷凝管
  const aircon: BoxPart[] = [];
  const brackets: BoxPart[] = [];
  const units = [[-6.1, 3.45], [0.1, 6.15], [6.3, 8.85], [-3, 11.1], [3.2, 3.45]];
  for (const [x, y] of units) {
    aircon.push({ center: { x: x + 1.05, y, z: faceZ + 0.28 }, size: { w: 0.78, h: 0.56, d: 0.34 } });
    brackets.push({ center: { x: x + 1.05, y: y - 0.32, z: faceZ + 0.16 }, size: { w: 0.7, h: 0.06, d: 0.22 } });
  }
  details.batch(parent, 'room-ext-aircon-units', aircon, details.matte(0xb2b6b1, 0.72));
  details.batch(parent, 'room-ext-aircon-brackets', brackets, rust);

  // 屋顶：女儿墙、水箱与支腿、排风机
  details.batch(parent, 'room-ext-parapet', [
    { center: { x: centreX, y: height - 0.05, z: faceZ + 0.02 }, size: { w: width, h: 0.42, d: 0.24 } },
    { center: { x: centreX - width / 2, y: height - 0.05, z: faceZ - 1.6 }, size: { w: 0.24, h: 0.42, d: 3.4 } },
    { center: { x: centreX + width / 2, y: height - 0.05, z: faceZ - 1.6 }, size: { w: 0.24, h: 0.42, d: 3.4 } },
  ], details.matte(0xbdb8ac, 0.94));

  const tank = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 1.15, 1.75, 14, 1, false),
    details.matte(0x9aa09c, 0.66),
  );
  tank.name = 'room-ext-water-tank';
  tank.position.set(-1.6, height + 1.15, faceZ - 1.4);
  tank.castShadow = false;
  parent.add(tank);
  const tankLid = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.22, 0.12, 14), details.matte(0x8b918d, 0.62));
  tankLid.name = 'room-ext-water-tank-lid';
  tankLid.position.set(-1.6, height + 2.08, faceZ - 1.4);
  parent.add(tankLid);
  createSegmentBatch(parent, 'room-ext-water-tank-legs', [
    { from: { x: -2.5, y: height + 0.16, z: faceZ - 2.2 }, to: { x: -2.5, y: height + 0.34, z: faceZ - 2.2 }, radius: 0.07 },
    { from: { x: -0.7, y: height + 0.16, z: faceZ - 2.2 }, to: { x: -0.7, y: height + 0.34, z: faceZ - 2.2 }, radius: 0.07 },
    { from: { x: -2.5, y: height + 0.16, z: faceZ - 0.6 }, to: { x: -2.5, y: height + 0.34, z: faceZ - 0.6 }, radius: 0.07 },
    { from: { x: -0.7, y: height + 0.16, z: faceZ - 0.6 }, to: { x: -0.7, y: height + 0.34, z: faceZ - 0.6 }, radius: 0.07 },
  ], rust);
  details.batch(parent, 'room-ext-roof-vents', [
    { center: { x: 4.6, y: height + 0.42, z: faceZ - 1.2 }, size: { w: 0.7, h: 0.84, d: 0.7 } },
    { center: { x: 6.4, y: height + 0.3, z: faceZ - 2.2 }, size: { w: 1.1, h: 0.6, d: 0.9 } },
    { center: { x: 2.2, y: height + 0.5, z: faceZ - 2.4 }, size: { w: 0.5, h: 1.0, d: 0.5 } },
  ], details.matte(0x9c9a92, 0.86));

  // 底层：门洞雨棚 + 一间亮着暖光的铺面
  details.batch(parent, 'room-ext-shopfront', [
    { center: { x: 0.1, y: 1.5, z: faceZ + 0.05 }, size: { w: 3.2, h: 2.4, d: 0.12 } },
    { center: { x: 0.1, y: 2.92, z: faceZ + 0.4 }, size: { w: 3.8, h: 0.16, d: 0.8 } },
  ], details.matte(0x6f6558, 0.9));
  const shop = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 2.1),
    getStoreInteriorMaterial(),
  );
  shop.name = 'room-ext-shop-glow';
  shop.position.set(0.1, 1.5, faceZ + 0.12);
  parent.add(shop);

  // 立面水渍污痕：一整张透明贴片压在混凝土墙上
  const stains = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: paintExteriorTexture('facade-stain', 256, 512, facadeStainColor),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  );
  stains.name = 'room-ext-facade-stains';
  stains.position.set(centreX, height / 2 - 0.1, faceZ + 0.09);
  stains.castShadow = false;
  parent.add(stains);
}

/** 更远处两栋体量 + 两只掠过的鸟；树线与雾霾交给远景底图 */
function buildExteriorDistance(parent: THREE.Object3D, details: RoomDetails): void {
  const concrete = getFacadeConcreteMaterial({ repeatX: 3, repeatY: 3 });
  const blocks: Array<{ x: number; w: number; h: number; z: number }> = [
    { x: -13.5, w: 11, h: 15, z: EXTERIOR.farBlockZ },
    { x: 12.5, w: 9, h: 12.5, z: EXTERIOR.farBlockZ - 2 },
  ];
  blocks.forEach((block, index) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(block.w, block.h, 6), concrete);
    mesh.name = `room-ext-far-block-${index}`;
    mesh.position.set(block.x, block.h / 2, block.z);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    parent.add(mesh);
  });

  const haze = new THREE.Mesh(
    new THREE.PlaneGeometry(74, 26),
    new THREE.MeshBasicMaterial({
      map: paintExteriorTexture('backdrop', 512, 256, backdropColor),
      transparent: true,
      depthWrite: false,
    }),
  );
  haze.name = 'room-ext-haze-backdrop';
  haze.position.set(1.8, 9, EXTERIOR.backdropZ);
  haze.castShadow = false;
  parent.add(haze);

  // 两只鸟：四条薄盒拼成两个 V，40 米外只占几像素
  const birds: BoxPart[] = [];
  for (const [bx, by] of [[2.4, 12.6], [6.1, 13.4]]) {
    for (const side of [-1, 1]) {
      birds.push({
        center: { x: bx + side * 0.34, y: by + 0.1, z: EXTERIOR.farBlockZ + 2 },
        size: { w: 0.7, h: 0.06, d: 0.1 },
        rotationZ: side * 0.42,
      });
    }
  }
  details.batch(parent, 'room-ext-birds', birds, details.matte(0x4c4f55, 0.95));
}

/** 窗前虚焦的落叶：几张小叶卡悬在窗洞与行道树之间 */
function buildFallingLeaves(parent: THREE.Object3D): void {
  const leaves: CanopyCardSpec[] = [];
  const tints = [0xfff0c8, 0xffe1a6, 0xf7eccf, 0xffd99a];
  for (let index = 0; index < 6; index += 1) {
    leaves.push({
      x: 0.4 + extHash(index, 9, 521) * 3.4,
      y: 1.35 + extHash(index, 13, 523) * 1.5,
      z: EXTERIOR.leafZ + extHash(index, 17, 527) * 2.4,
      scale: 0.12 + extHash(index, 19, 529) * 0.09,
      yaw: extHash(index, 23, 531) * Math.PI,
      tilt: (extHash(index, 29, 533) - 0.5) * 1.4,
      tint: tints[index % tints.length],
    });
  }
  createLeafCardBatch(parent, 'room-ext-falling-leaves', leaves, 'leaf-falling',
    leafClusterColor(97, 2, 1.06), 0.35);
}

/** 窗外那棵树连同街道、公寓与远景底图，一次铺完 */
function buildWindowExterior(parent: THREE.Object3D, details: RoomDetails): void {
  buildExteriorStreet(parent, details);
  buildExteriorTrees(parent);
  buildExteriorApartment(parent, details);
  buildExteriorDistance(parent, details);
  buildFallingLeaves(parent);

  // 街面上两个拖行李箱的剪影：纯观看，不进碰撞与注视
  const silhouetteMaterial = createMatteMaterial(0x39404a, 0.98);
  const addSilhouette = (x: number, z: number, flip: number): void => {
    const figure = new THREE.Group();
    figure.position.set(x, -0.05, z);
    figure.rotation.y = flip > 0 ? 0.16 : -0.16;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.78, 0.14), silhouetteMaterial);
    body.position.y = 0.62;
    body.rotation.x = 0.1;
    body.castShadow = false;
    figure.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.14, 0.13), silhouetteMaterial);
    head.position.set(0.01, 1.08, 0);
    head.castShadow = false;
    figure.add(head);
    for (const dx of [-0.07, 0.07]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.08), silhouetteMaterial);
      leg.position.set(dx, 0.28, dx > 0 ? 0.06 : -0.02);
      leg.castShadow = false;
      figure.add(leg);
    }
    const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.28, 0.12), silhouetteMaterial);
    caseMesh.position.set(flip * 0.3, 0.16, -0.28);
    caseMesh.castShadow = false;
    figure.add(caseMesh);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.3), silhouetteMaterial);
    arm.position.set(flip * 0.14, 0.52, -0.15);
    arm.rotation.x = 0.5;
    arm.castShadow = false;
    figure.add(arm);
    parent.add(figure);
  };
  addSilhouette(4.2, -28.6, 1);
  addSilhouette(6.4, -29.1, -1);
}

/** 窗台上的生活痕迹：陶土盆里垂吊的常春藤，和半杯在逆光里透出琥珀色的水 */
function buildWindowSill(parent: THREE.Object3D, details: RoomDetails): void {
  const potX = 1.33;
  const potZ = -6.17;
  const sillTop = 1.24;

  const terracotta = new THREE.MeshStandardMaterial({
    color: 0xb2603c, roughness: 0.84, side: THREE.DoubleSide,
  });
  const pot = new THREE.Group();
  pot.name = 'room-sill-ivy-pot';
  pot.position.set(potX, sillTop, potZ);
  const potBody = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.05, 0.1, 14, 1, true), terracotta);
  potBody.position.y = 0.05;
  pot.add(potBody);
  const potRim = new THREE.Mesh(new THREE.CylinderGeometry(0.083, 0.074, 0.024, 14, 1, true), terracotta);
  potRim.position.y = 0.112;
  pot.add(potRim);
  const soil = new THREE.Mesh(new THREE.CircleGeometry(0.073, 14), details.matte(0x3b2e23, 0.96));
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = 0.113;
  pot.add(soil);

  // 四根藤条从盆沿翻出来，只越过窗台外沿一点点，垂在窗下框前
  const stems: OrientedSegment[] = [];
  const vines: Array<{ from: Vec3; to: Vec3 }> = [];
  for (let index = 0; index < 4; index += 1) {
    const angle = -0.62 + index * 0.6;
    const dx = Math.sin(angle) * 0.075;
    const dz = 0.03 + Math.cos(angle) * 0.05;
    const drop = 0.09 + extHash(index, 7, 611) * 0.1;
    const mid = { x: dx, y: 0.06, z: dz };
    const tip = { x: dx * 1.3, y: 0.06 - drop, z: dz + 0.055 };
    stems.push({ from: { x: dx * 0.35, y: 0.115, z: dz * 0.35 }, to: mid, radius: 0.0035 });
    stems.push({ from: mid, to: tip, radius: 0.0028 });
    vines.push({ from: mid, to: tip });
  }
  parent.add(pot);
  createSegmentBatch(pot, 'room-sill-ivy-vines', stems, details.matte(0x50603a, 0.88), 4);

  const leaves: CanopyCardSpec[] = [];
  const ivyTints = [0xf2f6d6, 0xe2ecc2, 0xd6e2b0, 0xfaf3d0];
  for (let index = 0; index < 4; index += 1) {
    const angle = index * 1.57 + 0.4;
    leaves.push({
      x: potX + Math.sin(angle) * 0.032,
      y: sillTop + 0.146 + extHash(index, 3, 613) * 0.02,
      z: potZ + Math.cos(angle) * 0.03,
      scale: 0.062 + extHash(index, 5, 617) * 0.018,
      yaw: extHash(index, 11, 619) * 1.1 - 0.5,
      tilt: (extHash(index, 13, 631) - 0.5) * 0.9,
      tint: ivyTints[index % ivyTints.length],
    });
  }
  vines.forEach((vine, index) => {
    [0.45, 0.78, 1].forEach((t, step) => {
      const seed = index * 3 + step;
      leaves.push({
        x: potX + vine.from.x + (vine.to.x - vine.from.x) * t,
        y: sillTop + vine.from.y + (vine.to.y - vine.from.y) * t,
        z: potZ + vine.from.z + (vine.to.z - vine.from.z) * t,
        scale: 0.04 + extHash(seed, 5, 641) * 0.02,
        yaw: extHash(seed, 17, 643) * 1.4 - 0.7,
        tilt: (extHash(seed, 23, 647) - 0.5) * 1.6,
        tint: ivyTints[seed % ivyTints.length],
      });
    });
  });
  createLeafCardBatch(parent, 'room-sill-ivy-leaves', leaves, 'leaf-ivy',
    leafClusterColor(163, 5, 0.98), 0.4);

  // 半杯水：不做真折射，水体收在杯腔内、按饱和暖琥珀上色，外面罩一层看得见的玻璃壳
  const cupGlass = new THREE.MeshStandardMaterial({
    color: 0xeaf3f4, roughness: 0.05, metalness: 0.04,
    transparent: true, opacity: 0.44, side: THREE.DoubleSide, depthWrite: false,
  });
  const tumbler = new THREE.Group();
  tumbler.name = 'room-sill-water-glass';
  tumbler.position.set(2.12, sillTop, -6.14);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.026, 0.082, 16, 1, true), cupGlass);
  cup.position.y = 0.041;
  tumbler.add(cup);
  const cupBase = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.007, 16), cupGlass);
  cupBase.position.y = 0.0035;
  tumbler.add(cupBase);
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0248, 0.0222, 0.038, 16),
    new THREE.MeshStandardMaterial({ color: 0xc88b34, roughness: 0.12, metalness: 0.02 }),
  );
  water.position.y = 0.0255;
  tumbler.add(water);
  const meniscus = new THREE.Mesh(
    new THREE.CircleGeometry(0.0248, 16),
    new THREE.MeshStandardMaterial({ color: 0xefc87e, roughness: 0.05 }),
  );
  meniscus.rotation.x = -Math.PI / 2;
  meniscus.position.y = 0.0446;
  tumbler.add(meniscus);
  parent.add(tumbler);

  for (const group of [pot, tumbler]) {
    group.traverse((child) => {
      child.castShadow = false;
      child.receiveShadow = false;
      child.raycast = () => {};
    });
  }
}

function buildWindow(parent: THREE.Object3D, details: RoomDetails): void {
  const frameColor = 0xd8d2c7;
  for (const x of [1.06, 2.54]) {
    addBox(parent, { x, y: 1.9, z: -6.25 }, { w: 0.065, h: 1.34, d: 0.09 }, frameColor);
  }
  for (const y of [1.24, 2.56]) {
    addBox(parent, { x: 1.8, y, z: -6.25 }, { w: 1.54, h: 0.065, d: 0.09 }, frameColor);
  }
  addBox(parent, { x: 1.8, y: 1.9, z: -6.23 }, { w: 0.038, h: 1.2, d: 0.055 }, frameColor);
  addBox(parent, { x: 1.8, y: 1.9, z: -6.23 }, { w: 1.4, h: 0.038, d: 0.055 }, frameColor);
  addBox(parent, { x: 1.8, y: 1.21, z: -6.18 }, { w: 1.68, h: 0.06, d: 0.24 }, frameColor);

  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.36, 1.16),
    new THREE.MeshStandardMaterial({
      color: 0xc7dbe2,
      roughness: 0.12,
      metalness: 0.32,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  glass.position.set(WINDOW.center.x, WINDOW.center.y, -6.34);
  glass.castShadow = false;
  parent.add(glass);

  // 薄玻璃上的脏污：擦拭雾团、两枚掌印和干涸雨点，逆光下只在窗面起一层柔光斑
  const glassDirt = new THREE.Mesh(
    new THREE.PlaneGeometry(1.36, 1.16),
    new THREE.MeshBasicMaterial({
      map: paintExteriorTexture('glass-dirt', 256, 256, glassDirtColor),
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
    }),
  );
  glassDirt.name = 'room-window-glass-dirt';
  glassDirt.position.set(WINDOW.center.x, WINDOW.center.y, -6.31);
  glassDirt.castShadow = false;
  glassDirt.raycast = () => {};
  parent.add(glassDirt);

  const curtainMaterial = createMatteMaterial(0xc6bcac, 0.96);
  curtainMaterial.side = THREE.DoubleSide;
  for (const side of [-1, 1]) {
    const geometry = new THREE.PlaneGeometry(0.42, 1.58, 12, 12);
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      position.setZ(index, Math.sin((x / 0.42 + 0.5) * Math.PI * 8) * 0.045 + Math.sin(y * 5) * 0.008);
    }
    geometry.computeVertexNormals();
    const curtain = new THREE.Mesh(geometry, curtainMaterial);
    curtain.position.set(WINDOW.center.x + side * 0.8, 1.91, -6.12);
    curtain.castShadow = false;
    curtain.receiveShadow = true;
    parent.add(curtain);
  }

  const curtainRod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 2.05, 8),
    new THREE.MeshStandardMaterial({ color: 0x7c7470, roughness: 0.7, metalness: 0.15 }),
  );
  curtainRod.rotation.z = Math.PI / 2;
  curtainRod.position.set(WINDOW.center.x, 2.73, -6.05);
  parent.add(curtainRod);
  for (const side of [-1, 1]) {
    const finial = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 6),
      curtainRod.material,
    );
    finial.position.set(WINDOW.center.x + side * 1.04, 2.73, -6.05);
    parent.add(finial);
  }

  buildWindowExterior(parent, details);
  buildWindowSill(parent, details);

  const blinds = new THREE.Group();
  blinds.name = 'room-venetian-blinds';
  parent.add(blinds);
  // 风化橡木：顺纹、节疤、磨圆棱边和晒白烘进贴图，色相仍由 0xb88750 决定（精装验收按此断言）
  const blindWood = new THREE.MeshStandardMaterial({
    color: 0xb88750,
    roughness: 0.74,
    map: paintExteriorTexture('blind-oak', 512, 128, blindOakColor),
  });
  details.box(blinds, 'room-blind-headbox', { x: 1.8, y: 2.48, z: -6.16 },
    { w: 1.34, h: 0.075, d: 0.095 }, blindWood);
  // 叶片仰角 0.78 rad（≈45°）：缝隙从原来的 22% 打开到 44%，窗外街道与公寓才看得见
  const BLIND_TILT = -0.78;
  details.batch(blinds, 'room-blind-slats', Array.from({ length: 11 }, (_, index) => ({
    center: { x: 1.8, y: 2.38 - index * 0.096, z: -6.15 },
    size: { w: 1.31, h: 0.018, d: 0.075 }, rotationX: BLIND_TILT,
  })), blindWood);
  details.batch(blinds, 'room-blind-ladder-cords', [1.32, 2.28].map((x) => ({
    center: { x, y: 1.89, z: -6.10 }, size: { w: 0.006, h: 1.1, d: 0.006 },
  })), details.matte(0xe3d3b8));
  details.box(blinds, 'room-blind-pull-cord', { x: 2.43, y: 1.73, z: -6.08 },
    { w: 0.005, h: 1.44, d: 0.005 }, details.matte(0xe3d3b8));
  details.box(blinds, 'room-blind-pull-toggle', { x: 2.43, y: 1.0, z: -6.08 },
    { w: 0.02, h: 0.045, d: 0.02 }, blindWood);

  // 小铜合页（氧化发绿）钉在梯绳那两列的第四片叶板上；棉绳末端起毛成小穗
  const brassPatina = new THREE.MeshStandardMaterial({
    color: 0x8a8560, roughness: 0.44, metalness: 0.58,
  });
  const hinges: BoxPart[] = [];
  for (const x of [1.32, 2.28]) {
    for (const index of [0, 3, 6, 9]) {
      hinges.push({
        center: { x, y: 2.38 - index * 0.096, z: -6.12 },
        size: { w: 0.05, h: 0.026, d: 0.014 },
        rotationX: BLIND_TILT,
      });
    }
  }
  details.batch(blinds, 'room-blind-hinges', hinges, brassPatina);
  details.batch(blinds, 'room-blind-cord-tassels', [
    ...[1.32, 2.28].map((x) => ({
      center: { x, y: 1.315, z: -6.10 }, size: { w: 0.016, h: 0.052, d: 0.016 },
    })),
    { center: { x: 2.43, y: 0.955, z: -6.08 }, size: { w: 0.018, h: 0.06, d: 0.018 } },
  ], details.matte(0xdccfae, 0.98));

  const floorStripes: LightQuad[] = [];
  const wallStripes: LightQuad[] = [];
  const sillStripes: LightQuad[] = [];
  for (let index = 0; index < 11; index += 1) {
    const z = index * 0.12;
    floorStripes.push([
      { x: 1.12, y: 0.014, z: -5.95 + z }, { x: 1.12, y: 0.014, z: -5.90 + z },
      { x: 3.3, y: 0.014, z: -4.30 + z }, { x: 3.3, y: 0.014, z: -4.25 + z },
    ]);
    const y = index * 0.085;
    wallStripes.push([
      { x: 3.393, y: 2.02 - y, z: -5.78 }, { x: 3.393, y: 1.975 - y, z: -5.78 },
      { x: 3.393, y: 1.22 - y, z: -4.58 }, { x: 3.393, y: 1.175 - y, z: -4.58 },
    ]);
    // 第三道光带横过窗台：贴着台面从里侧切到外沿，把陶土盆与水杯打成逆光剪影
    sillStripes.push([
      { x: 1.12, y: 1.246, z: -6.26 + index * 0.018 }, { x: 1.12, y: 1.246, z: -6.22 + index * 0.018 },
      { x: 2.48, y: 1.246, z: -6.08 + index * 0.018 }, { x: 2.48, y: 1.246, z: -6.04 + index * 0.018 },
    ]);
  }
  for (const [name, quads, opacity] of [
    ['room-sun-stripes-floor', floorStripes, 0.68],
    ['room-sun-stripes-wall', wallStripes, 0.55],
    ['room-sun-stripes-sill', sillStripes, 0.5],
  ] as const) {
    const stripes = createSoftLightBatch(quads, opacity);
    stripes.name = name;
    parent.add(stripes);
  }

  const dustPositions: number[] = [];
  for (let index = 0; index < 26; index += 1) {
    const t = index / 25;
    dustPositions.push(
      0.25 + ((index * 37) % 100) / 55,
      0.3 + ((index * 53) % 100) / 60,
      -5.8 + t * 3.5,
    );
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(
    dustGeometry,
    new THREE.PointsMaterial({
      color: 0xffe4b8,
      size: 0.012,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    }),
  );
  dust.name = 'room-window-light-dust';
  dust.raycast = () => {};
  parent.add(dust);
}

/** 枕芯用的形变球体：顶面压出一个凹，长枕横放在床头 */
function createCushionGeometry(): THREE.SphereGeometry {
  const geometry = new THREE.SphereGeometry(0.5, 16, 10);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index) / 0.5;
    const y = position.getY(index);
    const z = position.getZ(index) / 0.5;
    if (y > 0) {
      const dent = Math.exp(-(x * x + z * z) * 4) * 0.08 * (y / 0.5);
      position.setY(index, y - dent);
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}

function createPillow(geometry: THREE.SphereGeometry): THREE.Mesh {
  const pillow = new THREE.Mesh(geometry, createMatteMaterial(ROOM_PROPS.pillow.color, 0.98));
  pillow.name = 'room-bed-long-pillow';
  pillow.scale.set(0.9, 0.14, 0.42);
  pillow.position.set(-2.85, 0.52, -4.02);
  pillow.castShadow = true;
  pillow.receiveShadow = true;
  return pillow;
}

function createPhone(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'room-bedside-phone';
  const halfW = 0.052;
  const halfH = 0.092;
  const radius = 0.013;
  const shape = new THREE.Shape();
  shape.moveTo(-halfW + radius, -halfH);
  shape.lineTo(halfW - radius, -halfH);
  shape.quadraticCurveTo(halfW, -halfH, halfW, -halfH + radius);
  shape.lineTo(halfW, halfH - radius);
  shape.quadraticCurveTo(halfW, halfH, halfW - radius, halfH);
  shape.lineTo(-halfW + radius, halfH);
  shape.quadraticCurveTo(-halfW, halfH, -halfW, halfH - radius);
  shape.lineTo(-halfW, -halfH + radius);
  shape.quadraticCurveTo(-halfW, -halfH, -halfW + radius, -halfH);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.012,
    bevelEnabled: true,
    bevelSegments: 1,
    steps: 1,
    bevelSize: 0.002,
    bevelThickness: 0.002,
    curveSegments: 3,
  });
  geometry.center();
  geometry.rotateX(-Math.PI / 2);
  const body = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0x20252a, roughness: 0.34, metalness: 0.42 }),
  );
  body.position.set(-2.85, 0.601, -4.02);
  body.castShadow = true;
  group.add(body);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.087, 0.153),
    new THREE.MeshStandardMaterial({
      color: 0x8da7ae,
      emissive: 0x72919a,
      emissiveIntensity: 0.38,
      roughness: 0.16,
      metalness: 0.08,
    }),
  );
  screen.rotation.x = -Math.PI / 2;
  screen.position.set(-2.85, 0.611, -4.02);
  group.add(screen);
  return group;
}

function buildBed(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  const bed = ROOM_PROPS.bed;
  for (const x of [bed.center.x - 0.42, bed.center.x + 0.42]) {
    for (const z of [bed.center.z - 0.91, bed.center.z + 0.91]) {
      addBox(parent, { x, y: 0.12, z }, { w: 0.08, h: 0.24, d: 0.08 }, WOOD_COLOR);
    }
  }
  addBox(parent, { x: -2.85, y: 0.2, z: -3.1 }, { w: 1.05, h: 0.16, d: 2.2 }, WOOD_COLOR);
  occluders.push(
    addBox(parent, { x: -2.85, y: 0.355, z: -3.1 }, { w: 1.02, h: 0.19, d: 2.12 }, 0xd2ccc4),
  );

  const textile = getFabricMaterial({ repeatX: 6, repeatY: 8 });
  const duvetMaterial = tintForRoom(textile, 0xcd705d);
  duvetMaterial.side = THREE.DoubleSide;
  const sheetMaterial = tintForRoom(textile, 0xfffcf5);
  sheetMaterial.side = THREE.DoubleSide;
  const duvetGeometry = new THREE.PlaneGeometry(1.1, 1.64, 12, 16);
  duvetGeometry.rotateX(-Math.PI / 2);
  const duvetPosition = duvetGeometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < duvetPosition.count; index += 1) {
    const x = duvetPosition.getX(index);
    const z = duvetPosition.getZ(index);
    const wrinkles = Math.sin(x * 19 + z * 4) * 0.013 + Math.sin(z * 23 - x * 5) * 0.008;
    const dent = Math.exp(-((x + 0.08) ** 2 * 12 + (z - 0.1) ** 2 * 3)) * 0.026;
    duvetPosition.setY(index, wrinkles - dent);
  }
  duvetGeometry.computeVertexNormals();
  const duvet = new THREE.Mesh(duvetGeometry, duvetMaterial);
  duvet.name = 'room-coral-fabric-duvet';
  duvet.position.set(-2.85, 0.51, -2.94);
  duvet.castShadow = true;
  duvet.receiveShadow = true;
  parent.add(duvet);

  const sideGeometry = new THREE.PlaneGeometry(1.62, 0.3, 14, 4);
  const sidePosition = sideGeometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < sidePosition.count; index += 1) {
    const x = sidePosition.getX(index);
    const y = sidePosition.getY(index);
    sidePosition.setZ(index, Math.sin(x * 18 + y * 4) * 0.006);
  }
  sideGeometry.computeVertexNormals();
  const duvetSide = new THREE.Mesh(sideGeometry, duvetMaterial);
  duvetSide.name = 'room-coral-duvet-drape';
  duvetSide.rotation.y = Math.PI / 2;
  duvetSide.position.set(-2.295, 0.36, -2.94);
  duvetSide.castShadow = true;
  parent.add(duvetSide);

  addBox(parent, { x: -2.85, y: 0.72, z: -4.26 }, { w: 1.1, h: 0.9, d: 0.08 }, WOOD_COLOR, {
    castShadow: false,
  });
  addBox(parent, { x: -2.85, y: 0.77, z: -4.205 }, { w: 0.88, h: 0.54, d: 0.025 }, 0x9a8a76, {
    castShadow: false,
  });
  addBox(parent, { x: -2.85, y: 1.16, z: -4.25 }, { w: 1.18, h: 0.08, d: 0.11 }, 0x84735f);
  for (const x of [-3.37, -2.33]) {
    addBox(parent, { x, y: 0.68, z: -4.25 }, { w: 0.07, h: 1.04, d: 0.1 }, 0x84735f);
  }

  const sheetGeometry = new THREE.PlaneGeometry(1.03, 0.22, 20, 4);
  sheetGeometry.rotateX(-Math.PI / 2);
  const sheetPosition = sheetGeometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < sheetPosition.count; index += 1) {
    sheetPosition.setY(index, Math.sin(sheetPosition.getX(index) * 24) * 0.006);
  }
  sheetGeometry.computeVertexNormals();
  const sheet = new THREE.Mesh(sheetGeometry, sheetMaterial);
  sheet.name = 'room-white-folded-sheet';
  sheet.position.set(-2.85, 0.54, -2.4);
  sheet.receiveShadow = true;
  parent.add(sheet);
  const fold = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 1.03, 10),
    sheetMaterial,
  );
  fold.name = 'room-white-sheet-rolled-edge';
  fold.rotation.z = Math.PI / 2;
  fold.position.set(-2.85, 0.54, -2.48);
  fold.castShadow = true;
  parent.add(fold);
  const pillowGeometry = createCushionGeometry();
  parent.add(createPillow(pillowGeometry));
  parent.add(createPhone());
}

function buildCeilingLamp(parent: THREE.Object3D): void {
  const lamp = new THREE.Group();
  lamp.name = 'room-ceiling-lamp';
  lamp.position.set(0, 2.82, -1.6);
  parent.add(lamp);
  const brass = new THREE.MeshStandardMaterial({ color: 0xb89454, roughness: 0.48, metalness: 0.72, side: THREE.DoubleSide });
  const cream = createMatteMaterial(0xeee3ca, 0.82);
  cream.side = THREE.DoubleSide;
  for (const [name, geometry, material, y] of [
    ['room-lamp-canopy', new THREE.CylinderGeometry(0.09, 0.09, 0.04, 16), brass, -0.02],
    ['room-lamp-stem', new THREE.CylinderGeometry(0.009, 0.009, 0.45, 8), brass, -0.255],
    ['room-lamp-cream-shade', new THREE.CylinderGeometry(0.115, 0.25, 0.16, 24, 1, true), cream, -0.56],
    ['room-lamp-brass-shade', new THREE.CylinderGeometry(0.10, 0.215, 0.12, 24, 1, true), brass, -0.57],
  ] as const) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.y = y;
    mesh.receiveShadow = true;
    lamp.add(mesh);
  }
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), new THREE.MeshStandardMaterial({
    color: 0xffefd5, emissive: 0xffd27d, emissiveIntensity: 1.8, roughness: 0.3,
  }));
  bulb.name = 'room-lamp-emissive-bulb';
  bulb.position.y = -0.60;
  lamp.add(bulb);
  const glow = new THREE.Sprite(getWarmLampGlowMaterial());
  glow.name = 'room-lamp-soft-glow';
  glow.position.y = -0.62;
  glow.scale.set(0.48, 0.48, 1);
  glow.raycast = () => {};
  lamp.add(glow);
  const light = new THREE.PointLight(0xffcb82, 1.15, 9, 1.6);
  light.name = 'room-lamp-point-light';
  light.position.y = -0.62;
  light.castShadow = false;
  lamp.add(light);

  // 清晨柔和漫射窗光补光：消除室内偏灰感，保持暖明通透但不改变主吊灯参数
  const morningFill = new THREE.HemisphereLight(0xfff5e4, 0xcab69b, 0.24);
  morningFill.name = 'room-morning-window-fill';
  parent.add(morningFill);
}

/** 三片硬封皮合成一批，白纸内芯是真实实体而非封面上的白色贴片。 */
function buildHardback(parent: THREE.Object3D, details: RoomDetails, name: string,
  color: number, center: Vec3, thickness: number, height: number, stacked = false): THREE.Group {
  const book = new THREE.Group();
  book.name = name;
  book.position.set(center.x, center.y, center.z);
  if (stacked) book.rotation.z = Math.PI / 2;
  const d = 0.18;
  details.batch(book, `${name}-hard-covers`, [
    { center: { x: -thickness / 2, y: 0, z: 0 }, size: { w: 0.008, h: height, d } },
    { center: { x: thickness / 2, y: 0, z: 0 }, size: { w: 0.008, h: height, d } },
    { center: { x: 0, y: 0, z: -d / 2 }, size: { w: thickness, h: height, d: 0.01 } },
  ], details.matte(color));
  details.box(book, `${name}-white-pages`, { x: 0, y: 0, z: 0.004 },
    { w: thickness - 0.008, h: height - 0.018, d: d - 0.016 }, details.matte(0xfffcf3));
  parent.add(book);
  return book;
}

interface PlantSpec { group: string; prefix: string; center: Vec3; scale: number; potColor: number }

/** 小盆栽：开口陶盆 + 土面 + 细茎 + 一批叶片；墙上搁板、衣柜顶、书桌共用 */
function buildPottedPlant(parent: THREE.Object3D, details: RoomDetails, spec: PlantSpec): THREE.Group {
  const plant = new THREE.Group();
  plant.name = spec.group;
  plant.position.set(spec.center.x, spec.center.y, spec.center.z);
  plant.scale.setScalar(spec.scale);
  parent.add(plant);

  const potMaterial = details.matte(spec.potColor, 0.92);
  potMaterial.side = THREE.DoubleSide;
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.064, 0.13, 12, 1, true), potMaterial);
  pot.name = `${spec.prefix}-pot`;
  pot.position.y = 0.065;
  plant.add(pot);
  details.box(plant, `${spec.prefix}-pot-base`, { x: 0, y: 0.008, z: 0 },
    { w: 0.09, h: 0.016, d: 0.09 }, potMaterial);
  const soil = new THREE.Mesh(new THREE.CircleGeometry(0.078, 12), details.matte(0x433529));
  soil.name = `${spec.prefix}-soil`;
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = 0.116;
  plant.add(soil);
  details.batch(plant, `${spec.prefix}-stems`, [-0.025, 0, 0.026].map((x) => ({
    center: { x, y: 0.205, z: 0 }, size: { w: 0.005, h: 0.19, d: 0.005 },
  })), details.matte(0x516746));
  const leaves = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), details.matte(0x52804d), 9);
  releaseInstancesWithGeometry(leaves);
  leaves.name = `${spec.prefix}-leaves`;
  const transform = new THREE.Object3D();
  for (let index = 0; index < 9; index += 1) {
    const angle = index * 2.4;
    transform.position.set(Math.sin(angle) * 0.058, 0.19 + index * 0.013, Math.cos(angle) * 0.045);
    transform.scale.set(0.027, 0.065, 0.014);
    transform.rotation.set(0.4, angle, Math.sin(angle) * 0.9);
    transform.updateMatrix();
    leaves.setMatrixAt(index, transform.matrix);
  }
  leaves.instanceMatrix.needsUpdate = true;
  plant.add(leaves);
  return plant;
}

function buildShelves(parent: THREE.Object3D, details: RoomDetails): void {
  const shelves = new THREE.Group();
  shelves.name = 'room-staggered-shelves';
  parent.add(shelves);
  const wood = details.matte(0xa47748, 0.76);
  details.box(shelves, 'room-shelf-lower', { x: -0.9, y: 1.48, z: -6.09 },
    { w: 1.5, h: 0.055, d: 0.28 }, wood);
  details.box(shelves, 'room-shelf-upper', { x: -0.05, y: 1.76, z: -6.09 },
    { w: 1.45, h: 0.055, d: 0.28 }, wood);
  details.batch(shelves, 'room-shelf-wall-brackets', [
    { center: { x: -1.47, y: 1.40, z: -6.16 }, size: { w: 0.025, h: 0.14, d: 0.17 } },
    { center: { x: -0.33, y: 1.40, z: -6.16 }, size: { w: 0.025, h: 0.14, d: 0.17 } },
    { center: { x: -0.60, y: 1.68, z: -6.16 }, size: { w: 0.025, h: 0.14, d: 0.17 } },
    { center: { x: 0.51, y: 1.68, z: -6.16 }, size: { w: 0.025, h: 0.14, d: 0.17 } },
  ], details.matte(TRIM_COLOR));
  Object.entries(BOOK_COLORS).forEach(([key, color], index) => {
    const height = [0.25, 0.29, 0.23, 0.27][index];
    buildHardback(shelves, details, `room-shelf-book-${key}`, color,
      { x: -1.44 + index * 0.13, y: 1.511 + height / 2, z: -6.08 }, 0.074, height);
  });
  buildHardback(shelves, details, 'room-shelf-stacked-book-lake', BOOK_COLORS.lake,
    { x: -0.40, y: 1.824, z: -6.08 }, 0.064, 0.28, true);
  const upperBook = buildHardback(shelves, details, 'room-shelf-stacked-book-yellow', BOOK_COLORS.yellow,
    { x: -0.37, y: 1.89, z: -6.08 }, 0.052, 0.24, true);
  upperBook.rotation.y = 0.08;

  buildPottedPlant(shelves, details, {
    group: 'room-shelf-potted-plant',
    prefix: 'room-plant',
    center: { x: 0.4, y: 1.788, z: -6.08 },
    scale: 1,
    potColor: 0x424444,
  });
}

function buildWastebasket(parent: THREE.Object3D, details: RoomDetails, occluders: THREE.Object3D[]): void {
  const basket = new THREE.Group();
  basket.name = 'room-open-trapezoid-wastebasket';
  basket.position.set(-3.08, 0, -1.75);
  parent.add(basket);
  const positions: number[] = [];
  const indices: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    const offset = positions.length / 3;
    positions.push(...a, ...b, ...c, ...d);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  };
  // 四壁外面、内面与窄顶边合成一体；中央开口没有任何盖面，底宽小于口宽。
  const ring = (x: number, z: number, y: number): number[][] => [
    [-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z],
  ];
  const bottom = ring(0.11, 0.10, 0.02);
  const top = ring(0.18, 0.17, 0.34);
  const innerBottom = ring(0.098, 0.088, 0.02);
  const innerTop = ring(0.168, 0.158, 0.34);
  for (let side = 0; side < 4; side += 1) {
    const next = (side + 1) % 4;
    quad(bottom[side], bottom[next], top[next], top[side]);
    quad(innerBottom[next], innerBottom[side], innerTop[side], innerTop[next]);
    quad(top[side], top[next], innerTop[next], innerTop[side]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const shell = new THREE.Mesh(geometry, details.matte(0xab7b4e, 0.84));
  shell.name = 'room-wastebasket-hollow-shell';
  shell.castShadow = true;
  shell.receiveShadow = true;
  basket.add(shell);
  details.box(basket, 'room-wastebasket-bottom', { x: 0, y: 0.014, z: 0 },
    { w: 0.22, h: 0.018, d: 0.20 }, details.matte(0x805a38));
  occluders.push(basket);
}

function buildDesk(parent: THREE.Object3D, occluders: THREE.Object3D[], details: RoomDetails): void {
  occluders.push(details.box(parent, 'room-desk-top', { x: 2.7, y: 0.715, z: -2.2 },
    { w: 1.5, h: 0.07, d: 0.8 }, details.matte(0xa17b51, 0.76), true));
  details.batch(parent, 'room-desk-legs', [2.03, 3.37].flatMap((x) => [-2.53, -1.87].map((z) => ({
    center: { x, y: 0.35, z }, size: { w: 0.07, h: 0.7, d: 0.07 },
  }))), details.matte(0x766b60));
  occluders.push(details.box(parent, 'room-desk-drawer-cabinet', { x: 3.17, y: 0.43, z: -2.2 },
    { w: 0.40, h: 0.52, d: 0.64 }, details.matte(0x926d46)));
  for (const [index, y] of [0.55, 0.30].entries()) {
    details.box(parent, `room-desk-drawer-front-${index + 1}`, { x: 3.17, y, z: -1.868 },
      { w: 0.38, h: 0.225, d: 0.025 }, details.matte(0xac8254));
    details.box(parent, `room-desk-black-handle-${index + 1}`, { x: 3.17, y, z: -1.845 },
      { w: 0.14, h: 0.02, d: 0.025 }, details.matte(0x242728, 0.78));
  }

  for (const [index, x] of [2.28, 2.90].entries()) {
    // 靠里一台（x 2.28）出 NVIDIA，靠外、更挨着椅子与房门的一台（x 2.90）出 Qoder
    const screenMaterial = getScreenLogoMaterial(index === 0 ? 'nvidia' : 'qoder');
    const monitor = new THREE.Group();
    monitor.name = `room-monitor-${index + 1}`;
    parent.add(monitor);
    const frame = details.box(monitor, `room-monitor-${index + 1}-matte-frame`, { x, y: 1.10, z: -2.51 },
      { w: 0.54, h: 0.33, d: 0.04 }, details.matte(0x3e4345, 0.85));
    details.box(monitor, `room-monitor-${index + 1}-lit-screen`, { x, y: 1.102, z: -2.487 },
      { w: 0.493, h: 0.281, d: 0.006 }, screenMaterial);
    details.box(monitor, `room-monitor-${index + 1}-stand`, { x, y: 0.856, z: -2.52 },
      { w: 0.038, h: 0.17, d: 0.035 }, details.matte(0x3e4345, 0.85));
    details.box(monitor, `room-monitor-${index + 1}-foot`, { x, y: 0.759, z: -2.545 },
      { w: 0.21, h: 0.018, d: 0.10 }, details.matte(0x3e4345, 0.85));
    occluders.push(frame);
  }
  details.box(parent, 'room-keyboard-base', { x: 2.65, y: 0.765, z: -2.391 },
    { w: 0.43, h: 0.02, d: 0.105 }, details.matte(0x555957, 0.84));
  details.batch(parent, 'room-keyboard-keys', Array.from({ length: 36 }, (_, index) => ({
    center: { x: 2.466 + (index % 12) * 0.033, y: 0.780, z: -2.422 + Math.floor(index / 12) * 0.029 },
    size: { w: 0.025, h: 0.01, d: 0.022 },
  })), details.matte(0xb9bdb6, 0.84));
  const mouse = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), details.matte(0x414746, 0.7));
  mouse.name = 'room-desk-mouse';
  mouse.scale.set(0.036, 0.024, 0.055);
  mouse.position.set(3.04, 0.774, -2.28);
  parent.add(mouse);
  details.box(parent, 'room-mouse-wheel', { x: 3.04, y: 0.798, z: -2.295 },
    { w: 0.006, h: 0.004, d: 0.015 }, details.matte(0xb3b6af));

  const cupMaterial = details.matte(0xe4d9bf, 0.72);
  cupMaterial.side = THREE.DoubleSide;
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.045, 0.11, 12, 1, true), cupMaterial);
  cup.name = 'room-desk-mug';
  cup.position.set(3.23, 0.805, -1.99);
  cup.castShadow = true;
  parent.add(cup);
  const cupBottom = new THREE.Mesh(new THREE.CircleGeometry(0.045, 12), cupMaterial);
  cupBottom.name = 'room-mug-bottom';
  cupBottom.rotation.x = -Math.PI / 2;
  cupBottom.position.set(3.23, 0.752, -1.99);
  parent.add(cupBottom);
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.046, 12), details.matte(0x4a3b31, 0.5));
  coffee.name = 'room-mug-coffee';
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.set(3.23, 0.854, -1.99);
  parent.add(coffee);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 12), cupMaterial);
  handle.name = 'room-mug-handle';
  handle.position.set(3.288, 0.81, -1.99);
  parent.add(handle);

  const bagMaterial = createMatteMaterial(0xc4b49a, 0.86);
  const documentBag = addBox(
    parent,
    { x: 2.7, y: 0.792, z: -2.2 },
    { w: 0.34, h: 0.06, d: 0.24 },
    0xc4b49a,
  );
  documentBag.name = 'document-bag';
  occluders.push(documentBag);
  const flapShape = new THREE.Shape([
    new THREE.Vector2(-0.17, 0.12),
    new THREE.Vector2(0.17, 0.12),
    new THREE.Vector2(0, -0.035),
  ]);
  const flapGeometry = new THREE.ShapeGeometry(flapShape);
  flapGeometry.rotateX(-Math.PI / 2);
  const flap = new THREE.Mesh(flapGeometry, bagMaterial);
  flap.name = 'document-bag-flap';
  flap.position.set(2.7, 0.824, -2.2);
  parent.add(flap);
  addBox(parent, { x: 2.7, y: 0.823, z: -2.08 }, { w: 0.34, h: 0.012, d: 0.018 }, 0xa89478, {
    castShadow: false,
  });
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.075), getDocumentLabelMaterial());
  label.name = 'document-bag-label';
  label.rotation.x = -Math.PI / 2;
  label.position.set(2.68, 0.827, -2.17);
  parent.add(label);

  // 桌面只留键盘 / 鼠标 / 杯子 / 一小盆绿植，加上剧情必带的证件袋
  buildPottedPlant(parent, details, {
    group: 'room-desk-plant',
    prefix: 'room-desk-plant',
    center: { x: 2.08, y: 0.75, z: -2.12 },
    scale: 0.6,
    potColor: 0xdcd5c6,
  });
}

function buildChair(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  occluders.push(
    addBox(parent, { x: 2.4, y: 0.43, z: -0.9 }, { w: 0.5, h: 0.06, d: 0.5 }, 0x8d8378),
  );
  for (const x of [2.2, 2.6]) {
    for (const z of [-1.1, -0.7]) {
      addBox(parent, { x, y: 0.21, z }, { w: 0.045, h: 0.42, d: 0.045 }, 0x766b60);
    }
  }
  const back = ROOM_PROPS.chairBack;
  occluders.push(addBox(parent, back.center, back.size, back.color));
  addBox(parent, { x: 2.42, y: 1.19, z: -0.68 }, { w: 0.56, h: 0.07, d: 0.1 }, 0x766b60);
}

/** 新生文化衫：椅背改挂进衣柜，衣面朝向房间中央，从敞开的柜门能看到 */
function createCultureShirt(): THREE.Group {
  const shirt = new THREE.Group();
  shirt.name = 'culture-shirt';
  const shirtMaterial = createMatteMaterial(0xd9c98f, 0.98);
  shirtMaterial.side = THREE.DoubleSide;
  const bodyGeometry = new THREE.PlaneGeometry(0.38, 0.56, 8, 10);
  const bodyPosition = bodyGeometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < bodyPosition.count; index += 1) {
    const x = bodyPosition.getX(index);
    const y = bodyPosition.getY(index);
    bodyPosition.setZ(index, Math.sin(x * 48 + y * 5) * 0.014 + Math.sin(y * 20) * 0.006);
  }
  bodyGeometry.computeVertexNormals();
  const body = new THREE.Mesh(bodyGeometry, shirtMaterial);
  body.position.y = -0.06;
  shirt.add(body);
  for (const side of [-1, 1]) {
    const sleeveGeometry = new THREE.PlaneGeometry(0.14, 0.2, 4, 4);
    const sleevePosition = sleeveGeometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < sleevePosition.count; index += 1) {
      sleevePosition.setZ(index, Math.sin(sleevePosition.getY(index) * 24) * 0.012);
    }
    sleeveGeometry.computeVertexNormals();
    const sleeve = new THREE.Mesh(sleeveGeometry, shirtMaterial);
    sleeve.position.set(side * 0.215, 0.12, -0.005);
    sleeve.rotation.z = side * -0.48;
    shirt.add(sleeve);
  }
  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.06, 0.009, 6, 14, Math.PI),
    createMatteMaterial(0xb9a974, 0.96),
  );
  collar.position.set(0, 0.215, 0.015);
  collar.rotation.z = Math.PI;
  shirt.add(collar);
  shirt.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return shirt;
}

/** 灰色小推车：整件收进一个组，贴到房门边墙角（原坐标 +1.15 X / +0.70 Z） */
function buildSuitcase(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  const group = new THREE.Group();
  group.name = 'room-trolley';
  group.position.set(1.15, 0, 0.7);
  parent.add(group);
  const suitcase = ROOM_PROPS.suitcase;
  occluders.push(
    addBox(group, { x: 0.6, y: 0.32, z: 2.4 }, { w: 0.75, h: 0.46, d: 0.35 }, suitcase.color),
  );
  addBox(group, { x: 0.6, y: 0.32, z: 2.215 }, { w: 0.62, h: 0.34, d: 0.025 }, 0x8991a0);
  addBox(group, { x: 0.6, y: 0.32, z: 2.197 }, { w: 0.025, h: 0.4, d: 0.012 }, 0x626b79, {
    castShadow: false,
  });
  for (const x of [0.29, 0.91]) {
    for (const y of [0.14, 0.49]) {
      for (const z of [2.22, 2.58]) {
        addBox(group, { x, y, z }, { w: 0.12, h: 0.09, d: 0.055 }, 0x606873);
      }
    }
  }
  const wheelMaterial = createMatteMaterial(0x34393f, 0.72);
  for (const x of [0.34, 0.86]) {
    for (const z of [2.28, 2.52]) {
      addBox(group, { x, y: 0.085, z }, { w: 0.045, h: 0.08, d: 0.045 }, 0x626b79);
      const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), wheelMaterial);
      wheel.scale.set(0.8, 1, 0.65);
      wheel.position.set(x, 0.05, z);
      wheel.castShadow = true;
      group.add(wheel);
    }
  }
  const rodMaterial = new THREE.MeshStandardMaterial({ color: 0x8f969c, roughness: 0.35, metalness: 0.65 });
  for (const x of [0.43, 0.77]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 8), rodMaterial);
    rod.position.set(x, 0.77, 2.51);
    group.add(rod);
  }
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.4, 8), wheelMaterial);
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0.6, 1.02, 2.51);
  group.add(handle);
  addBox(group, { x: 0.6, y: 0.565, z: 2.4 }, { w: 0.24, h: 0.035, d: 0.08 }, 0x4d555f);
  // 推车面摆一只水杯与一叠毛巾，避免看起来像空货架
  addBox(group, { x: 0.44, y: 0.585, z: 2.42 }, { w: 0.08, h: 0.11, d: 0.08 }, 0xdcd5c6, {
    castShadow: false,
  });
  addBox(group, { x: 0.75, y: 0.596, z: 2.4 }, { w: 0.2, h: 0.12, d: 0.26 }, LINEN);
}

/** 双开门衣柜：背板贴右墙、柜门朝房间中央，远侧门扇敞开露出挂在里面的文化衫 */
function buildWardrobe(parent: THREE.Object3D, occluders: THREE.Object3D[], details: RoomDetails): void {
  const wardrobe = new THREE.Group();
  wardrobe.name = 'room-wardrobe';
  parent.add(wardrobe);
  const xMid = (WARDROBE.xFront + WARDROBE.xBack) / 2;
  const zMid = (WARDROBE.zNear + WARDROBE.zFar) / 2;
  const depth = WARDROBE.xBack - WARDROBE.xFront;
  const width = WARDROBE.zFar - WARDROBE.zNear;
  const panel = details.matte(WARM_WHITE, 0.88);
  const oak = details.matte(OAK_FRAME, 0.72);
  occluders.push(details.batch(wardrobe, 'room-wardrobe-carcass', [
    { center: { x: xMid, y: 1.1, z: WARDROBE.zNear + 0.025 }, size: { w: depth, h: 2.2, d: 0.05 } },
    { center: { x: xMid, y: 1.1, z: WARDROBE.zFar - 0.025 }, size: { w: depth, h: 2.2, d: 0.05 } },
    { center: { x: xMid, y: 2.175, z: zMid }, size: { w: depth, h: 0.05, d: width } },
    { center: { x: xMid, y: 0.04, z: zMid }, size: { w: depth - 0.04, h: 0.08, d: width - 0.06 } },
  ], panel));
  // 柜内单独走原木色：暖白门板背后的空腔在室内光下会发灰发蓝，看着像个洞
  details.batch(wardrobe, 'room-wardrobe-interior', [
    { center: { x: WARDROBE.xBack - 0.012, y: 1.13, z: zMid }, size: { w: 0.024, h: 2.04, d: width - 0.05 } },
    { center: { x: xMid, y: 2.03, z: zMid }, size: { w: depth - 0.07, h: 0.03, d: width - 0.08 } },
    { center: { x: xMid, y: 0.1, z: zMid }, size: { w: depth - 0.07, h: 0.02, d: width - 0.08 } },
  ], details.matte(OAK_LIGHT, 0.86));
  details.batchColored(wardrobe, 'room-wardrobe-folded-clothes', [
    { center: { x: xMid, y: 2.09, z: 0.55 }, size: { w: 0.44, h: 0.09, d: 0.4 }, color: LINEN },
    { center: { x: xMid, y: 0.16, z: 0.55 }, size: { w: 0.44, h: 0.1, d: 0.42 }, color: RUG_GRAY },
    { center: { x: xMid, y: 0.255, z: 0.56 }, size: { w: 0.42, h: 0.09, d: 0.4 }, color: 0xdcc9a8 },
  ], 0.96);
  details.box(wardrobe, 'room-wardrobe-cloth-basket', { x: xMid, y: 0.2, z: 1.18 },
    { w: 0.42, h: 0.18, d: 0.4 }, details.matte(RATTAN, 0.95));
  details.batch(wardrobe, 'room-wardrobe-face-frame', [
    { center: { x: WARDROBE.xFront - 0.012, y: 1.1, z: WARDROBE.zNear + 0.005 }, size: { w: 0.03, h: 2.2, d: 0.05 } },
    { center: { x: WARDROBE.xFront - 0.012, y: 1.1, z: WARDROBE.zFar - 0.005 }, size: { w: 0.03, h: 2.2, d: 0.05 } },
    { center: { x: WARDROBE.xFront - 0.012, y: 2.135, z: zMid }, size: { w: 0.03, h: 0.05, d: width } },
  ], oak);

  const leaf = (name: string, hingeZ: number, freeZ: number, yaw: number, blocks: boolean): void => {
    const door = new THREE.Group();
    door.name = name;
    door.position.set(WARDROBE.xFront, 0, hingeZ);
    door.rotation.y = yaw;
    wardrobe.add(door);
    const span = Math.abs(freeZ);
    const mid = freeZ / 2;
    const towardFree = Math.sign(freeZ);
    // 门芯：暖白板 + 细原木勾边 + 一点黑色小拉手（局部 −X 朝房间，局部 Z 沿门扇展开方向）
    details.box(door, `${name}-panel`, { x: -0.011, y: 1.13, z: mid },
      { w: 0.022, h: 2.06, d: span }, panel, true);
    details.batch(door, `${name}-oak-border`, [
      { center: { x: -0.024, y: 2.077, z: mid }, size: { w: 0.005, h: 0.045, d: span - 0.09 } },
      { center: { x: -0.024, y: 0.183, z: mid }, size: { w: 0.005, h: 0.045, d: span - 0.09 } },
      { center: { x: -0.024, y: 1.13, z: towardFree * 0.068 }, size: { w: 0.005, h: 1.849, d: 0.045 } },
      { center: { x: -0.024, y: 1.13, z: towardFree * (span - 0.068) }, size: { w: 0.005, h: 1.849, d: 0.045 } },
    ], oak);
    details.box(door, `${name}-handle`, { x: -0.032, y: 1.16, z: towardFree * (span - 0.08) },
      { w: 0.012, h: 0.1, d: 0.018 }, details.matte(HANDLE_BLACK, 0.4));
    if (blocks) occluders.push(door);
  };
  leaf('room-wardrobe-door-near', WARDROBE.zNear, 0.6, 0, true);
  // 敞开的那扇门不进 occluders：它斜在柜口，会把文化衫的注视 / 点击视线整段挡掉
  leaf('room-wardrobe-door-far', WARDROBE.zFar, -0.6, WARDROBE.doorOpenRad, false);

  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, width - 0.12, 8),
    details.matte(0x9c938a, 0.42));
  rail.name = 'room-wardrobe-hanging-rail';
  rail.rotation.x = Math.PI / 2;
  rail.position.set(xMid - 0.05, 1.92, zMid);
  wardrobe.add(rail);

  const shirt = createCultureShirt();
  shirt.position.set(xMid - 0.05, 1.76, 1.15);
  shirt.rotation.y = -Math.PI / 2;
  wardrobe.add(shirt);
  occluders.push(shirt);

  // 柜顶只放一只藤编筐 + 一盆小绿植
  details.box(wardrobe, 'room-wardrobe-top-basket', { x: xMid, y: 2.31, z: 0.6 },
    { w: 0.42, h: 0.22, d: 0.44 }, details.matte(RATTAN, 0.95), true);
  details.box(wardrobe, 'room-wardrobe-top-basket-rim', { x: xMid, y: 2.418, z: 0.6 },
    { w: 0.45, h: 0.028, d: 0.47 }, details.matte(0xb98f57, 0.95));
  buildPottedPlant(wardrobe, details, {
    group: 'room-wardrobe-top-plant',
    prefix: 'room-wardrobe-plant',
    center: { x: xMid, y: 2.2, z: 1.2 },
    scale: 0.78,
    potColor: 0xe3dccd,
  });
}

/** 原木书架：贴在书桌与房门之间的白墙上，四层书按高矮排好、只放七成，余量留给摆件 */
function buildBookshelf(parent: THREE.Object3D, occluders: THREE.Object3D[], details: RoomDetails): void {
  const shelf = new THREE.Group();
  shelf.name = 'room-bookshelf';
  parent.add(shelf);
  const xMid = (BOOKSHELF.xFront + BOOKSHELF.xBack) / 2;
  const zMid = (BOOKSHELF.zNear + BOOKSHELF.zFar) / 2;
  const depth = BOOKSHELF.xBack - BOOKSHELF.xFront;
  const width = BOOKSHELF.zFar - BOOKSHELF.zNear;
  const oak = details.matte(OAK_LIGHT, 0.8);
  occluders.push(details.batch(shelf, 'room-bookshelf-carcass', [
    { center: { x: xMid, y: 0.85, z: BOOKSHELF.zNear + 0.025 }, size: { w: depth, h: 1.7, d: 0.05 } },
    { center: { x: xMid, y: 0.85, z: BOOKSHELF.zFar - 0.025 }, size: { w: depth, h: 1.7, d: 0.05 } },
    { center: { x: xMid, y: 1.687, z: zMid }, size: { w: depth, h: 0.026, d: width - 0.05 } },
    { center: { x: xMid, y: 0.013, z: zMid }, size: { w: depth, h: 0.026, d: width - 0.05 } },
    { center: { x: BOOKSHELF.xBack - 0.012, y: 0.85, z: zMid }, size: { w: 0.02, h: 1.66, d: width - 0.05 } },
    { center: { x: 3.24, y: 0.44, z: zMid }, size: { w: 0.26, h: 0.024, d: width - 0.05 } },
    { center: { x: 3.24, y: 0.864, z: zMid }, size: { w: 0.26, h: 0.024, d: width - 0.05 } },
    { center: { x: 3.24, y: 1.288, z: zMid }, size: { w: 0.26, h: 0.024, d: width - 0.05 } },
  ], oak));

  const bays = [
    { floor: 0.026, count: 12, tallest: 0.34 },
    { floor: 0.452, count: 10, tallest: 0.32 },
    { floor: 0.876, count: 9, tallest: 0.3 },
    { floor: 1.3, count: 8, tallest: 0.28 },
  ];
  const spines: (BoxPart & { color: number })[] = [];
  const pages: BoxPart[] = [];
  for (const [row, bay] of bays.entries()) {
    let z = BOOKSHELF.zNear + 0.075;
    for (let index = 0; index < bay.count; index += 1) {
      const thickness = 0.032 + ((index * 7 + row * 3) % 5) * 0.005;
      const height = bay.tallest - index * 0.012 - ((index + row) % 2) * 0.004;
      const center = { x: 3.128, y: bay.floor + height / 2, z: z + thickness / 2 };
      spines.push({
        center,
        size: { w: 0.028, h: height, d: thickness },
        color: SHELF_BOOK_TINTS[(index * 3 + row) % SHELF_BOOK_TINTS.length],
      });
      pages.push({
        center: { x: 3.25, y: center.y - 0.004, z: center.z },
        size: { w: 0.2, h: height - 0.012, d: thickness - 0.006 },
      });
      z += thickness + 0.004;
    }
  }
  details.batchColored(shelf, 'room-bookshelf-book-spines', spines);
  details.batch(shelf, 'room-bookshelf-book-pages', pages, details.matte(0xfffcf3, 0.94));

  // 七成满之外留的摆位：一只陶瓷杯、一小盆绿植，加上从桌面收下来的红皮本
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.033, 0.09, 10), details.matte(0xf4efe4, 0.7));
  cup.name = 'room-bookshelf-ceramic-cup';
  cup.position.set(3.24, 0.497, -0.95);
  cup.castShadow = true;
  shelf.add(cup);
  const cupHandle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 6, 10), details.matte(0xf4efe4, 0.7));
  cupHandle.name = 'room-bookshelf-ceramic-cup-handle';
  cupHandle.position.set(3.284, 0.5, -0.95);
  shelf.add(cupHandle);
  buildHardback(shelf, details, 'room-red-notebook', BOOK_COLORS.brick,
    { x: 3.24, y: 0.8935, z: -0.8 }, 0.035, 0.24, true);
  buildPottedPlant(shelf, details, {
    group: 'room-bookshelf-top-plant',
    prefix: 'room-bookshelf-plant',
    center: { x: 3.24, y: 1.3, z: -0.95 },
    scale: 0.55,
    potColor: 0xd8d1c0,
  });
}

/** 梳妆区：+Z 墙一套梳妆台 / 圆镜 / 软垫圆凳 / 落地灯，背板贴墙，台前与推车之间留出通道 */
function buildDressingArea(parent: THREE.Object3D, occluders: THREE.Object3D[], details: RoomDetails): void {
  const front = DRESSER.zBack - DRESSER.depth;
  const midZ = DRESSER.zBack - DRESSER.depth / 2;
  const topY = DRESSER.height;
  const oak = details.matte(OAK_LIGHT, 0.82);
  const dresser = new THREE.Group();
  dresser.name = 'room-dresser';
  parent.add(dresser);

  occluders.push(details.batch(dresser, 'room-dresser-carcass', [
    { center: { x: DRESSER.xCenter - 0.36, y: 0.335, z: midZ }, size: { w: 0.36, h: 0.62, d: 0.4 } },
    { center: { x: DRESSER.xCenter + 0.51, y: 0.335, z: midZ }, size: { w: 0.05, h: 0.62, d: 0.4 } },
    { center: { x: DRESSER.xCenter, y: 0.42, z: DRESSER.zBack - 0.02 }, size: { w: DRESSER.width - 0.04, h: 0.56, d: 0.04 } },
  ], details.matte(WARM_WHITE, 0.9)));
  details.box(dresser, 'room-dresser-top', { x: DRESSER.xCenter, y: topY - 0.025, z: midZ },
    { w: DRESSER.width, h: 0.05, d: DRESSER.depth }, oak, true);
  details.batch(dresser, 'room-dresser-drawers', [
    { center: { x: DRESSER.xCenter - 0.36, y: 0.2, z: front + 0.015 }, size: { w: 0.33, h: 0.22, d: 0.02 } },
    { center: { x: DRESSER.xCenter - 0.36, y: 0.45, z: front + 0.015 }, size: { w: 0.33, h: 0.22, d: 0.02 } },
  ], details.matte(LINEN, 0.88));
  details.batch(dresser, 'room-dresser-drawer-handles', [
    { center: { x: DRESSER.xCenter - 0.36, y: 0.2, z: front - 0.002 }, size: { w: 0.1, h: 0.015, d: 0.012 } },
    { center: { x: DRESSER.xCenter - 0.36, y: 0.45, z: front - 0.002 }, size: { w: 0.1, h: 0.015, d: 0.012 } },
  ], details.matte(HANDLE_BLACK, 0.5));

  // 台面只放托盘、两只小瓶和一盆小绿植，不堆满
  details.box(dresser, 'room-dresser-tray', { x: DRESSER.xCenter - 0.27, y: topY + 0.007, z: midZ - 0.03 },
    { w: 0.26, h: 0.014, d: 0.16 }, details.matte(0xdcd5c6, 0.75));
  const bottleMaterial = details.matte(0xf6efe2, 0.55);
  const tall = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.1, 12), bottleMaterial);
  tall.name = 'room-dresser-bottle-tall';
  tall.position.set(DRESSER.xCenter - 0.31, topY + 0.057, midZ - 0.03);
  dresser.add(tall);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.022, 10), details.matte(HANDLE_BLACK, 0.45));
  cap.name = 'room-dresser-bottle-cap';
  cap.position.set(DRESSER.xCenter - 0.31, topY + 0.118, midZ - 0.03);
  dresser.add(cap);
  const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.06, 12), details.matte(0xcdd6d3, 0.6));
  jar.name = 'room-dresser-bottle-jar';
  jar.position.set(DRESSER.xCenter - 0.19, topY + 0.037, midZ);
  dresser.add(jar);
  buildPottedPlant(dresser, details, {
    group: 'room-dresser-plant',
    prefix: 'room-dresser-plant',
    center: { x: DRESSER.xCenter + 0.42, y: topY, z: midZ - 0.04 },
    scale: 0.5,
    potColor: 0xe3dccd,
  });

  // 圆凳推在台面开口正中，坐下与起身都不额外占地
  const stool = new THREE.Group();
  stool.name = 'room-dressing-stool';
  stool.position.set(DRESSER_STOOL.x, 0, DRESSER_STOOL.z);
  dresser.add(stool);
  const seat = new THREE.Mesh(
    new THREE.CylinderGeometry(DRESSER_STOOL.radius, DRESSER_STOOL.radius, 0.085, 20),
    details.matte(0xe7dfcd, 0.95),
  );
  seat.name = 'room-dressing-stool-cushion';
  seat.position.y = DRESSER_STOOL.seatY;
  seat.castShadow = true;
  seat.receiveShadow = true;
  stool.add(seat);
  details.batch(stool, 'room-dressing-stool-legs', [
    [-0.115, -0.115], [-0.115, 0.115], [0.115, -0.115], [0.115, 0.115],
  ].map(([x, z]) => ({
    center: { x, y: 0.2, z }, size: { w: 0.03, h: 0.4, d: 0.03 },
  })), oak);
}

/** 梳妆镜：细原木圈 + 镜面；软件渲染没有环境贴图，用一条斜向高光带冒充反射 */
function buildDressingMirror(parent: THREE.Object3D, details: RoomDetails): void {
  const mirror = new THREE.Group();
  mirror.name = 'room-dressing-mirror';
  mirror.position.set(DRESSER_MIRROR.x, DRESSER_MIRROR.y, DRESSER_MIRROR.z);
  parent.add(mirror);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(DRESSER_MIRROR.radius, 0.022, 8, 28),
    details.matte(OAK_FRAME, 0.7),
  );
  ring.name = 'room-dressing-mirror-oak-ring';
  mirror.add(ring);
  const glass = new THREE.Mesh(
    new THREE.CircleGeometry(DRESSER_MIRROR.radius - 0.008, 30),
    new THREE.MeshStandardMaterial({ color: 0xdfe6e8, roughness: 0.16, metalness: 0.28 }),
  );
  glass.name = 'room-dressing-mirror-glass';
  glass.rotation.y = Math.PI;
  glass.position.z = -0.006;
  mirror.add(glass);
  const streak = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.4), details.matte(0xf4f8f9, 0.35));
  streak.name = 'room-dressing-mirror-streak';
  streak.rotation.set(0, Math.PI, 0.6);
  streak.position.set(0.05, 0, -0.008);
  mirror.add(streak);
}

/** 落地灯：稳底座 + 细杆 + 朝梳妆台倾的暖白灯罩，只补光不投影 */
function buildFloorLamp(parent: THREE.Object3D, details: RoomDetails): void {
  const lamp = new THREE.Group();
  lamp.name = 'room-floor-lamp';
  lamp.position.set(FLOOR_LAMP.x, 0, FLOOR_LAMP.z);
  parent.add(lamp);
  const stand = details.matte(0x9a9086, 0.55);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.15, FLOOR_LAMP.baseRadius, 0.03, 20), stand);
  base.name = 'room-floor-lamp-base';
  base.position.y = 0.015;
  base.receiveShadow = true;
  lamp.add(base);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.36, 10), stand);
  pole.name = 'room-floor-lamp-pole';
  pole.position.y = 0.71;
  lamp.add(pole);

  const head = new THREE.Group();
  head.name = 'room-floor-lamp-head';
  head.position.y = 1.36;
  head.rotation.z = -0.3;
  lamp.add(head);
  const shadeMaterial = createMatteMaterial(0xeee3ca, 0.82);
  shadeMaterial.side = THREE.DoubleSide;
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.165, 0.24, 20, 1, true), shadeMaterial);
  shade.name = 'room-floor-lamp-shade';
  shade.position.y = 0.06;
  head.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshStandardMaterial({
    color: 0xffefd5, emissive: 0xffd27d, emissiveIntensity: 1.6, roughness: 0.3,
  }));
  bulb.name = 'room-floor-lamp-bulb';
  bulb.position.y = 0.04;
  head.add(bulb);
  const glow = new THREE.Sprite(getWarmLampGlowMaterial());
  glow.name = 'room-floor-lamp-soft-glow';
  glow.position.y = 0.04;
  glow.scale.set(0.42, 0.42, 1);
  glow.raycast = () => {};
  head.add(glow);
  const light = new THREE.PointLight(0xffcb82, 0.62, 4.2, 1.8);
  light.name = 'room-floor-lamp-point-light';
  light.position.y = 0.04;
  light.castShadow = false;
  head.add(light);
}

/** 房间中央的浅色短绒地毯：离床脚 40cm，不压椅子推拉路径 */
function buildRug(parent: THREE.Object3D, details: RoomDetails): void {
  const rug = new THREE.Group();
  rug.name = 'room-center-rug';
  parent.add(rug);
  details.box(rug, 'room-rug-field', { x: RUG.center.x, y: 0.008, z: RUG.center.z },
    { w: RUG.w, h: 0.016, d: RUG.d }, details.matte(RUG_GRAY, 0.99));
  details.box(rug, 'room-rug-inner-field', { x: RUG.center.x, y: 0.017, z: RUG.center.z },
    { w: RUG.w - 0.26, h: 0.006, d: RUG.d - 0.26 }, details.matte(LINEN, 0.99));
  details.batch(rug, 'room-rug-fringe', Array.from({ length: 22 }, (_, index) => {
    const z = RUG.center.z - RUG.d / 2 + 0.05 + Math.floor(index / 2) * 0.066;
    const x = RUG.center.x + (index % 2 === 0 ? -1 : 1) * (RUG.w / 2 + 0.016);
    return { center: { x, y: 0.008, z }, size: { w: 0.032, h: 0.004, d: 0.01 } };
  }), details.matte(0xcfc7b8, 0.99));
}

/** 床脚圆垫：踩脚用的薄圈，避开地毯边与纸篓 */
function buildFootMat(parent: THREE.Object3D, details: RoomDetails): void {
  const mat = new THREE.Mesh(new THREE.CylinderGeometry(FOOT_MAT.radius, FOOT_MAT.radius, 0.014, 24),
    details.matte(LINEN, 0.99));
  mat.name = 'room-bedfoot-round-mat';
  mat.position.set(FOOT_MAT.center.x, 0.007, FOOT_MAT.center.z);
  mat.receiveShadow = true;
  parent.add(mat);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(FOOT_MAT.radius - 0.045, 0.008, 6, 24),
    details.matte(0xd9d1c1, 0.98));
  ring.name = 'room-bedfoot-round-mat-ring';
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(FOOT_MAT.center.x, 0.015, FOOT_MAT.center.z);
  parent.add(ring);
}

/** 两幅细原木框肖像并排挂在床头橙墙，以床的正中线对称，都远离右侧窗洞 */
function buildPaintings(parent: THREE.Object3D, details: RoomDetails): void {
  for (const spec of PORTRAITS) {
    const name = `room-portrait-${spec.kind}`;
    const onBackWall = spec.wall === 'z';
    const frameSize = onBackWall
      ? { w: 0.4, h: 0.5, d: 0.035 }
      : { w: 0.035, h: 0.5, d: 0.4 };
    details.box(parent, `${name}-oak-frame`, spec.center, frameSize, details.matte(OAK_FRAME, 0.7), true);
    const print = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.44), getPortraitMaterial(spec.kind));
    print.name = `${name}-print`;
    print.position.set(
      spec.center.x + (onBackWall ? 0 : -0.019),
      spec.center.y,
      spec.center.z + (onBackWall ? 0.019 : 0),
    );
    if (!onBackWall) print.rotation.y = -Math.PI / 2;
    parent.add(print);
  }
}

function buildDoor(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  const door = ROOM_PROPS.door;
  occluders.push(addBox(parent, door.center, door.size, door.color));
  for (const z of [2.09, 3.31]) {
    addBox(parent, { x: 3.29, y: 1.14, z }, { w: 0.1, h: 2.28, d: 0.1 }, 0x7c6a58);
  }
  addBox(parent, { x: 3.29, y: 2.27, z: 2.7 }, { w: 0.1, h: 0.1, d: 1.32 }, 0x7c6a58);
  for (const y of [0.6, 1.57]) {
    addBox(parent, { x: 3.322, y, z: 2.7 }, { w: 0.022, h: 0.65, d: 0.76 }, 0x76634f);
    for (const z of [2.3, 3.1]) {
      addBox(parent, { x: 3.305, y, z }, { w: 0.025, h: 0.71, d: 0.035 }, 0x8a7560, {
        castShadow: false,
      });
    }
    for (const offsetY of [-0.345, 0.345]) {
      addBox(parent, { x: 3.305, y: y + offsetY, z: 2.7 }, { w: 0.025, h: 0.035, d: 0.84 }, 0x8a7560, {
        castShadow: false,
      });
    }
  }
  const metal = new THREE.MeshStandardMaterial({ color: 0xa3a7a5, roughness: 0.3, metalness: 0.72 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.055, 10), metal);
  base.rotation.z = Math.PI / 2;
  base.position.set(3.295, 1.03, 2.29);
  parent.add(base);
  const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.15, 8), metal);
  lever.rotation.x = Math.PI / 2;
  lever.position.set(3.255, 1.03, 2.35);
  parent.add(lever);
}

function buildRoom(parent: THREE.Object3D): { occluders: THREE.Object3D[] } {
  const occluders: THREE.Object3D[] = [];
  const details = createRoomDetails();
  buildShell(parent, occluders, details);
  buildWindow(parent, details);
  buildCeilingLamp(parent);
  buildShelves(parent, details);
  buildBed(parent, occluders);
  buildDesk(parent, occluders, details);
  buildWastebasket(parent, details, occluders);
  buildChair(parent, occluders);
  buildSuitcase(parent, occluders);
  buildWardrobe(parent, occluders, details);
  buildBookshelf(parent, occluders, details);
  buildDressingArea(parent, occluders, details);
  buildDressingMirror(parent, details);
  buildFloorLamp(parent, details);
  buildRug(parent, details);
  buildFootMat(parent, details);
  buildPaintings(parent, details);
  buildDoor(parent, occluders);
  return { occluders };
}

/** S1：只点枕边手机；窗户 / 文化衫 / 行李箱为观察热点 */
const S1_INTERACTABLES: InteractableConfig[] = [
  { id: 'phone', position: { x: -2.85, y: 0.66, z: -4.02 }, lightOffsetY: 0.24, maxDistance: 5 },
];

const S1_HOTSPOTS: HotspotConfig[] = [
  { id: 'window', position: { x: 1.8, y: 1.9, z: -6.25 }, maxDistance: 9, maxAngleDeg: 12 },
  { id: 'culture-shirt', position: SHIRT_ANCHOR, maxDistance: 8 },
  { id: 'suitcase', position: { x: 1.75, y: 0.55, z: 3.1 }, maxDistance: 8 },
];

/** S3：文化衫（衣柜里）与证件袋可点击带走（非必须），随后进入快跑过场 */
const S3_INTERACTABLES: InteractableConfig[] = [
  { id: 'culture-shirt', position: SHIRT_ANCHOR, lightOffsetY: 0.2, maxDistance: 3.5 },
  { id: 'document-bag', position: { x: 2.7, y: 0.84, z: -2.2 }, maxDistance: 3.5 },
];

/** S1 枕边手机指引点：看完新闻后第一时间给出清晰方向提示 */
const S1_TARGET_GUIDES: TargetGuideConfig[] = [
  { id: 'phone', position: { x: -2.85, y: 0.86, z: -4.02 } },
];

/** S3 边缘方向引导点：玩家面朝床与窗时衣柜文化衫在身后，屏幕边缘自动给出暖金色转身箭头，拿走后随交互一并隐藏 */
const S3_TARGET_GUIDES: TargetGuideConfig[] = [
  { id: 'culture-shirt', position: { x: SHIRT_ANCHOR.x, y: SHIRT_ANCHOR.y + 0.16, z: SHIRT_ANCHOR.z } },
  { id: 'document-bag', position: { x: 2.7, y: 0.98, z: -2.2 } },
];

const OPENING_TURN_DELAY_SEC = 0.25;
const OPENING_TURN_SEC = 0.7;
const OPENING_WAIT_SEC = 5;
const OPENING_BOTH_ITEMS_WAIT_SEC = 2;
const OPENING_FREEZE_SEC = 0.2;
const OPENING_MAX_TURN_SPEED = (200 * Math.PI) / 180;

type OpeningPhase = 'idle' | 'delay' | 'turn' | 'countdown' | 'freeze' | 'done';

let roomContext: SceneRuntimeContext | null = null;
let roomSceneId: SceneId = 'S1';
let roomUnsubscribers: Array<() => void> = [];
let openingPhase: OpeningPhase = 'idle';
let openingPhaseElapsed = 0;
let openingTurnStart = 0;
let openingTurnDelta = 0;
let openingCountdownRemaining = OPENING_WAIT_SEC;
let openingCountdownTotal = OPENING_WAIT_SEC;
let openingCountdownEmitElapsed = 0;
let openingShown = false;
let openingCancelled = false;
let openingAutoArmed = false;
let openingLastWholeSecond = -1;
const openingHeldItems = new Set<string>();

function releaseOpeningSubscriptions(): void {
  for (const unsubscribe of roomUnsubscribers) unsubscribe();
  roomUnsubscribers = [];
  roomContext?.setScriptedLookLocked?.(false);
  roomContext = null;
}

function resetOpeningSequence(): void {
  roomContext?.setScriptedLookLocked?.(false);
  openingPhase = 'idle';
  openingPhaseElapsed = 0;
  openingCountdownRemaining = OPENING_WAIT_SEC;
  openingCountdownTotal = OPENING_WAIT_SEC;
  openingCountdownEmitElapsed = 0;
  openingShown = false;
  openingCancelled = false;
  openingAutoArmed = false;
  openingLastWholeSecond = -1;
  openingHeldItems.clear();
}

function getAutoDepartOverride(): 0 | 2 | null {
  return typeof window === 'undefined' ? null : parseUrlParams(window.location.search).autoDepartSec;
}

function emitOpeningCountdown(active: boolean): void {
  roomContext?.bus.emit('ui:objectiveCountdown', {
    remaining: Math.max(0, openingCountdownRemaining),
    total: openingCountdownTotal,
    active,
  });
}

function cancelOpeningSequence(): void {
  if (openingCancelled || openingPhase === 'idle') return;
  openingCancelled = true;
  openingAutoArmed = false;
  openingPhase = 'done';
  openingPhaseElapsed = 0;
  roomContext?.setScriptedLookLocked?.(false);
  emitOpeningCountdown(false);
}

function beginOpeningSequence(): void {
  if (!roomContext || openingShown || openingCancelled) return;
  openingShown = true;
  openingPhase = 'delay';
  openingPhaseElapsed = 0;
}

function beginOpeningTurn(): void {
  if (!roomContext || openingCancelled) return;
  const feet = roomContext.getPlayerFeet?.(new THREE.Vector3());
  const x = feet?.x ?? SPAWN.x;
  const z = feet?.z ?? SPAWN.z;
  const targetYaw = Math.atan2(-(SHIRT_ANCHOR.x - x), -(SHIRT_ANCHOR.z - z));
  const startYaw = roomContext.getViewYaw?.() ?? SPAWN.yaw ?? 0;
  let delta = ((targetYaw - startYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  if (delta > 0) delta -= Math.PI * 2;
  openingTurnStart = startYaw;
  openingTurnDelta = delta;
  openingPhase = 'turn';
  openingPhaseElapsed = 0;
  roomContext.setScriptedLookLocked?.(true);
}

function beginOpeningCountdown(): void {
  const override = getAutoDepartOverride();
  openingCountdownTotal = override ?? (openingHeldItems.size === 2 ? OPENING_BOTH_ITEMS_WAIT_SEC : OPENING_WAIT_SEC);
  openingCountdownRemaining = openingCountdownTotal;
  openingCountdownEmitElapsed = 0;
  openingLastWholeSecond = Math.ceil(openingCountdownRemaining);
  openingPhase = 'countdown';
  openingPhaseElapsed = 0;
  emitOpeningCountdown(true);
}

function beginOpeningFreeze(): void {
  openingPhase = 'freeze';
  openingPhaseElapsed = 0;
  roomContext?.setScriptedLookLocked?.(true);
  emitOpeningCountdown(false);
}

/** 匀速峰值受限的对称加减速曲线；0.7 秒内完成衣柜朝向且不超过 200°/s */
function openingTurnProgress(progress: number): number {
  const delta = Math.abs(openingTurnDelta);
  const accel = Math.min(0.45, Math.max(0.12, 1 - delta / (OPENING_MAX_TURN_SPEED * OPENING_TURN_SEC)));
  const peak = 1 / (1 - accel);
  if (progress < accel) return progress * progress * peak / (2 * accel);
  if (progress > 1 - accel) {
    const remaining = 1 - progress;
    return 1 - remaining * remaining * peak / (2 * accel);
  }
  return peak * (progress - accel / 2);
}

function tickOpeningSequence(dtSeconds: number): void {
  const context = roomContext;
  if (!context || openingCancelled || openingPhase === 'idle' || openingPhase === 'done') return;
  if (typeof document !== 'undefined' && document.hidden) return;
  if (context.isModalBlocked?.() || context.isCinematic?.()) return;

  openingPhaseElapsed += dtSeconds;
  if (openingPhase === 'delay') {
    if (openingPhaseElapsed >= OPENING_TURN_DELAY_SEC) beginOpeningTurn();
    return;
  }
  if (openingPhase === 'turn') {
    const progress = Math.min(1, openingPhaseElapsed / OPENING_TURN_SEC);
    context.setViewYaw?.(openingTurnStart + openingTurnDelta * openingTurnProgress(progress));
    if (progress >= 1) {
      context.setScriptedLookLocked?.(false);
      if (getAutoDepartOverride() === 0) {
        openingPhase = 'done';
        emitOpeningCountdown(false);
        return;
      }
      beginOpeningCountdown();
    }
    return;
  }
  if (openingPhase === 'countdown') {
    if (roomSceneId !== 'S1' && roomSceneId !== 'S3') return;
    openingCountdownRemaining = Math.max(0, openingCountdownRemaining - dtSeconds);
    const wholeSecond = Math.ceil(openingCountdownRemaining);
    if (wholeSecond !== openingLastWholeSecond && wholeSecond >= 1 && wholeSecond <= 2) {
      openingLastWholeSecond = wholeSecond;
      context.bus.emit('audio:tick');
    }
    openingCountdownEmitElapsed += dtSeconds;
    if (openingCountdownEmitElapsed >= 0.05 || openingCountdownRemaining === 0) {
      openingCountdownEmitElapsed = 0;
      emitOpeningCountdown(true);
    }
    if (openingCountdownRemaining > 0) return;
    if (roomSceneId === 'S1') {
      openingAutoArmed = true;
      openingPhase = 'done';
      emitOpeningCountdown(false);
    } else {
      beginOpeningFreeze();
    }
    return;
  }
  if (openingPhase === 'freeze' && openingPhaseElapsed >= OPENING_FREEZE_SEC) {
    openingPhase = 'done';
    context.setScriptedLookLocked?.(false);
    if (!openingHeldItems.has('document-bag')) {
      openingHeldItems.add('document-bag');
      context.setInteractableVisible('document-bag', false);
    }
    context.bus.emit('ui:hideObjective');
    context.bus.emit('scene:cutscene', {
      stepId: 's3-run',
      key: 's3-run',
      durationMs: 3000,
      skippable: false,
      immediate: true,
    });
  }
}

/** 卧室轻量运行时：开场提示、向右转向、自动出发倒计时与 S3 拾取反馈 */
export const roomRuntime: SceneRuntime = {
  enter(context: SceneRuntimeContext): void {
    releaseOpeningSubscriptions();
    roomContext = context;
    roomSceneId = context.sceneId;
    if (context.sceneId === 'S3' && openingAutoArmed && !openingCancelled) beginOpeningFreeze();

    roomUnsubscribers = [
      context.bus.on('game:start', resetOpeningSequence),
      context.bus.on('world:inputTakeover', cancelOpeningSequence),
      context.bus.on('ui:showObjective', ({ sceneId, persistent }) => {
        if (sceneId === 'S1' && persistent) beginOpeningSequence();
      }),
      context.bus.on('scene:interact', ({ sceneId, targetId }) => {
        if (sceneId !== 'S3') return;
        if (targetId !== 'culture-shirt' && targetId !== 'document-bag') return;
        openingHeldItems.add(targetId);
        context.setInteractableVisible(targetId, false);
        cancelOpeningSequence();
        context.bus.emit('ui:hideObjective');
      }),
    ];
  },
  tick(dtSeconds: number): void {
    if (dtSeconds > 0) tickOpeningSequence(dtSeconds);
  },
  exit(): void {
    releaseOpeningSubscriptions();
  },
};

export function createRoomDefinition(sceneId: SceneId): WorldSceneDefinition {
  const interactables =
    sceneId === 'S1' ? S1_INTERACTABLES : sceneId === 'S3' ? S3_INTERACTABLES : [];
  const hotspots = sceneId === 'S1' ? S1_HOTSPOTS : [];
  const targetGuides = sceneId === 'S1' ? S1_TARGET_GUIDES : sceneId === 'S3' ? S3_TARGET_GUIDES : [];

  return {
    sceneKey: 'room',
    footstepSurface: 'wood',
    spawn: SPAWN,
    nav: NAV,
    exitAnchor: {
      position: { x: ROOM_PROPS.door.center.x, y: 1.6, z: ROOM_PROPS.door.center.z },
      stopDistance: 0.85,
      preparationMs: 4200,
    },
    // 房间（首屏）不出现任何角色：保持零 GLB 加载，首屏资源预算红线
    requiredModels: [],
    interactables,
    hotspots,
    targetGuides,
    // 雾只留给窗外：公寓楼（≈28 m）吃一成雾、80 m 外树线吃四成，室内与行道树完全不受雾
    fog: { color: 0xe6dfd2, near: 22, far: 70 },
    build: buildRoom,
  };
}

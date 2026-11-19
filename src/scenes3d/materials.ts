// scenes3d/materials.ts —— 程序化无缝 PBR 材质库 + 角色脚底接触阴影共享资源
// 全部贴图由离屏 Canvas 逐像素生成：噪声晶格按周期取模，四边数学上严格无缝平铺。
// 缓存的贴图 / 材质 / 几何统一打 SHARED_RESOURCE_FLAG，WorldApp.disposeObjectTree 遇到标记跳过，
// 只有 disposeMaterialCache()（WorldApp.dispose 时调用）才真正释放；释放后再次取用会自动重建。
// art/third_party/ 当前为空，本版本不引用任何外部贴图文件。
// 注意：模块加载不触碰 DOM，只有工厂函数被调用时才创建 Canvas（Node 单测可安全 import）。

import * as THREE from 'three';
import { SHARED_RESOURCE_FLAG } from '../world/resources';

/* ---------------- 周期性噪声：保证贴图四边无缝 ---------------- */

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smoothstep01(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 二维值噪声：采样坐标以 period 为周期环绕，uv ∈ [0,1) 时贴图左右 / 上下连续 */
function periodicNoise(u: number, v: number, periodX: number, periodY: number, seed: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const wrap = (value: number, period: number): number => ((value % period) + period) % period;
  const xa = wrap(x0, periodX);
  const xb = wrap(x0 + 1, periodX);
  const ya = wrap(y0, periodY);
  const yb = wrap(y0 + 1, periodY);
  const sx = smoothstep01(x - x0);
  const sy = smoothstep01(y - y0);
  const n00 = hash2(xa, ya, seed);
  const n10 = hash2(xb, ya, seed);
  const n01 = hash2(xa, yb, seed);
  const n11 = hash2(xb, yb, seed);
  return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
}

type ColorAt = (u: number, v: number) => [number, number, number];

/* ---------------- Canvas / 贴图 / 材质缓存 ---------------- */

const canvasCache = new Map<string, HTMLCanvasElement>();
const materialCache = new Map<string, THREE.MeshStandardMaterial>();

function getColorCanvas(key: string, size: number, colorAt: ColorAt): HTMLCanvasElement {
  const cached = canvasCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前环境不支持 2D Canvas，无法生成程序化贴图');

  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = colorAt(x / size, y / size);
      const index = (y * size + x) * 4;
      image.data[index] = Math.max(0, Math.min(255, Math.round(r)));
      image.data[index + 1] = Math.max(0, Math.min(255, Math.round(g)));
      image.data[index + 2] = Math.max(0, Math.min(255, Math.round(b)));
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  canvasCache.set(key, canvas);
  return canvas;
}

function markShared(resource: { userData: Record<string, unknown> }): void {
  resource.userData[SHARED_RESOURCE_FLAG] = true;
}

function createTiledMaterial(
  key: string,
  size: number,
  colorAt: ColorAt,
  roughness: number,
  metalness: number,
  repeatX: number,
  repeatY: number,
  roughnessAt?: ColorAt,
): THREE.MeshStandardMaterial {
  const cacheKey = `${key}:${repeatX}x${repeatY}`;
  const cached = materialCache.get(cacheKey);
  if (cached) return cached;

  const texture = new THREE.CanvasTexture(getColorCanvas(key, size, colorAt));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  markShared(texture);

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness,
    metalness,
  });
  if (roughnessAt) {
    const roughnessTexture = new THREE.CanvasTexture(
      getColorCanvas(`${key}-roughness`, size, roughnessAt),
    );
    roughnessTexture.wrapS = THREE.RepeatWrapping;
    roughnessTexture.wrapT = THREE.RepeatWrapping;
    roughnessTexture.repeat.set(repeatX, repeatY);
    roughnessTexture.anisotropy = 4;
    markShared(roughnessTexture);
    material.roughnessMap = roughnessTexture;
  }
  markShared(material);
  materialCache.set(cacheKey, material);
  return material;
}

export interface TiledMaterialOptions {
  /** 贴图在 U / V 方向的平铺次数（默认 1；同一参数组合共享同一材质实例） */
  repeatX?: number;
  repeatY?: number;
}

/* ---------------- 各材质配色（逐像素函数，全部为无缝图案） ---------------- */

/** 清晨湿润柏油：细砂砾 + 深色水渍，粗糙度贴图在 0.25–0.42 间变化 */
function asphaltColor(u: number, v: number): [number, number, number] {
  const grain = periodicNoise(u, v, 64, 64, 11);
  const patch = periodicNoise(u, v, 6, 6, 23);
  const wet = smoothstep01(Math.max(0, Math.min(1, (patch - 0.42) * 2.4)));
  const shade = 0.76 + grain * 0.3 + patch * 0.16 - wet * 0.2;
  const speck = hash2(Math.floor(u * 256), Math.floor(v * 256), 31) > 0.985 ? 22 : 0;
  return [48 * shade + speck, 55 * shade + speck, 61 * shade + speck];
}

function asphaltRoughness(u: number, v: number): [number, number, number] {
  const patch = periodicNoise(u, v, 7, 7, 127);
  const grain = periodicNoise(u, v, 48, 48, 131);
  const value = (0.62 + patch * 0.3 + grain * 0.08) * 255;
  return [value, value, value];
}

/** 人行道砖：4×4 错缝砖 + 灰缝 + 表面细噪 */
function pavingColor(u: number, v: number): [number, number, number] {
  const row = Math.floor(v * 4);
  const offset = row % 2 === 0 ? 0 : 0.5;
  const brickU = (u * 4 + offset) % 4;
  const col = Math.floor(brickU);
  const fx = brickU - col;
  const fy = v * 4 - row;
  const mortar = 0.045;
  const isMortar = fx < mortar || fx > 1 - mortar || fy < mortar || fy > 1 - mortar;
  const grain = periodicNoise(u, v, 48, 48, 41);
  if (isMortar) {
    const shade = 0.9 + grain * 0.2;
    return [108 * shade, 110 * shade, 104 * shade];
  }
  const tone = 0.82 + hash2(col, row, 47) * 0.3 + grain * 0.12;
  return [154 * tone, 152 * tone, 144 * tone];
}

/** 墙面粉刷：米白浅灰 + 细腻砂面 + 极淡的大面积色差 */
function plasterColor(u: number, v: number): [number, number, number] {
  const grain = periodicNoise(u, v, 72, 72, 53);
  const clouds = periodicNoise(u, v, 4, 4, 67);
  const shade = 0.93 + grain * 0.08 + clouds * 0.05;
  return [202 * shade, 201 * shade, 190 * shade];
}

/** 木地板：4 块横拼板 + 顺纹拉伸噪声 + 板间缝与错位的端头接缝 */
function woodFloorColor(u: number, v: number): [number, number, number] {
  const rows = 4;
  const row = Math.floor(v * rows);
  const fy = v * rows - row;
  const grain = periodicNoise(u, v, 4, 64, 71);
  const ring = Math.sin((v * 24 + periodicNoise(u, v, 2, 2, 73) * 2) * Math.PI * 2) * 0.05;
  const tone = 0.78 + hash2(row, 0, 79) * 0.22 + grain * 0.26 + ring;
  // 板间横缝 + 每板一处错位的端头竖缝
  const seam = fy < 0.02 || fy > 0.98;
  const jointU = hash2(row, 1, 83);
  const endJoint = Math.abs(u - jointU) < 0.0012;
  if (seam || endJoint) return [82, 61, 44];
  return [166 * tone, 128 * tone, 94 * tone];
}

/** 树皮：纵向沟壑 + 横向短裂 + 深裂纹 */
function barkColor(u: number, v: number): [number, number, number] {
  const ridge = periodicNoise(u, v, 24, 3, 89);
  const crack = periodicNoise(u, v, 40, 12, 97);
  const shade = 0.62 + ridge * 0.62 + crack * 0.12;
  if (ridge < 0.3) return [43, 34, 27];
  return [107 * shade, 88 * shade, 71 * shade];
}

/** 叶簇：细小叶脉与明暗斑驳，配合实例色形成低饱和层次 */
function foliageColor(u: number, v: number): [number, number, number] {
  const clusters = periodicNoise(u, v, 12, 12, 103);
  const veins = Math.abs(Math.sin((u * 31 + v * 17) * Math.PI));
  const speckle = hash2(Math.floor(u * 128), Math.floor(v * 128), 107);
  const shade = 0.62 + clusters * 0.34 + veins * 0.06 + speckle * 0.08;
  return [196 * shade, 211 * shade, 174 * shade];
}

/** 窗格玻璃：冷蓝灰 + 极淡竖向拖影；金属度提供天光反射，不做透明避免排序问题 */
function glassColor(u: number, v: number): [number, number, number] {
  const streak = periodicNoise(u, v, 16, 2, 101);
  const shade = 0.9 + streak * 0.18;
  return [168 * shade, 191 * shade, 205 * shade];
}

/* ---------------- 对外材质工厂（同参数共享实例） ---------------- */

export function getAsphaltMaterial(options: TiledMaterialOptions = {}): THREE.MeshStandardMaterial {
  return createTiledMaterial(
    'asphalt',
    256,
    asphaltColor,
    0.42,
    0.04,
    options.repeatX ?? 1,
    options.repeatY ?? 1,
    asphaltRoughness,
  );
}

export function getPavingMaterial(options: TiledMaterialOptions = {}): THREE.MeshStandardMaterial {
  return createTiledMaterial('paving', 256, pavingColor, 0.9, 0, options.repeatX ?? 1, options.repeatY ?? 1);
}

export function getPlasterMaterial(options: TiledMaterialOptions = {}): THREE.MeshStandardMaterial {
  return createTiledMaterial('plaster', 256, plasterColor, 0.94, 0, options.repeatX ?? 1, options.repeatY ?? 1);
}

export function getWoodFloorMaterial(options: TiledMaterialOptions = {}): THREE.MeshStandardMaterial {
  return createTiledMaterial('wood-floor', 512, woodFloorColor, 0.72, 0, options.repeatX ?? 1, options.repeatY ?? 1);
}

export function getBarkMaterial(options: TiledMaterialOptions = {}): THREE.MeshStandardMaterial {
  return createTiledMaterial('bark', 256, barkColor, 0.95, 0, options.repeatX ?? 1, options.repeatY ?? 1);
}

export function getFoliageMaterial(options: TiledMaterialOptions = {}): THREE.MeshStandardMaterial {
  const material = createTiledMaterial(
    'foliage',
    128,
    foliageColor,
    0.9,
    0,
    options.repeatX ?? 1,
    options.repeatY ?? 1,
  );
  material.flatShading = true;
  return material;
}

export function getWindowGlassMaterial(options: TiledMaterialOptions = {}): THREE.MeshStandardMaterial {
  return createTiledMaterial('window-glass', 256, glassColor, 0.16, 0.4, options.repeatX ?? 1, options.repeatY ?? 1);
}

export function getDocumentLabelMaterial(): THREE.MeshStandardMaterial {
  const key = 'document-label';
  const cached = materialCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前环境不支持 2D Canvas，无法生成程序化贴图');
  context.fillStyle = '#e9e3d6';
  context.fillRect(0, 0, 128, 64);
  context.fillStyle = '#b8b0a1';
  context.fillRect(14, 14, 72, 5);
  context.fillRect(14, 27, 94, 4);
  context.fillRect(14, 39, 56, 4);
  context.strokeStyle = '#a88c73';
  context.lineWidth = 3;
  context.strokeRect(94, 35, 22, 18);
  canvasCache.set(key, canvas);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  markShared(texture);
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9, metalness: 0 });
  markShared(material);
  materialCache.set(key, material);
  return material;
}

/* ---------------- 角色脚底接触阴影（几何 / 贴图 / 材质全局共享） ---------------- */

const CONTACT_SHADOW_LOCAL_Y = 0.015;
let contactShadowGeometry: THREE.PlaneGeometry | null = null;
let contactShadowMaterial: THREE.MeshBasicMaterial | null = null;
let contactShadowTexture: THREE.CanvasTexture | null = null;

/**
 * 只给脚底贴地的角色挂接触阴影：
 * 带 actorModelId 标记的角色外层组（createCharacterActor）且本地 / 世界脚底高度 ≈ 0。
 * gate.ts 背在爸爸身上的 carryLinxia（局部 y = 0.45，位于 carryGroup 内）在此被排除，
 * 不会出现黑圆盘悬空浮在爸爸腰后的穿帮。
 */
export function isGroundedActor(actor: THREE.Object3D, groundY = 0): boolean {
  if (typeof actor.userData.actorModelId !== 'string') return false;
  const worldPosition = new THREE.Vector3();
  actor.getWorldPosition(worldPosition);
  return Math.abs(worldPosition.y - groundY) <= 0.08;
}

/** 新建一个接触阴影圆片实例；几何 / 材质 / 贴图全部共享，disposeObjectTree 不会误删 */
export function createContactShadowDisc(radius = 0.62): THREE.Mesh {
  if (!contactShadowTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前环境不支持 2D Canvas，无法生成接触阴影');
    const gradient = context.createRadialGradient(64, 64, 6, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
    gradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.28)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    contactShadowTexture = new THREE.CanvasTexture(canvas);
    contactShadowTexture.colorSpace = THREE.SRGBColorSpace;
    markShared(contactShadowTexture);
  }
  if (!contactShadowGeometry) {
    contactShadowGeometry = new THREE.PlaneGeometry(1, 1);
    markShared(contactShadowGeometry);
  }
  if (!contactShadowMaterial) {
    contactShadowMaterial = new THREE.MeshBasicMaterial({
      map: contactShadowTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    markShared(contactShadowMaterial);
  }

  const disc = new THREE.Mesh(contactShadowGeometry, contactShadowMaterial);
  disc.name = 'contact-shadow';
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = CONTACT_SHADOW_LOCAL_Y;
  disc.scale.setScalar(radius * 2);
  disc.castShadow = false;
  disc.receiveShadow = false;
  // 不参与碰撞 / 光点遮挡 / 注视等一切射线检测
  disc.raycast = () => {};
  return disc;
}

/** 统一释放材质库与接触阴影的共享资源（WorldApp.dispose 调用；之后取用会自动重建） */
export function disposeMaterialCache(): void {
  for (const material of materialCache.values()) {
    const textures = new Set<THREE.Texture>();
    if (material.map) textures.add(material.map);
    if (material.roughnessMap) textures.add(material.roughnessMap);
    for (const texture of textures) texture.dispose();
    material.dispose();
  }
  materialCache.clear();
  canvasCache.clear();

  contactShadowGeometry?.dispose();
  contactShadowMaterial?.dispose();
  contactShadowTexture?.dispose();
  contactShadowGeometry = null;
  contactShadowMaterial = null;
  contactShadowTexture = null;
}

// scenes3d/materials.ts —— 程序化无缝 PBR 材质库 + 角色脚底接触阴影共享资源
// 全部贴图由离屏 Canvas 逐像素生成：噪声晶格按周期取模，四边数学上严格无缝平铺。
// 缓存的贴图 / 材质 / 几何统一打 SHARED_RESOURCE_FLAG，WorldApp.disposeObjectTree 遇到标记跳过，
// 只有 disposeMaterialCache()（WorldApp.dispose 时调用）才真正释放；释放后再次取用会自动重建。
// 贴图主体全部离屏 Canvas 逐像素生成；只有卧室亮屏标志与墙上画像叠 public/art/ 下的成品 PNG，
// 且 PNG 解码只发生在浏览器（见 createPngOverlayTexture）。
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

/** 中性乳胶漆底纹：低对比逐像素微粒，染色交给场景自有材质，不烘焙场景墙色。 */
function plasterColor(u: number, v: number): [number, number, number] {
  const micro = hash2(Math.floor(u * 256), Math.floor(v * 256), 53) - 0.5;
  const grain = periodicNoise(u, v, 128, 128, 59) - 0.5;
  const clouds = periodicNoise(u, v, 4, 4, 67) - 0.5;
  const value = 250 + micro * 2.4 + grain * 1.6 + clouds * 1.2;
  return [value, value, value];
}

/** 橡木四条板：窄分缝、错缝端头、低对比弯曲年轮及稳定的板间色差。 */
function woodFloorSample(u: number, v: number): { seam: boolean; tone: number; grain: number; row: number } {
  const row = Math.floor(v * 4);
  const fy = v * 4 - row;
  const grain = periodicNoise(u, v, 4, 96, 71);
  const bend = periodicNoise(u, v, 2, 8, 73);
  const ring = Math.sin((v * 32 + bend * 0.32) * Math.PI * 2) * 0.018;
  const jointU = 0.16 + hash2(row, 1, 83) * 0.68;
  const seam = fy < 0.009 || fy > 0.991 || Math.abs(u - jointU) < 0.002;
  return { seam, tone: 0.86 + hash2(row, 0, 79) * 0.16 + grain * 0.1 + ring, grain, row };
}

function woodFloorColor(u: number, v: number): [number, number, number] {
  const { seam, tone } = woodFloorSample(u, v);
  if (seam) return [91, 66, 43];
  return [181 * tone, 142 * tone, 102 * tone];
}

/** 清漆微光泽：板缝更粗糙，板内沿木纹柔和变化；数据贴图保持线性色彩空间。 */
function woodFloorRoughness(u: number, v: number): [number, number, number] {
  const { seam, grain, row } = woodFloorSample(u, v);
  const value = (seam ? 0.96 : 0.58 + grain * 0.14 + hash2(row, 2, 89) * 0.04) * 255;
  return [value, value, value];
}

/** 同一中性细织纹供被面与床单染色复用，不为每种布料色另建贴图缓存。 */
function fabricColor(u: number, v: number): [number, number, number] {
  const weave = (Math.floor(u * 128) % 2 + Math.floor(v * 128) % 2) * 2;
  const fuzz = hash2(Math.floor(u * 128), Math.floor(v * 128), 149) * 3;
  const value = 246 + weave + fuzz;
  return [value, value, value];
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

/** 米白条形旧瓷砖：错缝长条外墙砖 + 灰勾缝 + 微妙砖面色差与轻度雨水流痕 */
function facadeTileSample(u: number, v: number): { mortar: boolean; tone: number; stain: number } {
  const rows = 16;
  const cols = 4;
  const row = Math.floor(v * rows);
  const offset = row % 2 === 0 ? 0 : 0.5;
  const tiledU = (u * cols + offset) % cols;
  const col = Math.floor(tiledU);
  const fx = tiledU - col;
  const fy = v * rows - row;
  const mortar = fx < 0.032 || fx > 0.968 || fy < 0.095 || fy > 0.905;
  const micro = periodicNoise(u, v, 48, 48, 163);
  const streak = periodicNoise(u, v, 16, 3, 173);
  const stain = smoothstep01(Math.max(0, (streak - 0.56) * 2.1)) * 0.075;
  const tone = 0.91 + hash2(col, row, 167) * 0.12 + micro * 0.04 - stain;
  return { mortar, tone, stain };
}

function facadeTileColor(u: number, v: number): [number, number, number] {
  const { mortar, tone } = facadeTileSample(u, v);
  if (mortar) return [158, 156, 148];
  return [226 * tone, 221 * tone, 208 * tone];
}

function facadeTileRoughness(u: number, v: number): [number, number, number] {
  const { mortar, stain } = facadeTileSample(u, v);
  const value = (mortar ? 0.96 : 0.54 + stain * 1.4) * 255;
  return [value, value, value];
}

/** 浅灰拉毛水泥带分格缝：2×4 大板分格缝 + 细腻拉毛颗粒 + 檐下轻度层次 */
function facadeConcreteColor(u: number, v: number): [number, number, number] {
  const cols = 2;
  const rows = 4;
  const fx = (u * cols) % 1;
  const fy = (v * rows) % 1;
  const joint = fx < 0.016 || fx > 0.984 || fy < 0.022 || fy > 0.978;
  const grain = periodicNoise(u, v, 96, 96, 181);
  const blotch = periodicNoise(u, v, 6, 6, 191);
  const micro = hash2(Math.floor(u * 256), Math.floor(v * 256), 193) - 0.5;
  if (joint) {
    const shade = 0.85 + grain * 0.12;
    return [138 * shade, 144 * shade, 146 * shade];
  }
  const panelTone = 0.96 + hash2(Math.floor(u * cols), Math.floor(v * rows), 197) * 0.06;
  const shade = panelTone * (0.91 + grain * 0.09 + blotch * 0.06) + micro * 0.025;
  return [192 * shade, 198 * shade, 199 * shade];
}

/** 暖赭色砖墙：错缝陶土砖 + 浅灰砂浆缝 + 自然烧制色差 */
function facadeBrickColor(u: number, v: number): [number, number, number] {
  const rows = 12;
  const cols = 4;
  const row = Math.floor(v * rows);
  const offset = row % 2 === 0 ? 0 : 0.5;
  const tiledU = (u * cols + offset) % cols;
  const col = Math.floor(tiledU);
  const fx = tiledU - col;
  const fy = v * rows - row;
  const mortar = fx < 0.036 || fx > 0.964 || fy < 0.105 || fy > 0.895;
  const grain = periodicNoise(u, v, 64, 64, 211);
  if (mortar) {
    const shade = 0.92 + grain * 0.14;
    return [176 * shade, 171 * shade, 160 * shade];
  }
  const variation = hash2(col, row, 223);
  const shade = 0.8 + variation * 0.28 + grain * 0.08;
  const warmShift = (variation - 0.5) * 16;
  return [168 * shade + warmShift, 114 * shade + warmShift * 0.4, 92 * shade];
}

/**
 * 建筑窗格玻璃（街区居民楼多层次窗户）：灰度窗格。
 * 三通道相等、只保留"窗帘 / 百叶 / 斜天光"三层明暗结构，色相完全交给 instanceColor——
 * 原来的青绿底与实例色是相乘关系，六色窗染出来会全部塌成脏灰。
 * 基线明度取 176：六色加权平均约 0.57，乘回来正好落在原先 82–114 的观感上，S4 中带明度不因此抬升。
 */
function facadeWindowColor(u: number, v: number): [number, number, number] {
  const col = Math.floor(u * 2);
  const row = Math.floor(v * 2);
  const fx = (u * 2) % 1;
  const fy = (v * 2) % 1;
  const mullion = fx < 0.045 || fx > 0.955 || fy < 0.045 || fy > 0.955;
  if (mullion) return [128, 129, 130];

  // 不同窗格分配窗帘状态：拉帘/百叶/透暗室
  const style = (col + row * 2) % 3;
  let base = 176;
  if (style === 0 && (fx < 0.34 || fx > 0.72)) {
    base = 205 * (0.9 + Math.sin(fx * Math.PI * 10) * 0.08);
  } else if (style === 1 && fy > 0.45) {
    base = 190 * (0.92 + Math.sin(fy * Math.PI * 22) * 0.07);
  } else if (style === 2 && fx > 0.62) {
    base = 186 * (0.92 + Math.sin(fx * Math.PI * 8) * 0.06);
  }

  // 右上至左下斜向晨光反射带（灰度下只剩亮度，不再带色偏）
  const diag = Math.abs(fx * 0.75 + fy * 0.55 - 0.82);
  const gloss = Math.max(0, 1 - diag * 5.2) * 0.34 + fy * 0.14;
  const value = base * (1 - gloss) + 236 * gloss;
  return [value, value, value];
}

/** 临街商铺内景剪影底图：暖黄墙面 + 货架层次 + 暖白顶光渐变（供内凹橱窗使用） */
function storeInteriorColor(u: number, v: number): [number, number, number] {
  const shelfBand = Math.abs(v - 0.28) < 0.025 || Math.abs(v - 0.54) < 0.025 || Math.abs(v - 0.78) < 0.025;
  const topGlow = smoothstep01(Math.max(0, (v - 0.72) / 0.28));
  if (shelfBand) return [126, 98, 72];
  const slot = Math.floor(u * 10);
  const row = v < 0.28 ? 0 : v < 0.54 ? 1 : 2;
  const itemNoise = hash2(slot, row, 251);
  const inItem = (u * 10) % 1 > 0.14 && (u * 10) % 1 < 0.86 && v < 0.76 && (v * 3.8) % 1 < 0.68;
  if (inItem && itemNoise > 0.22) {
    const palette: Array<[number, number, number]> = [
      [188, 146, 108],
      [148, 168, 152],
      [212, 186, 134],
      [168, 138, 126],
    ];
    const [pr, pg, pb] = palette[Math.floor(itemNoise * 12) % palette.length];
    return [pr * (0.85 + topGlow * 0.2), pg * (0.85 + topGlow * 0.2), pb * (0.85 + topGlow * 0.2)];
  }
  const warmth = 0.78 + topGlow * 0.32;
  return [196 * warmth, 168 * warmth, 130 * warmth];
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
  return createTiledMaterial(
    'wood-floor', 512, woodFloorColor, 0.72, 0,
    options.repeatX ?? 1, options.repeatY ?? 1, woodFloorRoughness,
  );
}

export function getFabricMaterial(options: TiledMaterialOptions = {}): THREE.MeshStandardMaterial {
  return createTiledMaterial('fabric', 128, fabricColor, 0.98, 0, options.repeatX ?? 1, options.repeatY ?? 1);
}

// WorldApp 的网格清理不遍历 Sprite 材质；将这一张小光晕和材质纳入全局释放，重进房间不泄漏。
let warmLampGlowTexture: THREE.CanvasTexture | null = null;
let warmLampGlowMaterial: THREE.SpriteMaterial | null = null;

export function getWarmLampGlowMaterial(): THREE.SpriteMaterial {
  if (warmLampGlowMaterial) return warmLampGlowMaterial;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前环境不支持 2D Canvas，无法生成程序化贴图');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
  gradient.addColorStop(0.28, 'rgba(255, 255, 255, 0.22)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  warmLampGlowTexture = new THREE.CanvasTexture(canvas);
  warmLampGlowTexture.colorSpace = THREE.SRGBColorSpace;
  markShared(warmLampGlowTexture);
  warmLampGlowMaterial = new THREE.SpriteMaterial({
    map: warmLampGlowTexture,
    color: 0xffd27d,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  markShared(warmLampGlowMaterial);
  return warmLampGlowMaterial;
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

/** 街区建筑外墙：米白条形旧瓷砖（含粗糙度贴图） */
export function getFacadeTileMaterial(options: TiledMaterialOptions = {}): THREE.MeshStandardMaterial {
  return createTiledMaterial(
    'facade-tile',
    256,
    facadeTileColor,
    0.78,
    0.04,
    options.repeatX ?? 2,
    options.repeatY ?? 2,
    facadeTileRoughness,
  );
}

/** 街区建筑外墙：浅灰拉毛水泥带分格缝 */
export function getFacadeConcreteMaterial(options: TiledMaterialOptions = {}): THREE.MeshStandardMaterial {
  return createTiledMaterial(
    'facade-concrete',
    256,
    facadeConcreteColor,
    0.9,
    0.02,
    options.repeatX ?? 2,
    options.repeatY ?? 2,
  );
}

/** 街区建筑外墙：暖赭色砖墙 */
export function getFacadeBrickMaterial(options: TiledMaterialOptions = {}): THREE.MeshStandardMaterial {
  return createTiledMaterial(
    'facade-brick',
    256,
    facadeBrickColor,
    0.92,
    0,
    options.repeatX ?? 2,
    options.repeatY ?? 2,
  );
}

/** 街区建筑窗格：带窗帘层次与斜向天光反射 */
export function getFacadeWindowMaterial(options: TiledMaterialOptions = {}): THREE.MeshStandardMaterial {
  return createTiledMaterial(
    'facade-window',
    256,
    facadeWindowColor,
    0.18,
    0.34,
    options.repeatX ?? 1,
    options.repeatY ?? 1,
  );
}

/** 临街商铺内凹橱窗暖光货架底图 */
export function getStoreInteriorMaterial(options: TiledMaterialOptions = {}): THREE.MeshStandardMaterial {
  const material = createTiledMaterial(
    'store-interior',
    256,
    storeInteriorColor,
    0.85,
    0,
    options.repeatX ?? 1,
    options.repeatY ?? 1,
  );
  material.emissive.setHex(0xffc987);
  material.emissiveMap = material.map;
  material.emissiveIntensity = 0.34;
  return material;
}

/**
 * 甜品面包店专属 512×512 手绘卡通烘焙展示架贴图（建议 6）：
 * 三层原木面包展示架 + 顶棚暖黄射灯光晕 + 清晰可辨的手绘卡通法棍/牛角可颂/肉桂卷/吐司/
 * 草莓奶油蛋糕/纸杯玛芬/瑞士卷/编织面包/蝴蝶酥/碱水扭结包（带深棕轮廓线与烘焙焦糖高光）。
 */
function paintBakeryInterior(context: CanvasRenderingContext2D, size: number): void {
  const outline = '#5a331d';

  // 1. 温暖浅木/奶油暖光背景墙与竖向木纹
  if (typeof context.createLinearGradient === 'function') {
    const wallGrad = context.createLinearGradient(0, 0, 0, size);
    wallGrad.addColorStop(0, '#fff2d8');
    wallGrad.addColorStop(0.55, '#f2d8b0');
    wallGrad.addColorStop(1, '#dfc092');
    context.fillStyle = wallGrad;
  } else {
    context.fillStyle = '#f2d8b0';
  }
  context.fillRect(0, 0, size, size);

  context.fillStyle = 'rgba(164, 114, 62, 0.08)';
  for (let x = 24; x < size; x += 48) {
    context.fillRect(x, 0, 4, size);
  }

  // 2. 顶部三盏暖黄烘焙射灯与柔和向下照明光晕
  for (const lx of [100, 256, 412]) {
    const glow = context.createRadialGradient(lx, 22, 6, lx, 120, 145);
    glow.addColorStop(0, 'rgba(255, 248, 215, 0.85)');
    glow.addColorStop(0.4, 'rgba(255, 224, 152, 0.35)');
    glow.addColorStop(1, 'rgba(255, 212, 130, 0)');
    context.fillStyle = glow;
    context.fillRect(lx - 145, 0, 290, 240);

    // 小射灯灯罩
    context.fillStyle = '#4b3b30';
    context.fillRect(lx - 18, 4, 36, 12);
    context.fillStyle = '#fff5cc';
    context.fillRect(lx - 12, 15, 24, 5);
  }

  // 3. 三层厚实原木面包展示架板与板下投影
  const shelfYs = [174, 326, 474];
  for (const sy of shelfYs) {
    context.fillStyle = 'rgba(84, 48, 22, 0.24)';
    context.fillRect(0, sy + 18, size, 16);
    context.fillStyle = '#b9824a';
    context.fillRect(0, sy, size, 18);
    context.fillStyle = '#d4a068';
    context.fillRect(0, sy, size, 5);
    context.fillStyle = '#7e5028';
    context.fillRect(0, sy + 15, size, 4);
  }

  if (
    typeof context.beginPath !== 'function'
    || typeof context.arc !== 'function'
    || typeof context.ellipse !== 'function'
    || typeof context.stroke !== 'function'
    || typeof context.fill !== 'function'
    || typeof context.save !== 'function'
  ) {
    return;
  }

  context.lineCap = 'round';
  context.lineJoin = 'round';

  // --- 上层货架（基准 y = 174）：金黄斜纹大法棍、弧形牛角可颂、白糖霜肉桂卷、黄金方形大吐司 ---
  // (1) 金黄斜纹大法棍（左）
  context.save();
  context.translate(82, 142);
  context.rotate(-0.18);
  context.fillStyle = '#d98f36';
  context.strokeStyle = outline;
  context.lineWidth = 4;
  context.beginPath();
  context.ellipse(0, 0, 62, 22, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = '#f5c76e';
  for (const sx of [-32, -10, 12, 34]) {
    context.beginPath();
    context.ellipse(sx, -4, 11, 5, -0.45, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  context.restore();

  // (2) 弧形牛角可颂（中左）
  context.save();
  context.translate(208, 148);
  const segs: Array<[number, number, number, number, number]> = [
    [-34, 10, 14, 11, -0.5],
    [-18, -2, 18, 15, -0.25],
    [0, -8, 22, 19, 0],
    [18, -2, 18, 15, 0.25],
    [34, 10, 14, 11, 0.5],
  ];
  context.strokeStyle = outline;
  context.lineWidth = 3.5;
  for (const [x, y, rx, ry, rot] of segs) {
    context.fillStyle = '#e5a342';
    context.beginPath();
    context.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = '#fbd482';
    context.beginPath();
    context.ellipse(x, y - ry * 0.32, rx * 0.52, ry * 0.26, rot, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();

  // (3) 白色糖霜肉桂卷（中右）
  context.save();
  context.translate(328, 146);
  context.fillStyle = '#c47533';
  context.strokeStyle = outline;
  context.lineWidth = 4;
  context.beginPath();
  context.ellipse(0, 4, 38, 24, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  // 顶部奶油白糖霜垂滴
  context.fillStyle = '#fff9ee';
  context.beginPath();
  context.ellipse(0, -6, 32, 14, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.strokeStyle = '#9c5220';
  context.lineWidth = 3;
  context.beginPath();
  context.arc(0, -6, 16, 0.2, Math.PI * 1.75);
  context.stroke();
  context.restore();

  // (4) 黄金方形大吐司（右）
  context.save();
  context.translate(440, 140);
  context.fillStyle = '#d1822d';
  context.strokeStyle = outline;
  context.lineWidth = 4;
  context.beginPath();
  context.roundRect?.(-36, -24, 72, 58, [16, 16, 6, 6]);
  if (!context.roundRect) context.rect(-36, -24, 72, 58);
  context.fill();
  context.stroke();
  context.fillStyle = '#f8e6ba';
  context.fillRect(-26, -10, 52, 36);
  context.strokeStyle = '#c98842';
  context.lineWidth = 2;
  context.strokeRect(-26, -10, 52, 36);
  context.restore();

  // --- 中层货架（基准 y = 326）：整只草莓奶油蛋糕、切片奶油蛋糕、粉纸托纸杯玛芬、奶香瑞士卷 ---
  // (1) 整只草莓奶油大蛋糕（左）
  context.save();
  context.translate(92, 294);
  // 托盘
  context.fillStyle = '#f5eedf';
  context.strokeStyle = outline;
  context.lineWidth = 3;
  context.beginPath();
  context.ellipse(0, 28, 56, 10, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  // 乳白蛋糕身
  context.fillStyle = '#fff8ec';
  context.lineWidth = 4;
  context.fillRect(-44, -22, 88, 48);
  context.strokeRect(-44, -22, 88, 48);
  // 中间草莓果酱夹层条
  context.fillStyle = '#f28ca0';
  context.fillRect(-42, 2, 84, 8);
  // 顶面与粉色奶油花边
  context.fillStyle = '#ffdfea';
  for (let bx = -36; bx <= 36; bx += 18) {
    context.beginPath();
    context.arc(bx, -22, 10, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  // 三颗鲜红草莓
  for (const sx of [-24, 0, 24]) {
    context.fillStyle = '#de3d50';
    context.beginPath();
    context.moveTo(sx, -46);
    context.lineTo(sx - 10, -26);
    context.lineTo(sx + 10, -26);
    context.closePath();
    context.fill();
    context.stroke();
    context.fillStyle = '#4f9c55';
    context.fillRect(sx - 5, -28, 10, 4);
  }
  context.restore();

  // (2) 草莓切片三角形蛋糕（中左）
  context.save();
  context.translate(216, 298);
  context.fillStyle = '#f9db97';
  context.strokeStyle = outline;
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(-36, 26);
  context.lineTo(36, 26);
  context.lineTo(36, -24);
  context.lineTo(-36, -8);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = '#fff9f0';
  context.fillRect(-34, 2, 68, 10);
  context.fillStyle = '#fffaf2';
  context.beginPath();
  context.moveTo(-36, -8);
  context.lineTo(36, -24);
  context.lineTo(24, -36);
  context.lineTo(-36, -18);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = '#de3d50';
  context.beginPath();
  context.arc(6, -34, 11, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();

  // (3) 粉白波浪纸托巧克力纸杯玛芬（中右）
  context.save();
  context.translate(328, 296);
  // 蓬松深棕蛋糕顶
  context.fillStyle = '#a35d34';
  context.strokeStyle = outline;
  context.lineWidth = 4;
  context.beginPath();
  context.arc(0, -14, 30, Math.PI, 0);
  context.arc(-14, -10, 16, Math.PI * 0.6, Math.PI * 1.8);
  context.arc(14, -10, 16, Math.PI * 1.2, Math.PI * 0.4);
  context.fill();
  context.stroke();
  // 粉白纸杯托
  context.fillStyle = '#f29cb2';
  context.beginPath();
  context.moveTo(-28, -8);
  context.lineTo(28, -8);
  context.lineTo(20, 28);
  context.lineTo(-20, 28);
  context.closePath();
  context.fill();
  context.stroke();
  context.strokeStyle = '#ffdce5';
  context.lineWidth = 3;
  for (const px of [-12, 0, 12]) {
    context.beginPath();
    context.moveTo(px, -4);
    context.lineTo(px * 0.72, 24);
    context.stroke();
  }
  // 顶白糖珠与小樱桃
  context.fillStyle = '#fff9ee';
  for (const [dx, dy] of [[-12, -24], [10, -26], [-2, -16], [14, -15]]) {
    context.beginPath();
    context.arc(dx, dy, 3.2, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();

  // (4) 奶香瑞士卷（右）
  context.save();
  context.translate(442, 296);
  context.fillStyle = '#f4ca7c';
  context.strokeStyle = outline;
  context.lineWidth = 4;
  context.beginPath();
  context.arc(0, 0, 32, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = '#fff8ea';
  context.beginPath();
  context.arc(0, 0, 22, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#d29548';
  context.lineWidth = 4.5;
  context.beginPath();
  context.arc(0, 0, 15, 0, Math.PI * 1.65);
  context.stroke();
  context.beginPath();
  context.arc(0, 0, 7, 0.4, Math.PI * 1.85);
  context.stroke();
  context.restore();

  // --- 下层货架（基准 y = 474）：焦糖编织面包、心形蝴蝶酥、扭结碱水包、撒糖霜小蛋糕卷 ---
  // (1) 焦糖光泽编织面包（左）
  context.save();
  context.translate(92, 448);
  context.strokeStyle = outline;
  context.lineWidth = 3.5;
  for (const [bx, rot] of [[-32, -0.35], [-10, 0.35], [12, -0.35], [32, 0.35]]) {
    context.fillStyle = '#cf7f2d';
    context.beginPath();
    context.ellipse(bx, 0, 20, 15, rot, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = '#f5be6b';
    context.beginPath();
    context.ellipse(bx, -4, 10, 5, rot, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();

  // (2) 心形蝴蝶酥（中左）
  context.save();
  context.translate(216, 444);
  context.fillStyle = '#e5a44c';
  context.strokeStyle = outline;
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(0, 26);
  context.bezierCurveTo(-40, 4, -38, -28, -12, -24);
  context.bezierCurveTo(-4, -22, 0, -10, 0, -6);
  context.bezierCurveTo(0, -10, 4, -22, 12, -24);
  context.bezierCurveTo(38, -28, 40, 4, 0, 26);
  context.fill();
  context.stroke();
  context.strokeStyle = '#9e5a22';
  context.lineWidth = 2.5;
  context.beginPath();
  context.arc(-14, -10, 7, 0, Math.PI * 1.6);
  context.stroke();
  context.beginPath();
  context.arc(14, -10, 7, Math.PI * 1.4, Math.PI * 3);
  context.stroke();
  context.restore();

  // (3) 扭结碱水面包（中右）
  context.save();
  context.translate(332, 444);
  context.strokeStyle = outline;
  context.lineWidth = 15;
  context.beginPath();
  context.arc(-14, -4, 18, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(14, -4, 18, 0, Math.PI * 2);
  context.stroke();
  context.strokeStyle = '#8b4a20';
  context.lineWidth = 9;
  context.beginPath();
  context.arc(-14, -4, 18, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(14, -4, 18, 0, Math.PI * 2);
  context.stroke();
  // 海盐粒
  context.fillStyle = '#fff9ee';
  for (const [sx, sy] of [[-24, -12], [22, -14], [0, 8], [-8, 12], [10, -2]]) {
    context.fillRect(sx - 2, sy - 2, 4, 4);
  }
  context.restore();

  // (4) 撒糖霜草莓小蛋糕卷（右）
  context.save();
  context.translate(442, 446);
  context.fillStyle = '#f2b866';
  context.strokeStyle = outline;
  context.lineWidth = 4;
  context.fillRect(-34, -20, 68, 44);
  context.strokeRect(-34, -20, 68, 44);
  context.fillStyle = '#fff9f0';
  context.fillRect(-34, -24, 68, 14);
  context.strokeRect(-34, -24, 68, 14);
  context.fillStyle = '#e04a5e';
  context.beginPath();
  context.arc(0, -30, 8, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}

export function getBakeryInteriorMaterial(): THREE.MeshStandardMaterial {
  const key = 'bakery-interior';
  const cached = materialCache.get(key);
  if (cached) return cached;

  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前环境不支持 2D Canvas，无法生成程序化贴图');
  paintBakeryInterior(context, size);
  canvasCache.set(key, canvas);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  markShared(texture);

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    emissive: 0xffd79e,
    emissiveMap: texture,
    emissiveIntensity: 0.42,
    roughness: 0.82,
    metalness: 0,
  });
  markShared(material);
  materialCache.set(key, material);
  return material;
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

/* ---------------- 卧室亮屏与墙上画像：程序化底图 + 浏览器内成品 PNG ---------------- */

type CanvasPainter = (context: CanvasRenderingContext2D) => void;
type PngPlacer = (context: CanvasRenderingContext2D, image: HTMLImageElement) => void;

/**
 * 成品 PNG 只在浏览器里解码：Node 单测没有 Image，画布停在程序化底图上，
 * 网格与材质结构不随运行环境变化，解码完成后异步重绘同一张画布。
 */
function createPngOverlayTexture(key: string, width: number, height: number,
  paintBase: CanvasPainter, url: string, place: PngPlacer): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前环境不支持 2D Canvas，无法生成程序化贴图');
  paintBase(context);
  canvasCache.set(key, canvas);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  markShared(texture);
  if (typeof Image === 'function') {
    const image = new Image();
    image.onload = () => {
      place(context, image);
      texture.needsUpdate = true;
    };
    image.src = url;
  }
  return texture;
}

/** 在画布矩形内等比铺放：contain 留白（标志），cover 填满裁切（立绘）。 */
function drawFitted(context: CanvasRenderingContext2D, image: HTMLImageElement,
  x: number, y: number, w: number, h: number, mode: 'contain' | 'cover'): void {
  const fit = mode === 'contain'
    ? Math.min(w / image.width, h / image.height)
    : Math.max(w / image.width, h / image.height);
  const dw = image.width * fit;
  const dh = image.height * fit;
  context.save();
  context.beginPath();
  context.rect(x, y, w, h);
  context.clip();
  context.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  context.restore();
}

/** 书桌两台显示器的亮屏标志（白底 + 品牌图案与文字） */
export type ScreenLogoId = 'qoder' | 'nvidia';

const SCREEN_LOGOS: Record<ScreenLogoId, string> = {
  qoder: './art/screens/logo_qoder.png',
  nvidia: './art/screens/logo_nvidia.png',
};

export function getScreenLogoMaterial(kind: ScreenLogoId): THREE.MeshStandardMaterial {
  const key = `screen-logo-${kind}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  const texture = createPngOverlayTexture(key, 448, 256, (context) => {
    context.fillStyle = '#f8f5ef';
    context.fillRect(0, 0, 448, 256);
    context.fillStyle = '#e9e4d8';
    context.fillRect(0, 0, 448, 6);
    context.fillRect(0, 250, 448, 6);
  }, SCREEN_LOGOS[kind], (context, image) => {
    drawFitted(context, image, 74, 84, 300, 92, 'contain');
  });

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    emissive: 0xffffff,
    emissiveMap: texture,
    emissiveIntensity: 0.52,
    roughness: 0.32,
    metalness: 0.04,
  });
  markShared(material);
  materialCache.set(key, material);
  return material;
}

/** 墙上两幅画像：细原木框由几何体承担，这里画暖白卡纸衬边与人物肖像 */
export type PortraitId = 'her' | 'father';

const PORTRAIT_IMAGES: Record<PortraitId, string> = {
  her: './art/portraits/linxia_fullbody.png',
  father: './art/portraits/father_fullbody.png',
};

export function getPortraitMaterial(kind: PortraitId): THREE.MeshStandardMaterial {
  const key = `portrait-${kind}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  const texture = createPngOverlayTexture(key, 384, 480, (context) => {
    context.fillStyle = '#f4eee2';
    context.fillRect(0, 0, 384, 480);
    context.fillStyle = '#ddd6c7';
    context.fillRect(30, 30, 324, 406);
    context.strokeStyle = '#cfc7b6';
    context.lineWidth = 2;
    context.strokeRect(30, 30, 324, 406);
  }, PORTRAIT_IMAGES[kind], (context, image) => {
    drawFitted(context, image, 30, 30, 324, 406, 'cover');
  });

  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.78, metalness: 0 });
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

/** 接触阴影三件共享资源（贴图 / 几何 / 材质）的懒建，全场景只用一份显存 */
function ensureContactShadowResources(): void {
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
}

/**
 * 接触阴影批处理：N 个圆片合成 1 个 draw call。
 * 几何按批次新建（释放钩子挂在批次自己的几何上，不动全局共享件），材质与贴图仍走模块级单例，0 新增显存。
 */
export function createContactShadowDiscBatch(
  name: string,
  specs: ReadonlyArray<{ x: number; z: number; radius: number; y?: number }>,
): THREE.InstancedMesh | null {
  if (specs.length === 0) return null;
  ensureContactShadowResources();
  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geometry, contactShadowMaterial as THREE.MeshBasicMaterial, specs.length);
  const transform = new THREE.Object3D();
  specs.forEach((spec, index) => {
    transform.position.set(spec.x, spec.y ?? CONTACT_SHADOW_LOCAL_Y, spec.z);
    transform.rotation.set(-Math.PI / 2, 0, 0);
    transform.scale.set(spec.radius * 2, spec.radius * 2, 1);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.raycast = () => {};
  const release = (): void => {
    mesh.dispose();
    geometry.removeEventListener('dispose', release);
  };
  geometry.addEventListener('dispose', release);
  return mesh;
}

/** 新建一个接触阴影圆片实例；几何 / 材质 / 贴图全部共享，disposeObjectTree 不会误删 */
export function createContactShadowDisc(radius = 0.62): THREE.Mesh {
  ensureContactShadowResources();
  const disc = new THREE.Mesh(
    contactShadowGeometry as THREE.PlaneGeometry,
    contactShadowMaterial as THREE.MeshBasicMaterial,
  );
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
    if (material.emissiveMap) textures.add(material.emissiveMap);
    for (const texture of textures) texture.dispose();
    material.dispose();
  }
  materialCache.clear();
  canvasCache.clear();

  warmLampGlowMaterial?.dispose();
  warmLampGlowTexture?.dispose();
  warmLampGlowMaterial = null;
  warmLampGlowTexture = null;

  contactShadowGeometry?.dispose();
  contactShadowMaterial?.dispose();
  contactShadowTexture?.dispose();
  contactShadowGeometry = null;
  contactShadowMaterial = null;
  contactShadowTexture = null;
}

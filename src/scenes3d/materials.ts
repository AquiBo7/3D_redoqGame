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

/** 带窗帘变化与天光斜反光的建筑窗格玻璃（用于街区居民楼多层次窗户） */
function facadeWindowColor(u: number, v: number): [number, number, number] {
  const col = Math.floor(u * 2);
  const row = Math.floor(v * 2);
  const fx = (u * 2) % 1;
  const fy = (v * 2) % 1;
  const mullion = fx < 0.045 || fx > 0.955 || fy < 0.045 || fy > 0.955;
  if (mullion) return [76, 90, 94];

  // 不同窗格分配窗帘状态：拉帘/百叶/透暗室
  const style = (col + row * 2) % 3;
  let r = 82;
  let g = 104;
  let b = 114;
  if (style === 0 && (fx < 0.34 || fx > 0.72)) {
    const fold = 0.9 + Math.sin(fx * Math.PI * 10) * 0.08;
    r = 186 * fold;
    g = 178 * fold;
    b = 158 * fold;
  } else if (style === 1 && fy > 0.45) {
    const slat = 0.92 + Math.sin(fy * Math.PI * 22) * 0.07;
    r = 158 * slat;
    g = 169 * slat;
    b = 172 * slat;
  } else if (style === 2 && fx > 0.62) {
    const fold = 0.92 + Math.sin(fx * Math.PI * 8) * 0.06;
    r = 165 * fold;
    g = 176 * fold;
    b = 174 * fold;
  }

  // 右上至左下斜向冷白晨光反射带
  const diag = Math.abs(fx * 0.75 + fy * 0.55 - 0.82);
  const gloss = Math.max(0, 1 - diag * 5.2) * 0.34 + fy * 0.14;
  return [
    r * (1 - gloss) + 212 * gloss,
    g * (1 - gloss) + 228 * gloss,
    b * (1 - gloss) + 236 * gloss,
  ];
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

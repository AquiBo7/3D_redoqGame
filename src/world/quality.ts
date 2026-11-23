// world/quality.ts —— 双端画质分档：不猜机型，用四个信号打分，再按档位给预算
//
// 为什么需要：同一套参数同时喂给旗舰机和千元机，不是掉帧就是浪费。
// 这里只负责"给多少"（贴图尺寸 / 卡片数 / 各向异性），渲染器 DPR 仍由 WorldApp 统一 clamp。
// 判定顺序：WebGL2 → GPU 家族 → 显存 / 核心数 / 移动端 → 屏幕像素。

export type QualityTier = 'low' | 'mid' | 'high';

export interface CanopyBudget {
  /** 近景树冠贴图边长 */
  textureSize: number;
  /** 每棵树卡片数 */
  cards: number;
  /** 贴图变体数（不同 seed 的树冠，避免整条街一个样） */
  variants: number;
  /** alphaTest：越小边缘越蓬 */
  alphaTest: number;
  /** 各向异性过滤倍数 */
  anisotropy: number;
}

const BUDGETS: Record<QualityTier, CanopyBudget> = {
  low: { textureSize: 512, cards: 4, variants: 2, alphaTest: 0.5, anisotropy: 2 },
  mid: { textureSize: 1024, cards: 7, variants: 3, alphaTest: 0.46, anisotropy: 4 },
  high: { textureSize: 1536, cards: 10, variants: 3, alphaTest: 0.42, anisotropy: 8 },
};

export function canopyBudget(tier: QualityTier): CanopyBudget {
  return BUDGETS[tier];
}

interface GpuInfo {
  renderer: string;
  maxTextureSize: number;
  webgl2: boolean;
}

function readGpu(): GpuInfo {
  const fallback: GpuInfo = { renderer: '', maxTextureSize: 0, webgl2: false };
  if (typeof document === 'undefined') return fallback;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return fallback;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) ?? '') : '';
    const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE) ?? 0);
    const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
    return { renderer, maxTextureSize, webgl2 };
  } catch {
    return fallback;
  }
}

function gpuScore(renderer: string): number {
  const name = renderer.toLowerCase();
  if (/swiftshader|llvmpipe|software/.test(name)) return 0;
  if (/adreno (7|8)\d\d|apple gpu|rtx|radeon rx|geforce/.test(name)) return 3;
  if (/adreno 6[4-9]\d|mali-g[7-9]\d|iris|arc|uhd graphics/.test(name)) return 2;
  return 1;
}

/** 设备打分：≥5 高档、3–4 中档、≤2 低档；没有 WebGL2 或贴图上限 < 2048 直接锁低 */
export function detectQualityTier(): QualityTier {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'mid';
  const gpu = readGpu();
  if (!gpu.webgl2 || (gpu.maxTextureSize > 0 && gpu.maxTextureSize < 2048)) return 'low';

  let score = 1;
  if (gpu.maxTextureSize >= 4096) score += 1;
  score += gpuScore(gpu.renderer);

  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof memory === 'number') score += memory >= 8 ? 1 : memory >= 4 ? 0 : -1;

  const cores = navigator.hardwareConcurrency ?? 4;
  score += cores >= 8 ? 1 : cores >= 4 ? 0 : -1;

  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (coarse) score -= 1;

  const pixels = window.screen.width * window.screen.height * (window.devicePixelRatio || 1) ** 2;
  if (pixels > 4_200_000) score -= 1;

  if (score >= 5) return 'high';
  if (score >= 3) return 'mid';
  return 'low';
}

let cachedTier: QualityTier | null = null;

/** 每次会话只探测一次：建临时 WebGL 上下文有成本，不在每帧或每次建树时重复 */
export function getQualityTier(): QualityTier {
  cachedTier ??= detectQualityTier();
  return cachedTier;
}

/** 测试用：重置探测缓存 */
export function resetQualityTier(): void {
  cachedTier = null;
}

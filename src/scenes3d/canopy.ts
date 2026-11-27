// scenes3d/canopy.ts —— 卡片树冠（alphaTest 硬边卡片，对标《看火人》的做法）
//
// 为什么不用球体堆：
//   1. icosahedron 球 + 纯色材质，剪影必然是折线多边形，远看像花椰菜；
//   2. 一个球只有一层明暗，树冠没有厚度；
//   3. 没有枝条结构，看不出是什么植物。
// 这里换成：真树干（8 边锥台 + 树皮贴图）+ 6~10 张 alpha 卡片，卡片绕 Y 轴按黄金角铺开、
// 彼此错开 30~40°，转动视角时产生视差，"贴纸感"消失。
//
// 三条铁律：
//   1. 只用 alphaTest，严禁 transparent:true（会触发排序、卡片互穿、边缘发黑）；
//   2. 贴图运行时生成（Canvas 2D），新增网络体积 0 KB；
//   3. 同一张贴图缓存复用，几何共享并打 sharedResource 标记，切场不重复建。

import * as THREE from 'three';
import { SHARED_RESOURCE_FLAG } from '../world/resources';

export type CanopyMode = 'mass' | 'tree';

const PALETTE = {
  barkDark: '#2A2420',
  barkMid: '#4A3F38',
  // 三档绿：暗部 #3f7a3c / 中部 #6c9a4a / 受光 #9cc06a，消除清晨逆光下的炭灰石块感
  leafDark: '#3F7A3C',
  leafCore: '#558A43',
  leafMid: '#6C9A4A',
  leafLight: '#85AE5B',
  leafRim: '#9CC06A',
} as const;

const rgb = (hex: string): string => {
  const value = parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255})`;
};
const rgba = (hex: string, alpha: number): string => rgb(hex).replace('rgb(', 'rgba(').replace(')', `,${alpha})`);

/** 可复现随机数（mulberry32）：同一 seed 每次生成的树冠一致 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CanopyTextureOptions {
  /** 画布边长，按画质档位取 512 / 1024 / 1536 */
  size?: number;
  seed?: number;
  /** mass = 一团树冠（近中景拼体积）；tree = 一整棵树（远景 billboard） */
  mode?: CanopyMode;
  /** 镂空面积占比 */
  holeRatio?: number;
  /** 叶团密度倍率 */
  density?: number;
  /** 边缘羽化比例：v1 的 7.5% 就是"糊"的主因，默认 1.5% */
  edgeFeather?: number;
  /** >0 时 alpha 二值化，去掉半透明毛边 */
  threshold?: number;
  aniso?: number;
  /** 内容内缩比例，保证叶团不顶到画布边，硬裁不出直边 */
  inset?: number;
  /** 受光方向：-1 左上，+1 右上 */
  lean?: number;
}

const textureCache = new Map<string, THREE.CanvasTexture>();
let fallbackTexture: THREE.DataTexture | null = null;

/** 无 Canvas 2D 的环境（vitest / SSR）：返回 1×1 占位贴图，场景仍可构建、可断言，不会抛错 */
function canvasAvailable(): boolean {
  return typeof document !== 'undefined' && typeof CanvasRenderingContext2D !== 'undefined';
}

function getFallbackTexture(): THREE.DataTexture {
  if (!fallbackTexture) {
    fallbackTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    fallbackTexture.needsUpdate = true;
    fallbackTexture.userData[SHARED_RESOURCE_FLAG] = true;
  }
  return fallbackTexture;
}

/**
 * 生成树冠卡片贴图：① 枝干骨架 → ② 实心底 → ③ 楔形破形枝 → ④ 四层叶 → ⑤ 边缘开孔 → ⑥ 四边柔化。
 * 同一组参数只生成一次，重复调用返回同一张纹理。
 */
export function getCanopyTexture(options: CanopyTextureOptions = {}): THREE.CanvasTexture {
  if (!canvasAvailable()) return getFallbackTexture() as unknown as THREE.CanvasTexture;
  const size = Math.max(128, Math.round(options.size ?? 1024));
  const spec = {
    size,
    seed: options.seed ?? 1,
    mode: options.mode ?? 'mass',
    holeRatio: options.holeRatio ?? 0.11,
    density: options.density ?? 1,
    edgeFeather: options.edgeFeather ?? 0.015,
    threshold: options.threshold ?? 112,
    aniso: options.aniso ?? 8,
    inset: options.inset ?? 0.045,
    lean: options.lean ?? -1,
  };
  const key = JSON.stringify(spec);
  const cached = textureCache.get(key);
  if (cached) return cached;

  const texture = paintCanopyTexture(spec);
  texture.userData[SHARED_RESOURCE_FLAG] = true;
  textureCache.set(key, texture);
  return texture;
}

type CanopySpec = Required<CanopyTextureOptions> & { size: number };

function paintCanopyTexture(spec: CanopySpec): THREE.CanvasTexture {
  const { size: S, mode, holeRatio, density, edgeFeather, threshold, aniso, inset, lean } = spec;
  const random = rng(spec.seed);
  const isMass = mode === 'mass';
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('树贴图需要 Canvas 2D 上下文');
  const g = ctx;
  g.clearRect(0, 0, S, S);
  g.save();
  g.translate(S * inset, S * inset);
  g.scale(1 - inset * 2, 1 - inset * 2);

  const baseX = S * 0.5;
  const baseY = S * 0.995;

  // ① 枝干骨架：先画，后面被叶团压住，只在叶隙里露出来
  interface Branch { x: number; y: number; x2: number; y2: number; w: number; depth: number }
  const branches: Branch[] = [];
  const startY = isMass ? baseY - S * 0.26 : baseY;
  const grow = (x: number, y: number, angle: number, length: number, width: number, depth: number): void => {
    if (depth <= 0 || length < S * 0.012) return;
    const x2 = x + Math.cos(angle) * length;
    const y2 = y + Math.sin(angle) * length * 0.92;
    branches.push({ x, y, x2, y2, w: width, depth });
    const kids = depth > 4 ? 2 : (random() < 0.72 ? 2 : 1);
    for (let index = 0; index < kids; index += 1) {
      const spread = (kids === 1 ? 0 : (index === 0 ? -1 : 1)) * (0.22 + random() * 0.3);
      grow(x2, y2, angle + spread, length * (0.66 + random() * 0.14), width * (0.58 + random() * 0.1), depth - 1);
    }
  };
  grow(baseX, startY, -Math.PI / 2, isMass ? S * 0.24 : S * 0.3,
    isMass ? S * 0.026 : S * 0.034, isMass ? 5 : 6);

  for (const branch of branches) {
    const dx = branch.x2 - branch.x;
    const dy = branch.y2 - branch.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const w0 = branch.w;
    const w1 = branch.w * 0.52;
    const gradient = g.createLinearGradient(branch.x, branch.y, branch.x2, branch.y2);
    gradient.addColorStop(0, PALETTE.barkDark);
    gradient.addColorStop(1, PALETTE.barkMid);
    g.fillStyle = gradient;
    g.beginPath();
    g.moveTo(branch.x + nx * w0 / 2, branch.y + ny * w0 / 2);
    g.lineTo(branch.x2 + nx * w1 / 2, branch.y2 + ny * w1 / 2);
    g.lineTo(branch.x2 - nx * w1 / 2, branch.y2 - ny * w1 / 2);
    g.lineTo(branch.x - nx * w0 / 2, branch.y - ny * w0 / 2);
    g.closePath();
    g.fill();
  }

  // ② 叶团布局：mass 铺满画布，tree 收成一棵树的形状
  type Lobe = [number, number, number, number];
  const lobes: Lobe[] = isMass
    ? [[0.46, 0.47, 0.40, 0.35], [0.69, 0.62, 0.25, 0.22], [0.25, 0.31, 0.23, 0.21], [0.53, 0.26, 0.26, 0.20]]
    : [[0.48, 0.44, 0.30, 0.26], [0.31, 0.30, 0.20, 0.17], [0.66, 0.55, 0.19, 0.16]];

  const canopyCx = (lobes.reduce((sum, lobe) => sum + lobe[0], 0) / lobes.length) * S;
  const canopyCy = (lobes.reduce((sum, lobe) => sum + lobe[1], 0) / lobes.length) * S;
  const canopyH = Math.max(...lobes.map((lobe) => lobe[3])) * S * 2;
  const canopyRx = Math.max(...lobes.map((lobe) => lobe[2])) * S * 1.25;
  const canopyRy = Math.max(...lobes.map((lobe) => lobe[3])) * S * 1.15;

  interface LeafPoint { x: number; y: number; w: number; edge: boolean }
  const points: LeafPoint[] = [];
  for (const [cx, cy, rx, ry] of lobes) {
    const count = Math.round(900 * density * (rx * ry) / 0.078);
    for (let index = 0; index < count; index += 1) {
      const angle = random() * Math.PI * 2;
      const distance = Math.pow(random(), 0.55);
      const x = (cx + Math.cos(angle) * rx * distance) * S;
      const y = (cy + Math.sin(angle) * ry * distance) * S;
      if (x < 2 || y < 2 || x > S - 2 || y > S - 2) continue;
      points.push({ x, y, w: 0.55 + random() * 0.75, edge: distance > 0.82 });
    }
  }
  for (const branch of branches) {
    if (branch.depth <= 3) points.push({ x: branch.x2, y: branch.y2, w: 0.5 + random() * 0.5, edge: false });
  }

  // ②b 实心底：先铺一层软边叶团，保证"不漏天"；没有这一层，叶点会各自独立，远看是波点
  for (const [cx, cy, rx, ry] of lobes) {
    const cxp = cx * S;
    const cyp = cy * S;
    const gradient = g.createRadialGradient(cxp, cyp, Math.min(rx, ry) * S * 0.3, cxp, cyp, Math.max(rx, ry) * S * 1.02);
    gradient.addColorStop(0, rgb(PALETTE.leafDark));
    gradient.addColorStop(0.68, rgb(PALETTE.leafDark));
    gradient.addColorStop(0.88, rgba(PALETTE.leafDark, 0.92));
    gradient.addColorStop(1, rgba(PALETTE.leafDark, 0));
    g.fillStyle = gradient;
    g.beginPath();
    g.ellipse(cxp, cyp, rx * S * 1.02, ry * S * 1.02, 0, 0, Math.PI * 2);
    g.fill();
  }

  // ③b 楔形破形枝：必须根部宽、梢部尖；等宽细线画在叶面上会像划痕
  const taperedBranch = (
    x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, bend: number,
  ): void => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const cxp = (x0 + x1) / 2 + nx * bend;
    const cyp = (y0 + y1) / 2 + ny * bend;
    const point = (t: number): [number, number] => {
      const mt = 1 - t;
      return [mt * mt * x0 + 2 * mt * t * cxp + t * t * x1, mt * mt * y0 + 2 * mt * t * cyp + t * t * y1];
    };
    const left: Array<[number, number]> = [];
    const right: Array<[number, number]> = [];
    for (let index = 0; index <= 10; index += 1) {
      const t = index / 10;
      const [px, py] = point(t);
      const [qx, qy] = point(Math.min(1, t + 0.02));
      const tx = qx - px;
      const ty = qy - py;
      const tl = Math.hypot(tx, ty) || 1;
      const ux = -ty / tl;
      const uy = tx / tl;
      const half = (w0 * (1 - t) + w1 * t) * 0.5;
      left.push([px + ux * half, py + uy * half]);
      right.push([px - ux * half, py - uy * half]);
    }
    g.beginPath();
    g.moveTo(left[0][0], left[0][1]);
    for (const [x, y] of left) g.lineTo(x, y);
    for (let index = right.length - 1; index >= 0; index -= 1) g.lineTo(right[index][0], right[index][1]);
    g.closePath();
    const gradient = g.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, PALETTE.barkDark);
    gradient.addColorStop(1, PALETTE.barkMid);
    g.fillStyle = gradient;
    g.fill();
  };

  for (let index = 0; index < 3; index += 1) {
    const angle = -Math.PI * 1.02 + (index / 2) * Math.PI * 1.04 + (random() - 0.5) * 0.12;
    const r0 = 0.3 + random() * 0.22;
    const r1 = 1.02 + random() * 0.12;
    taperedBranch(
      canopyCx + Math.cos(angle) * canopyRx * r0,
      canopyCy + Math.sin(angle) * canopyRy * r0,
      canopyCx + Math.cos(angle) * canopyRx * r1,
      canopyCy + Math.sin(angle) * canopyRy * r1 * 0.9,
      S * 0.02, S * 0.0035, (0.5 + random() * 0.5) * S * 0.075,
    );
  }

  // ④ 四层明度：暗 → 中 → 亮 → 边缘光，越往上越亮，制造厚度
  interface Pass { color: string; radius: number; offsetY: number; offsetX: number; limitY: number | null; weight: number }
  const shadePass = (pass: Pass): void => {
    g.fillStyle = pass.color;
    for (const point of points) {
      if (pass.limitY !== null && point.y > canopyCy + canopyH * pass.limitY) continue;
      if (pass.weight !== 1 && random() > pass.weight) continue;
      for (let k = 0; k < 2; k += 1) {
        const radius = pass.radius * (k ? 0.58 : 1) * point.w * S * 0.021;
        g.save();
        g.translate(
          point.x + pass.offsetX * S * 0.006 + (k ? (random() - 0.5) * S * 0.012 : 0),
          point.y + pass.offsetY * S * 0.006 + (k ? (random() - 0.5) * S * 0.012 : 0),
        );
        g.rotate((random() - 0.5) * 0.9);
        g.beginPath();
        g.ellipse(0, 0, radius, radius * (0.52 + random() * 0.26), 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
  };

  shadePass({ color: PALETTE.leafDark, radius: 1.35, offsetY: 4.5, offsetX: 0, limitY: null, weight: 1 });
  shadePass({ color: PALETTE.leafCore, radius: 1.05, offsetY: 1.2, offsetX: lean * 0.6, limitY: 0.42, weight: 0.9 });
  shadePass({ color: PALETTE.leafMid, radius: 0.78, offsetY: -2.2, offsetX: lean * 1.6, limitY: 0.16, weight: 0.78 });
  shadePass({ color: PALETTE.leafLight, radius: 0.52, offsetY: -4.6, offsetX: lean * 2.4, limitY: -0.04, weight: 0.4 });
  shadePass({ color: PALETTE.leafRim, radius: 0.3, offsetY: -6, offsetX: lean * 3, limitY: -0.14, weight: 0.22 });

  // ⑤ 镂空：75% 落在轮廓附近破形，25% 落在内部透光
  const edgePoints = points.filter((point) => point.edge);
  const innerPoints = points.filter((point) => !point.edge);
  const holeRadius = S * 0.012;
  const holes = Math.round(S * S * holeRatio / (Math.PI * holeRadius * holeRadius));
  g.globalCompositeOperation = 'destination-out';
  for (let index = 0; index < holes; index += 1) {
    const pool = index % 4 === 3 ? innerPoints : edgePoints;
    const point = pool[(random() * pool.length) | 0];
    if (!point) continue;
    const radius = S * (0.0035 + Math.pow(random(), 1.7) * 0.012);
    g.beginPath();
    g.ellipse(
      point.x + (random() - 0.5) * S * 0.05,
      point.y + (random() - 0.5) * S * 0.05,
      radius, radius * 0.8, random() * 3, 0, Math.PI * 2,
    );
    g.fill();
  }
  if (!isMass) {
    const clear = g.createRadialGradient(baseX, baseY - S * 0.26, S * 0.01, baseX, baseY - S * 0.26, S * 0.17);
    clear.addColorStop(0, 'rgba(0,0,0,0.85)');
    clear.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = clear;
    g.beginPath();
    g.arc(baseX, baseY - S * 0.26, S * 0.17, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  g.restore();

  // ⑥ 四边透明柔化：唯一正确的做法是四条线性渐变，中心圆形遮罩会把不对称叶团削圆
  {
    const mask = document.createElement('canvas');
    mask.width = S;
    mask.height = S;
    const mg = mask.getContext('2d');
    if (mg) {
      mg.fillStyle = '#fff';
      mg.fillRect(0, 0, S, S);
      mg.globalCompositeOperation = 'destination-out';
      const feather = S * edgeFeather;
      const edge = (x0: number, y0: number, x1: number, y1: number): void => {
        const gradient = mg.createLinearGradient(x0, y0, x1, y1);
        gradient.addColorStop(0, 'rgba(0,0,0,1)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        mg.fillStyle = gradient;
        mg.fillRect(0, 0, S, S);
      };
      edge(0, 0, 0, feather);
      edge(0, S, 0, S - feather);
      edge(0, 0, feather, 0);
      edge(S, 0, S - feather, 0);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(mask, 0, 0);
      g.globalCompositeOperation = 'source-over';
    }
  }

  if (threshold > 0) {
    const image = g.getImageData(0, 0, S, S);
    const data = image.data;
    for (let index = 3; index < data.length; index += 4) data[index] = data[index] >= threshold ? 255 : 0;
    g.putImageData(image, 0, 0);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `canopy-${mode}-${spec.seed}-${S}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = aniso;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** 卡片几何全场景共享：平面 1×1，靠实例矩阵缩放；打共享标记，切场不销毁 */
const CARD_GEOMETRY = new THREE.PlaneGeometry(1, 1);
CARD_GEOMETRY.userData[SHARED_RESOURCE_FLAG] = true;

/**
 * 实例缓冲（instanceMatrix / instanceColor）只有 InstancedMesh.dispose() 会释放，
 * 而卡片几何是共享的、切场时不会被 dispose，所以把释放挂在材质上：
 * 材质是每个批次独有的，场景清理必然 dispose 它。dispose() 不会连带 dispose 共享几何。
 */
function bindInstanceRelease(mesh: THREE.InstancedMesh, material: THREE.Material): void {
  const release = (): void => {
    mesh.dispose();
    material.removeEventListener('dispose', release);
  };
  material.addEventListener('dispose', release);
}

export interface WindTime { value: number }

export interface CanopyCardMaterialOptions {
  map: THREE.Texture;
  color?: number;
  alphaTest?: number;
  time?: WindTime;
  /** 风摆幅度（米），0 = 完全静止 */
  sway?: number;
}

/**
 * 卡片材质：alphaTest 硬边 + 双面 + 受雾影响。
 * 不用 MeshStandardMaterial 是刻意的——树冠的明暗已经烘进贴图，再叠实时光照会变脏。
 */
export function createCanopyCardMaterial(options: CanopyCardMaterialOptions): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: options.map,
    color: options.color ?? 0xffffff,
    alphaTest: options.alphaTest ?? 0.45,
    transparent: false,
    side: THREE.DoubleSide,
    fog: true,
    depthWrite: true,
  });
  const time = options.time;
  const sway = options.sway ?? 0;
  if (!time || sway <= 0) return material;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uSway = { value: sway };
    shader.vertexShader = `uniform float uTime;\nuniform float uSway;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float canopyPhase = instanceMatrix[3][0] * 0.63 + instanceMatrix[3][2] * 0.91;
      #else
        float canopyPhase = 0.0;
      #endif
      float canopyWeight = pow(clamp(uv.y, 0.0, 1.0), 1.7);
      transformed.x += sin(uTime * 1.15 + canopyPhase) * uSway * canopyWeight;
      transformed.z += cos(uTime * 0.87 + canopyPhase * 1.31) * uSway * 0.6 * canopyWeight;`,
    );
  };
  material.customProgramCacheKey = () => `canopy-card-wind:${sway.toFixed(3)}`;
  return material;
}

export interface CanopyTreeOptions {
  /** 树干高度（地面 → 冠底） */
  height?: number;
  /** 树冠半径 */
  radius?: number;
  /** 卡片数量，按画质档位 4 / 7 / 10 */
  cards?: number;
  seed?: number;
  texture?: CanopyTextureOptions;
  /** 卡片染色：同张贴图靠 color 拉出近中远景深 */
  tint?: number;
  alphaTest?: number;
  time?: WindTime;
  sway?: number;
  /** 复用车场景树皮材质；不传则用纯色哑光 */
  bark?: THREE.Material;
  /** 树干底部半径 */
  trunkRadius?: number;
}

export interface CanopyTree {
  group: THREE.Group;
  cards: THREE.InstancedMesh;
  trunk: THREE.Mesh;
}

/** 卡片矩阵：绕 Y 轴按黄金角铺开，半径与高度错落，避免所有卡片平行于镜头 */
function cardMatrix(index: number, count: number, radius: number, height: number, random: () => number): THREE.Matrix4 {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const t = (index + 0.5) / count;
  const angle = index * golden * 2;
  const ring = radius * (0.42 + 0.58 * Math.sin(Math.PI * t));
  const position = new THREE.Vector3(
    Math.cos(angle) * ring * 0.9,
    (t - 0.5) * height,
    Math.sin(angle) * ring * 0.55,
  );
  const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    (random() - 0.5) * 0.22,
    angle + Math.PI / 2,
    (random() - 0.5) * 0.11,
  ));
  const scale = 0.85 + 0.3 * (((index * 37) % 11) / 11);
  return new THREE.Matrix4().compose(position, quat, new THREE.Vector3(scale, scale * 1.05, scale));
}

/**
 * 拼一棵卡片树：8 边锥台树干（带轻微弯曲，避免电线杆感）+ N 张交叉卡片。
 * 返回的 Group 直接 add 到场景即可，销毁交给 WorldApp.disposeObjectTree。
 */
export function createCanopyTree(options: CanopyTreeOptions = {}): CanopyTree {
  const height = options.height ?? 2.4;
  const radius = options.radius ?? 0.95;
  const cardCount = Math.max(3, Math.round(options.cards ?? 7));
  const seed = options.seed ?? 1;
  const random = rng(seed * 7919 + 17);

  const group = new THREE.Group();
  group.name = `canopy-tree-${seed}`;

  const trunkRadius = options.trunkRadius ?? Math.max(0.055, radius * 0.075);
  const trunkGeometry = new THREE.CylinderGeometry(trunkRadius * 0.55, trunkRadius, height, 8, 3, true);
  const position = trunkGeometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < position.count; index += 1) {
    const y = position.getY(index);
    const t = (y + height / 2) / height;
    position.setX(index, position.getX(index) + Math.sin(t * 2.1) * height * 0.022);
  }
  trunkGeometry.computeVertexNormals();
  const trunkMaterial = options.bark ?? new THREE.MeshLambertMaterial({ color: 0x4a4438, side: THREE.DoubleSide });
  const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
  trunk.name = group.name + '-trunk';
  trunk.position.y = height / 2;
  trunk.castShadow = false;
  trunk.receiveShadow = true;
  group.add(trunk);

  const texture = getCanopyTexture({ size: 1024, seed, ...options.texture });
  const material = createCanopyCardMaterial({
    map: texture,
    color: options.tint ?? 0xffffff,
    alphaTest: options.alphaTest ?? 0.45,
    time: options.time,
    sway: options.sway ?? 0.035,
  });
  const cards = new THREE.InstancedMesh(CARD_GEOMETRY, material, cardCount);
  bindInstanceRelease(cards, material);
  cards.name = group.name + '-cards';
  const cardScale = radius * 2.35;
  const canopyHeight = radius * 1.75;
  const transform = new THREE.Object3D();
  for (let index = 0; index < cardCount; index += 1) {
    const matrix = cardMatrix(index, cardCount, radius * 0.85, canopyHeight, random);
    matrix.decompose(transform.position, transform.quaternion, transform.scale);
    transform.scale.multiplyScalar(cardScale);
    transform.position.y += height + radius * 0.62;
    transform.updateMatrix();
    cards.setMatrixAt(index, transform.matrix);
  }
  cards.instanceMatrix.needsUpdate = true;
  cards.castShadow = false;
  cards.receiveShadow = false;
  cards.frustumCulled = false;
  cards.computeBoundingSphere();
  group.add(cards);

  return { group, cards, trunk };
}

export interface CanopyCardSpec {
  x: number;
  y: number;
  z: number;
  /** 卡片世界尺寸（米） */
  scale: number;
  yaw: number;
  tilt?: number;
  /** 单张卡片染色，用于近中远景深 */
  tint?: number;
}

export interface CanopyBatchOptions {
  name: string;
  texture?: CanopyTextureOptions;
  alphaTest?: number;
  time?: WindTime;
  sway?: number;
}

/**
 * 一批卡片合并成 1 个 InstancedMesh：街道 4 棵树共 28 张卡片只占 1 个 draw call。
 * 卡片位置由调用方给出，方便与既有树干 / 树池对齐。
 */
export function createCanopyCardBatch(specs: CanopyCardSpec[], options: CanopyBatchOptions): THREE.InstancedMesh {
  const texture = getCanopyTexture({ size: 1024, ...options.texture });
  const material = createCanopyCardMaterial({
    map: texture,
    alphaTest: options.alphaTest ?? 0.45,
    time: options.time,
    sway: options.sway ?? 0.035,
  });
  const mesh = new THREE.InstancedMesh(CARD_GEOMETRY, material, Math.max(1, specs.length));
  bindInstanceRelease(mesh, material);
  mesh.name = options.name;
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  specs.forEach((spec, index) => {
    transform.position.set(spec.x, spec.y, spec.z);
    transform.rotation.set((spec.tilt ?? 0) * 0.6, spec.yaw, spec.tilt ?? 0);
    transform.scale.set(spec.scale, spec.scale * 1.08, spec.scale);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.setColorAt(index, color.setHex(spec.tint ?? 0xffffff));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * 创建归属单次 build 独立拥有的枝叶卡片批次（不打 sharedResource、不入全局缓存）：
 * 与 street/building 共用同一套枝干骨架+楔形破形枝+四层叶簇绘制算法及动态风摆着色器，
 * 贴图与实例缓冲随材质/几何 dispose 一并释放，满足食堂等独立生命周期场景的零泄漏契约。
 */
export function createOwnedCanopyCardBatch(
  specs: CanopyCardSpec[],
  options: CanopyBatchOptions,
): THREE.InstancedMesh {
  const spec: CanopySpec = {
    size: Math.max(128, Math.round(options.texture?.size ?? 1024)),
    seed: options.texture?.seed ?? 5,
    mode: options.texture?.mode ?? 'mass',
    holeRatio: options.texture?.holeRatio ?? 0.11,
    density: options.texture?.density ?? 0.92,
    edgeFeather: options.texture?.edgeFeather ?? 0.015,
    threshold: options.texture?.threshold ?? 112,
    aniso: options.texture?.aniso ?? 8,
    inset: options.texture?.inset ?? 0.045,
    lean: options.texture?.lean ?? -1,
  };
  let texture: THREE.Texture;
  if (canvasAvailable()) {
    texture = paintCanopyTexture(spec);
  } else {
    texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    texture.needsUpdate = true;
  }
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = createCanopyCardMaterial({
    map: texture,
    alphaTest: options.alphaTest ?? 0.45,
    time: options.time,
    sway: options.sway ?? 0.075,
  });
  const releaseTexture = (): void => {
    texture.dispose();
    material.removeEventListener('dispose', releaseTexture);
  };
  material.addEventListener('dispose', releaseTexture);
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, specs.length));
  bindInstanceRelease(mesh, material);
  mesh.name = options.name;
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  specs.forEach((item, index) => {
    transform.position.set(item.x, item.y, item.z);
    transform.rotation.set((item.tilt ?? 0) * 0.6, item.yaw, item.tilt ?? 0);
    transform.scale.set(item.scale, item.scale * 1.08, item.scale);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.setColorAt(index, color.setHex(item.tint ?? 0xffffff));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.computeBoundingSphere();
  return mesh;
}

/** 只给测试与热重载用：释放缓存贴图 */
export function disposeCanopyTextures(): void {
  for (const texture of textureCache.values()) texture.dispose();
  textureCache.clear();
}

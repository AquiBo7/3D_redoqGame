// scenes3d/streetShops.ts —— 街道 S4 九处场景专项改造（实验楼、校园钟楼地标、校门口奶茶店及六家烟火气临街店铺）
// 模块化独立封装，统一控制 DrawCall 与资源释放（随 levelGroup 清理，不泄漏）。

import * as THREE from 'three';
import { createMatteMaterial, createTextSign } from './shared';
import type { BoxSize, Vec3 } from './shared';
import { createContactShadowDiscBatch, getFacadeBrickMaterial, getFacadeWindowMaterial, getPlasterMaterial } from './materials';
import { SHARED_RESOURCE_FLAG } from '../world/resources';

export interface AnimatedSteamPuff {
  mesh: THREE.Mesh;
  baseX: number;
  baseY: number;
  baseZ: number;
  phase: number;
  riseHeight: number;
  speed: number;
  baseScale: number;
  kind: 'steam' | 'fountain';
}

export interface StreetShopLightSpec {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  distance: number;
  decay?: number;
}

export interface ShopBuildContext {
  parent: THREE.Object3D;
  occluders: THREE.Object3D[];
  animatedPuffs: AnimatedSteamPuff[];
  registerNightMaterial?: (material: THREE.MeshStandardMaterial, dayEmissive?: number, nightEmissive?: number) => void;
  registerShopLight?: (spec: StreetShopLightSpec) => void;
}

interface BoxPart {
  position: Vec3;
  scale: BoxSize | Vec3;
  rotation?: Vec3;
  color: number;
}

function toVec3Scale(s: BoxSize | Vec3): Vec3 {
  if ('w' in s) return { x: s.w, y: s.h, z: s.d };
  return s;
}

function bindInstancedDispose(geometry: THREE.BufferGeometry, mesh: THREE.InstancedMesh): void {
  const release = (): void => {
    mesh.dispose();
    geometry.removeEventListener('dispose', release);
  };
  geometry.addEventListener('dispose', release);
}

/** 将大批同构异色几何合批为单个 InstancedMesh，控制 DrawCall */
function buildColoredBatch(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  items: BoxPart[],
  castShadow = false,
): THREE.InstancedMesh | null {
  if (items.length === 0) {
    geometry.dispose();
    return null;
  }
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const t = new THREE.Object3D();
  const c = new THREE.Color();
  items.forEach((item, idx) => {
    const sc = toVec3Scale(item.scale);
    t.position.set(item.position.x, item.position.y, item.position.z);
    t.scale.set(sc.x, sc.y, sc.z);
    const r = item.rotation ?? { x: 0, y: 0, z: 0 };
    t.rotation.set(r.x, r.y, r.z);
    t.updateMatrix();
    mesh.setMatrixAt(idx, t.matrix);
    mesh.setColorAt(idx, c.setHex(item.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  bindInstancedDispose(geometry, mesh);
  parent.add(mesh);
  return mesh;
}

/** 生成简易 2D 图标/海报/价目牌贴图牌 */
function createPosterMesh(
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  emissiveHex?: number,
  emissiveIntensity = 0.25,
): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(128, Math.round(width * 256));
  canvas.height = Math.max(128, Math.round(height * 256));
  const ctx = canvas.getContext('2d');
  if (ctx) paint(ctx, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.86,
    metalness: 0.02,
    ...(ctx ? { map: texture } : {}),
  });
  if (!ctx) texture.dispose();
  if (emissiveHex !== undefined && ctx) {
    mat.emissive.setHex(emissiveHex);
    mat.emissiveMap = texture;
    mat.emissiveIntensity = emissiveIntensity;
  }
  mat.addEventListener('dispose', () => texture.dispose());
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  mesh.castShadow = false;
  return mesh;
}

/** 实底色清晰多行/竖排文字牌（避免窄竖板直接拉伸横向贴图） */
function createCleanLabel(
  lines: string[],
  width: number,
  height: number,
  bg: string,
  fg: string,
  border?: string,
  emissiveHex?: number,
): THREE.Mesh {
  return createPosterMesh(
    width,
    height,
    (c, w, h) => {
      c.fillStyle = bg;
      c.fillRect(0, 0, w, h);
      if (border) {
        c.strokeStyle = border;
        c.lineWidth = 6;
        c.strokeRect(4, 4, w - 8, h - 8);
      }
      c.fillStyle = fg;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const step = (h - 20) / lines.length;
      const fontSize = Math.min(step * 0.72, (w - 18) / Math.max(1, ...lines.map((l) => l.length)) * 1.05);
      c.font = `bold ${Math.max(14, Math.floor(fontSize))}px sans-serif`;
      lines.forEach((line, idx) => {
        c.fillText(line, w / 2, 10 + step * (idx + 0.5), w - 16);
      });
    },
    emissiveHex,
    emissiveHex !== undefined ? 0.3 : 0,
  );
}

/** 添加轻量蒸汽团或水花粒子 */
function addAnimatedPuffs(
  ctx: ShopBuildContext,
  origin: Vec3,
  count: number,
  riseHeight: number,
  baseScale: number,
  speed: number,
  kind: 'steam' | 'fountain',
): void {
  const geo = new THREE.SphereGeometry(1, 8, 6);
  const color = kind === 'steam' ? 0xffffff : 0xdbf3ff;
  for (let i = 0; i < count; i += 1) {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: kind === 'steam' ? 0.45 : 0.72,
      depthWrite: false,
    });
    const puff = new THREE.Mesh(geo, mat);
    puff.position.set(origin.x, origin.y, origin.z);
    puff.scale.setScalar(baseScale);
    puff.raycast = () => {};
    ctx.parent.add(puff);
    ctx.animatedPuffs.push({
      mesh: puff,
      baseX: origin.x + (i - (count - 1) / 2) * 0.06,
      baseY: origin.y,
      baseZ: origin.z + ((i % 2) - 0.5) * 0.05,
      phase: (i / count) * Math.PI * 2,
      riseHeight,
      speed,
      baseScale,
      kind,
    });
  }
}

/** 驱动近景蒸汽与喷泉粒子逐帧运动（远距 >24m 自动静默免算，零画质损失） */
export function tickStreetShopAnimations(
  puffs: AnimatedSteamPuff[],
  elapsedSec: number,
  playerX?: number,
  playerZ?: number,
): void {
  const hasPlayer = playerX !== undefined && playerZ !== undefined;
  for (const puff of puffs) {
    if (hasPlayer) {
      const dx = puff.baseX - playerX;
      const dz = puff.baseZ - playerZ;
      if (dx * dx + dz * dz > 576) continue;
    }
    if (puff.kind === 'steam') {
      const t = ((elapsedSec * puff.speed + puff.phase / (Math.PI * 2)) % 1 + 1) % 1;
      puff.mesh.position.set(
        puff.baseX + Math.sin(elapsedSec * 2.1 + puff.phase) * 0.055 * t,
        puff.baseY + t * puff.riseHeight,
        puff.baseZ + Math.cos(elapsedSec * 1.7 + puff.phase) * 0.045 * t,
      );
      const s = puff.baseScale * (0.7 + t * 1.05);
      puff.mesh.scale.set(s * 1.15, s * 0.85, s * 1.15);
      const mat = puff.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.sin(t * Math.PI) * 0.48;
    } else {
      const t = ((elapsedSec * puff.speed + puff.phase / (Math.PI * 2)) % 1 + 1) % 1;
      const arc = 4 * t * (1 - t);
      puff.mesh.position.set(
        puff.baseX + (t - 0.5) * 0.16 * Math.cos(puff.phase),
        puff.baseY + arc * puff.riseHeight,
        puff.baseZ + (t - 0.5) * 0.16 * Math.sin(puff.phase),
      );
      const s = puff.baseScale * (0.65 + arc * 0.55);
      puff.mesh.scale.setScalar(s);
      const mat = puff.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.45 + arc * 0.42;
    }
  }
}

/** 通用门前橱窗背板 + 清透玻璃 + 三层原木/白色展架辅助（搁板单批合批，橱窗点光交由街道近距池统一调度） */
function buildCustomShowcaseShell(
  ctx: ShopBuildContext,
  faceX: number,
  side: number,
  winCenterZ: number,
  bgHex: number,
  shelfHex: number,
  lightHex: number,
  emissiveHex: number,
): void {
  const { parent } = ctx;
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(2.52, 1.56),
    new THREE.MeshStandardMaterial({
      color: bgHex,
      emissive: emissiveHex,
      emissiveIntensity: 0.22,
      roughness: 0.88,
    }),
  );
  back.position.set(faceX + side * 0.055, 1.02, winCenterZ);
  back.rotation.y = side * (Math.PI / 2);
  parent.add(back);

  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.014, 1.52, 2.48),
    new THREE.MeshStandardMaterial({
      color: 0xdff0f4,
      roughness: 0.12,
      metalness: 0.08,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
    }),
  );
  glass.position.set(faceX + side * 0.36, 1.02, winCenterZ);
  glass.renderOrder = 2;
  parent.add(glass);

  buildColoredBatch(
    parent,
    'shop-showcase-shelves',
    new THREE.BoxGeometry(0.28, 0.04, 2.26),
    createMatteMaterial(shelfHex, 0.78),
    [0.54, 0.92, 1.3].map((sy) => ({
      position: { x: faceX + side * 0.19, y: sy, z: winCenterZ },
      scale: { x: 1, y: 1, z: 1 },
      color: 0xffffff,
    })),
  );

  ctx.registerShopLight?.({
    x: faceX + side * 0.75,
    y: 1.48,
    z: winCenterZ,
    color: lightHex,
    intensity: 1.1,
    distance: 3.6,
    decay: 2,
  });
}

/** 雨棚下发光小灯串（复用单个 InstancedMesh） */
function addStringLights(
  parent: THREE.Object3D,
  name: string,
  x: number,
  y: number,
  zStart: number,
  zEnd: number,
  count: number,
  colorHex: number,
): void {
  const geo = new THREE.SphereGeometry(0.028, 6, 5);
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.2,
    roughness: 0.3,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const t = new THREE.Object3D();
  for (let i = 0; i < count; i += 1) {
    const ratio = count <= 1 ? 0.5 : i / (count - 1);
    const sag = Math.sin(ratio * Math.PI) * 0.05;
    t.position.set(x, y - sag, zStart + (zEnd - zStart) * ratio);
    t.updateMatrix();
    mesh.setMatrixAt(i, t.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = name;
  bindInstancedDispose(geo, mesh);
  parent.add(mesh);
}

/** 门前小彩旗串 */
function addBuntingFlags(
  parent: THREE.Object3D,
  name: string,
  x: number,
  y: number,
  zStart: number,
  zEnd: number,
  count: number,
  colors: number[],
): void {
  const items: BoxPart[] = [];
  for (let i = 0; i < count; i += 1) {
    const ratio = count <= 1 ? 0.5 : i / (count - 1);
    const sag = Math.sin(ratio * Math.PI) * 0.06;
    items.push({
      position: { x, y: y - sag, z: zStart + (zEnd - zStart) * ratio },
      scale: { x: 0.015, y: 0.11, z: 0.09 },
      rotation: { x: Math.PI / 4, y: 0, z: 0 },
      color: colors[i % colors.length],
    });
  }
  buildColoredBatch(parent, name, new THREE.BoxGeometry(1, 1, 1), createMatteMaterial(0xffffff, 0.78), items);
}

/* ============================================================================
 * 场景一：豆浆店（晨光豆浆 · BUILDINGS[4]，x=7.12, z=0, side=-1）
 * ========================================================================== */

/** 豆浆主题展示柜：橱窗与门之间，1.2m×0.55m×1.6m，纯装饰不可交互 */
export const SOY_DISPLAY_CABINET = {
  centerZ: 0.2,
  widthZ: 1.2,
  depthX: 0.55,
  heightY: 1.6,
  backGap: 0.05,
  collisionDepth: 0.3,
  matWidthZ: 1.3,
  matDepthX: 0.6,
  matHeight: 0.03,
} as const;

function buildSoyDisplayCabinet(parent: THREE.Object3D, faceX: number, side: number): void {
  const group = new THREE.Group();
  group.name = 'soy-display-cabinet';
  const backX = faceX + side * SOY_DISPLAY_CABINET.backGap;
  const frontX = backX + side * SOY_DISPLAY_CABINET.depthX;
  const midX = backX + side * SOY_DISPLAY_CABINET.depthX / 2;
  const cz = SOY_DISPLAY_CABINET.centerZ;
  const wood = 0x8a5a38;
  const panel = 0xefe6d2;
  const boxes: BoxPart[] = [
    { position: { x: midX, y: 0.275, z: cz }, scale: { x: 0.55, y: 0.55, z: 1.2 }, color: panel },
    { position: { x: midX, y: 1.525, z: cz }, scale: { x: 0.55, y: 0.15, z: 1.2 }, color: wood },
    { position: { x: midX, y: 0.8, z: cz - 0.575 }, scale: { x: 0.55, y: 1.6, z: 0.05 }, color: wood },
    { position: { x: midX, y: 0.8, z: cz + 0.575 }, scale: { x: 0.55, y: 1.6, z: 0.05 }, color: wood },
    { position: { x: backX + side * 0.02, y: 0.8, z: cz }, scale: { x: 0.04, y: 1.6, z: 1.2 }, color: panel },
    { position: { x: midX, y: 0.6, z: cz }, scale: { x: 0.5, y: 0.03, z: 1.1 }, color: wood },
    { position: { x: midX, y: 0.9, z: cz }, scale: { x: 0.5, y: 0.03, z: 1.1 }, color: wood },
    { position: { x: midX, y: 1.2, z: cz }, scale: { x: 0.5, y: 0.03, z: 1.1 }, color: wood },
    // 台面黄豆篮
    { position: { x: midX, y: 1.65, z: cz + 0.32 }, scale: { x: 0.18, y: 0.1, z: 0.18 }, color: 0xc2985b },
    // 柜前地垫 1.3m×0.6m×0.03m
    { position: { x: frontX + side * 0.3, y: 0.015, z: cz }, scale: { x: 0.6, y: 0.03, z: 1.3 }, color: 0x7a5a42 },
    // 局部加宽人行道 apron，保证柜前净宽 ≥0.9m
    { position: { x: frontX + side * 0.45, y: 0.005, z: cz }, scale: { x: 0.92, y: 0.01, z: 2.0 }, color: 0x9a958a },
  ];
  const cyls: BoxPart[] = [];
  const spheres: BoxPart[] = [];
  const goodsX = backX + side * 0.3;
  // 下层 3 杯豆浆
  for (const gz of [-0.25, 0, 0.25]) {
    cyls.push({ position: { x: goodsX, y: 0.68, z: cz + gz }, scale: { x: 0.045, y: 0.12, z: 0.045 }, color: 0xfefaf0 });
  }
  // 中层 2 瓶豆浆 + 1 袋豆浆
  for (const gz of [-0.3, 0]) {
    cyls.push({ position: { x: goodsX, y: 1.0, z: cz + gz }, scale: { x: 0.04, y: 0.2, z: 0.04 }, color: 0xf6e7c8 });
  }
  boxes.push({ position: { x: goodsX, y: 0.98, z: cz + 0.3 }, scale: { x: 0.12, y: 0.16, z: 0.08 }, color: 0xe5b84b });
  // 上层 1 纸盒豆奶 + 1 碗豆花 + 豆浆油条套餐
  boxes.push({ position: { x: goodsX, y: 1.29, z: cz - 0.3 }, scale: { x: 0.1, y: 0.18, z: 0.1 }, color: 0xf2f0e8 });
  cyls.push({ position: { x: goodsX, y: 1.26, z: cz }, scale: { x: 0.06, y: 0.06, z: 0.06 }, color: 0xf8f6f0 });
  cyls.push({ position: { x: goodsX, y: 1.28, z: cz + 0.3 }, scale: { x: 0.04, y: 0.12, z: 0.04 }, color: 0xfefaf0 });
  cyls.push({ position: { x: goodsX + side * 0.05, y: 1.3, z: cz + 0.34 }, scale: { x: 0.018, y: 0.2, z: 0.018 }, rotation: { x: 0.4, y: 0, z: 0.2 }, color: 0xe3a038 });
  // 黄豆篮里的黄豆
  for (let i = 0; i < 5; i += 1) {
    spheres.push({ position: { x: midX + (i % 2 === 0 ? -0.04 : 0.04), y: 1.72, z: cz + 0.28 + i * 0.02 }, scale: { x: 0.025, y: 0.025, z: 0.025 }, color: 0xe5b84b });
  }
  const opaqueMaterial = createMatteMaterial(0xffffff, 0.8);
  opaqueMaterial.emissive.setHex(0xffe3b0);
  opaqueMaterial.emissiveIntensity = 1.2;
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);
  const sphereGeometry = new THREE.SphereGeometry(1, 8, 6);
  for (const geometry of [boxGeometry, cylinderGeometry, sphereGeometry]) {
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, 0.25, 0.75);
  }
  buildColoredBatch(group, 'soy-cabinet-boxes', boxGeometry, opaqueMaterial, boxes, true);
  buildColoredBatch(group, 'soy-cabinet-cyls', cylinderGeometry, opaqueMaterial, cyls, true);
  buildColoredBatch(group, 'soy-cabinet-spheres', sphereGeometry, opaqueMaterial, spheres, true);

  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.014, 0.9, 1.14),
    new THREE.MeshStandardMaterial({
      color: 0xdfe8ea,
      roughness: 0.12,
      metalness: 0.08,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
  );
  glass.name = 'soy-cabinet-glass';
  glass.position.set(frontX, 1.0, cz);
  glass.renderOrder = 2;
  group.add(glass);

  const stripGeometry = new THREE.BoxGeometry(0.03, 0.03, 1.1);
  const stripUv = stripGeometry.getAttribute('uv');
  for (let i = 0; i < stripUv.count; i += 1) stripUv.setXY(i, 0.75, 0.75);
  const strip = new THREE.Mesh(stripGeometry, opaqueMaterial);
  strip.name = 'soy-cabinet-light-strip';
  strip.position.set(frontX + side * 0.03, 1.44, cz);
  group.add(strip);

  const priceTag = createTextSign('现磨豆浆 3 元 / 杯', 0.5, 0.18, {
    background: '#fff8ec',
    foreground: '#4d3523',
    resolution: 256,
  });
  const priceMaterial = priceTag.material as THREE.MeshStandardMaterial;
  const colorAtlas = document.createElement('canvas');
  colorAtlas.width = 128;
  colorAtlas.height = 128;
  const colorContext = colorAtlas.getContext('2d');
  if (colorContext) {
    colorContext.fillStyle = '#ffffff';
    colorContext.fillRect(0, 0, 128, 128);
    colorContext.drawImage(priceMaterial.map!.image as CanvasImageSource, 0, 64, 128, 64);
  }
  const emissionAtlas = document.createElement('canvas');
  emissionAtlas.width = 16;
  emissionAtlas.height = 16;
  const emissionContext = emissionAtlas.getContext('2d');
  if (emissionContext) {
    emissionContext.fillStyle = '#000000';
    emissionContext.fillRect(0, 0, 16, 16);
    emissionContext.fillStyle = '#ffffff';
    emissionContext.fillRect(8, 0, 8, 8);
  }
  const colorMap = new THREE.CanvasTexture(colorAtlas);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  const emissionMap = new THREE.CanvasTexture(emissionAtlas);
  opaqueMaterial.map = colorMap;
  opaqueMaterial.emissiveMap = emissionMap;
  const releaseTextures = (): void => {
    colorMap.dispose();
    emissionMap.dispose();
    opaqueMaterial.removeEventListener('dispose', releaseTextures);
  };
  opaqueMaterial.addEventListener('dispose', releaseTextures);
  const priceUv = priceTag.geometry.getAttribute('uv');
  for (let i = 0; i < priceUv.count; i += 1) priceUv.setY(i, priceUv.getY(i) * 0.5);
  priceTag.material = opaqueMaterial;
  priceMaterial.dispose();
  priceTag.name = 'soy-cabinet-price-tag';
  priceTag.position.set(midX, 1.7, cz - 0.3);
  priceTag.rotation.y = side * (Math.PI / 2);
  group.add(priceTag);

  parent.add(group);
}

export function buildSoyMilkDressing(ctx: ShopBuildContext, faceX: number, side: number, centerZ: number): void {
  const { parent } = ctx;
  const winZ = centerZ - 2.3;
  const doorZ = centerZ + 2.6;
  const boxes: BoxPart[] = [];
  const cyls: BoxPart[] = [];
  const spheres: BoxPart[] = [];

  // 1. 橱窗定制：黄豆/绿豆/黑豆/白糖玻璃罐 + 白色纸杯 + 乳白豆浆玻璃杯
  buildCustomShowcaseShell(ctx, faceX, side, winZ, 0xfff0d4, 0xa87c4f, 0xffd28e, 0xffc670);
  const gx = faceX + side * 0.24;
  // 上层 4 只透明玻璃谷物罐（黄豆/绿豆/黑豆/白糖）
  for (const [idx, beanHex] of [0xe5b84b, 0x629e4c, 0x2f3138, 0xfaf7f0].entries()) {
    const gz = winZ - 0.78 + idx * 0.52;
    cyls.push(
      { position: { x: gx, y: 1.4, z: gz }, scale: { x: 0.09, y: 0.17, z: 0.09 }, color: beanHex },
      { position: { x: gx, y: 1.5, z: gz }, scale: { x: 0.096, y: 0.025, z: 0.096 }, color: 0xb67e46 },
    );
  }
  // 中层 3 摞印红字白纸杯 + 4 只盛豆浆玻璃杯
  for (let i = 0; i < 3; i += 1) {
    const cz = winZ - 0.75 + i * 0.35;
    cyls.push(
      { position: { x: gx, y: 1.03, z: cz }, scale: { x: 0.052, y: 0.18, z: 0.052 }, color: 0xf9f6ee },
      { position: { x: gx, y: 1.03, z: cz }, scale: { x: 0.055, y: 0.03, z: 0.055 }, color: 0xc93a2b },
    );
  }
  for (let i = 0; i < 4; i += 1) {
    const gz = winZ + 0.22 + i * 0.25;
    cyls.push({ position: { x: gx, y: 1.01, z: gz }, scale: { x: 0.044, y: 0.13, z: 0.044 }, color: 0xfefaf0 });
  }
  // 下层：豆浆礼盒与豆袋
  for (let i = 0; i < 4; i += 1) {
    boxes.push({ position: { x: gx, y: 0.64, z: winZ - 0.72 + i * 0.48 }, scale: { x: 0.16, y: 0.16, z: 0.24 }, color: i % 2 === 0 ? 0xd99b52 : 0xefe6d0 });
  }

  // 2. 门头副招牌「现磨 · 现煮 · 现炸」、手绘海报、3 个红灯笼、暖黄灯串、铜门把手、红白擦脚垫
  const subSign = createCleanLabel(['现', '磨', '现', '煮', '现', '炸'], 0.34, 0.84, '#f7f1e3', '#c92e25', '#c92e25');
  subSign.position.set(faceX + side * 0.16, 2.86, centerZ - 1.56);
  subSign.rotation.y = side * (Math.PI / 2);
  parent.add(subSign);

  const poster = createPosterMesh(0.56, 0.74, (c, w, h) => {
    c.fillStyle = '#f6ebd5';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#9c422c';
    c.lineWidth = 6;
    c.strokeRect(6, 6, w - 12, h - 12);
    // 豆浆杯
    c.fillStyle = '#fff9ee';
    c.fillRect(w * 0.2, h * 0.26, w * 0.28, h * 0.36);
    c.strokeRect(w * 0.2, h * 0.26, w * 0.28, h * 0.36);
    // 两根油条
    c.fillStyle = '#dfa03b';
    c.fillRect(w * 0.56, h * 0.24, w * 0.12, h * 0.38);
    c.fillRect(w * 0.71, h * 0.27, w * 0.12, h * 0.36);
    c.fillStyle = '#b92c22';
    c.font = 'bold 20px "YT Sans", sans-serif';
    c.textAlign = 'center';
    c.fillText('现磨豆浆 5元续杯', w / 2, h * 0.84);
  });
  poster.position.set(faceX + side * 0.06, 1.52, centerZ - 2.18);
  poster.rotation.y = side * (Math.PI / 2);
  parent.add(poster);

  addStringLights(parent, 'soymilk-string-lights', faceX + side * 0.85, 2.02, centerZ - 1.9, centerZ + 1.8, 12, 0xffd27d);
  for (const lz of [centerZ - 1.35, centerZ + 1.35]) {
    spheres.push({ position: { x: faceX + side * 0.74, y: 1.96, z: lz }, scale: { x: 0.09, y: 0.11, z: 0.09 }, color: 0xd92929 });
    cyls.push({ position: { x: faceX + side * 0.74, y: 1.82, z: lz }, scale: { x: 0.02, y: 0.1, z: 0.02 }, color: 0xe6bc55 });
  }
  // 铜把手与红白格纹擦脚垫
  cyls.push({ position: { x: faceX + side * 0.32, y: 0.98, z: doorZ - 0.32 }, scale: { x: 0.028, y: 0.22, z: 0.028 }, color: 0xc99642 });
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      boxes.push({
        position: { x: faceX + side * (0.45 + r * 0.15), y: 0.068, z: doorZ - 0.3 + c * 0.2 },
        scale: { x: 0.145, y: 0.016, z: 0.195 },
        color: (r + c) % 2 === 0 ? 0xd1493f : 0xf4efe6,
      });
    }
  }

  // 3. 门口左侧：深灰色仿石磨 + 不锈钢大豆浆锅 + 燃气灶红光 + 动态白色蒸汽
  const leftZ = centerZ - 1.65;
  const mx = faceX + side * 0.62;
  // 石磨支架 + 上下磨盘 + 木把手
  boxes.push({ position: { x: mx, y: 0.26, z: leftZ }, scale: { x: 0.44, y: 0.52, z: 0.44 }, color: 0x6f533a });
  cyls.push(
    { position: { x: mx, y: 0.58, z: leftZ }, scale: { x: 0.24, y: 0.12, z: 0.24 }, color: 0x676b6e },
    { position: { x: mx, y: 0.72, z: leftZ }, scale: { x: 0.21, y: 0.13, z: 0.21 }, color: 0x777b7e },
    { position: { x: mx + side * 0.22, y: 0.78, z: leftZ + 0.12 }, scale: { x: 0.024, y: 0.16, z: 0.024 }, color: 0x9c6e44 },
  );
  // 大铝豆浆锅 + 炉灶红光 + 乳白豆浆 + 豆浆勺
  const potZ = centerZ - 0.96;
  boxes.push({ position: { x: mx, y: 0.22, z: potZ }, scale: { x: 0.46, y: 0.44, z: 0.46 }, color: 0x3b4043 });
  cyls.push(
    { position: { x: mx, y: 0.46, z: potZ }, scale: { x: 0.2, y: 0.05, z: 0.2 }, color: 0xd94b2b },
    { position: { x: mx, y: 0.66, z: potZ }, scale: { x: 0.25, y: 0.4, z: 0.25 }, color: 0xd0d6da },
    { position: { x: mx, y: 0.865, z: potZ }, scale: { x: 0.23, y: 0.02, z: 0.23 }, color: 0xfbf7ea },
    { position: { x: mx + side * 0.08, y: 0.96, z: potZ + 0.06 }, scale: { x: 0.015, y: 0.34, z: 0.015 }, rotation: { x: 0.4, y: 0, z: 0.3 }, color: 0xc2c8cc },
  );
  addAnimatedPuffs(ctx, { x: mx, y: 0.92, z: potZ }, 3, 0.72, 0.13, 0.46, 'steam');

  // 4. 门口右侧：三层竹蒸笼 + 油条筐（6 根金黄油条）+ 木托盘（白瓷碗茶壶）+ 价目牌与小黑板
  const rightZ = centerZ + 3.6;
  const rx = faceX + side * 0.62;
  boxes.push({ position: { x: rx, y: 0.34, z: rightZ }, scale: { x: 0.56, y: 0.68, z: 1.04 }, color: 0x8d6745 });
  // 三层竹蒸笼 + 微掀盖露包子
  for (let layer = 0; layer < 3; layer += 1) {
    cyls.push({
      position: { x: rx, y: 0.74 + layer * 0.11, z: rightZ - 0.28 },
      scale: { x: 0.19, y: 0.1, z: 0.19 },
      color: layer % 2 === 0 ? 0xdab276 : 0xcfa465,
    });
  }
  cyls.push({
    position: { x: rx + side * 0.06, y: 1.05, z: rightZ - 0.25 },
    scale: { x: 0.19, y: 0.03, z: 0.19 },
    rotation: { x: 0, y: 0, z: -side * 0.22 },
    color: 0xd4a96a,
  });
  for (const bz of [-0.04, 0.05]) {
    spheres.push({ position: { x: rx, y: 1.02, z: rightZ - 0.28 + bz }, scale: { x: 0.055, y: 0.045, z: 0.055 }, color: 0xfcf9f0 });
  }
  addAnimatedPuffs(ctx, { x: rx, y: 1.08, z: rightZ - 0.28 }, 2, 0.52, 0.1, 0.5, 'steam');

  // 油条筐 + 6 根金黄油条
  boxes.push({ position: { x: rx, y: 0.75, z: rightZ + 0.16 }, scale: { x: 0.34, y: 0.14, z: 0.28 }, color: 0xc2985b });
  for (let y = 0; y < 6; y += 1) {
    cyls.push({
      position: { x: rx + (y % 2 === 0 ? -0.05 : 0.05), y: 0.87, z: rightZ + 0.08 + y * 0.032 },
      scale: { x: 0.022, y: 0.24, z: 0.022 },
      rotation: { x: 0.48, y: 0, z: 0.25 },
      color: 0xe3a038,
    });
  }
  // 白瓷碗摞 + 茶壶
  for (let b = 0; b < 3; b += 1) {
    cyls.push({ position: { x: rx, y: 0.71 + b * 0.035, z: rightZ + 0.42 }, scale: { x: 0.07, y: 0.04, z: 0.07 }, color: 0xf8f6f0 });
  }
  cyls.push({ position: { x: rx - side * 0.1, y: 0.76, z: rightZ + 0.42 }, scale: { x: 0.065, y: 0.12, z: 0.065 }, color: 0xf8f6f0 });

  // 红色手写价目牌 + 粉笔小黑板
  const priceBoard = createPosterMesh(0.46, 0.64, (c, w, h) => {
    c.fillStyle = '#c82d24';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#ffd97a';
    c.lineWidth = 6;
    c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = '#ffe27a';
    c.font = 'bold 26px "YT Sans", sans-serif';
    c.textAlign = 'center';
    c.fillText('早点价目', w / 2, 42);
    c.fillStyle = '#fff9ee';
    c.font = 'bold 20px "YT Sans", sans-serif';
    ['豆浆 2元', '油条 1.5元', '包子 1.5元', '茶叶蛋 1元', '豆腐脑 3元'].forEach((line, i) => {
      c.fillText(line, w / 2, 84 + i * 32);
    });
  });
  priceBoard.position.set(
    faceX + side * (0.82 + 0.032 * Math.cos(0.22)),
    0.56,
    centerZ + 1.95 + 0.032 * Math.sin(0.22),
  );
  priceBoard.rotation.y = side * (Math.PI / 2) - side * 0.22;
  parent.add(priceBoard);
  boxes.push({
    position: { x: faceX + side * 0.82, y: 0.48, z: centerZ + 1.95 },
    scale: { x: 0.06, y: 0.86, z: 0.52 },
    rotation: { x: 0, y: -side * 0.22, z: 0 },
    color: 0x8b5a34,
  });

  const chalkBoard = createPosterMesh(0.44, 0.48, (c, w, h) => {
    c.fillStyle = '#2c3c36';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#9c7146';
    c.lineWidth = 10;
    c.strokeRect(5, 5, w - 10, h - 10);
    c.fillStyle = '#ffd87a';
    c.font = 'bold 22px "YT Sans", sans-serif';
    c.textAlign = 'center';
    c.fillText('今日特价', w / 2, 46);
    c.fillStyle = '#ffffff';
    c.font = '20px "YT Sans", sans-serif';
    c.fillText('豆浆 + 油条', w / 2, 86);
    c.fillText('5元套餐', w / 2, 118);
  });
  chalkBoard.position.set(faceX + side * 0.06, 1.38, centerZ + 1.42);
  chalkBoard.rotation.y = side * (Math.PI / 2);
  parent.add(chalkBoard);

  buildColoredBatch(parent, 'soymilk-boxes', new THREE.BoxGeometry(1, 1, 1), createMatteMaterial(0xffffff, 0.78), boxes, true);
  buildColoredBatch(parent, 'soymilk-cyls', new THREE.CylinderGeometry(1, 1, 1, 12), createMatteMaterial(0xffffff, 0.7), cyls, true);
  buildColoredBatch(parent, 'soymilk-spheres', new THREE.SphereGeometry(1, 10, 8), createMatteMaterial(0xffffff, 0.75), spheres, true);

  // 5. 橱窗与门之间的豆浆主题展示柜（纯装饰，不新增实时点光）
  buildSoyDisplayCabinet(parent, faceX, side);

  const contacts = createContactShadowDiscBatch('soymilk-contacts', [
    { x: mx, z: leftZ, radius: 0.36, y: 0.065 },
    { x: mx, z: potZ, radius: 0.36, y: 0.065 },
    { x: rx, z: rightZ, radius: 0.55, y: 0.065 },
  ]);
  if (contacts) parent.add(contacts);
}

/* ============================================================================
 * 场景二：包子早餐店（清晨早餐铺 · BUILDINGS[1]，x=-7.24, z=-6, side=+1）
 * ========================================================================== */
export function buildBaoziShopDressing(ctx: ShopBuildContext, faceX: number, side: number, centerZ: number): void {
  const { parent } = ctx;
  const winZ = centerZ - 0.65;
  const doorZ = centerZ + 1.28;
  const boxes: BoxPart[] = [];
  const cyls: BoxPart[] = [];
  const spheres: BoxPart[] = [];

  // 1. 橱窗定制：小白色蒸笼 + 金黄油条 + 茶叶蛋盘 + 豆浆杯
  buildCustomShowcaseShell(ctx, faceX, side, winZ, 0xfff1d8, 0xb88b58, 0xffd088, 0xffc46b);
  const gx = faceX + side * 0.24;
  for (let i = 0; i < 4; i += 1) {
    const z = winZ - 0.75 + i * 0.5;
    cyls.push(
      { position: { x: gx, y: 1.38, z }, scale: { x: 0.11, y: 0.1, z: 0.11 }, color: 0xe6c78c },
      { position: { x: gx, y: 1.48, z }, scale: { x: 0.11, y: 0.08, z: 0.11 }, color: 0xebd09a },
    );
    // 中层油条与茶叶蛋盘
    cyls.push({ position: { x: gx, y: 0.96, z }, scale: { x: 0.12, y: 0.02, z: 0.12 }, color: 0xf7f4ec });
    spheres.push(
      { position: { x: gx, y: 0.99, z: z - 0.04 }, scale: { x: 0.036, y: 0.044, z: 0.036 }, color: 0xa6693a },
      { position: { x: gx, y: 0.99, z: z + 0.04 }, scale: { x: 0.036, y: 0.044, z: 0.036 }, color: 0x9b5f32 },
    );
    // 下层豆浆杯
    cyls.push({ position: { x: gx, y: 0.62, z }, scale: { x: 0.046, y: 0.14, z: 0.046 }, color: 0xfdf9ee });
  }

  // 2. 圆形微笑包子 LOGO 灯箱 + 红色竖幅「手工现包 · 皮薄馅大」+ 彩旗串 + 防滑垫/扫帚/红桶
  const logoDisc = createPosterMesh(0.54, 0.54, (c, w, h) => {
    c.fillStyle = '#fff9eb';
    c.beginPath();
    c.arc(w / 2, h / 2, w * 0.46, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#9c4b2c';
    c.lineWidth = 8;
    c.stroke();
    // 卡通微笑包子
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(w / 2, h * 0.58, w * 0.25, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#5a3a22';
    c.lineWidth = 5;
    c.stroke();
    c.fillStyle = '#2c221b';
    c.beginPath();
    c.arc(w * 0.42, h * 0.56, 5, 0, Math.PI * 2);
    c.arc(w * 0.58, h * 0.56, 5, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(w / 2, h * 0.61, 12, 0.2, Math.PI - 0.2);
    c.stroke();
  }, 0xffd592, 0.35);
  logoDisc.position.set(faceX + side * 0.24, 2.58, centerZ - 1.48);
  logoDisc.rotation.y = side * (Math.PI / 2);
  parent.add(logoDisc);

  const banner = createTextSign('手工现包·皮薄馅大', 0.36, 1.15, {
    background: '#c92f26',
    foreground: '#fff4d6',
    resolution: 256,
  });
  banner.position.set(faceX + side * 0.06, 1.42, centerZ - 2.15);
  banner.rotation.y = side * (Math.PI / 2);
  parent.add(banner);

  addBuntingFlags(parent, 'baozi-bunting', faceX + side * 0.87, 1.98, centerZ - 1.9, centerZ + 1.8, 12, [0xd8352b, 0xfaf5eb]);
  boxes.push({ position: { x: faceX + side * 0.56, y: 0.068, z: doorZ }, scale: { x: 0.48, y: 0.016, z: 0.9 }, color: 0x373c3f });
  // 竹扫帚与红塑料桶
  cyls.push(
    { position: { x: faceX + side * 0.24, y: 0.52, z: doorZ + 0.72 }, scale: { x: 0.016, y: 1.0, z: 0.016 }, rotation: { x: 0.14, y: 0, z: 0 }, color: 0x9c7242 },
    { position: { x: faceX + side * 0.24, y: 0.14, z: doorZ + 0.79 }, scale: { x: 0.09, y: 0.24, z: 0.04 }, color: 0xc99c58 },
    { position: { x: faceX + side * 0.36, y: 0.19, z: doorZ + 0.96 }, scale: { x: 0.13, y: 0.26, z: 0.13 }, color: 0xd9352b },
  );

  // 3. 门口核心摆件：四层高大竹蒸笼 + 浓密翻滚白汽 + 咬开包子
  const sz = centerZ - 1.25;
  const sx = faceX + side * 0.64;
  boxes.push({ position: { x: sx, y: 0.26, z: sz }, scale: { x: 0.58, y: 0.52, z: 0.58 }, color: 0x563d2c });
  cyls.push({ position: { x: sx, y: 0.53, z: sz }, scale: { x: 0.24, y: 0.04, z: 0.24 }, color: 0xe3542e });
  for (let layer = 0; layer < 4; layer += 1) {
    const r = 0.26 - layer * 0.014;
    cyls.push({
      position: { x: sx, y: 0.62 + layer * 0.135, z: sz },
      scale: { x: r, y: 0.125, z: r },
      color: layer % 2 === 0 ? 0xd9ae6e : 0xc99c59,
    });
  }
  // 顶层半开笼盖 + 4 个白胖包子（含 1 个咬开肉馅）
  cyls.push({
    position: { x: sx - side * 0.09, y: 1.13, z: sz - 0.08 },
    scale: { x: 0.22, y: 0.03, z: 0.22 },
    rotation: { x: 0.22, y: 0, z: side * 0.24 },
    color: 0xd9ae6e,
  });
  for (const [bx, bz, bitten] of [
    [0.06, 0.04, false],
    [-0.06, 0.06, false],
    [0.02, -0.07, false],
    [0.09, -0.04, true],
  ] as const) {
    spheres.push({
      position: { x: sx + bx, y: 1.11, z: sz + bz },
      scale: { x: 0.062, y: 0.048, z: 0.062 },
      color: 0xfcf9f0,
    });
    if (bitten) {
      spheres.push({ position: { x: sx + bx + 0.035, y: 1.115, z: sz + bz }, scale: { x: 0.028, y: 0.028, z: 0.028 }, color: 0x9b4432 });
    }
  }
  addAnimatedPuffs(ctx, { x: sx, y: 1.16, z: sz }, 5, 0.92, 0.15, 0.56, 'steam');

  // 4. 明档木纹案板操作台（擀面杖 + 面团 + 包子皮 + 肉馅碗 + 「面粉」袋 + 小秤）+ 保温桶 + 菜单黑板
  const tableZ = centerZ - 0.1;
  boxes.push({ position: { x: sx, y: 0.4, z: tableZ }, scale: { x: 0.54, y: 0.8, z: 1.1 }, color: 0xc29864 });
  cyls.push({ position: { x: sx + side * 0.08, y: 0.825, z: tableZ - 0.22 }, scale: { x: 0.024, y: 0.34, z: 0.024 }, rotation: { x: Math.PI / 2, y: 0.25, z: 0 }, color: 0xdfb67c });
  spheres.push(
    { position: { x: sx - side * 0.06, y: 0.84, z: tableZ - 0.02 }, scale: { x: 0.1, y: 0.06, z: 0.1 }, color: 0xfdfaf2 },
    { position: { x: sx + side * 0.08, y: 0.81, z: tableZ + 0.15 }, scale: { x: 0.06, y: 0.012, z: 0.06 }, color: 0xfefcf5 },
    { position: { x: sx + side * 0.08, y: 0.81, z: tableZ + 0.28 }, scale: { x: 0.06, y: 0.012, z: 0.06 }, color: 0xfefcf5 },
  );
  cyls.push({ position: { x: sx - side * 0.08, y: 0.84, z: tableZ + 0.38 }, scale: { x: 0.085, y: 0.06, z: 0.085 }, color: 0xa44535 });
  // 白色面粉袋 + 免费茶水/豆浆保温桶
  boxes.push({ position: { x: sx, y: 0.24, z: tableZ + 0.72 }, scale: { x: 0.34, y: 0.48, z: 0.28 }, color: 0xf4f0e6 });
  cyls.push({ position: { x: sx, y: 0.45, z: doorZ - 0.64 }, scale: { x: 0.16, y: 0.56, z: 0.16 }, color: 0xf2eee4 });

  const menuBoard = createPosterMesh(0.46, 0.62, (c, w, h) => {
    c.fillStyle = '#26332e';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#a87645';
    c.lineWidth = 8;
    c.strokeRect(4, 4, w - 8, h - 8);
    c.fillStyle = '#ffe082';
    c.font = 'bold 24px "YT Sans", sans-serif';
    c.textAlign = 'center';
    c.fillText('鲜肉包 2元', w / 2, 54);
    c.fillText('豆沙包 1.5元', w / 2, 94);
    c.fillText('小笼包 8元一笼', w / 2, 134);
    c.fillStyle = '#ff7b6b';
    c.font = 'bold 19px "YT Sans", sans-serif';
    c.fillText('买五个送豆浆', w / 2, 182);
  });
  menuBoard.position.set(faceX + side * 0.85, 0.62, centerZ + 2.08);
  menuBoard.rotation.y = side * (Math.PI / 2) - side * 0.24;
  parent.add(menuBoard);

  buildColoredBatch(parent, 'baozi-boxes', new THREE.BoxGeometry(1, 1, 1), createMatteMaterial(0xffffff, 0.8), boxes, true);
  buildColoredBatch(parent, 'baozi-cyls', new THREE.CylinderGeometry(1, 1, 1, 12), createMatteMaterial(0xffffff, 0.74), cyls, true);
  buildColoredBatch(parent, 'baozi-spheres', new THREE.SphereGeometry(1, 10, 8), createMatteMaterial(0xffffff, 0.76), spheres, true);

  const contacts = createContactShadowDiscBatch('baozi-contacts', [
    { x: sx, z: sz, radius: 0.42, y: 0.065 },
    { x: sx, z: tableZ, radius: 0.58, y: 0.065 },
  ]);
  if (contacts) parent.add(contacts);
}

/* ============================================================================
 * 场景三：图书馆（校园书屋 · BUILDINGS[5]，x=7.02, z=-12, side=-1）
 * ========================================================================== */
export function buildLibraryDressing(ctx: ShopBuildContext, faceX: number, side: number, centerZ: number): void {
  const { parent } = ctx;
  const winZ = centerZ - 0.65;
  const doorZ = centerZ + 1.28;
  const boxes: BoxPart[] = [];
  const cyls: BoxPart[] = [];
  const spheres: BoxPart[] = [];

  // 1. 橱窗定制：满墙书籍 + 3 本封面朝外推荐书 + 迷你暖光小台灯
  buildCustomShowcaseShell(ctx, faceX, side, winZ, 0xf2e4cc, 0x9c7246, 0xffd288, 0xffc670);
  const gx = faceX + side * 0.22;
  const spineColors = [0x3d6685, 0xc26548, 0x4c825d, 0xd8a846, 0x7b5e85, 0xa84848, 0x5c8585];
  for (const [rIdx, sy] of [0.56, 0.94, 1.32].entries()) {
    for (let b = 0; b < 20; b += 1) {
      if (rIdx === 1 && b >= 7 && b <= 12) continue;
      boxes.push({
        position: { x: gx, y: sy + 0.11, z: winZ - 0.98 + b * 0.102 },
        scale: { x: 0.14, y: 0.18 + ((b + rIdx) % 3) * 0.022, z: 0.072 },
        color: spineColors[(b + rIdx * 2) % spineColors.length],
      });
    }
  }
  // 中层“店员推荐”3本正面展示书 + 迷你台灯
  for (let i = 0; i < 3; i += 1) {
    boxes.push({
      position: { x: gx + side * 0.02, y: 1.05, z: winZ - 0.2 + i * 0.22 },
      scale: { x: 0.03, y: 0.22, z: 0.16 },
      rotation: { x: 0, y: 0, z: side * 0.14 },
      color: spineColors[i],
    });
  }
  cyls.push({ position: { x: gx, y: 1.08, z: winZ + 0.44 }, scale: { x: 0.07, y: 0.1, z: 0.07 }, color: 0xffdf96 });

  // 2. 门头烫金副标「LIBRARY · 阅读·自习·借阅」挂在雨棚前缘 + 竖牌「24小时自习室」+ 暖黄灯串 + 「静」木牌 + 擦脚垫 + 雨伞
  const libSub = createTextSign('LIBRARY · 阅读 · 自习 · 借阅', 2.2, 0.18, {
    background: '#2b3b36',
    foreground: '#f2ce7c',
    resolution: 256,
  });
  libSub.position.set(faceX + side * 0.94, 2.23, centerZ - 0.06);
  libSub.rotation.y = side * (Math.PI / 2);
  parent.add(libSub);

  const studySign = createCleanLabel(['24', '小', '时', '自', '习', '室'], 0.34, 0.84, '#f5f8fc', '#235a9a', '#235a9a');
  studySign.position.set(faceX + side * 0.16, 2.86, centerZ - 1.52);
  studySign.rotation.y = side * (Math.PI / 2);
  parent.add(studySign);

  addStringLights(parent, 'library-string-lights', faceX + side * 0.85, 2.02, centerZ - 1.9, centerZ + 1.8, 12, 0xffd584);

  const quietSign = createPosterMesh(0.32, 0.32, (c, w, h) => {
    c.fillStyle = '#e5cfa8';
    c.beginPath();
    c.arc(w / 2, h / 2, w * 0.46, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#5c4128';
    c.lineWidth = 6;
    c.stroke();
    c.fillStyle = '#2a221c';
    c.font = 'bold 54px "YT Serif", serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('静', w / 2, h / 2 + 4);
  });
  quietSign.position.set(faceX + side * 0.31, 1.56, doorZ);
  quietSign.rotation.y = side * (Math.PI / 2);
  parent.add(quietSign);

  const quietTip = createTextSign('请保持安静·手机静音', 0.56, 0.24, {
    background: '#f4efe2',
    foreground: '#2d3733',
    resolution: 256,
  });
  quietTip.position.set(faceX + side * 0.06, 1.32, doorZ + 0.72);
  quietTip.rotation.y = side * (Math.PI / 2);
  parent.add(quietTip);

  cyls.push({ position: { x: faceX + side * 0.32, y: 0.98, z: doorZ - 0.32 }, scale: { x: 0.025, y: 0.22, z: 0.025 }, color: 0xd2a854 });
  boxes.push({ position: { x: faceX + side * 0.52, y: 0.068, z: doorZ }, scale: { x: 0.48, y: 0.016, z: 0.9 }, color: 0x3b4245 });
  // 收拢透明雨伞
  cyls.push({ position: { x: faceX + side * 0.22, y: 0.44, z: doorZ + 0.62 }, scale: { x: 0.032, y: 0.76, z: 0.032 }, rotation: { x: -0.15, y: 0, z: 0 }, color: 0xcfe4ec });

  // 3. 门左侧：木质露天三层书架 + 垂吊绿植 + 陶土盆栽
  const sx = faceX + side * 0.56;
  const shelfZ = centerZ - 1.55;
  boxes.push(
    { position: { x: sx, y: 0.64, z: shelfZ }, scale: { x: 0.34, y: 1.24, z: 0.04 }, color: 0xa67c52 },
    { position: { x: sx, y: 0.64, z: shelfZ - 0.86 }, scale: { x: 0.34, y: 1.24, z: 0.04 }, color: 0xa67c52 },
  );
  for (const sy of [0.22, 0.58, 0.94, 1.24]) {
    boxes.push({ position: { x: sx, y: sy, z: shelfZ - 0.43 }, scale: { x: 0.34, y: 0.04, z: 0.86 }, color: 0xb4895d });
    if (sy < 1.2) {
      for (let b = 0; b < 8; b += 1) {
        boxes.push({
          position: { x: sx, y: sy + 0.12, z: shelfZ - 0.76 + b * 0.095 },
          scale: { x: 0.16, y: 0.2, z: 0.065 },
          rotation: { x: b === 6 ? 0.22 : 0, y: 0, z: 0 },
          color: spineColors[(b + Math.round(sy * 10)) % spineColors.length],
        });
      }
    }
  }
  cyls.push({ position: { x: sx, y: 1.34, z: shelfZ - 0.43 }, scale: { x: 0.1, y: 0.16, z: 0.1 }, color: 0xb86b4a });
  spheres.push(
    { position: { x: sx, y: 1.48, z: shelfZ - 0.43 }, scale: { x: 0.15, y: 0.13, z: 0.15 }, color: 0x4c7a49 },
    { position: { x: sx + side * 0.12, y: 1.34, z: shelfZ - 0.36 }, scale: { x: 0.07, y: 0.14, z: 0.07 }, color: 0x568a52 },
  );

  // 4. 门右侧：带轮木质图书推车 + 木纹阅读长椅（软坐垫 + 摊开书 + 热饮杯）+ 复古落地阅读灯
  const cartZ = centerZ + 0.18;
  boxes.push(
    { position: { x: sx, y: 0.24, z: cartZ }, scale: { x: 0.42, y: 0.04, z: 0.68 }, color: 0xb3875a },
    { position: { x: sx, y: 0.68, z: cartZ }, scale: { x: 0.42, y: 0.04, z: 0.68 }, color: 0xb3875a },
    { position: { x: sx, y: 0.46, z: cartZ - 0.32 }, scale: { x: 0.42, y: 0.76, z: 0.04 }, color: 0x9c7146 },
  );
  for (let b = 0; b < 5; b += 1) {
    boxes.push({ position: { x: sx, y: 0.73 + b * 0.036, z: cartZ - 0.08 }, scale: { x: 0.22, y: 0.032, z: 0.18 }, color: spineColors[b] });
  }
  // 摊开书本
  boxes.push({ position: { x: sx, y: 0.73, z: cartZ + 0.18 }, scale: { x: 0.24, y: 0.02, z: 0.18 }, color: 0xfbf7ee });

  // 阅读长椅 + 落地阅读灯
  const benchZ = centerZ + 2.15;
  boxes.push(
    { position: { x: sx, y: 0.42, z: benchZ }, scale: { x: 0.44, y: 0.06, z: 1.06 }, color: 0xb4885c },
    { position: { x: sx, y: 0.46, z: benchZ }, scale: { x: 0.38, y: 0.04, z: 0.96 }, color: 0x456958 },
    { position: { x: sx, y: 0.21, z: benchZ - 0.44 }, scale: { x: 0.36, y: 0.42, z: 0.06 }, color: 0x8f6640 },
    { position: { x: sx, y: 0.21, z: benchZ + 0.44 }, scale: { x: 0.36, y: 0.42, z: 0.06 }, color: 0x8f6640 },
    { position: { x: sx, y: 0.5, z: benchZ - 0.14 }, scale: { x: 0.2, y: 0.025, z: 0.16 }, color: 0xfbf6ea },
  );
  cyls.push(
    { position: { x: sx, y: 0.53, z: benchZ + 0.2 }, scale: { x: 0.04, y: 0.09, z: 0.04 }, color: 0xf2ece0 },
    { position: { x: sx, y: 0.92, z: benchZ + 0.65 }, scale: { x: 0.022, y: 1.72, z: 0.022 }, color: 0x262b2e },
    { position: { x: sx, y: 0.08, z: benchZ + 0.65 }, scale: { x: 0.16, y: 0.03, z: 0.16 }, color: 0x262b2e },
    { position: { x: sx + side * 0.08, y: 1.72, z: benchZ + 0.65 }, scale: { x: 0.15, y: 0.22, z: 0.15 }, color: 0xffd98a },
  );
  addAnimatedPuffs(ctx, { x: sx, y: 0.6, z: benchZ + 0.2 }, 2, 0.35, 0.05, 0.4, 'steam');
  ctx.registerShopLight?.({
    x: sx + side * 0.15,
    y: 1.62,
    z: benchZ + 0.55,
    color: 0xffcb78,
    intensity: 1.35,
    distance: 3.8,
    decay: 2,
  });

  buildColoredBatch(parent, 'library-boxes', new THREE.BoxGeometry(1, 1, 1), createMatteMaterial(0xffffff, 0.8), boxes, true);
  buildColoredBatch(parent, 'library-cyls', new THREE.CylinderGeometry(1, 1, 1, 12), createMatteMaterial(0xffffff, 0.72), cyls, true);
  buildColoredBatch(parent, 'library-spheres', new THREE.SphereGeometry(1, 10, 8), createMatteMaterial(0xffffff, 0.84), spheres, true);

  const contacts = createContactShadowDiscBatch('library-contacts', [
    { x: sx, z: shelfZ - 0.43, radius: 0.48, y: 0.065 },
    { x: sx, z: cartZ, radius: 0.42, y: 0.065 },
    { x: sx, z: benchZ, radius: 0.58, y: 0.065 },
  ]);
  if (contacts) parent.add(contacts);
}

/* ============================================================================
 * 场景四：打印店（证件照快印 · 装订 / 学府文具打印 · BUILDINGS[2]，x=-7.0, z=-18, side=+1）
 * ========================================================================== */
export function buildPrintShopDressing(ctx: ShopBuildContext, faceX: number, side: number, centerZ: number): void {
  const { parent } = ctx;
  const winZ = centerZ - 0.65;
  const boxes: BoxPart[] = [];
  const cyls: BoxPart[] = [];

  // 1. 橱窗定制：A4 白纸摞 + 黑蓝红黄墨水盒 + 彩纸卷 + 桌面小打印机（中性白光）
  buildCustomShowcaseShell(ctx, faceX, side, winZ, 0xeef3f7, 0xd8e0e6, 0xeef6ff, 0xcadff5);
  const gx = faceX + side * 0.24;
  for (let i = 0; i < 4; i += 1) {
    boxes.push({ position: { x: gx, y: 0.65, z: winZ - 0.72 + i * 0.48 }, scale: { x: 0.22, y: 0.18, z: 0.3 }, color: 0xfcfcfc });
  }
  for (const [idx, inkHex] of [0x22272c, 0x2679c7, 0xd63c3c, 0xe8b92e].entries()) {
    boxes.push({ position: { x: gx, y: 1.03, z: winZ - 0.72 + idx * 0.48 }, scale: { x: 0.12, y: 0.18, z: 0.14 }, color: inkHex });
  }
  boxes.push({ position: { x: gx, y: 1.4, z: winZ - 0.35 }, scale: { x: 0.24, y: 0.16, z: 0.36 }, color: 0xe2e6eb });
  for (const [idx, rollHex] of [0xf06e6e, 0x5ca4e6, 0xf2d05c, 0x6ac28a].entries()) {
    cyls.push({ position: { x: gx, y: 1.4, z: winZ + 0.18 + idx * 0.2 }, scale: { x: 0.045, y: 0.22, z: 0.045 }, color: rollHex });
  }

  // 2. 发光灯箱「24H 打印·复印·扫描·装订」挂在雨棚前缘 + 竖牌「证件照 10 分钟取」+ 原纸箱「打印纸 A4」
  const neon24h = createTextSign('24H 打印·复印·扫描·装订', 2.25, 0.2, {
    background: '#f5faff',
    foreground: '#1a5ca8',
    resolution: 320,
  });
  neon24h.position.set(faceX + side * 0.94, 2.23, centerZ - 0.06);
  neon24h.rotation.y = side * (Math.PI / 2);
  if (neon24h.material instanceof THREE.MeshStandardMaterial) {
    neon24h.material.emissive.setHex(0x8bc2ff);
    neon24h.material.emissiveMap = neon24h.material.map;
    neon24h.material.emissiveIntensity = 0.55;
  }
  parent.add(neon24h);

  const photoSign = createCleanLabel(['证', '件', '照', '10分', '钟取'], 0.34, 0.84, '#ffffff', '#c6322b', '#c6322b');
  photoSign.position.set(faceX + side * 0.16, 2.84, centerZ - 1.56);
  photoSign.rotation.y = side * (Math.PI / 2);
  parent.add(photoSign);

  // 3. 门旁核心：落地式大型复印机/打印机（面向街道/靠玻璃门，避开前方树干）
  const px = faceX + side * 0.62;
  const pz = centerZ + 0.28;
  boxes.push(
    { position: { x: px, y: 0.54, z: pz }, scale: { x: 0.58, y: 0.94, z: 0.72 }, color: 0xe8ecf0 },
    { position: { x: px, y: 0.86, z: pz }, scale: { x: 0.6, y: 0.12, z: 0.74 }, color: 0x3f474e },
    // 微掀稿台盖露玻璃面
    { position: { x: px - side * 0.04, y: 1.07, z: pz }, scale: { x: 0.54, y: 0.05, z: 0.68 }, rotation: { x: 0, y: 0, z: side * 0.24 }, color: 0xdbe0e5 },
    { position: { x: px, y: 1.01, z: pz }, scale: { x: 0.5, y: 0.015, z: 0.62 }, color: 0x89c4e6 },
    // 吐出的半截 A4 打印纸
    { position: { x: px + side * 0.34, y: 0.74, z: pz }, scale: { x: 0.24, y: 0.01, z: 0.2 }, rotation: { x: 0, y: 0, z: -side * 0.1 }, color: 0xffffff },
    // 蓝绿按键小面板
    { position: { x: px + side * 0.31, y: 0.92, z: pz + 0.2 }, scale: { x: 0.04, y: 0.06, z: 0.18 }, color: 0x2674c4 },
  );
  const priceTag = createTextSign('复印 0.5元/页 · 打印 1元/页', 0.44, 0.22, {
    background: '#ffffff',
    foreground: '#263238',
    resolution: 256,
  });
  priceTag.position.set(px + side * 0.305, 0.54, pz - 0.12);
  priceTag.rotation.y = side * (Math.PI / 2);
  parent.add(priceTag);

  ctx.registerShopLight?.({
    x: px + side * 0.25,
    y: 1.72,
    z: pz,
    color: 0xeef6ff,
    intensity: 1.35,
    distance: 3.8,
    decay: 2,
  });

  // 4. 矮展示台（A4 彩印样张 + 色卡 + 订书机 + 裁纸刀 + 装订机 + 档案盒）+ 浅蓝证件照背景板
  const tz = centerZ - 1.15;
  boxes.push(
    { position: { x: px, y: 0.38, z: tz }, scale: { x: 0.52, y: 0.76, z: 1.18 }, color: 0xd4dade },
    { position: { x: px, y: 0.79, z: tz - 0.32 }, scale: { x: 0.24, y: 0.05, z: 0.32 }, color: 0xffffff },
    { position: { x: px + side * 0.08, y: 0.82, z: tz - 0.32 }, scale: { x: 0.18, y: 0.012, z: 0.24 }, color: 0x4ea3e0 },
    // 订书机与裁纸刀
    { position: { x: px, y: 0.79, z: tz }, scale: { x: 0.08, y: 0.05, z: 0.16 }, color: 0xbcc4ca },
    { position: { x: px, y: 0.79, z: tz + 0.24 }, scale: { x: 0.26, y: 0.03, z: 0.22 }, color: 0x8e989e },
    // 小型装订机与样本册
    { position: { x: px, y: 0.82, z: tz + 0.46 }, scale: { x: 0.22, y: 0.12, z: 0.16 }, color: 0x4a545b },
    // 证件照浅蓝背景板 + 木凳 + A4纸箱
    { position: { x: faceX + side * 0.32, y: 0.84, z: centerZ + 2.05 }, scale: { x: 0.06, y: 1.56, z: 0.96 }, color: 0x62a8e5 },
    { position: { x: faceX + side * 0.65, y: 0.24, z: centerZ + 2.05 }, scale: { x: 0.32, y: 0.48, z: 0.32 }, color: 0xb0865c },
    { position: { x: faceX + side * 0.38, y: 0.2, z: centerZ - 2.15 }, scale: { x: 0.38, y: 0.4, z: 0.42 }, color: 0xc29664 },
  );
  // 扇形彩色色卡
  for (const [idx, cHex] of [0xe34b4b, 0xf2b938, 0x3ea862, 0x3b84d6].entries()) {
    boxes.push({ position: { x: px - side * 0.12, y: 0.79, z: tz - 0.06 + idx * 0.045 }, scale: { x: 0.12, y: 0.012, z: 0.038 }, color: cHex });
  }

  const photoNotice = createTextSign('证件照拍摄中 · 请排队', 0.46, 0.28, {
    background: '#f8f5ec',
    foreground: '#2b3b48',
    resolution: 256,
  });
  photoNotice.position.set(faceX + side * 0.36, 1.38, centerZ + 2.05);
  photoNotice.rotation.y = side * (Math.PI / 2);
  parent.add(photoNotice);

  buildColoredBatch(parent, 'print-boxes', new THREE.BoxGeometry(1, 1, 1), createMatteMaterial(0xffffff, 0.72), boxes, true);
  buildColoredBatch(parent, 'print-cyls', new THREE.CylinderGeometry(1, 1, 1, 12), createMatteMaterial(0xffffff, 0.72), cyls, true);

  const contacts = createContactShadowDiscBatch('print-contacts', [
    { x: px, z: pz, radius: 0.46, y: 0.065 },
    { x: px, z: tz, radius: 0.58, y: 0.065 },
  ]);
  if (contacts) parent.add(contacts);
}

/* ============================================================================
 * 场景五：杂货店（街角便利店 · BUILDINGS[6]，x=7.26, z=-24, side=-1）
 * ========================================================================== */
export function buildConvenienceStoreDressing(ctx: ShopBuildContext, faceX: number, side: number, centerZ: number): void {
  const { parent } = ctx;
  const winZ = centerZ - 0.65;
  const doorZ = centerZ + 1.28;
  const boxes: BoxPart[] = [];
  const cyls: BoxPart[] = [];

  // 1. 橱窗定制：丰富饮料零食与日用品陈列
  buildCustomShowcaseShell(ctx, faceX, side, winZ, 0xfff3dd, 0x9c7650, 0xffd286, 0xffc66e);
  const gx = faceX + side * 0.24;
  const packColors = [0xe8614f, 0x4b9de0, 0xf2c946, 0x5ab872, 0xf08f3d, 0x9b6bd4];
  for (const [rIdx, sy] of [0.56, 0.94, 1.32].entries()) {
    for (let i = 0; i < 10; i += 1) {
      if (rIdx === 0) {
        boxes.push({ position: { x: gx, y: sy + 0.11, z: winZ - 0.96 + i * 0.21 }, scale: { x: 0.14, y: 0.18, z: 0.16 }, color: packColors[(i + rIdx) % packColors.length] });
      } else {
        cyls.push({ position: { x: gx, y: sy + 0.1, z: winZ - 0.96 + i * 0.21 }, scale: { x: 0.042, y: 0.17, z: 0.042 }, color: packColors[(i + rIdx) % packColors.length] });
      }
    }
  }

  // 2. 黄色促销横幅「日用百货 · 全场 9 折」+ 小彩旗 + 3 张促销海报 + 营业中翻牌
  const saleBanner = createTextSign('日用百货 · 全场 9 折', 2.2, 0.28, {
    background: '#f5cb3d',
    foreground: '#c4241c',
    resolution: 320,
  });
  saleBanner.position.set(faceX + side * 0.24, 2.28, centerZ - 0.06);
  saleBanner.rotation.y = side * (Math.PI / 2);
  parent.add(saleBanner);

  addBuntingFlags(parent, 'conv-bunting', faceX + side * 0.87, 1.98, centerZ - 1.9, centerZ + 1.8, 12, [0xf5c838, 0xe85a3c, 0x4ca6e0]);

  const openSign = createTextSign('营业中', 0.34, 0.18, {
    background: '#3d8f52',
    foreground: '#ffffff',
    resolution: 192,
  });
  openSign.position.set(faceX + side * 0.31, 1.48, doorZ);
  openSign.rotation.y = side * (Math.PI / 2);
  parent.add(openSign);

  for (const [idx, spec] of [
    { z: centerZ - 2.18, bg: '#f6d13d', fg: '#c4241c', text: '开学季大促' },
    { z: centerZ + 2.04, bg: '#3178c6', fg: '#ffffff', text: '饮料冰镇特惠' },
  ].entries()) {
    const poster = createTextSign(spec.text, 0.44, 0.56, { background: spec.bg, foreground: spec.fg, resolution: 256 });
    poster.position.set(faceX + side * 0.06, 1.44 - idx * 0.06, spec.z);
    poster.rotation.y = side * (Math.PI / 2);
    parent.add(poster);
  }

  // 3. 门左侧：三层开放式日用品货架（卷纸/抽纸、蓝绿黄洗衣液、毛巾牙膏、脸盆水桶、扫帚簸箕）
  const sx = faceX + side * 0.58;
  const rackZ = centerZ - 1.38;
  boxes.push(
    { position: { x: sx, y: 0.68, z: rackZ - 0.54 }, scale: { x: 0.38, y: 1.34, z: 0.04 }, color: 0x7e878c },
    { position: { x: sx, y: 0.68, z: rackZ + 0.54 }, scale: { x: 0.38, y: 1.34, z: 0.04 }, color: 0x7e878c },
  );
  for (const sy of [0.18, 0.58, 0.98, 1.32]) {
    boxes.push({ position: { x: sx, y: sy, z: rackZ }, scale: { x: 0.38, y: 0.04, z: 1.1 }, color: 0xc8a070 });
  }
  // 上层：白卷纸 + 蓝绿黄洗衣液瓶
  for (let i = 0; i < 3; i += 1) {
    cyls.push({ position: { x: sx, y: 1.1, z: rackZ - 0.38 + i * 0.14 }, scale: { x: 0.06, y: 0.16, z: 0.06 }, color: 0xf8f8f8 });
  }
  for (const [idx, hex] of [0x337fd6, 0x3da864, 0xebbd34].entries()) {
    boxes.push({ position: { x: sx, y: 1.12, z: rackZ + 0.08 + idx * 0.16 }, scale: { x: 0.12, y: 0.22, z: 0.12 }, color: hex });
  }
  // 中层：彩色洗护与毛巾
  for (let i = 0; i < 5; i += 1) {
    boxes.push({ position: { x: sx, y: 0.68, z: rackZ - 0.36 + i * 0.18 }, scale: { x: 0.14, y: 0.12, z: 0.14 }, color: packColors[i] });
  }
  // 下层：红蓝绿塑料脸盆 + 扫帚
  for (const [idx, hex] of [0xe3564c, 0x458ce0, 0x48ab6c].entries()) {
    cyls.push({ position: { x: sx, y: 0.24 + idx * 0.055, z: rackZ - 0.2 }, scale: { x: 0.18, y: 0.07, z: 0.18 }, color: hex });
  }
  cyls.push({ position: { x: sx, y: 0.56, z: rackZ + 0.62 }, scale: { x: 0.016, y: 1.0, z: 0.016 }, color: 0xd99e3c });

  // 4. 门右侧：立式冷饮冰柜 + 零食堆头 + 红色购物篮摞（避开 z=-24.2 刷手机路人）
  const coolerZ = centerZ + 1.98;
  boxes.push(
    { position: { x: sx, y: 0.78, z: coolerZ }, scale: { x: 0.44, y: 1.48, z: 0.66 }, color: 0xeff5f8 },
    { position: { x: sx + side * 0.21, y: 0.74, z: coolerZ }, scale: { x: 0.02, y: 1.12, z: 0.54 }, color: 0x8dc9e6 },
  );
  const coldSign = createTextSign('冷饮', 0.44, 0.18, { background: '#2679c7', foreground: '#ffffff', resolution: 192 });
  coldSign.position.set(sx + side * 0.225, 1.42, coolerZ);
  coldSign.rotation.y = side * (Math.PI / 2);
  parent.add(coldSign);

  // 零食堆头 + 红色购物篮
  const pileZ = centerZ + 2.66;
  boxes.push(
    { position: { x: sx, y: 0.22, z: pileZ }, scale: { x: 0.42, y: 0.34, z: 0.52 }, color: 0xc99c68 },
    { position: { x: sx, y: 0.45, z: pileZ - 0.1 }, scale: { x: 0.16, y: 0.14, z: 0.16 }, color: 0xe85a48 },
    { position: { x: sx, y: 0.45, z: pileZ + 0.1 }, scale: { x: 0.16, y: 0.14, z: 0.16 }, color: 0xf0be3e },
    // 红色购物篮摞
    { position: { x: sx, y: 0.22, z: centerZ + 1.44 }, scale: { x: 0.28, y: 0.34, z: 0.36 }, color: 0xd93a32 },
  );

  buildColoredBatch(parent, 'conv-boxes', new THREE.BoxGeometry(1, 1, 1), createMatteMaterial(0xffffff, 0.78), boxes, true);
  buildColoredBatch(parent, 'conv-cyls', new THREE.CylinderGeometry(1, 1, 1, 12), createMatteMaterial(0xffffff, 0.7), cyls, true);

  const contacts = createContactShadowDiscBatch('conv-contacts', [
    { x: sx, z: rackZ, radius: 0.56, y: 0.065 },
    { x: sx, z: coolerZ, radius: 0.44, y: 0.065 },
    { x: sx, z: pileZ, radius: 0.4, y: 0.065 },
  ]);
  if (contacts) parent.add(contacts);
}

/* ============================================================================
 * 场景六：药店（康安药房 · BUILDINGS[3]，x=-7.18, z=-30, side=+1）
 * ========================================================================== */
export function buildPharmacyDressing(ctx: ShopBuildContext, faceX: number, side: number, centerZ: number): void {
  const { parent } = ctx;
  const winZ = centerZ - 0.65;
  const doorZ = centerZ + 1.28;
  const boxes: BoxPart[] = [];
  const cyls: BoxPart[] = [];

  // 1. 橱窗定制：按白/蓝/绿/橙整齐分类的药盒 + 维生素大瓶 + 绿十字小立牌
  buildCustomShowcaseShell(ctx, faceX, side, winZ, 0xf2faf6, 0xffffff, 0xe8fff2, 0xb8ebd0);
  const gx = faceX + side * 0.24;
  const medColors = [0xfcfcfc, 0x4ea3e0, 0x4ab874, 0xf29f38, 0xfcfcfc];
  for (const [rIdx, sy] of [0.56, 0.94, 1.32].entries()) {
    for (let i = 0; i < 8; i += 1) {
      if (rIdx === 1 && i >= 3 && i <= 5) {
        cyls.push({ position: { x: gx, y: sy + 0.11, z: winZ - 0.84 + i * 0.24 }, scale: { x: 0.052, y: 0.17, z: 0.052 }, color: i === 4 ? 0xf29c38 : 0x4db573 });
      } else {
        boxes.push({ position: { x: gx, y: sy + 0.1, z: winZ - 0.84 + i * 0.24 }, scale: { x: 0.12, y: 0.16, z: 0.18 }, color: medColors[(i + rIdx) % medColors.length] });
      }
    }
  }

  // 2. 醒目绿色十字发光灯箱 + 绿色横带「24 小时售药 · 医保定点」+ 门小绿十字 + 浅绿擦脚垫 + 健康海报
  const crossBox = createPosterMesh(0.56, 0.56, (c, w, h) => {
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#1f8a4c';
    c.lineWidth = 8;
    c.strokeRect(4, 4, w - 8, h - 8);
    c.fillStyle = '#1f8a4c';
    c.fillRect(w * 0.38, h * 0.16, w * 0.24, h * 0.68);
    c.fillRect(w * 0.16, h * 0.38, w * 0.68, h * 0.24);
  }, 0x6ef0a4, 0.45);
  crossBox.position.set(faceX + side * 0.24, 2.58, centerZ - 1.54);
  crossBox.rotation.y = side * (Math.PI / 2);
  parent.add(crossBox);

  const medStrip = createTextSign('24 小时售药 · 医保定点', 2.25, 0.2, {
    background: '#1f8a4c',
    foreground: '#ffffff',
    resolution: 320,
  });
  medStrip.position.set(faceX + side * 0.94, 2.23, centerZ - 0.06);
  medStrip.rotation.y = side * (Math.PI / 2);
  parent.add(medStrip);

  const doorCross = createPosterMesh(0.24, 0.24, (c, w, h) => {
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#249452';
    c.fillRect(w * 0.38, h * 0.15, w * 0.24, h * 0.7);
    c.fillRect(w * 0.15, h * 0.38, w * 0.7, h * 0.24);
  });
  doorCross.position.set(faceX + side * 0.29, 1.54, doorZ + 0.26);
  doorCross.rotation.y = side * (Math.PI / 2);
  parent.add(doorCross);

  const healthTip = createTextSign('换季注意保暖 · 感冒及时用药', 0.56, 0.44, {
    background: '#e2f5e9',
    foreground: '#1e5c38',
    resolution: 256,
  });
  healthTip.position.set(faceX + side * 0.06, 1.46, centerZ - 2.18);
  healthTip.rotation.y = side * (Math.PI / 2);
  parent.add(healthTip);

  boxes.push({ position: { x: faceX + side * 0.52, y: 0.068, z: doorZ }, scale: { x: 0.48, y: 0.016, z: 0.9 }, color: 0x62b882 });

  // 3. 门口核心：双层药品展示架 + 电子体重秤 + 血压计 + 急救箱 + 「免费测血压·测体温」木牌
  const px = faceX + side * 0.58;
  const rackZ = centerZ - 1.05;
  boxes.push(
    { position: { x: px, y: 0.48, z: rackZ }, scale: { x: 0.36, y: 0.92, z: 0.92 }, color: 0xf4faf6 },
    { position: { x: px, y: 0.95, z: rackZ }, scale: { x: 0.38, y: 0.05, z: 0.94 }, color: 0x249452 },
  );
  // 感冒药盒、创可贴盒、蓝色口罩盒、维C瓶
  boxes.push(
    { position: { x: px, y: 1.04, z: rackZ - 0.3 }, scale: { x: 0.14, y: 0.14, z: 0.2 }, color: 0x4ea3e0 },
    { position: { x: px, y: 1.04, z: rackZ - 0.06 }, scale: { x: 0.14, y: 0.12, z: 0.18 }, color: 0xfcfcfc },
    { position: { x: px, y: 1.03, z: rackZ + 0.18 }, scale: { x: 0.16, y: 0.1, z: 0.22 }, color: 0x6ebbf0 },
  );
  cyls.push(
    { position: { x: px, y: 1.06, z: rackZ + 0.38 }, scale: { x: 0.045, y: 0.15, z: 0.045 }, color: 0x3eb368 },
    // 电子体重秤 + 血压计 + 红十字急救箱
    { position: { x: px + side * 0.04, y: 0.085, z: centerZ - 0.18 }, scale: { x: 0.16, y: 0.04, z: 0.16 }, color: 0xdbe2e5 },
  );
  boxes.push(
    { position: { x: px, y: 0.34, z: centerZ + 0.18 }, scale: { x: 0.34, y: 0.64, z: 0.44 }, color: 0xf4f8f5 },
    { position: { x: px, y: 0.72, z: centerZ + 0.14 }, scale: { x: 0.18, y: 0.12, z: 0.18 }, color: 0xe6ecee },
    { position: { x: px, y: 0.75, z: centerZ + 0.32 }, scale: { x: 0.2, y: 0.14, z: 0.22 }, color: 0xffffff },
    { position: { x: px + side * 0.11, y: 0.75, z: centerZ + 0.32 }, scale: { x: 0.015, y: 0.08, z: 0.03 }, color: 0xd9352b },
    { position: { x: px + side * 0.11, y: 0.75, z: centerZ + 0.32 }, scale: { x: 0.015, y: 0.03, z: 0.08 }, color: 0xd9352b },
  );

  const checkSign = createTextSign('免费测血压 · 测体温', 0.44, 0.22, {
    background: '#ffffff',
    foreground: '#1f8a4c',
    resolution: 256,
  });
  checkSign.position.set(px + side * 0.18, 0.5, centerZ + 0.18);
  checkSign.rotation.y = side * (Math.PI / 2);
  parent.add(checkSign);

  buildColoredBatch(parent, 'pharmacy-boxes', new THREE.BoxGeometry(1, 1, 1), createMatteMaterial(0xffffff, 0.75), boxes, true);
  buildColoredBatch(parent, 'pharmacy-cyls', new THREE.CylinderGeometry(1, 1, 1, 12), createMatteMaterial(0xffffff, 0.72), cyls, true);

  const contacts = createContactShadowDiscBatch('pharmacy-contacts', [
    { x: px, z: rackZ, radius: 0.5, y: 0.065 },
    { x: px, z: centerZ + 0.18, radius: 0.4, y: 0.065 },
  ]);
  if (contacts) parent.add(contacts);
}

/* ============================================================================
 * 场景七：实验楼（原「学府文具打印 / 开学文具·彩印复印」· BUILDINGS[7]，x=7.08, z=-36, side=-1）
 * ========================================================================== */
export function buildLabBuildingDressing(ctx: ShopBuildContext, faceX: number, side: number, centerZ: number): void {
  const { parent } = ctx;
  const winZ = centerZ - 0.65;
  const doorZ = centerZ + 1.28;
  const boxes: BoxPart[] = [];
  const cyls: BoxPart[] = [];
  const spheres: BoxPart[] = [];

  // 1. 橱窗彻底替换为科学仪器与科普展示（冷白 + 淡蓝光）
  buildCustomShowcaseShell(ctx, faceX, side, winZ, 0xe8f3fc, 0xf2f7fb, 0xbfe2ff, 0x8cc6ff);
  const gx = faceX + side * 0.24;
  // 上层：显微镜 + 地球仪 + 实验教材
  boxes.push({ position: { x: gx, y: 1.4, z: winZ - 0.65 }, scale: { x: 0.12, y: 0.18, z: 0.14 }, color: 0x3b444c });
  cyls.push({ position: { x: gx, y: 1.48, z: winZ - 0.65 }, scale: { x: 0.024, y: 0.16, z: 0.024 }, rotation: { x: 0, y: 0, z: side * 0.25 }, color: 0xc4ccd2 });
  spheres.push({ position: { x: gx, y: 1.44, z: winZ }, scale: { x: 0.11, y: 0.11, z: 0.11 }, color: 0x3689d6 });
  for (let i = 0; i < 4; i += 1) {
    boxes.push({ position: { x: gx, y: 1.41, z: winZ + 0.45 + i * 0.12 }, scale: { x: 0.15, y: 0.2, z: 0.08 }, color: i % 2 === 0 ? 0x266ab5 : 0x4ba3c3 });
  }
  // 中层：彩色试管架 + 烧杯 + 分子模型
  for (const [idx, liqHex] of [0x3b9ee6, 0x4ac47a, 0xe85a5a, 0xf2b53b, 0x9b6be0].entries()) {
    cyls.push({ position: { x: gx, y: 1.04, z: winZ - 0.68 + idx * 0.14 }, scale: { x: 0.022, y: 0.16, z: 0.022 }, color: liqHex });
  }
  boxes.push({ position: { x: gx, y: 0.98, z: winZ - 0.4 }, scale: { x: 0.12, y: 0.1, z: 0.72 }, color: 0xb07c4f });
  for (const [dx, dy, cHex] of [[0, 0.12, 0xe04848], [-0.08, 0.06, 0x3882d6], [0.08, 0.06, 0x3882d6], [0, 0.2, 0xf2f2f2]] as const) {
    spheres.push({ position: { x: gx, y: 0.96 + dy, z: winZ + 0.48 + dx }, scale: { x: 0.042, y: 0.042, z: 0.042 }, color: cHex });
  }

  // 2. 门头科技蓝横带 + 副标「LABORATORY · 科学探索中心」+ 原子 LOGO 灯箱 + 安全用电蓝牌 + 迎宾垫
  const ledStrip = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.1, 3.9),
    new THREE.MeshStandardMaterial({ color: 0x2b7de9, emissive: 0x3a94ff, emissiveIntensity: 1.3, roughness: 0.25 }),
  );
  ledStrip.position.set(faceX + side * 0.22, 2.29, centerZ - 0.06);
  parent.add(ledStrip);

  const labSub = createTextSign('LABORATORY · 科学探索中心', 2.2, 0.22, {
    background: '#f2f7fc',
    foreground: '#1a4f8a',
    resolution: 320,
  });
  labSub.position.set(faceX + side * 0.24, 2.94, centerZ - 0.06);
  labSub.rotation.y = side * (Math.PI / 2);
  parent.add(labSub);

  const atomBox = createPosterMesh(0.56, 0.56, (c, w, h) => {
    c.fillStyle = '#e6f3ff';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#1b64c2';
    c.lineWidth = 7;
    c.strokeRect(4, 4, w - 8, h - 8);
    for (const rot of [0, Math.PI / 3, -Math.PI / 3]) {
      c.save();
      c.translate(w / 2, h / 2);
      c.rotate(rot);
      c.beginPath();
      c.ellipse(0, 0, w * 0.34, h * 0.13, 0, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }
    c.fillStyle = '#2480eb';
    c.beginPath();
    c.arc(w / 2, h / 2, 14, 0, Math.PI * 2);
    c.fill();
  }, 0x7cbfff, 0.45);
  atomBox.position.set(faceX + side * 0.24, 2.58, centerZ - 1.54);
  atomBox.rotation.y = side * (Math.PI / 2);
  parent.add(atomBox);

  const safeBlue = createTextSign('安全用电 · 实验楼', 0.42, 0.22, { background: '#1e63b8', foreground: '#ffffff', resolution: 256 });
  safeBlue.position.set(faceX + side * 0.06, 1.88, centerZ - 2.18);
  safeBlue.rotation.y = side * (Math.PI / 2);
  parent.add(safeBlue);

  const warnSign = createTextSign('科学实验 · 请勿触碰仪器', 0.54, 0.26, { background: '#ffdc4e', foreground: '#1e2428', resolution: 256 });
  warnSign.position.set(faceX + side * 0.06, 1.38, centerZ + 2.06);
  warnSign.rotation.y = side * (Math.PI / 2);
  parent.add(warnSign);

  boxes.push({ position: { x: faceX + side * 0.52, y: 0.068, z: doorZ }, scale: { x: 0.48, y: 0.016, z: 0.9 }, color: 0x265e9e });

  // 3. 门左侧（物理/天文组）：三脚架天文望远镜 + 地球仪 + 透明罩电路板展示台
  const lx = faceX + side * 0.58;
  const leftZ = centerZ - 1.55;
  // 望远镜三脚架 + 白蓝镜筒
  for (const [dx, dz] of [[-0.1, -0.1], [0.1, -0.1], [0, 0.12]] as const) {
    cyls.push({ position: { x: lx + dx, y: 0.46, z: leftZ + dz }, scale: { x: 0.016, y: 0.84, z: 0.016 }, rotation: { x: dz * 1.4, y: 0, z: -dx * 1.4 }, color: 0x3b444c });
  }
  cyls.push({
    position: { x: lx + side * 0.06, y: 0.94, z: leftZ },
    scale: { x: 0.06, y: 0.62, z: 0.06 },
    rotation: { x: 0, y: 0, z: side * 0.96 },
    color: 0xf4f8fc,
  });
  // 地球仪与电路板展示台
  boxes.push({ position: { x: lx, y: 0.36, z: centerZ - 0.95 }, scale: { x: 0.42, y: 0.68, z: 0.72 }, color: 0xf2f6fa });
  cyls.push({ position: { x: lx, y: 0.74, z: centerZ - 1.12 }, scale: { x: 0.09, y: 0.06, z: 0.09 }, color: 0x1e4a7a });
  spheres.push({ position: { x: lx, y: 0.92, z: centerZ - 1.12 }, scale: { x: 0.14, y: 0.14, z: 0.14 }, color: 0x2d86d6 });
  boxes.push(
    { position: { x: lx, y: 0.73, z: centerZ - 0.76 }, scale: { x: 0.24, y: 0.04, z: 0.22 }, color: 0x2c8a4b },
    { position: { x: lx, y: 0.82, z: centerZ - 0.76 }, scale: { x: 0.26, y: 0.18, z: 0.24 }, color: 0xb8dcf5 },
  );

  // 4. 门右侧（化学/生物组）：白色实验展示台 + 试管架 + 烧杯 + 酒精灯 + 显微镜 + 大型分子模型 + 玻璃罩标本
  const rightZ = centerZ + 0.16;
  boxes.push({ position: { x: lx, y: 0.38, z: rightZ }, scale: { x: 0.48, y: 0.74, z: 0.96 }, color: 0xf6f9fc });
  // 显微镜
  boxes.push({ position: { x: lx, y: 0.84, z: rightZ - 0.28 }, scale: { x: 0.14, y: 0.18, z: 0.14 }, color: 0x3b444c });
  cyls.push({ position: { x: lx + side * 0.04, y: 0.94, z: rightZ - 0.28 }, scale: { x: 0.025, y: 0.18, z: 0.025 }, rotation: { x: 0, y: 0, z: side * 0.28 }, color: 0xd0d6dc });
  // 试管架与彩色试管
  boxes.push({ position: { x: lx, y: 0.8, z: rightZ + 0.04 }, scale: { x: 0.12, y: 0.08, z: 0.34 }, color: 0xb88c5e });
  for (const [idx, liqHex] of [0x3b9ee6, 0x4ac47a, 0xe85a5a, 0xf2b53b].entries()) {
    cyls.push({ position: { x: lx, y: 0.9, z: rightZ - 0.08 + idx * 0.08 }, scale: { x: 0.018, y: 0.16, z: 0.018 }, color: liqHex });
  }
  // 烧杯 + 酒精灯暖黄小火苗
  cyls.push(
    { position: { x: lx + side * 0.08, y: 0.82, z: rightZ + 0.28 }, scale: { x: 0.05, y: 0.12, z: 0.05 }, color: 0x62c4eb },
    { position: { x: lx - side * 0.06, y: 0.79, z: rightZ + 0.36 }, scale: { x: 0.04, y: 0.07, z: 0.04 }, color: 0xdce4ea },
  );
  spheres.push({ position: { x: lx - side * 0.06, y: 0.86, z: rightZ + 0.36 }, scale: { x: 0.026, y: 0.04, z: 0.026 }, color: 0xff9b38 });

  // 分子结构模型 + 标本底座
  const molZ = centerZ + 2.12;
  boxes.push({ position: { x: lx, y: 0.32, z: molZ }, scale: { x: 0.36, y: 0.62, z: 0.36 }, color: 0xe6edf5 });
  for (const [dx, dy, dz, cHex] of [
    [0, 0.18, 0, 0xe04848],
    [-0.1, 0.1, -0.06, 0x3882d6],
    [0.1, 0.1, 0.06, 0x3882d6],
    [0, 0.28, 0.08, 0xf5f5f5],
    [-0.08, 0.24, -0.08, 0x2c3238],
  ] as const) {
    spheres.push({ position: { x: lx + dx, y: 0.64 + dy, z: molZ + dz }, scale: { x: 0.045, y: 0.045, z: 0.045 }, color: cHex });
  }

  buildColoredBatch(parent, 'lab-boxes', new THREE.BoxGeometry(1, 1, 1), createMatteMaterial(0xffffff, 0.65), boxes, true);
  buildColoredBatch(parent, 'lab-cyls', new THREE.CylinderGeometry(1, 1, 1, 12), createMatteMaterial(0xffffff, 0.55), cyls, true);
  buildColoredBatch(parent, 'lab-spheres', new THREE.SphereGeometry(1, 12, 10), createMatteMaterial(0xffffff, 0.45), spheres, true);

  const contacts = createContactShadowDiscBatch('lab-contacts', [
    { x: lx, z: leftZ, radius: 0.36, y: 0.065 },
    { x: lx, z: centerZ - 0.95, radius: 0.42, y: 0.065 },
    { x: lx, z: rightZ, radius: 0.48, y: 0.065 },
    { x: lx, z: molZ, radius: 0.32, y: 0.065 },
  ]);
  if (contacts) parent.add(contacts);
}

/* ============================================================================
 * 场景八：空挡位置特色建筑 —— 校园钟楼 + 铜色雕塑小喷泉广场
 * 坐标：x ∈ [3.65, 6.45], z ∈ [-31.45, -28.75]（夹在便利店与实验楼之间）
 * ========================================================================== */
export function buildCampusClockTowerPlaza(ctx: ShopBuildContext): void {
  const { parent, occluders } = ctx;
  const group = new THREE.Group();
  group.name = 'street-campus-clock-tower';
  parent.add(group);

  const cx = 5.05;
  const cz = -30.1;

  const whiteBrick = createMatteMaterial(0xf0ece0, 0.85);
  const redAccent = createMatteMaterial(0xbe3a2f, 0.78);
  const darkRoof = createMatteMaterial(0x3a434a, 0.78);
  const stoneMat = createMatteMaterial(0x9a9f9c, 0.86);
  const glassMat = getFacadeWindowMaterial();
  const bronzeMat = new THREE.MeshStandardMaterial({ color: 0xb67d44, roughness: 0.42, metalness: 0.55 });
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x62b8e0, roughness: 0.18, metalness: 0.12, transparent: true, opacity: 0.82 });

  // 1. 广场化米色/浅红地砖（不侵入盲道）+ 深色石基座
  const plaza = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.03, 3.0), createMatteMaterial(0xd9b89c, 0.88));
  plaza.position.set(cx - 0.45, 0.075, cz);
  plaza.receiveShadow = true;
  group.add(plaza);

  const base = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.28, 2.55), stoneMat);
  base.position.set(cx, 0.16, cz);
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  // 2. 红白相间低多边形复古钟楼塔身（总高 7.8m）
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(2.25, 4.9, 2.15), whiteBrick);
  shaft.position.set(cx, 0.3 + 4.9 / 2, cz);
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  group.add(shaft);
  occluders.push(shaft);

  const belfry = new THREE.Mesh(new THREE.BoxGeometry(1.92, 1.5, 1.84), whiteBrick);
  belfry.position.set(cx, 5.2 + 1.5 / 2, cz);
  belfry.castShadow = true;
  belfry.receiveShadow = true;
  group.add(belfry);
  occluders.push(belfry);

  const boxes: BoxPart[] = [];
  // 红色装饰腰线、檐口与四角立柱条
  for (const ry of [2.5, 5.2, 6.72]) {
    boxes.push({ position: { x: cx, y: ry, z: cz }, scale: { x: ry > 5 ? 2.14 : 2.38, y: 0.14, z: ry > 5 ? 2.04 : 2.28 }, color: 0xbe3a2f });
  }
  for (const sz of [-0.95, 0.95]) {
    boxes.push({ position: { x: cx - 1.14, y: 2.75, z: cz + sz }, scale: { x: 0.1, y: 4.8, z: 0.16 }, color: 0xbe3a2f });
  }
  // 拱窗（2~3 层）与底部半掩拱门
  for (const wy of [3.55, 4.55]) {
    for (const wz of [-0.48, 0.48]) {
      boxes.push({ position: { x: cx - 1.13, y: wy, z: cz + wz }, scale: { x: 0.06, y: 0.64, z: 0.36 }, color: 0x2c3a44 });
    }
  }
  boxes.push({ position: { x: cx - 1.13, y: 1.05, z: cz }, scale: { x: 0.08, y: 1.52, z: 0.84 }, color: 0x523928 });
  const doorArch = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 8, 14, Math.PI), redAccent);
  doorArch.rotation.y = Math.PI / 2;
  doorArch.position.set(cx - 1.15, 1.81, cz);
  group.add(doorArch);

  // 白底黑字小横匾「校园钟楼」
  const plaque = createTextSign('校园钟楼', 1.18, 0.28, { background: '#f7f3e8', foreground: '#22282c', resolution: 256 });
  plaque.position.set(cx - 1.19, 2.34, cz);
  plaque.rotation.y = -Math.PI / 2;
  group.add(plaque);

  // 3. 顶部圆形大钟盘（暖白内透光 + 红圈 + 8:30 指针）+ 尖顶锥形塔尖
  const clockY = 5.96;
  const clockX = cx - 0.98;
  const clockRim = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.055, 8, 24), redAccent);
  clockRim.rotation.y = Math.PI / 2;
  clockRim.position.set(clockX, clockY, cz);
  const clockFace = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 24),
    new THREE.MeshStandardMaterial({ color: 0xfffcf2, emissive: 0xffe4ad, emissiveIntensity: 0.55, roughness: 0.6 }),
  );
  clockFace.rotation.y = -Math.PI / 2;
  clockFace.position.set(clockX - 0.005, clockY, cz);
  group.add(clockRim, clockFace);
  boxes.push(
    { position: { x: clockX - 0.02, y: clockY - 0.04, z: cz + 0.1 }, scale: { x: 0.02, y: 0.03, z: 0.24 }, rotation: { x: 0.35, y: 0, z: 0 }, color: 0x1e2226 },
    { position: { x: clockX - 0.02, y: clockY + 0.14, z: cz }, scale: { x: 0.02, y: 0.32, z: 0.028 }, color: 0xbe3a2f },
  );

  const spire = new THREE.Mesh(new THREE.ConeGeometry(1.26, 1.35, 4), redAccent);
  spire.rotation.y = Math.PI / 4;
  spire.position.set(cx, 6.72 + 1.35 / 2, cz);
  spire.castShadow = true;
  const spireTip = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), darkRoof);
  spireTip.position.set(cx, 8.12, cz);
  group.add(spire, spireTip);

  // 4. 钟楼前方小广场（x = 3.35, z = -29.65，避开 z = -30.5 的蓝色自行车）：圆形浅水池 + 铜色翻开书本飞鸟雕塑 + 动态喷泉 + 花坛
  const fx = 3.32;
  const fz = -29.58;
  const poolRim = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.6, 0.22, 16), stoneMat);
  poolRim.position.set(fx, 0.18, fz);
  const waterDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.04, 16), waterMat);
  waterDisc.position.set(fx, 0.26, fz);
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.42, 10), stoneMat);
  pedestal.position.set(fx, 0.42, fz);
  const bookLeft = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.28), bronzeMat);
  bookLeft.position.set(fx - 0.08, 0.66, fz);
  bookLeft.rotation.z = 0.32;
  const bookRight = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.28), bronzeMat);
  bookRight.position.set(fx + 0.08, 0.66, fz);
  bookRight.rotation.z = -0.32;
  const bird = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.26, 4), bronzeMat);
  bird.position.set(fx, 0.84, fz);
  bird.rotation.z = -0.4;
  group.add(poolRim, waterDisc, pedestal, bookLeft, bookRight, bird);

  addAnimatedPuffs(ctx, { x: fx, y: 0.3, z: fz }, 6, 0.64, 0.045, 0.9, 'fountain');

  // 两侧陶土绿植花坛 + 暖黄地灯 + 淡蓝水下灯
  const potMat = createMatteMaterial(0xb46242, 0.85);
  const leafMat = createMatteMaterial(0x4f7f4c, 0.9);
  for (const pz of [cz - 1.15, cz + 1.15]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.3, 10), potMat);
    pot.position.set(cx - 1.52, 0.22, pz);
    const bush = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), leafMat);
    bush.position.set(cx - 1.52, 0.48, pz);
    group.add(pot, bush);
  }
  ctx.registerShopLight?.({
    x: cx - 1.6,
    y: 0.65,
    z: cz,
    color: 0xffcb78,
    intensity: 1.35,
    distance: 5.2,
    decay: 2,
  });
  ctx.registerShopLight?.({
    x: fx,
    y: 0.52,
    z: fz,
    color: 0x7acbff,
    intensity: 0.9,
    distance: 2.8,
    decay: 2,
  });

  // 窗玻璃反光片复用 glassMat
  const winPane = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.32), glassMat);
  winPane.position.set(cx - 1.14, 3.55, cz - 0.48);
  group.add(winPane);

  buildColoredBatch(group, 'clocktower-boxes', new THREE.BoxGeometry(1, 1, 1), createMatteMaterial(0xffffff, 0.78), boxes, true);
  const contacts = createContactShadowDiscBatch('clocktower-contacts', [
    { x: cx, z: cz, radius: 1.5, y: 0.085 },
    { x: fx, z: fz, radius: 0.65, y: 0.085 },
  ]);
  if (contacts) group.add(contacts);
}

/* ============================================================================
 * 场景九：校门口奶茶店（青春茶饮）
 * 坐标：x ∈ [-8.75, -2.55], z ∈ [-42.6, -36.2]（校门口斑马线旁原墨绿矮围墙地块）
 * ========================================================================== */
export function buildMilkTeaShop(ctx: ShopBuildContext): void {
  const { parent, occluders } = ctx;
  const group = new THREE.Group();
  group.name = 'street-campus-milktea-shop';
  parent.add(group);

  const cx = -5.65;
  const cz = -39.4;
  const w = 6.2;
  const d = 6.4;
  const faceX = cx + w / 2; // -2.55，贴齐人行道外缘，绝不挡盲道/斑马线/「学校区域」牌

  const wallMat = createMatteMaterial(0xfff1ea, 0.84);
  const accentMat = createMatteMaterial(0xf48d5c, 0.78);
  const pinkMat = createMatteMaterial(0xf5a8bf, 0.78);
  const woodMat = createMatteMaterial(0xc69868, 0.76);
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.14,
    metalness: 0.06,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });

  // 1. 粉白暖黄圆润单层店铺主体 + 橙粉装饰腰线与顶檐
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, 3.45, d), wallMat);
  body.position.set(cx, 1.725, cz);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  occluders.push(body);

  // 一层与二层退台腰檐 + 二层完整自习区体量（高 2.9m，总高 ~6.7m）
  const roofRim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.24, 0.22, d + 0.24), accentMat);
  roofRim.position.set(cx + 0.06, 3.54, cz);
  roofRim.castShadow = true;
  group.add(roofRim);

  const topTrim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.1, d + 0.3), pinkMat);
  topTrim.position.set(cx + 0.06, 3.68, cz);
  group.add(topTrim);

  const upperBody = new THREE.Mesh(new THREE.BoxGeometry(w - 0.36, 2.78, d - 0.36), wallMat);
  upperBody.position.set(cx - 0.18, 3.73 + 1.39, cz);
  upperBody.castShadow = true;
  upperBody.receiveShadow = true;
  group.add(upperBody);

  const upperParapet = new THREE.Mesh(new THREE.BoxGeometry(w - 0.14, 0.24, d - 0.14), accentMat);
  upperParapet.position.set(cx - 0.18, 6.58, cz);
  upperParapet.castShadow = true;
  group.add(upperParapet);

  // 二层退台暖橙护栏 + 三扇明亮自习大窗 + 二层竖向「二楼自习」灯箱招牌 + 落水管
  const railMat = new THREE.MeshStandardMaterial({ color: 0x4b585c, roughness: 0.56, metalness: 0.3 });
  const warmWindowMat = new THREE.MeshStandardMaterial({
    color: 0xffdfad,
    emissive: 0xffbd70,
    emissiveIntensity: 0.2,
    roughness: 0.4,
  });
  ctx.registerNightMaterial?.(warmWindowMat, 0.18, 0.84);
  const balconyRailTop = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, d - 0.12), railMat);
  balconyRailTop.position.set(faceX + 0.08, 4.24, cz);
  group.add(balconyRailTop);
  for (let r = -2.6; r <= 2.6; r += 0.65) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.56, 0.045), railMat);
    post.position.set(faceX + 0.08, 3.96, cz + r);
    group.add(post);
  }
  const upperFaceX = faceX - 0.36;
  for (const wz of [cz - 1.85, cz, cz + 1.85]) {
    const wFrame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.54, 1.32), railMat);
    wFrame.position.set(upperFaceX + 0.04, 5.05, wz);
    const wPane = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.36, 1.14), warmWindowMat);
    wPane.position.set(upperFaceX + 0.08, 5.05, wz);
    group.add(wFrame, wPane);
  }
  const bladeSign = createTextSign('青春茶饮 · 二楼自习', 1.48, 0.38, {
    background: '#fff4ec',
    foreground: '#2b2420',
    resolution: 256,
  });
  // 挂在二楼靠北侧立面 (z = cz - 2.45)，避开门口 z = -37 的路边电线杆
  bladeSign.position.set(faceX + 0.24, 4.95, cz - 2.45);
  bladeSign.rotation.set(0, 0, Math.PI / 2);
  if (bladeSign.material instanceof THREE.MeshStandardMaterial) {
    bladeSign.material.emissive.setHex(0xffc98e);
    bladeSign.material.emissiveMap = bladeSign.material.map;
    bladeSign.material.emissiveIntensity = 0.2;
    bladeSign.material.side = THREE.DoubleSide;
    ctx.registerNightMaterial?.(bladeSign.material, 0.18, 0.86);
  }
  const bladeArm = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 0.06), railMat);
  bladeArm.position.set(faceX - 0.04, 4.95, cz - 2.45);
  const milkteaDownspout = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 6.4, 8), railMat);
  milkteaDownspout.position.set(faceX - 0.08, 3.2, cz - 2.95);
  group.add(bladeSign, bladeArm, milkteaDownspout);

  // 2. 半开放式大号浅木点单窗口 + 内凹暖光吧台
  const winZ = cz - 0.3;
  const counterBack = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 1.55),
    new THREE.MeshStandardMaterial({ color: 0xffe4cf, emissive: 0xffb37e, emissiveIntensity: 0.36, roughness: 0.85 }),
  );
  counterBack.position.set(faceX + 0.04, 1.58, winZ);
  counterBack.rotation.y = Math.PI / 2;
  group.add(counterBack);

  const barCounter = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.94, 3.32), woodMat);
  barCounter.position.set(faceX + 0.2, 0.47, winZ);
  barCounter.castShadow = true;
  barCounter.receiveShadow = true;
  group.add(barCounter);

  const awning = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.08, 3.8), accentMat);
  awning.position.set(faceX + 0.42, 2.38, winZ);
  awning.rotation.z = -0.18;
  awning.castShadow = true;
  group.add(awning);

  // 3. 白底黑字主招牌「青春茶饮」+ 副标 + 圆形珍珠奶茶 LOGO 灯箱 + 粉橙小灯串 + 小彩旗
  const mainSign = createTextSign('青春茶饮', 2.4, 0.56, { background: '#ffffff', foreground: '#1e2226', resolution: 320 });
  mainSign.position.set(faceX + 0.18, 2.94, winZ);
  mainSign.rotation.y = Math.PI / 2;
  group.add(mainSign);

  const subSign = createTextSign('TEA · 奶茶 · 果茶 · 鲜榨', 2.2, 0.22, { background: '#fff4ec', foreground: '#d45a36', resolution: 256 });
  subSign.position.set(faceX + 0.17, 2.64, winZ);
  subSign.rotation.y = Math.PI / 2;
  group.add(subSign);

  const cupLogo = createPosterMesh(0.56, 0.56, (c, w2, h2) => {
    c.fillStyle = '#fff9f2';
    c.beginPath();
    c.arc(w2 / 2, h2 / 2, w2 * 0.46, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#f28258';
    c.lineWidth = 8;
    c.stroke();
    // 卡通珍珠奶茶杯
    c.fillStyle = '#e8c49a';
    c.fillRect(w2 * 0.34, h2 * 0.34, w2 * 0.32, h2 * 0.42);
    c.fillStyle = '#fff9f0';
    c.fillRect(w2 * 0.32, h2 * 0.28, w2 * 0.36, h2 * 0.1);
    c.fillStyle = '#241e1a';
    for (const px of [0.4, 0.48, 0.56]) {
      c.beginPath();
      c.arc(w2 * px, h2 * 0.7, 5, 0, Math.PI * 2);
      c.fill();
    }
    c.strokeStyle = '#e05842';
    c.lineWidth = 6;
    c.beginPath();
    c.moveTo(w2 * 0.54, h2 * 0.3);
    c.lineTo(w2 * 0.64, h2 * 0.14);
    c.stroke();
  }, 0xffb38a, 0.42);
  cupLogo.position.set(faceX + 0.18, 2.94, winZ - 1.62);
  cupLogo.rotation.y = Math.PI / 2;
  group.add(cupLogo);

  addStringLights(group, 'milktea-lights', faceX + 0.82, 2.26, winZ - 1.85, winZ + 1.85, 12, 0xff9ec2);
  addBuntingFlags(group, 'milktea-bunting', faceX + 0.84, 2.18, winZ - 1.85, winZ + 1.85, 12, [0xffa6c4, 0xff9b54, 0xfff8f0]);

  // 4. 门口核心：约 1.6m 高巨型立体珍珠奶茶杯 + 吧台上的奶茶杯/配料桶/封口机
  const gx = faceX + 0.58;
  const gz = cz + 1.78;
  const giantBase = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.14, 14), createMatteMaterial(0xf48d5c, 0.75));
  giantBase.position.set(gx, 0.12, gz);
  const giantLiquid = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.19, 0.96, 14), createMatteMaterial(0xe8c196, 0.7));
  giantLiquid.position.set(gx, 0.68, gz);
  const giantCup = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.21, 1.06, 14), glassMat);
  giantCup.position.set(gx, 0.72, gz);
  const giantCream = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8), createMatteMaterial(0xfff9f0, 0.82));
  giantCream.position.set(gx, 1.24, gz);
  giantCream.scale.set(1, 0.55, 1);
  const giantStraw = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.62, 8), createMatteMaterial(0xe65242, 0.65));
  giantStraw.position.set(gx + 0.06, 1.52, gz + 0.04);
  giantStraw.rotation.z = -0.22;
  group.add(giantBase, giantLiquid, giantCup, giantCream, giantStraw);

  const boxes: BoxPart[] = [];
  const cyls: BoxPart[] = [];
  const spheres: BoxPart[] = [];
  // 巨杯底部黑珍珠
  for (let p = 0; p < 8; p += 1) {
    const a = (p / 8) * Math.PI * 2;
    spheres.push({ position: { x: gx + Math.cos(a) * 0.12, y: 0.28, z: gz + Math.sin(a) * 0.12 }, scale: { x: 0.048, y: 0.048, z: 0.048 }, color: 0x1d1918 });
  }

  // 吧台台面（y = 0.94）：4 杯彩色奶茶 + 3 只大配料桶（黑珍珠/芋圆/奶盖）+ 封口机 + 纸杯摞
  for (const [idx, cupHex] of [0xfff5e4, 0xd9a878, 0x9bd662, 0xf7c242].entries()) {
    const cz2 = winZ - 1.15 + idx * 0.24;
    cyls.push(
      { position: { x: faceX + 0.26, y: 1.04, z: cz2 }, scale: { x: 0.042, y: 0.16, z: 0.042 }, color: cupHex },
      { position: { x: faceX + 0.26, y: 1.16, z: cz2 }, scale: { x: 0.006, y: 0.12, z: 0.006 }, rotation: { x: 0.2, y: 0, z: 0 }, color: 0xe65645 },
    );
  }
  for (const [idx, bHex] of [0x221d1c, 0xd8a8e6, 0xfffaf0].entries()) {
    cyls.push({ position: { x: faceX + 0.22, y: 1.06, z: winZ + 0.08 + idx * 0.24 }, scale: { x: 0.082, y: 0.22, z: 0.082 }, color: bHex });
  }
  boxes.push({ position: { x: faceX + 0.2, y: 1.1, z: winZ + 0.92 }, scale: { x: 0.24, y: 0.3, z: 0.22 }, color: 0xe8edf0 });
  cyls.push({ position: { x: faceX + 0.24, y: 1.08, z: winZ + 1.24 }, scale: { x: 0.048, y: 0.26, z: 0.048 }, color: 0xf9f2ea });

  // 5. 菜单黑板 + 「第二杯半价」海报 + 休憩小圆桌与高脚凳、橙白遮阳伞
  const teaMenu = createPosterMesh(0.48, 0.66, (c, w2, h2) => {
    c.fillStyle = '#2c3532';
    c.fillRect(0, 0, w2, h2);
    c.strokeStyle = '#c48f5a';
    c.lineWidth = 8;
    c.strokeRect(4, 4, w2 - 8, h2 - 8);
    c.fillStyle = '#ffd584';
    c.font = 'bold 24px "YT Sans", sans-serif';
    c.textAlign = 'center';
    c.fillText('今日推荐', w2 / 2, 42);
    c.fillStyle = '#ffffff';
    c.font = '19px "YT Sans", sans-serif';
    ['珍珠奶茶 8元', '柠檬茶 6元', '芒果果茶 9元', '芋圆奶茶 10元'].forEach((t2, idx) => c.fillText(t2, w2 / 2, 84 + idx * 32));
  });
  teaMenu.position.set(faceX + 0.06, 1.48, winZ - 1.98);
  teaMenu.rotation.y = Math.PI / 2;
  group.add(teaMenu);

  const promo = createCleanLabel(['第二杯半价', '学生特惠'], 0.48, 0.44, '#ff8ea8', '#ffffff', '#ffffff');
  promo.position.set(faceX + 0.06, 1.46, winZ + 2.02);
  promo.rotation.y = Math.PI / 2;
  group.add(promo);

  // 门口休憩圆桌 + 2 个彩色凳 + 遮阳伞
  const tx = faceX + 0.68;
  const tz = cz - 2.32;
  cyls.push(
    { position: { x: tx, y: 0.36, z: tz }, scale: { x: 0.04, y: 0.72, z: 0.04 }, color: 0x3b4448 },
    { position: { x: tx, y: 0.74, z: tz }, scale: { x: 0.34, y: 0.04, z: 0.34 }, color: 0xfff8f0 },
    { position: { x: tx, y: 0.24, z: tz - 0.46 }, scale: { x: 0.14, y: 0.46, z: 0.14 }, color: 0xf48d5c },
    { position: { x: tx, y: 0.24, z: tz + 0.46 }, scale: { x: 0.14, y: 0.46, z: 0.14 }, color: 0xf5a8bf },
    { position: { x: tx, y: 0.82, z: tz - 0.08 }, scale: { x: 0.036, y: 0.12, z: 0.036 }, color: 0xe8c196 },
    { position: { x: tx, y: 0.82, z: tz + 0.08 }, scale: { x: 0.036, y: 0.12, z: 0.036 }, color: 0x9bd662 },
    // 遮阳伞杆与伞顶
    { position: { x: tx, y: 1.42, z: tz }, scale: { x: 0.025, y: 1.4, z: 0.025 }, color: 0xdfe4e6 },
  );
  const umbrella = new THREE.Mesh(new THREE.ConeGeometry(0.76, 0.28, 8), accentMat);
  umbrella.position.set(tx, 2.16, tz);
  umbrella.castShadow = true;
  group.add(umbrella);

  ctx.registerShopLight?.({
    x: faceX + 0.85,
    y: 1.85,
    z: winZ,
    color: 0xffbd82,
    intensity: 1.5,
    distance: 4.8,
    decay: 2,
  });

  buildColoredBatch(group, 'milktea-boxes', new THREE.BoxGeometry(1, 1, 1), createMatteMaterial(0xffffff, 0.78), boxes, true);
  buildColoredBatch(group, 'milktea-cyls', new THREE.CylinderGeometry(1, 1, 1, 12), createMatteMaterial(0xffffff, 0.72), cyls, true);
  buildColoredBatch(group, 'milktea-spheres', new THREE.SphereGeometry(1, 10, 8), createMatteMaterial(0xffffff, 0.74), spheres, true);

  const contacts = createContactShadowDiscBatch('milktea-contacts', [
    { x: gx, z: gz, radius: 0.36, y: 0.065 },
    { x: tx, z: tz, radius: 0.65, y: 0.065 },
  ]);
  if (contacts) group.add(contacts);

  // 确保复用局部几何/材质引用无未用警告
  void getFacadeBrickMaterial;
  void getPlasterMaterial;
  void SHARED_RESOURCE_FLAG;
}

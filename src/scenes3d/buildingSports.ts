// scenes3d/buildingSports.ts —— 教学楼两侧空地（S7/S8）运动场改造：
// 空地 A（左侧）：标准网球场 + 围网 + 照明灯杆 + 裁判椅/记分牌/长椅/球拍网球
// 空地 B（右侧）：标准篮球场（衔接原有篮架并补齐篮网与完整标线）+ 足球门 + 乒乓球台 + 单双杠 + 塑胶跑道 + 健身器材 + 看台

import * as THREE from 'three';
import { createTextSign } from './shared';

interface SportsBoxPart {
  p: readonly [number, number, number];
  s: readonly [number, number, number];
  c: number;
  r?: readonly [number, number, number];
}

function bindDispose(geometry: THREE.BufferGeometry, mesh: THREE.InstancedMesh): void {
  const release = (): void => {
    mesh.dispose();
    geometry.removeEventListener('dispose', release);
  };
  geometry.addEventListener('dispose', release);
}

function addColoredInstances(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  parts: SportsBoxPart[],
  castShadow = true,
): THREE.InstancedMesh | null {
  if (parts.length === 0) {
    geometry.dispose();
    return null;
  }
  const mesh = new THREE.InstancedMesh(geometry, material, parts.length);
  const t = new THREE.Object3D();
  const c = new THREE.Color();
  parts.forEach((part, idx) => {
    t.position.set(part.p[0], part.p[1], part.p[2]);
    t.scale.set(part.s[0], part.s[1], part.s[2]);
    if (part.r) t.rotation.set(part.r[0], part.r[1], part.r[2]);
    else t.rotation.set(0, 0, 0);
    t.updateMatrix();
    mesh.setMatrixAt(idx, t.matrix);
    mesh.setColorAt(idx, c.setHex(part.c));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  bindDispose(geometry, mesh);
  parent.add(mesh);
  return mesh;
}

function addRodPart(
  list: SportsBoxPart[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  radius: number,
  color: number,
): void {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const dir = end.clone().sub(start);
  const len = dir.length();
  if (len < 0.0001) return;
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.divideScalar(len)),
  );
  const mid = start.add(end).multiplyScalar(0.5);
  list.push({
    p: [mid.x, mid.y, mid.z],
    s: [radius, len, radius],
    r: [euler.x, euler.y, euler.z],
    c: color,
  });
}

function addArcLine(
  lines: SportsBoxPart[],
  cx: number,
  y: number,
  cz: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  segments: number,
  lineWidth: number,
  color = 0xfafaf6,
): void {
  for (let i = 0; i < segments; i += 1) {
    const a0 = startAngle + ((endAngle - startAngle) * i) / segments;
    const a1 = startAngle + ((endAngle - startAngle) * (i + 1)) / segments;
    const x0 = cx + Math.cos(a0) * radius;
    const z0 = cz + Math.sin(a0) * radius;
    const x1 = cx + Math.cos(a1) * radius;
    const z1 = cz + Math.sin(a1) * radius;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz) + lineWidth * 0.35;
    const yaw = Math.atan2(dx, dz);
    lines.push({
      p: [(x0 + x1) / 2, y, (z0 + z1) / 2],
      s: [lineWidth, 0.006, len],
      r: [0, yaw, 0],
      c: color,
    });
  }
}

export interface BasketballCourtOptions {
  courtColor?: number;
  width?: number;
  depth?: number;
  hoopDir?: 1 | -1;
}

/** 通用标准化半场/单元篮球场拼接器：供 building 与 gate 共享几何规格，统一由外部 InstancedMesh 合批渲染 */
export function appendBasketballHalfCourt(
  boxes: SportsBoxPart[],
  rods: SportsBoxPart[],
  cx: number,
  cz: number,
  gy: number,
  ly: number,
  options: BasketballCourtOptions = {},
): void {
  const courtW = options.width ?? 4.6;
  const courtD = options.depth ?? 8.4;
  const dir = options.hoopDir ?? -1;
  const lineW = 0.045;
  const lineColor = 0xf8f8f2;
  const hw = courtW / 2 - 0.28;
  const hd = courtD / 2 - 0.28;

  boxes.push(
    { p: [cx, gy - 0.002, cz], s: [courtW + 0.22, 0.016, courtD + 0.22], c: 0x3b4744 },
    { p: [cx, gy + 0.006, cz], s: [courtW, 0.016, courtD], c: options.courtColor ?? 0x3f6a52 },
  );
  // 边线 + 端线 + 前后场分隔
  boxes.push(
    { p: [cx, ly, cz - hd], s: [hw * 2 + lineW, 0.006, lineW], c: lineColor },
    { p: [cx, ly, cz + hd], s: [hw * 2 + lineW, 0.006, lineW], c: lineColor },
    { p: [cx - hw, ly, cz], s: [lineW, 0.006, hd * 2], c: lineColor },
    { p: [cx + hw, ly, cz], s: [lineW, 0.006, hd * 2], c: lineColor },
  );
  const endZ = cz + dir * hd;
  const ftZ = endZ - dir * 1.95;
  const keyW = 1.65;
  boxes.push(
    { p: [cx, gy + 0.01, (endZ + ftZ) / 2], s: [keyW, 0.008, 1.95], c: 0xc4604a },
    { p: [cx - keyW / 2, ly + 0.001, (endZ + ftZ) / 2], s: [lineW, 0.006, 1.95], c: lineColor },
    { p: [cx + keyW / 2, ly + 0.001, (endZ + ftZ) / 2], s: [lineW, 0.006, 1.95], c: lineColor },
    { p: [cx, ly + 0.001, ftZ], s: [keyW + lineW, 0.006, lineW], c: lineColor },
  );
  const startA = dir < 0 ? 0 : Math.PI;
  const endA = dir < 0 ? Math.PI : Math.PI * 2;
  addArcLine(boxes, cx, ly + 0.001, ftZ, keyW / 2, startA, endA, 12, lineW, lineColor);
  addArcLine(boxes, cx, ly + 0.001, endZ - dir * 0.48, 2.35, startA + 0.22, endA - 0.22, 16, lineW, lineColor);

  const hoopZ = endZ + dir * 0.26;
  const boardZ = hoopZ - dir * 0.48;
  const rimZ = boardZ - dir * 0.22;
  rods.push(
    { p: [cx, gy + 1.56, hoopZ], s: [0.075, 3.12, 0.075], c: 0xe67e35 },
    { p: [cx, gy + 3.02, (hoopZ + boardZ) / 2], s: [0.055, 0.52, 0.055], r: [Math.PI / 2, 0, 0], c: 0xe67e35 },
  );
  boxes.push(
    { p: [cx, gy + 2.98, boardZ], s: [1.28, 0.82, 0.07], c: 0xf4f7f8 },
    { p: [cx, gy + 2.88, boardZ - dir * 0.04], s: [0.46, 0.32, 0.015], c: 0xd9483b },
    { p: [cx, gy + 2.68, rimZ], s: [0.38, 0.032, 0.38], c: 0xe8652c },
  );
  for (let w = 0; w < 6; w += 1) {
    const ang = (w * Math.PI * 2) / 6;
    addRodPart(
      rods,
      [cx + Math.cos(ang) * 0.16, gy + 2.67, rimZ + Math.sin(ang) * 0.16],
      [cx + Math.cos(ang) * 0.09, gy + 2.35, rimZ + Math.sin(ang) * 0.09],
      0.01,
      0xfafaf6,
    );
  }
}

/** 绘制支持节点 Mock 的篮球半场标线到 1024² 双色合一贴图（左半深绿 #3f6a52，右半铁红 #a4553f） */
function createCheckerCourtMaterial(): THREE.MeshStandardMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const drawHalf = (ox: number, hw: number, bg: string): void => {
      const h = 1024;
      ctx.fillStyle = bg;
      ctx.fillRect(ox, 0, hw, h);

      // 1m 缓冲边界内绘米白标线 #efe6d2
      const padX = Math.round(hw * 0.06);
      const padY = Math.round(h * 0.06);
      const cw = hw - padX * 2;
      const ch = h - padY * 2;
      const lw = 5;
      ctx.fillStyle = '#efe6d2';
      ctx.fillRect(ox + padX, padY, cw, lw);
      ctx.fillRect(ox + padX, padY + ch - lw, cw, lw);
      ctx.fillRect(ox + padX, padY, lw, ch);
      ctx.fillRect(ox + padX + cw - lw, padY, lw, ch);

      // 三秒限制区（底部为篮架端线）
      const baseY = padY + ch;
      const keyW = Math.round(cw * 0.34);
      const keyH = Math.round(ch * 0.42);
      const kx = ox + Math.round(hw / 2 - keyW / 2);
      ctx.fillRect(kx, baseY - keyH, lw, keyH);
      ctx.fillRect(kx + keyW - lw, baseY - keyH, lw, keyH);
      ctx.fillRect(kx, baseY - keyH, keyW, lw);

      // 罚球圈与三分弧（仅使用 fillRect/beginPath/arc/fill，兼容测试 Mock）
      const cx = ox + hw / 2;
      const drawRingArc = (acy: number, rOuter: number, rInner: number, a0: number, a1: number): void => {
        ctx.beginPath();
        ctx.arc(cx, acy, rOuter, a0, a1, false);
        ctx.arc(cx, acy, rInner, a1, a0, true);
        ctx.closePath();
        ctx.fill();
      };
      drawRingArc(baseY - keyH, keyW * 0.5, Math.max(4, keyW * 0.5 - lw), Math.PI, Math.PI * 2);
      const threeR = Math.min(cw * 0.45, ch * 0.72);
      const arcBaseY = baseY - Math.round(ch * 0.08);
      drawRingArc(arcBaseY, threeR, threeR - lw, Math.PI * 1.07, Math.PI * 1.93);
      ctx.fillRect(cx - threeR, arcBaseY, lw, baseY - arcBaseY);
      ctx.fillRect(cx + threeR - lw, arcBaseY, lw, baseY - arcBaseY);
      drawRingArc(padY, Math.round(cw * 0.14), Math.max(4, Math.round(cw * 0.14) - lw), 0, Math.PI);
    };
    drawHalf(0, 512, '#3f6a52');
    drawHalf(512, 512, '#a4553f');
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0, envMapIntensity: 0.24 });
  mat.addEventListener('dispose', () => tex.dispose());
  return mat;
}

/** 菱形铁丝围网 & 篮网 alphaTest 0.5 贴图（零透明排序错乱） */
function createWireMeshMaterial(): THREE.MeshStandardMaterial {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect?.(0, 0, size, size);
    ctx.fillStyle = '#32463e';
    for (let i = 0; i < size; i += 16) {
      ctx.fillRect(i, 0, 2, size);
      ctx.fillRect(0, i, size, 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 5);
  tex.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    color: 0xffffff,
    alphaTest: 0.5,
    transparent: false,
    roughness: 0.72,
    side: THREE.DoubleSide,
  });
  mat.addEventListener('dispose', () => tex.dispose());
  return mat;
}

/** 构建 0.04m 倒角圆角的单片篮球场形状网格并并入单批次缓冲 */
function buildMergedCheckerCourts(
  specs: ReadonlyArray<{ x: number; z: number; w: number; d: number; y: number; red: boolean; hoopDir: 1 | -1 }>,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const r = 0.04;
  for (const spec of specs) {
    const hw = spec.w / 2;
    const hd = spec.d / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-hw + r, -hd);
    shape.lineTo(hw - r, -hd);
    shape.quadraticCurveTo(hw, -hd, hw, -hd + r);
    shape.lineTo(hw, hd - r);
    shape.quadraticCurveTo(hw, hd, hw - r, hd);
    shape.lineTo(-hw + r, hd);
    shape.quadraticCurveTo(-hw, hd, -hw, hd - r);
    shape.lineTo(-hw, -hd + r);
    shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
    const geo = new THREE.ShapeGeometry(shape, 2);
    const pos = geo.getAttribute('position');
    const baseVertex = positions.length / 3;
    const uMin = spec.red ? 0.504 : 0.004;
    const uMax = spec.red ? 0.996 : 0.496;
    for (let i = 0; i < pos.count; i += 1) {
      const lx = pos.getX(i);
      const ly = pos.getY(i);
      const uNorm = (lx + hw) / spec.w;
      const vNorm = spec.hoopDir < 0 ? 1 - (ly + hd) / spec.d : (ly + hd) / spec.d;
      positions.push(spec.x + lx, spec.y, spec.z + ly);
      normals.push(0, 1, 0);
      uvs.push(uMin + uNorm * (uMax - uMin), vNorm);
    }
    const idx = geo.getIndex();
    if (idx) {
      for (let i = 0; i < idx.count; i += 3) {
        indices.push(baseVertex + idx.getX(i), baseVertex + idx.getX(i + 2), baseVertex + idx.getX(i + 1));
      }
    }
    geo.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  merged.setIndex(indices);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * 参数化 2×2 棋盘式四片篮球场构造器（空地 A 左侧，S8 起步可见）：
 * 控制总增量 ≤ 3500 三角面、≤ 6 DrawCall（合批面层 + 合批箱体 + 合批杆件 + alphaTest 围网/篮网 + 绿篱与篮球 + 指示牌）。
 */
export function buildLeftBasketballComplex(parent: THREE.Object3D): void {
  const minX = -33.4;
  const maxX = -9.4;
  const minZ = -6.5;
  const maxZ = 12.5;
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  const courtW = 10.8;
  const courtD = 8.3;
  const colX = [midX - 6.4, midX + 6.4] as const;
  const rowZ = [midZ - 5.35, midZ + 5.35] as const;
  const gy = -0.026;

  // 1. DrawCall 1：四片倒角硅 PU 棋盘格面层合批（绿-红-红-绿，1024² CanvasTexture 烘入标线）
  const courtSpecs = [
    { x: colX[0], z: rowZ[0], w: courtW, d: courtD, y: gy, red: false, hoopDir: -1 as const },
    { x: colX[1], z: rowZ[0], w: courtW, d: courtD, y: gy, red: true, hoopDir: -1 as const },
    { x: colX[0], z: rowZ[1], w: courtW, d: courtD, y: gy, red: true, hoopDir: 1 as const },
    { x: colX[1], z: rowZ[1], w: courtW, d: courtD, y: gy, red: false, hoopDir: 1 as const },
  ];
  const surfaceGeo = buildMergedCheckerCourts(courtSpecs);
  const surfaceMesh = new THREE.Mesh(surfaceGeo, createCheckerCourtMaterial());
  surfaceMesh.name = 'building-left-courts-surface';
  surfaceMesh.castShadow = false;
  surfaceMesh.receiveShadow = true;
  parent.add(surfaceMesh);

  const boxes: SportsBoxPart[] = [];
  const rods: SportsBoxPart[] = [];
  const fencePanels: SportsBoxPart[] = [];
  const hedgeBalls: SportsBoxPart[] = [];

  // 2. 四副标准后置篮架（立柱 Ø0.12m/高 3.05m、1.2m 悬臂、1.8×1.05m 白底黑框篮板、Ø0.45m 橙圈与篮网）
  for (const spec of courtSpecs) {
    const dir = spec.hoopDir;
    const baseZ = spec.z + dir * (courtD / 2 - 0.12);
    const boardZ = baseZ - dir * 1.15;
    const rimZ = boardZ - dir * 0.24;
    boxes.push(
      { p: [spec.x, 0.02, baseZ], s: [0.5, 0.1, 0.5], c: 0x9aa09a },
      { p: [spec.x, 3.35, boardZ], s: [1.8, 1.05, 0.04], c: 0x1e2428 },
      { p: [spec.x, 3.35, boardZ - dir * 0.012], s: [1.7, 0.95, 0.04], c: 0xf7f8f5 },
      { p: [spec.x, 3.24, boardZ - dir * 0.036], s: [0.59, 0.45, 0.014], c: 0x1e2428 },
      { p: [spec.x, 3.24, boardZ - dir * 0.044], s: [0.49, 0.35, 0.012], c: 0xf7f8f5 },
    );
    rods.push(
      { p: [spec.x, 1.54, baseZ], s: [0.06, 3.05, 0.06], c: 0x3b484d },
      { p: [spec.x, 3.32, (baseZ + boardZ) / 2], s: [0.048, 1.2, 0.048], r: [Math.PI / 2, 0, 0], c: 0x3b484d },
      { p: [spec.x, 2.75, (baseZ + boardZ) / 2], s: [0.03, 1.25, 0.03], r: [dir * 0.68, 0, 0], c: 0x3b484d },
    );
    for (let s = 0; s < 6; s += 1) {
      const a0 = (s * Math.PI * 2) / 6;
      const a1 = ((s + 1) * Math.PI * 2) / 6;
      addRodPart(
        rods,
        [spec.x + Math.cos(a0) * 0.225, 3.04, rimZ + Math.sin(a0) * 0.225],
        [spec.x + Math.cos(a1) * 0.225, 3.04, rimZ + Math.sin(a1) * 0.225],
        0.014,
        0xe2703a,
      );
    }
    fencePanels.push(
      { p: [spec.x, 2.84, rimZ], s: [0.36, 0.36, 1], r: [0, 0, 0], c: 0xf2f4f2 },
      { p: [spec.x, 2.84, rimZ], s: [0.36, 0.36, 1], r: [0, Math.PI / 2, 0], c: 0xf2f4f2 },
    );
  }

  // 3. 外侧三面 4m 高围网 + 靠近步道东侧 1.2m 矮围网（留 1.2m 入口门），间隔 3m 立柱
  const addFenceSpan = (x0: number, z0: number, x1: number, z1: number, height: number): void => {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const spans = Math.max(1, Math.round(len / 3.0));
    for (let i = 0; i <= spans; i += 1) {
      const t = i / spans;
      rods.push({ p: [x0 + dx * t, height / 2, z0 + dz * t], s: [0.03, height, 0.03], c: 0x2c423b });
    }
    fencePanels.push({
      p: [(x0 + x1) / 2, height / 2, (z0 + z1) / 2],
      s: [len, height, 1],
      r: [0, yaw + Math.PI / 2, 0],
      c: 0x3b594e,
    });
  };
  addFenceSpan(minX, minZ + 1.2, minX, maxZ - 1.2, 4.0);
  addFenceSpan(minX + 1.2, minZ, maxX - 1.2, minZ, 4.0);
  addFenceSpan(minX + 1.2, maxZ, maxX - 1.2, maxZ, 4.0);
  addFenceSpan(maxX, minZ, maxX, 2.2, 1.2);
  addFenceSpan(maxX, 3.4, maxX, maxZ, 1.2);

  // 4. 4 根 6m 高球场灯柱（暖白 4000K 灯头下倾 15°，无实时 PointLight）
  for (const [lx, lz, inward] of [
    [minX - 0.35, midZ - 4.8, 1],
    [minX - 0.35, midZ + 4.8, 1],
    [maxX + 0.35, midZ - 4.8, -1],
    [maxX + 0.35, midZ + 4.8, -1],
  ] as const) {
    rods.push({ p: [lx, 3.0, lz], s: [0.07, 6.0, 0.07], c: 0x3b464a });
    boxes.push(
      { p: [lx, 0.14, lz], s: [0.32, 0.28, 0.32], c: 0x858a84 },
      { p: [lx + inward * 0.26, 5.95, lz], s: [0.58, 0.1, 0.38], r: [0, 0, -inward * 0.26], c: 0x3b464a },
      { p: [lx + inward * 0.28, 5.88, lz], s: [0.46, 0.04, 0.28], r: [0, 0, -inward * 0.26], c: 0xfff2d6 },
    );
  }

  // 5. 场边陪衬：2 张长椅 + 1 个双龙头饮水台 + 1 个三球架 + (-10.4,-6.8) 补树坑矮花坛 + 1 块入口牌
  for (const bz of [0.4, 5.8]) {
    const bx = maxX - 0.72;
    boxes.push(
      { p: [bx, 0.42, bz], s: [0.42, 0.055, 1.6], c: 0xb9824f },
      { p: [bx + 0.18, 0.7, bz], s: [0.05, 0.32, 1.6], c: 0xb9824f },
      { p: [bx, 0.21, bz - 0.64], s: [0.38, 0.42, 0.06], c: 0x374245 },
      { p: [bx, 0.21, bz + 0.64], s: [0.38, 0.42, 0.06], c: 0x374245 },
    );
  }
  const fx = maxX - 0.55;
  const fz = 1.65;
  boxes.push(
    { p: [fx, 0.45, fz], s: [0.45, 0.9, 0.6], c: 0x9aa3a0 },
    { p: [fx, 0.92, fz], s: [0.48, 0.05, 0.64], c: 0xd9dfe0 },
  );
  rods.push(
    { p: [fx - 0.06, 1.0, fz - 0.14], s: [0.018, 0.12, 0.018], c: 0xc5ced1 },
    { p: [fx - 0.06, 1.0, fz + 0.14], s: [0.018, 0.12, 0.018], c: 0xc5ced1 },
  );
  const rx = maxX - 0.55;
  const rz = 4.25;
  boxes.push(
    { p: [rx, 0.55, rz - 0.55], s: [0.05, 1.1, 0.05], c: 0x3b4548 },
    { p: [rx, 0.55, rz + 0.55], s: [0.05, 1.1, 0.05], c: 0x3b4548 },
    { p: [rx, 0.72, rz], s: [0.3, 0.04, 1.12], c: 0x3b4548 },
  );
  for (const [idx, dz] of [-0.34, 0, 0.34].entries()) {
    hedgeBalls.push({ p: [rx, 0.86, rz + dz], s: [0.12, 0.12, 0.12], c: [0xe2703a, 0xc8602c, 0xd46a34][idx] });
  }
  for (let i = 0; i < 19; i += 1) {
    const hz = minZ + 0.5 + i * 1.0;
    if (hz > 2.0 && hz < 3.6) continue;
    hedgeBalls.push({ p: [maxX + 0.42, 0.38, hz], s: [0.3, 0.42, 0.56], c: i % 2 === 0 ? 0x5c8456 : 0x6f9664 });
  }
  boxes.push(
    { p: [-10.4, 0.03, -7.2], s: [0.9, 0.08, 0.6], c: 0x8e928b },
    { p: [-10.4, 0.075, -7.2], s: [0.78, 0.02, 0.48], c: 0x5c4f3e },
  );
  for (const [idx, dx] of [-0.22, 0, 0.22].entries()) {
    hedgeBalls.push({ p: [-10.4 + dx, 0.24, -7.2 + (idx % 2) * 0.06], s: [0.18, 0.18, 0.18], c: idx % 2 === 0 ? 0x678a5d : 0x7c9c6b });
  }
  boxes.push({ p: [maxX + 0.35, 0.62, 2.05], s: [0.06, 1.24, 0.06], c: 0x3b4548 });
  const signMesh = createTextSign('篮球场 · 1-4', 0.5, 0.9, { background: '#264d3b', foreground: '#f7f3e6', resolution: 256 });
  signMesh.name = 'building-left-courts-sign';
  signMesh.position.set(maxX + 0.39, 1.08, 2.05);
  signMesh.rotation.y = Math.PI / 2;
  if (signMesh.material instanceof THREE.MeshStandardMaterial) {
    signMesh.material.emissive.setHex(0xffffff);
    signMesh.material.emissiveMap = signMesh.material.map;
    signMesh.material.emissiveIntensity = 0.25;
  }
  parent.add(signMesh);

  addColoredInstances(parent, 'building-left-courts-boxes', new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84 }), boxes, true);
  addColoredInstances(parent, 'building-left-courts-rods', new THREE.CylinderGeometry(1, 1, 1, 5, 1, true), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.64, metalness: 0.2 }), rods, true);
  addColoredInstances(parent, 'building-left-courts-fence-nets', new THREE.PlaneGeometry(1, 1), createWireMeshMaterial(), fencePanels, false);
  addColoredInstances(parent, 'building-left-courts-hedge-balls', new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86 }), hedgeBalls, true);
}

/** 网球场微颗粒丙烯酸与标准翻页记分牌贴图辅助 */
function createTennisSurfaceMaterial(): THREE.MeshStandardMaterial {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = 238 + ((i * 37) % 18);
      img.data[i] = n;
      img.data[i + 1] = n + 1;
      img.data[i + 2] = n - 2;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 8);
  tex.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.86, metalness: 0, envMapIntensity: 0.2 });
  mat.addEventListener('dispose', () => tex.dispose());
  return mat;
}

function createScoreboardFaceMaterial(): THREE.MeshStandardMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#243036';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#faf8f2';
    ctx.fillRect(18, 22, 92, 84);
    ctx.fillRect(146, 22, 92, 84);
    ctx.fillStyle = '#20262b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 54px sans-serif';
    ctx.fillText('0', 64, 66);
    ctx.fillText('0', 192, 66);
    ctx.fillStyle = '#e6eef2';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('-', 128, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.68, metalness: 0.04 });
  mat.addEventListener('dispose', () => tex.dispose());
  return mat;
}

/**
 * 校门东侧（+X，父亲身旁空场）标准网球场 + 周边运动休闲区：
 * 含外圈墨绿/内场深绿颗粒丙烯酸面层、深色压边、标准白线、1.07m/0.914m 球网网柱、3.2m 菱形围网+小门、
 * 4 根 6m 照明灯杆、高脚裁判椅、0-0 记分牌、2 条休息长椅、网球/球拍/水壶/毛巾及环绕步行道与花坛。
 */
export function buildRightTennisComplex(parent: THREE.Object3D): void {
  const cx = 17.5;
  const cz = 4.1;
  const walkW = 13.4;
  const walkD = 16.8;
  const outerW = 11.7;
  const outerD = 15.1;
  const courtW = 8.2; // 标准双打边线比例
  const courtD = 12.6;
  const singleHalfW = 3.25;
  const halfW = courtW / 2;
  const halfD = courtD / 2;
  const serviceZ = 3.45;
  const gy = -0.028;
  const ly = -0.014;
  const lineColor = 0xfafaf6;
  const lw = 0.05;

  const surfaces: SportsBoxPart[] = [
    { p: [cx, gy, cz], s: [outerW, 0.012, outerD], c: 0x356b52 },
    { p: [cx, gy + 0.005, cz], s: [courtW, 0.012, courtD], c: 0x2c835c },
  ];
  addColoredInstances(parent, 'building-right-tennis-surface', new THREE.BoxGeometry(1, 1, 1), createTennisSurfaceMaterial(), surfaces, false);

  const boxes: SportsBoxPart[] = [
    // 环绕浅色步行道 + 深色压边/路缘过渡
    { p: [cx, gy - 0.01, cz], s: [walkW, 0.012, walkD], c: 0xc5c8bf },
    { p: [cx, gy - 0.004, cz], s: [outerW + 0.36, 0.014, outerD + 0.36], c: 0x3b4744 },
    // 白色标准网球场划线（5cm 细条）：端线、双打/单打边线、发球线、中线、两端中点
    { p: [cx, ly, cz - halfD], s: [courtW + lw, 0.006, lw], c: lineColor },
    { p: [cx, ly, cz + halfD], s: [courtW + lw, 0.006, lw], c: lineColor },
    { p: [cx - halfW, ly, cz], s: [lw, 0.006, courtD], c: lineColor },
    { p: [cx + halfW, ly, cz], s: [lw, 0.006, courtD], c: lineColor },
    { p: [cx - singleHalfW, ly, cz], s: [lw, 0.006, courtD], c: lineColor },
    { p: [cx + singleHalfW, ly, cz], s: [lw, 0.006, courtD], c: lineColor },
    { p: [cx, ly, cz - serviceZ], s: [singleHalfW * 2, 0.006, lw], c: lineColor },
    { p: [cx, ly, cz + serviceZ], s: [singleHalfW * 2, 0.006, lw], c: lineColor },
    { p: [cx, ly, cz], s: [lw, 0.006, serviceZ * 2], c: lineColor },
    { p: [cx, ly, cz - halfD + 0.18], s: [lw, 0.006, 0.34], c: lineColor },
    { p: [cx, ly, cz + halfD - 0.18], s: [lw, 0.006, 0.34], c: lineColor },
  ];
  const rods: SportsBoxPart[] = [];
  const spheres: SportsBoxPart[] = [];
  const fencePanels: SportsBoxPart[] = [];

  // 球网（柱顶 1.07m，中央高 0.914m，白色上沿带 + 白色中心带）
  const netHalfW = halfW + 0.45;
  for (const sx of [-1, 1]) {
    rods.push({ p: [cx + sx * netHalfW, 0.52, cz], s: [0.045, 1.07, 0.045], c: 0x22322d });
    spheres.push({ p: [cx + sx * netHalfW, 1.07, cz], s: [0.052, 0.036, 0.052], c: 0x3a4d47 });
  }
  fencePanels.push({ p: [cx, 0.46, cz], s: [netHalfW * 2 - 0.06, 0.92, 1], r: [0, 0, 0], c: 0x264439 });
  boxes.push(
    { p: [cx - netHalfW * 0.48, 0.945, cz], s: [netHalfW * 0.96, 0.065, 0.04], r: [0, 0, -0.022], c: 0xf8f8f4 },
    { p: [cx + netHalfW * 0.48, 0.945, cz], s: [netHalfW * 0.96, 0.065, 0.04], r: [0, 0, 0.022], c: 0xf8f8f4 },
    { p: [cx, 0.46, cz], s: [0.045, 0.92, 0.048], c: 0xf8f8f4 },
  );

  // 3.2m 墨绿菱形围网（西侧靠林荫道留出带门框的 1.4m 小门）
  const fHalfW = outerW / 2 - 0.1;
  const fHalfD = outerD / 2 - 0.1;
  const fenceH = 3.2;
  const addTennisFence = (x0: number, z0: number, x1: number, z1: number): void => {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const spans = Math.max(1, Math.round(len / 2.8));
    for (let i = 0; i <= spans; i += 1) {
      const t = i / spans;
      rods.push({ p: [x0 + dx * t, fenceH / 2, z0 + dz * t], s: [0.032, fenceH, 0.032], c: 0x243b33 });
    }
    fencePanels.push({
      p: [(x0 + x1) / 2, fenceH / 2, (z0 + z1) / 2],
      s: [len, fenceH, 1],
      r: [0, yaw + Math.PI / 2, 0],
      c: 0x35584b,
    });
    boxes.push({
      p: [(x0 + x1) / 2, fenceH - 0.03, (z0 + z1) / 2],
      s: [Math.abs(dx) > Math.abs(dz) ? len : 0.055, 0.055, Math.abs(dx) > Math.abs(dz) ? 0.055 : len],
      c: 0x223830,
    });
  };
  addTennisFence(cx - fHalfW, cz - fHalfD, cx + fHalfW, cz - fHalfD);
  addTennisFence(cx - fHalfW, cz + fHalfD, cx + fHalfW, cz + fHalfD);
  addTennisFence(cx + fHalfW, cz - fHalfD, cx + fHalfW, cz + fHalfD);
  // 西侧分段留出 z ∈ [3.4, 4.8] 1.4m 宽小门框
  addTennisFence(cx - fHalfW, cz - fHalfD, cx - fHalfW, 3.4);
  addTennisFence(cx - fHalfW, 4.8, cx - fHalfW, cz + fHalfD);
  boxes.push({ p: [cx - fHalfW, 2.25, 4.1], s: [0.07, 0.06, 1.46], c: 0x223830 });

  // 4 根 6m 高球场照明灯杆（东西长边围网外侧）
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const lx = cx + sx * (fHalfW + 0.42);
      const lz = cz + sz * 4.2;
      rods.push({ p: [lx, 3.0, lz], s: [0.065, 6.0, 0.065], c: 0x354043 });
      boxes.push(
        { p: [lx, 0.14, lz], s: [0.3, 0.28, 0.3], c: 0x727a7a },
        { p: [lx - sx * 0.28, 5.95, lz], s: [0.64, 0.09, 0.68], c: 0x354043 },
        { p: [lx - sx * 0.34, 5.88, lz - 0.17], s: [0.3, 0.05, 0.22], c: 0xfff3d4 },
        { p: [lx - sx * 0.34, 5.88, lz + 0.17], s: [0.3, 0.05, 0.22], c: 0xfff3d4 },
      );
    }
  }

  // 高脚裁判椅（西边线中线外，带脚踏板与木座靠背）
  const umpX = cx - halfW - 0.68;
  boxes.push(
    { p: [umpX, 1.15, cz], s: [0.46, 0.06, 0.5], c: 0xd4a66a },
    { p: [umpX - 0.2, 1.38, cz], s: [0.06, 0.44, 0.5], c: 0xd4a66a },
    { p: [umpX + 0.28, 0.56, cz], s: [0.22, 0.04, 0.38], c: 0xa2aaa8 },
  );
  for (const dx of [-0.19, 0.19]) {
    for (const dz of [-0.21, 0.21]) {
      rods.push({ p: [umpX + dx, 0.57, cz + dz], s: [0.026, 1.16, 0.026], c: 0x525d61 });
    }
  }

  // 翻页记分牌（白底黑字 0-0，西边线近门侧）
  const sbX = cx - halfW - 0.52;
  const sbZ = cz - 1.35;
  rods.push({ p: [sbX, 0.68, sbZ], s: [0.032, 1.36, 0.032], c: 0x455054 });
  boxes.push({ p: [sbX, 1.38, sbZ], s: [0.06, 0.42, 0.72], c: 0x263238 });
  const scoreFace = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.34), createScoreboardFaceMaterial());
  scoreFace.name = 'building-right-tennis-scoreboard';
  scoreFace.position.set(sbX - 0.036, 1.38, sbZ);
  scoreFace.rotation.y = -Math.PI / 2;
  parent.add(scoreFace);

  // 2 条休息长椅（西侧入口两侧休闲步道）+ 网球拍 ×2 + 蓝色水瓶 + 白毛巾
  for (const bz of [cz - 2.35, cz + 2.35]) {
    const bx = cx - fHalfW - 0.58;
    boxes.push(
      { p: [bx, 0.42, bz], s: [0.42, 0.06, 1.45], c: 0xb9824f },
      { p: [bx + 0.18, 0.7, bz], s: [0.06, 0.36, 1.45], c: 0xb9824f },
      { p: [bx, 0.21, bz - 0.56], s: [0.38, 0.42, 0.06], c: 0x3b4845 },
      { p: [bx, 0.21, bz + 0.56], s: [0.38, 0.42, 0.06], c: 0x3b4845 },
    );
  }
  const benchX = cx - fHalfW - 0.58;
  for (const [dz, frameCol] of [[-2.68, 0x387ec4], [-2.02, 0xd65b45]] as const) {
    rods.push(
      { p: [benchX - 0.11, 0.464, cz + dz], s: [0.016, 0.16, 0.016], c: 0x2c3336, r: [0, 0, Math.PI / 2] },
      { p: [benchX + 0.04, 0.464, cz + dz], s: [0.105, 0.018, 0.13], c: frameCol },
      { p: [benchX + 0.04, 0.465, cz + dz], s: [0.082, 0.019, 0.105], c: 0xe8ecef },
    );
  }
  rods.push({ p: [benchX - 0.02, 0.52, cz + 1.95], s: [0.04, 0.18, 0.04], c: 0x3fa8d6 });
  boxes.push({ p: [benchX, 0.46, cz + 2.25], s: [0.22, 0.028, 0.36], c: 0xfaf8f2 });

  // 散落地面荧光黄绿网球 ×3
  for (const [tx, tz] of [
    [cx - 1.4, cz - 2.4],
    [cx + 1.8, cz + 2.8],
    [cx + 0.5, cz - 0.4],
  ]) {
    spheres.push({ p: [tx, gy + 0.048, tz], s: [0.044, 0.044, 0.044], c: 0xd9f241 });
  }

  // 西侧缓冲区低矮花坛与灌木，自然嵌入校园草地
  for (const pz of [cz - 6.2, cz + 6.2]) {
    const px = cx - fHalfW - 0.55;
    boxes.push(
      { p: [px, 0.12, pz], s: [0.95, 0.24, 1.9], c: 0x96766a },
      { p: [px, 0.25, pz], s: [1.02, 0.05, 1.98], c: 0xdfdac9 },
    );
    for (let s = 0; s < 3; s += 1) {
      spheres.push({ p: [px, 0.42, pz - 0.55 + s * 0.55], s: [0.34, 0.28, 0.36], c: s % 2 === 0 ? 0x678a5d : 0x7c9c6b });
    }
  }

  addColoredInstances(parent, 'building-right-tennis-boxes', new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84 }), boxes, true);
  addColoredInstances(parent, 'building-right-tennis-rods', new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.2 }), rods, true);
  addColoredInstances(parent, 'building-right-tennis-spheres', new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72 }), spheres, true);
  addColoredInstances(parent, 'building-right-tennis-fence', new THREE.PlaneGeometry(1, 1), createWireMeshMaterial(), fencePanels, false);
}

export function buildBuildingSportsFields(parent: THREE.Object3D): void {
  buildLeftBasketballComplex(parent);
  buildRightTennisComplex(parent);
  const boxes: SportsBoxPart[] = [];
  const rods: SportsBoxPart[] = [];
  const spheres: SportsBoxPart[] = [];
  const nets: SportsBoxPart[] = [];
  const lineColor = 0xf8f8f2;

  /* ==========================================================================
   * 空地 B（右侧）：标准篮球场 + 综合运动区
   * 衔接原有右侧篮球架 (x = 24.4, z = -11.2)，向西/南扩展形成：
   *   1. 标准篮球场（塑胶蓝绿场 + 完整白线 + 双侧篮网与另一端篮架）
   *   2. 五人制小足球区（浅绿草皮 + 小足球门 + 黑白足球）
   *   3. 室外乒乓球台 ×2 + 高低单杠/双杠 + 漫步机 + 跑道外圈 + 看台长椅 + 路锥
   * ======================================================================== */
  {
    const bcx = 20.6;
    const bcz = -16.8;
    const bOuterW = 9.4;
    const bOuterD = 12.8;
    const gy = -0.036;
    const ly = -0.027;

    // 运动区外圈红棕塑胶跑道圈（含白色跑道分道线）
    const trackW = 14.2;
    const trackD = 20.6;
    const tcx = 21.0;
    const tcz = -18.0;
    boxes.push(
      { p: [tcx, gy - 0.012, tcz], s: [trackW + 0.36, 0.012, trackD + 0.36], c: 0x454e4b },
      { p: [tcx, gy - 0.006, tcz], s: [trackW, 0.012, trackD], c: 0xb65d48 },
      // 白色跑道分道线
      { p: [tcx - trackW / 2 + 0.65, ly - 0.003, tcz], s: [lwConst(), 0.005, trackD - 0.4], c: lineColor },
      { p: [tcx + trackW / 2 - 0.65, ly - 0.003, tcz], s: [lwConst(), 0.005, trackD - 0.4], c: lineColor },
      { p: [tcx, ly - 0.003, tcz - trackD / 2 + 0.65], s: [trackW - 0.4, 0.005, lwConst()], c: lineColor },
      { p: [tcx, ly - 0.003, tcz + trackD / 2 - 0.65], s: [trackW - 0.4, 0.005, lwConst()], c: lineColor },
    );

    // 1. 标准篮球场主体（塑胶蓝绿内场 + 暖红三秒区）
    boxes.push(
      { p: [bcx, gy, bcz], s: [bOuterW + 0.35, 0.014, bOuterD + 0.35], c: 0x394946 },
      { p: [bcx, gy + 0.004, bcz], s: [bOuterW, 0.014, bOuterD], c: 0x2f758a },
    );

    const bw = bOuterW - 0.8; // 8.6m
    const bd = bOuterD - 0.9; // 11.9m
    const bhw = bw / 2;
    const bhd = bd / 2;
    const lw = 0.05;
    // 边线 + 端线 + 中线
    boxes.push(
      { p: [bcx, ly, bcz - bhd], s: [bw + lw, 0.006, lw], c: lineColor },
      { p: [bcx, ly, bcz + bhd], s: [bw + lw, 0.006, lw], c: lineColor },
      { p: [bcx - bhw, ly, bcz], s: [lw, 0.006, bd], c: lineColor },
      { p: [bcx + bhw, ly, bcz], s: [lw, 0.006, bd], c: lineColor },
      { p: [bcx, ly, bcz], s: [bw + 0.28, 0.006, lw], c: lineColor },
    );
    // 中圈
    addArcLine(boxes, bcx, ly, bcz, 1.25, 0, Math.PI * 2, 24, lw, lineColor);

    // 南北两端：三秒限制区 + 罚球线 + 罚球半圆 + 三分线圆弧
    for (const dir of [-1, 1]) {
      const endZ = bcz + dir * bhd;
      const ftZ = endZ - dir * 2.5;
      const keyW = 2.4;
      // 三秒区暖红底色
      boxes.push({ p: [bcx, gy + 0.007, (endZ + ftZ) / 2], s: [keyW, 0.01, 2.5], c: 0xc25b49 });
      // 限制区边界与罚球线
      boxes.push(
        { p: [bcx - keyW / 2, ly + 0.001, (endZ + ftZ) / 2], s: [lw, 0.006, 2.5], c: lineColor },
        { p: [bcx + keyW / 2, ly + 0.001, (endZ + ftZ) / 2], s: [lw, 0.006, 2.5], c: lineColor },
        { p: [bcx, ly + 0.001, ftZ], s: [keyW + lw, 0.006, lw], c: lineColor },
      );
      // 罚球半圆 + 三分弧
      const startA = dir < 0 ? 0 : Math.PI;
      const endA = dir < 0 ? Math.PI : Math.PI * 2;
      addArcLine(boxes, bcx, ly + 0.001, ftZ, keyW / 2, startA, endA, 14, lw, lineColor);
      addArcLine(boxes, bcx, ly + 0.001, endZ - dir * 0.7, 3.6, startA + 0.14, endA - 0.14, 20, lw, lineColor);

      // 标准篮球架（南北各一副：橙色立柱 + 白透明篮板框 + 橙色篮圈 + 白色篮网）
      const hoopZ = endZ + dir * 0.35;
      const boardZ = hoopZ - dir * 0.62;
      const rimZ = boardZ - dir * 0.24;
      rods.push(
        { p: [bcx, 1.78, hoopZ], s: [0.09, 3.56, 0.09], c: 0xe67e35 },
        { p: [bcx, 3.4, (hoopZ + boardZ) / 2], s: [0.06, 0.65, 0.06], r: [Math.PI / 2, 0, 0], c: 0xe67e35 },
      );
      boxes.push(
        { p: [bcx, 3.38, boardZ], s: [1.56, 0.98, 0.08], c: 0xf4f7f8 },
        { p: [bcx, 3.26, boardZ - dir * 0.045], s: [0.56, 0.38, 0.015], c: 0xd9483b },
        { p: [bcx, 3.04, rimZ], s: [0.46, 0.036, 0.46], c: 0xe8652c },
      );
      // 白色圆锥形篮网（用 6 根斜向白丝组成，直观醒目）
      for (let w = 0; w < 6; w += 1) {
        const ang = (w * Math.PI * 2) / 6;
        addRodPart(
          rods,
          [bcx + Math.cos(ang) * 0.2, 3.03, rimZ + Math.sin(ang) * 0.2],
          [bcx + Math.cos(ang) * 0.11, 2.66, rimZ + Math.sin(ang) * 0.11],
          0.012,
          0xfafaf6,
        );
      }
    }

    // 2. 五人制小足球区（南侧跑道旁草皮：x = 17.5, z = -25.8）
    const fz = -25.8;
    const fx = 17.4;
    boxes.push({ p: [fx, gy + 0.004, fz], s: [5.4, 0.012, 3.6], c: 0x62a357 });
    // 小足球门（白框 + 网）
    const gw = 2.4;
    const gh = 1.45;
    const gd = 0.75;
    rods.push(
      { p: [fx - gw / 2, gh / 2, fz - 1.2], s: [0.045, gh, 0.045], c: 0xfafaf6 },
      { p: [fx + gw / 2, gh / 2, fz - 1.2], s: [0.045, gh, 0.045], c: 0xfafaf6 },
      { p: [fx, gh, fz - 1.2], s: [0.045, gw, 0.045], r: [0, 0, Math.PI / 2], c: 0xfafaf6 },
      { p: [fx - gw / 2, gh / 2, fz - 1.2 - gd], s: [0.03, gh, 0.03], c: 0xd8e0e2 },
      { p: [fx + gw / 2, gh / 2, fz - 1.2 - gd], s: [0.03, gh, 0.03], c: 0xd8e0e2 },
    );
    nets.push(
      { p: [fx, gh / 2, fz - 1.2 - gd], s: [gw, gh, 0.02], c: 0xeef3f5 },
      { p: [fx, gh, fz - 1.2 - gd / 2], s: [gw, 0.02, gd], c: 0xeef3f5 },
    );
    // 黑白相间足球 ×2
    for (const [sx, sz] of [[fx - 0.5, fz + 0.45], [fx + 0.7, fz + 0.75]]) {
      spheres.push({ p: [sx, gy + 0.12, sz], s: [0.12, 0.12, 0.12], c: 0xf5f5f5 });
      spheres.push({ p: [sx + 0.04, gy + 0.15, sz + 0.04], s: [0.05, 0.05, 0.05], c: 0x222629 });
    }

    // 3. 室外乒乓球台 ×2（东南角区域 x = 23.6, z = -25.4 / -27.2）
    for (const pz of [-25.0, -27.1]) {
      const px = 23.4;
      boxes.push(
        { p: [px, 0.76, pz], s: [2.35, 0.05, 1.32], c: 0x2665a8 },
        { p: [px, 0.788, pz], s: [2.35, 0.008, 0.035], c: 0xfafaf6 },
        { p: [px, 0.788, pz - 0.64], s: [2.35, 0.008, 0.03], c: 0xfafaf6 },
        { p: [px, 0.788, pz + 0.64], s: [2.35, 0.008, 0.03], c: 0xfafaf6 },
        { p: [px - 1.15, 0.788, pz], s: [0.03, 0.008, 1.32], c: 0xfafaf6 },
        { p: [px + 1.15, 0.788, pz], s: [0.03, 0.008, 1.32], c: 0xfafaf6 },
        { p: [px, 0.85, pz], s: [0.02, 0.14, 1.38], c: 0x2d353c },
      );
      for (const dx of [-0.75, 0.75]) {
        for (const dz of [-0.42, 0.42]) {
          rods.push({ p: [px + dx, 0.38, pz + dz], s: [0.032, 0.76, 0.032], c: 0x3b4448 });
        }
      }
      // 球拍 + 小白球
      boxes.push({ p: [px - 0.45, 0.8, pz + 0.25], s: [0.16, 0.02, 0.22], c: 0xd94238 });
      spheres.push({ p: [px + 0.25, 0.81, pz - 0.15], s: [0.025, 0.025, 0.025], c: 0xffa73b });
    }

    // 4. 单杠 + 双杠 + 安全垫 + 健身漫步机（x = 15.2, z = -9.6）
    const gx = 15.2;
    const gz = -9.6;
    boxes.push({ p: [gx, gy + 0.015, gz], s: [2.8, 0.03, 3.6], c: 0x45697a });
    // 高低单杠
    rods.push(
      { p: [gx - 0.9, 1.05, gz - 1.1], s: [0.04, 2.1, 0.04], c: 0x37474f },
      { p: [gx + 0.9, 1.05, gz - 1.1], s: [0.04, 2.1, 0.04], c: 0x37474f },
      { p: [gx, 2.05, gz - 1.1], s: [0.028, 1.85, 0.028], r: [0, 0, Math.PI / 2], c: 0xe68938 },
      // 双杠
      { p: [gx - 0.7, 0.65, gz + 0.4], s: [0.04, 1.3, 0.04], c: 0x37474f },
      { p: [gx + 0.7, 0.65, gz + 0.4], s: [0.04, 1.3, 0.04], c: 0x37474f },
      { p: [gx - 0.7, 0.65, gz + 1.05], s: [0.04, 1.3, 0.04], c: 0x37474f },
      { p: [gx + 0.7, 0.65, gz + 1.05], s: [0.04, 1.3, 0.04], c: 0x37474f },
      { p: [gx, 1.28, gz + 0.4], s: [0.03, 1.5, 0.03], r: [0, 0, Math.PI / 2], c: 0x3a91c9 },
      { p: [gx, 1.28, gz + 1.05], s: [0.03, 1.5, 0.03], r: [0, 0, Math.PI / 2], c: 0x3a91c9 },
    );

    // 5. 看台长椅 ×2 + 训练路锥 ×4 + 运动场高杆灯 ×2
    for (const sz of [bcz - 2.6, bcz + 2.6]) {
      const sx = bcx - bhw - 1.15;
      boxes.push(
        { p: [sx, 0.42, sz], s: [0.45, 0.06, 2.1], c: 0xc28a52 },
        { p: [sx - 0.2, 0.7, sz], s: [0.06, 0.36, 2.1], c: 0xc28a52 },
        { p: [sx, 0.21, sz - 0.85], s: [0.4, 0.42, 0.06], c: 0x3f4c49 },
        { p: [sx, 0.21, sz + 0.85], s: [0.4, 0.42, 0.06], c: 0x3f4c49 },
      );
    }
    for (const [cx2, cz2] of [[15.2, -14.2], [15.2, -15.4], [15.2, -18.2], [15.2, -19.4]]) {
      rods.push({ p: [cx2, 0.18, cz2], s: [0.1, 0.34, 0.1], c: 0xf26c29 });
      boxes.push({ p: [cx2, 0.015, cz2], s: [0.24, 0.03, 0.24], c: 0xf26c29 });
    }
  }

  addColoredInstances(parent, 'building-sports-boxes', new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 }), boxes, true);
  addColoredInstances(parent, 'building-sports-rods', new THREE.CylinderGeometry(1, 1, 1, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.2 }), rods, true);
  addColoredInstances(parent, 'building-sports-spheres', new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72 }), spheres, true);
  addColoredInstances(
    parent,
    'building-sports-nets',
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, transparent: true, opacity: 0.42 }),
    nets,
    false,
  );
}

function lwConst(): number {
  return 0.05;
}

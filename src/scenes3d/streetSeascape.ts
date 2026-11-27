// scenes3d/streetSeascape.ts —— S4 街道尽头（+Z 南端 z >= 15.5）巷道框景式沙滩海洋落日海景（纯观赏背景，不可通行）
// 构图：左侧青绿「校园水果店」与右侧复古红砖白裙楼作天然画框，尽头设石砌防波堤 + 金属栏杆 + 观景石凳/警示牌；
// 外接金黄干/湿沙滩、海星贝壳与弯曲椰树、青绿→深蓝渐变海面、太阳金色光柱、浪花带与涟漪、远山/帆船/灯塔/海雾及四层落日天空。

import * as THREE from 'three';
import { createTextSign } from './shared';

interface SeaPart {
  p: readonly [number, number, number];
  s: readonly [number, number, number];
  c: number;
  r?: readonly [number, number, number];
  q?: THREE.Quaternion;
}

export const SEASCAPE_SUNSET_PALETTE = {
  skyZenith: 0x2e5e8c,
  skyHigh: 0x4a7fa6,
  skyMiddle: 0xc97a54,
  skyHorizon: 0xf2a25c,
  skyBrightRim: 0xffd08a,
  sunCore: 0xfff6d8,
  sunInnerGlow: 0xffd37a,
  sunOuterGlow: 0xff9e4a,
  cloudLit: 0xff8a4c,
  cloudShadow: 0x6e5b8a,
  seaFar: 0x2f7e8f,
  seaNear: 0x3e9aa6,
  reflection: 0xffd98a,
  mountainFog: 0xe8a070,
  palmLeafDark: 0x2f6b3a,
  palmLeafMid: 0x3e8a46,
  palmLeafLight: 0x4fa05a,
} as const;

const SUN_LIGHT_DIRECTION = new THREE.Vector3(
  8.5,
  Math.hypot(8.5, 86) * Math.tan(THREE.MathUtils.degToRad(10)),
  86,
).normalize();

/** 供 WorldApp 按 sceneKey 接入；本模块不擅自修改全局平行光、环境光或后期。 */
export const SEASCAPE_SUNSET_LIGHTING = {
  sunDirection: [SUN_LIGHT_DIRECTION.x, SUN_LIGHT_DIRECTION.y, SUN_LIGHT_DIRECTION.z] as const,
  sunElevationDeg: 10,
  sunColor: 0xffb877,
  sunIntensity: 1.2,
  ambientColor: 0x6e7fa8,
  ambientIntensity: 0.45,
  mountainFogColor: SEASCAPE_SUNSET_PALETTE.mountainFog,
  mountainFogDensity: 0.25,
} as const;

export interface SeascapeKeepOut {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** 树干与接地沙堆的硬约束：中轴栈道、栏杆、警示牌、纪念碑与右侧红砖地标。 */
export const SEASCAPE_PALM_KEEP_OUTS: readonly SeascapeKeepOut[] = [
  { id: 'boardwalk-center', minX: -2.6, maxX: 2.6, minZ: 14.5, maxZ: 15.5 },
  { id: 'railing-seawall', minX: -3.5, maxX: 3.5, minZ: 15.45, maxZ: 16.05 },
  { id: 'warning-sign', minX: 1.15, maxX: 1.55, minZ: 15.15, maxZ: 15.55 },
  { id: 'corner-monument', minX: 2.8, maxX: 5.7, minZ: 4.3, maxZ: 6.9 },
  { id: 'left-heritage-building', minX: -11.4, maxX: -2.6, minZ: 11.35, maxZ: 18.85 },
  { id: 'right-red-brick-landmark', minX: 6.5, maxX: 15.5, minZ: 5.5, maxZ: 18.5 },
];

export type SeascapePalmKind = 'A' | 'B' | 'C' | 'D';
export type SeascapePalmLayer = 'foreground' | 'midground' | 'far';

export interface SeascapePalmCrown {
  x: number;
  z: number;
}

export interface SeascapePalmPlacement {
  id: string;
  kind: SeascapePalmKind;
  layer: SeascapePalmLayer;
  x: number;
  z: number;
  yaw: number;
  scale: number;
  tiltDeg: number;
  moundRadius: number;
  castShadow: boolean;
  crowns: readonly SeascapePalmCrown[];
}

export interface SeascapeLeafMotion {
  mesh: THREE.InstancedMesh;
  index: number;
  transform: THREE.Object3D;
  baseRotation: THREE.Euler;
  phase: number;
}

export interface SeascapeCloudMotion {
  mesh: THREE.InstancedMesh;
  index: number;
  baseMatrix: THREE.Matrix4;
  matrix: THREE.Matrix4;
  phase: number;
  drift: number;
}

export interface SeascapeLightShaftMotion {
  mesh: THREE.InstancedMesh;
  index: number;
  transform: THREE.Object3D;
  baseAngle: number;
  phase: number;
  length: number;
  width: number;
}

export interface SeascapeWaveState {
  foamBand: THREE.Mesh;
  baseZ: number;
  baseY: number;
  palms: readonly SeascapePalmPlacement[];
  leafMotions: readonly SeascapeLeafMotion[];
  lightShafts: readonly SeascapeLightShaftMotion[];
  lightShaftMaterial: THREE.MeshBasicMaterial;
  cloudMotions: readonly SeascapeCloudMotion[];
  reflectionBand: THREE.Mesh;
  reflectionBaseX: number;
  mountainFog: THREE.FogExp2;
  lighting: typeof SEASCAPE_SUNSET_LIGHTING;
}

const NOOP_RAYCAST = (): void => {};

function createSeededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createPalmFrondGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    -0.16, 0.02, 0.28,
    0, 0.06, 0.48,
    -0.52, 0, 0.58,
    0, -0.1, 1,
    0.52, 0, 0.58,
    0.16, 0.02, 0.28,
  ], 3));
  geometry.setIndex([
    0, 1, 2,
    1, 3, 2,
    3, 4, 2,
    4, 5, 2,
    5, 6, 2,
    6, 0, 2,
  ]);
  geometry.computeVertexNormals();
  return geometry;
}

function addPalmTrunk(
  parts: SeaPart[],
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
): void {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  parts.push({
    p: [midpoint.x, midpoint.y, midpoint.z],
    s: [radius, length, radius],
    c: 0x8f6644,
    q: quaternion,
  });
}

interface PalmLeafDraft {
  part: SeaPart;
  phase: number;
}

function addPalmCrown(
  drafts: PalmLeafDraft[],
  crowns: SeascapePalmCrown[],
  random: () => number,
  center: THREE.Vector3,
  yaw: number,
  scale: number,
  count: number,
  length: number,
  width: number,
  pitch: number,
): void {
  crowns.push({ x: center.x, z: center.z });
  const colors = [
    SEASCAPE_SUNSET_PALETTE.palmLeafDark,
    SEASCAPE_SUNSET_PALETTE.palmLeafMid,
    SEASCAPE_SUNSET_PALETTE.palmLeafLight,
  ];
  for (let leaf = 0; leaf < count; leaf += 1) {
    const angle = yaw + (leaf * Math.PI * 2) / count + (random() - 0.5) * 0.18;
    drafts.push({
      part: {
        p: [center.x, center.y, center.z],
        s: [width * scale, 1, length * scale],
        r: [pitch + (random() - 0.5) * 0.12, angle, (random() - 0.5) * 0.08],
        c: colors[Math.floor(random() * colors.length)],
      },
      phase: random() * Math.PI * 2,
    });
  }
}

function bindDispose(geometry: THREE.BufferGeometry, mesh: THREE.InstancedMesh): void {
  const release = (): void => {
    mesh.dispose();
    geometry.removeEventListener('dispose', release);
  };
  geometry.addEventListener('dispose', release);
}

function addColoredBatch(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  parts: SeaPart[],
  castShadow = false,
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
    if (part.q) t.quaternion.copy(part.q);
    else if (part.r) t.rotation.set(part.r[0], part.r[1], part.r[2]);
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
  mesh.raycast = NOOP_RAYCAST;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  bindDispose(geometry, mesh);
  parent.add(mesh);
  return mesh;
}

interface PalmShapeSpec {
  height: number;
  segments: number;
  radius: number;
  curveX: number;
  curveZ: number;
  fronds: number;
  frondLength: number;
  frondWidth: number;
  pitch: number;
  crowns: readonly (readonly [number, number, number])[];
}

/** 四种轮廓分别由干形、曲率、冠层数量与羽叶开张角共同区分。 */
const PALM_SHAPES: Record<SeascapePalmKind, PalmShapeSpec> = {
  A: {
    height: 4.7, segments: 5, radius: 0.15, curveX: 0.2, curveZ: -0.12,
    fronds: 8, frondLength: 2.25, frondWidth: 0.62, pitch: 0.24,
    crowns: [[0, 0, 0]],
  },
  B: {
    height: 5.4, segments: 6, radius: 0.14, curveX: -0.34, curveZ: 0.24,
    fronds: 9, frondLength: 2.4, frondWidth: 0.58, pitch: 0.31,
    crowns: [[0, 0, 0], [-0.38, -0.65, 0.28]],
  },
  C: {
    height: 4.0, segments: 4, radius: 0.18, curveX: 0.28, curveZ: 0.16,
    fronds: 11, frondLength: 2.1, frondWidth: 0.8, pitch: 0.13,
    crowns: [[0, 0, 0]],
  },
  D: {
    height: 4.9, segments: 5, radius: 0.16, curveX: -0.46, curveZ: -0.3,
    fronds: 7, frondLength: 2.55, frondWidth: 0.7, pitch: 0.39,
    crowns: [[-0.3, -0.22, 0.15], [0.38, -0.55, -0.2]],
  },
};

interface PalmAnchor {
  kind: SeascapePalmKind;
  layer: SeascapePalmLayer;
  x: number;
  z: number;
}

/** 固定锚点只承担构图，随机抖动与 yaw / scale / tilt 均由固定种子产生。 */
const PALM_ANCHORS: readonly PalmAnchor[] = [
  { kind: 'A', layer: 'foreground', x: -4.4, z: 21.9 },
  { kind: 'B', layer: 'foreground', x: 5.0, z: 22.35 },
  { kind: 'C', layer: 'midground', x: -8.5, z: 23.5 },
  { kind: 'D', layer: 'midground', x: 9.8, z: 23.4 },
  { kind: 'A', layer: 'midground', x: -4.8, z: 24.5 },
  { kind: 'B', layer: 'midground', x: 6.5, z: 24.9 },
  { kind: 'C', layer: 'midground', x: -10.8, z: 24.5 },
  { kind: 'D', layer: 'far', x: -7.0, z: 26.2 },
  { kind: 'A', layer: 'far', x: 11.5, z: 26.2 },
  { kind: 'B', layer: 'far', x: -12.5, z: 27.0 },
];

const SEASCAPE_VIEW_Z = 15.5;
const SEASCAPE_VIEW_EYE_Y = 1.6;
const SEASCAPE_SUN_X = 8.5;
const SEASCAPE_SUN_Z = 101.5;
const SEASCAPE_SUN_RADIUS = 4.2;
const SEASCAPE_SUN_Y = SEASCAPE_VIEW_EYE_Y
  + (SEASCAPE_SUN_Z - SEASCAPE_VIEW_Z) * Math.tan(THREE.MathUtils.degToRad(10));

function circleIntersectsKeepOut(
  x: number,
  z: number,
  radius: number,
  keepOut: SeascapeKeepOut,
): boolean {
  const nearestX = THREE.MathUtils.clamp(x, keepOut.minX, keepOut.maxX);
  const nearestZ = THREE.MathUtils.clamp(z, keepOut.minZ, keepOut.maxZ);
  return Math.hypot(x - nearestX, z - nearestZ) < radius;
}

function getPalmCrownRadius(shape: PalmShapeSpec, scale: number): number {
  const offsetRadius = shape.crowns.reduce(
    (largest, crown) => Math.max(largest, Math.hypot(crown[0], crown[2])),
    0,
  );
  return (shape.frondLength + offsetRadius) * scale + 0.25;
}

function isPalmSpotClear(
  x: number,
  z: number,
  moundRadius: number,
  crownRadius: number,
  placed: readonly SeascapePalmPlacement[],
): boolean {
  // 树干最大基础半径 0.207m；连同沙堆一起避开中轴两侧各 1.5m。
  const baseRadius = moundRadius + 0.22;
  if (Math.abs(x) < 1.5 + baseRadius) return false;
  if (Math.abs(x) + baseRadius > 18.5 || z + baseRadius > 28.35 || z - baseRadius < 16.1) return false;

  for (const keepOut of SEASCAPE_PALM_KEEP_OUTS) {
    if (circleIntersectsKeepOut(x, z, baseRadius, keepOut)) return false;
    if (circleIntersectsKeepOut(x, z, crownRadius, keepOut)) return false;
  }

  // 以街口朝夕阳的视线为轴，半径 12m、水平 ±20° 的扇区连同边缘余量禁植。
  const dx = x;
  const dz = z - SEASCAPE_VIEW_Z;
  const distance = Math.hypot(dx, dz);
  const sunYaw = Math.atan2(SEASCAPE_SUN_X, SEASCAPE_SUN_Z - SEASCAPE_VIEW_Z);
  const palmYaw = Math.atan2(dx, dz);
  const angleDelta = Math.abs(Math.atan2(
    Math.sin(palmYaw - sunYaw),
    Math.cos(palmYaw - sunYaw),
  ));
  const angularMargin = Math.atan(baseRadius / Math.max(distance, 0.001));
  if (distance < 12 + baseRadius
    && angleDelta < THREE.MathUtils.degToRad(20) + angularMargin) return false;

  return placed.every((palm) => Math.hypot(x - palm.x, z - palm.z)
    >= moundRadius + palm.moundRadius + 0.45);
}

function createPalmPlacements(random: () => number): SeascapePalmPlacement[] {
  const placed: SeascapePalmPlacement[] = [];
  for (const anchor of PALM_ANCHORS) {
    const shape = PALM_SHAPES[anchor.kind];
    let x = anchor.x;
    let z = anchor.z;
    let yaw = 0;
    let scale = 1;
    let tiltDeg = 0;
    let moundRadius = 0.75;
    let accepted = false;

    for (let attempt = 0; attempt < 64; attempt += 1) {
      x = anchor.x + (random() - 0.5) * 0.5;
      z = anchor.z + (random() - 0.5) * 0.42;
      yaw = random() * Math.PI * 2;
      scale = 0.85 + random() * 0.3;
      tiltDeg = -18 + random() * 36;
      moundRadius = 0.6 + random() * 0.4;
      if (isPalmSpotClear(x, z, moundRadius, getPalmCrownRadius(shape, scale), placed)) {
        accepted = true;
        break;
      }
    }

    if (!accepted) {
      // 锚点已按最宽树冠预留安全间距，兜底不改变数量与层级。
      x = anchor.x;
      z = anchor.z;
      yaw = 0;
      scale = 1;
      tiltDeg = 0;
      moundRadius = 0.75;
    }

    placed.push({
      id: `street-seascape-palm-${anchor.kind}-${placed.length + 1}`,
      kind: anchor.kind,
      layer: anchor.layer,
      x,
      z,
      yaw,
      scale,
      tiltDeg,
      moundRadius,
      castShadow: anchor.layer !== 'far' && placed.filter((palm) => palm.castShadow).length < 4,
      crowns: [],
    });
  }
  return placed;
}

function addPalmLeafBatch(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  drafts: readonly PalmLeafDraft[],
  castShadow: boolean,
): SeascapeLeafMotion[] {
  const mesh = addColoredBatch(parent, name, geometry, material, drafts.map((draft) => draft.part), castShadow);
  if (!mesh) return [];
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return drafts.map((draft, index) => {
    const part = draft.part;
    const transform = new THREE.Object3D();
    transform.position.set(part.p[0], part.p[1], part.p[2]);
    transform.scale.set(part.s[0], part.s[1], part.s[2]);
    if (part.r) transform.rotation.set(part.r[0], part.r[1], part.r[2]);
    transform.updateMatrix();
    return {
      mesh,
      index,
      transform,
      baseRotation: transform.rotation.clone(),
      phase: draft.phase,
    };
  });
}

function createSeascapeCloudGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const colors: number[] = [];
  const lit = new THREE.Color(SEASCAPE_SUNSET_PALETTE.cloudLit);
  const shadow = new THREE.Color(SEASCAPE_SUNSET_PALETTE.cloudShadow);
  const triangle = (a: readonly number[], b: readonly number[], c: readonly number[], color: THREE.Color): void => {
    for (const point of [a, b, c]) {
      positions.push(point[0], point[1], 0);
      colors.push(color.r, color.g, color.b);
    }
  };

  // 下缘为阴影紫，上缘为夕照橙；同一实例因此只含两种指定色。
  triangle([-1, -0.1], [1, -0.08], [0.75, -0.34], shadow);
  triangle([-1, -0.1], [0.75, -0.34], [-0.68, -0.32], shadow);
  triangle([-1, -0.1], [-0.7, 0.24], [-0.42, -0.16], lit);
  triangle([-0.42, -0.16], [-0.7, 0.24], [-0.18, 0.42], lit);
  triangle([-0.42, -0.16], [-0.18, 0.42], [0.22, 0.57], lit);
  triangle([-0.42, -0.16], [0.22, 0.57], [0.64, 0.28], lit);
  triangle([-0.42, -0.16], [0.64, 0.28], [1, -0.08], lit);
  triangle([-0.42, -0.16], [1, -0.08], [0.28, -0.16], lit);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createSeascapeLightShaftGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0.18, 0, 0,
    0.82, 0, 0,
    1, 1, 0,
    0, 1, 0,
  ], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}

function createSeascapeReflectionGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  // 近岸窄、远海宽，中心线随透视朝夕阳 x=8.5 收拢。
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.88, 0, -6,
    -0.32, 0, -6,
    1.35, 0, 6,
    0.15, 0, 6,
  ], 3));
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function buildStreetSunsetSeascape(
  parent: THREE.Object3D,
  occluders: THREE.Object3D[],
): SeascapeWaveState | null {
  const group = new THREE.Group();
  group.name = 'street-sunset-seascape';
  parent.add(group);

  const boxes: SeaPart[] = [];
  const cyls: SeaPart[] = [];
  const spheres: SeaPart[] = [];
  const random = createSeededRandom(0x5e4a5c0a);
  const palms = createPalmPlacements(random);
  const palmGroup = new THREE.Group();
  palmGroup.name = 'street-seascape-palms';
  group.add(palmGroup);

  /* --------------------------------------------------------------------------
   * 1. 街道尽头过渡与防波堤阻挡（z = 15.25 .. 16.05，横跨街口）
   * ------------------------------------------------------------------------ */
  // 石砌防波堤矮墙 + 顶帽（高 0.72m）+ 深色金属栏杆（高至 1.12m）
  const seawall = new THREE.Mesh(
    new THREE.BoxGeometry(6.8, 0.72, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x8e9396, roughness: 0.9 }),
  );
  seawall.name = 'street-seascape-seawall';
  seawall.position.set(0, 0.36, 15.72);
  seawall.castShadow = true;
  seawall.receiveShadow = true;
  group.add(seawall);
  occluders.push(seawall);

  boxes.push({ p: [0, 0.75, 15.72], s: [6.96, 0.08, 0.52], c: 0xb5b8b6 });
  for (let i = -5; i <= 5; i += 1) {
    cyls.push({ p: [i * 0.6, 0.96, 15.72], s: [0.024, 0.38, 0.024], c: 0x2e363b });
  }
  boxes.push(
    { p: [0, 1.14, 15.72], s: [6.4, 0.045, 0.05], c: 0x2e363b },
    { p: [0, 0.96, 15.72], s: [6.4, 0.03, 0.035], c: 0x2e363b },
  );

  // 观景石凳（左侧街角安全区）+ 「海边 · 请勿翻越」小提示牌（右侧栏杆旁）
  boxes.push(
    { p: [-1.1, 0.22, 15.1], s: [1.3, 0.44, 0.42], c: 0xa4a9a8 },
    { p: [-1.1, 0.46, 15.1], s: [1.38, 0.06, 0.48], c: 0xc2c5c2 },
  );
  cyls.push({ p: [1.35, 0.58, 15.36], s: [0.022, 1.16, 0.022], c: 0x3b4449 });
  const sign = createTextSign('海边 · 请勿翻越', 0.72, 0.28, {
    background: '#f5efe2',
    foreground: '#2b3942',
    resolution: 256,
  });
  sign.position.set(1.35, 1.14, 15.34);
  sign.rotation.y = Math.PI;
  group.add(sign);

  /* --------------------------------------------------------------------------
   * 2. 中景：金黄沙滩（z = 15.9 .. 28.5）+ 湿沙带 + 潮汐线/贝壳/海星 + 低多边形椰树
   * ------------------------------------------------------------------------ */
  boxes.push(
    // 干沙（暖金黄 + 奶油高光）
    { p: [0, -0.02, 20.8], s: [38, 0.06, 9.8], c: 0xe8cb8c },
    // 湿沙带（靠近海水 1/4 宽，深润金褐）
    { p: [0, -0.03, 27.1], s: [38, 0.05, 3.0], c: 0xc29b5b },
    // 风吹沙波纹（细长浅色低多边形面片）
    { p: [-1.2, 0.014, 18.6], s: [4.8, 0.012, 0.26], c: 0xf0d9a3, r: [0, 0.08, 0] },
    { p: [1.4, 0.014, 21.4], s: [5.4, 0.012, 0.24], c: 0xf0d9a3, r: [0, -0.06, 0] },
    { p: [-0.6, 0.014, 23.6], s: [6.2, 0.012, 0.26], c: 0xedd399, r: [0, 0.04, 0] },
    // 潮汐白色泡沫线
    { p: [0, 0.005, 25.65], s: [26, 0.012, 0.16], c: 0xf7f9fa },
  );

  // 贝壳 / 海星 / 小石子
  for (const [sx, sz, col] of [
    [-1.4, 25.2, 0xfaf7f0],
    [0.8, 25.4, 0xf48c8c],
    [1.9, 24.9, 0xfaf7f0],
    [-0.5, 24.7, 0xd9c2a3],
  ] as Array<[number, number, number]>) {
    spheres.push({ p: [sx, 0.025, sz], s: [0.11, 0.04, 0.11], c: col });
  }

  // 10 棵确定性椰树：2 前景 + 5 中景 + 3 远景；前四棵投影，其余使用接触阴影。
  const castTrunks: SeaPart[] = [];
  const contactTrunks: SeaPart[] = [];
  const castLeafDrafts: PalmLeafDraft[] = [];
  const contactLeafDrafts: PalmLeafDraft[] = [];
  const mounds: SeaPart[] = [];
  const contacts: SeaPart[] = [];

  for (const palm of palms) {
    const shape = PALM_SHAPES[palm.kind];
    const yawCos = Math.cos(palm.yaw);
    const yawSin = Math.sin(palm.yaw);
    const tiltRad = THREE.MathUtils.degToRad(palm.tiltDeg);
    const trunkParts = palm.castShadow ? castTrunks : contactTrunks;
    const rotateLocalXZ = (localX: number, localZ: number): [number, number] => [
      yawCos * localX + yawSin * localZ,
      -yawSin * localX + yawCos * localZ,
    ];
    const toWorldXZ = (localX: number, localZ: number): [number, number] => {
      const [rx, rz] = rotateLocalXZ(localX, localZ);
      return [palm.x + rx, palm.z + rz];
    };
    const trunkPoint = (t: number): THREE.Vector3 => {
      const leanX = (Math.tan(tiltRad) * shape.height * t + shape.curveX * Math.sin(Math.PI * t)) * palm.scale;
      const leanZ = shape.curveZ * Math.sin(Math.PI * 2 * t) * palm.scale;
      const [x, z] = toWorldXZ(leanX, leanZ);
      return new THREE.Vector3(x, 0.08 + shape.height * palm.scale * t, z);
    };

    for (let segment = 0; segment < shape.segments; segment += 1) {
      const t0 = segment / shape.segments;
      const t1 = (segment + 1) / shape.segments;
      addPalmTrunk(
        trunkParts,
        trunkPoint(t0),
        trunkPoint(t1),
        shape.radius * palm.scale * (1 - t0 * 0.3),
      );
    }

    const top = trunkPoint(1);
    const palmLeafDrafts: PalmLeafDraft[] = [];
    // 放置对象由本模块创建，crowns 在构建期填充；对外契约仍保持 readonly。
    const crownTargets = palm.crowns as SeascapePalmCrown[];
    for (const crown of shape.crowns) {
      const [offsetX, offsetZ] = rotateLocalXZ(crown[0] * palm.scale, crown[2] * palm.scale);
      addPalmCrown(
        palmLeafDrafts,
        crownTargets,
        random,
        new THREE.Vector3(top.x + offsetX, top.y + crown[1] * palm.scale, top.z + offsetZ),
        palm.yaw,
        palm.scale,
        shape.fronds,
        shape.frondLength,
        shape.frondWidth,
        shape.pitch,
      );
    }
    if (palm.castShadow) castLeafDrafts.push(...palmLeafDrafts);
    else contactLeafDrafts.push(...palmLeafDrafts);

    mounds.push({
      p: [palm.x, 0.012, palm.z],
      s: [palm.moundRadius, 0.12 + random() * 0.06, palm.moundRadius],
      c: 0xe8cb8c,
    });
    if (!palm.castShadow) {
      contacts.push({
        p: [palm.x, 0.016, palm.z],
        s: [palm.moundRadius * 1.12, palm.moundRadius * 1.12, 1],
        r: [-Math.PI / 2, 0, 0],
        c: 0x3c332b,
      });
    }
  }

  const palmTrunkGeometry = new THREE.CylinderGeometry(0.72, 1, 1, 7, 1);
  const palmTrunkMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.94, flatShading: true,
  });
  addColoredBatch(palmGroup, 'street-seascape-palm-trunks-cast', palmTrunkGeometry, palmTrunkMaterial, castTrunks, true);
  addColoredBatch(palmGroup, 'street-seascape-palm-trunks-contact', palmTrunkGeometry, palmTrunkMaterial, contactTrunks, false);

  const palmLeafGeometry = createPalmFrondGeometry();
  const palmLeafMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide, flatShading: true,
  });
  const leafMotions = [
    ...addPalmLeafBatch(palmGroup, 'street-seascape-palm-leaves-cast', palmLeafGeometry, palmLeafMaterial, castLeafDrafts, true),
    ...addPalmLeafBatch(palmGroup, 'street-seascape-palm-leaves-contact', palmLeafGeometry, palmLeafMaterial, contactLeafDrafts, false),
  ];

  const moundMesh = addColoredBatch(
    palmGroup,
    'street-seascape-palm-mounds',
    new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }),
    mounds,
    false,
  );
  if (moundMesh) moundMesh.receiveShadow = true;
  addColoredBatch(
    palmGroup,
    'street-seascape-palm-contacts',
    new THREE.CircleGeometry(1, 20),
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide,
    }),
    contacts,
    false,
  );

  /* --------------------------------------------------------------------------
   * 3. 远景海面（z = 27.6 .. 115）：浅青绿→深蓝渐变 + 太阳金色光柱 + 浪花 + 帆船/礁石/灯塔/远山
   * ------------------------------------------------------------------------ */
  const seaNearColor = new THREE.Color(SEASCAPE_SUNSET_PALETTE.seaNear);
  const seaFarColor = new THREE.Color(SEASCAPE_SUNSET_PALETTE.seaFar);
  const seaBands: Array<[number, number, number]> = [
    [27.6, 40.0, SEASCAPE_SUNSET_PALETTE.seaNear],
    [40.0, 60.0, seaNearColor.clone().lerp(seaFarColor, 0.45).getHex()],
    [60.0, 84.0, seaNearColor.clone().lerp(seaFarColor, 0.75).getHex()],
    [84.0, 116.0, SEASCAPE_SUNSET_PALETTE.seaFar],
  ];
  for (const [z0, z1, col] of seaBands) {
    boxes.push({
      p: [0, -0.045, (z0 + z1) / 2],
      s: [190, 0.04, z1 - z0 + 0.4],
      c: col,
    });
  }

  // 近岸浪花带（动态上下微浮 + 静态二道浪线 + 涟漪）
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xf4fbff, transparent: true, opacity: 0.86 });
  const foamBand = new THREE.Mesh(new THREE.BoxGeometry(28, 0.035, 0.55), foamMat);
  foamBand.name = 'street-seascape-foam-wave';
  foamBand.position.set(0, 0.004, 28.05);
  group.add(foamBand);

  boxes.push(
    { p: [0, -0.008, 30.8], s: [32, 0.025, 0.36], c: 0xdff5fa },
    { p: [-2.4, -0.012, 33.4], s: [8, 0.02, 0.16], c: 0xc2edf5 },
    { p: [2.8, -0.012, 34.8], s: [9, 0.02, 0.16], c: 0xc2edf5 },
  );

  // 太阳透视投影下的锥形金色反光带：长 12m，tick 以 0.5Hz 横移 ±0.08m。
  const reflectionBaseX = 1.85;
  const reflectionBand = new THREE.Mesh(
    createSeascapeReflectionGeometry(),
    new THREE.MeshBasicMaterial({
      color: SEASCAPE_SUNSET_PALETTE.reflection,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  reflectionBand.name = 'street-seascape-sun-reflection';
  reflectionBand.position.set(reflectionBaseX, 0.018, 34.2);
  group.add(reflectionBand);

  // 远景白色三角帆小船 ×2（帆受夕阳染暖橙）
  for (const [bx, bz, sc] of [[-5.6, 52, 1.0], [7.8, 72, 0.85]] as Array<[number, number, number]>) {
    boxes.push(
      { p: [bx, 0.18, bz], s: [1.5 * sc, 0.32 * sc, 0.56 * sc], c: 0xeee8dc },
      { p: [bx, 0.96, bz], s: [0.05 * sc, 1.4 * sc, 0.92 * sc], r: [0, 0.15, 0], c: 0xffd7ad },
    );
  }

  // 右侧远方礁石与红白条纹小灯塔
  spheres.push(
    { p: [14.5, 0.35, 58], s: [2.2, 0.9, 1.6], c: 0x3f4c59 },
    { p: [16.2, 0.25, 59], s: [1.4, 0.6, 1.2], c: 0x4b5866 },
  );
  cyls.push(
    { p: [14.6, 1.6, 58], s: [0.36, 1.4, 0.36], c: 0xd94b3d },
    { p: [14.6, 2.9, 58], s: [0.28, 1.2, 0.28], c: 0xfaf7f0 },
  );
  spheres.push({ p: [14.6, 3.65, 58], s: [0.32, 0.32, 0.32], c: 0xffe494 });

  // 远海晶体状山峰剪影；FogExp2 仅作为本模块局部配置导出，不写 scene.fog。
  const mountainFog = new THREE.FogExp2(SEASCAPE_SUNSET_PALETTE.mountainFog, 0.25);
  const mountainColor = new THREE.Color(0x767c9c).lerp(mountainFog.color, mountainFog.density);
  const mountainMaterial = new THREE.MeshBasicMaterial({ color: mountainColor, fog: false });
  for (const [mx, mz, mw, mh] of [
    [-28, 96, 22, 11],
    [-8, 98, 18, 8.5],
    [26, 97, 26, 12],
  ]) {
    const mountain = new THREE.Mesh(
      new THREE.ConeGeometry(mw * 0.65, mh, 5),
      mountainMaterial,
    );
    mountain.name = 'street-seascape-mountain';
    mountain.position.set(mx, mh * 0.42, mz);
    group.add(mountain);
  }

  // 海平线局部雾带使用同一雾色，保持远山可见且不污染其他场景。
  const mist = new THREE.Mesh(
    new THREE.PlaneGeometry(210, 5.5),
    new THREE.MeshBasicMaterial({
      color: mountainFog.color,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      fog: false,
      depthWrite: false,
    }),
  );
  mist.name = 'street-seascape-mountain-mist';
  mist.position.set(0, 2.4, 99);
  group.add(mist);

  /* --------------------------------------------------------------------------
   * 4. 五层霞光天空、三层太阳、7 道光柱、5 组双色多边形云（均不修改全局后期）
   * ------------------------------------------------------------------------ */
  const skyBands: Array<[number, number, number]> = [
    [0, 5.5, SEASCAPE_SUNSET_PALETTE.skyBrightRim],
    [5.5, 14, SEASCAPE_SUNSET_PALETTE.skyHorizon],
    [14, 25, SEASCAPE_SUNSET_PALETTE.skyMiddle],
    [25, 41, SEASCAPE_SUNSET_PALETTE.skyHigh],
    [41, 58, SEASCAPE_SUNSET_PALETTE.skyZenith],
  ];
  for (const [y0, y1, col] of skyBands) {
    const band = new THREE.Mesh(
      new THREE.PlaneGeometry(240, y1 - y0 + 0.5),
      new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, fog: false }),
    );
    band.name = 'street-seascape-sky-band';
    band.position.set(0, (y0 + y1) / 2, 102.5);
    group.add(band);
  }

  const sunPosition = new THREE.Vector3(SEASCAPE_SUN_X, SEASCAPE_SUN_Y, SEASCAPE_SUN_Z);
  const sunLayers: Array<{
    name: string;
    radius: number;
    color: number;
    opacity: number;
    z: number;
  }> = [
    {
      name: 'street-seascape-sun-outer-glow',
      radius: SEASCAPE_SUN_RADIUS * 3.2,
      color: SEASCAPE_SUNSET_PALETTE.sunOuterGlow,
      opacity: 0.25,
      z: 101.9,
    },
    {
      name: 'street-seascape-sun-inner-glow',
      radius: SEASCAPE_SUN_RADIUS * 1.65,
      color: SEASCAPE_SUNSET_PALETTE.sunInnerGlow,
      opacity: 0.48,
      z: 101.7,
    },
    {
      name: 'street-seascape-sun-core',
      radius: SEASCAPE_SUN_RADIUS,
      color: SEASCAPE_SUNSET_PALETTE.sunCore,
      opacity: 1,
      z: 101.5,
    },
  ];
  for (const layer of sunLayers) {
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(layer.radius, 24),
      new THREE.MeshBasicMaterial({
        color: layer.color,
        transparent: layer.opacity < 1,
        opacity: layer.opacity,
        depthWrite: layer.opacity === 1,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    sun.name = layer.name;
    sun.position.set(sunPosition.x, sunPosition.y, layer.z);
    group.add(sun);
  }

  const shaftGeometry = createSeascapeLightShaftGeometry();
  const lightShaftMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.11,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const shaftCount = 7;
  const shaftMesh = new THREE.InstancedMesh(shaftGeometry, lightShaftMaterial, shaftCount);
  shaftMesh.name = 'street-seascape-sun-light-shafts';
  shaftMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const lightShafts: SeascapeLightShaftMotion[] = [];
  for (let index = 0; index < shaftCount; index += 1) {
    const baseAngle = (index / shaftCount) * Math.PI * 2 + random() * 0.22;
    const length = 12 + random() * 10;
    const width = 0.45 + random() * 0.75;
    const transform = new THREE.Object3D();
    transform.position.set(
      sunPosition.x + Math.cos(baseAngle) * (SEASCAPE_SUN_RADIUS + 0.25),
      sunPosition.y + Math.sin(baseAngle) * (SEASCAPE_SUN_RADIUS + 0.25),
      101.2,
    );
    transform.rotation.z = baseAngle - Math.PI / 2;
    transform.scale.set(width, length, 1);
    transform.updateMatrix();
    shaftMesh.setMatrixAt(index, transform.matrix);
    shaftMesh.setColorAt(index, new THREE.Color(
      index % 2 === 0 ? SEASCAPE_SUNSET_PALETTE.sunInnerGlow : SEASCAPE_SUNSET_PALETTE.reflection,
    ));
    lightShafts.push({
      mesh: shaftMesh,
      index,
      transform,
      baseAngle,
      phase: random() * Math.PI * 2,
      length,
      width,
    });
  }
  shaftMesh.instanceMatrix.needsUpdate = true;
  if (shaftMesh.instanceColor) shaftMesh.instanceColor.needsUpdate = true;
  shaftMesh.computeBoundingBox();
  shaftMesh.computeBoundingSphere();
  shaftMesh.raycast = NOOP_RAYCAST;
  bindDispose(shaftGeometry, shaftMesh);
  group.add(shaftMesh);

  const cloudGeometry = createSeascapeCloudGeometry();
  const cloudMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, fog: false,
  });
  const cloudSpecs: Array<[number, number, number, number, number]> = [
    [-29, 31, 15, 3.4, 1.1],
    [-13, 37, 12, 3.0, 1.5],
    [28, 34, 16, 3.6, 1.25],
    [34, 39, 13, 3.1, 1.6],
    [-39, 24, 14, 3.0, 1.35],
  ];
  const cloudMesh = new THREE.InstancedMesh(cloudGeometry, cloudMaterial, cloudSpecs.length);
  cloudMesh.name = 'street-seascape-sky-clouds';
  cloudMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const cloudMotions: SeascapeCloudMotion[] = [];
  cloudSpecs.forEach(([x, y, width, height, drift], index) => {
    const transform = new THREE.Object3D();
    transform.position.set(x, y, 100.6);
    transform.rotation.z = (random() - 0.5) * 0.06;
    transform.scale.set(width, height, 1);
    transform.updateMatrix();
    cloudMesh.setMatrixAt(index, transform.matrix);
    cloudMotions.push({
      mesh: cloudMesh,
      index,
      baseMatrix: transform.matrix.clone(),
      matrix: transform.matrix.clone(),
      phase: random() * Math.PI * 2,
      drift,
    });
  });
  cloudMesh.instanceMatrix.needsUpdate = true;
  cloudMesh.computeBoundingBox();
  cloudMesh.computeBoundingSphere();
  cloudMesh.raycast = NOOP_RAYCAST;
  bindDispose(cloudGeometry, cloudMesh);
  group.add(cloudMesh);

  // 天空右上角「人」字形飞鸟剪影 ×4，与云分开保持双色云色板严格。
  const skyBirds: SeaPart[] = [];
  for (const [bx, by, sc] of [[6.5, 19, 0.9], [9.5, 21.2, 0.75], [12.2, 18.2, 0.85], [14.5, 22.5, 0.65]]) {
    skyBirds.push(
      { p: [bx - 0.55 * sc, by, 99.8], s: [1.1 * sc, 0.14 * sc, 0.1], r: [0, 0, 0.35], c: 0x2c2b3b },
      { p: [bx + 0.55 * sc, by, 99.8], s: [1.1 * sc, 0.14 * sc, 0.1], r: [0, 0, -0.35], c: 0x2c2b3b },
    );
  }
  addColoredBatch(
    group,
    'street-seascape-sky-birds',
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }),
    skyBirds,
    false,
  );

  addColoredBatch(group, 'street-seascape-boxes', new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 }), boxes, false);
  addColoredBatch(group, 'street-seascape-cyls', new THREE.CylinderGeometry(1, 1, 1, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84 }), cyls, false);
  addColoredBatch(group, 'street-seascape-spheres', new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 }), spheres, false);

  return {
    foamBand,
    baseZ: 28.05,
    baseY: 0.004,
    palms,
    leafMotions,
    lightShafts,
    lightShaftMaterial,
    cloudMotions,
    reflectionBand,
    reflectionBaseX,
    mountainFog,
    lighting: SEASCAPE_SUNSET_LIGHTING,
  };
}

export function tickStreetSeascape(wave: SeascapeWaveState | null, elapsedSec: number): void {
  if (!wave || !Number.isFinite(elapsedSec)) return;

  wave.foamBand.position.z = wave.baseZ + Math.sin(elapsedSec * 1.1) * 0.28;
  wave.foamBand.position.y = wave.baseY + Math.cos(elapsedSec * 1.6) * 0.014;
  wave.reflectionBand.position.x = wave.reflectionBaseX
    + Math.sin(elapsedSec * Math.PI * 2 * 0.5) * 0.08;

  for (const motion of wave.leafMotions) {
    const flutter = elapsedSec * 1.35 + motion.phase;
    motion.transform.rotation.set(
      motion.baseRotation.x + Math.sin(flutter) * 0.045 + Math.sin(flutter * 0.53) * 0.015,
      motion.baseRotation.y + Math.sin(flutter * 0.72) * 0.018,
      motion.baseRotation.z + Math.cos(flutter * 0.91) * 0.035,
    );
    motion.transform.updateMatrix();
    motion.mesh.setMatrixAt(motion.index, motion.transform.matrix);
    motion.mesh.instanceMatrix.needsUpdate = true;
  }

  const shaftSwing = THREE.MathUtils.degToRad(3);
  for (const motion of wave.lightShafts) {
    const angle = motion.baseAngle
      + Math.sin(elapsedSec * Math.PI * 2 / 8 + motion.phase) * shaftSwing;
    motion.transform.rotation.z = angle - Math.PI / 2;
    motion.transform.updateMatrix();
    motion.mesh.setMatrixAt(motion.index, motion.transform.matrix);
    motion.mesh.instanceMatrix.needsUpdate = true;
  }
  wave.lightShaftMaterial.opacity = 0.11 + Math.sin(elapsedSec * 0.85) * 0.018;

  for (const motion of wave.cloudMotions) {
    const dx = Math.sin(elapsedSec * 0.055 + motion.phase) * motion.drift;
    const dy = Math.sin(elapsedSec * 0.037 + motion.phase * 1.7) * 0.18;
    motion.matrix.copy(motion.baseMatrix);
    motion.matrix.setPosition(
      motion.baseMatrix.elements[12] + dx,
      motion.baseMatrix.elements[13] + dy,
      motion.baseMatrix.elements[14],
    );
    motion.mesh.setMatrixAt(motion.index, motion.matrix);
    motion.mesh.instanceMatrix.needsUpdate = true;
  }
}

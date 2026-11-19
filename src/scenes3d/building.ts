// scenes3d/building.ts —— 通往 A 栋教学楼的林荫路灰盒（S8 同行 / S9 结尾钩子）
// S8 进入后林夏胶囊体沿路线慢步前行供玩家跟随；回头可见爸爸站在校门方向（look-back-father）。

import * as THREE from 'three';
import { gsap } from 'gsap';
import type { SceneId } from '../data/storySchema';
import type {
  NavigationConfig,
  SceneRuntime,
  SceneRuntimeContext,
  SceneSpawn,
  WorldSceneDefinition,
} from '../world/worldSceneTypes';
import { createActorAnimation, createCharacterActor, createTextSign, startIdleMotion } from './shared';
import {
  getPavingMaterial,
  getPlasterMaterial,
  getBarkMaterial,
  getFoliageMaterial,
  getWindowGlassMaterial,
  getWoodFloorMaterial,
} from './materials';
import type { CharacterAnimationController } from './characterAnimation';
import type { Vec3 } from './shared';
import { createCampusMeadow, createFoliageWindMaterial } from './foliageWind';
import type { MeadowBed, WindTime } from './foliageWind';

const buildingWindTime: WindTime = { value: 0 };

/** 林夏慢行路线（XZ 平面折线，首尾即起止站位） */
const LINXIA_ROUTE: Vec3[] = [
  { x: 1.3, y: 0, z: -1 },
  { x: 1.0, y: 0, z: -12 },
  { x: 0.5, y: 0, z: -25 },
  { x: 0.1, y: 0, z: -37 },
  { x: -0.1, y: 0, z: -44 },
];

/** 路线总时长（秒），约 20–30 秒慢步 */
const WALK_DURATION_SEC = 26;
/**
 * 走路剪辑 timeScale=1 时的地面速度（米/秒）：
 * 原始前移 1.5046（模型原始单位）× 归一化缩放 1.62 ÷ 周期 2.3333s。
 * 场景中按实际路线速度反算 timeScale，保证脚不打滑。
 */
const WALK_GROUND_SPEED_MPS = 1.045;

/** 路线总长（米）：用于速度标定 */
const ROUTE_LENGTH = LINXIA_ROUTE.reduce((sum, point, index) => {
  if (index === 0) return sum;
  const previous = LINXIA_ROUTE[index - 1];
  return sum + Math.hypot(point.x - previous.x, point.z - previous.z);
}, 0);

/** 26 秒走完全程所需播放速度（≈1.58，步频加快但不失真） */
const WALK_TIME_SCALE = ROUTE_LENGTH / WALK_DURATION_SEC / WALK_GROUND_SPEED_MPS;

/** 林荫路两侧树木 */
const TREES: Array<{ x: number; z: number }> = [
  { x: -3.6, z: -4 },
  { x: 3.6, z: -14 },
  { x: -3.6, z: -24 },
  { x: 3.6, z: -34 },
];

/** A 栋教学楼立面与大门 */
const FACADE = { center: { x: 0, y: 5, z: -50 }, size: { w: 18, h: 10, d: 4 } } as const;
const DOOR = { center: { x: 0, y: 1.4, z: -47.9 }, size: { w: 2.4, h: 2.8, d: 0.2 } } as const;

/** 校门方向站着的爸爸（回头观察热点目标） */
const FATHER = { x: 0, z: 8.6 } as const;

const SPAWN: SceneSpawn = { x: 0.2, z: 1.2, yaw: 0, pitchDeg: -5 };

const NAV: NavigationConfig = {
  groundY: 0,
  bounds: { minX: -5.8, maxX: 5.8, minZ: -49.2, maxZ: 9 },
  obstacles: [
    ...TREES.map((tree, index) => ({
      id: `building-tree-${index}`,
      minX: tree.x - 0.28,
      maxX: tree.x + 0.28,
      minZ: tree.z - 0.28,
      maxZ: tree.z + 0.28,
      height: 2.6,
    })),
    { id: 'building-facade', minX: -9, maxX: 9, minZ: -52, maxZ: -48, height: 10 },
    { id: 'building-father', minX: -0.55, maxX: 0.55, minZ: 8.05, maxZ: 9.15, height: 1.78 },
  ],
};

function pointAlongRoute(progress: number): { x: number; z: number } {
  const segments: number[] = [];
  let totalLength = 0;
  for (let index = 0; index < LINXIA_ROUTE.length - 1; index += 1) {
    const a = LINXIA_ROUTE[index];
    const b = LINXIA_ROUTE[index + 1];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    segments.push(length);
    totalLength += length;
  }

  const target = Math.max(0, Math.min(1, progress)) * totalLength;
  let travelled = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const a = LINXIA_ROUTE[index];
    const b = LINXIA_ROUTE[index + 1];
    if (travelled + segments[index] >= target) {
      const t = segments[index] > 0 ? (target - travelled) / segments[index] : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    travelled += segments[index];
  }

  const last = LINXIA_ROUTE[LINXIA_ROUTE.length - 1];
  return { x: last.x, z: last.z };
}

/** 折线在指定进度处的单位切线（朝向用）；端点处回退为路线总体前进方向（-Z） */
function directionAlongRoute(progress: number): { x: number; z: number } {
  const clamped = Math.max(0, Math.min(1, progress));
  const a = pointAlongRoute(clamped);
  const b = pointAlongRoute(Math.min(1, clamped + 0.001));
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (Math.abs(dx) + Math.abs(dz) < 1e-6) return { x: 0, z: -1 };
  const length = Math.hypot(dx, dz);
  return { x: dx / length, z: dz / length };
}

/** 角度趋近（处理 ±π 环绕），用于折线拐点处的平滑转身 */
function approachAngle(current: number, target: number, t: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * t;
}

type CampusTuple = [number, number, number];
type CampusPart = { p: CampusTuple; s: CampusTuple; r?: CampusTuple; color?: number };

function campusInstances(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  parts: CampusPart[],
  castShadow = true,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, parts.length);
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  parts.forEach((part, index) => {
    transform.position.set(...part.p);
    transform.scale.set(...part.s);
    const rotation: CampusTuple = part.r ?? [0, 0, 0];
    transform.rotation.set(...rotation);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.setColorAt(index, color.setHex(part.color ?? 0xffffff));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  if (material.userData.windTime) mesh.boundingSphere!.radius += 0.04;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  // 场景卸载只释放几何；同步释放实例缓冲。
  const release = (): void => {
    mesh.dispose();
    geometry.removeEventListener('dispose', release);
  };
  geometry.addEventListener('dispose', release);
  parent.add(mesh);
  return mesh;
}

/** 共用的八边低多边形山丘：有体积的山肩、偏心峰顶与封闭山脚，共 32 个三角形。 */
function campusHorizonGeometry(): THREE.BufferGeometry {
  const foot: CampusTuple[] = [];
  const shoulder: CampusTuple[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = i * Math.PI / 4;
    foot.push([Math.cos(angle), 0, Math.sin(angle)]);
    shoulder.push([Math.cos(angle) * 0.66, 0.46 + (i % 3) * 0.045, Math.sin(angle) * 0.58]);
  }
  const positions: number[] = [];
  const triangle = (a: CampusTuple, b: CampusTuple, c: CampusTuple): void => { positions.push(...a, ...b, ...c); };
  for (let i = 0; i < 8; i += 1) {
    const next = (i + 1) % 8;
    triangle(foot[i], shoulder[i], foot[next]);
    triangle(foot[next], shoulder[i], shoulder[next]);
    triangle(shoulder[i], [0.12, 1, -0.08], shoulder[next]);
    triangle(foot[i], foot[next], [0, 0, 0]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function campusMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: CampusTuple,
  castShadow = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function campusCanvasMaterial(
  width: number,
  height: number,
  paint: (context: CanvasRenderingContext2D) => void,
  parameters: THREE.MeshStandardMaterialParameters,
  emissiveMap = false,
): THREE.MeshStandardMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context) paint(context);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({
    ...parameters, map: texture, emissiveMap: emissiveMap ? texture : null,
  });
  const release = (): void => {
    texture.dispose();
    material.removeEventListener('dispose', release);
  };
  material.addEventListener('dispose', release);
  return material;
}

function campusPosterMaterial(): THREE.MeshStandardMaterial {
  return campusCanvasMaterial(640, 288, (context) => {
    context.fillStyle = '#e9dfc9';
    context.fillRect(0, 0, 640, 288);
    const titles = ['共读一页', '午后小展', '绿荫漫步', '交流时光'];
    const subtitles = ['带一本书来', '发现身边的美', '放慢脚步', '听见不同声音'];
    const dates = ['09.08 · 午后', '09.10 · 午后', '09.12 · 清晨', '每周三 · 午后'];
    const accents = ['#bd7355', '#c49a4f', '#7d9569', '#b38172'];
    for (let i = 0; i < 4; i += 1) {
      const x = 12 + i * 157;
      context.fillStyle = '#faf2dc';
      context.fillRect(x, 12, 145, 264);
      context.fillStyle = accents[i];
      context.fillRect(x, 12, 7, 264);
      context.fillRect(x + 18, 27, 29, 4);
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      context.font = '700 21px "Microsoft YaHei", sans-serif';
      context.fillStyle = '#594739';
      context.fillText(titles[i], x + 18, 56, 116);
      context.fillStyle = accents[i];
      context.beginPath();
      context.arc(x + 78, 130, 39, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#faf2dc';
      if (i === 0) {
        context.fillRect(x + 51, 111, 23, 35);
        context.fillRect(x + 79, 111, 23, 35);
        context.fillRect(x + 74, 115, 5, 37);
      } else if (i === 1) {
        context.fillRect(x + 51, 108, 49, 43);
        context.fillStyle = accents[i];
        context.fillRect(x + 56, 113, 39, 33);
        context.fillStyle = '#faf2dc';
        context.beginPath();
        context.moveTo(x + 59, 143);
        context.lineTo(x + 74, 123);
        context.lineTo(x + 92, 143);
        context.closePath();
        context.fill();
      } else if (i === 2) {
        context.beginPath();
        context.ellipse(x + 70, 120, 11, 22, -0.6, 0, Math.PI * 2);
        context.ellipse(x + 88, 127, 10, 21, 0.6, 0, Math.PI * 2);
        context.fill();
        context.fillRect(x + 77, 131, 3, 25);
      } else {
        context.fillRect(x + 49, 108, 40, 27);
        context.fillRect(x + 67, 139, 36, 16);
        context.beginPath();
        context.moveTo(x + 55, 133);
        context.lineTo(x + 55, 143);
        context.lineTo(x + 69, 133);
        context.closePath();
        context.fill();
      }
      context.fillStyle = '#776451';
      context.font = '14px "Microsoft YaHei", sans-serif';
      context.fillText(subtitles[i], x + 18, 189, 114);
      context.fillStyle = '#d6c7ad';
      context.fillRect(x + 18, 205, 106, 1);
      context.fillStyle = accents[i];
      context.fillRect(x + 18, 223, 112, 33);
      context.fillStyle = '#fff5e0';
      context.font = '700 13px "Microsoft YaHei", sans-serif';
      context.fillText(dates[i], x + 24, 240, 100);
    }
  }, { roughness: 0.88, emissive: 0x917047, emissiveIntensity: 0.055 });
}

function campusLobbyMaterial(): THREE.MeshStandardMaterial {
  return campusCanvasMaterial(256, 384, (context) => {
    const light = context.createLinearGradient(0, 0, 0, 384);
    light.addColorStop(0, '#f8e3b0');
    light.addColorStop(0.5, '#dfc193');
    light.addColorStop(1, '#a18d76');
    context.fillStyle = light;
    context.fillRect(0, 0, 256, 384);
    context.fillStyle = '#b29b7b';
    context.fillRect(20, 67, 216, 225);
    context.fillStyle = '#e7cfa4';
    context.fillRect(40, 87, 176, 193);
    context.fillStyle = '#9e8c70';
    context.fillRect(77, 126, 102, 154);
    context.fillStyle = '#c6ad84';
    context.fillRect(90, 141, 76, 138);
    context.fillStyle = '#fff0c9';
    for (const [x, y, w, h] of [[26, 31, 204, 10], [52, 80, 152, 6], [83, 123, 90, 4]]) {
      context.fillRect(x, y, w, h);
    }
    context.fillStyle = '#e8d4b0';
    context.beginPath();
    context.moveTo(0, 384);
    context.lineTo(76, 280);
    context.lineTo(180, 280);
    context.lineTo(256, 384);
    context.closePath();
    context.fill();
    context.fillStyle = 'rgba(255, 247, 221, 0.16)';
    context.beginPath();
    context.moveTo(15, 0);
    context.lineTo(45, 0);
    context.lineTo(165, 384);
    context.lineTo(145, 384);
    context.closePath();
    context.fill();
  }, { roughness: 0.32, metalness: 0.12, emissive: 0xffdfab, emissiveIntensity: 0.46 }, true);
}

function buildBuilding(parent: THREE.Object3D): {
  occluders: THREE.Object3D[];
  actors: Record<string, THREE.Object3D>;
} {
  buildingWindTime.value = 0;
  const occluders: THREE.Object3D[] = [];
  const paving = getPavingMaterial({ repeatX: 6, repeatY: 36 });
  const plaster = getPlasterMaterial({ repeatX: 3, repeatY: 2 });
  const bark = getBarkMaterial({ repeatY: 2 });
  const foliage = getFoliageMaterial();
  const glass = getWindowGlassMaterial();
  const wood = getWoodFloorMaterial();
  const foliageWind = createFoliageWindMaterial(foliage, buildingWindTime, { base: -1, height: 2, amplitude: 0.03 });
  const lobby = campusLobbyMaterial();
  const poster = campusPosterMaterial();
  const paper = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x8c9287, roughness: 0.92 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xdfdac9, roughness: 0.86 });
  const brick = new THREE.MeshStandardMaterial({ color: 0x96766a, roughness: 0.94 });
  const sage = new THREE.MeshStandardMaterial({ color: 0x657568, roughness: 0.88 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x414e49, roughness: 0.64, metalness: 0.35 });
  const recess = new THREE.MeshStandardMaterial({ color: 0x344744, roughness: 0.92 });
  const lawn = new THREE.MeshStandardMaterial({ color: 0x869477, roughness: 1 });
  const warm = new THREE.MeshStandardMaterial({
    color: 0xddc99b, emissive: 0xc9a66d, emissiveIntensity: 0.24, roughness: 0.55,
  });
  const boxes = new Map<THREE.Material, CampusPart[]>();
  const box = (material: THREE.Material, p: CampusTuple, s: CampusTuple, color?: number): void => {
    let parts = boxes.get(material);
    if (!parts) { parts = []; boxes.set(material, parts); }
    parts.push({ p, s, color });
  };
  const detailBoxes = new Map<THREE.Material, [CampusPart[], CampusPart[]]>();
  const detailRods = new Map<THREE.Material, [CampusPart[], CampusPart[]]>();
  const collectDetail = (map: Map<THREE.Material, [CampusPart[], CampusPart[]]>, material: THREE.Material, part: CampusPart): void => {
    let sides = map.get(material);
    if (!sides) { sides = [[], []]; map.set(material, sides); }
    sides[part.p[0] < 0 ? 0 : 1].push(part);
  };
  const detailBox = (material: THREE.Material, p: CampusTuple, s: CampusTuple, color?: number, r?: CampusTuple): void => {
    collectDetail(detailBoxes, material, { p, s, color, r });
  };
  const detailRod = (material: THREE.Material, a: CampusTuple, b: CampusTuple, radius: number, color?: number): void => {
    const start = new THREE.Vector3(...a);
    const end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length < 0.0001) return;
    const rotation = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.divideScalar(length)),
    );
    const middle = start.add(end).multiplyScalar(0.5);
    collectDetail(detailRods, material, {
      p: [middle.x, middle.y, middle.z], s: [radius, length, radius],
      r: [rotation.x, rotation.y, rotation.z], color,
    });
  };
  const detailInstances = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, parts: CampusPart[], castShadow = true): THREE.InstancedMesh => {
    const mesh = campusInstances(parent, geometry, material, parts, castShadow);
    mesh.name = name;
    mesh.userData.campusDetail = true;
    mesh.computeBoundingBox();
    return mesh;
  };
  const detailSign = (text: string, w: number, h: number, p: CampusTuple, yaw = 0): THREE.Mesh => {
    const sign = createTextSign(text, w, h, { background: '#657568', foreground: '#f5e7cb' });
    sign.position.set(...p);
    sign.rotation.y = yaw;
    sign.name = `building-detail-sign-${text}`;
    sign.userData.campusDetail = true;
    parent.add(sign);
    return sign;
  };
  const plane = (material: THREE.Material, x: number, z: number, w: number, d: number, y: number): void => {
    const mesh = campusMesh(parent, new THREE.PlaneGeometry(w, d), material, [x, y, z], false);
    mesh.rotation.x = -Math.PI / 2;
  };
  plane(lawn, 0, -22, 110, 110, -0.055);
  plane(paving, 0, -20, 12, 78, -0.018);
  const inlays: CampusPart[] = [];
  for (const x of [-5.65, -2.65, 2.65, 5.65]) {
    inlays.push({ p: [x, -0.012, -20], s: [Math.abs(x) > 5 ? 0.18 : 0.075, 78, 1], r: [-Math.PI / 2, 0, 0] });
  }
  for (const z of [6, -8, -22, -36, -45.6]) {
    inlays.push({ p: [0, -0.011, z], s: [11.6, 0.16, 1], r: [-Math.PI / 2, 0, 0] });
    inlays.push({ p: [0, -0.011, z - 0.34], s: [5.3, 0.045, 1], r: [-Math.PI / 2, 0, 0] });
  }
  campusInstances(parent, new THREE.PlaneGeometry(1, 1), recess, inlays, false);

  const pockets = [{ x: -9.5, z: -14 }, { x: 9.6, z: -29 }, { x: -10, z: -37 }];
  const pocketPaving = getPavingMaterial({ repeatX: 3, repeatY: 4 });
  for (const pocket of pockets) {
    const side = Math.sign(pocket.x);
    plane(pocketPaving, pocket.x, pocket.z, 7, 7.6, -0.026);
    box(brick, [pocket.x + side * 2.75, 0.21, pocket.z], [0.6, 0.42, 6.4]);
    box(cream, [pocket.x + side * 2.75, 0.46, pocket.z], [0.74, 0.08, 6.55]);
    const x = pocket.x + side * 0.75;
    for (let slat = 0; slat < 5; slat += 1) {
      box(wood, [x - 0.28 + slat * 0.14, 0.48, pocket.z], [0.115, 0.075, 2.65]);
    }
    for (let slat = 0; slat < 3; slat += 1) {
      box(wood, [x + side * 0.32, 0.72 + slat * 0.15, pocket.z], [0.075, 0.115, 2.65]);
    }
    for (const offset of [-1.02, 1.02]) {
      box(iron, [x, 0.24, pocket.z + offset], [0.56, 0.45, 0.065]);
      box(iron, [x + side * 0.32, 0.76, pocket.z + offset], [0.065, 0.6, 0.065]);
      box(iron, [x, 0.73, pocket.z + offset], [0.65, 0.065, 0.065]);
    }
  }

  for (const [x, z] of [[-8.2, -14.4], [8.2, -27.8]]) {
    const side = Math.sign(x);
    detailBox(stone, [x, 0.39, z], [0.44, 0.78, 0.44]);
    detailBox(cream, [x, 0.805, z], [1.35, 0.12, 1.15]);
    detailBox(stone, [x, 0.055, z], [0.7, 0.11, 0.66]);
    const chairX = x + side * 1.26;
    for (let slat = 0; slat < 4; slat += 1) {
      detailBox(wood, [chairX - 0.22 + slat * 0.145, 0.46, z], [0.12, 0.065, 0.62]);
    }
    for (const dz of [-0.23, 0.23]) {
      for (const dx of [-0.22, 0.22]) detailBox(iron, [chairX + dx, 0.23, z + dz], [0.045, 0.46, 0.045]);
      detailBox(iron, [chairX + side * 0.26, 0.72, z + dz], [0.045, 0.58, 0.045]);
    }
    for (const y of [0.7, 0.86]) detailBox(wood, [chairX + side * 0.27, y, z], [0.07, 0.12, 0.63]);
    detailBox(stone, [x, 0.23, z - 1.1], [0.35, 0.46, 0.35]);
    detailBox(wood, [x, 0.47, z - 1.1], [0.56, 0.075, 0.56]);
  }
  for (const side of [-1, 1]) {
    detailBox(paper, [-8.2 + side * 0.155, 0.885, -14.05], [0.29, 0.032, 0.39], 0xb07855, [0, 0.04, side * 0.045]);
    detailBox(paper, [-8.2 + side * 0.155, 0.906, -14.05], [0.265, 0.013, 0.36], 0xf3e6cb, [0, 0.04, side * 0.045]);
    for (let line = 0; line < 4; line += 1) {
      detailBox(paper, [-8.2 + side * 0.155, 0.917, -14.15 + line * 0.062], [0.18, 0.003, 0.006], 0xb4a48b);
    }
  }

  const planters = [
    { x: -7.3, z: -4.5, length: 5.2 }, { x: 7.4, z: -5.8, length: 4.6 },
    { x: -7.5, z: -24, length: 5.6 }, { x: 7.4, z: -18.7, length: 6 },
    { x: -7.4, z: -44.5, length: 4 }, { x: 7.6, z: -39.3, length: 6 },
  ];
  const bushes: CampusPart[] = [];
  for (const [index, bed] of planters.entries()) {
    box(brick, [bed.x, 0.18, bed.z], [1.7, 0.36, bed.length]);
    box(stone, [bed.x, 0.39, bed.z], [1.84, 0.06, bed.length + 0.12]);
    box(lawn, [bed.x, 0.425, bed.z], [1.45, 0.025, bed.length - 0.24]);
    for (let i = 0; i < 12; i += 1) {
      bushes.push({
        p: [bed.x + Math.sin(i * 2.7) * 0.35, 0.65 + (i % 3) * 0.09, bed.z - bed.length / 2 + 0.35 + i * (bed.length - 0.7) / 11],
        s: [0.58, 0.32 + (i % 3) * 0.055, 0.5], r: [0, i * 0.7, 0],
        color: [0xa6b58d, 0x91a781, 0xb2b997][(i + index) % 3],
      });
    }
  }
  campusInstances(parent, new THREE.IcosahedronGeometry(1, 1), foliage, bushes);
  const meadowBeds: MeadowBed[] = [
    { x: -7.4, z: 2, width: 1.8, depth: 4.6, y: -0.035, density: 30, flowers: 24 },
    { x: -7.4, z: -8, width: 1.8, depth: 2.8, y: -0.035, density: 30, flowers: 18 },
    { x: -7.4, z: -20, width: 1.8, depth: 2.8, y: -0.035, density: 30, flowers: 18 },
    { x: -7.4, z: -31.5, width: 1.8, depth: 2.8, y: -0.035, density: 30, flowers: 18 },
    { x: 7.4, z: 6, width: 1.8, depth: 5, y: -0.035, density: 30, flowers: 26 },
    { x: 7.4, z: -12.8, width: 1.8, depth: 3.4, y: -0.035, density: 30, flowers: 20 },
    { x: 7.4, z: -23.8, width: 1.8, depth: 2.4, y: -0.035, density: 30, flowers: 18 },
    { x: 7.4, z: -44.6, width: 1.8, depth: 3.2, y: -0.035, density: 30, flowers: 20 },
    ...planters.map((bed): MeadowBed => ({
      x: bed.x - Math.sign(bed.x) * 0.5, z: bed.z, width: 0.24,
      depth: bed.length - 0.6, y: 0.444, density: 38, flowers: 12,
    })),
  ];
  createCampusMeadow(parent, 'building-meadow', meadowBeds, buildingWindTime);

  const grove = [
    ...TREES.map((tree) => ({ ...tree, size: 1 })),
    { x: -8.5, z: 5.5, size: 1.05 }, { x: 8.7, z: 1.8, size: 1.12 },
    { x: -10.4, z: -6.8, size: 1.2 }, { x: 7.9, z: -10.6, size: 1.1 },
    { x: -12, z: -20.5, size: 1.08 }, { x: 10.5, z: -20, size: 1.28 },
    { x: -8.6, z: -29.5, size: 1.15 }, { x: 12.6, z: -34.3, size: 1.03 },
    { x: -12, z: -41.3, size: 1.18 }, { x: 8.2, z: -42.1, size: 1.16 },
    { x: -17, z: -11, size: 1.4 }, { x: 17.2, z: -45, size: 1.3 },
  ];
  const trunks: CampusPart[] = [];
  const branches: CampusPart[] = [];
  const crowns: CampusPart[] = [];
  const leafTips: CampusPart[] = [];
  const shadePatches: CampusPart[] = [];
  for (const [index, tree] of grove.entries()) {
    const size = tree.size;
    trunks.push({ p: [tree.x, 1.9 * size, tree.z], s: [0.23 * size, 3.8 * size, 0.23 * size] });
    for (let i = 0; i < 3; i += 1) {
      const angle = i * 2.1 + index * 0.8;
      branches.push({
        p: [tree.x + Math.sin(angle) * 0.4 * size, 3.8 * size, tree.z + Math.cos(angle) * 0.4 * size],
        s: [0.095 * size, 1.9 * size, 0.095 * size], r: [Math.cos(angle) * 0.65, 0, -Math.sin(angle) * 0.65],
      });
    }
    for (let i = 0; i < 13; i += 1) {
      const angle = i * 2.399 + index * 0.73;
      const radius = (i < 8 ? 1.28 : 0.65) * size;
      const x = tree.x + Math.cos(angle) * radius;
      const z = tree.z + Math.sin(angle) * radius * 0.83;
      const y = (i < 8 ? 4.65 + (i % 3) * 0.2 : 5.75 + (i % 2) * 0.2) * size;
      crowns.push({
        p: [x, y, z], s: [(1.05 + (i % 3) * 0.14) * size, (0.8 + (i % 2) * 0.13) * size, 1.07 * size],
        r: [0.12, angle, 0.1], color: [0x9dac87, 0xb2bd94, 0x8fa681, 0xbdc49e][(index + i) % 4],
      });
      for (let tip = 0; tip < 4; tip += 1) {
        const a = angle + tip * 1.57;
        leafTips.push({
          p: [x + Math.cos(a) * 1.03 * size, y + Math.sin(i + tip) * 0.55 * size, z + Math.sin(a) * size],
          s: [0.48 * size, 0.23 * size, 0.36 * size], r: [0.25, a, 0.3],
          color: [0xaebd8e, 0x96ad7d, 0xc2c89d][(i + tip) % 3],
        });
      }
    }
    for (let i = 0; i < 18; i += 1) {
      const a = i * 2.399 + index;
      const radius = 0.3 + (i % 6) * 0.36;
      shadePatches.push({
        p: [tree.x + 7.8 * size + Math.cos(a) * radius, -0.006, tree.z - 6.4 * size + Math.sin(a) * radius],
        s: [0.22 + (i % 4) * 0.12, 0.2 + (i % 3) * 0.15, 1], r: [-Math.PI / 2, 0, a],
      });
    }
  }
  const trunkMesh = campusInstances(parent, new THREE.CylinderGeometry(0.72, 1, 1, 9), bark, trunks);
  occluders.push(trunkMesh);
  campusInstances(parent, new THREE.CylinderGeometry(0.35, 1, 1, 7), bark, branches);
  campusInstances(parent, new THREE.IcosahedronGeometry(1, 1), foliageWind, crowns);
  campusInstances(parent, new THREE.IcosahedronGeometry(1, 0), foliageWind, leafTips);
  const shade = new THREE.MeshBasicMaterial({ color: 0x374d3c, transparent: true, opacity: 0.075, depthWrite: false });
  const dapple = campusInstances(parent, new THREE.CircleGeometry(1, 9), shade, shadePatches, false);
  dapple.raycast = () => {};
  const fallenLeaves: CampusPart[] = [];
  for (let i = 0; i < 100; i += 1) {
    const tree = grove[i % grove.length];
    const a = i * 2.399;
    fallenLeaves.push({
      p: [tree.x + Math.cos(a) * (0.45 + (i % 5) * 0.27), -0.002, tree.z + Math.sin(a) * 1.45],
      s: [0.025 + (i % 3) * 0.009, 0.085, 1], r: [-Math.PI / 2, 0, a],
      color: [0x99936d, 0xb4a57b, 0x798e67][i % 3],
    });
  }
  campusInstances(parent, new THREE.CircleGeometry(1, 5), cream, fallenLeaves, false);

  const understory = [
    { x: -14.5, z: -1.2, size: 0.76, height: 3.55 },
    { x: 10.9, z: 3.8, size: 0.64, height: 3.25 },
    { x: 14.7, z: -16.2, size: 0.94, height: 4.5 },
    { x: -15.5, z: -28.6, size: 0.88, height: 4.05 },
    { x: 14.8, z: -39.8, size: 1.12, height: 5.15 },
    { x: -13.8, z: -46, size: 0.8, height: 3.85 },
  ];
  const sunflecks = new THREE.MeshBasicMaterial({
    color: 0xffe4ae, transparent: true, opacity: 0.14, depthWrite: false,
  });
  for (const side of [-1, 1]) {
    const smallTrunks: CampusPart[] = [];
    const smallCrowns: CampusPart[] = [];
    const smallTips: CampusPart[] = [];
    for (const [index, tree] of understory.entries()) {
      if (Math.sign(tree.x) !== side) continue;
      smallTrunks.push({ p: [tree.x, tree.height / 2, tree.z], s: [0.19 * tree.size, tree.height, 0.19 * tree.size] });
      for (let branch = 0; branch < 3; branch += 1) {
        const a = index * 0.85 + branch * 2.1;
        detailRod(bark, [tree.x, tree.height * 0.72, tree.z],
          [tree.x + Math.cos(a) * tree.size, tree.height + 0.5 * tree.size, tree.z + Math.sin(a) * tree.size], 0.065 * tree.size);
      }
      for (let cluster = 0; cluster < 10; cluster += 1) {
        const a = cluster * 2.399 + index * 0.61;
        const radius = (cluster < 6 ? 1.22 : 0.53) * tree.size;
        const x = tree.x + Math.cos(a) * radius;
        const z = tree.z + Math.sin(a) * radius * 0.75;
        const y = tree.height + (cluster < 6 ? 0.05 + (cluster % 3) * 0.23 : 1.08 + (cluster % 2) * 0.28) * tree.size;
        smallCrowns.push({
          p: [x, y, z], s: [(0.86 + (cluster % 3) * 0.13) * tree.size, (0.62 + (index % 3) * 0.16) * tree.size, 0.91 * tree.size],
          r: [0.08 * index, a, 0.16], color: [0xb4bd8c, 0x9eb17f, 0xc1c59b, 0x889e76][(index + cluster) % 4],
        });
        for (let tip = 0; tip < 3; tip += 1) {
          const angle = a + tip * 2.1;
          smallTips.push({
            p: [x + Math.cos(angle) * 0.83 * tree.size, y + Math.sin(cluster + tip) * 0.32, z + Math.sin(angle) * 0.77 * tree.size],
            s: [0.38 * tree.size, 0.2 * tree.size, 0.34 * tree.size], r: [0.2, angle, 0.15],
            color: tip % 2 ? 0xc7ca9d : 0xa5b886,
          });
        }
      }
    }
    detailInstances(`building-understory-trunks-${side}`, new THREE.CylinderGeometry(0.72, 1, 1, 8), bark, smallTrunks);
    detailInstances(`building-understory-crowns-${side}`, new THREE.IcosahedronGeometry(1, 1), foliageWind, smallCrowns);
    detailInstances(`building-understory-tips-${side}`, new THREE.IcosahedronGeometry(1, 0), foliageWind, smallTips);
    const lightParts: CampusPart[] = [];
    const shadowParts: CampusPart[] = [];
    for (let i = 0; i < 72; i += 1) {
      const x = side * (2.26 + (i % 7) * 0.47 + Math.sin(i * 2.1) * 0.14);
      const z = 5 - (i % 12) * 4.1 + Math.sin(i * 1.71) * 1.2;
      lightParts.push({ p: [x, 0.002, z], s: [0.16 + (i % 4) * 0.09, 0.1 + (i % 3) * 0.055, 1], r: [-Math.PI / 2, 0, i * 2.399] });
      if (i % 2 === 0) {
        shadowParts.push({ p: [x + side * 0.2, 0.001, z + 0.29], s: [0.25, 0.16, 1], r: [-Math.PI / 2, 0, i * 1.77] });
      }
    }
    const lightMesh = detailInstances(`building-side-sunflecks-${side}`, new THREE.CircleGeometry(1, 9), sunflecks, lightParts, false);
    const shadeMesh = detailInstances(`building-side-shade-${side}`, new THREE.CircleGeometry(1, 8), shade, shadowParts, false);
    for (const mesh of [lightMesh, shadeMesh]) {
      mesh.receiveShadow = false;
      mesh.raycast = () => {};
    }
  }

  // 配楼内侧与前方草坪的第二排树；窄冠小乔木留在楼体外，高树在前方开阔区错落。
  const secondRow = [
    { x: -16.8, z: -8.5, height: 6.1, size: 1.3 }, { x: -25.2, z: -14.9, height: 7.1, size: 1.5 },
    { x: -11.6, z: -19.4, height: 4.4, size: 0.8 }, { x: -11.4, z: -27.5, height: 5.2, size: 0.76 },
    { x: -11.8, z: -35.8, height: 4.6, size: 0.68 }, { x: -11.5, z: -43.6, height: 6.3, size: 0.8 },
    { x: -13.1, z: -53.5, height: 7.8, size: 0.9 },
    { x: 18.7, z: -8.4, height: 7.3, size: 1.35 }, { x: 25.8, z: -10.8, height: 5.8, size: 1.25 },
    { x: 11.5, z: -18.1, height: 4.5, size: 0.78 }, { x: 12.2, z: -25.3, height: 6.2, size: 0.74 },
    { x: 11.4, z: -33.1, height: 4.8, size: 0.73 }, { x: 12.1, z: -41.4, height: 5.7, size: 0.8 },
    { x: 12.2, z: -53.3, height: 7.4, size: 0.95 },
  ];
  for (const side of [-1, 1]) {
    const rowTrunks: CampusPart[] = [];
    const rowCrowns: CampusPart[] = [];
    const rowShrubs: CampusPart[] = [];
    for (const [index, tree] of secondRow.entries()) {
      if (Math.sign(tree.x) !== side) continue;
      rowTrunks.push({ p: [tree.x, tree.height / 2, tree.z], s: [0.18 * tree.size, tree.height, 0.18 * tree.size] });
      for (let cluster = 0; cluster < 5; cluster += 1) {
        const angle = cluster * 2.399 + index * 0.63;
        const radius = cluster < 4 ? 0.53 * tree.size : 0;
        rowCrowns.push({
          p: [tree.x + Math.cos(angle) * radius, tree.height + (cluster < 4 ? 0 : 0.95) * tree.size, tree.z + Math.sin(angle) * radius],
          s: [0.98 * tree.size, (cluster < 4 ? 0.78 : 0.69) * tree.size, 0.91 * tree.size],
          r: [0.06, angle, 0.08], color: [0x91a384, 0xa8b492, 0x81997e, 0xb0bb9b][(index + cluster) % 4],
        });
      }
      for (let shrub = 0; shrub < 3; shrub += 1) {
        rowShrubs.push({
          p: [tree.x + side * (shrub - 1) * 0.35, 0.52 + (shrub % 2) * 0.2, tree.z + 1.35 + shrub * 0.58],
          s: [0.6 + shrub * 0.06, 0.48 + (shrub % 2) * 0.2, 0.67], r: [0, index + shrub, 0],
          color: [0x879b7b, 0x9aa889, 0xa3af91][(index + shrub) % 3],
        });
      }
    }
    detailInstances(`building-second-row-trunks-${side}`, new THREE.CylinderGeometry(0.65, 1, 1, 7), bark, rowTrunks);
    detailInstances(`building-second-row-crowns-${side}`, new THREE.IcosahedronGeometry(1, 0), foliageWind, rowCrowns);
    detailInstances(`building-second-row-shrubs-${side}`, new THREE.IcosahedronGeometry(1, 0), foliageWind, rowShrubs);
  }

  const horizonTrunks: CampusPart[] = [];
  const horizonCrowns: CampusPart[] = [];
  for (let layer = 0; layer < 3; layer += 1) {
    for (const side of [-1, 1]) {
      for (let tree = 0; tree < 6; tree += 1) {
        const x = side * (19.5 + layer * 9 + Math.sin(tree * 1.7) * 1.4);
        const z = 9 - tree * 12.4 + (layer % 2 ? 4.6 : 0) + Math.cos(tree * 2.3) * 1.6;
        const height = 4.6 + layer * 0.8 + (tree % 3) * 0.7;
        const size = 1.35 + layer * 0.18 + (tree % 2) * 0.2;
        horizonTrunks.push({ p: [x, height / 2, z], s: [0.2 * size, height, 0.2 * size] });
        for (let cluster = 0; cluster < 9; cluster += 1) {
          const angle = cluster * 2.399 + tree * 0.7 + layer;
          const radius = (cluster < 6 ? 1.15 : 0.48) * size;
          horizonCrowns.push({
            p: [x + Math.cos(angle) * radius, height + (cluster < 6 ? 0.2 + (cluster % 3) * 0.32 : 1.5) * size, z + Math.sin(angle) * radius],
            s: [1.2 * size, 0.85 * size, 1.12 * size], r: [0.1, angle, 0.06],
            color: [0x99ad9a, 0xa8b69e, 0xb3c2af][layer],
          });
        }
      }
    }
  }
  detailInstances('building-horizon-trunks', new THREE.CylinderGeometry(0.56, 1, 1, 7), bark, horizonTrunks, false);
  detailInstances('building-horizon-canopies', new THREE.IcosahedronGeometry(1, 0), foliageWind, horizonCrowns, false);

  const lampPoles: CampusPart[] = [];
  for (const [x, z] of [[6.55, 3], [-6.6, -11.5], [6.7, -24], [-6.6, -34], [7.1, -44.5]]) {
    lampPoles.push({ p: [x, 1.95, z], s: [0.065, 3.9, 0.065] });
    box(iron, [x, 0.14, z], [0.21, 0.28, 0.21]);
    box(iron, [x, 3.94, z], [0.62, 0.1, 0.3]);
    box(warm, [x, 3.875, z], [0.48, 0.035, 0.21]);
  }
  campusInstances(parent, new THREE.CylinderGeometry(0.75, 1, 1, 8), iron, lampPoles);

  for (const [x, z] of [[-8.1, -16.8], [8.2, -32]]) {
    for (const dx of [-1.05, 1.05]) box(iron, [x + dx, 1.1, z], [0.07, 2.2, 0.09]);
    box(iron, [x, 1.75, z], [2.6, 1.45, 0.18]);
    box(cream, [x, 1.7, z + 0.1], [2.4, 1.16, 0.04]);
    box(sage, [x, 2.46, z], [2.85, 0.1, 0.48]);
    const display = campusMesh(parent, new THREE.PlaneGeometry(2.38, 0.94), poster, [x, 1.62, z + 0.135], false);
    display.name = `building-warm-poster-${Math.sign(x)}`;
    display.userData.campusDetail = true;
    for (const dx of [-1.21, 1.21]) detailBox(iron, [x + dx, 1.62, z + 0.15], [0.025, 0.99, 0.025]);
    for (const y of [1.12, 2.12]) detailBox(iron, [x, y, z + 0.15], [2.45, 0.025, 0.025]);
    detailBox(cream, [x, 1.095, z + 0.16], [2.48, 0.045, 0.16]);
    detailBox(paper, [x + 1.13, 1.64, z + 0.16], [0.016, 0.87, 0.005], 0xf4ead3);
    detailSign('校园生活', 1.5, 0.3, [x, 2.24, z + 0.16]);
  }

  const tires: CampusPart[] = [];
  const rims: CampusPart[] = [];
  // 保留右侧车棚原位，在左侧配楼前方补一座；所有杆件、车架和轮胎仍共享原批次。
  for (const shelter of [{ x: 12.55, z: -9.7 }, { x: -17.3, z: -13.5 }]) {
    const bikeX = shelter.x;
    const bikeZ = shelter.z;
    const side = Math.sign(bikeX);
    detailBox(stone, [bikeX, -0.028, bikeZ], [3.9, 0.025, 7.65]);
    for (const x of [bikeX - 1.63, bikeX + 1.63]) {
      for (const z of [bikeZ - 3.45, bikeZ + 3.45]) {
        detailBox(iron, [x, 1.27, z], [0.075, 2.54, 0.075]);
        detailBox(stone, [x, 0.07, z], [0.25, 0.14, 0.25]);
        detailRod(iron, [x, 2.05, z], [x + (x < bikeX ? 0.4 : -0.4), 2.5, z], 0.025);
      }
    }
    detailBox(sage, [bikeX, 2.62, bikeZ], [3.65, 0.14, 7.4], 0xffffff, [0, 0, -side * 0.035]);
    detailBox(cream, [bikeX, 2.515, bikeZ], [3.42, 0.055, 7.1]);
    for (let rib = 0; rib < 15; rib += 1) detailBox(wood, [bikeX, 2.47, bikeZ - 3.35 + rib * 0.48], [3.37, 0.055, 0.045]);
    for (const x of [bikeX - 1.81, bikeX + 1.82]) detailBox(iron, [x, 2.57, bikeZ], [0.055, 0.18, 7.45]);
    detailBox(iron, [bikeX + side * 1.63, 1.02, bikeZ], [0.055, 0.055, 6.9]);
    detailSign('自行车停放', 2.15, 0.3, [bikeX - side * 1.82, 2.27, bikeZ], -side * Math.PI / 2);
    for (let bike = 0; bike < 3; bike += 1) {
      const x = bikeX + (bike % 2) * 0.12;
      const z = bikeZ - 2.3 + bike * 2.2;
      const color = [0xd5a477, 0xa3b8a6, 0xb7bdc3][bike];
      const rear: CampusTuple = [x, 0.36, z - 0.65];
      const front: CampusTuple = [x, 0.36, z + 0.65];
      const pedal: CampusTuple = [x, 0.36, z - 0.04];
      const saddle: CampusTuple = [x, 0.94, z - 0.25];
      const head: CampusTuple = [x, 0.94, z + 0.4];
      const fork: CampusTuple = [x, 0.65, z + 0.51];
      for (const wheel of [rear, front]) {
        tires.push({ p: wheel, s: [1, 1, 1], r: [0, Math.PI / 2, 0] });
        rims.push({ p: wheel, s: [1, 1, 1], r: [0, Math.PI / 2, 0] });
        for (let spoke = 0; spoke < 8; spoke += 1) {
          const angle = spoke * Math.PI / 4;
          detailRod(iron, wheel, [x, wheel[1] + Math.sin(angle) * 0.31, wheel[2] + Math.cos(angle) * 0.31], 0.0045);
        }
      }
      for (const [a, b] of [[rear, saddle], [saddle, pedal], [pedal, rear], [saddle, head], [head, pedal], [head, fork], [fork, front]] as Array<[CampusTuple, CampusTuple]>) {
        detailRod(iron, a, b, 0.021, color);
      }
      detailRod(iron, saddle, [x, 1.015, z - 0.28], 0.018);
      detailBox(iron, [x, 1.035, z - 0.29], [0.19, 0.06, 0.28]);
      detailRod(iron, head, [x, 1.09, z + 0.36], 0.018);
      detailRod(iron, [x - 0.24, 1.09, z + 0.36], [x + 0.24, 1.09, z + 0.36], 0.015);
      detailBox(iron, [x + 0.095, 0.34, z - 0.04], [0.18, 0.025, 0.085]);
      detailRod(iron, [x, 0.34, z - 0.08], [x + 0.24, 0.025, z - 0.23], 0.013);
      for (const rackZ of [z - 0.79, z - 0.51]) {
        detailRod(iron, [x - 0.1, 0.04, rackZ], [x - 0.1, 0.48, rackZ], 0.024);
      }
      detailRod(iron, [x - 0.1, 0.48, z - 0.79], [x - 0.1, 0.48, z - 0.51], 0.024);
    }
  }
  const rubber = new THREE.MeshStandardMaterial({ color: 0x343b35, roughness: 0.86 });
  detailInstances('building-bicycle-tires', new THREE.TorusGeometry(0.335, 0.026, 5, 20), rubber, tires);
  detailInstances('building-bicycle-rims', new THREE.TorusGeometry(0.312, 0.012, 4, 20), cream, rims, false);

  const courtRims: CampusPart[] = [];
  for (const side of [-1, 1]) {
    // 树后公告亭朝向林荫道，左亭落在配楼内侧，右亭位于楼前草坪。
    const kioskX = side < 0 ? -11.9 : 21.6;
    const kioskZ = side < 0 ? -31.1 : -8.8;
    for (const dx of [-0.72, 0.72]) {
      for (const dz of [-0.91, 0.91]) {
        detailBox(iron, [kioskX + dx, 1.28, kioskZ + dz], [0.065, 2.56, 0.065]);
        detailBox(stone, [kioskX + dx, 0.055, kioskZ + dz], [0.22, 0.11, 0.22]);
      }
    }
    detailBox(sage, [kioskX, 2.69, kioskZ], [1.94, 0.16, 2.46], 0xffffff, [side * 0.045, 0, 0]);
    detailBox(cream, [kioskX, 2.56, kioskZ], [1.84, 0.075, 2.36]);
    detailBox(iron, [kioskX, 1.59, kioskZ], [0.12, 1.55, 1.96]);
    const display = campusMesh(parent, new THREE.PlaneGeometry(1.74, 1.28), poster, [kioskX - side * 0.071, 1.56, kioskZ], false);
    display.rotation.y = -side * Math.PI / 2;
    display.name = `building-announcement-kiosk-${side}`;
    display.userData.campusDetail = true;
    detailSign('校园公告', 1.65, 0.27, [kioskX - side * 0.078, 2.34, kioskZ], -side * Math.PI / 2);
    detailRod(iron, [kioskX - side * 0.72, 2.13, kioskZ - 0.91], [kioskX - side * 0.27, 2.55, kioskZ - 0.91], 0.025);

    // 楼前远处球场只做低面数灯杆与球架剪影，不增加实时光源或占用中央通路。
    for (const [x, z, height] of [[27, -6.2, 8.8], [22.5, -4.7, 7.9]]) {
      const poleX = side * x;
      detailRod(iron, [poleX, 0, z], [poleX, height, z], 0.07);
      detailBox(stone, [poleX, 0.13, z], [0.31, 0.26, 0.31]);
      detailBox(iron, [poleX, height, z], [0.13, 0.12, 1.38]);
      for (const dz of [-0.48, 0.48]) detailBox(warm, [poleX, height - 0.13, z + dz], [0.23, 0.19, 0.34]);
    }
    const hoopX = side * 24.4;
    const hoopZ = -11.2;
    detailRod(iron, [hoopX, 0, hoopZ], [hoopX, 3.55, hoopZ], 0.065);
    detailRod(iron, [hoopX, 3.4, hoopZ], [hoopX - side * 0.78, 3.4, hoopZ], 0.047);
    detailRod(iron, [hoopX, 2.6, hoopZ], [hoopX - side * 0.65, 3.36, hoopZ], 0.035);
    detailBox(cream, [hoopX - side * 0.8, 3.4, hoopZ], [0.11, 0.96, 1.52]);
    detailBox(iron, [hoopX - side * 0.863, 3.27, hoopZ], [0.016, 0.42, 0.64]);
    detailBox(cream, [hoopX - side * 0.874, 3.27, hoopZ], [0.013, 0.34, 0.56]);
    courtRims.push({ p: [hoopX - side * 1.07, 3.04, hoopZ], s: [1, 1, 1], r: [-Math.PI / 2, 0, 0] });
  }
  detailInstances('building-court-hoops', new THREE.TorusGeometry(0.23, 0.018, 4, 12), iron, courtRims, false);

  // 横向连廊把 A 栋两端接到配楼；景墙与修剪绿篱在连廊后方逐层封边。
  for (const side of [-1, 1]) {
    const corridorX = side * 15.55;
    detailBox(stone, [corridorX, -0.015, -47.2], [13.5, 0.07, 3.48]);
    detailBox(sage, [corridorX, 3.55, -47.2], [13.7, 0.22, 3.7]);
    detailBox(cream, [corridorX, 3.395, -47.2], [13.56, 0.09, 3.56]);
    for (const z of [-45.38, -49.02]) detailBox(iron, [corridorX, 3.52, z], [13.72, 0.16, 0.055]);
    for (let column = 0; column < 6; column += 1) {
      const x = side * (9.25 + column * 2.55);
      for (const z of [-45.85, -48.55]) {
        detailBox(cream, [x, 1.67, z], [0.34, 3.34, 0.34]);
        detailBox(stone, [x, 0.17, z], [0.48, 0.34, 0.48]);
        detailBox(cream, [x, 3.3, z], [0.51, 0.15, 0.51]);
      }
    }
    detailBox(brick, [corridorX, 0.43, -49.3], [13.3, 0.86, 0.44]);
    detailBox(cream, [corridorX, 0.905, -49.3], [13.42, 0.09, 0.54]);
    for (const y of [1.01, 2.1]) detailBox(iron, [corridorX, y, -49.3], [13.3, 0.055, 0.065]);
    for (let bar = 0; bar < 27; bar += 1) {
      detailBox(iron, [side * (9.05 + bar * 0.5), 1.55, -49.3], [0.036, 1.14, 0.036]);
    }
    for (let hedge = 0; hedge < 9; hedge += 1) {
      const height = 3.45 + (hedge % 3) * 0.13;
      detailBox(foliageWind, [side * (9.55 + hedge * 1.5), height / 2, -50.95], [1.64, height, 1.6],
        [0x7e967a, 0x8ca183, 0x849b7d][hedge % 3]);
    }

    // 左翼补至原楼后沿，右翼延长较短配楼，实体楼体与原配楼相接而非独立遮挡墙。
    const extension = side < 0
      ? { x: -25.7, z: -49.2, w: 7.4, d: 9.2, h: 8.6 }
      : { x: 25.9, z: -43.6, w: 7.8, d: 20.4, h: 8.9 };
    const inner = extension.x - side * extension.w / 2;
    detailBox(plaster, [extension.x, extension.h / 2, extension.z], [extension.w, extension.h, extension.d]);
    detailBox(brick, [extension.x, 0.48, extension.z], [extension.w + 0.08, 0.96, extension.d + 0.08]);
    detailBox(sage, [extension.x, extension.h + 0.12, extension.z], [extension.w + 0.4, 0.24, extension.d + 0.4]);
    for (const y of [3.1, 6.0, 8.65]) {
      detailBox(cream, [extension.x, y, extension.z], [extension.w + 0.22, 0.12, extension.d + 0.22]);
    }
    const bays = side < 0 ? 3 : 7;
    for (const y of [1.8, 4.7, 7.45]) {
      for (let bay = 0; bay < bays; bay += 1) {
        const z = extension.z + extension.d / 2 - 1.25 - bay * 2.65;
        detailBox(bay % 3 === 1 ? warm : glass, [inner - side * 0.06, y, z], [0.08, 1.48, 1.24], bay % 3 === 1 ? 0xffffff : 0x96aba4);
        for (const dz of [-0.7, 0.7]) detailBox(cream, [inner - side * 0.12, y, z + dz], [0.2, 1.7, 0.11]);
        for (const dy of [-0.8, 0.8]) detailBox(cream, [inner - side * 0.12, y + dy, z], [0.2, 0.1, 1.5]);
        detailBox(stone, [inner - side * 0.18, y - 0.92, z], [0.34, 0.1, 1.65]);
      }
    }
  }

  for (const wing of [{ x: -20.2, z: -32.5, w: 13, d: 25, h: 11.4 }, { x: 21.5, z: -25, w: 14, d: 21, h: 10.2 }]) {
    box(plaster, [wing.x, wing.h / 2, wing.z], [wing.w, wing.h, wing.d]);
    const front = wing.z + wing.d / 2;
    const inner = wing.x - Math.sign(wing.x) * wing.w / 2;
    box(brick, [wing.x, 0.52, wing.z], [wing.w + 0.08, 1.04, wing.d + 0.08]);
    for (const y of [3.3, 6.6, 9.9]) {
      box(cream, [wing.x, y, wing.z], [wing.w + 0.36, 0.16, wing.d + 0.36]);
      for (let i = 0; i < 5; i += 1) {
        const x = wing.x - 4.8 + i * 2.4;
        const windowY = y - 1.45;
        box(glass, [x, windowY, front + 0.055], [1.25, 1.55, 0.08], 0x9bafa7);
        for (const dx of [-0.71, 0.71]) detailBox(cream, [x + dx, windowY, front + 0.11], [0.12, 1.79, 0.22]);
        for (const dy of [-0.84, 0.84]) detailBox(cream, [x, windowY + dy, front + 0.11], [1.53, 0.11, 0.22]);
        detailBox(stone, [x, windowY - 0.95, front + 0.17], [1.68, 0.1, 0.38]);
        detailBox(iron, [x, windowY, front + 0.107], [0.035, 1.55, 0.025]);
      }
      for (let i = 0; i < 8; i += 1) {
        const side = Math.sign(wing.x);
        const windowX = inner - side * 0.13;
        const windowY = y - 1.45;
        const windowZ = front - 1.5 - i * 2.65;
        box(glass, [inner - side * 0.055, windowY, windowZ], [0.08, 1.55, 1.3], 0x9bafa7);
        for (const dz of [-0.73, 0.73]) detailBox(cream, [windowX, windowY, windowZ + dz], [0.22, 1.79, 0.12]);
        for (const dy of [-0.84, 0.84]) detailBox(cream, [windowX, windowY + dy, windowZ], [0.22, 0.11, 1.57]);
        detailBox(stone, [inner - side * 0.19, windowY - 0.95, windowZ], [0.4, 0.1, 1.71]);
        detailBox(iron, [inner - side * 0.105, windowY, windowZ], [0.035, 1.55, 0.035]);
        if (i % 3 === 1) {
          const acX = inner - side * 0.34;
          const acZ = windowZ + 1.3;
          detailBox(cream, [acX, windowY - 0.36, acZ], [0.44, 0.54, 0.82]);
          detailBox(recess, [acX - side * 0.235, windowY - 0.36, acZ], [0.025, 0.41, 0.67]);
          for (let slat = 0; slat < 6; slat += 1) {
            detailBox(cream, [acX - side * 0.26, windowY - 0.53 + slat * 0.068, acZ], [0.025, 0.023, 0.64]);
          }
          for (const dz of [-0.27, 0.27]) detailBox(iron, [acX, windowY - 0.69, acZ + dz], [0.56, 0.065, 0.055]);
        }
      }
    }
    for (const endZ of [front - 0.28, wing.z - wing.d / 2 + 0.28]) {
      for (let rib = 0; rib < 3; rib += 1) {
        detailBox(cream, [inner - Math.sign(wing.x) * (0.13 + rib * 0.06), wing.h / 2 + 0.3, endZ - rib * 0.25], [0.14, wing.h - 0.5, 0.1]);
      }
    }
    box(sage, [wing.x, wing.h + 0.12, wing.z], [wing.w + 0.5, 0.24, wing.d + 0.5]);
  }

  occluders.push(campusMesh(parent,
    new THREE.BoxGeometry(FACADE.size.w, FACADE.size.h, FACADE.size.d), plaster,
    [FACADE.center.x, FACADE.center.y, FACADE.center.z]));
  occluders.push(campusMesh(parent,
    new THREE.BoxGeometry(DOOR.size.w, DOOR.size.h, DOOR.size.d), lobby,
    [DOOR.center.x, DOOR.center.y, DOOR.center.z]));
  campusMesh(parent, new THREE.PlaneGeometry(18, 0.76), brick, [0, 0.38, -47.994], false);
  box(sage, [0, 6.2, -47.94], [3.7, 7.4, 0.12]);
  for (const y of [3.18, 6.32, 9.62]) {
    box(cream, [0, y, -50], [18.45, 0.18, 4.5]);
    box(stone, [0, y - 0.13, -47.89], [18.1, 0.08, 0.25]);
  }
  box(sage, [0, 10.08, -50], [18.7, 0.16, 4.6]);
  for (const x of [-8.72, -1.96, 1.96, 8.72]) {
    box(cream, [x, 5.3, -47.89], [0.22, 8.5, 0.22]);
  }
  for (const [floor, y] of [1.87, 4.76, 7.88].entries()) {
    for (const [bay, x] of [-7.35, -5.13, -2.91, 2.91, 5.13, 7.35].entries()) {
      box(recess, [x, y, -47.956], [1.72, 1.92, 0.1]);
      const lit = (floor === 1 && bay === 1) || (floor === 2 && bay === 4) || (floor === 0 && bay === 5);
      box(lit ? warm : glass, [x, y, -47.892], [1.43, 1.62, 0.035], lit ? 0xffffff : 0x91a7a0);
      for (const dx of [-0.85, 0.85]) box(cream, [x + dx, y, -47.8], [0.13, 2.04, 0.3]);
      for (const dy of [-0.96, 0.96]) box(cream, [x, y + dy, -47.8], [1.83, 0.13, 0.3]);
      box(stone, [x, y - 1.04, -47.72], [1.96, 0.12, 0.46]);
      box(iron, [x, y, -47.858], [0.045, 1.65, 0.035]);
      box(iron, [x, y + 0.36, -47.858], [1.43, 0.035, 0.035]);
    }
  }
  for (const x of [-0.57, 0.57]) {
    box(lobby, [x, 1.63, -47.782], [0.96, 2.09, 0.025], x < 0 ? 0xf6dfb6 : 0xe8c994);
    box(iron, [x * 0.26, 1.35, -47.7], [0.045, 0.46, 0.065]);
  }
  for (const x of [-1.26, 0, 1.26]) box(iron, [x, 1.43, -47.765], [0.075, 2.86, 0.075]);
  box(iron, [0, 2.86, -47.76], [2.6, 0.085, 0.085]);
  box(cream, [0, 3.52, -46.95], [13.65, 0.24, 2.5]);
  box(sage, [0, 3.39, -45.69], [13.75, 0.12, 0.12]);
  box(warm, [0, 3.38, -46.95], [12.6, 0.025, 1.9]);
  for (let i = 0; i < 27; i += 1) box(wood, [-6.2 + i * 0.48, 3.35, -46.95], [0.09, 0.065, 1.95]);
  for (const x of [-6.43, 6.43]) {
    for (const z of [-46.04, -47.65]) {
      box(plaster, [x, 1.65, z], [0.4, 3.3, 0.4]);
      box(stone, [x, 0.2, z], [0.54, 0.4, 0.54]);
      box(cream, [x, 3.22, z], [0.57, 0.16, 0.57]);
    }
  }
  for (const side of [-1, 1]) {
    for (const y of [1.87, 4.76, 7.88]) {
      const x = side * 7.35;
      detailBox(cream, [x, y + 1.12, -47.7], [2.08, 0.085, 0.44]);
      for (const dx of [-0.72, 0.72]) detailBox(stone, [x + dx, y - 1.14, -47.66], [0.13, 0.23, 0.24]);
      for (const dy of [0.64, 0.73]) detailBox(iron, [x, y + dy, -47.825], [1.39, 0.022, 0.08]);
    }
    for (const z of [-51.42, -50.63, -49.84, -49.05]) {
      detailBox(cream, [side * 9.12, 5.36, z], [0.21, 9.1, 0.14]);
      detailBox(sage, [side * 9.245, 5.36, z + 0.09], [0.035, 9.1, 0.045]);
    }
    for (const y of [3.93, 6.86]) {
      detailBox(cream, [side * 9.32, y, -50.23], [0.48, 0.56, 0.9]);
      detailBox(recess, [side * 9.575, y, -50.23], [0.025, 0.43, 0.73]);
      for (let slat = 0; slat < 6; slat += 1) {
        detailBox(cream, [side * 9.6, y - 0.18 + slat * 0.071, -50.23], [0.025, 0.024, 0.7]);
      }
      for (const dz of [-0.28, 0.28]) detailBox(iron, [side * 9.3, y - 0.34, -50.23 + dz], [0.58, 0.065, 0.055]);
    }
    detailBox(sage, [side * 6.89, 3.445, -46.95], [0.12, 0.2, 2.58]);
    detailBox(cream, [side * 6.89, 3.58, -46.95], [0.14, 0.06, 2.62]);
    detailRod(iron, [side * 6.6, 2.88, -47.68], [side * 6.6, 3.35, -47.06], 0.027);
    detailRod(iron, [side * 6.89, 3.43, -47.95], [side * 7.04, 3.3, -47.95], 0.033);
    detailRod(iron, [side * 7.04, 3.3, -47.95], [side * 7.04, 0.2, -47.95], 0.033);
    for (const y of [0.55, 2.45]) detailBox(iron, [side * 7.04, y, -47.965], [0.12, 0.04, 0.09]);
    detailSign('A栋', 1.18, 0.74, [side * 9.27, 8.58, -50.25], side * Math.PI / 2);
  }
  const doorSign = createTextSign('A栋', 2.9, 1.25, { background: '#52695e', foreground: '#f4e3bd' });
  doorSign.position.set(0, 8.47, -47.858);
  parent.add(doorSign);

  for (const side of [-1, 1]) {
    box(plaster, [side * 6.4, 2.05, 14.2], [0.75, 4.1, 0.95]);
    box(brick, [side * 6.4, 0.55, 14.2], [0.84, 1.1, 1.03]);
    box(cream, [side * 6.4, 4.12, 14.2], [1.08, 0.18, 1.22]);
    box(brick, [side * 15.8, 0.4, 14.5], [18, 0.8, 0.5]);
    for (const y of [0.9, 2.1]) box(iron, [side * 15.8, y, 14.5], [18, 0.065, 0.075]);
    for (let i = 0; i < 38; i += 1) box(iron, [side * (7 + i * 0.47), 1.46, 14.5], [0.045, 1.35, 0.045]);
  }
  box(sage, [0, 4.36, 14.2], [14, 0.38, 1.1]);
  box(cream, [0, 4.58, 14.2], [14.6, 0.1, 1.4]);
  const gateSign = createTextSign('校园', 2.2, 0.42, { background: '#657568', foreground: '#eee8d8' });
  gateSign.position.set(0, 4.35, 13.635);
  gateSign.rotation.y = Math.PI;
  parent.add(gateSign);
  for (const [material, parts] of boxes) {
    campusInstances(parent, new THREE.BoxGeometry(1, 1, 1), material, parts, material !== glass && material !== warm && material !== lobby);
  }
  for (const [material, sides] of detailBoxes) {
    sides.forEach((parts, side) => {
      if (parts.length === 0) return;
      detailInstances(`building-detail-boxes-${material.id}-${side}`, new THREE.BoxGeometry(1, 1, 1), material, parts, material !== paper);
    });
  }
  for (const [material, sides] of detailRods) {
    sides.forEach((parts, side) => {
      if (parts.length === 0) return;
      detailInstances(`building-detail-rods-${material.id}-${side}`, new THREE.CylinderGeometry(1, 1, 1, 6), material, parts);
    });
  }

  // 55–60 米长轴的三层椭圆外围山环适配校园地坪（x ±65、z -78..30）。
  // 每层错开半节距并相互搭接；山脚下沉到地坪以下，远林冠到远山逐层增高、融雾。
  const ridgeParts: CampusPart[] = [];
  const ridgeColor = new THREE.Color();
  const ridgeAccent = new THREE.Color();
  const fogColor = new THREE.Color(0xb9c6d2);
  for (let layer = 0; layer < 3; layer += 1) {
    for (let segment = 0; segment < 48; segment += 1) {
      const angle = (segment + layer * 0.5) * Math.PI * 2 / 48;
      const radius = [55, 58, 60][layer];
      const height = [13.2, 18.2, 24][layer]
        + Math.sin(segment * 1.73 + layer * 0.9) * [1.7, 2.8, 3.4][layer]
        + Math.cos(segment * 0.65) * 0.6;
      ridgeColor.setHex([0x60756f, 0x7a9299, 0x91a8b5][layer])
        .lerp(ridgeAccent.setHex([0x788b7d, 0x91a29f, 0xa3b5c1][layer]), 0.14 + Math.cos(segment * 2.17) * 0.12)
        .lerp(fogColor, 0.12 + layer * 0.14 + Math.sin(segment * 1.31 + layer) * 0.045);
      ridgeParts.push({
        p: [Math.cos(angle) * radius, -4, Math.sin(angle) * radius],
        s: [[9.4, 11, 12][layer], height, [3.7, 4.5, 4.5][layer]],
        r: [0, -angle - Math.PI / 2, 0], color: ridgeColor.getHex(),
      });
    }
  }
  const ridge = campusInstances(parent, campusHorizonGeometry(),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), ridgeParts, false);
  ridge.name = 'building-horizon-ring';
  ridge.userData.horizonRing = true;
  // 只改变本批山环的世界变换，不染色或修改任何共享环境材质。
  ridge.position.z = -24;
  ridge.scale.z = 54 / 65;
  ridge.receiveShadow = false;
  ridge.computeBoundingBox();

  // 爸爸（校门方向，面向林荫路 -Z，玩家回头看到正面），双手各提一只袋子
  const father = createCharacterActor('father', 1.78, 0x8f8578, {
    yaw: Math.PI,
    props: [
      { kind: 'bag', color: 0x9b8f78, side: 'left' },
      { kind: 'bag', color: 0x9b8f78, side: 'right' },
    ],
  });
  father.position.set(FATHER.x, 0, FATHER.z);
  parent.add(father);
  occluders.push(father);

  // 林夏（起点站位，初始面向路线前进方向 -Z）
  const linxia = createCharacterActor('linxia', 1.62, 0xe8d9a8, { yaw: Math.PI });
  linxia.position.set(LINXIA_ROUTE[0].x, 0, LINXIA_ROUTE[0].z);
  parent.add(linxia);

  const campusReader = createCharacterActor('studentFemale', 1.65, 0x9da689, { yaw: Math.PI, leanRad: 0.12 });
  campusReader.position.set(-8.2, 0, -12.98);
  campusReader.name = 'building-campus-reader';
  campusReader.userData.campusIdleClip = 'idle';
  const campusObserver = createCharacterActor('studentMale', 1.7, 0xa9947d, { yaw: Math.PI + 0.12 });
  campusObserver.position.set(8.4, 0, -30.35);
  campusObserver.name = 'building-campus-observer';
  campusObserver.userData.campusIdleClip = 'fold_arms';
  for (const actor of [campusReader, campusObserver]) {
    actor.traverse((object) => { object.userData.campusDetail = true; });
    parent.add(actor);
  }

  return { occluders, actors: { linxia, father, campusReader, campusObserver } };
}

let campusIdleActors: THREE.Object3D[] = [];
const campusIdleAnimations = new Map<THREE.Object3D, CharacterAnimationController>();
let campusIdleDisposers: Array<() => void> = [];

function disposeCampusIdle(): void {
  for (const idleAnimation of campusIdleAnimations.values()) idleAnimation.dispose();
  campusIdleAnimations.clear();
  for (const dispose of campusIdleDisposers) dispose();
  campusIdleDisposers = [];
  campusIdleActors = [];
}

function tickCampusIdle(dtSeconds: number): void {
  for (const actor of campusIdleActors) {
    let idleAnimation = campusIdleAnimations.get(actor);
    if (!idleAnimation) {
      idleAnimation = createActorAnimation(actor) ?? undefined;
      if (idleAnimation) {
        actor.traverse((object) => { object.userData.campusDetail = true; });
        const preferred = actor.userData.campusIdleClip === 'fold_arms' ? 'fold_arms' : 'idle';
        const clips = preferred === 'idle' ? ['read', 'reading', 'idle', 'fold_arms'] : ['fold_arms', 'idle'];
        const clip = clips.find((name) => idleAnimation!.hasAnimation(name));
        if (clip) idleAnimation.play(clip, { timeScale: 0.5, fadeIn: 0.3 });
        campusIdleAnimations.set(actor, idleAnimation);
      }
    }
    idleAnimation?.update(dtSeconds);
  }
}

function enterCampusIdle(actors: Record<string, THREE.Object3D>): void {
  disposeCampusIdle();
  for (const [index, id] of ['campusReader', 'campusObserver'].entries()) {
    const actor = actors[id];
    if (!actor) continue;
    campusIdleActors.push(actor);
    campusIdleDisposers.push(startIdleMotion(actor, { breathAmp: 0.003, swayAmp: 0.002, period: 3.4 + index * 0.35 }));
  }
  tickCampusIdle(0);
}

let walkTween: gsap.core.Tween | null = null;
let fatherIdleDispose: (() => void) | null = null;
let walkingLinxia: THREE.Object3D | null = null;
let linxiaAnimation: CharacterAnimationController | null = null;
/** 路线是否已走完（用于到点后交叉淡出走路、切到站定待机） */
let walkArrived = false;

function disposeLinxiaAnimation(): void {
  linxiaAnimation?.dispose();
  linxiaAnimation = null;
}

/** S8 运行时装：林夏沿路线慢步；S9（同 sceneKey）不重启行走，但爸爸呼吸持续 */
export const buildingRuntime: SceneRuntime = {
  enter(context: SceneRuntimeContext): void {
    enterCampusIdle(context.actors);
    const father = context.actors.father;
    if (fatherIdleDispose) {
      fatherIdleDispose();
      fatherIdleDispose = null;
    }
    if (father) {
      fatherIdleDispose = startIdleMotion(father, {
        breathAmp: 0.004,
        swayAmp: 0.003,
        period: 3.1,
      });
    }

    if (context.sceneId !== 'S8') return;
    if (walkTween) {
      walkTween.kill();
      walkTween = null;
    }
    disposeLinxiaAnimation();
    walkArrived = false;

    const linxia = context.actors.linxia;
    walkingLinxia = linxia;
    linxia.position.set(LINXIA_ROUTE[0].x, 0, LINXIA_ROUTE[0].z);
    linxia.rotation.z = 0;
    // 朝向按折线切线平滑趋近，拐点不跳变
    let facing = Math.atan2(directionAlongRoute(0).x, directionAlongRoute(0).z);
    linxia.rotation.y = facing;

    // 真实骨骼走路：按路线速度标定 timeScale，纵向起伏与摆胯全部交给动画
    linxiaAnimation = createActorAnimation(linxia);
    linxiaAnimation?.play('walk', { timeScale: WALK_TIME_SCALE, fadeIn: 0.2 });

    const progress = { value: 0 };
    walkTween = gsap.to(progress, {
      value: 1,
      duration: WALK_DURATION_SEC,
      ease: 'none',
      onUpdate: () => {
        const point = pointAlongRoute(progress.value);
        linxia.position.set(point.x, 0, point.z);
        const direction = directionAlongRoute(progress.value);
        facing = approachAngle(facing, Math.atan2(direction.x, direction.z), 0.12);
        linxia.rotation.y = facing;
        // 到达 A 栋门口：交叉淡出走路，切到低速站定待机，避免停在半步姿势
        if (!walkArrived && progress.value >= 0.999) {
          walkArrived = true;
          linxiaAnimation?.play('afraid', { timeScale: 0.3, fadeIn: 0.6 });
        }
      },
    });
  },

  tick(dtSeconds: number): void {
    buildingWindTime.value += dtSeconds;
    tickCampusIdle(dtSeconds);
    if (!linxiaAnimation && walkingLinxia) {
      linxiaAnimation = createActorAnimation(walkingLinxia);
      linxiaAnimation?.play(walkArrived ? 'afraid' : 'walk', { timeScale: walkArrived ? 0.3 : WALK_TIME_SCALE });
    }
    linxiaAnimation?.update(dtSeconds);
  },

  exit(): void {
    disposeCampusIdle();
    if (walkTween) {
      walkTween.kill();
      walkTween = null;
    }
    disposeLinxiaAnimation();
    walkArrived = false;
    if (fatherIdleDispose) {
      fatherIdleDispose();
      fatherIdleDispose = null;
    }
    if (walkingLinxia) {
      walkingLinxia.rotation.z = 0;
      walkingLinxia = null;
    }
  },
};

export function createBuildingDefinition(sceneId: SceneId): WorldSceneDefinition {
  return {
    sceneKey: 'building',
    footstepSurface: 'stone',
    footstepActors: ['linxia'],
    spawn: SPAWN,
    nav: NAV,
    // 林荫路的林夏 + 校门方向守望的爸爸
    requiredModels: ['linxia', 'father', 'studentFemale', 'studentMale'],
    interactables: [],
    hotspots:
      sceneId === 'S8'
        ? [
            {
              id: 'look-back-father',
              position: { x: 0, y: 1.5, z: 8.6 },
              maxDistance: 45,
              maxAngleDeg: 12,
              requireLineOfSight: false,
            },
          ]
        : [],
    zones:
      sceneId === 'S8'
        ? [
            {
              id: 'building-entrance',
              kind: 'box',
              center: { x: 0, y: 0.9, z: -46 },
              size: { x: 7, y: 3.6, z: 5 },
            },
          ]
        : [],
    fog: { color: 0xb9c6d2, near: 16, far: 75 },
    build: buildBuilding,
  };
}

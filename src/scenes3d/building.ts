// scenes3d/building.ts —— 通往 A 栋教学楼的林荫路灰盒（S8 同行 / S9 结尾钩子）
// S8 进入后林夏胶囊体沿路线慢步前行供玩家跟随；回头可见爸爸站在校门方向（look-back-father）。

import * as THREE from 'three';
import type { SceneId } from '../data/storySchema';
import type {
  NavigationConfig,
  SceneRuntime,
  SceneRuntimeContext,
  SceneSpawn,
  WorldSceneDefinition,
} from '../world/worldSceneTypes';
import { createActorAnimation, createCharacterActor, createMatteMaterial, createTextSign, startIdleMotion } from './shared';
import {
  createContactShadowDiscBatch,
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
import { createCanopyCardBatch } from './canopy';
import type { CanopyCardSpec } from './canopy';
import { canopyBudget, getQualityTier } from '../world/quality';
import { advanceColorBloom, applyColorBloomShader, createColorBloomUniforms } from './colorBloom';
import type { ColorBloomUniforms } from './colorBloom';
import { SHARED_RESOURCE_FLAG, loadPropModel } from '../world/resources';
import { buildBuildingSportsFields } from './buildingSports';
import { buildBuildingCampusUpgrades, createLawKioskMaterial } from './buildingCampusUpgrades';

const buildingWindTime: WindTime = { value: 0 };

/** 林夏慢行路线（XZ 平面折线，首尾即起止站位）：与林荫道中轴平行的直线，不横穿路面 */
const LINXIA_ROUTE: Vec3[] = [
  { x: 1.3, y: 0, z: -1 },
  { x: 1.3, y: 0, z: -44 },
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

/**
 * 长椅摆放位（工单 T4）：椅背朝行道树、椅面朝通道，再顺着往 A 栋走的方向偏 0.22 rad（≈13°），
 * 别摆成正襟危坐的两张样板。成品绕 Y 转 ±90° 后 1.05 m 椅长落到 Z 轴，横向只占 |x| 2.70..3.40：
 * 既避开 x = ±2.65 的铺装分缝线，也够不到中央通道（nav 障碍名单锁死，长椅不进 obstacles）。
 * 两侧各取两树之间的空档并错开一个身位，同向走时不会一次撞见两张并排的椅子。
 */
const BENCH_SPOTS: ReadonlyArray<{ x: number; z: number; yaw: number }> = [
  { x: -3.05, z: -14.2, yaw: Math.PI / 2 + 0.22 },
  { x: 3.05, z: -24.6, yaw: -Math.PI / 2 - 0.22 },
];

/** 铺装面在 y = -0.018，成品贴地基准是 y = 0：让椅腿吃进铺装 6 mm，底面才不会露出一圈悬空 */
const BENCH_GROUND_Y = -0.024;
/** 接触阴影贴片贴在铺装面以上 1.2 cm，比把阴影调硬更省，也贴本项目的画法 */
const BENCH_CONTACT_Y = -0.006;
/**
 * 长椅底图亮度补偿：Poly Haven 的 painted_wooden_bench 是深红棕旧漆，
 * 512² 底图实测均值 (70,56,51)，再乘工单 §6.1 的木器色温 0xb9a07f 之后线性反照率只剩 (0.030,0.014,0.007)，
 * 在林荫道这套冷灰光照下直接读成一块黑影。色温只能往下乘，所以在场景侧把材质色整体提 3 倍
 * （克隆件，不动 resources 的共享道具材质），落点回到与程序化木条座椅同档的中深棕。
 */
const BENCH_ALBEDO_GAIN = 3;

/** A 栋教学楼立面与大门 */
const FACADE = { center: { x: 0, y: 5, z: -50 }, size: { w: 18, h: 10, d: 4 } } as const;
const DOOR = { center: { x: 0, y: 1.4, z: -47.9 }, size: { w: 2.4, h: 2.8, d: 0.2 } } as const;

/** 校门方向站着的爸爸（回头观察热点目标） */
const FATHER = { x: 0, z: 8.6 } as const;

/** 右侧草坪边缘：鞋底贴 lawn 的 y=-0.055，整个人在可行走边界外，不挤占同行路线。 */
const PHONE_PASSERBY = { x: 6.45, y: -0.055, z: -10, yaw: -2.58 } as const;
/** 手机收到胸口高度：竖屏、屏幕朝自己，镜头朝林荫道，与双手的握持点重合。 */
const PHONE_LOCAL = { x: 0, y: 0.325, z: 0.3 } as const;
const PHONE_PIVOT_Y = 0.9;
const PHONE_HOTSPOT = {
  x: PHONE_PASSERBY.x + Math.sin(PHONE_PASSERBY.yaw) * PHONE_LOCAL.z,
  y: PHONE_PASSERBY.y + PHONE_PIVOT_Y + PHONE_LOCAL.y,
  z: PHONE_PASSERBY.z + Math.cos(PHONE_PASSERBY.yaw) * PHONE_LOCAL.z,
};

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

/** 低多边形蝴蝶单侧翼片（沿 x=0 铰接，前翼大、后翼收窄，绕 Z 轴扇动自然轻盈） */
function createButterflyWingGeometry(side: -1 | 1): THREE.BufferGeometry {
  const s = side;
  const vertices = new Float32Array([
    // 前翼三角
    0, 0, 0.015,
    s * 0.082, 0.008, 0.068,
    s * 0.072, 0, -0.008,
    // 后翼三角
    0, 0, 0.005,
    s * 0.062, -0.004, -0.008,
    s * 0.036, 0, -0.064,
    // 翼根衔接
    0, 0, 0.005,
    s * 0.036, 0, -0.064,
    0, 0, -0.042,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

interface ButterflySpec {
  baseX: number;
  baseY: number;
  baseZ: number;
  ampX: number;
  ampY: number;
  ampZ: number;
  orbitSpeed: number;
  flapSpeed: number;
  phase: number;
  scale: number;
  color: number;
}

interface ButterflyFlockState {
  leftWings: THREE.InstancedMesh;
  rightWings: THREE.InstancedMesh;
  specs: readonly ButterflySpec[];
  time: number;
}

const BUTTERFLY_SPECS: readonly ButterflySpec[] = [
  { baseX: -2.45, baseY: 1.05, baseZ: -4.2, ampX: 0.38, ampY: 0.24, ampZ: 0.68, orbitSpeed: 0.62, flapSpeed: 13.5, phase: 0.2, scale: 1.48, color: 0xffe48a },
  { baseX: 2.55, baseY: 1.22, baseZ: -6.8, ampX: 0.36, ampY: 0.22, ampZ: 0.65, orbitSpeed: 0.56, flapSpeed: 14.2, phase: 1.1, scale: 1.38, color: 0xcceaf8 },
  { baseX: -3.9, baseY: 1.44, baseZ: -11.5, ampX: 0.42, ampY: 0.28, ampZ: 0.78, orbitSpeed: 0.51, flapSpeed: 12.8, phase: 2.0, scale: 1.52, color: 0xf7c996 },
  { baseX: 2.65, baseY: 1.08, baseZ: -14.2, ampX: 0.38, ampY: 0.25, ampZ: 0.68, orbitSpeed: 0.68, flapSpeed: 15.0, phase: 2.8, scale: 1.44, color: 0xffe99a },
  { baseX: -2.55, baseY: 1.28, baseZ: -18.8, ampX: 0.36, ampY: 0.22, ampZ: 0.7, orbitSpeed: 0.59, flapSpeed: 13.9, phase: 3.6, scale: 1.34, color: 0xf7c8be },
  { baseX: 4.1, baseY: 1.52, baseZ: -21.2, ampX: 0.44, ampY: 0.26, ampZ: 0.74, orbitSpeed: 0.48, flapSpeed: 12.6, phase: 4.3, scale: 1.48, color: 0xd0eaf6 },
  { baseX: -2.65, baseY: 1.06, baseZ: -24.5, ampX: 0.38, ampY: 0.24, ampZ: 0.66, orbitSpeed: 0.65, flapSpeed: 14.6, phase: 5.1, scale: 1.45, color: 0xfde286 },
  { baseX: 2.7, baseY: 1.34, baseZ: -28.0, ampX: 0.38, ampY: 0.26, ampZ: 0.72, orbitSpeed: 0.54, flapSpeed: 13.2, phase: 0.8, scale: 1.38, color: 0xf5c994 },
  { baseX: -4.2, baseY: 1.5, baseZ: -31.8, ampX: 0.42, ampY: 0.24, ampZ: 0.75, orbitSpeed: 0.58, flapSpeed: 14.0, phase: 1.9, scale: 1.46, color: 0xf0f2b6 },
  { baseX: 2.75, baseY: 1.12, baseZ: -34.4, ampX: 0.38, ampY: 0.22, ampZ: 0.68, orbitSpeed: 0.64, flapSpeed: 14.8, phase: 3.1, scale: 1.42, color: 0xffe48c },
  { baseX: -2.6, baseY: 1.24, baseZ: -38.5, ampX: 0.36, ampY: 0.25, ampZ: 0.64, orbitSpeed: 0.52, flapSpeed: 13.4, phase: 4.5, scale: 1.36, color: 0xcce8f6 },
  { baseX: 3.8, baseY: 1.42, baseZ: -41.0, ampX: 0.4, ampY: 0.22, ampZ: 0.62, orbitSpeed: 0.6, flapSpeed: 13.8, phase: 5.7, scale: 1.45, color: 0xf7cbc0 },
];

const butterflyTransform = new THREE.Object3D();

function updateButterflyFlock(flock: ButterflyFlockState, dtSeconds: number): void {
  flock.time += dtSeconds;
  const t = flock.time;
  for (let i = 0; i < flock.specs.length; i += 1) {
    const spec = flock.specs[i];
    const orbit = t * spec.orbitSpeed + spec.phase;
    const x = spec.baseX + Math.sin(orbit) * spec.ampX;
    const y = spec.baseY + Math.sin(orbit * 1.7 + 0.5) * spec.ampY;
    const z = spec.baseZ + Math.cos(orbit * 0.85) * spec.ampZ;
    const vx = Math.cos(orbit) * spec.ampX * spec.orbitSpeed;
    const vz = -Math.sin(orbit * 0.85) * spec.ampZ * spec.orbitSpeed * 0.85;
    const yaw = Math.atan2(vx, vz);
    const flap = Math.sin(t * spec.flapSpeed + spec.phase * 2.1) * 0.92 + 0.14;

    butterflyTransform.position.set(x, y, z);
    butterflyTransform.scale.setScalar(spec.scale);
    butterflyTransform.rotation.set(0.14, yaw, -flap);
    butterflyTransform.updateMatrix();
    flock.leftWings.setMatrixAt(i, butterflyTransform.matrix);

    butterflyTransform.rotation.set(0.14, yaw, flap);
    butterflyTransform.updateMatrix();
    flock.rightWings.setMatrixAt(i, butterflyTransform.matrix);
  }
  flock.leftWings.instanceMatrix.needsUpdate = true;
  flock.rightWings.instanceMatrix.needsUpdate = true;
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

/** 独立程序化路人：双手在胸前竖持手机拍校园，局部 +Z 为镜头方向，不加载任何角色模型。 */
function createCampusPhotographer(): THREE.Group {
  const actor = new THREE.Group();
  actor.name = 'building-campus-photographer';
  actor.position.set(PHONE_PASSERBY.x, PHONE_PASSERBY.y, PHONE_PASSERBY.z);
  actor.rotation.y = PHONE_PASSERBY.yaw;
  const shirt = createMatteMaterial(0x819496);
  const trousers = createMatteMaterial(0x59615e);
  const shoes = createMatteMaterial(0xb8b8aa);
  const skin = createMatteMaterial(0xc9a98c);
  const hair = createMatteMaterial(0x4c4943);
  const casing = createMatteMaterial(0x58615e, 0.7);
  const screen = createMatteMaterial(0x879c9c, 0.65);
  const lens = createMatteMaterial(0x263534, 0.5);
  const part = (parent: THREE.Object3D, name: string, geometry: THREE.BufferGeometry,
    material: THREE.Material, position: CampusTuple): THREE.Mesh => {
    // 路人仅接收既有天光与树荫，不新增实时灯光、发光屏或投影预算。
    const mesh = campusMesh(parent, geometry, material, position, false);
    mesh.name = `building-phone-${name}`;
    return mesh;
  };
  for (const side of [-1, 1]) {
    const suffix = side < 0 ? 'left' : 'right';
    part(actor, `shoe-${suffix}`, new THREE.BoxGeometry(0.17, 0.09, 0.28), shoes, [side * 0.12, 0.045, 0.04]);
    part(actor, `leg-${suffix}`, new THREE.CylinderGeometry(0.083, 0.072, 0.76, 6), trousers, [side * 0.12, 0.47, 0]);
  }
  part(actor, 'hips', new THREE.BoxGeometry(0.36, 0.18, 0.23), trousers, [0, 0.83, 0]);
  const contact = part(actor, 'contact', new THREE.CircleGeometry(0.34, 12),
    new THREE.MeshBasicMaterial({ color: 0x35453c, transparent: true, opacity: 0.13, depthWrite: false }), [0, 0.001, 0]);
  contact.rotation.x = -Math.PI / 2;
  contact.scale.y = 0.72;
  contact.receiveShadow = false;
  contact.raycast = () => {};

  // 只转上身取景，鞋与腿不随摆动离地；手臂、手掌、手机始终在同一个姿态组内。
  const pose = new THREE.Group();
  pose.name = 'building-phone-pose';
  pose.position.y = PHONE_PIVOT_Y;
  actor.add(pose);
  const torso = part(pose, 'shirt', new THREE.CylinderGeometry(0.23, 0.2, 0.49, 6), shirt, [0, 0.25, 0]);
  torso.scale.z = 0.63;
  part(pose, 'neck', new THREE.CylinderGeometry(0.065, 0.07, 0.12, 6), skin, [0, 0.52, 0]);
  const head = part(pose, 'head', new THREE.IcosahedronGeometry(0.18, 1), skin, [0, 0.68, 0.015]);
  head.scale.set(0.82, 1, 0.85);
  const cap = part(pose, 'hair', new THREE.SphereGeometry(0.184, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), hair, [0, 0.7, 0.006]);
  cap.scale.set(0.84, 0.85, 0.9);
  part(pose, 'nose', new THREE.BoxGeometry(0.04, 0.05, 0.04), skin, [0, 0.67, 0.164]);

  const limb = (name: string, a: CampusTuple, b: CampusTuple, radius: number, material: THREE.Material): void => {
    const from = new THREE.Vector3(...a);
    const to = new THREE.Vector3(...b);
    const direction = to.clone().sub(from);
    const middle = from.add(to).multiplyScalar(0.5);
    const mesh = part(pose, name, new THREE.CylinderGeometry(radius, radius * 1.06, direction.length(), 6),
      material, [middle.x, middle.y, middle.z]);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  };
  for (const side of [-1, 1]) {
    const suffix = side < 0 ? 'left' : 'right';
    // 双手胸前取景（竖屏）：大臂下垂、肘部收在肋侧，掌心托在机身下缘两侧，
    // 竖屏机宽只有 0.125，握点收到 ±0.075 才真的搭在边上，同行视线上手机仍是第一个被命中的物件。
    const shoulder: CampusTuple = [side * 0.185, 0.4, 0];
    const elbow: CampusTuple = [side * 0.2, 0.09, 0.08];
    const hand: CampusTuple = [side * 0.075, 0.235, 0.29];
    limb(`upper-arm-${suffix}`, shoulder, elbow, 0.073, shirt);
    limb(`forearm-${suffix}`, elbow, hand, 0.046, skin);
    part(pose, `hand-${suffix}`, new THREE.IcosahedronGeometry(0.043, 1), skin, hand);
  }
  const phone = part(pose, 'device', new THREE.BoxGeometry(0.125, 0.22, 0.026), casing,
    [PHONE_LOCAL.x, PHONE_LOCAL.y, PHONE_LOCAL.z]);
  part(phone, 'screen', new THREE.BoxGeometry(0.099, 0.193, 0.003), screen, [0, 0, -0.014]);
  part(phone, 'camera-pad', new THREE.BoxGeometry(0.042, 0.047, 0.004), hair, [-0.03, 0.078, 0.015]);
  part(phone, 'lens', new THREE.SphereGeometry(0.011, 6, 4), lens, [-0.03, 0.078, 0.019]);
  actor.traverse((object) => { object.userData.campusDetail = true; });
  // 几何与材质均为本场景私有，随 WorldApp 的场景树释放；没有贴图、定时器或异步装填。
  return actor;
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
  return campusCanvasMaterial(800, 340, (context) => {
    context.fillStyle = '#efe6cf';
    context.fillRect(0, 0, 800, 340);
    const titles = ['反网络暴力', '反校园霸凌', '普法小课堂', '心灵驿站'];
    const slogans = ['键盘伤人也是伤害', '向校园欺凌说"不"', '语言暴力也是刀', '有烦恼勇敢说出来'];
    const subs = ['不造谣 · 不信谣 · 不网暴', '不做冷漠的旁观者', '留存证据 · 法律护己', '多份倾听 · 少份伤害'];
    const footers = ['未保法第77条 · 民法典1024', '未保法第39条 · 零容忍', '96110 反诈 · 110 求助', '青少年心理热线 12355'];
    const accents = ['#df743c', '#459467', '#357ab8', '#d99e2b'];
    for (let i = 0; i < 4; i += 1) {
      const x = 14 + i * 195;
      context.fillStyle = '#fffcf5';
      context.fillRect(x, 14, 183, 312);
      context.fillStyle = accents[i];
      context.fillRect(x, 14, 183, 44);
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = '700 22px "Microsoft YaHei", sans-serif';
      context.fillStyle = '#ffffff';
      context.fillText(titles[i], x + 91, 36, 168);
      // 圆形图标
      context.fillStyle = accents[i];
      context.beginPath();
      context.arc(x + 91, 108, 34, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#ffffff';
      if (i === 0) {
        // 禁止键盘/屏幕斜杠图标
        context.fillRect(x + 67, 94, 48, 28);
        context.fillStyle = '#d93629';
        context.fillRect(x + 69, 106, 44, 5);
      } else if (i === 1) {
        // 禁止拳头斜杠图标
        context.fillRect(x + 73, 92, 36, 30);
        context.fillStyle = '#d93629';
        context.fillRect(x + 69, 106, 44, 5);
      } else if (i === 2) {
        // 天平/盾牌图标
        context.fillRect(x + 76, 92, 30, 26);
        context.fillRect(x + 83, 118, 16, 10);
        context.fillStyle = '#f7d14a';
        context.fillRect(x + 69, 98, 44, 4);
      } else {
        // 爱心/笑脸图标
        context.beginPath();
        context.arc(x + 82, 102, 11, 0, Math.PI * 2);
        context.arc(x + 100, 102, 11, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.moveTo(x + 72, 107);
        context.lineTo(x + 91, 127);
        context.lineTo(x + 110, 107);
        context.closePath();
        context.fill();
      }
      context.fillStyle = '#26313a';
      context.font = '700 18px "Microsoft YaHei", sans-serif';
      context.fillText(slogans[i], x + 91, 170, 168);
      context.fillStyle = '#4f5d66';
      context.font = '700 14px "Microsoft YaHei", sans-serif';
      context.fillText(subs[i], x + 91, 206, 168);
      context.fillStyle = '#dfd5c0';
      context.fillRect(x + 16, 232, 151, 2);
      context.fillStyle = accents[i];
      context.fillRect(x + 12, 264, 159, 44);
      context.fillStyle = '#fff9ee';
      context.font = '700 14px "Microsoft YaHei", sans-serif';
      context.fillText(footers[i], x + 91, 286, 148);
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

/** 场景代次：切场景后仍在途的道具回调必须作废，不能往复用的 levelGroup 里补挂上一代的几何 */
let buildingGeneration = 0;
/** 道具实例网格：几何与材质归 resources 的道具缓存共享，离开 S8/S9 时只释放实例缓冲 */
const buildingPropMeshes: THREE.InstancedMesh[] = [];

/** 释放道具实例缓冲；共享几何 / 材质留给缓存复用，场景不得 dispose */
function disposeBuildingPropMeshes(): void {
  for (const mesh of buildingPropMeshes) mesh.dispose();
  buildingPropMeshes.length = 0;
}

/**
 * 校园长椅 ×2：2 件成品合 1 个 InstancedMesh，接触阴影另起 1 批，合计 2 个 DrawCall。
 * GLB 加载失败就什么都不挂——长椅是本场景原本不存在的新增内容，不挂即等于改前，不会留空洞。
 * 不进 occluders，也不加 obstacle / hotspot / interactable：S8 的 phone-behind 靠 occluders 做视线
 * 判定，多一件遮挡体会改到它的触发时机；障碍名单与 S9 的空 hotspots 都是工单锁死的口径。
 */
function attachCampusBenches(parent: THREE.Object3D): void {
  const generation = buildingGeneration;
  loadPropModel('bench').then((asset) => {
    if (!asset || generation !== buildingGeneration) return;
    // 场景私有材质副本：亮度补偿只作用于 S8/S9，共享道具材质与底图留给其它场景原样复用
    const material = asset.material.clone() as THREE.MeshStandardMaterial;
    delete material.userData[SHARED_RESOURCE_FLAG];
    material.color.multiplyScalar(BENCH_ALBEDO_GAIN);
    const mesh = new THREE.InstancedMesh(asset.geometry, material, BENCH_SPOTS.length);
    const transform = new THREE.Object3D();
    const contacts: Array<{ x: number; z: number; radius: number; y: number }> = [];
    BENCH_SPOTS.forEach((spot, index) => {
      transform.position.set(spot.x, BENCH_GROUND_Y, spot.z);
      transform.rotation.set(0, spot.yaw, 0);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      // 椅长 1.05 m，一片圆盖不住两头：沿长度轴（局部 X）各贴一片
      for (const end of [-0.3, 0.3]) {
        contacts.push({
          x: spot.x + Math.cos(spot.yaw) * end,
          z: spot.z - Math.sin(spot.yaw) * end,
          radius: 0.3,
          y: BENCH_CONTACT_Y,
        });
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = 'building-bench-props';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    parent.add(mesh);
    buildingPropMeshes.push(mesh);

    const shadows = createContactShadowDiscBatch('building-bench-contact', contacts);
    if (shadows) parent.add(shadows);
  });
}

function buildBuilding(parent: THREE.Object3D): {
  occluders: THREE.Object3D[];
  actors: Record<string, THREE.Object3D>;
} {
  buildingWindTime.value = 0;
  buildingGeneration += 1;
  const occluders: THREE.Object3D[] = [];
  const bloomUniforms = createColorBloomUniforms();
  const bloomEnvironment = new THREE.Group();
  bloomEnvironment.name = 'building-color-bloom';
  bloomEnvironment.userData.colorBloomUniforms = bloomUniforms;
  parent.add(bloomEnvironment);
  const bloomClone = (source: THREE.MeshStandardMaterial, name: string): THREE.MeshStandardMaterial => {
    const material = source.clone();
    delete material.userData[SHARED_RESOURCE_FLAG];
    material.name = `building-bloom-${name}`;
    return applyColorBloomShader(material, bloomUniforms);
  };
  const paving = bloomClone(getPavingMaterial({ repeatX: 6, repeatY: 36 }), 'paving');
  const plaster = getPlasterMaterial({ repeatX: 3, repeatY: 2 });
  const bark = getBarkMaterial({ repeatY: 2 });
  const foliageSource = getFoliageMaterial();
  const foliage = bloomClone(foliageSource, 'shrubs');
  const glass = getWindowGlassMaterial();
  const wood = getWoodFloorMaterial();
  const foliageWind = applyColorBloomShader(
    createFoliageWindMaterial(foliageSource, buildingWindTime, { base: -1, height: 2, amplitude: 0.03 }),
    bloomUniforms,
  );
  foliageWind.name = 'building-bloom-canopies';
  const lobby = campusLobbyMaterial();
  const poster = campusPosterMaterial();
  const lawPoster = createLawKioskMaterial();
  const paper = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x8c9287, roughness: 0.92 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xdfdac9, roughness: 0.86 });
  const brick = new THREE.MeshStandardMaterial({ color: 0x96766a, roughness: 0.94 });
  const sage = new THREE.MeshStandardMaterial({ color: 0x657568, roughness: 0.88 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x414e49, roughness: 0.64, metalness: 0.35 });
  const recess = new THREE.MeshStandardMaterial({ color: 0x344744, roughness: 0.92 });
  const lawn = applyColorBloomShader(new THREE.MeshStandardMaterial({ color: 0x869477, roughness: 1 }), bloomUniforms);
  lawn.name = 'building-bloom-lawn';
  const planterBrick = bloomClone(brick, 'planter-brick');
  const planterStone = bloomClone(stone, 'planter-stone');
  const planterCap = bloomClone(cream, 'planter-cap');
  const pathInlay = bloomClone(recess, 'path-inlay');
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
  campusInstances(parent, new THREE.PlaneGeometry(1, 1), pathInlay, inlays, false);

  const pockets = [{ x: -9.5, z: -14 }, { x: 9.6, z: -29 }, { x: -10, z: -37 }];
  const pocketPaving = bloomClone(getPavingMaterial({ repeatX: 3, repeatY: 4 }), 'pocket-paving');
  for (const pocket of pockets) {
    const side = Math.sign(pocket.x);
    plane(pocketPaving, pocket.x, pocket.z, 7, 7.6, -0.026);
    box(planterBrick, [pocket.x + side * 2.75, 0.21, pocket.z], [0.6, 0.42, 6.4]);
    box(planterCap, [pocket.x + side * 2.75, 0.46, pocket.z], [0.74, 0.08, 6.55]);
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

  for (const [index, tree] of TREES.entries()) {
    // 沿街行道树树池：交替采用八边形圆形砖石围栏与带角柱方形砖石树池，全部复用漫染材质（0 额外 DrawCall）
    if (index % 2 === 0) {
      const segments = 8;
      const radius = 0.66;
      for (let seg = 0; seg < segments; seg += 1) {
        const angle = (seg * Math.PI * 2) / segments + Math.PI / 8;
        const wx = tree.x + Math.cos(angle) * radius;
        const wz = tree.z + Math.sin(angle) * radius;
        detailBox(planterBrick, [wx, 0.15, wz], [0.56, 0.3, 0.14], undefined, [0, -angle + Math.PI / 2, 0]);
        detailBox(planterStone, [wx, 0.33, wz], [0.64, 0.06, 0.2], undefined, [0, -angle + Math.PI / 2, 0]);
      }
      detailBox(planterBrick, [tree.x, 0.13, tree.z], [1.02, 0.12, 1.02], 0x514637);
    } else {
      const half = 0.66;
      detailBox(planterBrick, [tree.x, 0.15, tree.z - half], [1.44, 0.3, 0.14]);
      detailBox(planterBrick, [tree.x, 0.15, tree.z + half], [1.44, 0.3, 0.14]);
      detailBox(planterBrick, [tree.x - half, 0.15, tree.z], [0.14, 0.3, 1.44]);
      detailBox(planterBrick, [tree.x + half, 0.15, tree.z], [0.14, 0.3, 1.44]);
      detailBox(planterCap, [tree.x, 0.33, tree.z - half], [1.56, 0.06, 0.2]);
      detailBox(planterCap, [tree.x, 0.33, tree.z + half], [1.56, 0.06, 0.2]);
      detailBox(planterCap, [tree.x - half, 0.33, tree.z], [0.2, 0.06, 1.56]);
      detailBox(planterCap, [tree.x + half, 0.33, tree.z], [0.2, 0.06, 1.56]);
      for (const cx of [-half, half]) {
        for (const cz of [-half, half]) {
          detailBox(planterStone, [tree.x + cx, 0.19, tree.z + cz], [0.22, 0.38, 0.22]);
        }
      }
      detailBox(planterBrick, [tree.x, 0.13, tree.z], [1.16, 0.12, 1.16], 0x514637);
    }
  }

  // 林荫道花坛与树池间翩飞的蝴蝶群（左右翼 2 个 InstancedMesh，共 2 DrawCall，飞行轨迹严格位于 |x|>2）
  const butterflyWingMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.7,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
  const butterflyInitParts: CampusPart[] = BUTTERFLY_SPECS.map((spec) => ({
    p: [spec.baseX, spec.baseY, spec.baseZ],
    s: [spec.scale, spec.scale, spec.scale],
    color: spec.color,
  }));
  const butterflyLeft = detailInstances(
    'building-butterflies-left-wings',
    createButterflyWingGeometry(-1),
    butterflyWingMaterial,
    butterflyInitParts,
    false,
  );
  const butterflyRight = detailInstances(
    'building-butterflies-right-wings',
    createButterflyWingGeometry(1),
    butterflyWingMaterial,
    butterflyInitParts,
    false,
  );
  for (const wingMesh of [butterflyLeft, butterflyRight]) {
    wingMesh.receiveShadow = false;
    wingMesh.raycast = () => {};
    wingMesh.frustumCulled = false;
  }
  const butterflyFlock: ButterflyFlockState = {
    leftWings: butterflyLeft,
    rightWings: butterflyRight,
    specs: BUTTERFLY_SPECS,
    time: 0,
  };
  updateButterflyFlock(butterflyFlock, 0);
  bloomEnvironment.userData.butterflies = butterflyFlock;

  const planters = [
    { x: -7.3, z: -4.5, length: 5.2 }, { x: 7.4, z: -5.8, length: 4.6 },
    { x: -7.5, z: -24, length: 5.6 }, { x: 7.4, z: -18.7, length: 6 },
    { x: -7.4, z: -44.5, length: 4 }, { x: 7.6, z: -39.3, length: 6 },
  ];
  const bushes: CampusPart[] = [];
  for (const [index, bed] of planters.entries()) {
    box(planterBrick, [bed.x, 0.18, bed.z], [1.7, 0.36, bed.length]);
    box(planterStone, [bed.x, 0.39, bed.z], [1.84, 0.06, bed.length + 0.12]);
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
  const meadow = createCampusMeadow(parent, 'building-meadow', meadowBeds, buildingWindTime);
  for (const [name, mesh] of Object.entries(meadow)) {
    const material = mesh.material as THREE.MeshLambertMaterial;
    applyColorBloomShader(material, bloomUniforms);
    material.name = `building-bloom-meadow-${name}`;
  }

  // 清除落入左侧新建四片篮球场净空区 [-34.9, -7.9] × [-8.0, +14.0] 的树木 (-10.4,-6.8)（坑位改为矮花坛）
  const grove = [
    ...TREES.map((tree) => ({ ...tree, size: 1 })),
    { x: -8.5, z: 5.5, size: 1.05 }, { x: 8.7, z: 1.8, size: 1.12 },
    { x: 7.9, z: -10.6, size: 1.1 },
    { x: -12, z: -20.5, size: 1.08 }, { x: 10.5, z: -20, size: 1.28 },
    { x: -8.6, z: -29.5, size: 1.15 }, { x: 12.6, z: -34.3, size: 1.03 },
    { x: -12, z: -41.3, size: 1.18 }, { x: 8.2, z: -42.1, size: 1.16 },
    { x: -17, z: -11, size: 1.4 }, { x: 17.2, z: -45, size: 1.3 },
  ];
  const trunks: CampusPart[] = [];
  const branches: CampusPart[] = [];
  const crowns: CampusPart[] = [];
  const groveCards: CanopyCardSpec[] = [];
  const leafTips: CampusPart[] = [];
  const shadePatches: CampusPart[] = [];
  const groveTier = canopyBudget(getQualityTier());
  const groveGolden = Math.PI * (3 - Math.sqrt(5)) * 2;
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
        p: [x, y, z], s: [(0.92 + (i % 3) * 0.12) * size, (0.72 + (i % 2) * 0.11) * size, 0.94 * size],
        r: [0.12, angle, 0.1], color: [0x3f7a3c, 0x6c9a4a, 0x9cc06a, 0x6c9a4a][(index + i) % 4],
      });
      for (let tip = 0; tip < 4; tip += 1) {
        const a = angle + tip * 1.57;
        leafTips.push({
          p: [x + Math.cos(a) * 1.03 * size, y + Math.sin(i + tip) * 0.55 * size, z + Math.sin(a) * size],
          s: [0.48 * size, 0.23 * size, 0.36 * size], r: [0.25, a, 0.3],
          color: [0x9cc06a, 0x6c9a4a, 0x85ae5b][(i + tip) % 3],
        });
      }
    }
    // 冠团外再套一层 alpha 卡片：icosahedron 的外缘是一段连续折线，卡片把它切成叶簇的碎边。
    // 卡片比冠团大一圈、按黄金角错开朝向，走动时剪影随之变化，才不像贴在空中的绿球。
    const groveCenterY = 5.15 * size;
    for (let card = 0; card < groveTier.cards; card += 1) {
      const t = (card + 0.5) / groveTier.cards;
      const angle = card * groveGolden + index * 1.37;
      const ring = 0.95 * size * (0.3 + 0.7 * Math.sin(Math.PI * t));
      groveCards.push({
        x: tree.x + Math.cos(angle) * ring,
        y: groveCenterY + (t - 0.5) * 1.9 * size,
        z: tree.z + Math.sin(angle) * ring * 0.86,
        scale: (2.85 + ((card * 5 + index) % 3) * 0.18) * size,
        yaw: angle + Math.PI / 2,
        tilt: (card % 3 - 1) * 0.17,
        tint: [0xdff0d6, 0xecf5e3, 0xd4e8ca, 0xf2f8ea][(index + card) % 4],
      });
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
  const groveCanopy = createCanopyCardBatch(groveCards, {
    name: 'building-grove-canopy-cards',
    texture: { size: groveTier.textureSize, seed: 5, aniso: groveTier.anisotropy, density: 0.92 },
    alphaTest: groveTier.alphaTest,
    time: buildingWindTime,
    sway: 0.035,
  });
  groveCanopy.userData.windTime = buildingWindTime;
  parent.add(groveCanopy);
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
  campusInstances(parent, new THREE.CircleGeometry(1, 5), bloomClone(cream, 'fallen-leaves'), fallenLeaves, false);

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
      // 跳过落入左侧篮球场及右侧网球场清场区的林下树，避免遮挡入口与场地
      if (tree.x > -35.2 && tree.x < -7.9 && tree.z > -8.2 && tree.z < 14.2) continue;
      if (tree.x > 9.5 && tree.x < 25.5 && tree.z > -5.2 && tree.z < 13.2) continue;
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
          r: [0.08 * index, a, 0.16], color: [0x6c9a4a, 0x85ae5b, 0x9cc06a, 0x3f7a3c][(index + cluster) % 4],
        });
        for (let tip = 0; tip < 3; tip += 1) {
          const angle = a + tip * 2.1;
          smallTips.push({
            p: [x + Math.cos(angle) * 0.83 * tree.size, y + Math.sin(cluster + tip) * 0.32, z + Math.sin(angle) * 0.77 * tree.size],
            s: [0.38 * tree.size, 0.2 * tree.size, 0.34 * tree.size], r: [0.2, angle, 0.15],
            color: tip % 2 ? 0x9cc06a : 0x6c9a4a,
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
  // 二排行道树改卡片树：真树干 + alpha 卡片冠。球冠的圆弧外轮廓就是"花椰菜"的成因，
  // 卡片按黄金角错开朝向，玩家一走动就有视差，才读得出体积（手册 06_WINDOW_TREE 第三节）。
  // 卡片走 unlit 材质，明暗已经烘在贴图里，不再让场景灯去算第二遍。
  const rowTier = canopyBudget(getQualityTier());
  const rowGolden = Math.PI * (3 - Math.sqrt(5));
  const rowTints = [0xdff0d6, 0xecf5e3, 0xd4e8ca, 0xf2f8ea];
  for (const side of [-1, 1]) {
    const rowTrunks: CampusPart[] = [];
    const rowCards: CanopyCardSpec[] = [];
    const rowShrubs: CampusPart[] = [];
    for (const [index, tree] of secondRow.entries()) {
      if (Math.sign(tree.x) !== side) continue;
      rowTrunks.push({ p: [tree.x, tree.height / 2, tree.z], s: [0.18 * tree.size, tree.height, 0.18 * tree.size] });
      const crownCenter = tree.height + 0.55 * tree.size;
      for (let card = 0; card < rowTier.cards; card += 1) {
        const t = (card + 0.5) / rowTier.cards;
        const angle = card * rowGolden * 2 + index * 1.37 + side * 0.4;
        const ring = 0.66 * tree.size * (0.4 + 0.6 * Math.sin(Math.PI * t));
        rowCards.push({
          x: tree.x + Math.cos(angle) * ring,
          y: crownCenter + (t - 0.5) * 1.5 * tree.size,
          z: tree.z + Math.sin(angle) * ring * 0.72,
          scale: (1.62 + ((card * 5 + index) % 3) * 0.1) * tree.size,
          yaw: angle + Math.PI / 2,
          tilt: (card % 3 - 1) * 0.16,
          tint: rowTints[(index + card) % rowTints.length],
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
    const rowCrowns = createCanopyCardBatch(rowCards, {
      name: `building-second-row-crowns-${side}`,
      texture: { size: rowTier.textureSize, seed: 5, aniso: rowTier.anisotropy, density: 0.92 },
      alphaTest: rowTier.alphaTest,
      time: buildingWindTime,
      sway: 0.03,
    });
    rowCrowns.userData.windTime = buildingWindTime;
    parent.add(rowCrowns);
    detailInstances(`building-second-row-shrubs-${side}`, new THREE.IcosahedronGeometry(1, 0), foliageWind, rowShrubs);
  }

  const horizonTrunks: CampusPart[] = [];
  const horizonCrowns: CampusPart[] = [];
  for (let layer = 0; layer < 3; layer += 1) {
    for (const side of [-1, 1]) {
      for (let tree = 0; tree < 6; tree += 1) {
        const x = side * (19.5 + layer * 9 + Math.sin(tree * 1.7) * 1.4);
        const z = 9 - tree * 12.4 + (layer % 2 ? 4.6 : 0) + Math.cos(tree * 2.3) * 1.6;
        // 移除落入左侧四片篮球场清场区 [-35.2, -7.9] × [-8.2, +14.2] 及右侧网球场清场区 [+9.8, +25.5] × [-5.2, +13.2] 的树木实例
        if (x > -35.2 && x < -7.9 && z > -8.2 && z < 14.2) continue;
        if (x > 9.8 && x < 25.5 && z > -5.2 && z < 13.2) continue;
        const height = 4.6 + layer * 0.8 + (tree % 3) * 0.7;
        const size = 1.35 + layer * 0.18 + (tree % 2) * 0.2;
        horizonTrunks.push({ p: [x, height / 2, z], s: [0.2 * size, height, 0.2 * size] });
        for (let cluster = 0; cluster < 9; cluster += 1) {
          const angle = cluster * 2.399 + tree * 0.7 + layer;
          const radius = (cluster < 6 ? 1.15 : 0.48) * size;
          horizonCrowns.push({
            p: [x + Math.cos(angle) * radius, height + (cluster < 6 ? 0.2 + (cluster % 3) * 0.32 : 1.5) * size, z + Math.sin(angle) * radius],
            s: [1.2 * size, 0.85 * size, 1.12 * size], r: [0.1, angle, 0.06],
            color: [0x638861, 0x79996d, 0x8eab82][layer],
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
    detailSign('文明校园 · 法治护航', 1.85, 0.3, [x, 2.24, z + 0.16]);
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
      // 3 辆差异化车型：0=橙色共享单车（黄车筐+挡泥板+直把）、1=蓝色城市通勤车（金属前筐+后座）、2=粉色淑女车（低跨梁+弯把+米色座+前筐书包）
      const x = bikeX + (bike % 2) * 0.12;
      const z = bikeZ - 2.3 + bike * 2.2;
      const steerYaw = (bike - 1) * 0.11;
      const frameColor = [0xf26d21, 0x3478c6, 0xf29bb2][bike];
      const fenderColor = [0x2a3136, 0x26323c, 0xf7b7c8][bike];
      const saddleColor = [0xe86122, 0x2d3338, 0xe8d9be][bike];
      const rear: CampusTuple = [x, 0.36, z - 0.65];
      const front: CampusTuple = [x, 0.36, z + 0.65];
      const pedal: CampusTuple = [x, 0.36, z - 0.04];
      const saddle: CampusTuple = [x, 0.94, z - 0.25];
      const head: CampusTuple = [x, 0.94, z + 0.4];
      const fork: CampusTuple = [x, 0.65, z + 0.51];
      for (const wheel of [rear, front]) {
        const wYaw = wheel === front ? Math.PI / 2 + steerYaw : Math.PI / 2;
        tires.push({ p: wheel, s: [1, 1, 1], r: [0, wYaw, 0] });
        rims.push({ p: wheel, s: [1, 1, 1], r: [0, wYaw, 0] });
        for (let spoke = 0; spoke < 8; spoke += 1) {
          const angle = spoke * Math.PI / 4;
          detailRod(iron, wheel, [x, wheel[1] + Math.sin(angle) * 0.31, wheel[2] + Math.cos(angle) * 0.31], 0.0045);
        }
      }
      const frameEdges: Array<[CampusTuple, CampusTuple]> = bike === 2
        ? [
            // 淑女车：低跨梁（无高上横梁，从头管斜弯下接五通，辨识度一眼区分）
            [rear, saddle], [saddle, pedal], [pedal, rear],
            [[x, 0.48, z + 0.12], head], [pedal, [x, 0.48, z + 0.12]],
            [head, fork], [fork, front],
          ]
        : [
            [rear, saddle], [saddle, pedal], [pedal, rear], [saddle, head], [head, pedal], [head, fork], [fork, front],
          ];
      for (const [a, b] of frameEdges) {
        detailRod(paper, a, b, bike === 0 ? 0.026 : 0.021, frameColor);
      }
      // 挡泥板（前后轮上方弧段）
      detailBox(paper, [x, 0.72, z - 0.58], [0.09, 0.03, 0.34], fenderColor, [0.42, 0, 0]);
      detailBox(paper, [x, 0.72, z + 0.58], [0.09, 0.03, 0.34], fenderColor, [-0.42, 0, 0]);
      // 车座与车把（淑女车用宽弯把，其余用直把）
      detailRod(iron, saddle, [x, 1.015, z - 0.28], 0.018);
      detailBox(paper, [x, 1.035, z - 0.29], [0.19, 0.06, 0.28], saddleColor);
      detailRod(iron, head, [x, 1.09, z + 0.36], 0.018);
      detailRod(iron, [x - 0.24, 1.09, z + 0.36], [x + 0.24, 1.09, z + 0.36], 0.015);
      // 前车筐（0=明黄共享车筐，1=银灰金属筐，2=米色藤编筐带小书包）
      const basketColor = [0xffcc29, 0x9aa4ab, 0xd8be94][bike];
      detailBox(paper, [x, 0.92, z + 0.56], [0.3, 0.2, 0.24], basketColor);
      if (bike === 2) {
        detailBox(paper, [x, 1.01, z + 0.56], [0.22, 0.14, 0.16], 0x4b74a8);
      }
      // 通勤车与淑女车带后座货架
      if (bike >= 1) {
        detailBox(paper, [x, 0.76, z - 0.58], [0.16, 0.03, 0.42], bike === 1 ? 0x3b4448 : 0xf29bb2);
      }
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
    const display = campusMesh(parent, new THREE.PlaneGeometry(1.74, 1.28), lawPoster, [kioskX - side * 0.071, 1.56, kioskZ], false);
    display.rotation.y = -side * Math.PI / 2;
    display.name = `building-announcement-kiosk-${side}`;
    display.userData.campusDetail = true;
    detailSign('普法宣传 · 用法护己', 1.65, 0.27, [kioskX - side * 0.078, 2.34, kioskZ], -side * Math.PI / 2);
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
  const gateSign = createTextSign('千问高中', 3.4, 0.48, { background: '#4e695c', foreground: '#faf3dc', resolution: 320 });
  gateSign.position.set(0, 4.38, 13.635);
  gateSign.rotation.y = Math.PI;
  buildBuildingSportsFields(parent);
  buildBuildingCampusUpgrades(parent);
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

  // 环心 z=-24，三层世界半径为 55/58/60 米，不压缩 Z 轴；外边界约 x ±65、z -89..41。
  // 真实圆环的必要外景扩展不扩大原地坪；各层错开半节距、搭接封缝，山脚 y=-4 下沉，逐层增高融雾。
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
      ridgeColor.setHex([0x56706a, 0x6c868d, 0x899cb0][layer])
        .lerp(ridgeAccent.setHex([0x657e78, 0x7e9498, 0x99abc0][layer]), 0.14 + Math.cos(segment * 2.17) * 0.12)
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
  // 仅平移本批山环的环心，保留真实世界圆环半径；不染色或修改任何共享环境材质。
  ridge.position.z = -24;
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

  const campusReader = createCharacterActor('studentFemale', 1.65, 0x9da689, { yaw: Math.PI, leanRad: 0.04 });
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

  const campusPhotographer = createCampusPhotographer();
  parent.add(campusPhotographer);

  attachCampusBenches(parent);

  return { occluders, actors: { linxia, father, campusReader, campusObserver, campusPhotographer, bloomEnvironment } };
}

let campusIdleActors: THREE.Object3D[] = [];
const campusIdleAnimations = new Map<THREE.Object3D, CharacterAnimationController>();
const campusIdleThrottle = new Map<THREE.Object3D, { accum: number; tick: number }>();
const campusIdleCycles = new Map<THREE.Object3D, { clips: string[]; index: number; timer: number; switchSec: number }>();
let campusIdleDisposers: Array<() => void> = [];

function disposeCampusIdle(): void {
  for (const idleAnimation of campusIdleAnimations.values()) idleAnimation.dispose();
  campusIdleAnimations.clear();
  campusIdleThrottle.clear();
  campusIdleCycles.clear();
  for (const dispose of campusIdleDisposers) dispose();
  campusIdleDisposers = [];
  campusIdleActors = [];
}

function tickCampusIdle(dtSeconds: number): void {
  const canThrottle = dtSeconds > 0 && Boolean(bloomContext?.getPlayerFeet);
  for (const actor of campusIdleActors) {
    if (!actor.visible) continue;
    let idleAnimation = campusIdleAnimations.get(actor);
    const initializedBefore = Boolean(idleAnimation);
    if (!idleAnimation) {
      idleAnimation = createActorAnimation(actor) ?? undefined;
      if (idleAnimation) {
        actor.traverse((object) => { object.userData.campusDetail = true; });
        const isMale = actor.userData.campusIdleClip === 'fold_arms';
        const candidates = isMale
          ? ['make_a_call_02', 'agree', 'greet_04', 'fold_arms', 'complain_01']
          : ['wait', 'agree', 'greet_04', 'idle'];
        const available = candidates.filter((name) => idleAnimation!.hasAnimation(name));
        if (available.length > 0) {
          idleAnimation.play(available[0], { timeScale: 0.85, fadeIn: 0.35 });
          campusIdleCycles.set(actor, {
            clips: available,
            index: 0,
            timer: 0,
            switchSec: isMale ? 8.2 : 7.4,
          });
        }
        campusIdleAnimations.set(actor, idleAnimation);
      }
    }
    if (!idleAnimation) continue;
    const cycle = campusIdleCycles.get(actor);
    if (cycle && cycle.clips.length > 1 && dtSeconds > 0) {
      cycle.timer += dtSeconds;
      if (cycle.timer >= cycle.switchSec) {
        cycle.timer = 0;
        cycle.index = (cycle.index + 1) % cycle.clips.length;
        idleAnimation.play(cycle.clips[cycle.index], { timeScale: 0.85, fadeIn: 0.5 });
      }
    }
    let updateDt = dtSeconds;
    if (canThrottle && initializedBefore) {
      const dx = actor.position.x - playerFeet.x;
      const dz = actor.position.z - playerFeet.z;
      let state = campusIdleThrottle.get(actor);
      if (dx * dx + dz * dz > 18 * 18) {
        if (!state) {
          state = { accum: 0, tick: 0 };
          campusIdleThrottle.set(actor, state);
        }
        state.accum += dtSeconds;
        state.tick += 1;
        if (state.tick % 2 !== 0) continue;
        updateDt = state.accum;
        state.accum = 0;
      } else if (state && state.accum > 0) {
        updateDt += state.accum;
        state.accum = 0;
      }
    }
    idleAnimation.update(updateDt);
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

let walkElapsed = 0;
let fatherIdleDispose: (() => void) | null = null;
let phonePanPose: THREE.Object3D | null = null;
let phonePanTime = 0;
let walkingLinxia: THREE.Object3D | null = null;
let linxiaAnimation: CharacterAnimationController | null = null;
let linxiaThrottleAccum = 0;
let linxiaThrottleTick = 0;
let bloomContext: SceneRuntimeContext | null = null;
let activeBloomUniforms: ColorBloomUniforms | null = null;
let activeButterflies: ButterflyFlockState | null = null;
let walkWaitingForDialogue = false;
let buildingBusSubscriptions: Array<() => void> = [];
const playerFeet = new THREE.Vector3();
const companionFeet = new THREE.Vector3();

function clearBuildingBusSubscriptions(): void {
  for (const unsub of buildingBusSubscriptions) unsub();
  buildingBusSubscriptions = [];
}

function beginLinxiaWalk(): void {
  if (!walkWaitingForDialogue || walkArrived) return;
  walkWaitingForDialogue = false;
  linxiaAnimation?.play('walk', { timeScale: WALK_TIME_SCALE, fadeIn: 0.35 });
}

/**
 * 同行推进：只用路线的起点与终点做线性插值，位移量按真实秒数累积。
 * 不走补间是为了绕开两件事：后台标签页把 rAF 节流到 1 fps 时补间会被压住，
 * 以及全局时间缩放会同时改掉动画与位移；按 dt 累加后，任意帧率下同一秒的落点都相同。
 */
function tickLinxiaWalk(dtSeconds: number): void {
  if (!walkingLinxia || walkWaitingForDialogue || walkArrived || dtSeconds <= 0) return;
  walkElapsed = Math.min(WALK_DURATION_SEC, walkElapsed + dtSeconds);
  const progress = walkElapsed / WALK_DURATION_SEC;
  const point = pointAlongRoute(progress);
  walkingLinxia.position.set(point.x, 0, point.z);
  // 直线段没有拐点：朝向恒等于前进方向，不做逐帧角度插值（那会让转身快慢随帧率变化）
  const direction = directionAlongRoute(progress);
  walkingLinxia.rotation.y = Math.atan2(direction.x, direction.z);
  // 到达 A 栋门口：交叉淡出走路，切到低速站定待机，避免停在半步姿势
  if (progress >= 1) {
    walkArrived = true;
    linxiaAnimation?.play('afraid', { timeScale: 0.3, fadeIn: 0.6 });
  }
}

function tickColorBloom(dtSeconds: number): void {
  if (!bloomContext || !activeBloomUniforms) return;
  playerFeet.copy(activeBloomUniforms.uPlayerPos.value);
  bloomContext.getPlayerFeet?.(playerFeet);
  companionFeet.copy(bloomContext.actors.linxia.position);
  const progress = advanceColorBloom(activeBloomUniforms, playerFeet, companionFeet, dtSeconds);
  bloomContext.setAtmosphereProgress?.(progress);
}

/** 路线是否已走完（用于到点后交叉淡出走路、切到站定待机） */
let walkArrived = false;

function disposeLinxiaAnimation(): void {
  linxiaAnimation?.dispose();
  linxiaAnimation = null;
}

/** S8 运行时装：待开场对话与选项结束后再触发林夏同行；S9（同 sceneKey）不重启行走 */
export const buildingRuntime: SceneRuntime = {
  enter(context: SceneRuntimeContext): void {
    bloomContext = context;
    activeBloomUniforms = context.actors.bloomEnvironment?.userData.colorBloomUniforms ?? null;
    activeButterflies = (context.actors.bloomEnvironment?.userData.butterflies as ButterflyFlockState | undefined) ?? null;
    tickColorBloom(0);
    enterCampusIdle(context.actors);
    if (phonePanPose) phonePanPose.rotation.y = 0;
    phonePanTime = 0;
    phonePanPose = context.sceneId === 'S8'
      ? context.actors.campusPhotographer?.getObjectByName('building-phone-pose') ?? null
      : null;
    if (phonePanPose) phonePanPose.rotation.y = 0;
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
    clearBuildingBusSubscriptions();
    disposeLinxiaAnimation();
    walkArrived = false;
    walkElapsed = 0;
    walkWaitingForDialogue = Boolean(context.isModalBlocked?.());

    const linxia = context.actors.linxia;
    walkingLinxia = linxia;
    linxia.position.set(LINXIA_ROUTE[0].x, 0, LINXIA_ROUTE[0].z);
    linxia.rotation.z = 0;
    // 直线段：起点朝向即路线方向，之后每拍都按同一规则重算，不再有转身插值
    linxia.rotation.y = Math.atan2(directionAlongRoute(0).x, directionAlongRoute(0).z);

    // 真实骨骼走路：若开场对话/选项正在进行，先让林夏原地站定等待，待主角说完话再启程同行
    linxiaAnimation = createActorAnimation(linxia);
    if (walkWaitingForDialogue) {
      linxiaAnimation?.play('afraid', { timeScale: 0.35, fadeIn: 0.25 });
    } else {
      linxiaAnimation?.play('walk', { timeScale: WALK_TIME_SCALE, fadeIn: 0.2 });
    }

    const pauseBeforeWalk = (): void => {
      // 只在还没迈出第一步时改站定：走起来后对话不再打断同行（与补间版行为一致）
      if (!walkArrived && walkElapsed < WALK_DURATION_SEC * 0.01) {
        walkWaitingForDialogue = true;
        linxiaAnimation?.play('afraid', { timeScale: 0.35, fadeIn: 0.25 });
      }
    };
    buildingBusSubscriptions.push(
      context.bus.on('ui:showDialogue', pauseBeforeWalk),
      context.bus.on('ui:showChoices', pauseBeforeWalk),
      context.bus.on('ui:chooseOption', ({ stepId }) => {
        if (stepId === 's8-walk') beginLinxiaWalk();
      }),
      context.bus.on('ui:worldBlocked', ({ blocked }) => {
        if (!blocked) beginLinxiaWalk();
      }),
      context.bus.on('scene:interact', ({ sceneId, targetId }) => {
        if (sceneId !== 'S8') return;
        const messages: Record<string, string> = {
          'board-west-anti-bully': '【文明校园 · 法治护航】键盘伤人也是伤害（《未成年人保护法》第77条）；对校园霸凌零容忍，遇欺凌及时留证求助，心理热线 12355。',
          'board-east-anti-bully': '【反网暴 · 反霸凌 · 普法】不造谣、不信谣、不网暴；《民法典》第1024条与《刑法》第246条保护名誉权，紧急求助请拨 110 / 96110。',
          'board-tri-panel': '【阳光成长宣传栏】拒绝网络暴力，向校园霸凌说“不”，有烦恼及时向师长倾诉（青少年服务热线 12355）。',
        };
        const text = messages[targetId];
        if (!text) return;
        context.bus.emit('ui:showCaption', {
          stepId: `s8-${targetId}`,
          text,
          durationMs: 5200,
          kind: 'observation',
          tone: 'default',
        });
      }),
    );
    if (context.sceneId === 'S8') {
      for (const id of ['board-west-anti-bully', 'board-east-anti-bully', 'board-tri-panel']) {
        context.setInteractableVisible(id, true);
      }
    }
  },

  tick(dtSeconds: number): void {
    buildingWindTime.value += dtSeconds;
    tickColorBloom(dtSeconds);
    tickCampusIdle(dtSeconds);
    if (activeButterflies && dtSeconds > 0) {
      updateButterflyFlock(activeButterflies, dtSeconds);
    }
    if (walkWaitingForDialogue && !bloomContext?.isModalBlocked?.()) {
      beginLinxiaWalk();
    }
    // 位移在动画更新之前推进，两者共用同一拍 dt
    tickLinxiaWalk(dtSeconds);
    if (phonePanPose) {
      // 十秒小幅扫过林荫道与 A 栋；经过的两人自然入画，不追踪玩家、不抢占主镜头。
      phonePanTime = (phonePanTime + dtSeconds) % 10;
      phonePanPose.rotation.y = Math.sin(phonePanTime * Math.PI / 5) * 0.3;
    }
    if (walkingLinxia?.visible) {
      const initializedBefore = Boolean(linxiaAnimation);
      if (!linxiaAnimation) {
        linxiaAnimation = createActorAnimation(walkingLinxia);
        linxiaAnimation?.play(
          walkArrived || walkWaitingForDialogue ? 'afraid' : 'walk',
          { timeScale: walkArrived || walkWaitingForDialogue ? 0.3 : WALK_TIME_SCALE },
        );
      }
      if (linxiaAnimation) {
        let updateDt = dtSeconds;
        if (walkArrived && initializedBefore && dtSeconds > 0 && bloomContext?.getPlayerFeet) {
          const dx = walkingLinxia.position.x - playerFeet.x;
          const dz = walkingLinxia.position.z - playerFeet.z;
          if (dx * dx + dz * dz > 18 * 18) {
            linxiaThrottleAccum += dtSeconds;
            linxiaThrottleTick += 1;
            if (linxiaThrottleTick % 2 === 0) {
              linxiaAnimation.update(linxiaThrottleAccum);
              linxiaThrottleAccum = 0;
            }
          } else {
            updateDt += linxiaThrottleAccum;
            linxiaThrottleAccum = 0;
            linxiaAnimation.update(updateDt);
          }
        } else {
          updateDt += linxiaThrottleAccum;
          linxiaThrottleAccum = 0;
          linxiaAnimation.update(updateDt);
        }
      }
    }
  },

  exit(): void {
    // 先作废本代场景：仍在途的道具回调不能再往复用的 levelGroup 里补挂几何
    buildingGeneration += 1;
    disposeBuildingPropMeshes();
    clearBuildingBusSubscriptions();
    walkWaitingForDialogue = false;
    activeButterflies = null;
    linxiaThrottleAccum = 0;
    linxiaThrottleTick = 0;
    bloomContext?.setAtmosphereProgress?.(0);
    bloomContext = null;
    activeBloomUniforms = null;
    if (phonePanPose) phonePanPose.rotation.y = 0;
    phonePanPose = null;
    phonePanTime = 0;
    disposeCampusIdle();
    walkElapsed = 0;
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
    interactables:
      sceneId === 'S8'
        ? [
            { id: 'board-west-anti-bully', position: { x: -8.1, y: 1.6, z: -16.8 }, lightOffsetY: 0.45, maxDistance: 5.5 },
            { id: 'board-east-anti-bully', position: { x: 8.2, y: 1.6, z: -32.0 }, lightOffsetY: 0.45, maxDistance: 5.5 },
            { id: 'board-tri-panel', position: { x: 8.45, y: 1.56, z: -22.2 }, lightOffsetY: 0.45, maxDistance: 5.5 },
          ]
        : [],
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
            {
              id: 'phone-behind',
              position: { ...PHONE_HOTSPOT },
              maxDistance: 9,
              maxAngleDeg: 12,
              dwellMs: 2000,
              requireLineOfSight: true,
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

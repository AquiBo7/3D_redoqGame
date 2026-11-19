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
import { addBox, addGround, createActorAnimation, createCharacterActor, createTextSign, startIdleMotion } from './shared';
import type { CharacterAnimationController } from './characterAnimation';
import type { Vec3 } from './shared';

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

function buildBuilding(parent: THREE.Object3D): {
  occluders: THREE.Object3D[];
  actors: Record<string, THREE.Object3D>;
} {
  addGround(parent, 70, 0x949b96);

  const occluders: THREE.Object3D[] = [];

  // 林荫路路面（略亮的长条）
  const path = addBox(parent, { x: 0, y: 0.01, z: -22 }, { w: 4.4, h: 0.02, d: 46 }, 0x9aa2a0);
  path.receiveShadow = true;
  path.castShadow = false;

  for (const tree of TREES) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.24, 2.6, 8),
      new THREE.MeshStandardMaterial({ color: 0x7a7266, roughness: 0.95 }),
    );
    trunk.position.set(tree.x, 1.3, tree.z);
    trunk.castShadow = true;

    const foliage = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0x8fa38f, roughness: 1 }),
    );
    foliage.position.set(tree.x, 3.1, tree.z);
    foliage.castShadow = true;

    // 树冠第二层：错位小冠，避免单球“棒棒糖”感
    const foliageTop = new THREE.Mesh(
      new THREE.SphereGeometry(0.72, 10, 7),
      new THREE.MeshStandardMaterial({ color: 0x7f947e, roughness: 1 }),
    );
    foliageTop.position.set(tree.x + 0.5, 3.7, tree.z + 0.32);
    foliageTop.castShadow = true;

    parent.add(trunk, foliage, foliageTop);
    occluders.push(trunk);
  }

  // 林荫路路灯：细杆 + 暖白灯头，与街道灯保持同一低饱和语言
  for (const [index, z] of [-8, -22, -38].entries()) {
    const x = index % 2 === 0 ? 2.8 : -2.8;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, 3.4, 7),
      new THREE.MeshStandardMaterial({ color: 0x6f767c, roughness: 0.9, metalness: 0 }),
    );
    pole.position.set(x, 1.7, z);
    pole.castShadow = true;
    parent.add(pole);
    addBox(parent, { x, y: 3.52, z }, { w: 0.34, h: 0.14, d: 0.34 }, 0xd9c9a0, {
      castShadow: false,
    });
  }

  // 路侧长椅（两侧各一）：座面 + 靠背 + 两条腿
  const BENCHES: Array<{ x: number; z: number; facing: -1 | 1 }> = [
    { x: 2.9, z: -18, facing: -1 },
    { x: -2.9, z: -31, facing: 1 },
  ];
  for (const bench of BENCHES) {
    addBox(parent, { x: bench.x, y: 0.44, z: bench.z }, { w: 0.45, h: 0.08, d: 1.5 }, 0x8a7a63);
    addBox(parent, { x: bench.x - bench.facing * 0.22, y: 0.68, z: bench.z }, { w: 0.06, h: 0.4, d: 1.5 }, 0x82725c);
    for (const zOffset of [-0.6, 0.6]) {
      addBox(parent, { x: bench.x, y: 0.22, z: bench.z + zOffset }, { w: 0.4, h: 0.44, d: 0.06 }, 0x6f6558);
    }
  }

  occluders.push(addBox(parent, FACADE.center, FACADE.size, 0x9aa3a8));
  occluders.push(addBox(parent, DOOR.center, DOOR.size, 0x6d5a48));

  // A 栋立面：两排窗洞 + 入口雨棚 + 栋号牌（通用称呼，无真实校名）
  for (const y of [3.3, 5.9]) {
    for (let x = -7; x <= 7; x += 2.8) {
      addBox(parent, { x, y, z: -47.97 }, { w: 1.1, h: 1.3, d: 0.06 }, 0x5d6a73, {
        castShadow: false,
      });
    }
  }
  const awning = addBox(parent, { x: 0, y: 3.25, z: -47.15 }, { w: 3.4, h: 0.1, d: 1.3 }, 0x7f8890);
  awning.rotation.x = -0.16;
  const doorSign = createTextSign('A 栋', 1.1, 0.4);
  doorSign.position.set(0, 3.7, -47.86);
  parent.add(doorSign);

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

  return { occluders, actors: { linxia, father } };
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
    linxiaAnimation?.update(dtSeconds);
  },

  exit(): void {
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
    spawn: SPAWN,
    nav: NAV,
    // 林荫路的林夏 + 校门方向守望的爸爸
    requiredModels: ['linxia', 'father'],
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

// scenes3d/gate.ts —— 校门台阶灰盒（S5 台阶一幕 / S6 开场 CG）
// S5 进入后播放约 15s 胶囊体演出：合体胶囊沿台阶上行 → 拆分为林夏 / 爸爸两个独立胶囊体。
// 演出不锁定玩家移动；father-bags / handoff-moment / typer 三个观察热点静态放置，演出结束后仍可注视。

import * as THREE from 'three';
import { gsap } from 'gsap';
import type { SceneId } from '../data/storySchema';
import type {
  HotspotConfig,
  NavigationConfig,
  PanoramaAnchor,
  SceneRuntime,
  SceneRuntimeContext,
  SceneSpawn,
  WorldSceneDefinition,
} from '../world/worldSceneTypes';
import {
  addBox,
  addGround,
  createActorAnimation,
  createCharacterActor,
  createTextSign,
  startIdleMotion,
  yawToward,
} from './shared';
import type { CharacterAnimationController } from './characterAnimation';
import type { XZ, Vec3 } from './shared';

/** 台阶：6 级浅阶（总升 0.42m），从 z 6.0 到 2.7；台阶之上即校门前平地 */
const STEP_COUNT = 6;
const STEP_DEPTH = 0.55;
const STEP_RISE = 0.07;
const STEPS_Z_START = 6.0;

interface StepSpec {
  center: Vec3;
  size: { w: number; h: number; d: number };
}

const STEPS: StepSpec[] = Array.from({ length: STEP_COUNT }, (_, index) => ({
  center: {
    x: 0,
    y: STEP_RISE * (index + 0.5),
    z: STEPS_Z_START - STEP_DEPTH * (index + 0.5),
  },
  size: { w: 7, h: STEP_RISE, d: STEP_DEPTH },
}));

/** 校门门柱与横梁 */
const GATE_COLUMNS = [
  { center: { x: -1.7, y: 2.1, z: 1.5 }, size: { w: 0.7, h: 4.2, d: 0.7 } },
  { center: { x: 1.7, y: 2.1, z: 1.5 }, size: { w: 0.7, h: 4.2, d: 0.7 } },
  { center: { x: 0, y: 4.2, z: 1.5 }, size: { w: 4.9, h: 0.5, d: 0.6 } },
] as const;

/** 围观人群（含举手机拍照的新生），错落面向台阶中央 */
const CROWD_LOOK_TARGET: XZ = { x: 0, z: 2.8 };
const CROWD: Array<{
  position: Vec3;
  model: 'ayuan' | 'volunteer';
  color: number;
  phone?: boolean;
  /** 面向台阶时的微偏角，避免机械同向排排站 */
  yawBias?: number;
}> = [
  { position: { x: -3.6, y: 0, z: 3.4 }, model: 'ayuan', color: 0x8f9aa3, phone: true, yawBias: -0.18 },
  { position: { x: 3.8, y: 0, z: 3.0 }, model: 'volunteer', color: 0x93a0a8, yawBias: 0.2 },
  { position: { x: 4.4, y: 0, z: 1.4 }, model: 'ayuan', color: 0x8f9aa3, phone: true, yawBias: -0.12 },
  { position: { x: -4.0, y: 0, z: 1.0 }, model: 'volunteer', color: 0x96a3ab, yawBias: 0.15 },
];

/** 台阶旁低头打字的男生（橙色手机壳是认人暗号，不做特写） */
const TYPER = { position: { x: -2.5, y: 0, z: 4.4 }, color: 0x7f8894 } as const;

/** 合体胶囊起始位（台阶下）与拆分点（台阶顶平地） */
const CARRY_START = { x: 0.9, z: 5.4 } as const;
const HANDOFF_POINT = { x: -0.45, z: 2.45 } as const;
const SPLIT_POS = {
  linxia: { x: -0.45, z: 2.45 },
  father: { x: -0.85, z: 2.6 },
  bags: { x: -1.15, z: 2.55 },
} as const;

const SPAWN: SceneSpawn = { x: 0, z: 7.6, yaw: 0, pitchDeg: -4 };

/** S6 开场 CG 全景锚点：从台阶前缓缓拉远抬高，收下校门、横幅、台阶与人群 */
const PANORAMA_ANCHOR: PanoramaAnchor = {
  position: { x: 0, y: 3.6, z: 5.6 },
  lookAt: { x: 0, y: 1.7, z: 1.4 },
};

const NAV: NavigationConfig = {
  groundY: 0,
  bounds: { minX: -5.6, maxX: 5.6, minZ: -5.5, maxZ: 8.6 },
  obstacles: [
    ...GATE_COLUMNS.map((column, index) => ({
      id: `gate-column-${index}`,
      minX: column.center.x - column.size.w / 2,
      maxX: column.center.x + column.size.w / 2,
      minZ: column.center.z - column.size.d / 2,
      maxZ: column.center.z + column.size.d / 2,
      height: column.size.h,
    })),
    ...CROWD.map((person, index) => ({
      id: `gate-crowd-${index}`,
      minX: person.position.x - 0.4,
      maxX: person.position.x + 0.4,
      minZ: person.position.z - 0.4,
      maxZ: person.position.z + 0.4,
      height: 1.7,
    })),
    {
      id: 'gate-typer',
      minX: TYPER.position.x - 0.4,
      maxX: TYPER.position.x + 0.4,
      minZ: TYPER.position.z - 0.4,
      maxZ: TYPER.position.z + 0.4,
      height: 1.7,
    },
  ],
};

const HOTSPOTS: HotspotConfig[] = [
  { id: 'typer', position: { x: -2.5, y: 1.35, z: 4.4 }, maxDistance: 18 },
  { id: 'handoff-moment', position: { x: -0.45, y: 1.45, z: 2.45 }, maxDistance: 16 },
  { id: 'father-bags', position: { x: -0.05, y: 0.6, z: 1.25 }, maxDistance: 15 },
];

function buildGate(parent: THREE.Object3D): {
  occluders: THREE.Object3D[];
  actors: Record<string, THREE.Object3D>;
} {
  addGround(parent, 40, 0x949b96);

  const occluders: THREE.Object3D[] = [];

  for (const [index, step] of STEPS.entries()) {
    const mesh = addBox(parent, step.center, step.size, 0x9aa3a0);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    // 台阶前缘防滑条：随台阶抬升，仅 1.2cm 厚，不影响通行与热点
    addBox(
      parent,
      {
        x: 0,
        y: STEP_RISE * (index + 1) + 0.006,
        z: STEPS_Z_START - STEP_DEPTH * index - 0.035,
      },
      { w: 6.9, h: 0.012, d: 0.06 },
      0xb7bcb6,
      { castShadow: false },
    );
  }

  for (const [index, column] of GATE_COLUMNS.entries()) {
    occluders.push(addBox(parent, column.center, column.size, 0x8d949a));
    if (index < 2) {
      // 门柱装饰线脚：两道浅色横向刻线，增加低饱和石材层次
      addBox(
        parent,
        { x: column.center.x, y: 1.15, z: column.center.z },
        { w: 0.82, h: 0.12, d: 0.82 },
        0xa8afb2,
      );
      addBox(
        parent,
        { x: column.center.x, y: 2.95, z: column.center.z },
        { w: 0.82, h: 0.12, d: 0.82 },
        0xa8afb2,
      );
    }
  }

  // 迎新横幅占位（通用称呼，内容安全），两端加细支撑杆
  const banner = createTextSign('迎新报到', 3.2, 0.7);
  banner.position.set(0, 3.1, 1.42);
  parent.add(banner);
  occluders.push(banner);
  for (const side of [-1, 1]) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.55, 8),
      new THREE.MeshStandardMaterial({ color: 0x7d848a, roughness: 0.88, metalness: 0 }),
    );
    pole.position.set(side * 1.62, 3.7, 1.42);
    parent.add(pole);
  }

  // 门卫亭占位（校门内侧，远景剪影，不参与导航与热点）
  const booth = new THREE.Group();
  addBox(booth, { x: 0, y: 1.1, z: 0 }, { w: 1.8, h: 2.2, d: 1.8 }, 0x8b9298);
  addBox(booth, { x: 0, y: 2.28, z: 0 }, { w: 2.1, h: 0.14, d: 2.1 }, 0x757c82);
  addBox(booth, { x: 0, y: 1.5, z: 0.91 }, { w: 1.1, h: 0.6, d: 0.04 }, 0x5c666e, {
    castShadow: false,
  });
  booth.position.set(-3.6, 0, -2.2);
  parent.add(booth);

  // 校园远景建筑剪影：低饱和体块，雾中形成纵深（不挡台阶与校门）
  addBox(parent, { x: -6, y: 2.8, z: -10 }, { w: 6, h: 5.6, d: 3 }, 0xa7aeb1, {
    castShadow: false,
  });
  addBox(parent, { x: 5.8, y: 3.6, z: -11 }, { w: 6, h: 7.2, d: 3 }, 0xa0a8ad, {
    castShadow: false,
  });
  addBox(parent, { x: 0, y: 4.5, z: -15 }, { w: 11, h: 9, d: 3 }, 0x9aa2a8, {
    castShadow: false,
  });

  // 围观人群：3D 角色错落面向台阶中央，部分举低饱和手机方块
  const crowdActors: Record<string, THREE.Object3D> = {};
  for (const [index, person] of CROWD.entries()) {
    const actor = createCharacterActor(person.model, 1.66, person.color, {
      yaw: yawToward(person.position, CROWD_LOOK_TARGET) + (person.yawBias ?? 0),
      props: person.phone ? [{ kind: 'phone', color: 0x9aa2ab }] : [],
    });
    actor.position.copy(person.position as THREE.Vector3);
    parent.add(actor);
    occluders.push(actor);
    crowdActors[`crowd-${index}`] = actor;
  }

  // 台阶旁低头打字的男生：面向台阶、微前倾，胸前手持橙色手机壳方块
  const typer = createCharacterActor('ayuan', 1.68, TYPER.color, {
    yaw: yawToward(TYPER.position, { x: 0, z: 4.3 }) + 0.15,
    leanRad: 0.22,
    props: [{ kind: 'phone', color: 0xd98a4a, offset: { y: -0.04 } }],
  });
  typer.position.set(TYPER.position.x, TYPER.position.y, TYPER.position.z);
  parent.add(typer);
  occluders.push(typer);

  // 合体：爸爸背林夏，两人都面向 -Z；爸爸微前倾，林夏上移并向 +Z 错开 0.3m 避免穿模
  const carryGroup = new THREE.Group();
  const carryFather = createCharacterActor('father', 1.78, 0x8f8578, {
    yaw: Math.PI,
    leanRad: 0.12,
    props: [
      { kind: 'bag', color: 0x9b8f78, side: 'left' },
      { kind: 'bag', color: 0x9b8f78, side: 'right' },
    ],
  });
  const carryLinxia = createCharacterActor('linxia', 1.62, 0xe8d9a8, { yaw: Math.PI });
  carryLinxia.position.set(0, 0.45, 0.3);
  carryGroup.add(carryFather, carryLinxia);
  carryGroup.position.set(CARRY_START.x, 0, CARRY_START.z);
  parent.add(carryGroup);

  // 拆分后的独立角色（初始隐藏）与爸爸提着的袋子
  const linxiaSolo = createCharacterActor('linxia', 1.62, 0xe8d9a8, { yaw: Math.PI });
  linxiaSolo.position.set(SPLIT_POS.linxia.x, 0, SPLIT_POS.linxia.z);
  linxiaSolo.visible = false;

  const fatherSolo = createCharacterActor('father', 1.78, 0x8f8578, { yaw: Math.PI });
  fatherSolo.position.set(SPLIT_POS.father.x, 0, SPLIT_POS.father.z);
  fatherSolo.visible = false;

  // 爸爸手提的两只袋子：与 createCharacterProp 的袋子同高同距（袋顶≈0.81m，贴手侧自然下垂），
  // 组原点回到地面 y=0，避免旧版 y=0.55 + 内层 0.5 造成箱子漂在胸口的穿帮
  const bagsSolo = new THREE.Group();
  for (const side of [-1, 1]) {
    addBox(
      bagsSolo,
      { x: side * 0.2, y: 0.6, z: 0 },
      { w: 0.3, h: 0.42, d: 0.24 },
      0x9b8f78,
    );
    addBox(
      bagsSolo,
      { x: side * 0.2, y: 0.84, z: 0 },
      { w: 0.16, h: 0.035, d: 0.04 },
      0x7e7464,
      { castShadow: false },
    );
  }
  bagsSolo.position.set(SPLIT_POS.bags.x, 0, SPLIT_POS.bags.z);
  bagsSolo.visible = false;

  parent.add(linxiaSolo, fatherSolo, bagsSolo);
  occluders.push(carryFather, carryLinxia);

  return {
    occluders,
    actors: {
      carryGroup,
      carryFather,
      carryLinxia,
      linxiaSolo,
      fatherSolo,
      bagsSolo,
      typer,
      ...crowdActors,
    },
  };
}

let performanceTimeline: gsap.core.Timeline | null = null;
/** 拆分后林夏的骨骼动画控制器：走路 → 站定拘谨，退出场景时彻底释放 */
let linxiaAnimation: CharacterAnimationController | null = null;

function disposeLinxiaAnimation(): void {
  linxiaAnimation?.dispose();
  linxiaAnimation = null;
}

function resetPerformanceState(actors: Record<string, THREE.Object3D>): void {
  const carry = actors.carryGroup;
  const carryFather = actors.carryFather;
  const carryLinxia = actors.carryLinxia;
  const linxia = actors.linxiaSolo;
  const father = actors.fatherSolo;
  const bags = actors.bagsSolo;

  carry.visible = true;
  carry.position.set(CARRY_START.x, 0, CARRY_START.z);
  carry.rotation.set(0, 0, 0);
  carryFather.rotation.set(0, Math.PI, 0);
  carryLinxia.rotation.set(0, Math.PI, 0);
  linxia.visible = false;
  linxia.position.set(SPLIT_POS.linxia.x, 0, SPLIT_POS.linxia.z);
  linxia.rotation.set(0, Math.PI, 0);
  father.visible = false;
  father.position.set(SPLIT_POS.father.x, 0, SPLIT_POS.father.z);
  father.rotation.set(0, Math.PI, 0);
  bags.visible = false;
  bags.position.set(SPLIT_POS.bags.x, 0, SPLIT_POS.bags.z);
}

function playPerformance(actors: Record<string, THREE.Object3D>): void {
  resetPerformanceState(actors);
  disposeLinxiaAnimation();

  const carry = actors.carryGroup;
  const carryFather = actors.carryFather;
  const carryLinxia = actors.carryLinxia;
  const linxia = actors.linxiaSolo;
  const father = actors.fatherSolo;
  const bags = actors.bagsSolo;

  const timeline = gsap.timeline();

  // 0–7s：沿台阶缓步上行（y 随台阶升到 0.42），整体与双人各自的重心左右摇晃
  timeline.to(carry.position, { x: HANDOFF_POINT.x, z: HANDOFF_POINT.z, duration: 7, ease: 'none' }, 0);
  timeline.to(carry.position, { y: STEP_RISE * STEP_COUNT, duration: 6.2, ease: 'power1.in' }, 0);
  timeline.to(carry.rotation, { z: 0.04, yoyo: true, repeat: 5, duration: 1.05, ease: 'sine.inOut' }, 0);
  timeline.to(carryFather.rotation, { z: 0.03, yoyo: true, repeat: 5, duration: 1.05, ease: 'sine.inOut' }, 0);
  timeline.to(carryLinxia.rotation, { z: -0.022, yoyo: true, repeat: 6, duration: 0.95, ease: 'sine.inOut' }, 0.2);
  // 肩部朝向微摆：幅度控制在 ±4°，不破坏“面向校门”的整体姿态
  timeline.to(carryFather.rotation, { y: Math.PI + 0.06, yoyo: true, repeat: 4, duration: 1.4, ease: 'sine.inOut' }, 0);
  timeline.to(carryLinxia.rotation, { y: Math.PI - 0.05, yoyo: true, repeat: 4, duration: 1.35, ease: 'sine.inOut' }, 0.3);

  // 7–8s：踏上平地，身高落回地面
  timeline.to(carry.position, { y: 0, duration: 1, ease: 'power1.out' }, 7);

  // 9.6s：放下她 —— 合体拆分，袋子随爸爸；林夏落地的同时开始真实骨骼走路
  timeline.add(() => {
    carry.visible = false;
    linxia.visible = true;
    father.visible = true;
    bags.visible = true;
    linxiaAnimation = createActorAnimation(linxia);
    linxiaAnimation?.play('walk', { timeScale: 0.8, fadeIn: 0.2 });
  }, 9.6);

  // 9.6–12.05s：林夏跛行慢走（0.8 倍速步态约 0.84m/s，2.04m 路程≈2.45s，脚不打滑），
  // 爸爸落后半步跟在后面，袋子换到另一侧
  timeline.to(linxia.position, { x: 0.15, z: 0.5, duration: 2.45, ease: 'none' }, 9.6);
  timeline.to(father.position, { x: -0.35, z: 1.15, duration: 4.4, ease: 'none' }, 9.9);
  timeline.to(bags.position, { x: -0.05, z: 1.25, duration: 4.2, ease: 'none' }, 9.9);
  // 拆分后的行走重心：林夏轻微跛行侧倾，爸爸幅度更小（纵向起伏交给走路骨骼动画）
  timeline.to(linxia.rotation, { z: 0.028, yoyo: true, repeat: 4, duration: 0.5, ease: 'sine.inOut' }, 9.6);
  timeline.to(linxia.rotation, { y: Math.PI + 0.045, yoyo: true, repeat: 2, duration: 1, ease: 'sine.inOut' }, 9.6);
  timeline.to(father.rotation, { z: -0.016, yoyo: true, repeat: 6, duration: 0.62, ease: 'sine.inOut' }, 9.9);
  timeline.to(father.rotation, { y: Math.PI - 0.03, yoyo: true, repeat: 3, duration: 1.2, ease: 'sine.inOut' }, 9.9);

  // 12.05s：走完最后一步，交叉淡入到低速“站定”待机（拘谨），避免停在机械绑定姿势
  timeline.add(() => {
    linxiaAnimation?.play('afraid', { timeScale: 0.25, fadeIn: 0.7 });
  }, 12.05);

  performanceTimeline = timeline;
}

/** 站立角色的呼吸 / 微摆清理函数（enter 重启、exit 必杀，杜绝补间泄漏） */
let idleDisposers: Array<() => void> = [];

function stopIdleMotions(): void {
  for (const dispose of idleDisposers) dispose();
  idleDisposers = [];
}

function startGateIdleMotions(actors: Record<string, THREE.Object3D>): void {
  const ids = ['crowd-0', 'crowd-1', 'crowd-2', 'crowd-3', 'typer'];
  for (const [index, id] of ids.entries()) {
    const actor = actors[id];
    if (!actor) continue;
    idleDisposers.push(
      startIdleMotion(actor, {
        breathAmp: 0.005,
        swayAmp: 0.005,
        period: 2.6 + index * 0.23,
      }),
    );
  }
}

/** S5 运行时装：只播放一次演出；S6（同 sceneKey）不重播 */
export const gateRuntime: SceneRuntime = {
  enter(context: SceneRuntimeContext): void {
    // 站立角色呼吸微动在 S5/S6 共用；重复 enter 先杀掉旧补间
    stopIdleMotions();
    startGateIdleMotions(context.actors);

    if (context.sceneId !== 'S5') return;
    if (performanceTimeline) {
      performanceTimeline.kill();
      performanceTimeline = null;
    }
    playPerformance(context.actors);
  },

  tick(dtSeconds: number): void {
    linxiaAnimation?.update(dtSeconds);
  },

  exit(): void {
    stopIdleMotions();
    disposeLinxiaAnimation();
    if (performanceTimeline) {
      performanceTimeline.kill();
      performanceTimeline = null;
    }
  },
};

export function createGateDefinition(sceneId: SceneId): WorldSceneDefinition {
  const isS5 = sceneId === 'S5';

  return {
    sceneKey: 'gate',
    spawn: SPAWN,
    nav: NAV,
    // 围观 / 打字男生 / 爸爸背林夏与拆分演出共 4 位角色
    requiredModels: ['linxia', 'father', 'ayuan', 'volunteer'],
    interactables: [],
    hotspots: isS5 ? HOTSPOTS : [],
    zones: isS5
      ? [
          {
            id: 'school-gate',
            kind: 'box',
            center: { x: 0, y: 0.9, z: 1.2 },
            size: { x: 5.6, y: 3.4, z: 2.4 },
          },
        ]
      : [],
    panoramaAnchor: PANORAMA_ANCHOR,
    fog: { color: 0xb9c6d2, near: 14, far: 60 },
    build: buildGate,
  };
}

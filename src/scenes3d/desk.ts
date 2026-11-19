// scenes3d/desk.ts —— 迟到登记处灰盒（S7）
// 出生点直接正对登记桌；登记表为观察热点；药袋为交互光点，捡起（picked=true）后由 Runtime 隐藏。

import * as THREE from 'three';
import type { SceneId } from '../data/storySchema';
import type {
  NavigationConfig,
  SceneRuntime,
  SceneRuntimeContext,
  SceneSpawn,
  WorldSceneDefinition,
} from '../world/worldSceneTypes';
import { addBox, addGround, createActorAnimation, createCharacterActor, startIdleMotion } from './shared';
import type { CharacterAnimationController } from './characterAnimation';

/** 迟到登记桌与登记表 */
const DESK = { center: { x: 0, y: 0.4, z: -4 }, size: { w: 2.6, h: 0.8, d: 1 } } as const;
const REASON_FORM = { center: { x: 0, y: 0.83, z: -3.56 }, size: { w: 0.5, h: 0.02, d: 0.34 } } as const;

/** 掉在地上的药袋（占位物体 + 交互光点，捡起后隐藏） */
const MEDICINE_BAG = { center: { x: 1.15, y: 0.09, z: -3.15 }, size: { w: 0.3, h: 0.18, d: 0.22 } } as const;

/** 校门内广场的背景门柱（视觉残留，提示刚过校门） */
const BACK_GATE_COLUMNS = [
  { center: { x: -1.9, y: 2.2, z: 2.6 }, size: { w: 0.7, h: 4.4, d: 0.7 } },
  { center: { x: 1.9, y: 2.2, z: 2.6 }, size: { w: 0.7, h: 4.4, d: 0.7 } },
] as const;

/** 角色站位：志愿者（桌后）、林夏（桌旁）、爸爸（门外提袋，不进来） */
const STANDS = {
  volunteer: { x: 0, z: -5.1 },
  linxia: { x: 1.95, z: -3.1 },
  father: { x: 0, z: 4.8 },
} as const;

const SPAWN: SceneSpawn = { x: 0, z: -1.6, yaw: 0, pitchDeg: -6 };

const NAV: NavigationConfig = {
  groundY: 0,
  bounds: { minX: -5, maxX: 5, minZ: -6.5, maxZ: 5.5 },
  obstacles: [
    { id: 'desk-desk', minX: -1.3, maxX: 1.3, minZ: -4.5, maxZ: -3.5, height: 0.8 },
    { id: 'desk-volunteer', minX: -0.45, maxX: 0.45, minZ: -5.5, maxZ: -4.7, height: 1.7 },
    { id: 'desk-linxia', minX: 1.55, maxX: 2.35, minZ: -3.5, maxZ: -2.7, height: 1.62 },
    ...BACK_GATE_COLUMNS.map((column, index) => ({
      id: `desk-column-${index}`,
      minX: column.center.x - column.size.w / 2,
      maxX: column.center.x + column.size.w / 2,
      minZ: column.center.z - column.size.d / 2,
      maxZ: column.center.z + column.size.d / 2,
      height: column.size.h,
    })),
    { id: 'desk-father', minX: -0.55, maxX: 0.55, minZ: 4.25, maxZ: 5.35, height: 1.78 },
  ],
};

function buildDesk(parent: THREE.Object3D): {
  occluders: THREE.Object3D[];
  actors: Record<string, THREE.Object3D>;
} {
  addGround(parent, 30, 0x949b96);

  const occluders: THREE.Object3D[] = [];

  occluders.push(addBox(parent, DESK.center, DESK.size, 0x8d7f6c));
  occluders.push(addBox(parent, REASON_FORM.center, REASON_FORM.size, 0xe8e2d0));

  // 桌布：桌面覆盖 + 前缘垂布（深绿灰低饱和，衬托白色登记表）
  addBox(parent, { x: 0, y: 0.815, z: -4 }, { w: 2.72, h: 0.03, d: 1.12 }, 0x6f7f74, {
    castShadow: false,
  });
  addBox(parent, { x: 0, y: 0.63, z: -3.485 }, { w: 2.72, h: 0.34, d: 0.02 }, 0x66756b, {
    castShadow: false,
  });
  // 登记簿与笔：登记表旁的细小叙事道具
  addBox(parent, { x: -0.58, y: 0.855, z: -3.62 }, { w: 0.34, h: 0.04, d: 0.24 }, 0x7d5b52);
  addBox(parent, { x: -0.58, y: 0.878, z: -3.62 }, { w: 0.3, h: 0.006, d: 0.2 }, 0xe9e4d6, {
    castShadow: false,
  });
  const pen = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.17, 6),
    new THREE.MeshStandardMaterial({ color: 0x2f3a44, roughness: 0.6, metalness: 0 }),
  );
  pen.rotation.z = Math.PI / 2;
  pen.position.set(0.34, 0.856, -3.5);
  parent.add(pen);

  // 遮阳棚：四根细柱 + 顶棚（前沿收在登记桌两侧，不挡热点视线与通行）
  for (const x of [-1.75, 1.75]) {
    for (const z of [-5.25, -3.25]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 3.0, 7),
        new THREE.MeshStandardMaterial({ color: 0x7c8278, roughness: 0.92, metalness: 0 }),
      );
      post.position.set(x, 1.5, z);
      parent.add(post);
    }
  }
  // 顶棚抬高到 3.05m，仅覆盖登记桌上方；用不受光基础材质避免仰视时出现大片黑色“天花板”
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(3.9, 0.06, 2.1),
    new THREE.MeshBasicMaterial({ color: 0xb9bfb2 }),
  );
  canopy.position.set(0, 3.05, -4.3);
  parent.add(canopy);

  const medicineBag = addBox(parent, MEDICINE_BAG.center, MEDICINE_BAG.size, 0xc7b98f);
  // 药袋标识：白底标签 + 低饱和红十字（远看仍能辨认，不出现任何真实品牌）
  addBox(parent, { x: MEDICINE_BAG.center.x, y: 0.183, z: MEDICINE_BAG.center.z }, { w: 0.18, h: 0.005, d: 0.14 }, 0xe9e3d3, {
    castShadow: false,
  });
  addBox(parent, { x: MEDICINE_BAG.center.x, y: 0.188, z: MEDICINE_BAG.center.z }, { w: 0.1, h: 0.004, d: 0.024 }, 0xb45a52, {
    castShadow: false,
  });
  addBox(parent, { x: MEDICINE_BAG.center.x, y: 0.188, z: MEDICINE_BAG.center.z }, { w: 0.024, h: 0.004, d: 0.1 }, 0xb45a52, {
    castShadow: false,
  });
  occluders.push(medicineBag);

  for (const column of BACK_GATE_COLUMNS) {
    occluders.push(addBox(parent, column.center, column.size, 0x8d949a));
  }

  const volunteer = createCharacterActor('volunteer', 1.7, 0xb08a72, { yaw: 0 });
  volunteer.position.set(STANDS.volunteer.x, 0, STANDS.volunteer.z);
  // 林夏微侧身：同时面向登记桌与玩家（登记桌在 -X，玩家在 +Z）
  const linxia = createCharacterActor('linxia', 1.62, 0xe8d9a8, { yaw: -0.8 });
  linxia.position.set(STANDS.linxia.x, 0, STANDS.linxia.z);
  // 爸爸站在校门外，面向校内登记处（-Z），双手各提一只袋子
  const father = createCharacterActor('father', 1.78, 0x8f8578, {
    yaw: Math.PI,
    props: [
      { kind: 'bag', color: 0x9b8f78, side: 'left' },
      { kind: 'bag', color: 0x9b8f78, side: 'right' },
    ],
  });
  father.position.set(STANDS.father.x, 0, STANDS.father.z);

  parent.add(volunteer, linxia, father);
  occluders.push(volunteer, linxia, father);

  return { occluders, actors: { medicineBag, volunteer, linxia, father } };
}

let stateSubscription: (() => void) | null = null;
let idleDisposers: Array<() => void> = [];
/** 林夏在登记桌旁的拘谨待机（骨骼动画，放慢播放避免夸张） */
let linxiaAnimation: CharacterAnimationController | null = null;

function stopIdleMotions(): void {
  for (const dispose of idleDisposers) dispose();
  idleDisposers = [];
}

function disposeLinxiaAnimation(): void {
  linxiaAnimation?.dispose();
  linxiaAnimation = null;
}

/** S7 运行时装：捡起药袋（picked=true）后隐藏药袋占位物体与光点 */
export const deskRuntime: SceneRuntime = {
  enter(context: SceneRuntimeContext): void {
    if (context.sceneId !== 'S7') return;
    if (stateSubscription) {
      stateSubscription();
      stateSubscription = null;
    }
    stopIdleMotions();
    disposeLinxiaAnimation();
    for (const [index, id] of ['volunteer', 'linxia', 'father'].entries()) {
      const actor = context.actors[id];
      if (!actor) continue;
      idleDisposers.push(
        startIdleMotion(actor, {
          breathAmp: 0.005,
          swayAmp: 0.004,
          period: 2.7 + index * 0.3,
        }),
      );
    }

    // 林夏攥着证件站在桌旁：放慢的拘谨动作，表现拘束与紧绷而非夸张表演
    const linxiaActor = context.actors.linxia;
    if (linxiaActor) {
      linxiaAnimation = createActorAnimation(linxiaActor);
      linxiaAnimation?.play('afraid', { timeScale: 0.45, fadeIn: 0.6 });
    }

    const hideBag = (): void => {
      context.actors.medicineBag.visible = false;
      context.setInteractableVisible('medicine-bag', false);
    };

    stateSubscription = context.bus.on('state:changed', ({ state }) => {
      if (state.picked) hideBag();
    });
  },

  tick(dtSeconds: number): void {
    linxiaAnimation?.update(dtSeconds);
  },

  exit(): void {
    stopIdleMotions();
    disposeLinxiaAnimation();
    if (stateSubscription) {
      stateSubscription();
      stateSubscription = null;
    }
  },
};

export function createDeskDefinition(_sceneId: SceneId): WorldSceneDefinition {
  return {
    sceneKey: 'desk',
    spawn: SPAWN,
    nav: NAV,
    // 桌后志愿者 / 桌旁林夏 / 门外提袋爸爸
    requiredModels: ['volunteer', 'linxia', 'father'],
    interactables: [
      {
        id: 'medicine-bag',
        position: MEDICINE_BAG.center,
        lightOffsetY: 0.3,
        hitRadius: 0.4,
        maxDistance: 3.5,
      },
    ],
    hotspots: [{ id: 'reason-form', position: { x: 0, y: 0.85, z: -3.56 }, maxDistance: 8 }],
    fog: { color: 0xb9c6d2, near: 12, far: 44 },
    build: buildDesk,
  };
}

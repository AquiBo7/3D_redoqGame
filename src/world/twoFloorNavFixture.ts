// world/twoFloorNavFixture.ts —— 「1F + 双跑折返楼梯 + 2F」最小可复现导航拓扑
// 多层导航单测的共享夹具，也是下一阶段教学楼场景装配可直接套用的 NavigationConfig 范例。
// 纯数据，不含运行时逻辑。
//
// 俯视（X 向右、Z 向下）：
//
//                 x=-8 ............ x=0 | x=0 ... x=3
//   z=-8  ┌─────────────────────────────┐│           │  2F 专属外廊（1F 是草坪）
//   z=-4  ├─────────────────────────────┤┤ 梯段 A ↓  │  3.8 → 1.9
//         │      1F 教室 / 2F 走廊      │├───────────┤
//   z= 0  │   （同一 XZ 轮廓，靠 minY/  ││ 休息平台  │  1.9
//         │     maxY 高度带区分）       │├───────────┤
//   z= 1  │                            ││ 梯段 B ↓  │  1.9 → 0
//   z= 4.4│        ◎ 1F 办公室门口触发区│└───────────┘  梯脚在 2F 楼板正下方
//   z= 5  └────────────────────────────┘
//
// 楼梯在 x∈[0,3] 竖跑，两段各 4 米落 1.9 米（坡度 -0.475），折返平台 1 米。

import type { GroundSurface, ObstacleAabb, RectBounds } from './navMath';
import type { NavigationConfig, SceneSpawn, ZoneConfig } from './worldSceneTypes';

/** 2F 楼板面高度（米） */
export const FLOOR2_Y = 3.8;

/** 双跑折返楼梯的休息平台高度（米） */
export const LANDING_Y = 1.9;

/** 楼梯间 X 范围：x∈[STAIR_MIN_X, 3]，与上下层房间在 x=0 处相接 */
export const STAIR_MIN_X = 0;

/** 梯段中线（楼梯半宽处，测试沿此线直上直下） */
export const STAIR_CENTER_X = 1.5;

/** 楼梯单段坡度：每 +1 米 Z 下降 (3.8 - 1.9) / 4 米 */
const RUN_SLOPE_Z = -LANDING_Y / 4;

export const TWO_FLOOR_SURFACES: GroundSurface[] = [
  { id: 'floor-1f', minX: -8, maxX: 0, minZ: -4, maxZ: 5, height: 0 },
  { id: 'floor-2f', minX: -8, maxX: 0, minZ: -4, maxZ: 5, height: FLOOR2_Y },
  { id: 'balcony-2f', minX: -8, maxX: 0, minZ: -8, maxZ: -4, height: FLOOR2_Y },
  { id: 'stair-run-a', minX: STAIR_MIN_X, maxX: 3, minZ: -4, maxZ: 0, height: FLOOR2_Y, slopeZ: RUN_SLOPE_Z },
  { id: 'stair-landing', minX: STAIR_MIN_X, maxX: 3, minZ: 0, maxZ: 1, height: LANDING_Y },
  { id: 'stair-run-b', minX: STAIR_MIN_X, maxX: 3, minZ: 1, maxZ: 5, height: LANDING_Y, slopeZ: RUN_SLOPE_Z },
];

export const TWO_FLOOR_BOUNDS: RectBounds[] = [
  // 1F 教室：与 2F 走廊共用 XZ 轮廓，靠 maxY 排除上层玩家
  { minX: -8, maxX: 0, minZ: -4, maxZ: 5, maxY: LANDING_Y },
  // 2F 走廊：同一 XZ 轮廓，靠 minY 排除下层玩家
  { minX: -8, maxX: 0, minZ: -4, maxZ: 5, minY: LANDING_Y },
  // 2F 专属外廊：1F 这一片不可通行
  { minX: -8, maxX: 0, minZ: -8, maxZ: -4, minY: LANDING_Y },
  // 双跑楼梯间：不填高度带即全高有效，保证上下层在衔接处不被外层 bounds 卡死
  { minX: STAIR_MIN_X, maxX: 3, minZ: -4, maxZ: 5 },
];

export const TWO_FLOOR_OBSTACLES: ObstacleAabb[] = [
  // 1F 办公桌：只挡 1F 玩家
  { id: 'f1-desk', minX: -6, maxX: -5, minZ: -2, maxZ: -1, minY: 0, maxY: 0.8 },
  // 2F 课桌：只挡 2F 玩家
  { id: 'f2-desk', minX: -6, maxX: -5, minZ: 1.5, maxZ: 2.5, minY: FLOOR2_Y, maxY: FLOOR2_Y + 0.75 },
  // 全高隔墙：缺省不带高度区间，两层一律阻挡
  { id: 'partition', minX: -3.2, maxX: -3, minZ: -3.5, maxZ: -3.3 },
];

export const TWO_FLOOR_NAV: NavigationConfig = {
  bounds: TWO_FLOOR_BOUNDS,
  obstacles: TWO_FLOOR_OBSTACLES,
  groundY: 0,
  surfaces: TWO_FLOOR_SURFACES,
};

/** 2F 办公室门口触发区（圆形，位于 2F 楼板正下方的 1F） */
export const F1_OFFICE_ZONE: ZoneConfig = {
  id: 'f1-office',
  kind: 'circle',
  center: { x: -2, y: 0, z: 4.4 },
  radius: 1.5,
  once: true,
};

/** 与既有 S8 building-entrance 同比例的盒形区域，用于验证单层 box 区域不被新容差误伤 */
export const F1_DOORWAY_BOX_ZONE: ZoneConfig = {
  id: 'f1-doorway',
  kind: 'box',
  center: { x: -6.5, y: 0.9, z: -3 },
  size: { x: 3, y: 3.6, z: 2 },
};

/** 2F 出生：必须显式给 y，否则会落在 1F 基准地面上 */
export const SPAWN_2F: SceneSpawn = { x: -4, z: 0, y: FLOOR2_Y, yaw: Math.PI, pitchDeg: 0 };

/** 2F 楼梯口出生，面向 +Z（即下楼方向） */
export const SPAWN_STAIR_TOP_2F: SceneSpawn = {
  x: STAIR_CENTER_X,
  z: -3.9,
  y: FLOOR2_Y,
  yaw: Math.PI,
  pitchDeg: 0,
};

/** 站在 1F 办公室触发区正上方的 2F 玩家 */
export const SPAWN_ABOVE_OFFICE_2F: SceneSpawn = {
  x: F1_OFFICE_ZONE.center.x,
  z: F1_OFFICE_ZONE.center.z,
  y: FLOOR2_Y,
  yaw: Math.PI,
  pitchDeg: 0,
};

/** 1F 出生：不填 y，由 nav.groundY 连续采样落到 1F 地面（头顶就是 2F 楼板） */
export const SPAWN_1F: SceneSpawn = { x: -4, z: 0, yaw: 0, pitchDeg: 0 };

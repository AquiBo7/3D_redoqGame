// scenes3d/schoolInterior.ts —— 双层教学楼（1F 辅导员办公室/阅览室/玄关 + 可步行双跑折返楼梯 + 2F 教室/走廊/侧楼梯平台）
// 严格对照《一条截图_教学楼审查与Blender执行提示词》第 2～4 节重构：
//   · P0-01：按柱跨凹间重排走廊立柱、公告栏与八门百叶矮柜，保证距柱边与门套留足净距、零穿插截断。
//   · P0-02：改为顺板长拼缝哑光暖木地板（roughness 0.60）+ 非叠加窗格柔光带（NormalBlending）+ 克制夕照点光，消除门槛过曝白斑。
//   · P0-03：移除重复叠加玻璃，每扇窗格独立嵌入单层浅灰蓝玻璃，木窗框与密实褶皱窗帘走不透明通道。
//   · P1-04/05：接入 tools/blender_school_kit.py 生产的 13 件高精度低模套件（倒角课桌椅、掏空书斗、百叶柜、书包、公告栏、讲桌、圆网音箱、胡桃木办公桌、档案柜与 A/B/C 三型香樟树 + 留白透天庭院）。

import * as THREE from 'three';
import type { SceneId } from '../data/storySchema';
import type { GroundSurface, ObstacleAabb, RectBounds } from '../world/navMath';
import { loadPropModel, type PropModelAsset } from '../world/resources';
import type { SceneRuntime, SceneRuntimeContext, WorldSceneDefinition } from '../world/worldSceneTypes';
import type { CharacterAnimationController } from './characterAnimation';
import { getCharacterModel, type CharacterModelId } from './modelManifest';
import type { PropModelId } from './propManifest';
import { createActorAnimation, createCharacterActor, createTextSign, findActorModelRoot } from './shared';

type InteriorScene = 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'D1' | 'D6';
type V3 = [number, number, number];
type BoxPart = { p: V3; s: V3; r?: V3; color?: number };

export const FLOOR1_Y = 0;
export const LANDING_Y = 1.9;
export const FLOOR2_Y = 3.8;
const CEILING_H = 3.68;
const SLAB_THICK = 0.12;
const ROOF_Y = FLOOR2_Y + CEILING_H + SLAB_THICK / 2;

const SCENES: readonly InteriorScene[] = ['C2', 'C3', 'C4', 'C5', 'C6', 'D1', 'D6'];
const MODELS: readonly CharacterModelId[] = [
  'linxia',
  'ayuan',
  'volunteer',
  'studentMale2',
  'studentMale3',
  'studentMale4',
  'studentFemale3',
  'studentFemale4',
];
const ORANGE = 0xcd793c;

// 审查第 3 节统一建筑色板（克制米灰上墙 + 蓝灰墙裙 + 暖木地面与收口）
const COL_WALL_UPPER = 0xdad7cc;
const COL_WAINSCOT = 0x849197;
const COL_BASEBOARD = 0x927a5d;
const COL_WOOD_FRAME = 0x625146;
const COL_HARDWARE = 0x454b4f;
const COL_CLASS_DOOR = 0x426c75;
const COL_DESK_WOOD = 0xad8e68;
const COL_DESK_STEEL = 0x384448;
const COL_CHALKBOARD = 0x314943;
const COL_LOCKER_CREAM = 0xc9c2b4;
const COL_LOCKER_TERRA = 0xa97862;
const COL_EXIT_GREEN = 0x285847;
const COL_GUIDE_OCHRE = 0xcba53e;
const COL_STAIR_PAD = 0x527582;

// 1F & 2F 走廊统一柱网 Z 坐标（对齐 1F 分室隔墙 z=0.20，避开全部门洞与公告栏凹间）
export const CORRIDOR_PILLAR_Z = [-6.65, 0.2, 6.65] as const;

export const CORRIDOR_LAYOUT = {
  f1BulletinsZ: [-4.95, 1.3] as const,
  f2BulletinsZ: [1.25, 7.65] as const,
  f1LowLockersZ: [-7.85, 2.82] as const,
  f2LowLockersZ: [-2.65, -1.05, 2.92] as const,
} as const;

/** 脚底导航点、楼层高度与交互锚点分开管理；所有坐标单位为米。 */
export const INTERIOR_LOCATIONS = {
  floors: {
    f1: FLOOR1_Y,
    landing: LANDING_Y,
    f2: FLOOR2_Y,
  },
  spawns: {
    // C2：2F 高一(3)班教室后门内侧，面向教室内与林夏
    C2: { x: -0.1, y: FLOOR2_Y, z: 5, yaw: Math.PI / 2, pitchDeg: -6 },
    // C3：2F 走廊教室外，面向东侧楼梯口，引导玩家走下双跑楼梯前往 1F 辅导员办公室找周老师
    C3: { x: 2.8, y: FLOOR2_Y, z: 5.2, yaw: -Math.PI * 0.32, pitchDeg: -5 },
    // C4：刚从 1F 辅导员办公室出来走到 1F 楼梯厅前，听见楼梯间拐角（1.5F 休息平台）动静
    C4: { x: 3.0, y: FLOOR1_Y, z: 4.8, yaw: -Math.PI * 0.45, pitchDeg: -3 },
    // C5：2F 走廊南段，寻找发布者
    C5: { x: 2.7, y: FLOOR2_Y, z: 6.5, yaw: 0, pitchDeg: -3 },
    // C6：夜晚 2F 走廊，走向双跑楼梯拐角（1.5F 休息平台）看见夜色中的橙色手机壳
    C6: { x: 3.0, y: FLOOR2_Y, z: 3.5, yaw: -Math.PI / 2, pitchDeg: -4 },
    // D1：放学后 2F 侧楼梯口，走近夕阳下的 2F 侧楼梯观景平台遇到阿远
    D1: { x: 6.4, y: FLOOR2_Y, z: 2.0, yaw: Math.PI, pitchDeg: -3 },
    // D6：傍晚 2F 走廊南段，走向北侧窗边找林夏
    D6: { x: 3.0, y: FLOOR2_Y, z: 5.0, yaw: 0, pitchDeg: -3 },
  },
  seats: [
    { id: 'seat-beside', x: -4, y: FLOOR2_Y + 0.48, z: 4.75, approach: { x: -5.3, y: FLOOR2_Y, z: 4.75 } },
    { id: 'seat-front', x: -7, y: FLOOR2_Y + 0.48, z: 1.75, approach: { x: -5.3, y: FLOOR2_Y, z: 1.75 } },
    { id: 'seat-far', x: -4, y: FLOOR2_Y + 0.48, z: -4.25, approach: { x: -2.5, y: FLOOR2_Y, z: -4.25 } },
  ],
  students: [
    // 2F 教室前侧过道（沉默旁观女同学）：四处张望/抱臂/拘谨
    {
      id: 'student-1', modelId: 'studentFemale4' as CharacterModelId,
      x: -1.5, y: FLOOR2_Y, z: -6.2, yaw: 0.32,
      approach: { x: -1.1, y: FLOOR2_Y, z: -4.8 }, lightOffset: { x: 0.14, z: 0.48 },
      clips: ['look_around', 'fold_arms', 'afraid'] as const,
    },
    // 2F 走廊北侧靠墙（理性正派男同学，手抱书本）：接电话/点头/张望
    {
      id: 'student-2', modelId: 'studentMale4' as CharacterModelId,
      x: 4.15, y: FLOOR2_Y, z: -4, yaw: -Math.PI / 2,
      approach: { x: 2.7, y: FLOOR2_Y, z: -4 }, lightOffset: { x: -0.5, z: 0 },
      clips: ['make_a_call_02', 'agree', 'look_around'] as const,
    },
    // 2F 教室后侧过道（冷嘲热讽女同学，背书包）：窃笑/附和/拘谨
    {
      id: 'student-3', modelId: 'studentFemale3' as CharacterModelId,
      x: -1.5, y: FLOOR2_Y, z: 2.6, yaw: 0.18,
      approach: { x: -1.3, y: FLOOR2_Y, z: 4.1 }, lightOffset: { x: 0.07, z: 0.5 },
      clips: ['laugh_01', 'agree', 'afraid'] as const,
    },
    // 2F 侧楼梯观景平台窗边（阿远，橙色手机壳线索）：低头看手机
    {
      id: 'student-4', modelId: 'ayuan' as CharacterModelId,
      x: 8.35, y: FLOOR2_Y, z: 2.8, yaw: -Math.PI / 2,
      approach: { x: 6.9, y: FLOOR2_Y, z: 2.8 }, lightOffset: { x: -0.5, z: 0 },
      clips: [] as const,
    },
    // 2F 走廊中段教室门边（围观看热闹男同学）：起哄/待机/拿手机
    {
      id: 'student-5', modelId: 'studentMale3' as CharacterModelId,
      x: 1.9, y: FLOOR2_Y, z: 0.4, yaw: Math.PI / 2,
      approach: { x: 3.3, y: FLOOR2_Y, z: 0.4 }, lightOffset: { x: 0.5, z: 0 },
      clips: ['cheer', 'wait', 'make_a_call_02'] as const,
    },
    // 2F 侧楼梯平台南侧靠栏杆窗边（发帖起哄/键盘侠男同学）：急躁/嗤笑/待机
    {
      id: 'student-6', modelId: 'studentMale2' as CharacterModelId,
      x: 8.2, y: FLOOR2_Y, z: 6.4, yaw: -Math.PI * 0.72,
      approach: { x: 6.9, y: FLOOR2_Y, z: 5.7 }, lightOffset: { x: -0.44, z: -0.24 },
      clips: ['angry_01', 'laugh_02', 'wait'] as const,
    },
  ],
  linxiaDesk: { x: -7, y: FLOOR2_Y, z: 4.75 },
  // 1.5F 双跑折返楼梯中间休息平台（C4 林夏靠东北窗打电话、C6 夜晚阿远手机微光；不堵上下楼折返通路）
  stairwell: { x: 7.2, y: LANDING_Y, z: -6.5 },
  stairwellActor: { x: 8.85, y: LANDING_Y, z: -7.2 },
  // 2F 侧楼梯夕阳观景平台（D1 遇到阿远）
  platform: { x: 7.0, y: FLOOR2_Y, z: 5.4 },
  platformActor: { x: 8.4, y: FLOOR2_Y, z: 5.4 },
  // 2F 走廊北段（D6 傍晚林夏与阿远）
  corridor: { x: 2.8, y: FLOOR2_Y, z: -4.0 },
  corridorLinxia: { x: 4.15, y: FLOOR2_Y, z: -4.0 },
  corridorAyuan: { x: 4.15, y: FLOOR2_Y, z: -1.2 },
  classroomDoor: { x: 1.0, y: FLOOR2_Y, z: 5.0 },
  stairwellDoor: { x: 5.0, y: FLOOR2_Y, z: 3.4 },
  // 1F 辅导员办公室（C3 走下双跑楼梯并进入 1F 办公室与周老师对话）
  teacherOfficeEntry: { x: 1.0, y: FLOOR1_Y, z: -2.2 },
  teacherOfficeActor: { x: -3.2, y: FLOOR1_Y, z: -4.4 },
  teacherOfficeDoor: { x: -2.1, y: FLOOR1_Y + 1.12, z: -3.55 },
  teacherOfficeApproach: { x: -0.9, y: FLOOR1_Y, z: -2.5 },
} as const;

const DESKS_2F = [-7, -4, -1.45].flatMap((x) => [-5, -2, 1, 4].map((z) => ({ x, z })));
const OFFICE_DESKS_1F = [
  { x: -3.4, z: -5.4, yaw: 0 },
  { x: -6.8, z: -5.4, yaw: 0 },
  { x: -6.8, z: -2.0, yaw: Math.PI / 2 },
] as const;
const STUDY_TABLES_1F = [
  { x: -4.8, z: 3.2 },
  { x: -4.8, z: 6.4 },
] as const;

// 窗外庭院三型香樟树位表（刻意在西窗 z∈[-2.8, +2.6] 与东窗 z∈[-1.8, +4.4] 留出透天与远楼呼吸空窗！）
interface CourtyardTreeSpec {
  variant: 'A' | 'B' | 'C';
  x: number;
  z: number;
  scale: number;
  yaw: number;
}
const COURTYARD_TREES: readonly CourtyardTreeSpec[] = [
  // 西侧庭院（教室与 1F 办公室窗外）
  { variant: 'A', x: -12.1, z: -6.9, scale: 1.26, yaw: 0.38 },
  { variant: 'C', x: -13.7, z: -3.3, scale: 1.32, yaw: -0.65 },
  { variant: 'B', x: -12.3, z: 3.1, scale: 1.28, yaw: 2.45 },
  { variant: 'A', x: -14.1, z: 7.1, scale: 1.18, yaw: 1.72 },
  // 东侧庭院（双跑楼梯平台与 2F 观景台窗外）
  { variant: 'B', x: 12.8, z: -6.6, scale: 1.24, yaw: -0.58 },
  { variant: 'C', x: 14.2, z: -2.3, scale: 1.28, yaw: 0.88 },
  { variant: 'A', x: 13.1, z: 5.9, scale: 1.25, yaw: -2.08 },
];

// 双跑折返楼梯坡度常量
const STAIR_Z_START = 0.4;
const STAIR_Z_END = -4.4;
const STAIR_RUN_LEN = STAIR_Z_START - STAIR_Z_END; // 4.8m
const STAIR_SLOPE = LANDING_Y / STAIR_RUN_LEN;

const FLOOR_SURFACES: readonly GroundSurface[] = [
  { id: 'floor-1f', minX: -9, maxX: 10, minZ: -9, maxZ: 9, height: FLOOR1_Y },
  { id: 'floor-2f-main', minX: -9, maxX: 5.1, minZ: -9, maxZ: 9, height: FLOOR2_Y },
  { id: 'floor-2f-platform', minX: 5.0, maxX: 10, minZ: STAIR_Z_START, maxZ: 9, height: FLOOR2_Y },
  {
    id: 'stair-run-upper',
    minX: 5.1, maxX: 7.4, minZ: STAIR_Z_END, maxZ: STAIR_Z_START,
    height: LANDING_Y, slopeZ: STAIR_SLOPE,
  },
  {
    id: 'stair-landing',
    minX: 5.1, maxX: 9.8, minZ: -8.6, maxZ: STAIR_Z_END,
    height: LANDING_Y,
  },
  {
    id: 'stair-run-lower',
    minX: 7.6, maxX: 9.8, minZ: STAIR_Z_END, maxZ: STAIR_Z_START,
    height: LANDING_Y, slopeZ: -STAIR_SLOPE,
  },
];

const WALK_BOUNDS: readonly RectBounds[] = [
  // 1F 全区域（辅导员办公室 + 1F 阅览室 + 1F 走廊 + 1F 楼梯厅）
  { minX: -8.5, maxX: 9.5, minZ: -8.5, maxZ: 8.5, maxY: 1.55 },
  // 2F 全区域（2F 高一(3)班教室 + 2F 走廊 + 2F 侧楼梯观景平台）
  { minX: -8.5, maxX: 9.5, minZ: -8.5, maxZ: 8.5, minY: 2.25 },
  // 双跑楼梯井全高连通带：保障上下两层在楼梯口衔接处零卡顿
  { minX: 5.15, maxX: 9.5, minZ: -8.5, maxZ: 1.0 },
];

interface WallSegment {
  name: string;
  p: V3;
  s: V3;
  minY?: number;
  maxY?: number;
}

// 2F 隔墙（x=1 教室前门 z=-5、后门 z=5 宽 2.4m；x=5 楼梯井分隔墙 z∈[-9, 0.4]，南端墙柱 z∈[7.2, 9]）
const PARTITIONS_2F: readonly WallSegment[] = [
  { name: 'f2-class-wall-front', p: [1, FLOOR2_Y + 1.9, -7.6], s: [0.22, 3.8, 2.8], minY: FLOOR2_Y, maxY: FLOOR2_Y + 3.8 },
  { name: 'f2-class-wall-middle', p: [1, FLOOR2_Y + 1.9, 0], s: [0.22, 3.8, 7.6], minY: FLOOR2_Y, maxY: FLOOR2_Y + 3.8 },
  { name: 'f2-class-wall-back', p: [1, FLOOR2_Y + 1.9, 7.6], s: [0.22, 3.8, 2.8], minY: FLOOR2_Y, maxY: FLOOR2_Y + 3.8 },
  { name: 'f2-stair-wall-north', p: [5, FLOOR2_Y + 1.9, -4.3], s: [0.22, 3.8, 9.4], minY: FLOOR2_Y, maxY: FLOOR2_Y + 3.8 },
  { name: 'f2-stair-wall-south', p: [5, FLOOR2_Y + 1.9, 8.1], s: [0.22, 3.8, 1.8], minY: FLOOR2_Y, maxY: FLOOR2_Y + 3.8 },
];

// 1F 隔墙（顶高 3.66m 止于 2F 楼板底面，绝不穿透 3.80m 二楼木地面产生共面白线！）
const PARTITIONS_1F: readonly WallSegment[] = [
  { name: 'f1-office-wall-north', p: [1, 1.83, -6.2], s: [0.22, 3.66, 5.6], minY: 0, maxY: 3.66 },
  { name: 'f1-office-wall-mid', p: [1, 1.83, 1.4], s: [0.22, 3.66, 4.8], minY: 0, maxY: 3.66 },
  { name: 'f1-study-wall-south', p: [1, 1.83, 7.6], s: [0.22, 3.66, 2.8], minY: 0, maxY: 3.66 },
  { name: 'f1-west-room-divider', p: [-4.0, 1.83, 0.2], s: [10.0, 3.66, 0.22], minY: 0, maxY: 3.66 },
  { name: 'f1-stair-wall-north', p: [5, 1.83, -4.3], s: [0.22, 3.66, 9.4], minY: 0, maxY: 3.66 },
  { name: 'f1-stair-wall-south', p: [5, 1.83, 8.1], s: [0.22, 3.66, 1.8], minY: 0, maxY: 3.66 },
];

function obstacle(
  id: string, x: number, z: number, w: number, d: number,
  height = 1.8, minY?: number, maxY?: number,
): ObstacleAabb {
  return {
    id,
    minX: x - w / 2,
    maxX: x + w / 2,
    minZ: z - d / 2,
    maxZ: z + d / 2,
    height,
    ...(minY !== undefined ? { minY } : {}),
    ...(maxY !== undefined ? { maxY } : {}),
  };
}

function navigation(scene: InteriorScene): WorldSceneDefinition['nav'] {
  const people: Array<{ x: number; y: number; z: number }> =
    scene === 'C5' ? [...INTERIOR_LOCATIONS.students]
      : scene === 'C3' ? [INTERIOR_LOCATIONS.teacherOfficeActor]
        : scene === 'C4' || scene === 'C6' ? [INTERIOR_LOCATIONS.stairwellActor]
          : scene === 'D1' ? [INTERIOR_LOCATIONS.platformActor]
            : scene === 'D6' ? [INTERIOR_LOCATIONS.corridorLinxia, INTERIOR_LOCATIONS.corridorAyuan]
              : [];

  return {
    groundY: FLOOR1_Y,
    surfaces: FLOOR_SURFACES.map((surface) => ({ ...surface })),
    bounds: WALK_BOUNDS.map((rect) => ({ ...rect })),
    obstacles: [
      // 分层隔墙
      ...PARTITIONS_2F.map(({ name, p, s, minY, maxY }) => obstacle(name, p[0], p[2], s[0], s[2], s[1], minY, maxY)),
      ...PARTITIONS_1F.map(({ name, p, s, minY, maxY }) => obstacle(name, p[0], p[2], s[0], s[2], s[1], minY, maxY)),
      // 双跑楼梯中隔实心护墙
      obstacle('stair-center-divider', 7.5, -2.0, 0.24, STAIR_RUN_LEN, 4.2, 0.2, FLOOR2_Y + 1.2),
      // 2F 东侧楼梯井边缘安全护栏
      obstacle('f2-stairwell-guard', 8.7, STAIR_Z_START, 2.6, 0.22, 1.2, FLOOR2_Y - 0.1, FLOOR2_Y + 1.5),
      // 1F 上段梯段 A 下方封堵与休息平台下方死区封堵
      obstacle('f1-under-upper-flight', 6.25, -2.0, 2.5, STAIR_RUN_LEN, 2.0, 0, 1.55),
      obstacle('f1-under-landing', 7.5, -6.6, 4.8, 4.4, 1.8, 0, 1.55),
      // 1F 玄关鞋柜与两层走廊储物矮柜/高柜碰撞盒（防穿柜）
      obstacle('f1-shoe-lockers', 9.38, 7.2, 0.65, 2.4, 1.3, 0, 1.4),
      ...CORRIDOR_LAYOUT.f1LowLockersZ.map((lz, i) => obstacle(`f1-low-locker-${i}`, 1.32, lz, 0.4, 1.38, 0.92, 0, 1.1)),
      ...CORRIDOR_LAYOUT.f2LowLockersZ.map((lz, i) => obstacle(`f2-low-locker-${i}`, 1.32, lz, 0.4, 1.38, 0.92, FLOOR2_Y, FLOOR2_Y + 1.1)),
      obstacle('f1-tall-locker', 4.65, -7.25, 0.46, 0.95, 1.94, 0, 2.0),
      obstacle('f2-tall-locker', 4.65, -7.25, 0.46, 0.95, 1.94, FLOOR2_Y, FLOOR2_Y + 2.0),
      // 2F 教室课桌椅、讲台与后排书包柜
      ...DESKS_2F.map(({ x, z }, i) => obstacle(`desk-${i}`, x, z + 0.35, 1.45, 1.5, 1.0, FLOOR2_Y, FLOOR2_Y + 1.2)),
      obstacle('podium', -4.5, -7.7, 3.0, 1.1, 1.15, FLOOR2_Y, FLOOR2_Y + 1.3),
      obstacle('class-rear-cubby', -4.6, 8.62, 5.4, 0.48, 1.05, FLOOR2_Y, FLOOR2_Y + 1.2),
      obstacle('class-door-low-cabinet', 0.65, 7.98, 0.48, 1.28, 0.96, FLOOR2_Y, FLOOR2_Y + 1.15),
      // 1F 辅导员办公室办公桌与档案柜
      ...OFFICE_DESKS_1F.map(({ x, z, yaw }, i) => obstacle(
        `office-desk-${i}`, x, z, yaw === 0 ? 1.66 : 0.86, yaw === 0 ? 0.86 : 1.66, 0.9, 0, 1.1,
      )),
      obstacle('office-file-cabinets', -4.5, -8.55, 5.0, 0.55, 1.95, 0, 2.1),
      // 1F 阅览室长桌与靠墙书架
      ...STUDY_TABLES_1F.map(({ x, z }, i) => obstacle(`study-table-${i}`, x, z, 2.8, 1.25, 0.9, 0, 1.1)),
      obstacle('study-bookshelf', -4.6, 8.6, 5.2, 0.48, 2.1, 0, 2.2),
      // 当场可见角色占位
      ...people.map(({ x, y, z }, i) => obstacle(`person-${i}`, x, z, 0.8, 0.8, 1.7, y, y + 1.75)),
    ],
  };
}

function group(parent: THREE.Object3D, name: string): THREE.Group {
  const result = new THREE.Group();
  result.name = name;
  parent.add(result);
  return result;
}

function isBrowserRuntime(): boolean {
  return typeof window !== 'undefined'
    && typeof document !== 'undefined'
    && typeof document.baseURI === 'string'
    && /^https?:/i.test(document.baseURI);
}

/** 仅本次 build 内共享；所有贴图、材质与实例缓冲都在本 build 释放时完整清理，不污染全局缓存。 */
function details() {
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  const palette = new Map<string, THREE.MeshStandardMaterial>();
  function material(color: number, roughness = 0.78, metalness = 0, envMapIntensity = 0.36): THREE.MeshStandardMaterial {
    const key = `${color}:${roughness}:${metalness}:${envMapIntensity}`;
    let m = palette.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity });
      palette.set(key, m);
    }
    return m;
  }
  function box(parent: THREE.Object3D, name: string, p: V3, s: V3, m: THREE.Material | number, r?: V3): THREE.Mesh {
    const mesh = new THREE.Mesh(cube, typeof m === 'number' ? material(m) : m);
    mesh.name = name;
    mesh.position.set(...p);
    mesh.scale.set(...s);
    if (r) mesh.rotation.set(...r);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function batch(
    parent: THREE.Object3D,
    name: string,
    parts: BoxPart[],
    m: THREE.Material | number,
    geometry: THREE.BufferGeometry = cube,
  ): THREE.InstancedMesh {
    const mat = typeof m === 'number' ? material(m) : m;
    const mesh = new THREE.InstancedMesh(geometry, mat, Math.max(1, parts.length));
    mesh.name = name;
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    let hasColor = false;
    parts.forEach(({ p, s, r, color: hex }, i) => {
      transform.position.set(...p);
      transform.rotation.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0);
      transform.scale.set(...s);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
      if (hex !== undefined) {
        hasColor = true;
        mesh.setColorAt(i, color.setHex(hex));
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (hasColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    const release = (): void => { mesh.dispose(); geometry.removeEventListener('dispose', release); };
    geometry.addEventListener('dispose', release);
    parent.add(mesh);
    return mesh;
  }
  return { box, batch, material, cube, cyl };
}
type Details = ReturnType<typeof details>;

function sign(
  parent: THREE.Object3D,
  text: string,
  p: V3,
  yaw = 0,
  width = 1.4,
  height = 0.34,
  palette: { background: string; foreground: string } = { background: '#efe8d8', foreground: '#3d352e' },
): THREE.Mesh {
  const mesh = createTextSign(text, width, height, palette);
  mesh.name = `sign-${text}`;
  mesh.position.set(...p);
  mesh.rotation.y = yaw;
  mesh.castShadow = false;
  const mat = mesh.material as THREE.Material;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -1;
  mat.polygonOffsetUnits = -1;
  mesh.renderOrder = 1;
  parent.add(mesh);
  return mesh;
}

/**
 * 审查第 3 节走廊/教室暖木条形地板（#9E7E5D，roughness 0.60）：
 * 纹理严格顺板长（Z 向）铺设、错缝收口，仅保留细腻板缝与轻柔木纹，彻底杜绝镜面地板高光冲白（P0-02）。
 */
function plankFloorMaterial(repeatX = 9, repeatY = 5.5): THREE.MeshStandardMaterial {
  const size = 256;
  const pixels = new Uint8Array(size * size * 4);
  const planksAcross = 8;
  const plankWidthPx = size / planksAcross; // 32px 一块条木板
  const hash = (a: number, b: number): number => {
    let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const col = Math.floor(x / plankWidthPx);
      const lx = x % plankWidthPx;
      // 相邻木板沿纵向（y）错开半板端头接缝
      const buttOffset = (col * 91) % size;
      const ly = (y + buttOffset) % size;
      const seg = ly < 128 ? 0 : 1;
      const inButt = ly === 0 || ly === 128;
      const inLongSeam = lx === 0;
      const boardSeed = hash(col * 19 + 3, seg * 37 + 11);
      const grainWave = Math.sin(lx * 0.52 + Math.sin(y * 0.085 + boardSeed * 9.0) * 1.65) * 0.5 + 0.5;
      const fine = hash(x + col * 13, Math.floor(y / 3));
      const tone = inLongSeam ? 0.62
        : inButt ? 0.68
          : 0.90 + (boardSeed - 0.5) * 0.12 + grainWave * 0.06 + (fine - 0.5) * 0.03;
      const r = Math.min(255, Math.round(158 * tone));
      const g = Math.min(255, Math.round(126 * tone));
      const b = Math.min(255, Math.round(93 * tone));
      pixels.set([r, g, b, 255], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.7,
    metalness: 0,
    envMapIntensity: 0.12,
  });
  const release = (): void => { texture.dispose(); material.removeEventListener('dispose', release); };
  material.addEventListener('dispose', release);
  return material;
}

/** 审查第 3 节米灰乳胶漆上墙（#DAD7CC，低对比细颗粒，roughness 0.85）。 */
function wallMaterial(): THREE.MeshStandardMaterial {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  const baseR = (COL_WALL_UPPER >> 16) & 0xff;
  const baseG = (COL_WALL_UPPER >> 8) & 0xff;
  const baseB = COL_WALL_UPPER & 0xff;
  let seed = 991;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const n = seed % 100;
    const shade = n < 8 ? -4 : n < 22 ? -2 : n < 42 ? 2 : (n % 3) - 1;
    pixels.set([baseR + shade, baseG + shade, baseB + shade, 255], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 3);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, envMapIntensity: 0.3 });
  const release = (): void => { texture.dispose(); material.removeEventListener('dispose', release); };
  material.addEventListener('dispose', release);
  return material;
}

/** 柔和米灰矿棉吸音板吊顶（收紧网格反差与纹理尺度）。 */
function ceilingTileMaterial(): THREE.MeshStandardMaterial {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const gx = x % 32;
    const gy = y % 32;
    const seam = gx === 0 || gy === 0;
    const dot = !seam && (gx % 8 === 4) && (gy % 8 === 4);
    const base = seam ? 192 : dot ? 208 : 221;
    pixels.set([base, base - 2, base - 8, 255], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(11, 11);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.88, metalness: 0.01, envMapIntensity: 0.28 });
  const release = (): void => { texture.dispose(); material.removeEventListener('dispose', release); };
  material.addEventListener('dispose', release);
  return material;
}

interface FoliagePart { p: V3; s: V3; color: number }
/** 窗外程序化兜底绿植（异步三型香樟树 GLB 到位前提供层次与风摆）。 */
function instancedFoliage(
  parent: THREE.Object3D,
  name: string,
  parts: FoliagePart[],
  windTime: { value: number },
): THREE.InstancedMesh {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0, envMapIntensity: 0.34 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windTime;
    shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float swayPhase = instanceMatrix[3][0] * 0.63 + instanceMatrix[3][2] * 0.79 + instanceMatrix[3][1] * 0.41;
      #else
        float swayPhase = 0.0;
      #endif
      float swayAmp = clamp((position.y + 1.0) * 0.5, 0.0, 1.0) * 0.055;
      transformed.x += sin(uTime * 1.32 + swayPhase) * swayAmp;
      transformed.z += cos(uTime * 1.04 + swayPhase * 1.18) * swayAmp * 0.7;`,
    );
  };
  material.customProgramCacheKey = () => 'school-interior-foliage-fallback-v2';
  const mesh = new THREE.InstancedMesh(geometry, material, parts.length);
  mesh.name = name;
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  parts.forEach((part, i) => {
    transform.position.set(...part.p);
    transform.scale.set(...part.s);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
    mesh.setColorAt(i, color.setHex(part.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  const release = (): void => { mesh.dispose(); geometry.removeEventListener('dispose', release); };
  geometry.addEventListener('dispose', release);
  parent.add(mesh);
  return mesh;
}

type BeamQuad = [V3, V3, V3, V3];
/**
 * 窗格柔边光带网格（P0-02 修复）：
 * 支持 4 分量 RGBA 顶点色与 NormalBlending，使地面窗光温柔染色而不把木板纹理冲成 255 纯白斑！
 */
function createWindowLightMesh(
  name: string,
  quads: BeamQuad[],
  baseColor: number,
  opacity: number,
  blending: THREE.Blending,
  renderOrder = 1,
): THREE.Mesh {
  const columns = 4;
  const rows = 6;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const base = new THREE.Color(baseColor);
  for (const [nl, nr, fl, fr] of quads) {
    const offset = positions.length / 3;
    for (let row = 0; row <= rows; row += 1) {
      const v = row / rows;
      for (let col = 0; col <= columns; col += 1) {
        const u = col / columns;
        const nearX = nl[0] + (nr[0] - nl[0]) * u;
        const nearY = nl[1] + (nr[1] - nl[1]) * u;
        const nearZ = nl[2] + (nr[2] - nl[2]) * u;
        const farX = fl[0] + (fr[0] - fl[0]) * u;
        const farY = fl[1] + (fr[1] - fl[1]) * u;
        const farZ = fl[2] + (fr[2] - fl[2]) * u;
        positions.push(nearX + (farX - nearX) * v, nearY + (farY - nearY) * v, nearZ + (farZ - nearZ) * v);
        // 靠窗侧略清朗、向室内自然衰减，两侧与窗梃对齐柔化
        const edgeU = Math.sin(Math.PI * u) ** 0.75;
        const edgeV = Math.sin(Math.PI * v) * (1 - v * 0.35);
        const weight = Math.max(0, Math.min(1, edgeU * edgeV));
        if (blending === THREE.AdditiveBlending) {
          colors.push(base.r * weight, base.g * weight, base.b * weight, 1);
        } else {
          colors.push(base.r, base.g, base.b, weight);
        }
      }
    }
    for (let row = 0; row < rows; row += 1) for (let col = 0; col < columns; col += 1) {
      const a = offset + row * (columns + 1) + col;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    blending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.renderOrder = renderOrder;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  return mesh;
}

/** 有金属外框、低自发光墨绿底板与白色箭头/人形标识的安全出口牌（P1-05：只让图形略亮于底板，告别刺眼纯绿块）。 */
function buildExitSignUnit(
  parent: THREE.Object3D,
  d: Details,
  name: string,
  p: V3,
  yaw: number,
  width: number,
  height: number,
  housingMat: THREE.Material,
  greenBackMat: THREE.Material,
  glyphMat: THREE.Material,
  hanging = false,
): void {
  const unit = group(parent, `${name}-group`);
  unit.position.set(...p);
  unit.rotation.y = yaw;
  // 深灰铝壳底座 + 正面墨绿面板
  const core = d.box(unit, name, [0, 0, 0], [width, height, 0.044], housingMat);
  core.castShadow = false;
  if (hanging) {
    for (const sx of [-width * 0.34, width * 0.34]) {
      d.box(unit, `${name}-rod`, [sx, height * 0.5 + 0.16, 0], [0.018, 0.32, 0.018], housingMat);
    }
  }
  const faces = hanging ? [-1, 1] : [1];
  for (const side of faces) {
    const fz = side * 0.024;
    const gz = side * 0.028;
    d.box(unit, `${name}-face`, [0, 0, fz], [width - 0.03, height - 0.03, 0.004], greenBackMat);
    // 白色细内框
    d.box(unit, `${name}-rim-t`, [0, (height - 0.05) * 0.5, gz], [width - 0.05, 0.012, 0.004], glyphMat);
    d.box(unit, `${name}-rim-b`, [0, -(height - 0.05) * 0.5, gz], [width - 0.05, 0.012, 0.004], glyphMat);
    // 方向箭头 + 奔跑人形简影
    const dir = side;
    d.box(unit, `${name}-arrow-bar`, [-width * 0.14 * dir, 0, gz], [width * 0.24, 0.022, 0.005], glyphMat);
    d.box(unit, `${name}-arrow-up`, [-width * 0.23 * dir, 0.028, gz], [0.065, 0.018, 0.005], glyphMat, [0, 0, -0.65 * dir]);
    d.box(unit, `${name}-arrow-dn`, [-width * 0.23 * dir, -0.028, gz], [0.065, 0.018, 0.005], glyphMat, [0, 0, 0.65 * dir]);
    d.box(unit, `${name}-door-icon`, [width * 0.22 * dir, -0.005, gz], [width * 0.14, height * 0.56, 0.004], glyphMat);
    d.box(unit, `${name}-runner`, [width * 0.06 * dir, -0.01, gz], [0.028, height * 0.42, 0.005], glyphMat, [0, 0, 0.24 * dir]);
  }
}

/** 楼梯口双面导视单元：顶部 3D 浮雕楼层数字 + 下方安全错开距离 ≥ 16cm 的绿底指引条，彻底消除 1F/2F 重叠 */
function createFloorSign(
  walls: THREE.Object3D,
  root: THREE.Object3D,
  d: Details,
  floorNum: 1 | 2,
  floorY: number,
  numeralMat: THREE.Material,
): void {
  const guideText = floorNum === 2 ? '2F 高一年级 · 楼梯口' : '1F 辅导员室 · 阅览室';
  build3DFloorNumeral(walls, d, floorNum, [5.132, floorY + 2.66, -0.35], Math.PI / 2, numeralMat);
  build3DFloorNumeral(walls, d, floorNum, [4.868, floorY + 2.66, -0.35], -Math.PI / 2, numeralMat);
  sign(walls, guideText, [4.868, floorY + 2.15, -0.35], -Math.PI / 2, 1.05, 0.24, {
    background: '#315447',
    foreground: '#f7f1de',
  });
  sign(root, `${floorNum}F`, [5.134, floorY + 1.56, 0.12], Math.PI / 2, 0.44, 0.24, {
    background: '#dad7cc',
    foreground: '#7a5624',
  });
}
function build3DFloorNumeral(
  parent: THREE.Object3D,
  d: Details,
  floorNum: 1 | 2,
  p: V3,
  yaw: number,
  mat: THREE.Material,
): void {
  const holder = group(parent, `floor-3d-${floorNum}F`);
  holder.position.set(...p);
  holder.rotation.y = yaw;
  const thick = 0.026;
  if (floorNum === 1) {
    d.box(holder, 'num-1-stem', [-0.20, 0.02, 0], [0.072, 0.52, thick], mat);
    d.box(holder, 'num-1-beak', [-0.26, 0.21, 0], [0.09, 0.058, thick], mat, [0, 0, 0.52]);
    d.box(holder, 'num-1-base', [-0.20, -0.22, 0], [0.19, 0.056, thick], mat);
  } else {
    d.box(holder, 'num-2-top', [-0.22, 0.25, 0], [0.25, 0.062, thick], mat);
    d.box(holder, 'num-2-r', [-0.125, 0.145, 0], [0.062, 0.21, thick], mat);
    d.box(holder, 'num-2-mid', [-0.22, 0.03, 0], [0.25, 0.06, thick], mat);
    d.box(holder, 'num-2-l', [-0.315, -0.095, 0], [0.062, 0.21, thick], mat);
    d.box(holder, 'num-2-bot', [-0.22, -0.22, 0], [0.25, 0.062, thick], mat);
  }
  // 右下侧 65% 字高立体 F 字母（与数字拉开清晰字距）
  d.box(holder, 'char-f-stem', [0.08, -0.05, 0], [0.06, 0.36, thick], mat);
  d.box(holder, 'char-f-top', [0.165, 0.10, 0], [0.21, 0.054, thick], mat);
  d.box(holder, 'char-f-mid', [0.15, -0.04, 0], [0.17, 0.048, thick], mat);
  d.box(holder, 'floor-rule', [-0.03, -0.33, 0], [0.6, 0.02, thick * 0.7], mat);
}

/** 构建带立体门套、门槛收口、滑轨、门扇分框与磨砂视窗的标准教室/办公室门（P0-02 & P1-05）。 */
function buildRoomDoorway(
  walls: THREE.Object3D,
  root: THREE.Object3D,
  d: Details,
  floorY: number,
  z: number,
  leafParkOffsetZ: number,
  title: string,
  plate: string,
  plaster: THREE.Material,
  frosted: THREE.Material,
  woodFrame: THREE.Material,
  doorMat: THREE.Material,
  hardwareMat: THREE.Material,
  thresholdMat: THREE.Material,
): void {
  // 门洞上墙与两格高气窗（木窗框不透明，气窗嵌入框内）
  d.box(walls, 'class-door-lintel', [1, floorY + 3.45, z], [0.22, 0.7, 2.4], plaster);
  d.box(walls, 'class-door-transom-frame-top', [1, floorY + 3.1, z], [0.25, 0.06, 2.44], woodFrame);
  d.box(walls, 'class-door-transom-frame-bot', [1, floorY + 2.52, z], [0.25, 0.06, 2.44], woodFrame);
  d.box(walls, 'class-door-transom-mid', [1, floorY + 2.81, z], [0.24, 0.54, 0.06], woodFrame);
  for (const tz of [-0.58, 0.58]) {
    d.box(walls, 'class-door-transom', [1, floorY + 2.81, z + tz], [0.03, 0.5, 1.1], frosted);
  }
  // 两侧厚实倒角感双阶门套立梃 + 地面实木门槛压条（P0-02 清晰标定门洞边界）
  for (const jz of [-1.21, 1.21]) {
    d.box(walls, 'class-door-jamb', [1, floorY + 1.56, z + jz], [0.27, 3.12, 0.08], woodFrame);
  }
  d.box(walls, 'class-door-threshold', [1, floorY + 0.002, z], [0.24, 0.004, 2.34], thresholdMat);

  // 敞开停靠于室内墙侧的推拉门扇：滑轨罩 + 四周门梃 + 下裙芯板 + 上磨砂视窗 + 金属竖拉手与锁片
  const leafZ = z + leafParkOffsetZ;
  d.box(walls, 'class-door-track', [0.84, floorY + 2.5, z + leafParkOffsetZ * 0.5], [0.06, 0.055, 2.35], hardwareMat);
  // 门扇上下横档与左右立梃（消除大色块感）
  d.box(walls, 'open-class-door', [0.84, floorY + 0.62, leafZ], [0.048, 1.22, 0.94], doorMat);
  d.box(walls, 'open-class-door-kick', [0.84, floorY + 0.14, leafZ], [0.054, 0.24, 0.94], hardwareMat);
  d.box(walls, 'open-class-door-top-rail', [0.84, floorY + 2.38, leafZ], [0.052, 0.18, 0.94], doorMat);
  d.box(walls, 'open-class-door-mid-rail', [0.84, floorY + 1.24, leafZ], [0.054, 0.11, 0.94], doorMat);
  for (const sz of [-0.41, 0.41]) {
    d.box(walls, 'open-class-door-stile', [0.84, floorY + 1.82, leafZ + sz], [0.052, 1.08, 0.12], doorMat);
  }
  d.box(walls, 'open-class-door-window', [0.84, floorY + 1.82, leafZ], [0.024, 1.02, 0.7], frosted);
  const handleZ = leafZ - Math.sign(leafParkOffsetZ) * 0.36;
  d.box(walls, 'class-door-escutcheon', [0.87, floorY + 1.12, handleZ], [0.016, 0.28, 0.048], hardwareMat);
  d.box(walls, 'class-door-handle', [0.892, floorY + 1.12, handleZ], [0.026, 0.2, 0.024], 0xcfd5d9);

  // 统一制式门楣牌与垂直挑出木框双面室牌
  const signZ = z - Math.sign(leafParkOffsetZ || 1) * 1.28;
  sign(root, title, [1.145, floorY + 3.36, z], Math.PI / 2, 1.42, 0.3, { background: '#edeae0', foreground: '#2c3a40' });
  d.box(walls, 'door-hanging-bracket', [1.33, floorY + 2.46, signZ], [0.44, 0.22, 0.04], woodFrame);
  sign(root, plate, [1.33, floorY + 2.46, signZ + 0.024], 0, 0.4, 0.18, { background: '#f2ead9', foreground: '#3b2e22' });
  sign(root, plate, [1.33, floorY + 2.46, signZ - 0.024], Math.PI, 0.4, 0.18, { background: '#f2ead9', foreground: '#3b2e22' });
}

/**
 * 1F / 2F 走廊标准墙跨道具（P0-01 彻底修复）：
 * 立柱固定在 CORRIDOR_PILLAR_Z = [-6.65, 0.2, 6.65]，公告栏与矮柜严格落在各自完整墙跨凹间中央，
 * 离立柱边与门套边均留出 ≥140mm～900mm 净空，绝无木框被柱截断或门扇碰撞。
 */
function buildCorridorProps(
  walls: THREE.Object3D,
  d: Details,
  floorY: number,
  prefix: string,
  plaster: THREE.Material,
  wainscot: THREE.Material,
  baseboard: THREE.Material,
  woodFrame: THREE.Material,
  hardwareMat: THREE.Material,
  exitGreenMat: THREE.Material,
  exitGlyphMat: THREE.Material,
): void {
  const isF2 = floorY > 1;
  const bulletinsZ = isF2 ? CORRIDOR_LAYOUT.f2BulletinsZ : CORRIDOR_LAYOUT.f1BulletinsZ;
  const lockersZ = isF2 ? CORRIDOR_LAYOUT.f2LowLockersZ : CORRIDOR_LAYOUT.f1LowLockersZ;

  // 走廊东侧克制暖黄导引带（哑光避免斜视角反光闪烁）
  d.box(walls, `${prefix}-yellow-guide`, [4.58, floorY + 0.004, -0.4], [0.09, 0.008, 16.2],
    d.material(COL_GUIDE_OCHRE, 0.82, 0, 0.16));

  // 走廊北端双开木框防火门（z = -8.84，居中 x = 3.0，带防撞腰带与把手）
  const fireDoorParts: BoxPart[] = [
    { p: [1.75, floorY + 1.5, -8.84], s: [0.11, 3.0, 0.14] },
    { p: [4.25, floorY + 1.5, -8.84], s: [0.11, 3.0, 0.14] },
    { p: [3.0, floorY + 2.95, -8.84], s: [2.61, 0.11, 0.14] },
    { p: [3.0, floorY + 1.45, -8.84], s: [0.08, 2.9, 0.1] },
    { p: [3.0, floorY + 1.05, -8.83], s: [2.42, 0.14, 0.09] },
    { p: [3.0, floorY + 0.14, -8.83], s: [2.42, 0.24, 0.09] },
  ];
  d.batch(walls, `${prefix}-fire-door-wood`, fireDoorParts, woodFrame);

  // 走廊承重矩形立柱（宽 0.32m，突出墙面 11cm，墙裙与踢脚随柱转角完整包回）+ 贴梁顶横梁
  for (const pz of CORRIDOR_PILLAR_Z) {
    d.box(walls, `${prefix}-pillar-w`, [1.14, floorY + 1.84, pz], [0.16, 3.68, 0.32], plaster);
    d.box(walls, `${prefix}-pillar-w-wainscot`, [1.15, floorY + 0.575, pz], [0.18, 1.15, 0.34], wainscot);
    d.box(walls, `${prefix}-pillar-w-cap`, [1.155, floorY + 1.16, pz], [0.19, 0.03, 0.35], woodFrame);
    d.box(walls, `${prefix}-pillar-w-base`, [1.158, floorY + 0.06, pz], [0.2, 0.12, 0.36], baseboard);
    // 横梁起止严格限定在教室与走廊区域（x∈[-9, 5]），在 x=5.0 楼梯间隔墙处收口，绝不横穿挑空楼梯井
    d.box(walls, `${prefix}-beam`, [-2.0, floorY + 3.55, pz], [14.0, 0.24, 0.28], plaster);
  }

  // 程序化兜底公告栏（Blender 套件到位后整组隐藏，坐标与套件 1:1 对齐：宽 1.28m，离墙 4mm 装配缝）
  const fallbackBoards = group(walls, `${prefix}-bulletin-fallback`);
  const boardWood: BoxPart[] = [];
  const boardPapers: BoxPart[] = [];
  for (const bz of bulletinsZ) {
    boardWood.push(
      { p: [1.142, floorY + 1.344, bz], s: [0.046, 0.048, 1.28] },
      { p: [1.142, floorY + 2.336, bz], s: [0.046, 0.048, 1.28] },
      { p: [1.142, floorY + 1.84, bz - 0.616], s: [0.046, 0.94, 0.048] },
      { p: [1.142, floorY + 1.84, bz + 0.616], s: [0.046, 0.94, 0.048] },
    );
    d.box(fallbackBoards, `${prefix}-board-${bz}`, [1.132, floorY + 1.84, bz], [0.022, 0.95, 1.2], COL_EXIT_GREEN);
    boardPapers.push(
      { p: [1.148, floorY + 1.98, bz - 0.32], s: [0.006, 0.3, 0.38], color: 0xefead8 },
      { p: [1.149, floorY + 1.95, bz + 0.06], s: [0.006, 0.35, 0.25], color: 0xe8d6c8 },
      { p: [1.148, floorY + 1.97, bz + 0.38], s: [0.006, 0.31, 0.27], color: 0xd7e2e8 },
      { p: [1.148, floorY + 1.62, bz - 0.22], s: [0.006, 0.19, 0.26], color: 0xefead8 },
    );
  }
  d.batch(fallbackBoards, `${prefix}-board-frames`, boardWood, woodFrame);
  d.batch(fallbackBoards, `${prefix}-board-papers`, boardPapers, d.material(0xffffff, 0.82));

  // 程序化兜底八门百叶矮柜 + 书包（克制灰暖白 #C9C2B4 + 局部陶土 #A97862，Blender 套件到位后整组隐藏）
  const fallbackLockers = group(walls, `${prefix}-locker-fallback`);
  const lockerBodies: BoxPart[] = [];
  const lockerDoors: BoxPart[] = [];
  const lockerLocks: BoxPart[] = [];
  for (const lz of lockersZ) {
    lockerBodies.push(
      { p: [1.325, floorY + 0.03, lz], s: [0.35, 0.06, 1.36], color: 0x7b7870 },
      { p: [1.325, floorY + 0.48, lz], s: [0.36, 0.84, 1.38], color: COL_LOCKER_CREAM },
    );
    for (let r = 0; r < 2; r += 1) {
      const dy = 0.288 + r * 0.384;
      for (let c = 0; c < 4; c += 1) {
        const dz = -0.486 + c * 0.324;
        const isTerra = (r + c) % 2 === 1;
        lockerDoors.push({
          p: [1.51, floorY + dy, lz + dz],
          s: [0.018, 0.368, 0.312],
          color: isTerra ? COL_LOCKER_TERRA : COL_LOCKER_CREAM,
        });
        lockerLocks.push({ p: [1.522, floorY + dy, lz + dz + 0.1], s: [0.01, 0.06, 0.026] });
      }
    }
  }
  // 柜顶书包兜底
  for (const bagZ of [lockersZ[0] - 0.22, lockersZ[lockersZ.length - 1] - 0.18]) {
    d.box(fallbackLockers, `${prefix}-locker-bag-${bagZ}`, [1.33, floorY + 1.04, bagZ], [0.22, 0.28, 0.36], 0x2b4363);
  }
  d.batch(fallbackLockers, `${prefix}-locker-bodies`, lockerBodies, d.material(0xffffff, 0.68));
  d.batch(fallbackLockers, `${prefix}-locker-doors`, lockerDoors, d.material(0xffffff, 0.62));
  d.batch(fallbackLockers, `${prefix}-locker-locks`, lockerLocks, hardwareMat);

  // 靠东墙北端高柜兜底 + 分类垃圾桶
  const tallFallback = d.box(walls, `${prefix}-tall-locker-fallback`, [4.65, floorY + 0.96, -7.25], [0.43, 1.92, 0.92],
    d.material(0x5c7585, 0.52, 0.22));
  tallFallback.castShadow = false;
  const binBodies: BoxPart[] = [];
  const binRims: BoxPart[] = [];
  for (const gz of [0, -0.38]) {
    binBodies.push({ p: [4.7, floorY + 0.28, -5.5 + gz], s: [0.32, 0.56, 0.32] });
    binRims.push({ p: [4.7, floorY + 0.57, -5.5 + gz], s: [0.34, 0.04, 0.34] });
  }
  d.batch(walls, `${prefix}-trash-bodies`, binBodies, d.material(0xd2d0c8, 0.7));
  d.batch(walls, `${prefix}-trash-rims`, binRims, hardwareMat);

  // 壁挂广播音箱兜底（Blender 圆网罩音箱到位后隐藏）
  const spkFallback = group(walls, `${prefix}-speaker-fallback`);
  const spkZ = isF2 ? [-3.35, 3.35] : [-6.15, 3.35];
  for (const sz of spkZ) {
    d.box(spkFallback, `${prefix}-spk-${sz}`, [1.18, floorY + 2.96, sz], [0.14, 0.31, 0.23], hardwareMat);
  }

  // 带白边与箭头人形的导视出口牌（低位实贴东侧楼梯隔墙 z=-0.35 绝不悬挑出墙角 + 走廊悬吊式）
  buildExitSignUnit(walls, d, `${prefix}-exit-low`, [4.865, floorY + 0.3, -0.35], -Math.PI / 2,
    0.42, 0.18, hardwareMat, exitGreenMat, exitGlyphMat, false);
  buildExitSignUnit(walls, d, `${prefix}-exit-hang`, [3.0, floorY + 3.22, 0.65], 0,
    0.58, 0.2, hardwareMat, exitGreenMat, exitGlyphMat, true);

  // 走廊吸顶式双管灯架（贴顶安装，与横梁错开不打架）
  const lampHoods: BoxPart[] = [];
  const lampTubes: BoxPart[] = [];
  for (const lz of [-4.6, -1.6, 2.2, 5.0]) {
    lampHoods.push({ p: [3.0, floorY + 3.63, lz], s: [0.28, 0.06, 1.32] });
    lampTubes.push({ p: [3.0, floorY + 3.59, lz], s: [0.18, 0.025, 1.22] });
  }
  d.batch(walls, `${prefix}-lamp-hoods`, lampHoods, hardwareMat);
  d.batch(walls, `${prefix}-lamp-tubes`, lampTubes, d.material(0xf2efe6, 0.42));

  // ==================== 走廊精细功能与文化陈设（报告第 5-8 项） ====================
  // 1. 走廊直饮水机（靠东墙实墙段 x=4.72, z=-2.25，白色机身+接水凹槽+热冷指示+纸杯架）
  d.box(walls, `${prefix}-fountain-body`, [4.72, floorY + 0.52, -2.25], [0.34, 1.04, 0.52], d.material(0xe6ecee, 0.46));
  d.box(walls, `${prefix}-fountain-basin`, [4.62, floorY + 0.78, -2.25], [0.22, 0.08, 0.44], d.material(0x88969e, 0.32, 0.45));
  d.box(walls, `${prefix}-fountain-tap-hot`, [4.6, floorY + 0.94, -2.14], [0.05, 0.06, 0.04], d.material(0xd64838, 0.4));
  d.box(walls, `${prefix}-fountain-tap-cold`, [4.6, floorY + 0.94, -2.36], [0.05, 0.06, 0.04], d.material(0x2f7dc4, 0.4));
  d.box(walls, `${prefix}-fountain-cups`, [4.68, floorY + 0.88, -1.94], [0.1, 0.22, 0.1], d.material(0xf4f2ea, 0.65));
  sign(walls, '直饮水 · 谨防烫伤', [4.88, floorY + 1.24, -2.25], -Math.PI / 2, 0.56, 0.16, {
    background: '#e6f2fa',
    foreground: '#1f5382',
  });

  // 2. 走廊消防器材红箱 + 紧急疏散示意图（东墙 x=4.84, z=-1.05）
  d.box(walls, `${prefix}-firebox-body`, [4.84, floorY + 0.68, -1.05], [0.12, 0.72, 0.48], d.material(0xc4362c, 0.48));
  d.box(walls, `${prefix}-firebox-glass`, [4.775, floorY + 0.74, -1.05], [0.012, 0.36, 0.32], d.material(0xe8eff2, 0.25));
  sign(walls, '紧急疏散图 · 消防安全', [4.89, floorY + 1.48, -1.05], -Math.PI / 2, 0.72, 0.42, {
    background: '#f2f7f2',
    foreground: '#21593c',
  });

  // 3. 走廊文化墙 / 校训与学子书画展区（东墙实墙 x=4.88, z=-5.0 .. -3.2 挂画，贴墙仅 3cm 不碰站立学生）
  const cultureTitle = isF2 ? '学子风采 · 书画作品展' : '校训校风 · 求知 · 明理 · 笃行';
  sign(walls, cultureTitle, [4.88, floorY + 2.26, -3.95], -Math.PI / 2, 1.85, 0.32, {
    background: '#f2e8d2',
    foreground: '#3c3024',
  });
  const artColors = [0xd67e58, 0x5c8c78, 0x4f789e];
  for (let idx = 0; idx < 3; idx += 1) {
    const az = -4.55 + idx * 0.6;
    d.box(walls, `${prefix}-art-frame-${idx}`, [4.88, floorY + 1.68, az], [0.03, 0.52, 0.42], woodFrame);
    d.box(walls, `${prefix}-art-canvas-${idx}`, [4.86, floorY + 1.68, az], [0.015, 0.42, 0.32], d.material(artColors[idx], 0.78));
  }

  // 4. 西墙储物柜编号牌（101-108 / 201-208；楼梯口 1F/2F 双面牌改由统一 createFloorSign 生成）
  lockersZ.forEach((lz, idx) => {
    const numStart = (isF2 ? 201 : 101) + idx * 4;
    sign(walls, `${numStart}-${numStart + 3}`, [1.14, floorY + 1.04, lz], Math.PI / 2, 0.68, 0.14, {
      background: '#46545a',
      foreground: '#f2ead9',
    });
  });

  // 5. 南端墙靠角陶土大叶绿植盆栽与课间休息木条长椅（x=2.45, z=8.55，远离通道与楼梯）
  d.box(walls, `${prefix}-south-pot`, [1.85, floorY + 0.24, 8.55], [0.42, 0.48, 0.42], d.material(COL_LOCKER_TERRA, 0.74));
  d.box(walls, `${prefix}-south-leaf-1`, [1.85, floorY + 0.72, 8.55], [0.58, 0.54, 0.58], d.material(0x4a7548, 0.84));
  d.box(walls, `${prefix}-south-leaf-2`, [1.85, floorY + 1.04, 8.55], [0.36, 0.36, 0.36], d.material(0x639458, 0.84));
  d.box(walls, `${prefix}-south-bench-seat`, [3.05, floorY + 0.42, 8.58], [1.35, 0.06, 0.42], d.material(COL_DESK_WOOD, 0.56));
  d.box(walls, `${prefix}-south-bench-back`, [3.05, floorY + 0.72, 8.76], [1.35, 0.34, 0.05], d.material(COL_DESK_WOOD, 0.56));
  for (const dx of [-0.52, 0.52]) {
    d.box(walls, `${prefix}-south-bench-leg-${dx}`, [3.05 + dx, floorY + 0.21, 8.58], [0.06, 0.42, 0.36], hardwareMat);
  }
}

function architecture(root: THREE.Group, d: Details, occluders: THREE.Object3D[], windTime: { value: number }) {
  const walls = group(root, 'interior-walls');
  const plaster = wallMaterial();
  const ceilingMat = ceilingTileMaterial();
  const plank1F = plankFloorMaterial(9, 5.5);
  const plank2F = plankFloorMaterial(7, 5.5);
  const wainscot = d.material(COL_WAINSCOT, 0.72, 0.02);
  const baseboard = d.material(COL_BASEBOARD, 0.66, 0.02);
  const woodFrame = d.material(COL_WOOD_FRAME, 0.58, 0.04);
  const hardwareMat = d.material(COL_HARDWARE, 0.44, 0.35);
  const doorMat = d.material(COL_CLASS_DOOR, 0.52, 0.06);
  const thresholdMat = d.material(0x6e563e, 0.9, 0, 0.08);
  const stairPadMat = d.material(COL_STAIR_PAD, 0.82, 0, 0.16);
  const stairStepMat = d.material(0xc7c6be, 0.84, 0, 0.16);
  const stairEdgeMat = d.material(0x3f5659, 0.78, 0.04, 0.16);
  const guideOchreMat = d.material(COL_GUIDE_OCHRE, 0.82, 0, 0.16);
  const brassRailMat = d.material(0x9e8444, 0.38, 0.55, 0.62);
  const numeralMat = d.material(0x9b6e32, 0.42, 0.35, 0.55);

  const exitGreenMat = new THREE.MeshStandardMaterial({
    color: COL_EXIT_GREEN, emissive: COL_EXIT_GREEN, emissiveIntensity: 0.12, roughness: 0.56,
  });
  const exitGlyphMat = new THREE.MeshStandardMaterial({
    color: 0xf0f5f1, emissive: 0xdff0e6, emissiveIntensity: 0.52, roughness: 0.4,
  });
  const frosted = new THREE.MeshStandardMaterial({
    color: 0xd6e0e4, roughness: 0.52, metalness: 0.04,
    transparent: true, opacity: 0.42, depthWrite: false, envMapIntensity: 0.4,
  });
  // P0-03：单层浅灰蓝微透玻璃（opacity 0.13，不抢景、不偏深蓝块）
  const glass = new THREE.MeshStandardMaterial({
    color: 0xb8cdd8, transparent: true, opacity: 0.13,
    roughness: 0.18, metalness: 0.12, depthWrite: false, envMapIntensity: 0.52,
  });

  // 1F 主地面（保留 interior-terrazzo-floor 契约节点名，升级为哑光顺纹条木地板）
  const floor1 = new THREE.Mesh(new THREE.PlaneGeometry(19, 18), plank1F);
  floor1.name = 'interior-terrazzo-floor';
  floor1.rotation.x = -Math.PI / 2;
  floor1.position.set(0.5, FLOOR1_Y, 0);
  floor1.castShadow = false;
  floor1.receiveShadow = true;
  root.add(floor1);

  // 2F 实心楼板（楼梯井 x∈[5, 10], z∈[-9, 0.4] 完整挑空）
  const floor2Main = new THREE.Mesh(new THREE.PlaneGeometry(14, 18), plank2F);
  floor2Main.name = 'floor-2f-main-surface';
  floor2Main.rotation.x = -Math.PI / 2;
  floor2Main.position.set(-2.0, FLOOR2_Y, 0);
  floor2Main.castShadow = false;
  floor2Main.receiveShadow = true;
  root.add(floor2Main);

  const floor2Plat = new THREE.Mesh(new THREE.PlaneGeometry(5, 8.6), plank2F);
  floor2Plat.name = 'floor-2f-platform-surface';
  floor2Plat.rotation.x = -Math.PI / 2;
  floor2Plat.position.set(7.5, FLOOR2_Y, 4.7);
  floor2Plat.castShadow = false;
  floor2Plat.receiveShadow = true;
  root.add(floor2Plat);

  // 2F 楼板底吸音吊顶（下沉 3cm 避开浅视角深度精度抖动）与走廊—楼梯厅实木分界压条
  d.box(walls, 'slab-2f-main', [-2.0, FLOOR2_Y - SLAB_THICK / 2 - 0.03, 0], [14.02, SLAB_THICK, 18.02], ceilingMat);
  d.box(walls, 'slab-2f-platform', [7.52, FLOOR2_Y - SLAB_THICK / 2 - 0.03, 4.7], [4.98, SLAB_THICK, 8.62], ceilingMat);
  d.box(walls, 'f2-platform-transition-strip', [5.0, FLOOR2_Y + 0.006, 3.8], [0.16, 0.012, 6.8], thresholdMat);
  d.box(walls, 'f1-platform-transition-strip', [5.0, FLOOR1_Y + 0.006, 3.8], [0.16, 0.012, 6.8], thresholdMat);
  d.box(walls, 'roof', [0.5, ROOF_Y, 0], [19.25, 0.16, 18.25], ceilingMat);

  // 1F & 2F 楼梯厅哑光青灰防滑胶面与导引边线（各层保持 ≥4mm 清晰垂直高度差并避开 x=5.0 门槛条，彻底消除斜视 Z-fighting 与白条闪烁）
  for (const [idx, fy] of [FLOOR1_Y, FLOOR2_Y].entries()) {
    d.box(walls, `f${idx + 1}-stair-cyan-pad`, [7.55, fy + 0.008, 2.35], [4.65, 0.016, 3.8], stairPadMat);
    d.box(walls, `f${idx + 1}-stair-cyan-line-s`, [7.55, fy + 0.02, 4.25], [4.65, 0.006, 0.075], guideOchreMat);
    d.box(walls, `f${idx + 1}-stair-cyan-line-w`, [5.26, fy + 0.02, 2.35], [0.075, 0.006, 3.8], guideOchreMat);
  }

  // 1F 南侧门厅磨石地面交界 + 成组换鞋柜兜底
  d.box(walls, 'f1-genkan-tile', [8.4, 0.008, 6.8], [3.0, 0.008, 4.1], d.material(0x7c8284, 0.68, 0.03));
  d.box(walls, 'f1-genkan-border', [6.9, 0.013, 6.8], [0.06, 0.006, 4.1], thresholdMat);
  const shoeFallback = group(walls, 'f1-shoe-locker-fallback');
  d.box(shoeFallback, 'f1-shoe-cabinet-frame', [9.45, 0.62, 7.2], [0.46, 1.24, 2.4], COL_LOCKER_CREAM);
  const shoeDoors: BoxPart[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      shoeDoors.push({
        p: [9.21, 0.24 + row * 0.38, 6.32 + col * 0.58],
        s: [0.018, 0.34, 0.52],
        color: (row + col) % 2 === 0 ? COL_LOCKER_CREAM : COL_LOCKER_TERRA,
      });
    }
  }
  d.batch(shoeFallback, 'f1-shoe-doors', shoeDoors, d.material(0xffffff, 0.62));

  // 楼梯口立体浮雕 1F / 2F 大字 + 绿底导视条统一排版（零重叠）
  createFloorSign(walls, root, d, 1, FLOOR1_Y, numeralMat);
  createFloorSign(walls, root, d, 2, FLOOR2_Y, numeralMat);
  sign(root, '侧楼梯 · 平台', [4.868, FLOOR2_Y + 3.34, 4.2], -Math.PI / 2, 1.85, 0.32, { background: '#edeae0', foreground: '#2c3a40' });
  sign(root, '下楼 · 一楼办公室', [5.134, FLOOR2_Y + 3.34, 2.2], Math.PI / 2, 1.48, 0.3, { background: '#f2ead9', foreground: '#5c3f22' });

  // 南北双层端墙（全高 7.6m，统一 1.15m 蓝灰墙裙 + 压顶木线 + 暖木踢脚）
  for (const z of [-9, 9]) {
    d.box(walls, 'end-wall', [0.5, 3.8, z], [19.25, 7.65, 0.22], plaster);
    for (const fy of [FLOOR1_Y, FLOOR2_Y]) {
      const innerZ = z - Math.sign(z) * 0.12;
      d.box(walls, 'end-wainscot', [0.5, fy + 0.575, innerZ], [19, 1.15, 0.025], wainscot);
      d.box(walls, 'end-wainscot-cap', [0.5, fy + 1.16, innerZ - Math.sign(z) * 0.008], [19, 0.03, 0.036], woodFrame);
      d.box(walls, 'end-baseboard', [0.5, fy + 0.06, innerZ - Math.sign(z) * 0.01], [19, 0.12, 0.032], baseboard);
    }
  }

  // 1F & 2F 内部隔墙（2F 教室中段墙分设为「北侧双跨走廊窗 + 中央实体公告栏墙 + 南侧走廊窗」，彻底消除公告栏穿窗穿柱！）
  const interiorGlassParts: BoxPart[] = [];
  const interiorMullionParts: BoxPart[] = [];
  for (const seg of [...PARTITIONS_2F, ...PARTITIONS_1F]) {
    const fy = (seg.minY ?? 0) >= FLOOR2_Y ? FLOOR2_Y : FLOOR1_Y;
    const isHorizontal = seg.s[0] > seg.s[2];
    if (seg.name === 'f2-class-wall-middle') {
      // 下部统一 1.24m 矮墙（兼容 0.90m 矮柜 + 0.337m 柜顶书包不挡窗玻璃！）
      d.box(walls, `${seg.name}-lower`, [1, fy + 0.62, 0], [0.22, 1.24, 7.6], wainscot);
      d.box(walls, `${seg.name}-base`, [1, fy + 0.06, 0], [0.25, 0.12, 7.6], baseboard);
      d.box(walls, `${seg.name}-upper`, [1, fy + 3.45, 0], [0.22, 0.7, 7.6], plaster);
      // 中段实体公告栏墙段 z ∈ [0.04, 2.26]（供 z=1.25 公告栏稳固居中挂装）
      d.box(walls, `${seg.name}-solid-bay`, [1, fy + 2.17, 1.15], [0.22, 1.86, 2.24], plaster);
      d.box(walls, `${seg.name}-solid-cap`, [1, fy + 1.24, 1.15], [0.25, 0.035, 2.24], woodFrame);
      // 北侧双窗跨 z ∈ [-3.80, 0.04]
      interiorMullionParts.push(
        { p: [1, fy + 1.25, -1.88], s: [0.3, 0.05, 3.84] },
        { p: [1, fy + 2.62, -1.88], s: [0.24, 0.06, 3.84] },
        { p: [1, fy + 3.08, -1.88], s: [0.24, 0.06, 3.84] },
        { p: [1, fy + 2.17, -3.76], s: [0.24, 1.86, 0.08] },
        { p: [1, fy + 2.17, -1.88], s: [0.24, 1.86, 0.08] },
        { p: [1, fy + 2.17, -0.02], s: [0.24, 1.86, 0.08] },
      );
      for (const wz of [-2.82, -0.95]) {
        interiorGlassParts.push(
          { p: [1, fy + 1.94, wz], s: [0.024, 1.32, 1.82] },
          { p: [1, fy + 2.85, wz], s: [0.024, 0.4, 1.82] },
        );
      }
      // 南侧单窗跨 z ∈ [2.26, 3.80]
      interiorMullionParts.push(
        { p: [1, fy + 1.25, 3.03], s: [0.3, 0.05, 1.56] },
        { p: [1, fy + 2.62, 3.03], s: [0.24, 0.06, 1.56] },
        { p: [1, fy + 3.08, 3.03], s: [0.24, 0.06, 1.56] },
        { p: [1, fy + 2.17, 2.28], s: [0.24, 1.86, 0.08] },
        { p: [1, fy + 2.17, 3.76], s: [0.24, 1.86, 0.08] },
      );
      interiorGlassParts.push(
        { p: [1, fy + 1.94, 3.02], s: [0.024, 1.32, 1.42] },
        { p: [1, fy + 2.85, 3.02], s: [0.024, 0.4, 1.42] },
      );
      continue;
    }
    d.box(walls, seg.name, seg.p, seg.s, plaster);
    // 沿墙体主轴略微缩进墙裙、压条与踢脚，避免楼梯井等自由端面产生共面 Z-fighting
    d.box(walls, `${seg.name}-wainscot`, [seg.p[0], fy + 0.575, seg.p[2]],
      [seg.s[0] + (isHorizontal ? -0.008 : 0.026), 1.15, seg.s[2] + (isHorizontal ? 0.026 : -0.008)], wainscot);
    d.box(walls, `${seg.name}-wainscot-cap`, [seg.p[0], fy + 1.16, seg.p[2]],
      [seg.s[0] + (isHorizontal ? -0.004 : 0.036), 0.03, seg.s[2] + (isHorizontal ? 0.036 : -0.004)], woodFrame);
    d.box(walls, `${seg.name}-baseboard`, [seg.p[0], fy + 0.06, seg.p[2]],
      [seg.s[0] + (isHorizontal ? -0.002 : 0.04), 0.12, seg.s[2] + (isHorizontal ? 0.04 : -0.002)], baseboard);
  }
  d.batch(walls, 'class-corridor-glass-batch', interiorGlassParts, glass).renderOrder = 2;
  d.batch(walls, 'class-corridor-mullion-batch', interiorMullionParts, woodFrame);

  // 2F 教室前后门与 1F 辅导员办公室门、阅览室门（门扇各自停靠在实墙侧，绝不碰撞柜柱）
  buildRoomDoorway(walls, root, d, FLOOR2_Y, -5, -1.68, '二楼 · 教室', '高一(3)班',
    plaster, frosted, woodFrame, doorMat, hardwareMat, thresholdMat);
  buildRoomDoorway(walls, root, d, FLOOR2_Y, 5, 1.68, '二楼 · 教室', '高一(3)班',
    plaster, frosted, woodFrame, doorMat, hardwareMat, thresholdMat);
  buildRoomDoorway(walls, root, d, FLOOR1_Y, -2.2, -1.68, '辅导员办公室', '1F 办公室',
    plaster, frosted, woodFrame, doorMat, hardwareMat, thresholdMat);
  buildRoomDoorway(walls, root, d, FLOOR1_Y, 5.0, 1.68, '一楼 · 阅览室', '1F 阅览室',
    plaster, frosted, woodFrame, doorMat, hardwareMat, thresholdMat);

  // 1F & 2F 楼梯厅过梁
  for (const fy of [FLOOR1_Y, FLOOR2_Y]) {
    d.box(walls, 'stair-door-lintel', [5, fy + 3.4, 3.8], [0.24, 0.8, 6.8], plaster);
  }

  // ==================== 东西两侧外立面采光窗墙（P0-03 彻底修复：每窗格独立单层嵌入玻璃，零重叠！） ====================
  const windowPanes: BoxPart[] = [];
  const windowMullions: BoxPart[] = [];
  let namedPanePlaced = false;
  for (const x of [-9, 10]) {
    for (const fy of [FLOOR1_Y, FLOOR2_Y]) {
      d.box(walls, 'window-parapet', [x, fy + 0.52, 0], [0.22, 1.04, 18.2], wainscot);
      d.box(walls, 'window-baseboard', [x - Math.sign(x) * 0.13, fy + 0.06, 0], [0.03, 0.12, 18], baseboard);
      d.box(walls, 'window-header', [x, fy + 3.45, 0], [0.22, 0.7, 18.2], plaster);
      d.box(walls, 'window-sill', [x, fy + 1.05, 0], [0.34, 0.06, 18.1], woodFrame);
      // 横向窗框（下框 1.09、中横梃 2.57、上框 3.10）+ 两侧收边立梃
      for (const wy of [1.09, 2.57, 3.1]) {
        windowMullions.push({ p: [x, fy + wy, 0], s: [0.24, 0.065, 18.1] });
      }
      windowMullions.push({ p: [x, fy + 2.09, 9.0], s: [0.24, 2.08, 0.1] });

      for (let z = -7.5; z <= 7.5; z += 3) {
        // 主窗柱（z - 1.5）与中央推拉竖梃（z）
        windowMullions.push(
          { p: [x, fy + 2.09, z - 1.5], s: [0.24, 2.08, 0.1] },
          { p: [x, fy + 1.83, z], s: [0.12, 1.44, 0.06] },
        );
        // 左开扇玻璃、右开扇玻璃、上亮窗玻璃——三块各自嵌入木框槽内，互不重叠！
        const leftSpec: BoxPart = { p: [x, fy + 1.83, z - 0.74], s: [0.024, 1.44, 1.44] };
        const rightSpec: BoxPart = { p: [x, fy + 1.83, z + 0.74], s: [0.024, 1.44, 1.44] };
        const topSpec: BoxPart = { p: [x, fy + 2.835, z], s: [0.024, 0.48, 2.92] };

        // 单独拆出一扇真实窗格命名为 window-pane 满足契约，不再额外叠放第二块同位玻璃！
        if (!namedPanePlaced && x === -9 && fy === FLOOR2_Y && z === -1.5) {
          d.box(walls, 'window-pane', leftSpec.p, leftSpec.s, glass).renderOrder = 2;
          namedPanePlaced = true;
        } else {
          windowPanes.push(leftSpec);
        }
        windowPanes.push(rightSpec, topSpec);
      }
      // 东侧楼梯平台窗内防坠金属横杆（带立柱墙托连接）
      if (x > 0) {
        d.box(walls, 'window-safety-rail', [x - 0.18, fy + 1.36, 0], [0.04, 0.04, 17.6], brassRailMat);
        for (let rz = -7.5; rz <= 7.5; rz += 3) {
          windowMullions.push({ p: [x - 0.11, fy + 1.36, rz - 1.5], s: [0.14, 0.045, 0.045] });
        }
      }
    }
  }
  d.batch(walls, 'window-panes-batch', windowPanes, glass).renderOrder = 2;
  d.batch(walls, 'window-mullions-batch', windowMullions, woodFrame);

  // 1F & 2F 走廊标配道具
  buildCorridorProps(walls, d, FLOOR1_Y, 'f1-corridor', plaster, wainscot, baseboard, woodFrame, hardwareMat, exitGreenMat, exitGlyphMat);
  buildCorridorProps(walls, d, FLOOR2_Y, 'f2-corridor', plaster, wainscot, baseboard, woodFrame, hardwareMat, exitGreenMat, exitGlyphMat);

  // ==================== 双跑折返楼梯（踏步防滑前缘 + 中央明晰导引线 + 接地扶手基座） ====================
  const stairs = group(root, 'stairwell-flight');
  const stepParts: BoxPart[] = [];
  const edgeParts: BoxPart[] = [];
  const yellowMarks: BoxPart[] = [];
  const stepsPerFlight = 12;
  const stepDepth = STAIR_RUN_LEN / stepsPerFlight;
  const stepRise = LANDING_Y / stepsPerFlight;

  // 上段梯段 A
  for (let i = 0; i < stepsPerFlight; i += 1) {
    const isTop = i === stepsPerFlight - 1;
    const zCenter = STAIR_Z_END + (i + 0.5) * stepDepth - (isTop ? 0.015 : 0);
    const topY = LANDING_Y + (i + 1) * stepRise - (isTop ? 0.004 : 0);
    stepParts.push({ p: [6.26, topY - 0.14, zCenter], s: [2.22, 0.28, isTop ? stepDepth - 0.02 : stepDepth + 0.02] });
    edgeParts.push({ p: [6.26, topY + 0.012, zCenter - (isTop ? stepDepth - 0.02 : stepDepth) / 2 + 0.026], s: [2.2, 0.016, 0.048] });
    yellowMarks.push({ p: [6.26, topY + 0.015, zCenter], s: [0.11, 0.005, stepDepth - 0.04] });
  }
  d.box(stairs, 'f1-under-upper-wall', [6.26, 1.85, STAIR_Z_START], [2.26, 3.7, 0.18], wainscot);
  d.box(stairs, 'f1-under-upper-base', [6.26, 0.06, STAIR_Z_START + 0.1], [2.28, 0.12, 0.04], baseboard);

  // 1.5F 中间休息平台
  d.box(stairs, 'stair-landing-slab', [7.5, LANDING_Y - 0.12, -6.65], [4.8, 0.24, 4.5], stairStepMat);
  d.box(stairs, 'stair-landing-cyan', [7.5, LANDING_Y + 0.008, -6.65], [4.65, 0.006, 4.25], stairPadMat);
  d.box(stairs, 'stair-landing-yellow-n', [7.5, LANDING_Y + 0.014, -8.55], [4.5, 0.004, 0.075], COL_GUIDE_OCHRE);
  d.box(stairs, 'stair-landing-yellow-e', [9.65, LANDING_Y + 0.014, -6.65], [0.075, 0.004, 4.0], COL_GUIDE_OCHRE);

  // 休息平台角落双灭火器（含底座箱托）+ 带箭头安全出口牌 + 广播音箱兜底
  d.box(stairs, 'landing-extinguisher-tray', [9.5, LANDING_Y + 0.025, -8.52], [0.56, 0.05, 0.26], hardwareMat);
  for (const ex of [9.36, 9.64]) {
    const body = new THREE.Mesh(d.cyl, d.material(0xb5342c, 0.42, 0.18));
    body.name = 'landing-extinguisher';
    body.position.set(ex, LANDING_Y + 0.3, -8.52);
    body.scale.set(0.15, 0.52, 0.15);
    body.castShadow = false;
    stairs.add(body);
    d.box(stairs, 'landing-extinguisher-cap', [ex, LANDING_Y + 0.6, -8.52], [0.07, 0.08, 0.07], hardwareMat);
  }
  buildExitSignUnit(stairs, d, 'landing-exit-sign', [9.83, LANDING_Y + 0.34, -7.8], -Math.PI / 2,
    0.44, 0.18, hardwareMat, exitGreenMat, exitGlyphMat, false);
  d.box(stairs, 'landing-speaker-fallback', [9.78, LANDING_Y + 2.6, -8.25], [0.15, 0.31, 0.23], hardwareMat);
  d.box(stairs, 'landing-rail-window', [9.78, LANDING_Y + 1.05, -6.65], [0.04, 0.04, 4.2], brassRailMat);

  // 下段梯段 B
  for (let i = 0; i < stepsPerFlight; i += 1) {
    const zCenter = STAIR_Z_END + (i + 0.5) * stepDepth;
    const topY = LANDING_Y - (i + 0.5) * stepRise;
    const h = Math.max(0.14, topY);
    stepParts.push({ p: [8.74, h / 2, zCenter], s: [2.22, h, stepDepth + 0.02] });
    edgeParts.push({ p: [8.74, topY + 0.012, zCenter + stepDepth / 2 - 0.026], s: [2.2, 0.016, 0.048] });
    yellowMarks.push({ p: [8.74, topY + 0.015, zCenter], s: [0.11, 0.005, stepDepth - 0.04] });
  }
  d.batch(stairs, 'stair-steps-batch', stepParts, stairStepMat);
  d.batch(stairs, 'stair-edges-batch', edgeParts, stairEdgeMat);
  d.batch(stairs, 'stair-yellow-marks', yellowMarks, COL_GUIDE_OCHRE);

  // 中隔蓝灰斜坡实心护墙 + 暖木压顶扶手盖板 + 带墙面连接法兰座的圆管扶手
  const slopeAngle = Math.atan(STAIR_SLOPE);
  const slopeLen = Math.hypot(STAIR_RUN_LEN, LANDING_Y);
  const dividerMat = d.material(0x758892, 0.72, 0.03);
  const upperWallShape = new THREE.Shape();
  upperWallShape.moveTo(STAIR_Z_END, LANDING_Y - 0.2);
  upperWallShape.lineTo(STAIR_Z_START, FLOOR2_Y - 0.2);
  upperWallShape.lineTo(STAIR_Z_START, FLOOR2_Y + 0.92);
  upperWallShape.lineTo(STAIR_Z_END, LANDING_Y + 0.92);
  upperWallShape.closePath();
  const upperWallGeo = new THREE.ExtrudeGeometry(upperWallShape, { depth: 0.2, bevelEnabled: false });
  upperWallGeo.rotateY(-Math.PI / 2);
  const upperWall = new THREE.Mesh(upperWallGeo, dividerMat);
  upperWall.name = 'stair-divider-wall-upper';
  upperWall.position.set(7.6, 0, 0);
  upperWall.castShadow = false;
  upperWall.receiveShadow = true;
  stairs.add(upperWall);

  const lowerWallShape = new THREE.Shape();
  lowerWallShape.moveTo(STAIR_Z_END, 0);
  lowerWallShape.lineTo(STAIR_Z_START, 0);
  lowerWallShape.lineTo(STAIR_Z_START, 0.92);
  lowerWallShape.lineTo(STAIR_Z_END, LANDING_Y + 0.92);
  lowerWallShape.closePath();
  const lowerWallGeo = new THREE.ExtrudeGeometry(lowerWallShape, { depth: 0.2, bevelEnabled: false });
  lowerWallGeo.rotateY(-Math.PI / 2);
  const lowerWall = new THREE.Mesh(lowerWallGeo, dividerMat);
  lowerWall.name = 'stair-divider-wall-lower';
  lowerWall.position.set(7.6, 0, 0);
  lowerWall.castShadow = false;
  lowerWall.receiveShadow = true;
  stairs.add(lowerWall);

  d.box(stairs, 'stair-divider-cap-upper', [7.5, LANDING_Y + 1.9, -2.0], [0.24, 0.075, slopeLen], woodFrame, [-slopeAngle, 0, 0]);
  d.box(stairs, 'stair-divider-cap-lower', [7.5, LANDING_Y / 2 + 0.95, -2.0], [0.24, 0.075, slopeLen], woodFrame, [slopeAngle, 0, 0]);
  d.box(stairs, 'stair-divider-newel', [7.5, LANDING_Y + 0.5, STAIR_Z_END - 0.05], [0.26, 1.04, 0.24], woodFrame);
  d.box(stairs, 'stair-handrail-upper', [5.18, LANDING_Y + 1.87, -2.0], [0.045, 0.045, slopeLen], brassRailMat, [-slopeAngle, 0, 0]);
  d.box(stairs, 'stair-handrail-lower', [9.82, LANDING_Y / 2 + 0.92, -2.0], [0.045, 0.045, slopeLen], brassRailMat, [slopeAngle, 0, 0]);
  // 扶手与墙体真实连接支座
  const railBrackets: BoxPart[] = [];
  for (const t of [0.12, 0.5, 0.88]) {
    const uz = STAIR_Z_END + t * STAIR_RUN_LEN;
    railBrackets.push(
      { p: [5.14, LANDING_Y + t * LANDING_Y + 0.9, uz], s: [0.08, 0.04, 0.04] },
      { p: [9.86, LANDING_Y * (1 - t) + 0.9, uz], s: [0.08, 0.04, 0.04] },
    );
  }
  d.batch(stairs, 'stair-rail-brackets', railBrackets, hardwareMat);

  // 2F 楼梯井安全护墙
  d.box(stairs, 'f2-stairwell-balustrade', [8.68, FLOOR2_Y + 0.52, STAIR_Z_START + 0.06], [2.56, 1.04, 0.16], dividerMat);
  d.box(stairs, 'f2-stairwell-balustrade-cap', [8.68, FLOOR2_Y + 1.06, STAIR_Z_START + 0.06], [2.62, 0.07, 0.24], woodFrame);
  d.box(stairs, 'f2-stairwell-balustrade-base', [8.68, FLOOR2_Y + 0.06, STAIR_Z_START + 0.15], [2.56, 0.12, 0.04], baseboard);

  occluders.push(walls, stairs);

  // ==================== 窗外庭院铺装、树池、对侧楼体与错落香樟树景（P1-04 修复） ====================
  const garden = group(root, 'window-greenery');
  const planterFrames: BoxPart[] = [];
  const planterSoils: BoxPart[] = [];
  const fallbackTrunks: BoxPart[] = [];
  const fallbackFoliage: FoliagePart[] = [];
  const shrubs: FoliagePart[] = [];

  for (const x of [-14, 15]) {
    const sgn = Math.sign(x);
    const wallEdgeX = x < 0 ? -9.2 : 10.2;
    // 近窗石材散水步道 + 路缘石 + 庭院草坪 + 中庭地面，明确交待树池扎根层次
    d.box(garden, 'garden-walkway', [wallEdgeX + sgn * 1.1, -0.08, 0], [2.2, 0.16, 26], d.material(0x9b988e, 0.86));
    d.box(garden, 'garden-curb', [wallEdgeX + sgn * 2.24, -0.04, 0], [0.14, 0.22, 26], d.material(0xb3afa4, 0.82));
    d.box(garden, 'garden-lawn', [x, -0.11, 0], [5.8, 0.16, 26], d.material(0x586d4f, 0.92));
    d.box(garden, 'garden-ground', [x + sgn * 3.8, -0.14, 0], [6.0, 0.18, 28], d.material(0x768287, 0.85));

    // 对侧四层卡通风格化教学楼群（石材台基 + 暖白错层主身/突梯间 + 壁柱 + 双色玻璃凹窗 + 挑檐百叶 + 入口雨棚 + 屋顶水箱空调，≤4 DrawCall / <2k 面 / 不投射实时阴影）
    const farX = x + sgn * 6.4;
    const faceX = farX - sgn * 0.92;
    const farBodyParts: BoxPart[] = [
      // 石材基座与错落主翼体量（中段楼梯间微凸 0.36m）
      { p: [farX, 0.45, 0], s: [2.05, 0.9, 22.8], color: 0x8a918e },
      { p: [farX, 5.95, -7.8], s: [1.82, 11.4, 6.2], color: 0xefe9dc },
      { p: [farX - sgn * 0.18, 6.55, 0], s: [2.16, 12.6, 8.2], color: 0xf4efe3 },
      { p: [farX, 5.75, 8.0], s: [1.82, 11.0, 6.2], color: 0xefe9dc },
      // 屋顶陶土女儿墙与腰线压条
      { p: [farX, 11.82, -7.8], s: [1.96, 0.36, 6.4], color: 0xb56d57 },
      { p: [farX - sgn * 0.18, 13.02, 0], s: [2.3, 0.42, 8.4], color: 0xb56d57 },
      { p: [farX, 11.42, 8.0], s: [1.96, 0.36, 6.4], color: 0xb56d57 },
    ];
    const farWinParts: BoxPart[] = [];
    const farTrimParts: BoxPart[] = [];
    const winLayout: ReadonlyArray<{ z: number; w: number; stair?: boolean }> = [
      { z: -9.2, w: 1.75 }, { z: -6.8, w: 1.75 }, { z: -4.6, w: 0.78, stair: true },
      { z: -2.2, w: 1.92 }, { z: 0.4, w: 1.92 }, { z: 2.8, w: 0.78, stair: true },
      { z: 5.1, w: 1.75 }, { z: 7.5, w: 1.75 }, { z: 9.6, w: 1.15 },
    ];
    // 垂直壁柱分割建筑开间
    for (const pz of [-10.6, -5.6, -3.6, -0.9, 1.8, 3.8, 6.3, 10.6]) {
      const proud = Math.abs(pz) < 4.2 ? sgn * 0.34 : 0;
      farBodyParts.push({ p: [faceX - proud, 5.9, pz], s: [0.18, 11.6, 0.28], color: 0xdfd7c6 });
    }
    for (const [floorIdx, fy] of [1.75, 4.65, 7.55, 10.45].entries()) {
      farTrimParts.push({ p: [faceX, fy - 0.9, 0], s: [0.16, 0.14, 22.0], color: 0xcabaa0 });
      for (const [colIdx, { z: wz, w, stair }] of winLayout.entries()) {
        const wingOffset = Math.abs(wz) < 4.1 ? sgn * 0.34 : 0;
        const wx = faceX - wingOffset;
        const warmRoom = ((floorIdx * 5 + colIdx) % 6 === 0) && !stair;
        // 窗框外框 + 内凹双色玻璃（天空映蓝 / 暖黄亮灯室） + 外飘窗台 + 局部微垂百叶
        farTrimParts.push(
          { p: [wx - sgn * 0.005, fy, wz], s: [0.06, 1.54, w + 0.14], color: 0x4b5c63 },
          { p: [wx - sgn * 0.08, fy - 0.77, wz], s: [0.18, 0.08, w + 0.2], color: 0xd9d2c2 },
        );
        farWinParts.push({
          p: [wx - sgn * 0.055, fy, wz],
          s: [0.024, 1.38, w],
          color: warmRoom ? 0xefc987 : stair ? 0x9fc0cc : 0x79a4ba,
        });
        if (!stair && (floorIdx + colIdx) % 2 === 0) {
          farWinParts.push({
            p: [wx - sgn * 0.082, fy + 0.42, wz],
            s: [0.016, 0.44, w - 0.1],
            color: 0xf4efe2,
          });
        }
      }
    }
    // 屋顶水箱与空调机剪影（移除 1F 突兀黑门块，保持对侧立面干净通透）
    farTrimParts.push(
      { p: [farX - sgn * 0.15, 13.55, -1.8], s: [0.9, 0.75, 1.6], color: 0xb9c4c6 },
      { p: [farX + sgn * 0.1, 12.35, -7.6], s: [0.7, 0.55, 0.9], color: 0xa6b0b2 },
      { p: [farX + sgn * 0.1, 11.95, 7.8], s: [0.7, 0.55, 0.9], color: 0xa6b0b2 },
    );
    const farBodyMesh = d.batch(garden, 'garden-far-buildings', farBodyParts, d.material(0xffffff, 0.86));
    farBodyMesh.castShadow = false;
    farBodyMesh.receiveShadow = false;
    const farWinMesh = d.batch(garden, 'garden-far-windows', farWinParts, d.material(0xffffff, 0.8, 0.02, 0.16));
    farWinMesh.castShadow = false;
    const farTrimMesh = d.batch(garden, 'garden-far-sills', farTrimParts, d.material(0xffffff, 0.78));
    farTrimMesh.castShadow = false;
  }

  // 为每株庭院香樟树建造石砌树池与深褐种植土，并放置程序化兜底树冠
  COURTYARD_TREES.forEach((tree, idx) => {
    planterFrames.push(
      { p: [tree.x, 0.08, tree.z - 0.68], s: [1.48, 0.24, 0.12] },
      { p: [tree.x, 0.08, tree.z + 0.68], s: [1.48, 0.24, 0.12] },
      { p: [tree.x - 0.68, 0.08, tree.z], s: [0.12, 0.24, 1.24] },
      { p: [tree.x + 0.68, 0.08, tree.z], s: [0.12, 0.24, 1.24] },
    );
    planterSoils.push({ p: [tree.x, 0.04, tree.z], s: [1.26, 0.12, 1.26] });

    const h = 4.5 * tree.scale;
    fallbackTrunks.push({ p: [tree.x, h * 0.34, tree.z], s: [0.24 * tree.scale, h * 0.68, 0.24 * tree.scale] });
    fallbackFoliage.push(
      { p: [tree.x - 0.55, h * 0.74, tree.z - 0.35], s: [0.95 * tree.scale, 0.62 * tree.scale, 0.86 * tree.scale], color: 0x445d46 },
      { p: [tree.x + 0.62, h * 0.78, tree.z + 0.38], s: [0.92 * tree.scale, 0.58 * tree.scale, 0.82 * tree.scale], color: 0x647a50 },
      { p: [tree.x + 0.08, h * 0.92, tree.z], s: [0.88 * tree.scale, 0.52 * tree.scale, 0.78 * tree.scale], color: 0x81915d },
    );
    shrubs.push({
      p: [tree.x + (idx % 2 === 0 ? 1.15 : -1.1), 0.32, tree.z + 1.05],
      s: [0.85, 0.48, 0.72],
      color: idx % 2 === 0 ? 0x4d6649 : 0x607852,
    });
  });
  d.batch(garden, 'garden-tree-planters', planterFrames, d.material(0xa4a095, 0.84));
  d.batch(garden, 'garden-tree-soils', planterSoils, d.material(0x4a3f34, 0.94));
  const fallbackTrunkMesh = d.batch(garden, 'garden-tree-trunks', fallbackTrunks, d.material(0x54493e, 0.9), d.cyl);
  const fallbackFoliageMesh = instancedFoliage(garden, 'garden-tree-foliage', fallbackFoliage, windTime);
  fallbackTrunkMesh.name = 'garden-tree-trunks-fallback';
  fallbackFoliageMesh.name = 'garden-tree-foliage-fallback';
  instancedFoliage(garden, 'garden-shrubs', shrubs, windTime);

  // ==================== 与窗格对齐的柔边条形窗光（P0-02 修复：NormalBlending + 避开门洞门槛） ====================
  const beams = group(root, 'corridor-light-beams');
  const beamQuads: BeamQuad[] = [
    // 2F 东侧平台与 1.5F 休息平台窗边轻薄斜光幕
    [[9.75, FLOOR2_Y + 2.85, 3.3], [9.75, FLOOR2_Y + 2.85, 4.4], [6.4, FLOOR2_Y + 0.05, 2.5], [6.4, FLOOR2_Y + 0.05, 4.9]],
    [[9.75, FLOOR2_Y + 2.85, 5.2], [9.75, FLOOR2_Y + 2.85, 6.3], [6.4, FLOOR2_Y + 0.05, 4.4], [6.4, FLOOR2_Y + 0.05, 6.8]],
    [[9.75, LANDING_Y + 2.6, -7.1], [9.75, LANDING_Y + 2.6, -5.8], [6.4, LANDING_Y + 0.05, -7.5], [6.4, LANDING_Y + 0.05, -5.4]],
    // 2F 教室西窗靠窗轻薄晨光束
    [[-8.75, FLOOR2_Y + 2.85, -4.2], [-8.75, FLOOR2_Y + 2.85, -3.1], [-5.2, FLOOR2_Y + 0.05, -4.6], [-5.2, FLOOR2_Y + 0.05, -2.7]],
    [[-8.75, FLOOR2_Y + 2.85, 1.8], [-8.75, FLOOR2_Y + 2.85, 2.9], [-5.2, FLOOR2_Y + 0.05, 1.4], [-5.2, FLOOR2_Y + 0.05, 3.3]],
  ];
  // 地面窗格柔光带：严格按 3m 窗跨分段留出窗梃暗缝，且停留在靠窗区域，绝不跨过 x=1.0 教室/办公室门槛冲淡木纹！
  const floorPatches: BeamQuad[] = [
    // 2F 教室西窗下成排条形窗光（x ∈ [-8.65, -5.35]）
    [[-8.65, FLOOR2_Y + 0.012, -5.6], [-8.65, FLOOR2_Y + 0.012, -3.4], [-5.35, FLOOR2_Y + 0.012, -5.8], [-5.35, FLOOR2_Y + 0.012, -3.2]],
    [[-8.65, FLOOR2_Y + 0.012, -2.6], [-8.65, FLOOR2_Y + 0.012, -0.4], [-5.35, FLOOR2_Y + 0.012, -2.8], [-5.35, FLOOR2_Y + 0.012, -0.2]],
    [[-8.65, FLOOR2_Y + 0.012, 0.4], [-8.65, FLOOR2_Y + 0.012, 2.6], [-5.35, FLOOR2_Y + 0.012, 0.2], [-5.35, FLOOR2_Y + 0.012, 2.8]],
    [[-8.65, FLOOR2_Y + 0.012, 3.4], [-8.65, FLOOR2_Y + 0.012, 5.6], [-5.35, FLOOR2_Y + 0.012, 3.2], [-5.35, FLOOR2_Y + 0.012, 5.8]],
    // 2F 东侧观景平台与走廊柔边条形窗光（分段对齐窗框，高于地面贴片与黄线层防 Z-fighting，且止于 x=1.9 绝不跨过 x=1.0 门槛！）
    [[9.6, FLOOR2_Y + 0.028, 0.7], [9.6, FLOOR2_Y + 0.028, 2.7], [2.0, FLOOR2_Y + 0.028, 0.3], [2.0, FLOOR2_Y + 0.028, 2.9]],
    [[9.6, FLOOR2_Y + 0.028, 3.5], [9.6, FLOOR2_Y + 0.028, 5.7], [2.2, FLOOR2_Y + 0.028, 3.1], [2.2, FLOOR2_Y + 0.028, 5.9]],
    // 1F 走廊东窗柔光带与办公室西窗柔光带
    [[9.6, FLOOR1_Y + 0.028, 0.8], [9.6, FLOOR1_Y + 0.028, 2.8], [2.1, FLOOR1_Y + 0.028, 0.4], [2.1, FLOOR1_Y + 0.028, 3.0]],
    [[-8.6, FLOOR1_Y + 0.012, -5.6], [-8.6, FLOOR1_Y + 0.012, -3.4], [-5.4, FLOOR1_Y + 0.012, -5.8], [-5.4, FLOOR1_Y + 0.012, -3.2]],
  ];
  beams.add(createWindowLightMesh('corridor-light-beam', beamQuads, 0xffe2b0, 0.06, THREE.AdditiveBlending, 2));
  beams.add(createWindowLightMesh('corridor-sun-patches', floorPatches, 0xffdfa8, 0.2, THREE.NormalBlending, 1));

  // 克制平衡的室内三路照明（P0-02：夕照点光从 22 降至 enter 时的 5.2，保留脸部与门槛木纹层次）
  const fill = new THREE.HemisphereLight(0xaac2d8, 0x5c636b, 0.88);
  fill.name = 'interior-fill';
  root.add(fill);
  const sunKey = new THREE.DirectionalLight(0xffd9a4, 1.02);
  sunKey.name = 'interior-sun-key';
  sunKey.position.set(14, 11, 4);
  sunKey.castShadow = false;
  root.add(sunKey);
  const sunset = new THREE.PointLight(0xffa65c, 0, 15, 2.0);
  sunset.name = 'interior-sunset';
  sunset.position.set(8.8, FLOOR2_Y + 2.5, 5.2);
  root.add(sunset);

  return { fill, sunKey, sunset, garden, beams };
}

/** 2F 高一(3)班教室精装（审查第 3 节：暖木与灰蓝喷涂钢管课桌椅、黑板粉笔槽与挂钟、不透明褶皱窗帘、林夏速写本）。 */
function buildClassroom2F(root: THREE.Group, d: Details, occluders: THREE.Object3D[], windTime: { value: number }) {
  const fy = FLOOR2_Y;
  const furniture = group(root, 'classroom-furniture');
  const steelFrames: BoxPart[] = [];
  const woodTops: BoxPart[] = [];
  const woodChairs: BoxPart[] = [];
  const metalBins: BoxPart[] = [];

  DESKS_2F.forEach(({ x, z }) => {
    // 桌面顶高严格对齐 0.750m（与 prop_school_desk_unit 高度一致，确保速写本与课本无缝贴桌）
    woodTops.push({ p: [x, fy + 0.736, z], s: [1.36, 0.028, 0.62] });
    metalBins.push({ p: [x, fy + 0.65, z + 0.02], s: [1.14, 0.11, 0.44] });
    woodChairs.push(
      { p: [x, fy + 0.445, z + 0.74], s: [0.43, 0.022, 0.4] },
      { p: [x, fy + 0.745, z + 0.93], s: [0.43, 0.19, 0.02] },
    );
    for (const dx of [-0.58, 0.58]) {
      for (const dz of [-0.23, 0.23]) {
        steelFrames.push({ p: [x + dx, fy + 0.365, z + dz], s: [0.03, 0.73, 0.03] });
      }
      steelFrames.push({ p: [x + dx, fy + 0.17, z], s: [0.024, 0.024, 0.46] });
    }
    for (const dx of [-0.175, 0.175]) {
      for (const dz of [-0.16, 0.16]) {
        steelFrames.push({ p: [x + dx, fy + 0.22, z + 0.74 + dz], s: [0.024, 0.44, 0.024] });
      }
      steelFrames.push({ p: [x + dx, fy + 0.62, z + 0.93], s: [0.022, 0.34, 0.022] });
    }
  });
  d.batch(furniture, 'desk-wood-tops', woodTops, d.material(COL_DESK_WOOD, 0.54, 0.02));
  d.batch(furniture, 'desk-book-boxes', metalBins, d.material(COL_DESK_STEEL, 0.52, 0.2));
  d.batch(furniture, 'chair-wood-parts', woodChairs, d.material(COL_DESK_WOOD, 0.52, 0.02));
  d.batch(furniture, 'desk-chair-legs', steelFrames, d.material(COL_DESK_STEEL, 0.5, 0.22));

  // 抬高 16cm 木质讲台地台 + 立式讲桌兜底（保留 'podium' 契约节点名）
  d.box(furniture, 'podium-stage', [-4.5, fy + 0.08, -7.85], [6.4, 0.16, 1.9], d.material(0x705d49, 0.6, 0.02));
  d.box(furniture, 'podium-stage-edge', [-4.5, fy + 0.155, -6.91], [6.42, 0.02, 0.04], d.material(COL_WOOD_FRAME, 0.52));
  d.box(furniture, 'podium', [-4.5, fy + 0.68, -7.65], [1.1, 1.04, 0.62], d.material(0xd2cec4, 0.56, 0.04));
  d.box(furniture, 'podium-top-slope', [-4.5, fy + 1.21, -7.65], [1.14, 0.04, 0.64], d.material(COL_WOOD_FRAME, 0.52), [0.08, 0, 0]);

  // 2F 教室四壁内部贴面（对照真实教室图 4：上部柔和暖白 + 下部浅木色护墙板与细木压线，仅作用于 2F 教室内部，不改走廊/楼梯间契约）
  const classUpperWallMat = d.material(0xf0ebe0, 0.9, 0);
  const classWoodWainscotMat = d.material(0xcab393, 0.68, 0.02);
  const classTrimMat = d.material(0x7e664b, 0.56, 0.03);
  d.box(root, 'class-west-wainscot', [-8.878, fy + 0.525, 0], [0.022, 1.03, 17.76], classWoodWainscotMat);
  d.box(root, 'class-west-baseboard', [-8.862, fy + 0.06, 0], [0.028, 0.12, 17.76], classTrimMat);
  d.box(root, 'class-west-header', [-8.878, fy + 3.45, 0], [0.022, 0.68, 17.76], classUpperWallMat);

  for (const [tag, wallZ, dir] of [['north', -8.876, 1], ['south', 8.876, -1]] as const) {
    d.box(root, `class-${tag}-upper`, [-4.0, fy + 2.48, wallZ], [9.76, 2.58, 0.02], classUpperWallMat);
    d.box(root, `class-${tag}-wainscot`, [-4.0, fy + 0.575, wallZ + dir * 0.008], [9.76, 1.15, 0.02], classWoodWainscotMat);
    d.box(root, `class-${tag}-wainscot-cap`, [-4.0, fy + 1.16, wallZ + dir * 0.016], [9.76, 0.032, 0.034], classTrimMat);
    d.box(root, `class-${tag}-baseboard`, [-4.0, fy + 0.06, wallZ + dir * 0.018], [9.76, 0.12, 0.03], classTrimMat);
  }
  for (const [tag, bayZ, bayLen] of [['east-front', -7.54, 2.68], ['east-rear', 7.54, 2.68]] as const) {
    d.box(root, `class-${tag}-upper`, [0.882, fy + 2.48, bayZ], [0.014, 2.58, bayLen], classUpperWallMat);
    d.box(root, `class-${tag}-wainscot`, [0.878, fy + 0.575, bayZ], [0.016, 1.15, bayLen], classWoodWainscotMat);
    d.box(root, `class-${tag}-wainscot-cap`, [0.874, fy + 1.16, bayZ], [0.024, 0.032, bayLen], classTrimMat);
    d.box(root, `class-${tag}-baseboard`, [0.872, fy + 0.06, bayZ], [0.026, 0.12, bayLen], classTrimMat);
  }
  d.box(root, 'class-east-mid-wainscot', [0.878, fy + 0.62, 0], [0.016, 1.24, 7.6], classWoodWainscotMat);
  d.box(root, 'class-east-mid-cap', [0.874, fy + 1.24, 0], [0.024, 0.035, 7.6], classTrimMat);
  d.box(root, 'class-east-mid-baseboard', [0.872, fy + 0.06, 0], [0.026, 0.12, 7.6], classTrimMat);
  d.box(root, 'class-east-mid-solid-upper', [0.882, fy + 2.17, 1.15], [0.014, 1.86, 2.24], classUpperWallMat);
  d.box(root, 'class-east-header', [0.882, fy + 3.45, 0], [0.014, 0.68, 17.76], classUpperWallMat);

  // 桌椅与讲台柔和接地阴影，消除无脚影悬浮感
  const shadowPatches: BoxPart[] = [{ p: [-4.5, fy + 0.004, -7.85], s: [6.46, 0.002, 1.96] }];
  DESKS_2F.forEach(({ x, z }) => {
    shadowPatches.push(
      { p: [x, fy + 0.004, z], s: [1.34, 0.002, 0.6] },
      { p: [x, fy + 0.004, z + 0.74], s: [0.46, 0.002, 0.46] },
    );
  });
  d.batch(furniture, 'class-desk-contact-shadows', shadowPatches, new THREE.MeshBasicMaterial({
    color: 0x26201a, transparent: true, opacity: 0.18, depthWrite: false,
  }));

  // 前墙中心：木框墨绿黑板（#314943，roughness 0.82）+ 粉笔槽 + 横向白色粉笔标语“祝愿祖国繁荣昌盛！” + 挂钟
  const woodTrim = d.material(COL_WOOD_FRAME, 0.6, 0.03);
  const boardGreen = d.material(COL_CHALKBOARD, 0.82, 0.01);
  d.box(root, 'blackboard-frame', [-4.5, fy + 2.1, -8.83], [5.8, 1.5, 0.09], woodTrim);
  d.box(root, 'blackboard', [-4.5, fy + 2.1, -8.77], [5.58, 1.3, 0.04], boardGreen);
  d.box(root, 'chalk-tray', [-4.5, fy + 1.36, -8.67], [5.8, 0.038, 0.16], d.material(0x55605d, 0.62, 0.15));
  d.box(root, 'blackboard-eraser', [-3.4, fy + 1.4, -8.62], [0.18, 0.045, 0.075], 0xc9c1ae);
  d.box(root, 'chalk-sticks', [-4.15, fy + 1.39, -8.63], [0.12, 0.014, 0.04], 0xefece2);
  sign(root, '新生活 · 新开始', [-4.5, fy + 3.22, -8.74], 0, 3.2, 0.34, { background: '#edeae0', foreground: '#2e3d42' });

  if (typeof document !== 'undefined') {
    const chalkCanvas = document.createElement('canvas');
    chalkCanvas.width = 1024;
    chalkCanvas.height = 256;
    const chalkCtx = chalkCanvas.getContext('2d');
    if (chalkCtx && typeof chalkCtx.fillText === 'function') {
      if (typeof chalkCtx.clearRect === 'function') chalkCtx.clearRect(0, 0, chalkCanvas.width, chalkCanvas.height);
      chalkCtx.font = '600 84px "KaiTi", "STKaiti", "Noto Serif SC", "PingFang SC", "Microsoft YaHei", serif';
      chalkCtx.textAlign = 'center';
      chalkCtx.textBaseline = 'middle';
      chalkCtx.shadowColor = 'rgba(248, 245, 232, 0.28)';
      chalkCtx.shadowBlur = 4;
      chalkCtx.fillStyle = 'rgba(244, 240, 224, 0.92)';
      chalkCtx.fillText('祝愿祖国繁荣昌盛！', chalkCanvas.width / 2, chalkCanvas.height / 2);
      const chalkTex = new THREE.CanvasTexture(chalkCanvas);
      chalkTex.colorSpace = THREE.SRGBColorSpace;
      const chalkMat = new THREE.MeshStandardMaterial({
        map: chalkTex, transparent: true, roughness: 0.92, metalness: 0, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1,
      });
      const releaseChalk = (): void => { chalkTex.dispose(); chalkMat.removeEventListener('dispose', releaseChalk); };
      chalkMat.addEventListener('dispose', releaseChalk);
      const chalkMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.45, 0.82), chalkMat);
      chalkMesh.name = 'blackboard-chalk-slogan';
      chalkMesh.position.set(-4.5, fy + 2.16, -8.745);
      chalkMesh.castShadow = false;
      chalkMesh.receiveShadow = false;
      root.add(chalkMesh);
    }
  }

  // 前墙圆形校园挂钟
  const clockGroup = group(root, 'classroom-wall-clock');
  clockGroup.position.set(-1.1, fy + 3.02, -8.82);
  const clockRim = new THREE.Mesh(d.cyl, d.material(COL_HARDWARE, 0.46, 0.3));
  clockRim.rotation.x = Math.PI / 2;
  clockRim.scale.set(0.38, 0.05, 0.38);
  clockRim.castShadow = false;
  clockGroup.add(clockRim);
  const clockFace = new THREE.Mesh(d.cyl, d.material(0xf2eee4, 0.78));
  clockFace.rotation.x = Math.PI / 2;
  clockFace.position.z = 0.012;
  clockFace.scale.set(0.33, 0.035, 0.33);
  clockFace.castShadow = false;
  clockGroup.add(clockFace);
  d.box(clockGroup, 'clock-hand-h', [0.035, 0.03, 0.034], [0.095, 0.014, 0.006], COL_HARDWARE, [0, 0, 0.62]);
  d.box(clockGroup, 'clock-hand-m', [-0.01, 0.055, 0.036], [0.012, 0.13, 0.006], COL_HARDWARE, [0, 0, 0.12]);

  d.box(root, 'class-front-speaker-fallback', [-8.25, fy + 3.08, -8.74], [0.23, 0.31, 0.15], COL_HARDWARE);

  // 后墙：板报黑板 + 分件清晰的双层开放式书包柜 + 素净分块“带框班级展示板/光荣榜” + 靠门矮储物柜
  d.box(root, 'back-blackboard-frame', [-4.6, fy + 2.16, 8.815], [5.4, 1.4, 0.08], woodTrim);
  d.box(root, 'back-blackboard', [-4.6, fy + 2.16, 8.765], [5.18, 1.22, 0.04], boardGreen);
  const rearCubby = group(root, 'class-back-cubby');
  d.box(rearCubby, 'cubby-plinth', [-4.6, fy + 0.04, 8.62], [5.36, 0.08, 0.38], woodTrim);
  d.box(rearCubby, 'cubby-back', [-4.6, fy + 0.52, 8.8], [5.36, 0.96, 0.03], d.material(0x63503e, 0.78));
  const cubbyBoards: BoxPart[] = [
    { p: [-4.6, fy + 0.09, 8.61], s: [5.4, 0.028, 0.42] },
    { p: [-4.6, fy + 0.53, 8.61], s: [5.36, 0.026, 0.4] },
    { p: [-4.6, fy + 0.99, 8.6], s: [5.44, 0.032, 0.44] },
  ];
  for (let i = 0; i <= 8; i += 1) {
    cubbyBoards.push({ p: [-7.26 + i * 0.665, fy + 0.54, 8.61], s: [0.028, 0.88, 0.4] });
  }
  d.batch(rearCubby, 'class-back-cubby-grid', cubbyBoards, d.material(COL_DESK_WOOD, 0.6));

  // 后墙右侧：带浅木外框、米灰底与暖黄/淡蓝分区卡片的班级展示板
  const displayBoard = group(root, 'class-rear-display-board');
  const displayWood = d.material(0xb6956c, 0.58, 0.02);
  d.box(displayBoard, 'display-board-frame', [-0.78, fy + 2.08, 8.83], [1.86, 1.18, 0.05], displayWood);
  d.box(displayBoard, 'display-board-mat', [-0.78, fy + 2.08, 8.812], [1.76, 1.08, 0.024], d.material(0xe6e1d3, 0.88));
  d.box(displayBoard, 'display-card-header', [-0.78, fy + 2.47, 8.796], [1.62, 0.16, 0.012], d.material(0xdcb973, 0.84));
  d.box(displayBoard, 'display-card-honor', [-1.22, fy + 2.01, 8.796], [0.72, 0.64, 0.01], d.material(0xf4f1e8, 0.86));
  d.box(displayBoard, 'display-card-blue', [-0.36, fy + 2.04, 8.796], [0.76, 0.58, 0.01], d.material(0xcad8df, 0.86));
  d.box(displayBoard, 'display-card-strip', [-0.36, fy + 1.65, 8.796], [0.76, 0.09, 0.012], d.material(0x9cb1bc, 0.84));
  d.box(displayBoard, 'display-board-ledge', [-0.78, fy + 1.48, 8.78], [1.86, 0.03, 0.08], displayWood);

  // 靠后门东侧实墙低矮木质储物柜（严密避让 z∈[6.21, 7.15] 门扇停靠区与桌椅通道）
  const doorCabinet = group(root, 'class-door-low-cabinet');
  d.box(doorCabinet, 'door-cabinet-plinth', [0.65, fy + 0.04, 7.98], [0.38, 0.08, 1.2], d.material(0x63503e, 0.78));
  d.box(doorCabinet, 'door-cabinet-body', [0.65, fy + 0.49, 7.98], [0.42, 0.82, 1.24], d.material(0xc7ad89, 0.6));
  d.box(doorCabinet, 'door-cabinet-top', [0.64, fy + 0.915, 7.98], [0.46, 0.032, 1.28], displayWood);
  for (const dz of [7.67, 8.29]) {
    d.box(doorCabinet, 'door-cabinet-leaf', [0.436, fy + 0.49, dz], [0.018, 0.72, 0.56], d.material(0xd2bc9b, 0.62));
  }
  for (const hz of [7.91, 8.05]) {
    d.box(doorCabinet, 'door-cabinet-handle', [0.422, fy + 0.54, hz], [0.016, 0.14, 0.016], COL_HARDWARE);
  }

  d.box(root, 'class-back-locker-fallback', [-8.35, fy + 0.96, 8.52], [0.9, 1.92, 0.43], d.material(0x5c7585, 0.52, 0.22));
  d.box(root, 'class-front-trashbin', [0.48, fy + 0.28, -8.45], [0.34, 0.56, 0.34], d.material(0x959ea3, 0.66));

  // 教室 3 列纵向长方形吊顶荧光灯具（严格对齐 3 列课桌 x=[-7, -4, -1.45]）
  const lampParts: BoxPart[] = [];
  const lampFrames: BoxPart[] = [];
  const lampTubeMat = new THREE.MeshStandardMaterial({
    color: 0xf7f4eb, emissive: 0xfff6e0, emissiveIntensity: 0.42, roughness: 0.35,
  });
  for (const lx of [-7.0, -4.0, -1.45]) {
    for (const lz of [-3.5, 2.5]) {
      lampParts.push(
        { p: [lx, fy + 3.44, lz - 0.56], s: [0.018, 0.44, 0.018] },
        { p: [lx, fy + 3.44, lz + 0.56], s: [0.018, 0.44, 0.018] },
        { p: [lx, fy + 3.198, lz], s: [0.27, 0.02, 1.48] },
      );
      lampFrames.push({ p: [lx, fy + 3.222, lz], s: [0.34, 0.055, 1.56] });
      d.box(root, 'class-lamp-tube', [lx, fy + 3.184, lz], [0.23, 0.016, 1.44], lampTubeMat);
    }
  }
  d.batch(root, 'class-lamp-rigs', lampParts, d.material(COL_HARDWARE, 0.46, 0.28));
  d.batch(root, 'class-lamp-housings', lampFrames, d.material(0xd9deda, 0.52, 0.12));

  // 西窗细窄窗帘杆 + 收拢于窗柱旁的灰青色宽褶布窗帘（参考图 4 收拢形态与深青灰色调，绝不遮挡采光）
  d.box(root, 'class-curtain-rod', [-8.76, fy + 3.11, 0], [0.024, 0.024, 17.6], d.material(COL_HARDWARE, 0.42, 0.48));
  const rodBrackets: BoxPart[] = [];
  for (const bz of [-6.0, -3.0, 0.0, 3.0, 6.0]) {
    rodBrackets.push({ p: [-8.83, fy + 3.11, bz], s: [0.14, 0.024, 0.024] });
  }
  d.batch(root, 'class-curtain-brackets', rodBrackets, d.material(COL_HARDWARE, 0.46, 0.36));

  const curtainGeo = new THREE.PlaneGeometry(0.56, 2.02, 14, 6);
  const posAttr = curtainGeo.getAttribute('position');
  for (let i = 0; i < posAttr.count; i += 1) {
    const ux = posAttr.getX(i);
    const uy = posAttr.getY(i);
    const pleat = Math.sin(ux * 34.0) * 0.036 * (0.68 + (1.01 - uy) * 0.2);
    posAttr.setZ(i, pleat);
  }
  curtainGeo.computeVertexNormals();
  const curtainMat = new THREE.MeshStandardMaterial({
    color: 0x445d63, roughness: 0.92, metalness: 0, side: THREE.DoubleSide,
  });
  curtainMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windTime;
    shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float curtainWeight = clamp((1.01 - position.y) / 2.02, 0.0, 1.0);
      transformed.z += sin(uTime * 1.15 + position.x * 3.0) * 0.015 * curtainWeight * curtainWeight;`,
    );
  };
  curtainMat.customProgramCacheKey = () => 'school-curtain-breeze-v2';
  for (const [idx, z] of [-6.0, 0.0, 6.0].entries()) {
    const geo = idx === 0 ? curtainGeo : curtainGeo.clone();
    const curtain = new THREE.Mesh(geo, curtainMat);
    curtain.name = 'classroom-curtain';
    curtain.position.set(-8.76, fy + 2.09, z);
    curtain.rotation.y = Math.PI / 2;
    curtain.castShadow = false;
    curtain.receiveShadow = true;
    root.add(curtain);
  }

  // 林夏窗边课桌上的速写本、铅笔与透明感笔袋（贴合 0.750m 桌面，绝不悬空！）
  const sketch = group(root, 'linxia-sketchbook');
  d.box(sketch, 'sketchbook-cover', [-7, fy + 0.759, 4], [0.55, 0.018, 0.38], 0x838d78);
  for (const dx of [-0.135, 0.135]) {
    d.box(sketch, 'sketchbook-page', [-7 + dx, fy + 0.772, 4], [0.26, 0.012, 0.36], 0xf2ecdc);
  }
  const lines: BoxPart[] = [];
  for (let i = 0; i < 5; i += 1) lines.push({ p: [-7.2 + i * 0.088, fy + 0.78, 3.97], s: [0.002, 0.001, 0.2] });
  for (const z of [3.88, 4.07]) lines.push({ p: [-7.03, fy + 0.78, z], s: [0.36, 0.001, 0.002] });
  d.batch(sketch, 'pencilled-window-study', lines, 0x6f756b);
  const pencil = d.box(sketch, 'pencil', [-6.84, fy + 0.784, 4.17], [0.008, 0.008, 0.18], 0xb28c50);
  pencil.rotation.y = -0.3;
  d.box(sketch, 'pencil-tip', [-6.815, fy + 0.783, 4.085], [0.005, 0.005, 0.015], 0x4c4d47);
  d.box(sketch, 'pencil-case', [-7.46, fy + 0.776, 4], [0.11, 0.05, 0.28], 0x9aa8a4);

  // 少数桌面点缀课本与卷角练习册（贴合 0.750m 桌面）
  const booksA: BoxPart[] = [];
  const booksB: BoxPart[] = [];
  DESKS_2F.forEach(({ x, z }, i) => {
    if (i % 3 !== 0) return;
    booksA.push({ p: [x + 0.35, fy + 0.766, z - 0.1], s: [0.27, 0.03, 0.19] });
    booksB.push({ p: [x + 0.39, fy + 0.793, z - 0.07], s: [0.22, 0.024, 0.15], r: [0, 0.08, 0] });
  });
  d.batch(furniture, 'desk-books-a', booksA, 0x8b624f);
  d.batch(furniture, 'desk-books-b', booksB, 0x4b6a7c);

  occluders.push(furniture);
  return sketch;
}

/** 1F 辅导员办公室（突出周老师交流工位、台灯与分节档案柜）+ 1F 阅览室（多层书架与高矮书脊 + 阅读工作灯）。 */
function buildFloor1Rooms(root: THREE.Group, d: Details, occluders: THREE.Object3D[]) {
  const office = group(root, 'teacher-office-furniture');
  const walnut = d.material(0x6b4e37, 0.5, 0.03);
  const metalGray = d.material(0x7a868e, 0.52, 0.22);
  const monitorDark = d.material(COL_HARDWARE, 0.42, 0.2);
  const chairMat = d.material(0x3a434a, 0.68, 0.08);

  // 1F 辅导员办公桌程序化兜底（Blender 胡桃木办公桌到位后隐藏）
  const officeDeskFallback = group(office, 'office-desks-fallback');
  const deskTops: BoxPart[] = [];
  const drawers: BoxPart[] = [];
  const monitors: BoxPart[] = [];
  OFFICE_DESKS_1F.forEach(({ x, z, yaw }) => {
    const sx = yaw === 0 ? 1.6 : 0.78;
    const sz = yaw === 0 ? 0.78 : 1.6;
    deskTops.push({ p: [x, 0.732, z], s: [sx, 0.036, sz] });
    drawers.push({ p: [x - (yaw === 0 ? 0.52 : 0), 0.365, z - (yaw === 0 ? 0 : 0.52)], s: [0.44, 0.7, 0.68] });
    monitors.push({ p: [x + 0.22, 0.96, z - 0.08], s: [0.5, 0.3, 0.03] });
  });
  d.batch(officeDeskFallback, 'office-desk-tops', deskTops, walnut);
  d.batch(officeDeskFallback, 'office-desk-drawers', drawers, metalGray);
  d.batch(officeDeskFallback, 'office-monitors', monitors, monitorDark);

  // 教师办公椅与周老师桌前访谈学生圆凳（从走廊门口一眼认出交流站位）
  OFFICE_DESKS_1F.forEach(({ x, z, yaw }, idx) => {
    const ox = yaw === 0 ? x : x - 0.68;
    const oz = yaw === 0 ? z - 0.68 : z;
    d.box(office, `office-chair-seat-${idx}`, [ox, 0.45, oz], [0.48, 0.055, 0.46], chairMat);
    d.box(office, `office-chair-back-${idx}`, [ox - (yaw === 0 ? 0 : 0.2), 0.78, oz - (yaw === 0 ? 0.2 : 0)],
      [yaw === 0 ? 0.46 : 0.05, 0.58, yaw === 0 ? 0.05 : 0.46], chairMat);
    d.box(office, `office-chair-stem-${idx}`, [ox, 0.22, oz], [0.055, 0.44, 0.055], monitorDark);
  });
  // 周老师办公桌前四脚木圆凳（不挡导航，真实接地结构点明交流位）
  const stoolWood = d.material(COL_DESK_WOOD, 0.54);
  const guestStool = new THREE.Mesh(d.cyl, stoolWood);
  guestStool.name = 'office-visitor-stool';
  guestStool.position.set(-2.45, 0.44, -4.65);
  guestStool.scale.set(0.35, 0.032, 0.35);
  guestStool.castShadow = false;
  office.add(guestStool);
  for (const [lx, lz] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]] as const) {
    d.box(office, 'office-visitor-stool-leg', [-2.45 + lx, 0.215, -4.65 + lz], [0.032, 0.43, 0.032], stoolWood);
  }

  // 周老师桌面台灯微暖光晕（柔和不刺眼）
  const lampGlow = new THREE.PointLight(0xffd296, 0.65, 3.6, 2.0);
  lampGlow.name = 'teacher-desk-lamp-light';
  lampGlow.position.set(-3.95, 1.06, -5.2);
  office.add(lampGlow);

  // 北墙一排五组上玻下铁档案柜程序化兜底（Blender 档案柜到位后隐藏，零透明闪烁）
  const cabFallback = group(office, 'office-cabinets-fallback');
  const cabBodies: BoxPart[] = [];
  for (const cx of [-6.4, -5.45, -4.5, -3.55, -2.6]) {
    cabBodies.push({ p: [cx, 0.97, -8.55], s: [0.9, 1.94, 0.42] });
  }
  d.batch(cabFallback, 'office-file-cabinets', cabBodies, metalGray);

  // 办公室墙面值班行事白板、饮水机与绿植
  d.box(office, 'office-whiteboard-frame', [0.85, 1.82, -6.1], [0.04, 1.18, 2.05], woodFrameMaterial(d));
  d.box(office, 'office-whiteboard', [0.825, 1.82, -6.1], [0.02, 1.08, 1.94], d.material(0xefeee8, 0.52));
  d.box(office, 'office-dispenser-body', [0.46, 0.52, -0.35], [0.38, 1.04, 0.38], d.material(0xe2dfd6, 0.62));
  d.box(office, 'office-dispenser-jug', [0.46, 1.22, -0.35], [0.26, 0.34, 0.26], d.material(0x7ba4b8, 0.32));
  d.box(office, 'office-plant-pot', [-8.3, 0.24, -0.55], [0.36, 0.48, 0.36], d.material(COL_LOCKER_TERRA, 0.76));
  d.box(office, 'office-plant-leaf', [-8.3, 0.76, -0.55], [0.58, 0.66, 0.58], d.material(0x4c6848, 0.86));

  for (const lz of [-6.0, -2.2]) {
    d.box(office, 'office-lamp-hood', [-4.2, 3.62, lz], [0.3, 0.06, 1.36], monitorDark);
    d.box(office, 'office-lamp-bulb', [-4.2, 3.58, lz], [0.2, 0.025, 1.26], d.material(0xf5efe0, 0.4));
  }

  // ==================== 1F 阅览室（多层开放式书架 + 错落高矮书脊 + 阅览工作灯，明显区别于教室！） ====================
  STUDY_TABLES_1F.forEach(({ x, z }, i) => {
    d.box(office, `study-table-top-${i}`, [x, 0.74, z], [2.72, 0.045, 1.1], d.material(COL_DESK_WOOD, 0.52));
    d.box(office, `study-table-apron-${i}`, [x, 0.69, z], [2.56, 0.055, 0.94], woodFrameMaterial(d));
    for (const dx of [-1.18, 1.18]) for (const dz of [-0.44, 0.44]) {
      d.box(office, 'study-table-leg', [x + dx, 0.36, z + dz], [0.055, 0.72, 0.055], monitorDark);
    }
    // 阅览桌中央绿色罩银行式工作阅读灯
    d.box(office, `study-lamp-stand-${i}`, [x, 0.92, z], [0.04, 0.32, 0.04], d.material(0x9b7e46, 0.4, 0.5));
    d.box(office, `study-lamp-shade-${i}`, [x, 1.08, z], [0.46, 0.07, 0.2],
      new THREE.MeshStandardMaterial({ color: 0x35634d, emissive: 0x2c5942, emissiveIntensity: 0.25, roughness: 0.42 }));
  });

  // 阅览室南墙五层分格实木书架 + 多组高矮错落书脊（彻底消除原先单块棕色大盒！）
  const shelfGroup = group(office, 'study-bookshelf');
  const shelfWood = woodFrameMaterial(d);
  d.box(shelfGroup, 'bookshelf-back', [-4.6, 1.05, 8.79], [5.16, 2.06, 0.03], d.material(0x4f3e30, 0.82));
  d.box(shelfGroup, 'bookshelf-plinth', [-4.6, 0.05, 8.6], [5.2, 0.1, 0.4], shelfWood);
  const shelfBoards: BoxPart[] = [];
  for (const sy of [0.11, 0.56, 1.01, 1.46, 1.91, 2.08]) {
    shelfBoards.push({ p: [-4.6, sy, 8.6], s: [5.2, 0.032, 0.42] });
  }
  for (let c = 0; c <= 5; c += 1) {
    shelfBoards.push({ p: [-7.16 + c * 1.024, 1.09, 8.6], s: [0.034, 1.96, 0.4] });
  }
  d.batch(shelfGroup, 'bookshelf-frame-batch', shelfBoards, d.material(0x7c6045, 0.64));

  const bookSpines: BoxPart[] = [];
  const spinePalette = [0x466375, 0x8c5e4b, 0x5c7358, 0xc7bea8, 0x735b69, 0x9e8458];
  for (let row = 0; row < 4; row += 1) {
    const baseY = 0.13 + row * 0.45;
    for (let bay = 0; bay < 5; bay += 1) {
      const bayLeft = -7.08 + bay * 1.024;
      for (let b = 0; b < 9; b += 1) {
        if ((row + bay + b) % 7 === 0) continue; // 留出自然抽空缺口
        const bh = 0.24 + ((row * 5 + bay * 3 + b * 7) % 4) * 0.035;
        bookSpines.push({
          p: [bayLeft + 0.06 + b * 0.088, baseY + bh / 2, 8.58],
          s: [0.068, bh, 0.24],
          color: spinePalette[(row * 3 + bay * 2 + b) % spinePalette.length],
        });
      }
    }
  }
  d.batch(shelfGroup, 'bookshelf-spines-batch', bookSpines, d.material(0xffffff, 0.76));

  for (const lz of [2.6, 6.2]) {
    d.box(office, 'study-lamp-hood', [-4.5, 3.62, lz], [0.3, 0.06, 1.35], monitorDark);
    d.box(office, 'study-lamp-bulb', [-4.5, 3.58, lz], [0.2, 0.025, 1.25], d.material(0xf2efe4, 0.4));
  }

  occluders.push(office);
}

function woodFrameMaterial(d: Details): THREE.MeshStandardMaterial {
  return d.material(COL_WOOD_FRAME, 0.6, 0.03);
}

// ==================== Blender 13 件低模套件异步热替换（与 canteen.ts 生命周期同构） ====================
let interiorGeneration = 0;
const interiorPropMeshes: THREE.InstancedMesh[] = [];
const interiorOwnedMaterials: THREE.Material[] = [];

interface KitPlacement {
  x: number;
  y?: number;
  z: number;
  yaw?: number;
  scale?: number;
  tintScalar?: number;
}

function createTreeWindMaterial(baseMaterial: THREE.Material, windTime: { value: number }, keySuffix: string): THREE.Material {
  const cloned = baseMaterial.clone();
  cloned.userData = { ...baseMaterial.userData, sharedResource: false };
  if (cloned instanceof THREE.MeshStandardMaterial) {
    cloned.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = windTime;
      shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float treePhase = instanceMatrix[3][0] * 0.47 + instanceMatrix[3][2] * 0.61;
        #else
          float treePhase = 0.0;
        #endif
        float crownWeight = clamp((position.y - 1.35) / 3.2, 0.0, 1.0);
        crownWeight = crownWeight * crownWeight;
        transformed.x += sin(uTime * 1.18 + treePhase + position.z * 0.5) * 0.075 * crownWeight;
        transformed.z += cos(uTime * 0.94 + treePhase * 1.3 + position.x * 0.5) * 0.055 * crownWeight;`,
      );
    };
    cloned.customProgramCacheKey = () => `school-camphor-wind-${keySuffix}`;
  }
  interiorOwnedMaterials.push(cloned);
  return cloned;
}

function mountSchoolKitProps(root: THREE.Group, garden: THREE.Group, windTime: { value: number }): void {
  if (!isBrowserRuntime()) return;
  const generation = interiorGeneration;

  const place = (
    parent: THREE.Object3D,
    id: PropModelId,
    name: string,
    specs: readonly KitPlacement[],
    hideNames: readonly string[] = [],
    customMat?: (asset: PropModelAsset) => THREE.Material,
  ): void => {
    void loadPropModel(id).then((asset) => {
      if (!asset || generation !== interiorGeneration || specs.length === 0) return;
      const mat = customMat ? customMat(asset) : asset.material;
      const mesh = new THREE.InstancedMesh(asset.geometry, mat, specs.length);
      const transform = new THREE.Object3D();
      const color = new THREE.Color();
      specs.forEach((spec, index) => {
        const s = spec.scale ?? 1;
        transform.position.set(spec.x, spec.y ?? 0, spec.z);
        transform.rotation.set(0, spec.yaw ?? 0, 0);
        transform.scale.set(s, s, s);
        transform.updateMatrix();
        mesh.setMatrixAt(index, transform.matrix);
        const jitter = spec.tintScalar ?? (1 + (((index * 5) % 5) - 2) * 0.018);
        mesh.setColorAt(index, color.setScalar(jitter));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.name = name;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      parent.add(mesh);
      interiorPropMeshes.push(mesh);
      for (const target of hideNames) {
        const node = root.getObjectByName(target);
        if (node) node.visible = false;
      }
    });
  };

  // 1. 2F 教室双人倒角暖木课桌 + 微弧胶合板弯管课椅（非交互椅带极微自然错位）
  const seatInteractiveCoords = new Set(INTERIOR_LOCATIONS.seats.map((s) => `${s.x}:${s.z}`));
  place(
    root,
    'schoolDeskUnit',
    'school-desk-unit-props',
    DESKS_2F.map(({ x, z }) => ({ x, y: FLOOR2_Y, z, yaw: 0 })),
    ['desk-wood-tops', 'desk-book-boxes', 'desk-chair-legs'],
  );
  place(
    root,
    'schoolChairUnit',
    'school-chair-unit-props',
    DESKS_2F.map(({ x, z }, i) => {
      const isSpecial = (x === -7 && z === 4) || seatInteractiveCoords.has(`${x}:${z + 0.75}`);
      const yawJitter = isSpecial ? 0 : ((i % 3) - 1) * 0.04;
      return { x, y: FLOOR2_Y, z: z + 0.74, yaw: yawJitter };
    }),
    ['chair-wood-parts'],
  );

  // 2. 2F 教室斜顶围边讲桌（置于 0.16m 讲台地台上）
  place(
    root,
    'schoolPodium',
    'school-podium-props',
    [{ x: -4.5, y: FLOOR2_Y + 0.16, z: -7.65, yaw: 0, tintScalar: 1 }],
    ['podium', 'podium-top-slope'],
  );

  // 3. 1F/2F 走廊与玄关八门百叶矮柜
  const lowLockerSpecs: KitPlacement[] = [
    ...CORRIDOR_LAYOUT.f1LowLockersZ.map((z) => ({ x: 1.325, y: FLOOR1_Y, z, yaw: Math.PI / 2 })),
    ...CORRIDOR_LAYOUT.f2LowLockersZ.map((z) => ({ x: 1.325, y: FLOOR2_Y, z, yaw: Math.PI / 2 })),
    { x: 9.42, y: FLOOR1_Y, z: 6.55, yaw: -Math.PI / 2 },
    { x: 9.42, y: FLOOR1_Y, z: 7.98, yaw: -Math.PI / 2 },
  ];
  place(
    root,
    'schoolLowLocker',
    'school-low-locker-props',
    lowLockerSpecs,
    ['f1-corridor-locker-fallback', 'f2-corridor-locker-fallback', 'f1-shoe-locker-fallback'],
  );

  // 4. 走廊柜顶、教室桌边挂钩与后排书包格内的通勤书包（高度严格低于 1.25m 走廊窗台）
  const backpackSpecs: KitPlacement[] = [
    { x: 1.33, y: FLOOR1_Y + 0.9, z: -8.05, yaw: 1.38 },
    { x: 1.33, y: FLOOR1_Y + 0.9, z: 2.65, yaw: 1.76 },
    { x: 1.33, y: FLOOR2_Y + 0.9, z: -2.84, yaw: 1.44 },
    { x: 1.33, y: FLOOR2_Y + 0.9, z: 2.74, yaw: 1.72 },
    // 教室后墙开放式书包柜内自然摆放
    { x: -6.26, y: FLOOR2_Y + 0.105, z: 8.58, yaw: Math.PI - 0.16 },
    { x: -3.6, y: FLOOR2_Y + 0.545, z: 8.58, yaw: Math.PI + 0.12 },
    // 靠窗课桌侧钩挂包
    { x: -7.68, y: FLOOR2_Y + 0.34, z: -2.02, yaw: -Math.PI / 2 },
  ];
  place(root, 'schoolBackpack', 'school-backpack-props', backpackSpecs);

  // 5. 双门铁皮百叶储物高柜
  place(
    root,
    'schoolTallLocker',
    'school-tall-locker-props',
    [
      { x: 4.65, y: FLOOR1_Y, z: -7.25, yaw: -Math.PI / 2 },
      { x: 4.65, y: FLOOR2_Y, z: -7.25, yaw: -Math.PI / 2 },
      { x: -8.35, y: FLOOR2_Y, z: 8.52, yaw: Math.PI },
    ],
    ['f1-corridor-tall-locker-fallback', 'f2-corridor-tall-locker-fallback', 'class-back-locker-fallback'],
  );

  // 6. 45°斜拼木框墨绿绒布公告栏（带立体课程表、海报、折角通知与图钉）
  place(
    root,
    'schoolBulletin',
    'school-bulletin-props',
    [
      ...CORRIDOR_LAYOUT.f1BulletinsZ.map((z) => ({ x: 1.142, y: FLOOR1_Y + 1.32, z, yaw: Math.PI / 2 })),
      ...CORRIDOR_LAYOUT.f2BulletinsZ.map((z) => ({ x: 1.142, y: FLOOR2_Y + 1.32, z, yaw: Math.PI / 2 })),
    ],
    ['f1-corridor-bulletin-fallback', 'f2-corridor-bulletin-fallback'],
  );

  // 7. 壁挂前倾圆形网罩校园广播音箱
  place(
    root,
    'schoolSpeaker',
    'school-speaker-props',
    [
      { x: 1.19, y: FLOOR1_Y + 2.82, z: -6.15, yaw: Math.PI / 2 },
      { x: 1.19, y: FLOOR1_Y + 2.82, z: 3.35, yaw: Math.PI / 2 },
      { x: 1.19, y: FLOOR2_Y + 2.82, z: -3.35, yaw: Math.PI / 2 },
      { x: 1.19, y: FLOOR2_Y + 2.82, z: 3.35, yaw: Math.PI / 2 },
      { x: -8.25, y: FLOOR2_Y + 2.94, z: -8.81, yaw: 0 },
      { x: 9.81, y: LANDING_Y + 2.48, z: -8.25, yaw: -Math.PI / 2 },
    ],
    [
      'f1-corridor-speaker-fallback',
      'f2-corridor-speaker-fallback',
      'class-front-speaker-fallback',
      'landing-speaker-fallback',
    ],
  );

  // 8. 1F 辅导员胡桃木办公桌组合（含黄铜台灯、窄边显示器与文件夹）+ 上玻下铁档案文件柜
  place(
    root,
    'schoolOfficeDesk',
    'school-office-desk-props',
    OFFICE_DESKS_1F.map(({ x, z, yaw }) => ({ x, y: FLOOR1_Y, z, yaw })),
    ['office-desks-fallback'],
  );
  place(
    root,
    'schoolFileCabinet',
    'school-file-cabinet-props',
    [-6.4, -5.45, -4.5, -3.55, -2.6].map((x) => ({ x, y: FLOOR1_Y, z: -8.55, yaw: 0 })),
    ['office-cabinets-fallback'],
  );

  // 9. 窗外庭院 A/B/C 三型阔叶香樟树（穿冠枝杈 + 透天空洞 + 异相风摆，挂载于 window-greenery 随日夜显隐）
  const treesA = COURTYARD_TREES.filter((t) => t.variant === 'A');
  const treesB = COURTYARD_TREES.filter((t) => t.variant === 'B');
  const treesC = COURTYARD_TREES.filter((t) => t.variant === 'C');
  let loadedTreeVariants = 0;
  const hideFallbackTreesWhenReady = (): void => {
    loadedTreeVariants += 1;
    if (loadedTreeVariants >= 3) {
      for (const name of ['garden-tree-trunks-fallback', 'garden-tree-foliage-fallback']) {
        const node = garden.getObjectByName(name);
        if (node) node.visible = false;
      }
    }
  };
  const mountTreeVariant = (id: PropModelId, key: string, list: readonly CourtyardTreeSpec[]): void => {
    void loadPropModel(id).then((asset) => {
      if (!asset || generation !== interiorGeneration || list.length === 0) return;
      const windMat = createTreeWindMaterial(asset.material, windTime, key);
      const mesh = new THREE.InstancedMesh(asset.geometry, windMat, list.length);
      const transform = new THREE.Object3D();
      const color = new THREE.Color();
      list.forEach((spec, idx) => {
        transform.position.set(spec.x, 0.04, spec.z);
        transform.rotation.set(0, spec.yaw, 0);
        transform.scale.set(spec.scale, spec.scale, spec.scale);
        transform.updateMatrix();
        mesh.setMatrixAt(idx, transform.matrix);
        mesh.setColorAt(idx, color.setScalar(0.97 + (idx % 3) * 0.03));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.name = `school-tree-${key}-props`;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      garden.add(mesh);
      interiorPropMeshes.push(mesh);
      hideFallbackTreesWhenReady();
    });
  };
  mountTreeVariant('schoolTreeA', 'a', treesA);
  mountTreeVariant('schoolTreeB', 'b', treesB);
  mountTreeVariant('schoolTreeC', 'c', treesC);
}

interface PoseSnapshot { object: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }
const poses = new WeakMap<THREE.Object3D, PoseSnapshot[]>();
function resetPose(actor: THREE.Object3D): void {
  for (const p of poses.get(actor) ?? []) {
    p.object.position.copy(p.position); p.object.quaternion.copy(p.quaternion); p.object.scale.copy(p.scale);
  }
  actor.traverse((node) => {
    if (node instanceof THREE.Mesh && node.morphTargetInfluences && node.morphTargetInfluences.length > 0) {
      node.morphTargetInfluences[0] = 0;
    }
  });
  poses.delete(actor);
}

/** 转动实例骨骼，不改共享网格或动画剪辑；适配真实模型的原生轴向。 */
function poseActor(actor: THREE.Object3D, seated: boolean, phone: boolean): void {
  resetPose(actor);
  // 必须先刷新外层 actor 的世界矩阵，防止刚设完 actor.rotation 后首条大腿读取到旧朝向矩阵导致双腿前后劈叉！
  actor.updateWorldMatrix(true, true);
  const saved: PoseSnapshot[] = [];
  const remember = (object: THREE.Object3D): void => {
    if (!saved.some((p) => p.object === object)) {
      saved.push({
        object,
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone(),
      });
    }
  };
  poses.set(actor, saved);
  const model = findActorModelRoot(actor);
  const aim = (name: string, tipName: string, direction: THREE.Vector3): void => {
    const bone = actor.getObjectByName(name);
    const tip = actor.getObjectByName(tipName);
    if (!bone || !tip || !bone.parent) return;
    remember(bone);
    actor.updateWorldMatrix(true, true);
    const current = tip.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
    const rotation = new THREE.Quaternion().setFromUnitVectors(current, direction.normalize())
      .multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
  };
  if (model && seated) {
    const forwardDir = new THREE.Vector3(0, -0.08, 1).transformDirection(actor.matrixWorld);
    const downDir = new THREE.Vector3(0, -1, 0.08).transformDirection(actor.matrixWorld);
    const toeDir = new THREE.Vector3(0, -0.05, 1).transformDirection(actor.matrixWorld);
    for (const side of ['L', 'R']) {
      aim(`${side}_Thigh`, `${side}_Calf`, forwardDir);
      aim(`${side}_Calf`, `${side}_Foot`, downDir);
      aim(`${side}_Foot`, `${side}_ToeBase`, toeDir);
    }
    const hip = actor.getObjectByName('Hip');
    const pose = actor.getObjectByName('actor-pose');
    if (hip && pose) {
      actor.updateWorldMatrix(true, true);
      const localHip = actor.worldToLocal(hip.getWorldPosition(new THREE.Vector3()));
      remember(pose);
      pose.position.y += 0.62 - localHip.y;
    }
    actor.traverse((node) => {
      if (node instanceof THREE.Mesh && node.morphTargetInfluences && node.morphTargetInfluences.length > 0) {
        node.morphTargetInfluences[0] = 1;
      }
    });
  }
  if (model && (phone || seated)) {
    // 角色面向本地 +Z 时，左手 L 在本地 +X、右手 R 在本地 -X（避免双手交叉拧麻花）
    for (const [side, signVal] of [['L', 1], ['R', -1]] as const) {
      const upper = actor.getObjectByName(`${side}_Upperarm`);
      const lower = actor.getObjectByName(`${side}_Forearm`);
      const hand = actor.getObjectByName(`${side}_Hand`);
      if (!upper || !lower || !hand) continue;
      actor.updateWorldMatrix(true, true);
      const shoulder = upper.getWorldPosition(new THREE.Vector3());
      const elbow = lower.getWorldPosition(new THREE.Vector3());
      const wrist = hand.getWorldPosition(new THREE.Vector3());
      const lengthA = shoulder.distanceTo(elbow);
      const lengthB = elbow.distanceTo(wrist);
      const prop = actor.getObjectByName('actor-props')?.children[0];
      const target = seated
        ? actor.localToWorld(new THREE.Vector3(signVal * 0.14, 0.8, 0.53))
        : prop
          ? prop.getWorldPosition(new THREE.Vector3()).add(
            new THREE.Vector3(signVal * 0.045, -0.035, 0).transformDirection(actor.matrixWorld).multiplyScalar(0.04),
          )
          : actor.localToWorld(new THREE.Vector3(signVal * 0.06, 1.17, 0.24));
      const direction = target.clone().sub(shoulder).normalize();
      const distance = Math.max(0.001, Math.min(shoulder.distanceTo(target), lengthA + lengthB - 0.001));
      const along = (lengthA * lengthA - lengthB * lengthB + distance * distance) / (2 * distance);
      const bend = new THREE.Vector3(signVal, -0.6, 0).transformDirection(actor.matrixWorld);
      bend.addScaledVector(direction, -bend.dot(direction)).normalize();
      const desiredElbow = shoulder.clone().addScaledVector(direction, along)
        .addScaledVector(bend, Math.sqrt(Math.max(0, lengthA * lengthA - along * along)));
      aim(`${side}_Upperarm`, `${side}_Forearm`, desiredElbow.sub(shoulder));
      actor.updateWorldMatrix(true, true);
      aim(`${side}_Forearm`, `${side}_Hand`, target.sub(lower.getWorldPosition(new THREE.Vector3())));
    }
    const head = actor.getObjectByName('Head');
    if (head) { remember(head); head.rotateX(0.12); }
  }
  const fallback = actor.getObjectByName('actor-fallback');
  if (fallback && seated) {
    const body = fallback.children[0];
    const head = fallback.children[1];
    if (body && head) {
      remember(body); remember(head);
      body.scale.y = 0.43; body.position.y = 0.9; head.position.y = 1.3;
    }
  }
  const legs = actor.getObjectByName('seated-fallback-legs');
  if (legs) legs.visible = seated && !model;
}

function releaseInteriorKitMeshes(): void {
  for (const mesh of interiorPropMeshes) mesh.dispose();
  interiorPropMeshes.length = 0;
  for (const mat of interiorOwnedMaterials) mat.dispose();
  interiorOwnedMaterials.length = 0;
}

function buildSchoolInterior(parent: THREE.Object3D) {
  interiorGeneration += 1;
  releaseInteriorKitMeshes();
  const root = group(parent, 'school-interior');
  const windTime = { value: 0 };
  root.userData.windTime = windTime;
  const d = details();
  const occluders: THREE.Object3D[] = [];
  const { fill, sunKey, sunset, garden, beams } = architecture(root, d, occluders, windTime);
  const sketch = buildClassroom2F(root, d, occluders, windTime);
  buildFloor1Rooms(root, d, occluders);
  mountSchoolKitProps(root, garden, windTime);

  const actors: Record<string, THREE.Object3D> = {
    'interior-root': root,
    'interior-fill': fill,
    'interior-sun-key': sunKey,
    'interior-sunset': sunset,
    'window-greenery': garden,
    'corridor-light-beams': beams,
    'linxia-sketchbook': sketch,
  };

  const create = (id: CharacterModelId, name: string, phoneColor?: number): THREE.Group => {
    const entry = getCharacterModel(id);
    const actor = createCharacterActor(id, entry.heightM, id === 'linxia' ? 0xa0afa5 : id === 'volunteer' ? 0xb08a72 : 0x9ca6b2, {
      castShadow: false,
      props: phoneColor === undefined ? [] : [{ kind: 'phone', color: phoneColor }],
    });
    actor.name = name;
    actor.visible = false;
    root.add(actor);
    actors[name] = actor;
    const geometry = new THREE.PlaneGeometry(0.72, 0.64);
    const material = new THREE.MeshBasicMaterial({ color: 0x2c302e, transparent: true, opacity: 0.14, depthWrite: false });
    const contact = new THREE.Mesh(geometry, material);
    contact.name = 'actor-contact-shade';
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.008;
    actor.add(contact);
    const release = (): void => {
      const skeletons = new Set<THREE.Skeleton>();
      actor.traverse((node) => { if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton); });
      skeletons.forEach((skeleton) => skeleton.dispose());
      resetPose(actor);
      geometry.removeEventListener('dispose', release);
    };
    geometry.addEventListener('dispose', release);
    return actor;
  };

  const linxia = create('linxia', 'linxia', 0x889994);
  const legs = group(linxia, 'seated-fallback-legs');
  for (const x of [-0.12, 0.12]) {
    d.box(legs, 'seated-thigh', [x, 0.57, 0.18], [0.15, 0.16, 0.4], 0x66736e);
    d.box(legs, 'seated-calf', [x, 0.27, 0.34], [0.13, 0.48, 0.14], 0x66736e);
  }
  legs.visible = false;

  const ayuan = create('ayuan', 'ayuan', ORANGE);
  actors['student-4'] = ayuan;

  // 1F 辅导员办公室周老师
  create('volunteer', 'teacher');

  for (let i = 0; i < INTERIOR_LOCATIONS.students.length; i += 1) {
    if (i === 3) continue;
    const spec = INTERIOR_LOCATIONS.students[i];
    create(
      spec.modelId,
      spec.id,
      [0x627b87, 0x998b83, 0x87957e, ORANGE, 0x665d6b, 0x555f65][i],
    );
  }

  const hint = new THREE.PointLight(0xffb46e, 0, 1.6, 2);
  hint.name = 'orange-phone-hint';
  hint.position.set(0.02, 1.18, 0.29);
  ayuan.add(hint);
  actors['orange-phone-hint'] = hint;

  const screen = d.box(ayuan, 'orange-phone-screen', [0.02, 1.1928, 0.216], [0.066, 0.13, 0.003], ORANGE);
  screen.visible = false;
  const screenMaterial = screen.material as THREE.MeshStandardMaterial;
  screenMaterial.emissive.setHex(0xffbe78);
  screenMaterial.emissiveIntensity = 0.08;
  actors['orange-phone-screen'] = screen;

  return { occluders, actors };
}

interface StudentAnimState {
  actor: THREE.Object3D;
  clips: readonly string[];
  controller: CharacterAnimationController | null;
  clipIndex: number;
  timer: number;
  switchSec: number;
}

interface Session {
  context: SceneRuntimeContext;
  scene: InteriorScene;
  unsubscribe: Array<() => void>;
  models: Map<THREE.Object3D, THREE.Object3D | null>;
  rotations: Map<THREE.Object3D, number>;
  phases: Map<THREE.Object3D, number>;
  studentAnims: Map<THREE.Object3D, StudentAnimState>;
  windTime: { value: number } | null;
  time: number;
  noticed: boolean;
}
let session: Session | null = null;

function studentVisibility(current: Session, ids: readonly string[] = []): void {
  if (session !== current) return;
  for (const { id } of INTERIOR_LOCATIONS.students) current.context.setInteractableVisible(id, ids.includes(id));
}

function glow(current: Session): void {
  const hint = current.context.actors['orange-phone-hint'];
  const screen = current.context.actors['orange-phone-screen'];
  const night = current.scene === 'C6';
  const noticed = current.scene === 'C5' && current.noticed;
  if (hint instanceof THREE.PointLight) {
    hint.intensity = night ? 0.34 : noticed ? 0.09 : 0;
    hint.visible = hint.intensity > 0;
  }
  if (screen instanceof THREE.Mesh) {
    (screen.material as THREE.MeshStandardMaterial).emissiveIntensity = night ? 0.92 : noticed ? 0.32 : 0.08;
  }
}

function syncStudentAnimation(state: StudentAnimState, dt: number): boolean {
  if (state.clips.length === 0) return false;
  if (!state.controller) {
    const controller = createActorAnimation(state.actor);
    if (!controller) return false;
    const available = state.clips.filter((clip) => controller.hasAnimation(clip));
    if (available.length === 0) {
      controller.dispose();
      return false;
    }
    state.controller = controller;
    state.clips = available;
    state.clipIndex = 0;
    state.timer = 0;
    resetPose(state.actor);
    const props = state.actor.getObjectByName('actor-props');
    if (props) props.visible = false;
    controller.play(available[0], { fadeIn: 0.3, timeScale: 0.86, loop: true });
    controller.update(dt);
    return true;
  }
  if (state.clips.length > 1 && dt > 0) {
    state.timer += dt;
    if (state.timer >= state.switchSec) {
      state.timer = 0;
      state.clipIndex = (state.clipIndex + 1) % state.clips.length;
      state.controller.play(state.clips[state.clipIndex], { fadeIn: 0.45, timeScale: 0.86, loop: true });
    }
  }
  state.controller.update(dt);
  return true;
}

function clearRuntime(): void {
  const current = session;
  if (!current) return;
  studentVisibility(current);
  session = null;
  current.unsubscribe.forEach((off) => off());
  for (const state of current.studentAnims.values()) state.controller?.dispose();
  current.studentAnims.clear();
  for (const [actor, z] of current.rotations) {
    actor.rotation.z = z;
    resetPose(actor);
  }
}

export const schoolInteriorRuntime: SceneRuntime = {
  enter(context): void {
    if (session?.context === context && session.scene === context.sceneId) return;
    clearRuntime();
    if (!SCENES.includes(context.sceneId as InteriorScene)) return;
    const scene = context.sceneId as InteriorScene;
    const root = context.actors['interior-root'];
    const windTime = (root?.userData.windTime as { value: number } | undefined) ?? null;
    const current: Session = {
      context, scene, unsubscribe: [], models: new Map(), rotations: new Map(), phases: new Map(),
      studentAnims: new Map(), windTime, time: 0, noticed: context.storyFlags?.noticedTyper ?? false,
    };
    session = current;
    studentVisibility(current);

    let phaseCounter = 0;
    const place = (
      name: string,
      location: { x: number; y: number; z: number },
      yaw = -Math.PI / 2,
      animClips: readonly string[] = [],
      switchSec = 7.5,
      holdPhone?: boolean,
    ): void => {
      const actor = context.actors[name];
      if (!actor) return;
      actor.visible = true;
      actor.position.set(location.x, location.y, location.z);
      actor.rotation.set(0, yaw, 0);
      const seated = name === 'linxia' && scene === 'C2';
      // 仅 C4 林夏在楼梯间手持电话需要保留道具手机，阿远及走廊群演不再显示悬空方块手机
      const wantsPhone = holdPhone ?? (name === 'linxia' && !seated);
      const props = actor.getObjectByName('actor-props');
      if (props) props.visible = wantsPhone;
      let animated = false;
      if (animClips.length > 0) {
        const animState: StudentAnimState = {
          actor, clips: animClips, controller: null, clipIndex: 0, timer: 0, switchSec,
        };
        current.studentAnims.set(actor, animState);
        animated = syncStudentAnimation(animState, 0);
      }
      if (!animated) poseActor(actor, seated, wantsPhone);
      current.models.set(actor, findActorModelRoot(actor)?.root ?? null);
      current.rotations.set(actor, actor.rotation.z);
      current.phases.set(actor, phaseCounter * 1.37);
      phaseCounter += 1;
    };

    for (const name of ['linxia', 'ayuan', 'teacher', ...INTERIOR_LOCATIONS.students.map(({ id }) => id)]) {
      const actor = context.actors[name];
      if (actor) actor.visible = false;
    }
    if (context.actors['linxia-sketchbook']) context.actors['linxia-sketchbook'].visible = scene === 'C2';

    if (scene === 'C2') place('linxia', INTERIOR_LOCATIONS.linxiaDesk, Math.PI, [], 7.5, false);
    if (scene === 'C3') {
      place('teacher', INTERIOR_LOCATIONS.teacherOfficeActor, 0.72, ['wait', 'agree'], 8.4, false);
    }
    if (scene === 'C4') place('linxia', INTERIOR_LOCATIONS.stairwellActor, -Math.PI / 2);
    if (scene === 'C5') {
      INTERIOR_LOCATIONS.students.forEach((student, index) => {
        place(student.id, student, student.yaw, student.clips, 7.2 + index * 0.85);
      });
    }
    if (scene === 'C6') place('ayuan', INTERIOR_LOCATIONS.stairwellActor, -Math.PI / 2);
    if (scene === 'D1') place('ayuan', INTERIOR_LOCATIONS.platformActor, -Math.PI / 2);
    if (scene === 'D6') {
      place('linxia', INTERIOR_LOCATIONS.corridorLinxia, -Math.PI / 2);
      place('ayuan', INTERIOR_LOCATIONS.corridorAyuan, -Math.PI / 2);
      if (context.actors.ayuan) context.actors.ayuan.visible = context.storyFlags?.joined ?? false;
    }

    // 氛围光照（P0-02 修复：柔和清晨/午后基准 + 克制夕照，移除过曝 22 强度点光与呼吸闪烁光斑）
    const fill = context.actors['interior-fill'];
    const sunKey = context.actors['interior-sun-key'];
    const sunset = context.actors['interior-sunset'];
    const night = scene === 'C6';
    const evening = scene === 'D1' || scene === 'D6';
    if (fill instanceof THREE.HemisphereLight) {
      fill.color.setHex(night ? 0x4d6996 : evening ? 0x9eb0ce : 0xaac2d8);
      fill.groundColor.setHex(night ? 0x1c2638 : evening ? 0x6a5c5c : 0x5c636b);
      fill.intensity = night ? 0.3 : evening ? 0.72 : 0.88;
    }
    if (sunKey instanceof THREE.DirectionalLight) {
      sunKey.color.setHex(night ? 0x486490 : evening ? 0xffa663 : 0xffd9a4);
      sunKey.intensity = night ? 0.14 : evening ? 1.24 : 1.02;
      sunKey.position.set(scene === 'C2' ? -14 : 14, scene === 'C2' ? 10.2 : 11, scene === 'C2' ? 1.5 : 4);
    }
    if (sunset instanceof THREE.PointLight) {
      sunset.intensity = evening ? 5.2 : 0;
      sunset.visible = sunset.intensity > 0;
    }
    const officeLamp = root?.getObjectByName('teacher-desk-lamp-light');
    if (officeLamp) officeLamp.visible = scene === 'C2' || scene === 'C4';
    if (context.actors['window-greenery']) context.actors['window-greenery'].visible = !night;
    const beamsGroup = context.actors['corridor-light-beams'];
    if (beamsGroup) {
      beamsGroup.visible = !night;
      beamsGroup.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
          child.material.color.setHex(evening ? 0xffb370 : 0xffdfa8);
          child.material.opacity = child.name === 'corridor-sun-patches'
            ? (evening ? 0.24 : 0.18)
            : (evening ? 0.08 : 0.055);
        }
      });
    }
    glow(current);

    const active = (): boolean => session === current;
    if (scene === 'C2') {
      const setSeatsVisible = (visible: boolean): void => {
        for (const seat of INTERIOR_LOCATIONS.seats) context.setInteractableVisible(seat.id, visible);
      };
      setSeatsVisible(false);
      current.unsubscribe.push(context.bus.on('ui:c2SeatReady', ({ sceneId }) => {
        if (active() && sceneId === 'C2') setSeatsVisible(true);
      }));
    }
    current.unsubscribe.push(context.bus.on('state:changed', (event) => {
      if (!active() || event.sceneId !== scene) return;
      current.noticed = event.state.noticedTyper;
      if (scene === 'D6' && context.actors.ayuan) context.actors.ayuan.visible = event.state.joined;
      glow(current);
    }));
    if (scene !== 'C5') return;
    const hide = (): void => { if (active()) studentVisibility(current); };
    current.unsubscribe.push(context.bus.on('ui:showChoices', ({ stepId, options }) => {
      if (active()) studentVisibility(current, stepId === 'c5-recognize' ? options.map(({ id }) => id) : []);
    }));
    for (const event of [
      'ui:showPhone', 'ui:showDialogue', 'ui:showArt', 'ui:showMinigame',
      'ui:showIntertitle', 'scene:cutscene', 'scene:transition',
    ] as const) {
      current.unsubscribe.push(context.bus.on(event, hide));
    }
  },
  tick(dtSeconds): void {
    if (!session || !Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    const dt = Math.min(dtSeconds, 0.1);
    session.time += dt;
    if (session.windTime) session.windTime.value += dt;
    for (const [actor, base] of session.rotations) {
      const root = findActorModelRoot(actor)?.root ?? null;
      const animState = session.studentAnims.get(actor);
      if (root !== session.models.get(actor)) {
        session.models.set(actor, root);
        if (animState) {
          animState.controller?.dispose();
          animState.controller = null;
        }
        const animated = animState ? syncStudentAnimation(animState, 0) : false;
        if (!animated) {
          const isSeated = actor === session.context.actors.linxia && session.scene === 'C2';
          const isTeacher = actor === session.context.actors.teacher;
          poseActor(actor, isSeated, !isSeated && !isTeacher);
        }
      } else if (animState && actor.visible) {
        syncStudentAnimation(animState, dt);
      }
      if (actor.visible) {
        const phase = session.phases.get(actor) ?? 0;
        actor.rotation.z = base + Math.sin(session.time * 1.45 + phase) * 0.0025;
      }
    }
  },
  exit(): void {
    interiorGeneration += 1;
    releaseInteriorKitMeshes();
    clearRuntime();
  },
};

export function createSchoolInteriorDefinition(sceneId: SceneId): WorldSceneDefinition {
  if (!SCENES.includes(sceneId as InteriorScene)) throw new Error(`教学楼不支持场景：${sceneId}`);
  const scene = sceneId as InteriorScene;
  const zone = scene === 'C4' ? { id: 'stairwell-corner', ...INTERIOR_LOCATIONS.stairwell }
    : scene === 'C6' ? { id: 'night-phone', ...INTERIOR_LOCATIONS.stairwell }
      : scene === 'D1' ? { id: 'platform-ayuan', ...INTERIOR_LOCATIONS.platform }
        : scene === 'D6' ? { id: 'corridor-linxia', ...INTERIOR_LOCATIONS.corridor } : null;

  return {
    sceneKey: 'interior',
    spawn: { ...INTERIOR_LOCATIONS.spawns[scene] },
    nav: navigation(scene),
    requiredModels: [...MODELS],
    footstepSurface: 'stone',
    build: buildSchoolInterior,
    interactables: scene === 'C2'
      ? INTERIOR_LOCATIONS.seats.map(({ id, x, y, z }) => ({
        id, position: { x, y, z }, lightOffsetY: 0.6, maxDistance: 2.8, hitRadius: 0.3,
      }))
      : scene === 'C3'
        ? [{
          id: 'teacher-office-door',
          position: { ...INTERIOR_LOCATIONS.teacherOfficeDoor },
          lightOffsetY: 0.25,
          maxDistance: 3.2,
          hitRadius: 0.55,
        }]
        : scene === 'C5'
          ? INTERIOR_LOCATIONS.students.map(({ id, x, y, z, lightOffset }) => ({
            id,
            position: { x: x + lightOffset.x, y: y + 1.1, z: z + lightOffset.z },
            lightOffsetY: 0.3,
            maxDistance: 2.8,
            hitRadius: 0.28,
          }))
          : [],
    zones: zone
      ? [{ id: zone.id, kind: 'circle', center: { x: zone.x, y: zone.y, z: zone.z }, radius: 1.0, once: true }]
      : [],
    targetGuides: scene === 'C3'
      ? [{
        id: 'teacher-office-door',
        position: {
          x: INTERIOR_LOCATIONS.teacherOfficeDoor.x,
          y: INTERIOR_LOCATIONS.teacherOfficeDoor.y + 0.35,
          z: INTERIOR_LOCATIONS.teacherOfficeDoor.z,
        },
      }]
      : zone
        ? [{ id: zone.id, position: { x: zone.x, y: zone.y + 0.85, z: zone.z } }]
        : [],
    fog: scene === 'C6'
      ? { color: 0x202b3d, near: 10, far: 38 }
      : scene === 'D1' || scene === 'D6'
        ? { color: 0xc8aa95, near: 16, far: 54 }
        : { color: 0xc7ccd0, near: 16, far: 54 },
    panoramaAnchor: scene === 'D1'
      ? {
        position: { x: 6.7, y: FLOOR2_Y + 1.54, z: 5.45 },
        lookAt: { x: INTERIOR_LOCATIONS.platformActor.x, y: FLOOR2_Y + 1.35, z: INTERIOR_LOCATIONS.platformActor.z },
      }
      : undefined,
  };
}

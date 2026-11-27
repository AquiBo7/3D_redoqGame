// world/worldSceneTypes.ts —— 3D 场景的配置化接口
// S1–S9 的独立场景文件只需导出一个 WorldSceneDefinition，即可接入控制器与交互系统。
// 纯类型 + 数据契约，不包含运行时逻辑。

import type * as THREE from 'three';
import type { EventBus } from '../core/eventBus';
import type { SceneId, SceneKey } from '../data/storySchema';
import type { CharacterModelId } from '../scenes3d/modelManifest';
import type { GroundSurface, ObstacleAabb, WalkBounds } from './navMath';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface SceneSpawn {
  x: number;
  z: number;
  /**
   * 出生脚底高度（米）。多层场景必须填写（如 2F 走廊 3.8）；
   * 缺省时取该 (x, z) 处采样到的地面高度，单层场景可不填。
   */
  y?: number;
  /** 水平朝向（弧度），0 表示面向 -Z */
  yaw?: number;
  /** 初始俯仰角（度），负值为略微俯视 */
  pitchDeg?: number;
}

export interface NavigationConfig {
  /**
   * 单个矩形或多矩形并集（L 型路线等）。
   * 多层建筑：给每个矩形填 minY / maxY，即可为 1F 与 2F 定义不同的可行走轮廓；不填表示全高有效。
   */
  bounds: WalkBounds;
  /** 障碍物同理可填 minY / maxY，只在玩家身体与该高度带相交时参与碰撞 */
  obstacles: ObstacleAabb[];
  /** 地面高度，默认 0 */
  groundY?: number;
  /** 可行走表面；height + slopeX / slopeZ 定义平台与坡道，多层场景靠连续高度采样衔接 */
  surfaces?: GroundSurface[];
}

export interface InteractableConfig {
  id: string;
  /** 物体锚点（世界坐标），光点会悬浮在其上方 */
  position: Point3;
  /** 光点相对锚点的悬浮高度，默认 0.55 米 */
  lightOffsetY?: number;
  /** 点击判定球半径，默认 0.35 米 */
  hitRadius?: number;
  /** 点击 / 锁定左键的最远交互距离，默认 3.5 米 */
  maxDistance?: number;
}

export interface HotspotConfig {
  id: string;
  position: Point3;
  maxDistance?: number;
  maxAngleDeg?: number;
  dwellMs?: number;
  /** 是否要求视线无遮挡，默认 true */
  requireLineOfSight?: boolean;
}

export type ZoneConfig =
  | {
      id: string;
      kind: 'box';
      center: Point3;
      /** 盒形区域完整尺寸 */
      size: Point3;
      /** 默认 true，只触发一次 */
      once?: boolean;
    }
  | {
      id: string;
      kind: 'circle';
      center: Point3;
      radius: number;
      once?: boolean;
    };

export interface SceneLightingSettings {
  sunDirection: readonly [number, number, number];
  sunColor: number;
  sunIntensity: number;
  ambientColor: number;
  ambientIntensity: number;
}

export interface ExitAnchor {
  position: Point3;
  stopDistance: number;
  preparationMs?: number;
}

export interface TargetGuideConfig {
  id: string;
  position: Point3;
}

export interface WorldSceneBuildResult {
  /** 会遮挡交互光点的墙体 / 障碍物网格 */
  occluders: THREE.Object3D[];
  /** 场景专属演出需要引用的动态对象（胶囊体演员、可隐藏道具等），按名字取用 */
  actors?: Record<string, THREE.Object3D>;
}

export interface SceneFog {
  color: number;
  near: number;
  far: number;
}

/** S6 开场 CG 的全景镜头锚点：过场相机缓动到 position 并始终 lookAt */
export interface PanoramaAnchor {
  position: Point3;
  lookAt: Point3;
}

/**
 * 场景运行时装（震动定时器、胶囊体演出、跟随路线等）。
 * 生命周期：sceneKey 变化或 runtime 实例变化时 exit()，进入新场景后 enter()。
 * 同一 sceneKey 的多个 sceneId 共享同一实例（S5/S6、S8/S9），enter 需按 sceneId 自行判断是否重启演出。
 */
export interface SceneRuntimeContext {
  sceneId: SceneId;
  bus: EventBus;
  actors: Record<string, THREE.Object3D>;
  storyFlags?: Readonly<{ noticedTyper: boolean; joined: boolean }>;
  /** 按 id 显示 / 隐藏交互光点（如捡起药袋后隐藏药袋光点） */
  setInteractableVisible: (id: string, visible: boolean) => void;
  /** 当前 2D 阻塞式界面（对话 / 选项 / 手机）是否打开，供场景演出等待对话结束后再启动 */
  isModalBlocked?: () => boolean;
  getPlayerFeet?: (target: THREE.Vector3) => THREE.Vector3;
  getViewYaw?: () => number;
  setViewYaw?: (yaw: number) => void;
  setScriptedLookLocked?: (locked: boolean) => void;
  isCinematic?: () => boolean;
  setAtmosphereProgress?: (progress: number) => void;
  setSceneLighting?: (settings: SceneLightingSettings | null) => void;
}

export interface SceneRuntime {
  enter(context: SceneRuntimeContext): void;
  /** 每帧驱动骨骼动画混合器等逐帧演出（dt 为秒，已夹紧上限） */
  tick?(dtSeconds: number): void;
  /** ?night=1：室外场景改由路灯等自发光体照明；缺省表示该场景没有夜态 */
  setNight?(enabled: boolean): void;
  /** 清理 timeline / tween / 定时器 / 订阅；离开场景与销毁时调用 */
  exit(): void;
}

export interface WorldSceneDefinition {
  sceneKey: SceneKey;
  spawn: SceneSpawn;
  nav: NavigationConfig;
  /**
   * 场景用到的角色模型：异 sceneKey 切图时在切图黑幕期间预载（带 4s 超时兜底）。
   * 首屏房间（S1–S3）为空数组 / 缺省，保证开始页与房间零角色 GLB 加载；
   * 预载失败时 shared.createCharacterActor 自动回退胶囊体，不阻塞进场景。
   */
  requiredModels?: readonly CharacterModelId[];
  interactables?: InteractableConfig[];
  hotspots?: HotspotConfig[];
  zones?: ZoneConfig[];
  targetGuides?: TargetGuideConfig[];
  exitAnchor?: ExitAnchor;
  footstepSurface?: 'wood' | 'stone';
  footstepActors?: readonly string[];
  /** 场景专属雾效；缺省时清除上一场景残留的雾 */
  fog?: SceneFog;
  /** S6 开场 CG 的全景锚点（gate 场景提供） */
  panoramaAnchor?: PanoramaAnchor;
  /**
   * 向关卡组挂载几何体；返回的 occluders 用于光点遮挡判定。
   * 可被多次调用（后续场景切换时旧内容会先被清理）。
   */
  build(parent: THREE.Object3D): WorldSceneBuildResult;
}

// world/worldConfig.ts —— 第一人称控制与交互的统一参数
// 所有速度、灵敏度、晃动幅度、交互距离集中在此，场景文件不得硬编码这些数值。

export interface BobConfig {
  /** 静止呼吸晃动幅度（米）与频率（Hz） */
  idleAmp: number;
  idleFreq: number;
  /** 走路晃动幅度与频率 */
  walkAmp: number;
  walkFreq: number;
  /** 小跑晃动幅度与频率 */
  sprintAmp: number;
  sprintFreq: number;
}

export interface FirstPersonConfig {
  /** 视线高度（米） */
  eyeHeight: number;
  /** 步行 / 小跑速度（米 / 秒） */
  walkSpeed: number;
  sprintSpeed: number;
  /** 鼠标锁定、触摸拖动、鼠标拖拽兜底的转动灵敏度（弧度 / 像素） */
  mouseSensitivity: number;
  touchSensitivity: number;
  dragSensitivity: number;
  /** 俯仰角限位（度） */
  pitchLimitDeg: number;
  /** 玩家碰撞半径（米） */
  playerRadius: number;
  /** 靠近多少米内可按 E 交互 */
  interactRange: number;
  /** 轻点判定：最大位移（像素）与最长按压时间（毫秒） */
  tapMaxMovePx: number;
  tapMaxDurationMs: number;
  /** 自动寻路被卡住：速度低于该值并持续超时后停止（米 / 秒、毫秒） */
  stuckSpeedThreshold: number;
  stuckTimeoutMs: number;
  /** 距寻路目标小于该距离即视为到达（米） */
  autoWalkStopDistance: number;
  /**
   * 轻点落点可接受的最大高差（米）：需大于楼梯单段高度、小于一个层高，
   * 使触屏既能在本层与梯段间寻路，也不会隔层点到楼下地面。
   */
  tapMaxHeightDelta: number;
  bob: BobConfig;
}

export const FIRST_PERSON_CONFIG: FirstPersonConfig = {
  eyeHeight: 1.6,
  walkSpeed: 2.1,
  sprintSpeed: 3.9,
  mouseSensitivity: 0.0036,
  touchSensitivity: 0.0042,
  dragSensitivity: 0.0045,
  pitchLimitDeg: 70,
  playerRadius: 0.32,
  interactRange: 1.8,
  tapMaxMovePx: 8,
  tapMaxDurationMs: 350,
  stuckSpeedThreshold: 0.15,
  stuckTimeoutMs: 350,
  autoWalkStopDistance: 0.08,
  tapMaxHeightDelta: 2.2,
  bob: {
    idleAmp: 0.006,
    idleFreq: 0.25,
    walkAmp: 0.02,
    walkFreq: 1.9,
    sprintAmp: 0.042,
    sprintFreq: 2.7,
  },
};

export interface InteractionConfig {
  /** E 键就近交互距离（米） */
  nearRange: number;
  /** 点击 / 锁定左键交互的默认最远距离（米），可被单个可交互物覆盖 */
  clickMaxDistance: number;
  gazeMaxDistance: number;
  gazeMaxAngleDeg: number;
  gazeDwellMs: number;
  /** 光点遮挡检测间隔（秒） */
  occlusionIntervalSec: number;
  /** 两次交互事件的最小间隔（毫秒），避免 E 与点击重复触发 */
  interactCooldownMs: number;
}

export const INTERACTION_CONFIG: InteractionConfig = {
  nearRange: FIRST_PERSON_CONFIG.interactRange,
  clickMaxDistance: 3.5,
  gazeMaxDistance: 8,
  gazeMaxAngleDeg: 10,
  gazeDwellMs: 2000,
  occlusionIntervalSec: 0.12,
  interactCooldownMs: 120,
};

/** 目标指引点避让的底部安全区（像素），大于等于 48px 红线 */
export const TARGET_GUIDE_BOTTOM_SAFE_PX = 56;
/** 目标指引点与屏幕左右 / 上边缘的间距（像素） */
export const TARGET_GUIDE_EDGE_MARGIN_PX = 28;

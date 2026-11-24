// world/navMath.ts —— 可行走区域与碰撞的纯数学函数
// 不依赖 three.js / DOM，便于在 node 环境单测。
//
// 坐标约定：地面为 XZ 平面，矩形以 min/max 表示；多矩形取并集作为可行走区域。
// 多层建筑：minY / maxY 为可选高度带，缺省即"全高有效"，单层场景的取值行为完全不变。

export interface Vec2 {
  x: number;
  z: number;
}

/** 玩家身体高度（米）：障碍物与触发区的垂直相交范围 */
export const PLAYER_BODY_HEIGHT = 1.75;

/** 身体中心相对脚底的高度（米） */
export const PLAYER_BODY_CENTER_OFFSET = 0.8;

/** 单步可吸附的最大高差（米）：超过即视为另一层楼，不做高度吸附 */
export const DEFAULT_MAX_STEP_HEIGHT = 0.65;

/** 高度带过滤容差（米）：吸收上下层衔接处与逐子步采样的数值抖动 */
const HEIGHT_BAND_TOLERANCE = 0.3;

/** 垂直范围；两个方向缺省都表示该方向不限 */
export interface HeightBand {
  minY?: number;
  maxY?: number;
}

export interface RectBounds extends HeightBand {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** 单个矩形，或多矩形并集（L 型拐弯路线等） */
export type WalkBounds = RectBounds | RectBounds[];

export interface GroundSurface extends RectBounds {
  /** 供场景与调试面板按名字取用（如 'floor-2f' / 'stair-run-a'） */
  id?: string;
  /** 表面在 (minX, minZ) 角点处的高度 */
  height: number;
  /** 南北向坡度：每 +1 米 Z 的高度变化（双跑楼梯的一段） */
  slopeZ?: number;
  /** 东西向坡度：每 +1 米 X 的高度变化（与 slopeZ 并存，支持横向折返楼梯） */
  slopeX?: number;
}

/** 竖直线段 [feetY, feetY + bodyHeight] 是否与高度带相交；全高带恒为真 */
export function intersectsHeightBand(band: HeightBand, feetY: number, bodyHeight = PLAYER_BODY_HEIGHT): boolean {
  if (band.minY === undefined && band.maxY === undefined) return true;
  const lower = band.minY ?? Number.NEGATIVE_INFINITY;
  const upper = band.maxY ?? Number.POSITIVE_INFINITY;
  return lower <= feetY + bodyHeight && upper >= feetY;
}

/** 脚底高度是否落在高度带内（含容差）；全高带恒为真 */
export function isHeightInBand(feetY: number, band: HeightBand, tolerance = HEIGHT_BAND_TOLERANCE): boolean {
  if (band.minY !== undefined && feetY < band.minY - tolerance) return false;
  if (band.maxY !== undefined && feetY > band.maxY + tolerance) return false;
  return true;
}

/** 坡面在 XZ 任意一点的高度 */
export function surfaceHeightAt(surface: GroundSurface, point: Vec2): number {
  return (
    surface.height +
    (surface.slopeZ ?? 0) * (point.z - surface.minZ) +
    (surface.slopeX ?? 0) * (point.x - surface.minX)
  );
}

/**
 * 采样 (x, z) 处的地面高度。
 *
 * 不传 currentY 时保持旧的 2.5D 语义：取所有覆盖该点的表面与基准地面的最高者。
 * 传 currentY（玩家当前脚底高度）时改为连续高度采样：先丢掉与 currentY 高差超过
 * maxStepHeight 的表面（那属于另一层楼），再在剩下的候选里取最高者。
 * 于是走双跑折返楼梯（3.8 → 1.9 → 0）时每帧跟着梯段平滑升降，登上 0.42 的台阶照常成立，
 * 而在 2F（3.8）上方经过 1F（0）时既不会被拉下楼板、也不会瞬移上二楼。
 * 无任何可踏表面时原样返回 currentY（悬空 / 层间衔接处不瞬移）。
 */
export function sampleGroundHeight(
  point: Vec2,
  surfaces: readonly GroundSurface[] = [],
  groundY = 0,
  currentY?: number,
  maxStepHeight = DEFAULT_MAX_STEP_HEIGHT,
): number {
  if (currentY === undefined) {
    let height = groundY;
    for (const surface of surfaces) {
      if (isPointInRect(point, surface)) {
        height = Math.max(height, surfaceHeightAt(surface, point));
      }
    }
    return height;
  }

  const lowest = currentY - maxStepHeight;
  const highest = currentY + maxStepHeight;
  let best = Number.NEGATIVE_INFINITY;
  if (groundY >= lowest && groundY <= highest) best = groundY;
  for (const surface of surfaces) {
    if (!isPointInRect(point, surface)) continue;
    const height = surfaceHeightAt(surface, point);
    if (height >= lowest && height <= highest && height > best) best = height;
  }
  return best === Number.NEGATIVE_INFINITY ? currentY : best;
}

/**
 * 相机 / 屏幕射线与可行走表面的交点（触屏轻点落点用）。
 *
 * 传 currentY 时额外要求命中面与玩家同层（高差不超过 maxHeightDelta），
 * 避免站在 2F 点地面却选中被楼板遮住的 1F 地面。
 */
export function intersectGroundRay(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  surfaces: readonly GroundSurface[] = [],
  groundY = 0,
  currentY?: number,
  maxHeightDelta = DEFAULT_MAX_STEP_HEIGHT,
): { x: number; y: number; z: number } | null {
  let nearest = Infinity;
  let hit = null;
  for (const surface of [null, ...surfaces]) {
    const slopeX = surface?.slopeX ?? 0;
    const slopeZ = surface?.slopeZ ?? 0;
    const denominator = direction.y - slopeX * direction.x - slopeZ * direction.z;
    if (Math.abs(denominator) < 1e-9) continue;
    const rise = surface
      ? surface.height +
        slopeX * (origin.x - surface.minX) +
        slopeZ * (origin.z - surface.minZ) -
        origin.y
      : groundY - origin.y;
    const distance = rise / denominator;
    if (distance < 0 || distance >= nearest) continue;
    const point = {
      x: origin.x + direction.x * distance,
      y: origin.y + direction.y * distance,
      z: origin.z + direction.z * distance,
    };
    if (surface && !isPointInRect(point, surface)) continue;
    if (currentY !== undefined && Math.abs(point.y - currentY) > maxHeightDelta) continue;
    if (Math.abs(sampleGroundHeight(point, surfaces, groundY, currentY, maxHeightDelta) - point.y) > 1e-6) continue;
    nearest = distance;
    hit = point;
  }
  return hit;
}

export interface ObstacleAabb extends HeightBand {
  id?: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** 仅用于调试线框高度；碰撞的垂直范围用 minY / maxY */
  height?: number;
}

export type ZoneShape =
  | {
      kind: 'box';
      centerX: number;
      centerZ: number;
      halfX: number;
      halfZ: number;
      /** 盒形区域的垂直中心与半高；缺省或 halfY <= 0 表示全高有效 */
      centerY?: number;
      halfY?: number;
    }
  | { kind: 'circle'; centerX: number; centerZ: number; radius: number; centerY?: number };

/** 触发区判定用的玩家探针：脚底高度 + XZ 位置 */
export interface PlayerProbe extends Vec2 {
  feetY: number;
}

/** 圆形触发区的垂直吸附半径（米）：单层区域 center.y = 0 时脚底 0 ~ 1.6 均有效 */
export const CIRCLE_ZONE_MAX_HEIGHT_DELTA = 1.6;

/** 盒形触发区垂直判定的放宽量（米）：兼容既有的门口 / 楼梯区域 */
export const BOX_ZONE_HEIGHT_TOLERANCE = 0.6;

const BOUNDS_EPSILON = 1e-9;

export function normalizeBounds(bounds: WalkBounds): RectBounds[] {
  return Array.isArray(bounds) ? bounds : [bounds];
}

export function isPointInRect(point: Vec2, rect: RectBounds): boolean {
  return (
    point.x >= rect.minX - BOUNDS_EPSILON &&
    point.x <= rect.maxX + BOUNDS_EPSILON &&
    point.z >= rect.minZ - BOUNDS_EPSILON &&
    point.z <= rect.maxZ + BOUNDS_EPSILON
  );
}

/**
 * 是否落在可行走区域内。
 * 传 feetY 时只考虑该高度层有效的矩形（1F 与 2F 轮廓重叠时用于区分楼层）。
 */
export function isInsideBounds(point: Vec2, bounds: WalkBounds, feetY?: number): boolean {
  for (const rect of normalizeBounds(bounds)) {
    if (feetY !== undefined && !isHeightInBand(feetY, rect)) continue;
    if (isPointInRect(point, rect)) return true;
  }
  return false;
}

function clampValue(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function clampToRect(point: Vec2, rect: RectBounds): Vec2 {
  return {
    x: clampValue(point.x, rect.minX, rect.maxX),
    z: clampValue(point.z, rect.minZ, rect.maxZ),
  };
}

/**
 * 出界时钳制到最近矩形的边缘；已在任一矩形内则原样返回。
 * 传 feetY 时只在当前高度层的矩形里找落点；该层没有任何矩形时保持原位（楼梯衔接处不硬拉）。
 */
export function clampToNearestWalkable(point: Vec2, bounds: WalkBounds, feetY?: number): Vec2 {
  const rects = normalizeBounds(bounds).filter((rect) => feetY === undefined || isHeightInBand(feetY, rect));
  if (rects.length === 0) return { x: point.x, z: point.z };

  let best: Vec2 | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;

  for (const rect of rects) {
    const clamped = clampToRect(point, rect);
    const dx = clamped.x - point.x;
    const dz = clamped.z - point.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq === 0) return clamped;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      best = clamped;
    }
  }

  return best ?? { x: point.x, z: point.z };
}

/** 圆（玩家）是否进入扩张后的 AABB（XZ） */
function isInsideExpandedObstacle(point: Vec2, obstacle: ObstacleAabb, radius: number): boolean {
  const epsilon = 1e-6;
  return (
    point.x > obstacle.minX - radius + epsilon &&
    point.x < obstacle.maxX + radius - epsilon &&
    point.z > obstacle.minZ - radius + epsilon &&
    point.z < obstacle.maxZ + radius - epsilon
  );
}

type Axis = 'x' | 'z';

/** 逐轴解算时的共享上下文；feetY 为 undefined 表示单层，不按高度过滤 */
interface MovementContext {
  bounds: WalkBounds;
  obstacles: ObstacleAabb[];
  radius: number;
  feetY: number | undefined;
}

function moveAxis(
  position: Vec2,
  amount: number,
  axis: Axis,
  context: MovementContext,
): Vec2 {
  if (amount === 0) return position;

  const { bounds, obstacles, radius, feetY } = context;
  const candidate: Vec2 = { x: position.x, z: position.z };
  candidate[axis] += amount;

  if (!isInsideBounds(candidate, bounds, feetY)) {
    const clamped = clampToNearestWalkable(candidate, bounds, feetY);
    candidate.x = clamped.x;
    candidate.z = clamped.z;
  }

  for (const obstacle of obstacles) {
    if (feetY !== undefined && !intersectsHeightBand(obstacle, feetY)) continue;
    if (isInsideExpandedObstacle(candidate, obstacle, radius)) {
      // 该轴被挡住：回退本轴位移，保留另一轴，实现贴墙滑动
      candidate[axis] = position[axis];
      break;
    }
  }

  return candidate;
}

export interface MovementOptions {
  /**
   * 当前脚底高度：提供后按高度带过滤 bounds 与 obstacles，
   * 并在每个子步后连续采样新高度，使 2F → 楼梯 → 平台 → 1F 一路不被外层边界卡死。
   */
  currentY?: number;
  surfaces?: readonly GroundSurface[];
  groundY?: number;
  maxStepHeight?: number;
}

/**
 * 逐轴解算移动与碰撞；长距离自动拆分，避免穿透薄墙。
 * 返回解算后的脚底位置（XZ）。传 options.currentY 时按楼层解算。
 */
export function resolveMovement(
  from: Vec2,
  delta: Vec2,
  bounds: WalkBounds,
  obstacles: ObstacleAabb[],
  radius: number,
  options: MovementOptions = {},
): Vec2 {
  const distance = Math.hypot(delta.x, delta.z);
  if (distance === 0) return { x: from.x, z: from.z };

  const maxStep = Math.max(radius * 0.5, 0.02);
  const steps = Math.max(1, Math.ceil(distance / maxStep));
  const stepX = delta.x / steps;
  const stepZ = delta.z / steps;

  const surfaces = options.surfaces;
  const groundY = options.groundY ?? 0;
  const maxStepHeight = options.maxStepHeight ?? DEFAULT_MAX_STEP_HEIGHT;
  const trackHeight = options.currentY !== undefined;

  const context: MovementContext = { bounds, obstacles, radius, feetY: options.currentY };
  let position: Vec2 = { x: from.x, z: from.z };
  for (let index = 0; index < steps; index += 1) {
    position = moveAxis(position, stepX, 'x', context);
    position = moveAxis(position, stepZ, 'z', context);
    if (trackHeight && context.feetY !== undefined) {
      context.feetY = sampleGroundHeight(position, surfaces, groundY, context.feetY, maxStepHeight);
    }
  }
  return position;
}

/** 只看 XZ 的水平判定，单层场景与既有测试沿用 */
export function isPointInZone(point: Vec2, zone: ZoneShape): boolean {
  if (zone.kind === 'circle') {
    const dx = point.x - zone.centerX;
    const dz = point.z - zone.centerZ;
    return dx * dx + dz * dz <= zone.radius * zone.radius;
  }
  return (
    point.x >= zone.centerX - zone.halfX &&
    point.x <= zone.centerX + zone.halfX &&
    point.z >= zone.centerZ - zone.halfZ &&
    point.z <= zone.centerZ + zone.halfZ
  );
}

/**
 * 3D 高度感知的触发区判定（防隔层误触发）。
 * 盒形：脚底或身体中心落在 [centerY - halfY, centerY + halfY]（含放宽容差）；
 * 圆形：脚底与 centerY 的高差不超过 CIRCLE_ZONE_MAX_HEIGHT_DELTA。
 */
export function isPlayerInZone(player: PlayerProbe, zone: ZoneShape): boolean {
  if (!isPointInZone(player, zone)) return false;

  const centerY = zone.centerY ?? 0;
  if (zone.kind === 'circle') {
    return Math.abs(player.feetY - centerY) <= CIRCLE_ZONE_MAX_HEIGHT_DELTA;
  }

  const halfY = zone.halfY ?? 0;
  if (halfY <= 0) return true;

  const half = halfY + BOX_ZONE_HEIGHT_TOLERANCE;
  const bottom = centerY - half;
  const top = centerY + half;
  return player.feetY <= top && player.feetY + PLAYER_BODY_CENTER_OFFSET >= bottom;
}

export function distance2D(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

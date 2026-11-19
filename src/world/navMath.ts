// world/navMath.ts —— 可行走区域与碰撞的纯数学函数
// 不依赖 three.js / DOM，便于在 node 环境单测。
//
// 坐标约定：地面为 XZ 平面，矩形以 min/max 表示；多矩形取并集作为可行走区域。

export interface Vec2 {
  x: number;
  z: number;
}

export interface RectBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** 单个矩形，或多矩形并集（L 型拐弯路线等） */
export type WalkBounds = RectBounds | RectBounds[];

export interface GroundSurface extends RectBounds {
  height: number;
  slopeZ?: number;
}

export function sampleGroundHeight(point: Vec2, surfaces: readonly GroundSurface[] = [], groundY = 0): number {
  let height = groundY;
  for (const surface of surfaces) {
    if (isPointInRect(point, surface)) {
      height = Math.max(height, surface.height + (surface.slopeZ ?? 0) * (point.z - surface.minZ));
    }
  }
  return height;
}

export function intersectGroundRay(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  surfaces: readonly GroundSurface[] = [],
  groundY = 0,
): { x: number; y: number; z: number } | null {
  let nearest = Infinity;
  let hit = null;
  for (const surface of [null, ...surfaces]) {
    const slope = surface?.slopeZ ?? 0;
    const denominator = direction.y - slope * direction.z;
    if (Math.abs(denominator) < 1e-9) continue;
    const offset = surface ? surface.height - slope * surface.minZ : groundY;
    const distance = (offset - origin.y + slope * origin.z) / denominator;
    if (distance < 0 || distance >= nearest) continue;
    const point = {
      x: origin.x + direction.x * distance,
      y: origin.y + direction.y * distance,
      z: origin.z + direction.z * distance,
    };
    if (surface && !isPointInRect(point, surface)) continue;
    if (Math.abs(sampleGroundHeight(point, surfaces, groundY) - point.y) > 1e-6) continue;
    nearest = distance;
    hit = point;
  }
  return hit;
}

export interface ObstacleAabb {
  id?: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** 仅用于调试线框高度，碰撞只考虑 XZ */
  height?: number;
}

export type ZoneShape =
  | { kind: 'box'; centerX: number; centerZ: number; halfX: number; halfZ: number }
  | { kind: 'circle'; centerX: number; centerZ: number; radius: number };

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

export function isInsideBounds(point: Vec2, bounds: WalkBounds): boolean {
  const rects = normalizeBounds(bounds);
  for (const rect of rects) {
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

/** 出界时钳制到最近矩形的边缘；已在任一矩形内则原样返回 */
export function clampToNearestWalkable(point: Vec2, bounds: WalkBounds): Vec2 {
  const rects = normalizeBounds(bounds);
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

/** 圆（玩家）是否进入扩张后的 AABB */
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

function moveAxis(
  position: Vec2,
  amount: number,
  axis: Axis,
  bounds: WalkBounds,
  obstacles: ObstacleAabb[],
  radius: number,
): Vec2 {
  if (amount === 0) return position;

  const candidate: Vec2 = { x: position.x, z: position.z };
  candidate[axis] += amount;

  if (!isInsideBounds(candidate, bounds)) {
    const clamped = clampToNearestWalkable(candidate, bounds);
    candidate.x = clamped.x;
    candidate.z = clamped.z;
  }

  for (const obstacle of obstacles) {
    if (isInsideExpandedObstacle(candidate, obstacle, radius)) {
      // 该轴被挡住：回退本轴位移，保留另一轴，实现贴墙滑动
      candidate[axis] = position[axis];
      break;
    }
  }

  return candidate;
}

/**
 * 逐轴解算移动与碰撞；长距离自动拆分，避免穿透薄墙。
 * 返回解算后的脚底位置（XZ）。
 */
export function resolveMovement(
  from: Vec2,
  delta: Vec2,
  bounds: WalkBounds,
  obstacles: ObstacleAabb[],
  radius: number,
): Vec2 {
  const distance = Math.hypot(delta.x, delta.z);
  if (distance === 0) return { x: from.x, z: from.z };

  const maxStep = Math.max(radius * 0.5, 0.02);
  const steps = Math.max(1, Math.ceil(distance / maxStep));
  const stepX = delta.x / steps;
  const stepZ = delta.z / steps;

  let position: Vec2 = { x: from.x, z: from.z };
  for (let index = 0; index < steps; index += 1) {
    position = moveAxis(position, stepX, 'x', bounds, obstacles, radius);
    position = moveAxis(position, stepZ, 'z', bounds, obstacles, radius);
  }
  return position;
}

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

export function distance2D(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

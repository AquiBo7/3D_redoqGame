import { describe, expect, it } from 'vitest';
import {
  clampToNearestWalkable,
  distance2D,
  isInsideBounds,
  isPointInRect,
  isPointInZone,
  normalizeBounds,
  resolveMovement,
  sampleGroundHeight,
  intersectGroundRay,
} from './navMath';
import type { ObstacleAabb, RectBounds } from './navMath';

const L_SHAPE: RectBounds[] = [
  { minX: 0, maxX: 10, minZ: 0, maxZ: 10 },
  { minX: 10, maxX: 20, minZ: 0, maxZ: 5 },
];

describe('navMath 地形高度与触屏落点', () => {
  const surfaces = [
    { minX: -2, maxX: 2, minZ: -3, maxZ: 0, height: 0.42 },
    { minX: 2, maxX: 4, minZ: 0, maxZ: 3, height: 0.42, slopeZ: -0.14 },
    { minX: -2, maxX: 2, minZ: 0, maxZ: 1, height: 0.35 },
  ];
  it('采样平台、台阶、坡道及重叠边界，平台外回到底高', () => {
    expect(sampleGroundHeight({ x: 0, z: -1 }, surfaces)).toBeCloseTo(0.42);
    expect(sampleGroundHeight({ x: 0, z: 0.5 }, surfaces)).toBeCloseTo(0.35);
    expect(sampleGroundHeight({ x: 0, z: 0 }, surfaces)).toBeCloseTo(0.42);
    expect(sampleGroundHeight({ x: 3, z: 1.5 }, surfaces)).toBeCloseTo(0.21);
    expect(sampleGroundHeight({ x: 5, z: 4 }, surfaces, 0.02)).toBeCloseTo(0.02);
  });
  it('射线取平台顶面，不取其下被遮蔽的平地', () => {
    const platformHit = intersectGroundRay({ x: 0, y: 2, z: -1 }, { x: 0, y: -1, z: 0 }, surfaces);
    expect(platformHit?.x).toBe(0);
    expect(platformHit?.y).toBeCloseTo(0.42, 8);
    expect(platformHit?.z).toBe(-1);
    const hit = intersectGroundRay({ x: 3, y: 2, z: 1.5 }, { x: 0, y: -1, z: 0 }, surfaces);
    expect(hit?.y).toBeCloseTo(0.21);
  });
  it('斜向射线落到最近有效表面，朝天或水平射线无平地交点', () => {
    const hit = intersectGroundRay({ x: 0, y: 2, z: 2 }, { x: 0, y: -1, z: -2 }, surfaces);
    expect(hit?.y).toBeCloseTo(0.42);
    expect(intersectGroundRay({ x: 0, y: 2, z: -1 }, { x: 0, y: 1, z: 0 }, surfaces)).toBeNull();
    expect(intersectGroundRay({ x: 0, y: 2, z: -1 }, { x: 1, y: 0, z: 0 }, surfaces)).toBeNull();
  });
});

describe('navMath 可行走区域', () => {
  it('normalizeBounds 兼容单矩形与多矩形', () => {
    const single: RectBounds = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
    expect(normalizeBounds(single)).toHaveLength(1);
    expect(normalizeBounds(L_SHAPE)).toHaveLength(2);
  });

  it('isPointInRect / isInsideBounds 判定多矩形并集', () => {
    const single: RectBounds = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
    expect(isPointInRect({ x: 0.5, z: 0.5 }, single)).toBe(true);
    expect(isPointInRect({ x: 1.5, z: 0.5 }, single)).toBe(false);

    expect(isInsideBounds({ x: 5, z: 5 }, L_SHAPE)).toBe(true);
    expect(isInsideBounds({ x: 15, z: 3 }, L_SHAPE)).toBe(true);
    expect(isInsideBounds({ x: 15, z: 7 }, L_SHAPE)).toBe(false);
  });

  it('出界时钳制到最近的矩形边缘', () => {
    const clamped = clampToNearestWalkable({ x: 15, z: 7 }, L_SHAPE);
    expect(clamped.x).toBeCloseTo(15, 5);
    expect(clamped.z).toBeCloseTo(5, 5);

    const diagonal = clampToNearestWalkable({ x: 25, z: 7 }, L_SHAPE);
    expect(diagonal.x).toBeCloseTo(20, 5);
    expect(diagonal.z).toBeCloseTo(5, 5);
  });

  it('多矩形内部拐角可通行，沿外边界滑动', () => {
    const blockedByCorner = resolveMovement({ x: 5, z: 9 }, { x: 6, z: 0 }, L_SHAPE, [], 0.3);
    expect(blockedByCorner.x).toBeCloseTo(10, 5);
    expect(blockedByCorner.z).toBeCloseTo(9, 5);

    const throughCorner = resolveMovement({ x: 5, z: 4 }, { x: 6, z: 0 }, L_SHAPE, [], 0.3);
    expect(throughCorner.x).toBeCloseTo(11, 5);
    expect(throughCorner.z).toBeCloseTo(4, 5);

    const blocked = resolveMovement({ x: 15, z: 4 }, { x: 0, z: 4 }, L_SHAPE, [], 0.3);
    expect(blocked.z).toBeLessThanOrEqual(5.000001);
    expect(blocked.z).toBeGreaterThan(4.9);
  });
});

describe('navMath AABB 碰撞', () => {
  const bounds: RectBounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
  const obstacle: ObstacleAabb = { minX: 0.5, maxX: 2, minZ: -1, maxZ: 1 };

  it('正面撞墙时停止，斜向移动沿墙滑动', () => {
    const result = resolveMovement({ x: 0, z: 0 }, { x: 1, z: 1 }, bounds, [obstacle], 0.2);
    expect(result.x).toBeLessThanOrEqual(0.31);
    expect(result.z).toBeCloseTo(1, 5);
  });

  it('长距离移动会拆分子步，不会穿透薄墙', () => {
    const thin: ObstacleAabb = { minX: 2, maxX: 2.04, minZ: -1, maxZ: 1 };
    const result = resolveMovement({ x: 0, z: 0 }, { x: 5, z: 0 }, bounds, [thin], 0.2);
    expect(result.x).toBeLessThan(1.82);
    expect(result.z).toBeCloseTo(0, 5);
  });

  it('斜向绕过孤立障碍物后继续前进，且不进入扩张包围盒', () => {
    const corner: ObstacleAabb = { minX: -1.2, maxX: -1, minZ: 0.9, maxZ: 1.1 };
    const result = resolveMovement({ x: 0, z: 0 }, { x: -2, z: 2 }, bounds, [corner], 0.2);
    expect(result.z).toBeCloseTo(2, 5);
    expect(result.x).toBeGreaterThan(-2);
    expect(result.x).toBeLessThan(-0.8);
  });
});

describe('navMath 触发区判定', () => {
  it('圆形与盒形区域', () => {
    expect(isPointInZone({ x: 1, z: 1 }, { kind: 'circle', centerX: 0, centerZ: 0, radius: 2 })).toBe(true);
    expect(isPointInZone({ x: 3, z: 0 }, { kind: 'circle', centerX: 0, centerZ: 0, radius: 2 })).toBe(false);
    expect(
      isPointInZone(
        { x: 1, z: 1 },
        { kind: 'box', centerX: 0, centerZ: 0, halfX: 1.5, halfZ: 1.5 },
      ),
    ).toBe(true);
    expect(
      isPointInZone(
        { x: 2, z: 0 },
        { kind: 'box', centerX: 0, centerZ: 0, halfX: 1.5, halfZ: 1.5 },
      ),
    ).toBe(false);
  });

  it('distance2D 只计算 XZ 距离', () => {
    expect(distance2D({ x: 0, z: 0 }, { x: 3, z: 4 })).toBeCloseTo(5, 5);
  });
});

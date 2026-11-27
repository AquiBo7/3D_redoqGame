import { describe, expect, it } from 'vitest';
import {
  clampToNearestWalkable,
  distance2D,
  isHeightInBand,
  isInsideBounds,
  isPlayerInZone,
  isPointInRect,
  isPointInZone,
  intersectsHeightBand,
  normalizeBounds,
  resolveMovement,
  sampleGroundHeight,
  surfaceHeightAt,
  intersectGroundRay,
} from './navMath';
import type { GroundSurface, ObstacleAabb, RectBounds, Vec2, ZoneShape } from './navMath';
import {
  FLOOR2_Y,
  LANDING_Y,
  STAIR_CENTER_X,
  TWO_FLOOR_BOUNDS,
  TWO_FLOOR_OBSTACLES,
  TWO_FLOOR_SURFACES,
} from './twoFloorNavFixture';

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

  it('圆形障碍按真实半径碰撞，外接盒角部仍可绕行', () => {
    const pole: ObstacleAabb = {
      id: 'round-pole', shape: 'circle', centerX: 0, centerZ: 0, radius: 0.2,
      minX: -0.2, maxX: 0.2, minZ: -0.2, maxZ: 0.2,
    };
    const blocked = resolveMovement({ x: -1, z: 0 }, { x: 2, z: 0 }, bounds, [pole], 0.3);
    expect(blocked.x).toBeLessThan(-0.5);
    const aroundCorner = resolveMovement({ x: -0.45, z: -0.45 }, { x: -1, z: -1 }, bounds, [pole], 0.3);
    expect(aroundCorner.x).toBeCloseTo(-1.45, 5);
    expect(aroundCorner.z).toBeCloseTo(-1.45, 5);
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

const PLAYER_RADIUS = 0.32;

describe('navMath 双层楼：连续高度采样防穿楼板', () => {
  it('旧签名保持 2.5D 语义：1F 位置会被头顶 2F 楼板采样成 3.8', () => {
    expect(sampleGroundHeight({ x: -4, z: 0 }, TWO_FLOOR_SURFACES, 0)).toBeCloseTo(FLOOR2_Y);
  });

  it('给出 currentY=0 时 1F 玩家留在地面，不被头顶楼板拉上 2F', () => {
    expect(sampleGroundHeight({ x: -4, z: 0 }, TWO_FLOOR_SURFACES, 0, 0)).toBeCloseTo(0);
    expect(sampleGroundHeight({ x: -7, z: 4 }, TWO_FLOOR_SURFACES, 0, 0)).toBeCloseTo(0);
  });

  it('给出 currentY=3.8 时 2F 玩家绝不会掉到 1F', () => {
    expect(sampleGroundHeight({ x: -4, z: 0 }, TWO_FLOOR_SURFACES, 0, FLOOR2_Y)).toBeCloseTo(FLOOR2_Y);
    expect(sampleGroundHeight({ x: -4, z: -6 }, TWO_FLOOR_SURFACES, 0, FLOOR2_Y)).toBeCloseTo(FLOOR2_Y);
  });

  it('无可踏表面时保持当前高度，不瞬移下楼板', () => {
    // 楼梯井中段：该 XZ 只有 1.4 米处的梯段与 0 米基准地面，都离 3.8 米超过一步
    expect(sampleGroundHeight({ x: 2, z: 2 }, TWO_FLOOR_SURFACES, 0, FLOOR2_Y)).toBeCloseTo(FLOOR2_Y);
  });

  it('沿双跑折返楼梯连续下坡：每帧高差都在单步之内且一路降到 1F', () => {
    let feetY = FLOOR2_Y;
    let previous = feetY;
    for (let index = 0; index <= 88; index += 1) {
      const z = -3.9 + index * 0.1;
      feetY = sampleGroundHeight({ x: STAIR_CENTER_X, z }, TWO_FLOOR_SURFACES, 0, feetY);
      expect(Math.abs(feetY - previous)).toBeLessThanOrEqual(0.65);
      expect(feetY).toBeLessThanOrEqual(previous + 1e-9);
      previous = feetY;
    }
    expect(feetY).toBeLessThan(0.1);
  });

  it('沿双跑折返楼梯连续上坡：从 1F 一路回到 2F 楼板高度', () => {
    let feetY = 0;
    let previous = feetY;
    for (let index = 0; index <= 89; index += 1) {
      const z = 4.9 - index * 0.1;
      feetY = sampleGroundHeight({ x: STAIR_CENTER_X, z }, TWO_FLOOR_SURFACES, 0, feetY);
      expect(Math.abs(feetY - previous)).toBeLessThanOrEqual(0.65);
      expect(feetY).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = feetY;
    }
    expect(feetY).toBeCloseTo(FLOOR2_Y, 6);
  });

  it('slopeX 支持东西向坡道，并与 slopeZ 叠加', () => {
    const ramp: GroundSurface = { id: 'ramp-x', minX: 4, maxX: 7, minZ: -4, maxZ: -1, height: 0, slopeX: 0.3 };
    expect(surfaceHeightAt(ramp, { x: 4, z: -2 })).toBeCloseTo(0);
    expect(surfaceHeightAt(ramp, { x: 5.5, z: -2 })).toBeCloseTo(0.45);
    expect(sampleGroundHeight({ x: 7, z: -2 }, [ramp], 0)).toBeCloseTo(0.9);
    // 0.9 米超过单步高差：站在坡脚不会被拽上半段坡道
    expect(sampleGroundHeight({ x: 7, z: -2 }, [ramp], 0, 0)).toBeCloseTo(0);
    expect(sampleGroundHeight({ x: 5.5, z: -2 }, [ramp], 0, 0)).toBeCloseTo(0.45);

    const twisted: GroundSurface = { ...ramp, slopeZ: 0.1 };
    expect(surfaceHeightAt(twisted, { x: 5, z: -3 })).toBeCloseTo(0.4);
  });
});

describe('navMath 双层楼：可行走区域与障碍物的高度带过滤', () => {
  it('isHeightInBand 缺省表示全高有效，并带衔接容差', () => {
    expect(isHeightInBand(FLOOR2_Y, {})).toBe(true);
    expect(isHeightInBand(0, { minY: LANDING_Y })).toBe(false);
    expect(isHeightInBand(1.7, { minY: LANDING_Y })).toBe(true);
    expect(isHeightInBand(0, { maxY: LANDING_Y })).toBe(true);
  });

  it('intersectsHeightBand 用身体区间判断是否真会撞上', () => {
    expect(intersectsHeightBand({ minY: 0, maxY: 0.8 }, 0)).toBe(true);
    expect(intersectsHeightBand({ minY: 0, maxY: 0.8 }, FLOOR2_Y)).toBe(false);
    expect(intersectsHeightBand({ minY: FLOOR2_Y, maxY: FLOOR2_Y + 0.75 }, 0)).toBe(false);
    expect(intersectsHeightBand({ minY: FLOOR2_Y, maxY: FLOOR2_Y + 0.75 }, 3.0)).toBe(true);
    expect(intersectsHeightBand({}, 0)).toBe(true);
  });

  it('同一 XZ 轮廓在 1F / 2F 分别有效，2F 外廊对 1F 玩家是墙', () => {
    expect(isInsideBounds({ x: -4, z: 0 }, TWO_FLOOR_BOUNDS, 0)).toBe(true);
    expect(isInsideBounds({ x: -4, z: 0 }, TWO_FLOOR_BOUNDS, FLOOR2_Y)).toBe(true);
    expect(isInsideBounds({ x: -4, z: -6 }, TWO_FLOOR_BOUNDS, FLOOR2_Y)).toBe(true);
    expect(isInsideBounds({ x: -4, z: -6 }, TWO_FLOOR_BOUNDS, 0)).toBe(false);
    // 不传 feetY 时保持旧的单层语义
    expect(isInsideBounds({ x: -4, z: -6 }, TWO_FLOOR_BOUNDS)).toBe(true);
  });

  it('楼梯间全高有效：上下层衔接处在任意高度都不被外层 bounds 卡死', () => {
    for (const feetY of [0, LANDING_Y, FLOOR2_Y]) {
      expect(isInsideBounds({ x: STAIR_CENTER_X, z: 0.5 }, TWO_FLOOR_BOUNDS, feetY)).toBe(true);
      expect(isInsideBounds({ x: STAIR_CENTER_X, z: -3.9 }, TWO_FLOOR_BOUNDS, feetY)).toBe(true);
    }
  });

  it('钳制只在当前高度层的轮廓里找落点', () => {
    const on1F = clampToNearestWalkable({ x: -4, z: -6 }, TWO_FLOOR_BOUNDS, 0);
    expect(on1F.x).toBeCloseTo(-4, 5);
    expect(on1F.z).toBeCloseTo(-4, 5);

    const on2F = clampToNearestWalkable({ x: -4, z: -9 }, TWO_FLOOR_BOUNDS, FLOOR2_Y);
    expect(on2F.z).toBeCloseTo(-8, 5);
  });

  it('resolveMovement：1F 办公桌不挡 2F 玩家，2F 课桌不挡 1F 玩家', () => {
    const along1FDesk = resolveMovement(
      { x: -7, z: -1.5 },
      { x: 3, z: 0 },
      TWO_FLOOR_BOUNDS,
      TWO_FLOOR_OBSTACLES,
      PLAYER_RADIUS,
      { currentY: FLOOR2_Y, surfaces: TWO_FLOOR_SURFACES },
    );
    expect(along1FDesk.x).toBeCloseTo(-4, 5);

    const along2FDesk = resolveMovement(
      { x: -7, z: 2 },
      { x: 3, z: 0 },
      TWO_FLOOR_BOUNDS,
      TWO_FLOOR_OBSTACLES,
      PLAYER_RADIUS,
      { currentY: 0, surfaces: TWO_FLOOR_SURFACES },
    );
    expect(along2FDesk.x).toBeCloseTo(-4, 5);
  });

  it('resolveMovement：本层障碍物照常阻挡', () => {
    const blockedOn1F = resolveMovement(
      { x: -7, z: -1.5 },
      { x: 3, z: 0 },
      TWO_FLOOR_BOUNDS,
      TWO_FLOOR_OBSTACLES,
      PLAYER_RADIUS,
      { currentY: 0, surfaces: TWO_FLOOR_SURFACES },
    );
    expect(blockedOn1F.x).toBeGreaterThan(-6.5);
    expect(blockedOn1F.x).toBeLessThan(-6.3);

    const blockedOn2F = resolveMovement(
      { x: -7, z: 2 },
      { x: 3, z: 0 },
      TWO_FLOOR_BOUNDS,
      TWO_FLOOR_OBSTACLES,
      PLAYER_RADIUS,
      { currentY: FLOOR2_Y, surfaces: TWO_FLOOR_SURFACES },
    );
    expect(blockedOn2F.x).toBeGreaterThan(-6.5);
    expect(blockedOn2F.x).toBeLessThan(-6.3);
  });

  it('resolveMovement：不填高度带的隔墙在两层都挡，且不传 currentY 时保持旧行为', () => {
    const legacy = resolveMovement({ x: -2, z: -3.4 }, { x: -3, z: 0 }, TWO_FLOOR_BOUNDS, TWO_FLOOR_OBSTACLES, PLAYER_RADIUS);
    const on1F = resolveMovement(
      { x: -2, z: -3.4 }, { x: -3, z: 0 }, TWO_FLOOR_BOUNDS, TWO_FLOOR_OBSTACLES, PLAYER_RADIUS,
      { currentY: 0, surfaces: TWO_FLOOR_SURFACES },
    );
    const on2F = resolveMovement(
      { x: -2, z: -3.4 }, { x: -3, z: 0 }, TWO_FLOOR_BOUNDS, TWO_FLOOR_OBSTACLES, PLAYER_RADIUS,
      { currentY: FLOOR2_Y, surfaces: TWO_FLOOR_SURFACES },
    );
    expect(on1F.x).toBeCloseTo(legacy.x, 5);
    expect(on2F.x).toBeCloseTo(legacy.x, 5);
    expect(on1F.x).toBeGreaterThan(-2.7);
  });

  it('逐帧走下双跑楼梯：一路下坡不被任何一层轮廓弹回，最后横向跨入 1F 教室', () => {
    let position: Vec2 = { x: STAIR_CENTER_X, z: -3.9 };
    let feetY = FLOOR2_Y;
    for (let index = 0; index < 85; index += 1) {
      const next = resolveMovement(
        position,
        { x: 0, z: 0.1 },
        TWO_FLOOR_BOUNDS,
        TWO_FLOOR_OBSTACLES,
        PLAYER_RADIUS,
        { currentY: feetY, surfaces: TWO_FLOOR_SURFACES, groundY: 0 },
      );
      // 每一帧都在前进：既没有被楼梯间轮廓卡住，也没有被 2F 楼板轮廓拽回
      expect(next.z).toBeGreaterThan(position.z);
      position = next;
      feetY = sampleGroundHeight(position, TWO_FLOOR_SURFACES, 0, feetY);
    }
    expect(position.z).toBeCloseTo(4.6, 1);
    expect(feetY).toBeLessThan(0.3);

    // 1F 教室轮廓只在 1F 高度带有效：带着 currentY 才能跨过去
    const intoRoom = resolveMovement(
      position,
      { x: -2, z: 0 },
      TWO_FLOOR_BOUNDS,
      TWO_FLOOR_OBSTACLES,
      PLAYER_RADIUS,
      { currentY: feetY, surfaces: TWO_FLOOR_SURFACES, groundY: 0 },
    );
    expect(intoRoom.x).toBeCloseTo(-0.5, 5);
  });

  it('bounds 高度带拦下越层通行：2F 外廊对 1F 玩家是墙，对本层玩家是路', () => {
    const move = (currentY: number) => resolveMovement(
      { x: -4, z: -3.5 },
      { x: 0, z: -2 },
      TWO_FLOOR_BOUNDS,
      TWO_FLOOR_OBSTACLES,
      PLAYER_RADIUS,
      { currentY, surfaces: TWO_FLOOR_SURFACES, groundY: 0 },
    );
    expect(move(0).z).toBeCloseTo(-4, 4);
    expect(move(FLOOR2_Y).z).toBeCloseTo(-5.5, 4);
  });
});

describe('navMath 双层楼：射线落点与触发区高度判定', () => {
  it('2F 相机垂直向下命中的是 2F 楼板顶面', () => {
    const hit = intersectGroundRay(
      { x: -4, y: FLOOR2_Y + 1.6, z: 0 },
      { x: 0, y: -1, z: 0 },
      TWO_FLOOR_SURFACES,
      0,
      FLOOR2_Y,
    );
    expect(hit?.y).toBeCloseTo(FLOOR2_Y);
  });

  it('2F 玩家点向楼下 1F 地面：给出 currentY 时无合法落点，不传时维持旧行为', () => {
    const origin = { x: STAIR_CENTER_X, y: FLOOR2_Y + 1.6, z: -4.5 };
    const direction = { x: 0, y: -1, z: -1 };
    expect(intersectGroundRay(origin, direction, TWO_FLOOR_SURFACES, 0, FLOOR2_Y, 2.2)).toBeNull();
    expect(intersectGroundRay(origin, direction, TWO_FLOOR_SURFACES, 0)?.y).toBeCloseTo(0);
  });

  it('沿梯段下望时射线命中同层梯段，供触屏逐段下楼', () => {
    const hit = intersectGroundRay(
      { x: STAIR_CENTER_X, y: FLOOR2_Y + 1.6, z: -3.9 },
      { x: 0, y: -1, z: 0.4 },
      TWO_FLOOR_SURFACES,
      0,
      FLOOR2_Y,
      2.2,
    );
    expect(hit).not.toBeNull();
    expect(hit!.z).toBeGreaterThan(-3.9);
    expect(hit!.y).toBeLessThan(FLOOR2_Y);
    expect(FLOOR2_Y - hit!.y).toBeLessThanOrEqual(2.2);
  });

  it('圆形触发区：2F 玩家站在 1F 区域正上方不命中，踏上 1F 才命中', () => {
    const shape: ZoneShape = { kind: 'circle', centerX: -2, centerY: 0, centerZ: 4.4, radius: 1.5 };
    expect(isPlayerInZone({ x: -2, z: 4.4, feetY: 0 }, shape)).toBe(true);
    expect(isPlayerInZone({ x: -2, z: 4.4, feetY: 1.6 }, shape)).toBe(true);
    expect(isPlayerInZone({ x: -2, z: 4.4, feetY: 1.7 }, shape)).toBe(false);
    expect(isPlayerInZone({ x: -2, z: 4.4, feetY: FLOOR2_Y }, shape)).toBe(false);
    expect(isPlayerInZone({ x: -6, z: 4.4, feetY: 0 }, shape)).toBe(false);
  });

  it('圆形触发区按 center.y 定位到自己那一层', () => {
    const shape: ZoneShape = { kind: 'circle', centerX: 0, centerY: FLOOR2_Y, centerZ: 0, radius: 2 };
    expect(isPlayerInZone({ x: 0, z: 0, feetY: FLOOR2_Y }, shape)).toBe(true);
    expect(isPlayerInZone({ x: 0, z: 0, feetY: 0 }, shape)).toBe(false);
  });

  it('盒形触发区：按既有 S8 门口比例 1F 命中、2F 不命中', () => {
    const shape: ZoneShape = {
      kind: 'box', centerX: -6.5, centerZ: -3, halfX: 1.5, halfZ: 1, centerY: 0.9, halfY: 1.8,
    };
    expect(isPlayerInZone({ x: -6.5, z: -3, feetY: 0 }, shape)).toBe(true);
    expect(isPlayerInZone({ x: -6.5, z: -3, feetY: 2.6 }, shape)).toBe(true);
    expect(isPlayerInZone({ x: -6.5, z: -3, feetY: FLOOR2_Y }, shape)).toBe(false);
  });

  it('盒形触发区未声明 halfY（旧数据）视为全高有效', () => {
    const shape: ZoneShape = { kind: 'box', centerX: -6.5, centerZ: -3, halfX: 1.5, halfZ: 1 };
    expect(isPlayerInZone({ x: -6.5, z: -3, feetY: FLOOR2_Y }, shape)).toBe(true);
  });

  it('isPointInZone 仍为纯 XZ 判定，单层场景与旧调用不受影响', () => {
    const shape: ZoneShape = { kind: 'circle', centerX: 0, centerY: 4, centerZ: 0, radius: 1 };
    expect(isPointInZone({ x: 0.5, z: 0 }, shape)).toBe(true);
  });

  it('既有单层障碍物配置在新签名下行为不变', () => {
    const bounds: RectBounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
    const wall: ObstacleAabb = { minX: 0.5, maxX: 2, minZ: -1, maxZ: 1 };
    const withHeight = resolveMovement({ x: 0, z: 0 }, { x: 1, z: 1 }, bounds, [wall], 0.2, { currentY: 0 });
    const legacy = resolveMovement({ x: 0, z: 0 }, { x: 1, z: 1 }, bounds, [wall], 0.2);
    expect(withHeight.x).toBeCloseTo(legacy.x, 5);
    expect(withHeight.z).toBeCloseTo(legacy.z, 5);
  });
});

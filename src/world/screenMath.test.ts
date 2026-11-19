import { describe, expect, it } from 'vitest';
import { computeGuidePlacement } from './screenMath';

const WIDTH = 1000;
const HEIGHT = 600;

function baseInput(overrides: Partial<Parameters<typeof computeGuidePlacement>[0]> = {}) {
  return {
    screenX: 500,
    screenY: 300,
    behind: false,
    directionX: 1,
    directionY: 0,
    width: WIDTH,
    height: HEIGHT,
    marginPx: 28,
    bottomSafePx: 56,
    ...overrides,
  };
}

describe('computeGuidePlacement 目标指引吸附', () => {
  it('视野内目标保持真实投影位置', () => {
    const placement = computeGuidePlacement(baseInput({ screenX: 620, screenY: 260 }));
    expect(placement).toMatchObject({ x: 620, y: 260, clamped: false });
  });

  it('右侧视野外吸附到右边缘，箭头朝右', () => {
    const placement = computeGuidePlacement(baseInput({ screenX: 1200, directionX: 1, directionY: 0 }));
    expect(placement.clamped).toBe(true);
    expect(placement.x).toBeCloseTo(WIDTH - 28, 5);
    expect(placement.y).toBeCloseTo(HEIGHT / 2, 5);
    expect(placement.angleRad).toBeCloseTo(0, 5);
  });

  it('身后目标吸附到上边缘，箭头朝上', () => {
    const placement = computeGuidePlacement(
      baseInput({ screenX: 500, screenY: 300, behind: true, directionX: 0, directionY: -1 }),
    );
    expect(placement.clamped).toBe(true);
    expect(placement.y).toBeCloseTo(28, 5);
    expect(placement.angleRad).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('底部预留 56px 安全区', () => {
    const placement = computeGuidePlacement(baseInput({ screenX: 500, screenY: 700, directionX: 0, directionY: 1 }));
    expect(placement.clamped).toBe(true);
    expect(placement.y).toBeCloseTo(HEIGHT - 56, 5);
  });

  it('方向为零时回退为向上指引', () => {
    const placement = computeGuidePlacement(
      baseInput({ behind: true, directionX: 0, directionY: 0 }),
    );
    expect(placement).toMatchObject({ x: 500, y: 28, clamped: true });
  });

  it('横屏窄高度时底部安全区不会超出屏幕', () => {
    const placement = computeGuidePlacement(
      baseInput({ width: 844, height: 300, screenX: 500, screenY: 900, directionX: 0, directionY: 1 }),
    );
    expect(placement.y).toBeLessThanOrEqual(300 - 28);
    expect(placement.y).toBeGreaterThanOrEqual(28);
  });
});

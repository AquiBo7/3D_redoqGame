import { describe, expect, it } from 'vitest';
import { angleBetweenDeg, GazeDwellTracker } from './gazeTracker';

describe('angleBetweenDeg', () => {
  it('同向为 0°，垂直为 90°，反向为 180°', () => {
    expect(angleBetweenDeg({ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: -1 })).toBeCloseTo(0, 5);
    expect(angleBetweenDeg({ x: 0, y: 0, z: -1 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(90, 5);
    expect(angleBetweenDeg({ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 })).toBeCloseTo(180, 5);
  });

  it('零向量视为 180°', () => {
    expect(angleBetweenDeg({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 })).toBe(180);
  });
});

describe('GazeDwellTracker', () => {
  it('持续对准 2 秒后只完成一次', () => {
    const tracker = new GazeDwellTracker(2000);
    expect(tracker.update('window', 0)).toMatchObject({ progress: 0, completed: false });
    expect(tracker.update('window', 1000).progress).toBeCloseTo(0.5, 5);
    expect(tracker.update('window', 1999).completed).toBe(false);
    expect(tracker.update('window', 2000)).toMatchObject({ progress: 1, completed: true });
    expect(tracker.update('window', 2600).completed).toBe(false);
  });

  it('中途移开或切换热点会清零', () => {
    const tracker = new GazeDwellTracker(2000);
    tracker.update('a', 0);
    expect(tracker.update(null, 1500).progress).toBe(0);
    expect(tracker.update('a', 1600).progress).toBe(0);
    expect(tracker.update('a', 2600).progress).toBeCloseTo(0.5, 5);

    tracker.reset();
    expect(tracker.update('a', 5000).progress).toBe(0);
  });

  it('dwellMs 至少为 1', () => {
    const tracker = new GazeDwellTracker(0);
    expect(tracker.update('a', 0).progress).toBe(0);
    expect(tracker.update('a', 1).completed).toBe(true);
  });
});

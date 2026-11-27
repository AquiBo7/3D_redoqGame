import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { SceneId } from '../data/storySchema';
import type { SceneRuntimeContext } from '../world/worldSceneTypes';
import { roomRuntime } from './room';

describe('卧室开场提示与自动出发', () => {
  let bus: EventBus;
  let context: SceneRuntimeContext;
  let yaw: number;
  let yawHistory: number[];
  let lookLocked: boolean;
  let modalBlocked: boolean;
  let cinematic: boolean;
  const visible = new Map<string, boolean>();
  const cutscenes: Array<{ stepId: string; key: string; immediate?: boolean }> = [];

  beforeEach(() => {
    bus = new EventBus();
    yaw = 0.35;
    yawHistory = [];
    lookLocked = false;
    modalBlocked = false;
    cinematic = false;
    visible.clear();
    cutscenes.length = 0;
    bus.on('scene:cutscene', (payload) => cutscenes.push(payload));
    context = {
      sceneId: 'S1',
      bus,
      actors: {},
      getPlayerFeet: (target) => target.set(-1.6, 0, 0.2),
      getViewYaw: () => yaw,
      setViewYaw: (value) => { yaw = value; yawHistory.push(value); },
      setScriptedLookLocked: (value) => { lookLocked = value; },
      isModalBlocked: () => modalBlocked,
      isCinematic: () => cinematic,
      setInteractableVisible: (id, value) => visible.set(id, value),
    };
    roomRuntime.enter(context);
    bus.emit('game:start');
  });

  afterEach(() => {
    roomRuntime.exit();
    vi.restoreAllMocks();
  });

  function enter(sceneId: SceneId): void {
    context.sceneId = sceneId;
    roomRuntime.enter(context);
  }

  function showOpening(): void {
    bus.emit('ui:showObjective', { sceneId: 'S1', persistent: true });
  }

  function finishTurn(): void {
    roomRuntime.tick?.(0.25);
    roomRuntime.tick?.(0.7);
  }

  it('字幕同帧提示后延迟 0.25 秒，再限速向右转向衣柜', () => {
    showOpening();
    roomRuntime.tick?.(0.249);
    expect(yawHistory).toEqual([]);
    expect(lookLocked).toBe(false);
    roomRuntime.tick?.(0.001);
    expect(lookLocked).toBe(true);

    let previous = yaw;
    let peakSpeed = 0;
    for (let frame = 0; frame < 168; frame += 1) {
      roomRuntime.tick?.(0.7 / 168);
      peakSpeed = Math.max(peakSpeed, Math.abs(yaw - previous) / (0.7 / 168));
      previous = yaw;
    }
    roomRuntime.tick?.(0.001);
    const targetYaw = Math.atan2(-(2.78 + 1.6), -(1.14 - 0.2));
    expect(yaw).toBeCloseTo(targetYaw, 5);
    expect(yaw).toBeLessThan(0.35 - Math.PI / 2);
    expect(peakSpeed).toBeLessThanOrEqual((200 * Math.PI) / 180 + 0.00001);
    expect(lookLocked).toBe(false);
  });

  it('完成等待后只武装出发，不跳过手机教学；S3 定格 0.2 秒再执行原过场', () => {
    const countdowns: number[] = [];
    bus.on('ui:objectiveCountdown', ({ remaining, active }) => {
      if (active) countdowns.push(remaining);
    });
    showOpening();
    finishTurn();
    roomRuntime.tick?.(5);
    expect(cutscenes).toEqual([]);
    expect(countdowns[countdowns.length - 1]).toBe(0);

    enter('S2');
    roomRuntime.tick?.(1);
    expect(cutscenes).toEqual([]);
    enter('S3');
    roomRuntime.tick?.(0.199);
    expect(cutscenes).toEqual([]);
    expect(lookLocked).toBe(true);
    roomRuntime.tick?.(0.001);
    expect(cutscenes).toEqual([{
      stepId: 's3-run', key: 's3-run', durationMs: 3000, skippable: false, immediate: true,
    }]);
    expect(lookLocked).toBe(false);
  });

  it('键盘、鼠标接管与拾取都会取消倒计时并不再自动执行', () => {
    showOpening();
    finishTurn();
    bus.emit('world:inputTakeover');
    roomRuntime.tick?.(10);
    enter('S3');
    roomRuntime.tick?.(1);
    expect(cutscenes).toEqual([]);

    bus.emit('game:start');
    enter('S1');
    showOpening();
    finishTurn();
    bus.emit('scene:interact', { sceneId: 'S3', targetId: 'culture-shirt' });
    expect(visible.get('culture-shirt')).toBe(false);
    roomRuntime.tick?.(10);
    expect(cutscenes).toEqual([]);
  });

  it('倒计时武装后仍可被输入取消，手机与过场锁期间暂停', () => {
    showOpening();
    finishTurn();
    modalBlocked = true;
    roomRuntime.tick?.(6);
    expect(cutscenes).toEqual([]);
    modalBlocked = false;
    cinematic = true;
    roomRuntime.tick?.(6);
    cinematic = false;
    roomRuntime.tick?.(5);
    bus.emit('world:inputTakeover');
    enter('S3');
    roomRuntime.tick?.(1);
    expect(cutscenes).toEqual([]);
  });

  it('同一房间重复进入不重启提示，新档才重置等待', () => {
    showOpening();
    finishTurn();
    const historyLength = yawHistory.length;
    enter('S2');
    enter('S1');
    roomRuntime.tick?.(1);
    expect(yawHistory.length).toBe(historyLength);
    bus.emit('game:start');
    showOpening();
    roomRuntime.tick?.(0.251);
    roomRuntime.tick?.(0.001);
    expect(yawHistory.length).toBeGreaterThan(historyLength);
  });

  it('倒计时最后两秒触发 audio:tick，且自动出门顺带收起证件袋光点', () => {
    let ticks = 0;
    bus.on('audio:tick', () => { ticks += 1; });
    showOpening();
    finishTurn();
    for (let i = 0; i < 10; i += 1) roomRuntime.tick?.(0.5);
    expect(ticks).toBe(2);
    enter('S3');
    roomRuntime.tick?.(0.2);
    expect(visible.get('document-bag')).toBe(false);
    expect(cutscenes).toHaveLength(1);
  });
});

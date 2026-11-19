import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../core/eventBus';
import { CutscenePlayer } from './CutscenePlayer';
import type { ExitAnchor } from './worldSceneTypes';

interface RecordedTween {
  target: object;
  vars: {
    duration: number;
    progress?: number;
    opacity?: number;
    ease?: string;
    onUpdate?: () => void;
  };
  at: number;
}

// 只记录播放器用到的 timeline 接口；手动驱动插值值，不依赖 DOM 或真实时钟。
const animation = vi.hoisted(() => ({
  tweens: [] as RecordedTween[],
  complete: () => {},
  kill: vi.fn(),
}));

vi.mock('gsap', () => ({
  gsap: {
    set: vi.fn((target: { style: Record<string, string> }, vars: Record<string, string | number>) => {
      for (const [key, value] of Object.entries(vars)) target.style[key] = String(value);
    }),
    killTweensOf: vi.fn(),
    timeline: vi.fn((options: { onComplete: () => void }) => {
      animation.complete = options.onComplete;
      const timeline = {
        to(target: object, vars: RecordedTween['vars'], at: number) {
          animation.tweens.push({ target, vars, at });
          return timeline;
        },
        kill: animation.kill,
      };
      return timeline;
    }),
  },
}));

function updateMotion(index: number, progress: number): void {
  const tween = animation.tweens.filter(({ vars }) => vars.progress !== undefined)[index];
  (tween.target as { progress: number }).progress = progress;
  tween.vars.onUpdate?.();
}

describe('CutscenePlayer 出门过场', () => {
  let bus: EventBus;
  let camera: THREE.PerspectiveCamera;
  let player: CutscenePlayer;
  let anchor: ExitAnchor | null;
  let fadeEl: HTMLElement;
  let canvas: HTMLCanvasElement;
  let button: { hidden: boolean; addEventListener: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  let setCinematic: ReturnType<typeof vi.fn<(value: boolean) => void>>;
  let onEnd: ReturnType<typeof vi.fn<(payload: { stepId: string }) => void>>;

  function playRun(): void {
    bus.emit('scene:cutscene', { stepId: 'exit-step', key: 's3-run', durationMs: 3000, skippable: false });
  }

  function exitDirection(): THREE.Vector3 {
    return new THREE.Vector3(anchor!.position.x - camera.position.x, 0, anchor!.position.z - camera.position.z).normalize();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    animation.tweens.length = 0;
    button = { hidden: true, addEventListener: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: () => button });
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
    canvas = { style: { filter: '' } } as HTMLCanvasElement;
    fadeEl = { style: { opacity: '0' } } as HTMLElement;
    camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 100);
    camera.rotation.order = 'YXZ';
    camera.position.set(0, 1.9, 0);
    // 故意不使用房间坐标，验证播放器只依赖当前场景提供的锚点。
    anchor = { position: { x: 4, y: 1.6, z: 2 }, stopDistance: 0.85 };
    bus = new EventBus();
    onEnd = vi.fn();
    bus.on('ui:dialogueEnd', onEnd);
    setCinematic = vi.fn();
    player = new CutscenePlayer({
      bus,
      canvas,
      fadeEl,
      skipHost: { appendChild: vi.fn() } as unknown as HTMLElement,
      camera,
      setCinematic,
      getPanoramaAnchor: () => null,
      getExitAnchor: () => anchor,
      getBaseFov: () => 62,
      getSceneKey: () => 'room',
    });
  });

  afterEach(() => {
    player.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('配置准备阶段时保留自由控制，准备结束再锁定并读取最新站位', () => {
    anchor!.preparationMs = 4200;
    playRun();
    expect(player.isPlaying()).toBe(true);
    expect(setCinematic).not.toHaveBeenCalledWith(true);
    expect(animation.tweens).toHaveLength(0);
    vi.advanceTimersByTime(4199);
    expect(animation.tweens).toHaveLength(0);
    camera.position.set(1, 1.6, 1);
    vi.advanceTimersByTime(1);
    expect(setCinematic).toHaveBeenCalledWith(true);
    expect(animation.tweens.length).toBeGreaterThan(0);
    updateMotion(0, 1);
    expect(camera.position.toArray()).toEqual([1, 1.6, 1]);
  });

  it('准备阶段被跳关打断后不再延迟播放', () => {
    anchor!.preparationMs = 4200;
    playRun();
    bus.emit('scene:transition', { fromSceneId: 'S3', toSceneId: 'S4', sceneKey: 'street', role: 'bystander', title: '' });
    vi.advanceTimersByTime(9000);
    expect(player.isPlaying()).toBe(false);
    expect(animation.tweens).toHaveLength(0);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it.each([
    [0, 0, 0, 0.4],
    [2, 1, Math.PI, -0.8],
    [-3, 4, -2.8, 0.25],
    [5, 6, 1.2, -0.3],
  ])('从站位 (%s, %s)、yaw=%s、pitch=%s 先原地转正再直行', (x, z, yaw, pitch) => {
    camera.position.set(x, 1.9, z);
    camera.rotation.set(pitch, yaw, 0);
    const start = camera.position.clone();
    const startRotation = camera.quaternion.clone();
    const direction = exitDirection();
    playRun();
    expect(camera.quaternion.angleTo(startRotation)).toBeCloseTo(0);

    for (const progress of [0, 0.25, 0.5, 1]) {
      updateMotion(0, progress);
      expect(camera.position.equals(start)).toBe(true);
    }
    expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(direction)).toBeLessThan(1e-6);

    let previousDistance = start.distanceTo(new THREE.Vector3(anchor!.position.x, start.y, anchor!.position.z));
    for (const progress of [0, 0.1, 0.3, 0.7, 1]) {
      updateMotion(1, progress);
      const dx = camera.position.x - start.x;
      const dz = camera.position.z - start.z;
      // XZ 位移始终共线、朝前，不叠加世界 X 横移；门在镜头中心且没有俯仰残留。
      expect(dx * direction.z - dz * direction.x).toBeCloseTo(0);
      expect(dx * direction.x + dz * direction.z).toBeGreaterThanOrEqual(0);
      expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(direction)).toBeLessThan(1e-6);
      expect(Math.abs(camera.position.y - start.y)).toBeLessThanOrEqual(0.014);
      const distance = Math.hypot(anchor!.position.x - camera.position.x, anchor!.position.z - camera.position.z);
      expect(distance).toBeLessThanOrEqual(previousDistance + 1e-9);
      expect(distance).toBeGreaterThanOrEqual(anchor!.stopDistance - 1e-9);
      previousDistance = distance;
    }
    expect(previousDistance).toBeCloseTo(anchor!.stopDistance);
    expect(camera.position.y).toBe(start.y);
  });

  it.each([0, 1e-8, 0.2, 0.85])('离门 %s 米时只转向，不越门、倒退或原地晃动', (distance) => {
    camera.position.set(anchor!.position.x - distance, 1.9, anchor!.position.z);
    camera.rotation.set(-0.6, 1.2, 0);
    const start = camera.position.clone();
    const startRotation = camera.quaternion.clone();
    playRun();
    updateMotion(0, 0.5);
    expect(camera.position.equals(start)).toBe(true);
    updateMotion(0, 1);
    for (const progress of [0, 0.1, 0.4, 0.8, 1]) {
      updateMotion(1, progress);
      expect(camera.position.equals(start)).toBe(true);
      if (distance > 1e-6) {
        expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(exitDirection())).toBeLessThan(1e-6);
      } else {
        expect(camera.quaternion.angleTo(startRotation)).toBeCloseTo(0);
      }
    }
  });

  it.each([[179, -179], [-179, 179]])('朝向从 %s° 到 %s° 跨边界时只走最短 2°', (from, to) => {
    const targetYaw = THREE.MathUtils.degToRad(to);
    camera.rotation.set(0, THREE.MathUtils.degToRad(from), 0);
    anchor = { position: { x: -Math.sin(targetYaw) * 5, y: 1.6, z: -Math.cos(targetYaw) * 5 }, stopDistance: 0.85 };
    const startRotation = camera.quaternion.clone();
    playRun();
    updateMotion(0, 0.5);
    const middleRotation = camera.quaternion.clone();
    expect(startRotation.angleTo(middleRotation)).toBeCloseTo(THREE.MathUtils.degToRad(1));
    expect(camera.getWorldDirection(new THREE.Vector3()).z).toBeGreaterThan(0.999);
    updateMotion(0, 1);
    expect(startRotation.angleTo(camera.quaternion)).toBeCloseTo(THREE.MathUtils.degToRad(2));
    expect(middleRotation.angleTo(camera.quaternion)).toBeCloseTo(THREE.MathUtils.degToRad(1));
  });

  it('总长 3 秒、末 0.4 秒黑幕，自然结束只推进一次并释放过场锁', () => {
    playRun();
    const [turn, run, fade] = animation.tweens;
    expect(turn.at).toBe(0);
    expect(turn.vars.duration).toBe(0.35);
    expect(turn.vars.ease).toBe('power1.inOut');
    expect(run.at).toBe(0.35);
    expect(run.vars.duration).toBe(2.65);
    expect(fade.target).toBe(fadeEl);
    expect(fade.at).toBe(2.6);
    expect(fade.vars.duration).toBe(0.4);
    expect(fade.vars.opacity).toBe(1);
    expect(Math.max(...animation.tweens.map(({ at, vars }) => at + vars.duration))).toBe(3);
    expect(fadeEl.style.opacity).toBe('0');
    expect(setCinematic.mock.calls).toEqual([[true]]);
    vi.advanceTimersByTime(2999);
    expect(onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    updateMotion(0, 1);
    updateMotion(1, 1);
    animation.complete();
    animation.complete();
    vi.advanceTimersByTime(1000);
    expect(onEnd).toHaveBeenCalledExactlyOnceWith({ stepId: 'exit-step' });
    expect(setCinematic.mock.calls).toEqual([[true], [false]]);
    expect(animation.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(player.isPlaying()).toBe(false);
    expect(fadeEl.style.opacity).toBe('1');
  });

  it('动画未完成时仍在 3.8 秒硬超时兜底，且不会重复推进', () => {
    playRun();
    updateMotion(0, 1);
    updateMotion(1, 0.4);
    vi.advanceTimersByTime(3799);
    expect(onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    animation.complete();
    expect(onEnd).toHaveBeenCalledExactlyOnceWith({ stepId: 'exit-step' });
    expect(camera.position.y).toBe(1.9);
    expect(animation.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['cancel', 'dispose'])('%s 清理动画、步态和定时器，不发推进事件', (action) => {
    playRun();
    updateMotion(0, 1);
    updateMotion(1, 0.4);
    expect(camera.position.y).not.toBe(1.9);
    fadeEl.style.opacity = '0.5';
    if (action === 'dispose') {
      player.dispose();
      expect(button.remove).toHaveBeenCalledOnce();
      // 销毁后不再响应事件。
      playRun();
    } else {
      bus.emit('scene:transition', {
        fromSceneId: 'S3', toSceneId: 'S1', sceneKey: 'room', role: 'bystander', title: '房间',
      });
      expect(fadeEl.style.opacity).toBe('0');
    }
    animation.complete();
    vi.advanceTimersByTime(5000);
    expect(onEnd).not.toHaveBeenCalled();
    expect(player.isPlaying()).toBe(false);
    expect(animation.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(camera.position.y).toBe(1.9);
    expect(camera.rotation.z).toBe(0);
    expect(canvas.style.filter).toBe('');
    expect(button.hidden).toBe(true);
    expect(setCinematic.mock.calls).toEqual([[true], [false]]);
  });

  it('无出口配置时不猜目标位置，原地等到原定时长结束', () => {
    anchor = null;
    camera.rotation.set(-0.4, 2, 0);
    const start = camera.position.clone();
    const startRotation = camera.quaternion.clone();
    playRun();
    expect(animation.tweens[0].vars.duration).toBe(3);
    expect(camera.position.equals(start)).toBe(true);
    expect(camera.quaternion.angleTo(startRotation)).toBeCloseTo(0);
    animation.complete();
    expect(onEnd).toHaveBeenCalledExactlyOnceWith({ stepId: 'exit-step' });
  });
});

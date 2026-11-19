import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FirstPersonController } from './FirstPersonController';
import type { FirstPersonCallbacks } from './FirstPersonController';

type Listener = (event: unknown) => void;

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

let fakeWindow: FakeEventTarget;
let fakeDocument: FakeEventTarget & {
  pointerLockElement: Element | null;
  exitPointerLock: () => void;
};
let domElement: FakeEventTarget;
let camera: THREE.PerspectiveCamera;

function installDom(): void {
  fakeWindow = new FakeEventTarget();
  fakeDocument = Object.assign(new FakeEventTarget(), {
    pointerLockElement: null as Element | null,
    exitPointerLock: () => undefined,
  });
  domElement = new FakeEventTarget();

  const globals = globalThis as unknown as { window: unknown; document: unknown };
  globals.window = fakeWindow;
  globals.document = fakeDocument;
}

function createController(callbacks: FirstPersonCallbacks = {}): FirstPersonController {
  camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 120);
  return new FirstPersonController({
    camera,
    domElement: domElement as unknown as HTMLElement,
    scene: new THREE.Scene(),
    spawn: { x: 0, z: 0, yaw: 0, pitchDeg: 0 },
    navigation: {
      bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
      obstacles: [],
    },
    callbacks,
  });
}

function pressKey(code: string, repeat = false): void {
  fakeWindow.dispatch('keydown', {
    code,
    repeat,
    preventDefault: vi.fn(),
  });
}

function releaseKey(code: string): void {
  fakeWindow.dispatch('keyup', { code });
}

describe('FirstPersonController 疾跑开关', () => {
  let controller: FirstPersonController;

  beforeEach(() => {
    installDom();
  });

  afterEach(() => {
    controller?.dispose();
  });

  it('单击 Shift 开启，再单击关闭，并通知 HUD', () => {
    const onChange = vi.fn();
    controller = createController({ onSprintToggleChange: onChange });

    expect(controller.isSprintToggled()).toBe(false);

    pressKey('ShiftLeft');
    expect(controller.isSprintToggled()).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(true);

    pressKey('ShiftRight');
    expect(controller.isSprintToggled()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('过滤 repeat 连发，长按不会来回闪烁', () => {
    controller = createController();

    pressKey('ShiftLeft');
    expect(controller.isSprintToggled()).toBe(true);

    pressKey('ShiftLeft', true);
    pressKey('ShiftLeft', true);
    expect(controller.isSprintToggled()).toBe(true);

    pressKey('ShiftLeft');
    expect(controller.isSprintToggled()).toBe(false);
  });

  it('开启后移动使用疾跑速度，停步再走仍保持开启', () => {
    controller = createController();
    pressKey('ShiftLeft');

    pressKey('KeyW');
    controller.update(0.05);
    controller.update(0.05);
    expect(controller.isSprintToggled()).toBe(true);
    expect(camera.position.z).toBeGreaterThan(-0.4);
    expect(camera.position.z).toBeLessThan(-0.35);

    releaseKey('KeyW');
    controller.update(0.05);
    expect(controller.isSprintToggled()).toBe(true);

    pressKey('KeyW');
    controller.update(0.05);
    controller.update(0.05);
    expect(controller.isSprintToggled()).toBe(true);
    expect(camera.position.z).toBeLessThan(-0.7);
  });

  it('显式环视模式不响应 Shift', () => {
    controller = createController();
    controller.setLookOnly(true);

    pressKey('ShiftLeft');
    expect(controller.isSprintToggled()).toBe(false);
  });

  it.each([
    ['lockControls', (c: FirstPersonController) => c.lockControls()],
    ['setCinematic(true)', (c: FirstPersonController) => c.setCinematic(true)],
    ['setTransitionLocked(true)', (c: FirstPersonController) => c.setTransitionLocked(true)],
    ['setLookOnly(true)', (c: FirstPersonController) => c.setLookOnly(true)],
    ['setSpawn', (c: FirstPersonController) => c.setSpawn({ x: 1, z: 1, yaw: 0 })],
  ])('%s 会自动复位疾跑', (_name, reset) => {
    controller = createController();
    pressKey('ShiftLeft');
    expect(controller.isSprintToggled()).toBe(true);

    reset(controller);
    expect(controller.isSprintToggled()).toBe(false);
  });

  it('未设置环视限制时可以直接走动，手机锁定后停止', () => {
    controller = createController();
    pressKey('KeyW');
    controller.update(0.05);
    expect(camera.position.z).toBeLessThan(0);
    controller.lockControls();
    const position = camera.position.clone();
    pressKey('KeyW');
    controller.update(0.05);
    expect(camera.position.x).toBe(position.x);
    expect(camera.position.z).toBe(position.z);
    expect(controller.getMoveSpeed()).toBe(0);
    controller.unlockControls();
    pressKey('KeyW');
    controller.update(0.05);
    expect(camera.position.z).toBeLessThan(position.z);
  });

  it('脚底与相机高度沿平台同步，上台后不回落平地', () => {
    controller = createController();
    controller.setNavigation({
      bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, obstacles: [],
      surfaces: [{ minX: -2, maxX: 2, minZ: -10, maxZ: -0.1, height: 0.42 }],
    });
    const eyeHeight = camera.position.y;
    pressKey('KeyW');
    for (let i = 0; i < 20; i += 1) controller.update(0.05);
    expect(controller.getFeetPosition().y).toBeCloseTo(0.42);
    expect(camera.position.y).toBeGreaterThan(eyeHeight + 0.39);
    releaseKey('KeyW');
    controller.update(0.05);
    expect(controller.getFeetPosition().y).toBeCloseTo(0.42);
  });

  it('dispose 复位疾跑并移除输入监听', () => {
    controller = createController();
    pressKey('ShiftLeft');
    expect(controller.isSprintToggled()).toBe(true);

    controller.dispose();
    expect(controller.isSprintToggled()).toBe(false);
    expect(fakeWindow.listenerCount('keydown')).toBe(0);
    expect(domElement.listenerCount('pointerdown')).toBe(0);
  });
});
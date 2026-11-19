import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FirstPersonController } from './FirstPersonController';
import type { FirstPersonCallbacks } from './FirstPersonController';
import { FIRST_PERSON_CONFIG } from './worldConfig';

type Listener = (event: unknown) => void;

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly capturedPointers = new Set<number>();
  rect = { left: 0, top: 0, width: 800, height: 450 };
  readonly requestPointerLock = vi.fn();

  getBoundingClientRect(): typeof this.rect {
    return this.rect;
  }

  setPointerCapture(pointerId: number): void {
    this.capturedPointers.add(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.capturedPointers.has(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.capturedPointers.delete(pointerId);
  }

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
let scene: THREE.Scene;
let pointerTime = 0;

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
  scene = new THREE.Scene();
  return new FirstPersonController({
    camera,
    domElement: domElement as unknown as HTMLElement,
    scene,
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

function dispatchPointer(type: string, overrides: Partial<PointerEvent> = {}): void {
  domElement.dispatch(type, {
    pointerId: 1,
    pointerType: 'touch',
    button: 0,
    clientX: 400,
    clientY: 330,
    movementX: 0,
    movementY: 0,
    preventDefault: vi.fn(),
    ...overrides,
  });
}

function tap(at: number, clientX = 400, clientY = 330, pointerType = 'touch'): void {
  pointerTime = at - 10;
  dispatchPointer('pointerdown', { clientX, clientY, pointerType });
  pointerTime = at;
  camera.updateMatrixWorld(true);
  dispatchPointer('pointerup', { clientX, clientY, pointerType });
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

describe('FirstPersonController 触屏双击疾跑', () => {
  let controller: FirstPersonController;

  beforeEach(() => {
    installDom();
    pointerTime = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => pointerTime);
  });

  afterEach(() => {
    controller?.dispose();
    vi.restoreAllMocks();
  });

  it('单次有效地面轻点普通行走，落点圈保持冷白慢脉冲', () => {
    const onSprintChange = vi.fn();
    controller = createController({ onSprintToggleChange: onSprintChange });
    tap(100);
    controller.update(0.05);

    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);
    expect(camera.rotation.z).toBe(0);
    expect(controller.isSprintToggled()).toBe(false);
    expect(onSprintChange).not.toHaveBeenCalled();
    expect(domElement.hasPointerCapture(1)).toBe(false);
    const marker = scene.children[0] as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    expect(marker.visible).toBe(true);
    expect(marker.material.color.getHex()).toBe(0xdde8ee);
    expect(marker.scale.x).toBeCloseTo(1 + Math.sin(0.05 * 5) * 0.06);
  });

  it.each([
    [320, 48, 0, true],
    [321, 0, 0, false],
    [100, 49, 0, false],
    [100, 0, 48, true],
    [100, 34, 34, false],
  ])('间隔 %dms、偏移 (%d, %d)px 的双击：疾跑=%s', (interval, dx, dy, sprint) => {
    controller = createController();
    tap(100);
    tap(100 + interval, 400 + dx, 330 + dy);
    controller.update(0.05);

    expect(controller.getMoveSpeed()).toBeCloseTo(
      sprint ? FIRST_PERSON_CONFIG.sprintSpeed : FIRST_PERSON_CONFIG.walkSpeed,
    );
    expect(controller.isSprintToggled()).toBe(false);
  });

  it('双击使用疾跑 Bob，落点圈变暖金且脉冲加快', () => {
    const onSprintChange = vi.fn();
    controller = createController({ onSprintToggleChange: onSprintChange });
    tap(100);
    tap(200);
    controller.update(0.05);

    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.sprintSpeed);
    expect(Math.abs(camera.rotation.z)).toBeGreaterThan(0);
    const blend = 0.05 * 8;
    const bobAmp = FIRST_PERSON_CONFIG.bob.idleAmp +
      (FIRST_PERSON_CONFIG.bob.sprintAmp - FIRST_PERSON_CONFIG.bob.idleAmp) * blend;
    const bobFreq = FIRST_PERSON_CONFIG.bob.idleFreq +
      (FIRST_PERSON_CONFIG.bob.sprintFreq - FIRST_PERSON_CONFIG.bob.idleFreq) * blend;
    expect(camera.position.y).toBeCloseTo(
      FIRST_PERSON_CONFIG.eyeHeight + Math.sin(0.05 * bobFreq * Math.PI * 2) * bobAmp,
    );
    const marker = scene.children[0] as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    expect(marker.material.color.getHex()).toBe(0xf4c773);
    expect(marker.scale.x).toBeCloseTo(1 + Math.sin(0.05 * 9) * 0.06);
    expect(onSprintChange).not.toHaveBeenCalled();
  });

  it.each([
    [200, 449],
    [500, 400],
  ])('不匹配的有效轻点 (%dms, %dpx) 仍成为下一次双击的基准', (at, x) => {
    controller = createController();
    tap(100);
    tap(at, x);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);

    tap(at + 100, x + 1);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.sprintSpeed);

    tap(at + 500, x + 1);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);
  });

  it('到点当帧清除双击记录，并限制疾跑步长避免跨点震荡', () => {
    controller = createController();
    controller.setSpawn({ x: 0, z: 0, yaw: 0, pitchDeg: -70 });
    tap(100, 400, 335);
    tap(150, 400, 335);
    const marker = scene.children[0] as THREE.Mesh;
    const target = marker.position.clone();
    const distance = Math.hypot(target.x, target.z);
    expect(distance).toBeGreaterThan(FIRST_PERSON_CONFIG.autoWalkStopDistance);
    expect(FIRST_PERSON_CONFIG.sprintSpeed * 0.05 - distance)
      .toBeGreaterThan(FIRST_PERSON_CONFIG.autoWalkStopDistance);

    controller.update(0.05);
    expect(controller.getFeetPosition().x).toBeCloseTo(target.x);
    expect(controller.getFeetPosition().z).toBeCloseTo(target.z);
    // 不等待下一帧检查到达：紧接着的轻点必须已经是普通行走。
    tap(200, 400, 335);
    controller.update(0.005);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);

    for (let i = 0; i < 12; i += 1) controller.update(0.05);
    expect(controller.getMoveSpeed()).toBe(0);
    expect(marker.visible).toBe(false);
  });

  it('键盘接管立即停止触屏疾跑，按下抬起间没有 update 也会清除记录', () => {
    controller = createController();
    tap(100);
    tap(150);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.sprintSpeed);

    pressKey('KeyW');
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);
    releaseKey('KeyW');
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBe(0);

    tap(200);
    pressKey('KeyA');
    releaseKey('KeyA');
    tap(250);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);
  });

  it('触屏疾跑与桌面 Shift 开关独立，键盘接管仍遵守 Shift 契约', () => {
    const onSprintChange = vi.fn();
    controller = createController({ onSprintToggleChange: onSprintChange });
    pressKey('ShiftLeft');
    tap(100);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);
    tap(150);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.sprintSpeed);

    pressKey('KeyW');
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.sprintSpeed);
    releaseKey('KeyW');
    tap(200);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);
    expect(controller.isSprintToggled()).toBe(true);
    expect(onSprintChange).toHaveBeenCalledTimes(1);
    expect(onSprintChange).toHaveBeenCalledWith(true);
  });

  it.each([
    ['uiLock', (c: FirstPersonController) => c.lockControls(), (c: FirstPersonController) => c.unlockControls()],
    ['cinematic', (c: FirstPersonController) => c.setCinematic(true), (c: FirstPersonController) => c.setCinematic(false)],
    ['transition', (c: FirstPersonController) => c.setTransitionLocked(true), (c: FirstPersonController) => c.setTransitionLocked(false)],
    ['lookOnly', (c: FirstPersonController) => c.setLookOnly(true), (c: FirstPersonController) => c.setLookOnly(false)],
    ['setSpawn', (c: FirstPersonController) => c.setSpawn({ x: 0, z: 0, yaw: 0, pitchDeg: 0 }), (_c: FirstPersonController) => undefined],
    ['blur', (_c: FirstPersonController) => fakeWindow.dispatch('blur', {}), (_c: FirstPersonController) => undefined],
  ])('%s 停止自动疾跑，恢复后的首个轻点不误判为双击', (_name, reset, resume) => {
    controller = createController();
    tap(100);
    tap(150);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.sprintSpeed);

    reset(controller);
    const feet = controller.getFeetPosition();
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBe(0);
    expect(controller.getFeetPosition()).toEqual(feet);
    resume(controller);
    tap(200);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);
    tap(250);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.sprintSpeed);
  });

  it('三重锁互相独立，未全部释放时不接受触屏轻点或写过场相机', () => {
    const onTap = vi.fn(() => false);
    controller = createController({ onTap });
    tap(100);
    controller.lockControls();
    controller.setCinematic(true);
    controller.setTransitionLocked(true);
    camera.position.set(3, 4, 5);
    const cinematicPosition = camera.position.clone();
    tap(150);
    controller.update(0.05);
    expect(camera.position).toEqual(cinematicPosition);
    expect(onTap).toHaveBeenCalledTimes(1);

    controller.unlockControls();
    expect(controller.isEnabled()).toBe(false);
    tap(170);
    controller.setCinematic(false);
    expect(controller.isEnabled()).toBe(false);
    tap(180);
    controller.setTransitionLocked(false);
    expect(controller.isEnabled()).toBe(true);
    controller.update(0);
    tap(200);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);
    expect(onTap).toHaveBeenCalledTimes(2);
  });

  it('被交互消费的轻点不触发疾跑，也不与后续地面轻点拼成双击', () => {
    const onTap = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true).mockReturnValue(false);
    controller = createController({ onTap });
    tap(100);
    controller.update(0.05);
    tap(150);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);

    tap(200);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);
    tap(250);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.sprintSpeed);
    expect(domElement.requestPointerLock).not.toHaveBeenCalled();
  });

  it('连续消费的交互轻点完全不启动寻路', () => {
    controller = createController({ onTap: () => true });
    tap(100);
    tap(150);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBe(0);
    expect(scene.children[0].visible).toBe(false);
  });

  it('无地面轻点既不能作为首击，也会打断已有有效轻点记录', () => {
    controller = createController();
    tap(100, 400, 220);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBe(0);
    expect(scene.children[0].visible).toBe(false);

    // 地平线上下仅差 10px，避免仅靠双击距离排除无效轻点。
    tap(150, 400, 230);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);
    tap(200, 400, 220);
    tap(250, 400, 230);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);
    tap(300, 400, 230);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.sprintSpeed);
  });

  it.each(['width', 'height'] as const)('画布 %s 为零的无效轻点不污染记录', (dimension) => {
    controller = createController();
    tap(100);
    const original = domElement.rect[dimension];
    domElement.rect[dimension] = 0;
    tap(150);
    domElement.rect[dimension] = original;
    tap(200);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);
  });

  it('落点过近不能启动寻路，也不能保留双击记录', () => {
    controller = createController();
    controller.setSpawn({ x: 0, z: 0, yaw: 0, pitchDeg: -70 });
    tap(100, 400, 330);
    tap(150, 400, 365);
    tap(200, 400, 330);
    controller.update(0.01);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);
  });

  it.each([true, false])('触屏拖拽清除记录（存在 pointermove=%s），抬手不当作轻点', (withMove) => {
    const onTap = vi.fn(() => false);
    controller = createController({ onTap });
    tap(100);
    pointerTime = 150;
    dispatchPointer('pointerdown');
    if (withMove) {
      dispatchPointer('pointermove', { clientX: 420 });
      dispatchPointer('pointermove', { clientX: 400 });
    }
    pointerTime = 160;
    dispatchPointer('pointerup', { clientX: withMove ? 400 : 420 });
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(domElement.hasPointerCapture(1)).toBe(false);

    tap(200);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);
  });

  it('pointercancel 释放捕获并打断双击记录，随后 pointerup 不触发轻点', () => {
    const onTap = vi.fn(() => false);
    controller = createController({ onTap });
    tap(100);
    pointerTime = 150;
    dispatchPointer('pointerdown');
    expect(domElement.hasPointerCapture(1)).toBe(true);
    dispatchPointer('pointercancel');
    expect(domElement.hasPointerCapture(1)).toBe(false);
    dispatchPointer('pointerup');
    expect(onTap).toHaveBeenCalledTimes(1);

    tap(200);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);
  });

  it('鼠标单击保持 PointerLock 契约，不能参加触屏双击', () => {
    controller = createController();
    tap(100, 400, 330, 'mouse');
    tap(150, 400, 330, 'mouse');
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBe(0);
    expect(domElement.requestPointerLock).toHaveBeenCalledTimes(2);

    tap(200);
    tap(250, 400, 330, 'mouse');
    tap(300);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);
  });

  it('贴墙卡住取消自动疾跑后，新地面轻点恢复普通行走', () => {
    controller = createController();
    const bounds = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
    controller.setNavigation({
      bounds,
      obstacles: [{ minX: -10, maxX: 10, minZ: -1, maxZ: -0.5 }],
    });
    tap(100);
    tap(150);
    for (let i = 0; i < 20; i += 1) controller.update(0.05);
    expect(controller.getMoveSpeed()).toBe(0);

    controller.setNavigation({ bounds, obstacles: [] });
    tap(200);
    controller.update(0.05);
    expect(controller.getMoveSpeed()).toBeCloseTo(FIRST_PERSON_CONFIG.walkSpeed);
  });
});
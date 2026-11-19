// world/FirstPersonController.ts —— 双端第一人称控制器
// 桌面：PointerLock / 鼠标拖拽兜底 / WASD + Shift；触摸：单指拖拽环视、轻点地面行走、双击地面疾跑。
// 只负责移动与视角，不修改剧情状态；与 core 的通信由 InteractionSystem 走事件总线。

import * as THREE from 'three';
import { FIRST_PERSON_CONFIG } from './worldConfig';
import type { FirstPersonConfig } from './worldConfig';
import { clampToNearestWalkable, distance2D, intersectGroundRay, resolveMovement, sampleGroundHeight } from './navMath';
import type { GroundSurface, ObstacleAabb, Vec2, WalkBounds } from './navMath';
import type { SceneSpawn } from './worldSceneTypes';

const MOVE_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);
const SPRINT_KEYS = new Set(['ShiftLeft', 'ShiftRight']);
const MOUSE_TAP_MAX_MOVE_PX = 6;
const TOUCH_DOUBLE_TAP_MAX_MS = 320;
const TOUCH_DOUBLE_TAP_MAX_DISTANCE_PX = 48;

interface PointerTrack {
  id: number;
  type: string;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  downAt: number;
}

export interface FirstPersonNavigation {
  bounds: WalkBounds;
  obstacles: ObstacleAabb[];
  groundY?: number;
  surfaces?: GroundSurface[];
}

export interface FirstPersonCallbacks {
  /** 轻点 / 单击画布：返回 true 表示已被交互消费，不再触发移动或 PointerLock */
  onTap?: (clientX: number, clientY: number) => boolean;
  /** PointerLock 状态下按左键，用于交互准星目标 */
  onPrimaryAction?: () => boolean;
  onPointerLockChange?: (locked: boolean) => void;
  onEnabledChange?: (enabled: boolean) => void;
  /** 桌面 Shift 疾跑开关状态变化（用于 HUD 角标） */
  onSprintToggleChange?: (active: boolean) => void;
}

export interface FirstPersonControllerOptions {
  camera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  scene: THREE.Scene;
  spawn: SceneSpawn;
  navigation: FirstPersonNavigation;
  config?: FirstPersonConfig;
  callbacks?: FirstPersonCallbacks;
}

export class FirstPersonController {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private readonly scene: THREE.Scene;
  private readonly config: FirstPersonConfig;
  private readonly callbacks: FirstPersonCallbacks;

  private navigation: FirstPersonNavigation;
  private groundY: number;
  private feet: Vec2;
  private yaw: number;
  private pitch: number;
  private readonly pitchLimit: number;

  /** uiLock（对话/手机面板等 2D 阻塞界面）持有 */
  private controlsLocked = false;
  /** 过场动画持有：为真时控制器完全让出相机 */
  private cinematic = false;
  /** 场景切换黑幕持有：淡出到淡入期间禁止输入 */
  private transitionLocked = false;
  private lookOnly = false;
  private pointerLocked = false;
  /** 桌面 Shift 开关：按一下开启，再按一下关闭 */
  private sprintToggled = false;

  private readonly keys = new Set<string>();
  private pointer: PointerTrack | null = null;
  private pointerMoved = false;

  private autoTarget: Vec2 | null = null;
  private autoWalkSprint = false;
  /** 只记录未被交互消费且能启动地面寻路的触屏轻点 */
  private lastGroundTap: { clientX: number; clientY: number; at: number } | null = null;
  private blockedTime = 0;
  /** 本帧实际移动速度（米/秒），供脚步音效等只读系统采样 */
  private currentSpeed = 0;

  private readonly marker: THREE.Mesh;
  private readonly markerMaterial: THREE.MeshBasicMaterial;
  private markerOpacity = 0;
  private markerHolding = false;
  private markerElapsed = 0;

  private bobAmp: number;
  private bobFreq: number;
  private bobPhase = 0;

  private readonly tapRaycaster = new THREE.Raycaster();

  constructor(options: FirstPersonControllerOptions) {
    this.camera = options.camera;
    this.domElement = options.domElement;
    this.scene = options.scene;
    this.config = options.config ?? FIRST_PERSON_CONFIG;
    this.callbacks = options.callbacks ?? {};

    this.navigation = options.navigation;
    this.groundY = options.navigation.groundY ?? 0;
    this.feet = { x: options.spawn.x, z: options.spawn.z };
    this.yaw = options.spawn.yaw ?? 0;
    this.pitch = THREE.MathUtils.degToRad(options.spawn.pitchDeg ?? -7);
    this.pitchLimit = THREE.MathUtils.degToRad(this.config.pitchLimitDeg);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -this.pitchLimit, this.pitchLimit);

    this.bobAmp = this.config.bob.idleAmp;
    this.bobFreq = this.config.bob.idleFreq;

    this.camera.rotation.order = 'YXZ';

    this.markerMaterial = new THREE.MeshBasicMaterial({
      color: 0xdde8ee,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.32, 40), this.markerMaterial);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.renderOrder = 2;
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.domElement.addEventListener('pointerup', this.handlePointerUp);
    this.domElement.addEventListener('pointercancel', this.handlePointerCancel);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);

    this.applyCamera(0, 0);
  }

  update(dt: number): void {
    const stepDt = Math.max(0, Math.min(dt, 0.05));
    this.currentSpeed = 0;

    if (this.cinematic) {
      // 过场独占相机：不写位置 / 旋转，由 CutscenePlayer 全权驱动
      return;
    }

    if (this.controlsLocked || this.transitionLocked) {
      this.updateMarker(stepDt);
      this.applyCamera(0, 0);
      return;
    }

    let forwardInput = 0;
    let strafeInput = 0;

    if (!this.lookOnly) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) forwardInput += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) forwardInput -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) strafeInput += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) strafeInput -= 1;
    }

    const keyMoving = forwardInput !== 0 || strafeInput !== 0;
    let sprinting = keyMoving && this.sprintToggled;

    let directionX = 0;
    let directionZ = 0;
    let speed = 0;
    let autoWalking = false;

    if (keyMoving) {
      this.cancelAutoWalk();
      const inputLength = Math.hypot(forwardInput, strafeInput);
      const forwardX = -Math.sin(this.yaw);
      const forwardZ = -Math.cos(this.yaw);
      const rightX = Math.cos(this.yaw);
      const rightZ = -Math.sin(this.yaw);
      const normalizedForward = forwardInput / inputLength;
      const normalizedStrafe = strafeInput / inputLength;
      directionX = forwardX * normalizedForward + rightX * normalizedStrafe;
      directionZ = forwardZ * normalizedForward + rightZ * normalizedStrafe;
      speed = sprinting ? this.config.sprintSpeed : this.config.walkSpeed;
    } else if (this.autoTarget) {
      autoWalking = true;
      const toTargetX = this.autoTarget.x - this.feet.x;
      const toTargetZ = this.autoTarget.z - this.feet.z;
      const targetDistance = Math.hypot(toTargetX, toTargetZ);

      if (targetDistance <= this.config.autoWalkStopDistance) {
        this.cancelAutoWalk();
        autoWalking = false;
      } else {
        directionX = toTargetX / targetDistance;
        directionZ = toTargetZ / targetDistance;
        sprinting = this.autoWalkSprint;
        speed = sprinting ? this.config.sprintSpeed : this.config.walkSpeed;
        // 疾跑的单帧步长可能跨过停止半径，限制到目标距离，避免来回震荡。
        if (stepDt > 0) speed = Math.min(speed, targetDistance / stepDt);
      }
    }

    let actualSpeed = 0;
    if (speed > 0 && (directionX !== 0 || directionZ !== 0)) {
      const beforeX = this.feet.x;
      const beforeZ = this.feet.z;
      const delta: Vec2 = { x: directionX * speed * stepDt, z: directionZ * speed * stepDt };

      this.feet = resolveMovement(
        this.feet,
        delta,
        this.navigation.bounds,
        this.navigation.obstacles,
        this.config.playerRadius,
      );

      const movedDistance = Math.hypot(this.feet.x - beforeX, this.feet.z - beforeZ);
      actualSpeed = stepDt > 0 ? movedDistance / stepDt : 0;

      if (autoWalking) {
        if (this.autoTarget && distance2D(this.feet, this.autoTarget) <= this.config.autoWalkStopDistance) {
          this.cancelAutoWalk();
        } else if (actualSpeed < this.config.stuckSpeedThreshold) {
          this.blockedTime += stepDt;
          if (this.blockedTime * 1000 >= this.config.stuckTimeoutMs) {
            // 贴墙原地踏步：自动停止寻路，落点圈随之淡出
            this.cancelAutoWalk();
          }
        } else {
          this.blockedTime = 0;
        }
      }
    } else {
      this.blockedTime = 0;
    }

    this.currentSpeed = actualSpeed;
    this.updateBob(stepDt, actualSpeed, sprinting);
    this.updateMarker(stepDt);
  }

  /** 本帧实际移动速度（米/秒）；被锁定 / 过场时为 0 */
  getMoveSpeed(): number {
    return this.currentSpeed;
  }

  private updateBob(dt: number, actualSpeed: number, sprinting: boolean): void {
    const moving = actualSpeed > 0.1;
    const bobConfig = this.config.bob;
    const targetAmp = moving ? (sprinting ? bobConfig.sprintAmp : bobConfig.walkAmp) : bobConfig.idleAmp;
    const targetFreq = moving ? (sprinting ? bobConfig.sprintFreq : bobConfig.walkFreq) : bobConfig.idleFreq;

    const blend = Math.min(1, dt * 8);
    this.bobAmp += (targetAmp - this.bobAmp) * blend;
    this.bobFreq += (targetFreq - this.bobFreq) * blend;
    this.bobPhase += dt * this.bobFreq * Math.PI * 2;

    const bobY = Math.sin(this.bobPhase) * this.bobAmp;
    const roll = sprinting && moving ? Math.sin(this.bobPhase * 0.5) * 0.006 : 0;
    this.applyCamera(bobY, roll);
  }

  getFeetPosition(): { x: number; y: number; z: number } {
    return { ...this.feet, y: sampleGroundHeight(this.feet, this.navigation.surfaces, this.navigation.groundY) };
  }

  private applyCamera(bobY: number, roll: number): void {
    this.groundY = sampleGroundHeight(this.feet, this.navigation.surfaces, this.navigation.groundY);
    this.camera.position.set(
      this.feet.x,
      this.groundY + this.config.eyeHeight + bobY,
      this.feet.z,
    );
    this.camera.rotation.set(this.pitch, this.yaw, roll);
  }

  private rotate(deltaX: number, deltaY: number, sensitivity: number): void {
    this.yaw -= deltaX * sensitivity;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - deltaY * sensitivity,
      -this.pitchLimit,
      this.pitchLimit,
    );
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.isBlocked()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    if (this.pointerLocked) {
      if (event.pointerType === 'mouse') this.callbacks.onPrimaryAction?.();
      return;
    }

    if (this.pointer) return;

    this.pointer = {
      id: event.pointerId,
      type: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      downAt: performance.now(),
    };
    this.pointerMoved = false;

    try {
      this.domElement.setPointerCapture(event.pointerId);
    } catch {
      // 指针已失效时部分浏览器会抛错，拖拽本身不受影响
    }

    if (event.pointerType === 'touch') event.preventDefault();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.isBlocked()) return;

    if (this.pointerLocked) {
      if (event.pointerType !== 'mouse') return;
      this.rotate(event.movementX, event.movementY, this.config.mouseSensitivity);
      return;
    }

    const pointer = this.pointer;
    if (!pointer || pointer.id !== event.pointerId) return;

    const deltaX = event.clientX - pointer.lastX;
    const deltaY = event.clientY - pointer.lastY;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;

    if (
      Math.abs(event.clientX - pointer.startX) > this.config.tapMaxMovePx ||
      Math.abs(event.clientY - pointer.startY) > this.config.tapMaxMovePx
    ) {
      this.pointerMoved = true;
      this.lastGroundTap = null;
    }

    const sensitivity =
      pointer.type === 'touch' ? this.config.touchSensitivity : this.config.dragSensitivity;
    this.rotate(deltaX, deltaY, sensitivity);

    if (event.pointerType === 'touch') event.preventDefault();
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const pointer = this.pointer;
    if (!pointer || pointer.id !== event.pointerId) return;

    const elapsed = performance.now() - pointer.downAt;
    const maxTapMove = pointer.type === 'mouse' ? MOUSE_TAP_MAX_MOVE_PX : this.config.tapMaxMovePx;
    const wasTap =
      !this.pointerMoved &&
      elapsed <= this.config.tapMaxDurationMs &&
      Math.abs(event.clientX - pointer.startX) <= maxTapMove &&
      Math.abs(event.clientY - pointer.startY) <= maxTapMove;

    this.releasePointer(event.pointerId);
    if (!this.isBlocked() && wasTap) {
      this.handleTap(event.clientX, event.clientY, pointer.type);
    } else {
      this.lastGroundTap = null;
    }
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    if (!this.pointer || this.pointer.id !== event.pointerId) return;
    this.releasePointer(event.pointerId);
    this.lastGroundTap = null;
  };

  private releasePointer(pointerId: number): void {
    this.pointer = null;
    this.pointerMoved = false;
    try {
      if (this.domElement.hasPointerCapture(pointerId)) {
        this.domElement.releasePointerCapture(pointerId);
      }
    } catch {
      // 忽略指针捕获释放错误
    }
  }

  private handleTap(clientX: number, clientY: number, pointerType: string): void {
    const consumed = this.callbacks.onTap?.(clientX, clientY) ?? false;
    if (consumed) {
      this.lastGroundTap = null;
      return;
    }

    if (pointerType === 'touch') {
      this.startTapMove(clientX, clientY);
    } else {
      this.lastGroundTap = null;
      this.requestPointerLock();
    }
  }

  private startTapMove(clientX: number, clientY: number): void {
    const previousTap = this.lastGroundTap;
    // 本次无有效地面、过近或被锁定时，不得留下可拼成双击的记录。
    this.lastGroundTap = null;
    if (this.isBlocked() || this.lookOnly) return;

    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.tapRaycaster.setFromCamera(ndc, this.camera);

    const hitPoint = intersectGroundRay(
      this.tapRaycaster.ray.origin, this.tapRaycaster.ray.direction,
      this.navigation.surfaces, this.navigation.groundY,
    );
    if (!hitPoint) return;

    const target = clampToNearestWalkable({ x: hitPoint.x, z: hitPoint.z }, this.navigation.bounds);
    if (distance2D(this.feet, target) <= this.config.autoWalkStopDistance) return;

    const now = performance.now();
    this.autoWalkSprint = previousTap !== null &&
      now - previousTap.at <= TOUCH_DOUBLE_TAP_MAX_MS &&
      Math.hypot(clientX - previousTap.clientX, clientY - previousTap.clientY) <= TOUCH_DOUBLE_TAP_MAX_DISTANCE_PX;
    this.lastGroundTap = { clientX, clientY, at: now };
    this.autoTarget = target;
    this.blockedTime = 0;

    this.markerMaterial.color.setHex(this.autoWalkSprint ? 0xf4c773 : 0xdde8ee);
    this.marker.position.set(target.x, sampleGroundHeight(target, this.navigation.surfaces, this.navigation.groundY) + 0.02, target.z);
    this.marker.scale.setScalar(1);
    this.markerMaterial.opacity = 0.55;
    this.markerOpacity = 0.55;
    this.markerHolding = true;
    this.markerElapsed = 0;
    this.marker.visible = true;
  }

  private cancelAutoWalk(): void {
    this.autoTarget = null;
    this.autoWalkSprint = false;
    this.lastGroundTap = null;
    this.blockedTime = 0;
    this.markerHolding = false;
  }

  private updateMarker(dt: number): void {
    if (!this.marker.visible) return;

    this.markerElapsed += dt;
    if (this.markerHolding && this.autoTarget) {
      this.markerOpacity = 0.55;
    } else {
      this.markerOpacity = Math.max(0, this.markerOpacity - dt * 1.8);
    }

    this.markerMaterial.opacity = this.markerOpacity;
    if (this.markerOpacity <= 0.001) {
      this.marker.visible = false;
      return;
    }

    const pulse = 1 + Math.sin(this.markerElapsed * (this.autoWalkSprint ? 9 : 5)) * 0.06;
    this.marker.scale.setScalar(pulse);
  }

  private requestPointerLock(): void {
    if (this.isBlocked() || this.pointerLocked) return;
    try {
      const result = this.domElement.requestPointerLock() as unknown as
        | Promise<void>
        | undefined;
      if (result && typeof result.catch === 'function') {
        result.catch(() => undefined);
      }
    } catch {
      // 不支持 PointerLock 的环境保留拖拽环视兜底
    }
  }

  private readonly handlePointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.domElement;
    if (locked === this.pointerLocked) return;

    this.pointerLocked = locked;
    if (locked) {
      this.pointer = null;
      this.pointerMoved = false;
      this.lastGroundTap = null;
    }
    this.callbacks.onPointerLockChange?.(locked);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.isBlocked()) return;
    // 长按的系统连发不得反复切换疾跑
    if (event.repeat) return;
    if (MOVE_KEYS.has(event.code)) {
      this.keys.add(event.code);
      this.cancelAutoWalk();
      event.preventDefault();
      return;
    }
    if (SPRINT_KEYS.has(event.code)) {
      if (this.lookOnly) return;
      event.preventDefault();
      this.setSprintToggled(!this.sprintToggled);
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly handleBlur = (): void => {
    this.keys.clear();
    this.pointer = null;
    this.pointerMoved = false;
    this.cancelAutoWalk();
  };

  /**
   * 锁定控制（uiLock：弹出 2D 手机 / 对话时调用）；会主动释放 PointerLock。
   * 与过场 / 切图黑幕的三重锁相互独立，任意一把锁在即禁止输入。
   */
  lockControls(): void {
    if (this.controlsLocked) return;
    this.controlsLocked = true;
    this.keys.clear();
    this.pointer = null;
    this.pointerMoved = false;
    this.cancelAutoWalk();
    this.setSprintToggled(false);

    this.exitPointerLock();
    this.notifyEnabledChanged();
  }

  unlockControls(): void {
    if (!this.controlsLocked) return;
    this.controlsLocked = false;
    this.notifyEnabledChanged();
  }

  /** 过场动画专用：为真时控制器完全让出相机，不写位置与旋转 */
  setCinematic(value: boolean): void {
    if (this.cinematic === value) return;
    this.cinematic = value;
    if (value) {
      this.keys.clear();
      this.pointer = null;
      this.pointerMoved = false;
      this.cancelAutoWalk();
      this.setSprintToggled(false);
      this.exitPointerLock();
    }
    this.notifyEnabledChanged();
  }

  /** 场景切换黑幕专用：淡出到淡入期间禁止输入 */
  setTransitionLocked(value: boolean): void {
    if (this.transitionLocked === value) return;
    this.transitionLocked = value;
    if (value) {
      this.keys.clear();
      this.pointer = null;
      this.pointerMoved = false;
      this.cancelAutoWalk();
      this.setSprintToggled(false);
      this.exitPointerLock();
    }
    this.notifyEnabledChanged();
  }

  /** S1 起床等场景：只允许转视角，不允许移动与轻点寻路 */
  setLookOnly(value: boolean): void {
    if (this.lookOnly === value) return;
    this.lookOnly = value;
    if (value) {
      this.cancelAutoWalk();
      this.setSprintToggled(false);
    }
  }

  setNavigation(navigation: FirstPersonNavigation): void {
    this.navigation = navigation;
    this.groundY = navigation.groundY ?? 0;
    this.feet = clampToNearestWalkable(this.feet, navigation.bounds);
    this.applyCamera(0, 0);
  }

  setSpawn(spawn: SceneSpawn): void {
    this.feet = { x: spawn.x, z: spawn.z };
    this.yaw = spawn.yaw ?? 0;
    this.pitch = THREE.MathUtils.clamp(
      THREE.MathUtils.degToRad(spawn.pitchDeg ?? -7),
      -this.pitchLimit,
      this.pitchLimit,
    );
    this.cancelAutoWalk();
    this.setSprintToggled(false);
    this.applyCamera(0, 0);
  }

  isEnabled(): boolean {
    return !this.isBlocked();
  }

  isLookOnly(): boolean {
    return this.lookOnly;
  }

  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  isSprintToggled(): boolean {
    return this.sprintToggled;
  }

  /** Shift 疾跑开关：状态切换时通知 HUD 角标 */
  private setSprintToggled(value: boolean): void {
    if (this.sprintToggled === value) return;
    this.sprintToggled = value;
    this.callbacks.onSprintToggleChange?.(value);
  }

  /** 三重锁中任意一把在即视为输入被禁止（HUD 隐藏、交互与注视暂停） */
  private isBlocked(): boolean {
    return this.controlsLocked || this.cinematic || this.transitionLocked;
  }

  private exitPointerLock(): void {
    if (document.pointerLockElement === this.domElement) {
      document.exitPointerLock();
    }
  }

  private notifyEnabledChanged(): void {
    this.callbacks.onEnabledChange?.(!this.isBlocked());
  }

  dispose(): void {
    this.cancelAutoWalk();
    this.sprintToggled = false;
    this.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.domElement.removeEventListener('pointermove', this.handlePointerMove);
    this.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.domElement.removeEventListener('pointercancel', this.handlePointerCancel);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);

    this.scene.remove(this.marker);
    this.marker.geometry.dispose();
    this.markerMaterial.dispose();
  }
}

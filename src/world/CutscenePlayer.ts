// world/CutscenePlayer.ts —— scene:cutscene 过场播放器
// 播放期间通过 setCinematic(true) 独占相机与输入；自然结束 / 跳过 / 被场景切换打断 / 销毁
// 都会完整复位副作用（画布模糊、相机横滚、FOV）。结束时回发 ui:dialogueEnd 推进状态机。
// 只切换 cinematic 锁，绝不调用 unlockControls()（不覆盖 uiLock 对 2D 界面的锁定）。

import * as THREE from 'three';
import { gsap } from 'gsap';
import type { EventBus, GameEvents } from '../core/eventBus';
import type { SceneKey } from '../data/storySchema';
import type { ExitAnchor, PanoramaAnchor } from './worldSceneTypes';
import './cutscenePlayer.css';

/** 硬超时兜底：过场时长 + 该缓冲毫秒后强制结束，防止动画异常导致状态机卡死 */
const HARD_TIMEOUT_BUFFER_MS = 800;
/** S6 全景 CG 的视野收紧比例（结束 / 跳过 / 打断时恢复） */
const PANORAMA_FOV_SCALE = 0.82;

type CutscenePayload = GameEvents['scene:cutscene'];

export interface CutscenePlayerOptions {
  bus: EventBus;
  /** s1-wake 会对其加模糊的画布 */
  canvas: HTMLCanvasElement;
  /** 黑幕元素（由 WorldApp 创建并持有，过场接管其透明度） */
  fadeEl: HTMLElement;
  /** 跳过按钮挂载点（与黑幕同层） */
  skipHost: HTMLElement;
  camera: THREE.PerspectiveCamera;
  /** 只切换过场锁（cinematic），不得触碰 controlsLocked / unlockControls */
  setCinematic: (value: boolean) => void;
  getPanoramaAnchor: () => PanoramaAnchor | null;
  getExitAnchor: () => ExitAnchor | null;
  getBaseFov: () => number;
  /** 当前装载的场景 key，用于判断切场是否复用同一 3D 场景 */
  getSceneKey: () => SceneKey;
}

interface ActiveCutscene {
  stepId: string;
  key: string;
}

export class CutscenePlayer {
  private readonly bus: EventBus;
  private readonly canvas: HTMLCanvasElement;
  private readonly fadeEl: HTMLElement;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly setCinematic: (value: boolean) => void;
  private readonly getPanoramaAnchor: () => PanoramaAnchor | null;
  private readonly getExitAnchor: () => ExitAnchor | null;
  private readonly getBaseFov: () => number;
  private readonly getSceneKey: () => SceneKey;

  private readonly skipButton: HTMLButtonElement;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly cameraStart = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();

  private active: ActiveCutscene | null = null;
  private timeline: gsap.core.Timeline | null = null;
  private hardTimeout = 0;
  private preparationTimer = 0;
  /** 出门步态的基准高度，打断时也要移除纵向起伏。 */
  private runBaseY: number | null = null;

  constructor(options: CutscenePlayerOptions) {
    this.bus = options.bus;
    this.canvas = options.canvas;
    this.fadeEl = options.fadeEl;
    this.camera = options.camera;
    this.setCinematic = options.setCinematic;
    this.getPanoramaAnchor = options.getPanoramaAnchor;
    this.getExitAnchor = options.getExitAnchor;
    this.getBaseFov = options.getBaseFov;
    this.getSceneKey = options.getSceneKey;

    this.skipButton = document.createElement('button');
    this.skipButton.className = 'cutscene-skip';
    this.skipButton.type = 'button';
    this.skipButton.textContent = '跳过';
    this.skipButton.hidden = true;
    this.skipButton.addEventListener('click', () => this.finish());
    options.skipHost.appendChild(this.skipButton);

    this.unsubscribers.push(
      options.bus.on('scene:cutscene', (payload) => this.play(payload)),
      // 场景切换 / 章节结束：立即打断并复位，不回发推进事件
      options.bus.on('scene:transition', (payload) => {
        // 同 sceneKey 切场不会重建 3D 场景，也不会再走黑幕，须主动清掉过场留下的黑幕
        this.cancel(payload.sceneKey === this.getSceneKey());
      }),
      options.bus.on('game:chapterEnd', () => this.cancel()),
    );
  }

  isPlaying(): boolean {
    return this.active !== null;
  }

  isAnimating(): boolean {
    return this.active !== null && this.preparationTimer === 0;
  }

  private play(payload: CutscenePayload): void {
    this.cancel();
    this.active = { stepId: payload.stepId, key: payload.key };
    const preparationMs = payload.immediate ? 0 : payload.key === 's3-run' ? this.getExitAnchor()?.preparationMs ?? 0 : 0;
    if (preparationMs > 0) {
      this.preparationTimer = window.setTimeout(() => {
        this.preparationTimer = 0;
        this.beginAnimation(payload);
      }, preparationMs);
      return;
    }
    this.beginAnimation(payload);
  }

  private beginAnimation(payload: CutscenePayload): void {
    this.setCinematic(true);
    // 接管 WorldApp 正在进行的黑幕淡入 / 淡出
    gsap.killTweensOf(this.fadeEl);

    const seconds = Math.max(0, payload.durationMs) / 1000;
    switch (payload.key) {
      case 's1-wake':
        this.playWake(seconds);
        break;
      case 's3-run':
        this.playRun(seconds);
        break;
      case 'school-gate-panorama':
      case 'platform-approach':
        this.playPanorama(seconds, payload.skippable);
        break;
      default:
        // 未知 key：保持黑屏静候时长，保证状态机可推进（story 数据中不存在未知 key）
        gsap.set(this.fadeEl, { opacity: 1 });
    }

    this.hardTimeout = window.setTimeout(
      () => this.finish(),
      Math.max(0, payload.durationMs) + HARD_TIMEOUT_BUFFER_MS,
    );
  }

  /** s1-wake：黑屏 → 画面渐亮去模糊 → 两次眨眼黑幕开合 */
  private playWake(seconds: number): void {
    const canvas = this.canvas;
    gsap.set(this.fadeEl, { opacity: 1 });
    gsap.set(canvas, { filter: 'blur(12px)' });

    const timeline = gsap.timeline({ onComplete: () => this.finish() });
    timeline
      .to(this.fadeEl, { opacity: 0, duration: 2.2, ease: 'power1.inOut' }, 0)
      .to(canvas, { filter: 'blur(0px)', duration: 2.4, ease: 'power1.out' }, 0)
      .to(this.fadeEl, { opacity: 1, duration: 0.08, ease: 'power1.in' }, 2.9)
      .to(this.fadeEl, { opacity: 0, duration: 0.16, ease: 'power1.out' }, 2.98)
      .to(this.fadeEl, { opacity: 1, duration: 0.08, ease: 'power1.in' }, 4.0)
      .to(this.fadeEl, { opacity: 0, duration: 0.16, ease: 'power1.out' }, 4.08)
      // 对齐时长兜底：动画即使提前播完也保持亮屏到 durationMs
      .to(this.fadeEl, { opacity: 0, duration: 0.01 }, Math.max(0, seconds - 0.01));
    this.timeline = timeline;
  }

  /** s3-run：先原地对准出口，再沿视线推进；末尾黑幕交给下一场景接管。 */
  private playRun(seconds: number): void {
    const camera = this.camera;
    const anchor = this.getExitAnchor();
    gsap.set(this.fadeEl, { opacity: 0 });

    const timeline = gsap.timeline({ onComplete: () => this.finish() });
    if (anchor) {
      const start = camera.position.clone();
      const direction = new THREE.Vector3(anchor.position.x - start.x, 0, anchor.position.z - start.z);
      const distance = direction.length();
      const hasDirection = distance > 1e-6;
      // 已进入停止半径时只转向；与锚点重合时保留朝向，避免零向量 lookAt 突跳。
      const travelDistance = hasDirection ? Math.max(0, distance - Math.max(0, anchor.stopDistance)) : 0;
      const target = start.clone().addScaledVector(direction.normalize(), travelDistance);
      const doorTarget = new THREE.Vector3(anchor.position.x, start.y, anchor.position.z);
      const startRotation = camera.quaternion.clone();
      const doorRotation = hasDirection
        ? new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(start, doorTarget, camera.up))
        : startRotation.clone();
      const turnSeconds = Math.min(0.35, seconds);
      const turn = { progress: 0 };
      const run = { progress: 0 };
      this.runBaseY = start.y;

      timeline
        .to(
          turn,
          {
            progress: 1,
            duration: turnSeconds,
            ease: 'power1.inOut',
            onUpdate: () => {
              // 四元数 slerp 自动走最短旋转路径；转身阶段绝不改变位置。
              camera.quaternion.slerpQuaternions(startRotation, doorRotation, turn.progress);
            },
          },
          0,
        )
        .to(
          run,
          {
            progress: 1,
            duration: Math.max(0, seconds - turnSeconds),
            ease: 'power1.in',
            onUpdate: () => {
              const progress = run.progress;
              camera.position.lerpVectors(start, target, progress);
              // 仅保留轻微纵向步态，首尾归零；近门无位移时也无晃动。
              camera.position.y += Math.sin(progress * 46) * 0.014 * Math.min(1, travelDistance)
                * 4 * progress * (1 - progress);
              if (hasDirection) {
                doorTarget.y = camera.position.y;
                camera.lookAt(doorTarget);
              }
            },
          },
          turnSeconds,
        );
    } else {
      // 未配置出口时原地等候，仍按剧情时长结束，不猜测场景或目标坐标。
      timeline.to({}, { duration: seconds }, 0);
    }

    const fadeSeconds = Math.min(0.4, seconds);
    timeline.to(this.fadeEl, { opacity: 1, duration: fadeSeconds, ease: 'power1.in' }, seconds - fadeSeconds);
    this.timeline = timeline;
  }

  /** school-gate-panorama：镜头缓缓推向校门全景占位；结束 / 跳过 / 打断恢复默认 FOV */
  private playPanorama(seconds: number, skippable: boolean): void {
    const camera = this.camera;
    const anchor = this.getPanoramaAnchor();
    const baseFov = this.getBaseFov();

    gsap.set(this.fadeEl, { opacity: 1 });
    if (skippable) this.skipButton.hidden = false;

    const timeline = gsap.timeline({ onComplete: () => this.finish() });
    timeline.to(this.fadeEl, { opacity: 0, duration: 1.2, ease: 'power1.inOut' }, 0);

    if (anchor) {
      this.cameraStart.copy(camera.position);
      this.cameraTarget.set(anchor.position.x, anchor.position.y, anchor.position.z);
      this.lookTarget.set(anchor.lookAt.x, anchor.lookAt.y, anchor.lookAt.z);

      const pan = { progress: 0 };
      timeline
        .to(
          pan,
          {
            progress: 1,
            duration: seconds,
            ease: 'power1.inOut',
            onUpdate: () => {
              camera.position.lerpVectors(this.cameraStart, this.cameraTarget, pan.progress);
              camera.lookAt(this.lookTarget);
            },
          },
          0,
        )
        .to(
          camera,
          {
            fov: baseFov * PANORAMA_FOV_SCALE,
            duration: seconds,
            ease: 'power1.inOut',
            onUpdate: () => camera.updateProjectionMatrix(),
          },
          0,
        );
    } else {
      // 无锚点（不应发生）：原地静候时长，只做黑幕淡入
      timeline.to(this.fadeEl, { opacity: 0, duration: Math.max(0.01, seconds) }, 0);
    }
    this.timeline = timeline;
  }

  /** 自然结束 / 跳过 / 硬超时：复位副作用并回发推进事件 */
  private finish(): void {
    const active = this.active;
    if (!active) return;
    this.stopActive();
    this.resetSideEffects(active.key);

    if (active.key === 's3-run') {
      // 结尾保持黑幕：WorldApp 的 S4 切图发现已全黑即跳过淡出，直接重建后淡入，防闪帧
      gsap.set(this.fadeEl, { opacity: 1 });
    } else {
      gsap.set(this.fadeEl, { opacity: 0 });
    }

    this.active = null;
    this.setCinematic(false);
    this.bus.emit('ui:dialogueEnd', { stepId: active.stepId });
  }

  /** 被 scene:transition / game:chapterEnd 打断：只复位副作用，不回发推进事件 */
  private cancel(resetFade = false): void {
    const active = this.active;
    if (!active) return;
    this.stopActive();
    this.resetSideEffects(active.key);
    this.active = null;
    this.setCinematic(false);
    // 同 sceneKey 切场不复用切图黑幕，过场残留的黑幕必须就地清除
    if (resetFade) gsap.set(this.fadeEl, { opacity: 0 });
  }

  private stopActive(): void {
    if (this.preparationTimer !== 0) {
      window.clearTimeout(this.preparationTimer);
      this.preparationTimer = 0;
    }
    this.timeline?.kill();
    this.timeline = null;
    if (this.hardTimeout !== 0) {
      window.clearTimeout(this.hardTimeout);
      this.hardTimeout = 0;
    }
    this.skipButton.hidden = true;
  }

  /** 过场副作用完整复位：模糊 / 横滚 / FOV，任何退出路径（含 dispose）都会走到 */
  private resetSideEffects(key: string): void {
    this.canvas.style.filter = '';
    this.camera.rotation.z = 0;
    if (key === 's3-run' && this.runBaseY !== null) {
      this.camera.position.y = this.runBaseY;
      this.runBaseY = null;
    }
    if (key === 'school-gate-panorama' || key === 'platform-approach') {
      this.camera.fov = this.getBaseFov();
      this.camera.updateProjectionMatrix();
    }
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.cancel();
    this.skipButton.remove();
  }
}

// world/WorldHud.ts —— 准星、注视蓄力圈、互动提示、鼠标释放提示与目标指引点
// 纯展示：不包含输入或剧情逻辑；容器默认 pointer-events:none，不拦截画布点击。

import './worldHud.css';
import type { InteractionHudBridge } from './InteractionSystem';

const GAZE_RING_RADIUS = 20;
const GAZE_RING_CIRCUMFERENCE = 2 * Math.PI * GAZE_RING_RADIUS;
const RELEASE_HINT_DURATION_MS = 2600;
const LOCK_PROMPT_FIRST_MS = 4000;
const LOCK_PROMPT_REAPPEAR_MS = 2000;
const LOCK_PROMPT_FADE_MS = 400;
const PICKUP_TOAST_DURATION_MS = 1800;
const RELEASE_TOAST_TEXT = '已释放鼠标（点击画面继续）';

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

interface TargetMarkerEntry {
  element: HTMLDivElement;
  x: number;
  y: number;
  clamped: boolean;
  angleRad: number;
}

export class WorldHud implements InteractionHudBridge {
  private readonly root: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly lockPrompt: HTMLDivElement;
  private readonly sprintHint: HTMLDivElement;
  private readonly gazeProgress: SVGCircleElement;
  private readonly markerLayer: HTMLDivElement;
  private readonly markers = new Map<string, TargetMarkerEntry>();
  private toastTimer = 0;
  private lockPromptTimer = 0;
  private lockPromptFadeTimer = 0;
  private lockPromptDesired = false;
  private lockPromptDismissed = false;
  private lockPromptNextDurationMs = LOCK_PROMPT_FIRST_MS;
  private releaseHintVisible = false;

  constructor(container: HTMLElement) {
    this.root = createElement('div', 'world-hud');
    this.root.setAttribute('aria-hidden', 'true');

    this.crosshair = createElement('div', 'world-hud__crosshair');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'world-hud__gaze');
    svg.setAttribute('viewBox', '0 0 48 48');

    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    track.setAttribute('class', 'world-hud__gaze-track');
    track.setAttribute('cx', '24');
    track.setAttribute('cy', '24');
    track.setAttribute('r', String(GAZE_RING_RADIUS));

    this.gazeProgress = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    this.gazeProgress.setAttribute('class', 'world-hud__gaze-progress');
    this.gazeProgress.setAttribute('cx', '24');
    this.gazeProgress.setAttribute('cy', '24');
    this.gazeProgress.setAttribute('r', String(GAZE_RING_RADIUS));
    this.gazeProgress.style.strokeDasharray = String(GAZE_RING_CIRCUMFERENCE);
    this.gazeProgress.style.strokeDashoffset = String(GAZE_RING_CIRCUMFERENCE);

    svg.append(track, this.gazeProgress);

    const dot = createElement('div', 'world-hud__crosshair-dot');
    this.crosshair.append(svg, dot);

    this.hint = createElement('div', 'world-hud__hint');
    const keyE = createElement('kbd', 'world-hud__kbd', 'E');
    const hintSep = createElement('span', 'world-hud__hint-sep', '/');
    const keyClick = createElement('kbd', 'world-hud__kbd', '左键');
    const hintLabel = createElement('span', 'world-hud__hint-label', '互动');
    this.hint.append(keyE, hintSep, keyClick, hintLabel);
    this.hint.hidden = true;

    this.toast = createElement('div', 'world-hud__toast', '已释放鼠标（点击画面继续）');
    this.toast.hidden = true;

    this.lockPrompt = createElement('div', 'world-hud__lock-prompt');
    this.lockPrompt.append(
      document.createTextNode('点击空白画面锁定准星视角（'),
      createElement('span', 'world-hud__key-highlight', 'ESC'),
      document.createTextNode(' 释放）'),
    );
    this.lockPrompt.hidden = true;

    this.sprintHint = createElement('div', 'world-hud__sprint');
    this.sprintHint.append(
      document.createTextNode('疾跑中（按 '),
      createElement('span', 'world-hud__key-highlight', 'Shift'),
      document.createTextNode(' 关闭）'),
    );
    this.sprintHint.hidden = true;

    this.markerLayer = createElement('div', 'world-hud__targets');

    this.root.append(
      this.crosshair,
      this.hint,
      this.lockPrompt,
      this.sprintHint,
      this.toast,
      this.markerLayer,
    );
    container.appendChild(this.root);
  }

  setAimed(aimed: boolean): void {
    this.crosshair.classList.toggle('is-aimed', aimed);
    this.hint.hidden = !aimed;
  }

  setGazeProgress(progress: number | null): void {
    if (progress === null || progress <= 0.001) {
      this.crosshair.classList.remove('is-gazing');
      this.gazeProgress.style.strokeDashoffset = String(GAZE_RING_CIRCUMFERENCE);
      return;
    }

    const clamped = Math.min(1, Math.max(0, progress));
    this.crosshair.classList.add('is-gazing');
    this.gazeProgress.style.strokeDashoffset = String(
      GAZE_RING_CIRCUMFERENCE * (1 - clamped),
    );
  }

  setTargets(
    markers: Array<{ id: string; x: number; y: number; clamped: boolean; angleRad: number }>,
  ): void {
    const activeIds = new Set<string>();

    for (const marker of markers) {
      activeIds.add(marker.id);
      let entry = this.markers.get(marker.id);

      if (!entry) {
        const element = createElement('div', 'world-hud__target');
        const dot = createElement('div', 'world-hud__target-dot');
        const arrow = createElement('div', 'world-hud__target-arrow');
        element.append(dot, arrow);
        this.markerLayer.appendChild(element);
        entry = {
          element,
          x: Number.NaN,
          y: Number.NaN,
          clamped: !marker.clamped,
          angleRad: Number.NaN,
        };
        this.markers.set(marker.id, entry);
      }

      const moved =
        Number.isNaN(entry.x)
        || Math.abs(marker.x - entry.x) >= 0.2
        || Math.abs(marker.y - entry.y) >= 0.2
        || marker.clamped !== entry.clamped
        || (marker.clamped && Math.abs(marker.angleRad - entry.angleRad) >= 0.004);
      if (moved) {
        const rotation = marker.clamped ? ` rotate(${marker.angleRad}rad)` : '';
        entry.element.style.transform = `translate3d(${marker.x}px, ${marker.y}px, 0)${rotation}`;
        if (entry.clamped !== marker.clamped) {
          entry.element.classList.toggle('is-clamped', marker.clamped);
        }
        entry.x = marker.x;
        entry.y = marker.y;
        entry.clamped = marker.clamped;
        entry.angleRad = marker.angleRad;
      }
    }

    const staleIds: string[] = [];
    for (const [id] of this.markers) {
      if (!activeIds.has(id)) staleIds.push(id);
    }
    for (const id of staleIds) {
      const entry = this.markers.get(id);
      entry?.element.remove();
      this.markers.delete(id);
    }
  }

  setControlsVisible(visible: boolean): void {
    this.root.hidden = !visible;
    if (!visible) this.hideReleaseHint();
  }

  /** 桌面自由控制态且未锁鼠时的轻量引导：首现 4 秒后渐隐，切换锁鼠态后短显 2 秒自动收起 */
  setLockPromptVisible(visible: boolean): void {
    const wasDesired = this.lockPromptDesired;
    this.lockPromptDesired = visible;
    if (!visible) {
      this.clearLockPromptTimers();
      this.lockPromptDismissed = false;
      this.lockPrompt.classList.remove('is-fading');
      this.lockPrompt.hidden = true;
      return;
    }
    if (!wasDesired) {
      this.lockPromptDismissed = false;
      this.scheduleLockPromptFade(this.lockPromptNextDurationMs);
      this.lockPromptNextDurationMs = LOCK_PROMPT_FIRST_MS;
    }
    this.updateLockPrompt();
  }

  /** 桌面疾跑状态角标；移动端由 WorldApp 侧关闭 */
  setSprintHintVisible(visible: boolean): void {
    this.sprintHint.hidden = !visible;
  }

  showPickupToast(message = '已放入口袋'): void {
    this.releaseHintVisible = false;
    this.toast.textContent = message;
    this.toast.hidden = false;
    this.updateLockPrompt();
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.hidden = true;
      this.toast.textContent = RELEASE_TOAST_TEXT;
    }, PICKUP_TOAST_DURATION_MS);
  }

  showReleaseHint(): void {
    this.releaseHintVisible = true;
    this.lockPromptDismissed = false;
    this.lockPromptNextDurationMs = LOCK_PROMPT_REAPPEAR_MS;
    this.clearLockPromptTimers();
    this.toast.textContent = RELEASE_TOAST_TEXT;
    this.toast.hidden = false;
    this.updateLockPrompt();
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.releaseHintVisible = false;
      this.toast.hidden = true;
      if (this.lockPromptDesired) this.scheduleLockPromptFade(LOCK_PROMPT_REAPPEAR_MS);
      this.updateLockPrompt();
    }, RELEASE_HINT_DURATION_MS);
  }

  hideReleaseHint(): void {
    window.clearTimeout(this.toastTimer);
    this.releaseHintVisible = false;
    this.toast.hidden = true;
    this.lockPromptNextDurationMs = LOCK_PROMPT_REAPPEAR_MS;
    this.updateLockPrompt();
  }

  private clearLockPromptTimers(): void {
    window.clearTimeout(this.lockPromptTimer);
    window.clearTimeout(this.lockPromptFadeTimer);
    this.lockPromptTimer = 0;
    this.lockPromptFadeTimer = 0;
  }

  private scheduleLockPromptFade(delayMs: number): void {
    this.clearLockPromptTimers();
    this.lockPrompt.classList.remove('is-fading');
    this.lockPromptTimer = window.setTimeout(() => {
      this.lockPromptTimer = 0;
      this.lockPrompt.classList.add('is-fading');
      this.lockPromptFadeTimer = window.setTimeout(() => {
        this.lockPromptFadeTimer = 0;
        this.lockPromptDismissed = true;
        this.lockPrompt.classList.remove('is-fading');
        this.updateLockPrompt();
      }, LOCK_PROMPT_FADE_MS);
    }, delayMs);
  }

  private updateLockPrompt(): void {
    this.lockPrompt.hidden = !this.lockPromptDesired || this.releaseHintVisible || this.lockPromptDismissed;
  }

  dispose(): void {
    window.clearTimeout(this.toastTimer);
    this.clearLockPromptTimers();
    for (const entry of this.markers.values()) entry.element.remove();
    this.markers.clear();
    this.root.remove();
  }
}

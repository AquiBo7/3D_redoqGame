// world/WorldHud.ts —— 准星、注视蓄力圈、互动提示、鼠标释放提示与目标指引点
// 纯展示：不包含输入或剧情逻辑；容器默认 pointer-events:none，不拦截画布点击。

import './worldHud.css';
import type { InteractionHudBridge } from './InteractionSystem';

const GAZE_RING_RADIUS = 20;
const GAZE_RING_CIRCUMFERENCE = 2 * Math.PI * GAZE_RING_RADIUS;
const RELEASE_HINT_DURATION_MS = 2600;

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
  private lockPromptDesired = false;
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

    this.hint = createElement('div', 'world-hud__hint', '[E / 左键] 互动');
    this.hint.hidden = true;

    this.toast = createElement('div', 'world-hud__toast', '已释放鼠标（点击画面继续）');
    this.toast.hidden = true;

    this.lockPrompt = createElement(
      'div',
      'world-hud__lock-prompt',
      '点击空白画面锁定准星视角（ESC 释放）',
    );
    this.lockPrompt.hidden = true;

    this.sprintHint = createElement('div', 'world-hud__sprint', '疾跑中（按 Shift 关闭）');
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
        entry = { element };
        this.markers.set(marker.id, entry);
      }

      const rotation = marker.clamped ? ` rotate(${marker.angleRad}rad)` : '';
      entry.element.style.transform = `translate3d(${marker.x}px, ${marker.y}px, 0)${rotation}`;
      entry.element.classList.toggle('is-clamped', marker.clamped);
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

  /** 桌面自由控制态且未锁鼠时的轻量引导 */
  setLockPromptVisible(visible: boolean): void {
    this.lockPromptDesired = visible;
    this.updateLockPrompt();
  }

  /** 桌面疾跑状态角标；移动端由 WorldApp 侧关闭 */
  setSprintHintVisible(visible: boolean): void {
    this.sprintHint.hidden = !visible;
  }

  showReleaseHint(): void {
    this.releaseHintVisible = true;
    this.toast.hidden = false;
    this.updateLockPrompt();
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.releaseHintVisible = false;
      this.toast.hidden = true;
      this.updateLockPrompt();
    }, RELEASE_HINT_DURATION_MS);
  }

  hideReleaseHint(): void {
    window.clearTimeout(this.toastTimer);
    this.releaseHintVisible = false;
    this.toast.hidden = true;
    this.updateLockPrompt();
  }

  private updateLockPrompt(): void {
    this.lockPrompt.hidden = !this.lockPromptDesired || this.releaseHintVisible;
  }

  dispose(): void {
    window.clearTimeout(this.toastTimer);
    for (const entry of this.markers.values()) entry.element.remove();
    this.markers.clear();
    this.root.remove();
  }
}

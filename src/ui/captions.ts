// ui/captions.ts —— 心声字幕与客观观察字幕
// 心声到点/轻点后回发 ui:dialogueEnd；客观观察只淡出，绝不回发推进事件，也不锁定控制。

import type { GameEvents } from '../core/eventBus';
import { createElement } from './uiDom';
import './captions.css';

type CaptionPayload = GameEvents['ui:showCaption'];

const FADE_MS = 380;
const MIN_VISIBLE_MS = 700;

export interface CaptionViewOptions {
  container: HTMLElement;
  onInnerEnd: (stepId: string) => void;
}

export class CaptionView {
  private readonly innerRoot: HTMLButtonElement;
  private readonly innerText: HTMLSpanElement;
  private readonly observationRoot: HTMLDivElement;
  private readonly observationText: HTMLParagraphElement;
  private readonly onInnerEnd: (stepId: string) => void;

  private innerActive = false;
  private innerStepId = '';
  private innerFadeTimer = 0;
  private innerEndTimer = 0;
  private innerHideTimer = 0;

  private observationFadeTimer = 0;
  private observationHideTimer = 0;

  constructor(options: CaptionViewOptions) {
    this.onInnerEnd = options.onInnerEnd;

    this.innerRoot = createElement('button', 'caption caption--inner');
    this.innerRoot.type = 'button';
    this.innerRoot.hidden = true;
    this.innerRoot.setAttribute('aria-label', '轻点继续');
    this.innerText = createElement('span', 'caption__text', '');
    this.innerRoot.append(this.innerText);
    this.innerRoot.addEventListener('click', () => this.endInner());

    this.observationRoot = createElement('div', 'caption caption--observation');
    this.observationRoot.hidden = true;
    this.observationRoot.setAttribute('aria-live', 'polite');
    this.observationText = createElement('p', 'caption__text', '');
    this.observationRoot.append(this.observationText);

    options.container.append(this.innerRoot, this.observationRoot);
  }

  show(payload: CaptionPayload): void {
    if (payload.kind === 'inner') this.showInner(payload);
    else this.showObservation(payload);
  }

  clear(): void {
    this.clearInnerTimers();
    this.clearObservationTimers();
    this.innerActive = false;
    this.innerStepId = '';
    this.innerRoot.hidden = true;
    this.innerRoot.classList.remove('is-visible');
    this.observationRoot.hidden = true;
    this.observationRoot.classList.remove('is-visible');
  }

  dispose(): void {
    this.clear();
    this.innerRoot.remove();
    this.observationRoot.remove();
  }

  private showInner(payload: CaptionPayload): void {
    this.clearInnerTimers();
    this.innerActive = true;
    this.innerStepId = payload.stepId;
    this.innerText.textContent = payload.text;
    this.innerRoot.hidden = false;
    this.restartTransition(this.innerRoot);

    const duration = Math.max(MIN_VISIBLE_MS, payload.durationMs);
    this.innerFadeTimer = window.setTimeout(
      () => this.innerRoot.classList.remove('is-visible'),
      Math.max(0, duration - FADE_MS),
    );
    this.innerEndTimer = window.setTimeout(() => this.endInner(), duration);
  }

  private endInner(): void {
    if (!this.innerActive) return;

    const stepId = this.innerStepId;
    this.innerActive = false;
    this.innerStepId = '';
    this.clearInnerTimers();
    this.innerRoot.classList.remove('is-visible');
    this.innerHideTimer = window.setTimeout(() => {
      this.innerRoot.hidden = true;
    }, FADE_MS);

    this.onInnerEnd(stepId);
  }

  private showObservation(payload: CaptionPayload): void {
    this.clearObservationTimers();
    this.observationText.textContent = payload.text;
    this.observationRoot.hidden = false;
    this.restartTransition(this.observationRoot);

    const duration = Math.max(MIN_VISIBLE_MS, payload.durationMs);
    this.observationFadeTimer = window.setTimeout(
      () => this.observationRoot.classList.remove('is-visible'),
      Math.max(0, duration - FADE_MS),
    );
    this.observationHideTimer = window.setTimeout(() => {
      this.observationRoot.hidden = true;
    }, duration);
  }

  /** 重新触发 CSS 过渡（元素从 hidden 变为可见时也要重新计算起点） */
  private restartTransition(element: HTMLElement): void {
    element.classList.remove('is-visible');
    void element.offsetWidth;
    element.classList.add('is-visible');
  }

  private clearInnerTimers(): void {
    if (this.innerFadeTimer !== 0) window.clearTimeout(this.innerFadeTimer);
    if (this.innerEndTimer !== 0) window.clearTimeout(this.innerEndTimer);
    if (this.innerHideTimer !== 0) window.clearTimeout(this.innerHideTimer);
    this.innerFadeTimer = 0;
    this.innerEndTimer = 0;
    this.innerHideTimer = 0;
  }

  private clearObservationTimers(): void {
    if (this.observationFadeTimer !== 0) window.clearTimeout(this.observationFadeTimer);
    if (this.observationHideTimer !== 0) window.clearTimeout(this.observationHideTimer);
    this.observationFadeTimer = 0;
    this.observationHideTimer = 0;
  }
}

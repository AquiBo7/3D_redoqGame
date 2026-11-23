// ui/legalHintCard.ts —— [Y] 现实做法与法治提示卡
// 纯展示浮层：只呈现数据层给出的客观坐标，不判断选项，不显示任何数值。

import type { LegalHint } from '../data/legalHints';
import { createButton, createElement } from './uiDom';
import './legalHintCard.css';

export interface LegalHintCardCallbacks {
  onClose: () => void;
}

export class LegalHintCard {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly callbacks: LegalHintCardCallbacks;
  private visible = false;

  constructor(container: HTMLElement, callbacks: LegalHintCardCallbacks) {
    this.callbacks = callbacks;

    this.root = createElement('div', 'legal-hint');
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', '现实做法与法治参考');

    const panel = createElement('div', 'legal-hint__panel');
    this.body = createElement('div', 'legal-hint__body');
    const close = createButton('legal-hint__close', '知道了 · 返回选择（Y / Esc）');
    close.addEventListener('click', () => this.callbacks.onClose());
    panel.append(this.body, close);

    // 点击卡片以外的区域同样收起，避免在小屏上找不到关闭入口。
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.callbacks.onClose();
    });
    this.root.append(panel);
    container.append(this.root);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  open(hint: LegalHint): void {
    this.body.replaceChildren(...this.nodes(hint));
    this.body.scrollTop = 0;
    this.root.hidden = false;
    this.visible = true;
  }

  close(): void {
    if (!this.visible) return;
    this.root.hidden = true;
    this.visible = false;
  }

  dispose(): void {
    this.visible = false;
    this.root.remove();
  }

  private nodes(hint: LegalHint): HTMLElement[] {
    const nodes: HTMLElement[] = [
      createElement('p', 'legal-hint__eyebrow', '现实做法与法治参考'),
      createElement('h3', 'legal-hint__title', hint.title),
      this.block('现实常规做法', hint.hintPractice),
      this.lawBlock(hint),
      this.block('镜头外提醒', hint.hintBeyondFrame),
      createElement('p', 'legal-hint__note', '仅供现实参考，选择权仍在你手中。'),
    ];
    return nodes;
  }

  private block(label: string, text: string): HTMLElement {
    const wrapper = createElement('div', 'legal-hint__block');
    wrapper.append(
      createElement('h4', 'legal-hint__label', label),
      createElement('p', 'legal-hint__text', text),
    );
    return wrapper;
  }

  private lawBlock(hint: LegalHint): HTMLElement {
    const wrapper = createElement('div', 'legal-hint__block');
    wrapper.append(
      createElement('h4', 'legal-hint__label', '法治坐标'),
      createElement('p', 'legal-hint__law', hint.lawRef),
      createElement('p', 'legal-hint__text', hint.lawSummary),
    );
    return wrapper;
  }
}

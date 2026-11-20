// 黑幕字幕只负责呈现；结束交给 gameUi 通过事件总线推进。
import { createButton, createElement, isShortcutKey } from './uiDom';
import './intertitle.css';

export interface IntertitlePayload {
  stepId: string;
  lines: string[];
  lineDurationMs?: number;
  skippable?: boolean;
}

export class IntertitleView {
  private readonly root: HTMLElement;
  private readonly content: HTMLDivElement;
  private readonly skipButton: HTMLButtonElement;
  private readonly onEnd: (stepId: string) => void;
  private payload: IntertitlePayload | null = null;
  private lineIndex = 0;
  private timer = 0;
  private disposed = false;

  constructor(container: HTMLElement, onEnd: (stepId: string) => void) {
    this.onEnd = onEnd;
    this.root = createElement('section', 'intertitle');
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', '过场字幕');
    this.root.tabIndex = -1;
    this.content = createElement('div', 'intertitle__content');
    this.content.setAttribute('aria-live', 'polite');
    this.content.setAttribute('aria-atomic', 'true');
    this.skipButton = createButton('intertitle__skip', '跳过');
    this.skipButton.addEventListener('click', this.skip);
    this.root.append(this.content, this.skipButton);
    container.append(this.root);
    window.addEventListener('keydown', this.handleKeyDown, true);
  }

  show(payload: IntertitlePayload): void {
    if (this.disposed) return;
    this.hide();
    this.payload = { ...payload, lines: [...payload.lines] };
    this.lineIndex = 0;
    this.skipButton.hidden = payload.skippable === false;
    this.root.hidden = false;
    if (payload.lines.length === 0) {
      this.finish();
      return;
    }
    (this.skipButton.hidden ? this.root : this.skipButton).focus();
    this.renderLine();
  }

  // 被场景切换或另一个阻塞界面取消时，不推进已经失效的步骤。
  hide(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.payload = null;
    this.root.hidden = true;
    this.content.replaceChildren();
  }

  dispose(): void {
    this.disposed = true;
    this.hide();
    window.removeEventListener('keydown', this.handleKeyDown, true);
    this.skipButton.removeEventListener('click', this.skip);
    this.root.remove();
  }

  private renderLine(): void {
    const payload = this.payload;
    if (!payload) return;
    const requestedDuration = payload.lineDurationMs ?? 2000;
    const duration = Number.isFinite(requestedDuration) && requestedDuration > 0
      ? requestedDuration : 2000;
    // 每行新建节点让 CSS 动画独立启动，不依赖强制重排或 animationend。
    const line = createElement('p', 'intertitle__line', payload.lines[this.lineIndex]);
    line.style.animationDuration = `${duration}ms`;
    this.content.replaceChildren(line);
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.lineIndex += 1;
      if (this.lineIndex >= payload.lines.length) this.finish();
      else this.renderLine();
    }, duration);
  }

  private finish(): void {
    const payload = this.payload;
    if (!payload) return;
    // 在回调前清理，允许 core 同步打开下一段字幕且保证结束只触发一次。
    this.hide();
    this.onEnd(payload.stepId);
  }

  private readonly skip = (): void => {
    if (this.payload && this.payload.skippable !== false) this.finish();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.payload) return;
    if (!['Escape', 'Space', 'Enter'].some((code) => isShortcutKey(event, code))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.skip();
  };
}

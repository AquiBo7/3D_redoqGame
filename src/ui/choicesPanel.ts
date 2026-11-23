// ui/choicesPanel.ts —— 2–3 个自然口语选项
// 纯展示：不显示分数、对错或 trust/harm；点击后只把 choiceId 交给 gameUi。
// 命中关键节点时多一盏 [Y] 提示灯，只给现实与法治坐标，不替玩家决定。

import type { LegalHint } from '../data/legalHints';
import { getLegalHintByStepId } from '../data/legalHints';
import type { GameEvents } from '../core/eventBus';
import { LegalHintCard } from './legalHintCard';
import { createButton, createElement, isShortcutKey } from './uiDom';
import './dialogueBox.css';

type ChoicesPayload = GameEvents['ui:showChoices'];

export interface ChoicesPanelCallbacks {
  onChoose: (stepId: string, choiceId: string) => void;
  /** 返回 true 表示当前处于 3D 自由探索中，可走近交互的选项不在屏幕弹出按钮 */
  isWorldActive?: () => boolean;
}

export class ChoicesPanel {
  private readonly root: HTMLDivElement;
  private readonly prompt: HTMLParagraphElement;
  private readonly hintTrigger: HTMLButtonElement;
  private readonly options: HTMLDivElement;
  private readonly hintCard: LegalHintCard;
  private readonly callbacks: ChoicesPanelCallbacks;

  private stepId = '';
  private active = false;
  private listening = false;
  private hint: LegalHint | undefined;

  constructor(container: HTMLElement, callbacks: ChoicesPanelCallbacks) {
    this.callbacks = callbacks;

    this.root = createElement('div', 'choices');
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', '选择');

    this.prompt = createElement('p', 'choices__prompt', '');
    this.prompt.hidden = true;
    this.hintTrigger = createButton('choices__hint-trigger', '按 [Y] 查看现实做法与法治提示');
    this.hintTrigger.hidden = true;
    this.hintTrigger.setAttribute('aria-expanded', 'false');
    this.hintTrigger.addEventListener('click', () => this.toggleHint());
    this.options = createElement('div', 'choices__options');
    this.root.append(this.prompt, this.hintTrigger, this.options);
    container.append(this.root);

    this.hintCard = new LegalHintCard(container, { onClose: () => this.closeHint() });
  }

  show(payload: ChoicesPayload): void {
    this.stepId = payload.stepId;
    this.active = true;
    this.root.classList.toggle('choices--exploration', !!payload.allowMovement);

    this.prompt.textContent = payload.prompt ?? '';
    this.prompt.hidden = !payload.prompt;
    this.options.replaceChildren();

    const hide3dInteract = !!payload.allowMovement && (this.callbacks.isWorldActive?.() ?? false);
    for (const option of payload.options) {
      if (hide3dInteract && option.hasInteract) continue;
      const button = createButton('choices__option', option.text);
      button.addEventListener('click', () => this.select(option.id));
      this.options.append(button);
    }

    this.hint = getLegalHintByStepId(payload.stepId);
    this.hintTrigger.hidden = !this.hint;
    this.closeHint();
    this.setListening(!!this.hint);

    this.root.hidden = false;
  }

  hide(): void {
    this.active = false;
    this.stepId = '';
    this.hint = undefined;
    this.hintTrigger.hidden = true;
    this.closeHint();
    this.setListening(false);
    this.options.replaceChildren();
    this.root.hidden = true;
  }

  dispose(): void {
    this.setListening(false);
    this.hintCard.dispose();
    this.root.remove();
  }

  /** 仅测试与调试可见：当前是否已挂上 [Y] 监听。 */
  get isListeningForHint(): boolean {
    return this.listening;
  }

  get hintVisible(): boolean {
    return this.hintCard.isVisible;
  }

  private select(choiceId: string): void {
    if (!this.active) return;
    const stepId = this.stepId;
    this.hide();
    this.callbacks.onChoose(stepId, choiceId);
  }

  private toggleHint(): void {
    if (!this.hint) return;
    if (this.hintCard.isVisible) this.closeHint();
    else this.hintCard.open(this.hint);
  }

  private closeHint(): void {
    this.hintCard.close();
    this.hintTrigger.setAttribute('aria-expanded', this.hintCard.isVisible ? 'true' : 'false');
  }

  private setListening(listening: boolean): void {
    if (this.listening === listening) return;
    this.listening = listening;
    if (listening) window.addEventListener('keydown', this.handleKeydown, true);
    else window.removeEventListener('keydown', this.handleKeydown, true);
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (!this.active || !this.hint) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isShortcutKey(event, 'KeyY')) {
      event.preventDefault();
      this.toggleHint();
      return;
    }
    if (this.hintCard.isVisible && event.key === 'Escape') {
      // 关闭提示卡优先于其他弹层，避免一次按键同时收起选项栏。
      event.stopImmediatePropagation();
      event.preventDefault();
      this.closeHint();
    }
  };
}

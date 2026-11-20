// ui/choicesPanel.ts —— 2–3 个自然口语选项
// 纯展示：不显示分数、对错或 trust/harm；点击后只把 choiceId 交给 gameUi。

import type { GameEvents } from '../core/eventBus';
import { createButton, createElement } from './uiDom';
import './dialogueBox.css';

type ChoicesPayload = GameEvents['ui:showChoices'];

export interface ChoicesPanelCallbacks {
  onChoose: (stepId: string, choiceId: string) => void;
}

export class ChoicesPanel {
  private readonly root: HTMLDivElement;
  private readonly prompt: HTMLParagraphElement;
  private readonly options: HTMLDivElement;
  private readonly callbacks: ChoicesPanelCallbacks;

  private stepId = '';
  private active = false;

  constructor(container: HTMLElement, callbacks: ChoicesPanelCallbacks) {
    this.callbacks = callbacks;

    this.root = createElement('div', 'choices');
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', '选择');

    this.prompt = createElement('p', 'choices__prompt', '');
    this.prompt.hidden = true;
    this.options = createElement('div', 'choices__options');
    this.root.append(this.prompt, this.options);
    container.append(this.root);
  }

  show(payload: ChoicesPayload): void {
    this.stepId = payload.stepId;
    this.active = true;
    this.root.classList.toggle('choices--exploration', !!payload.allowMovement);

    this.prompt.textContent = payload.prompt ?? '';
    this.prompt.hidden = !payload.prompt;
    this.options.replaceChildren();

    for (const option of payload.options) {
      const button = createButton('choices__option', option.text);
      button.addEventListener('click', () => this.select(option.id));
      this.options.append(button);
    }

    this.root.hidden = false;
  }

  hide(): void {
    this.active = false;
    this.stepId = '';
    this.options.replaceChildren();
    this.root.hidden = true;
  }

  dispose(): void {
    this.root.remove();
  }

  private select(choiceId: string): void {
    if (!this.active) return;
    const stepId = this.stepId;
    this.hide();
    this.callbacks.onChoose(stepId, choiceId);
  }
}

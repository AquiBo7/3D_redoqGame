// ui/dialogueBox.ts —— 底部对话框：说话人、头像降级、打字机与逐句推进
// 纯展示：台词与说话人姓名均来自 core 事件；结束通过回调交给 gameUi。

import type { GameEvents } from '../core/eventBus';
import { READY_EXTERNAL_ASSETS } from '../data/assetManifest';
import type { SpeakerId } from '../data/storySchema';
import { createElement } from './uiDom';
import './dialogueBox.css';

type DialoguePayload = GameEvents['ui:showDialogue'];

const TYPE_INTERVAL_MS = 26;

/**
 * 说话人左侧立绘 URL 配置：直接绑定经 sync:art 校验就绪的外部透明立绘；
 * 未配置或加载失败时自动隐藏左侧立绘并降级为首字细线圆标，避免 404。
 */
export const SPEAKER_PORTRAIT_URLS: Partial<Record<SpeakerId, string>> = {
  ...(READY_EXTERNAL_ASSETS.portrait_linxia_casual ? { linxia: READY_EXTERNAL_ASSETS.portrait_linxia_casual } : {}),
  ...(READY_EXTERNAL_ASSETS.portrait_father ? { father: READY_EXTERNAL_ASSETS.portrait_father } : {}),
  ...(READY_EXTERNAL_ASSETS.portrait_volunteer ? { volunteer: READY_EXTERNAL_ASSETS.portrait_volunteer } : {}),
  ...(READY_EXTERNAL_ASSETS.portrait_xiaochen ? { xiaochen: READY_EXTERNAL_ASSETS.portrait_xiaochen } : {}),
  ...(READY_EXTERNAL_ASSETS.portrait_ayuan ? { ayuan: READY_EXTERNAL_ASSETS.portrait_ayuan } : {}),
  ...(READY_EXTERNAL_ASSETS.portrait_teacher ? { teacher: READY_EXTERNAL_ASSETS.portrait_teacher } : {}),
};

export interface DialogueBoxOptions {
  container: HTMLElement;
  portraits?: Partial<Record<SpeakerId, string>>;
  onEnd: (stepId: string) => void;
}

function firstCharacter(text: string, fallback: string): string {
  const chars = Array.from(text.trim());
  return chars.length > 0 ? chars[0] : fallback;
}

export class DialogueBox {
  private readonly root: HTMLElement;
  private readonly portrait: HTMLDivElement;
  private readonly avatar: HTMLDivElement;
  private readonly name: HTMLSpanElement;
  private readonly text: HTMLParagraphElement;
  private readonly portraits: Partial<Record<SpeakerId, string>>;
  private readonly onEnd: (stepId: string) => void;

  private lines: DialoguePayload['lines'] = [];
  private speakerNames: DialoguePayload['speakerNames'] = {};
  private stepId = '';
  private lineIndex = 0;
  private chars: string[] = [];
  private charIndex = 0;
  private typing = false;
  private active = false;
  private finishing = false;
  private timer = 0;
  private currentPortraitUrl: string | null = null;

  constructor(options: DialogueBoxOptions) {
    this.portraits = options.portraits ?? SPEAKER_PORTRAIT_URLS;
    this.onEnd = options.onEnd;

    this.root = createElement('section', 'dialogue');
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', '对话');

    const inner = createElement('div', 'dialogue__inner');

    this.portrait = createElement('div', 'dialogue__portrait');
    this.portrait.hidden = true;
    this.portrait.setAttribute('aria-hidden', 'true');

    const panel = createElement('div', 'dialogue__panel');

    const speaker = createElement('div', 'dialogue__speaker');
    this.avatar = createElement('div', 'dialogue__avatar');
    this.name = createElement('span', 'dialogue__name', '');
    speaker.append(this.avatar, this.name);

    this.text = createElement('p', 'dialogue__text', '');

    const footer = createElement('div', 'dialogue__footer');
    const hint = createElement('span', 'dialogue__hint', '点击 / 空格 / 回车 继续');
    const next = createElement('span', 'dialogue__next');
    next.setAttribute('aria-hidden', 'true');
    footer.append(hint, next);

    panel.append(speaker, this.text, footer);
    inner.append(this.portrait, panel);
    this.root.append(inner);
    options.container.append(this.root);

    panel.addEventListener('click', () => this.advance());
    window.addEventListener('keydown', this.handleKeyDown);
  }

  show(payload: DialoguePayload): void {
    this.lines = payload.lines;
    this.speakerNames = payload.speakerNames;
    this.stepId = payload.stepId;
    this.lineIndex = 0;
    this.finishing = false;
    this.active = true;
    this.root.hidden = false;

    if (this.lines.length === 0) {
      this.finish();
      return;
    }
    this.renderLine();
  }

  hide(): void {
    this.active = false;
    this.finishing = false;
    this.stopTimer();
    this.lines = [];
    this.stepId = '';
    this.clearPortrait();
    this.root.hidden = true;
    this.root.classList.remove('is-ready', 'dialogue--narration');
  }

  dispose(): void {
    this.stopTimer();
    this.clearPortrait();
    window.removeEventListener('keydown', this.handleKeyDown);
    this.root.remove();
  }

  private renderLine(): void {
    const line = this.lines[this.lineIndex];
    if (!line) {
      this.finish();
      return;
    }

    const speaker = line.speaker;
    const speakerName = speaker ? this.speakerNames[speaker] ?? speaker : '';
    this.root.classList.toggle('dialogue--narration', speaker === null);
    this.name.textContent = speakerName;
    this.renderAvatar(speaker, speakerName);

    this.chars = Array.from(line.text);
    this.charIndex = 0;
    this.text.textContent = '';
    this.root.classList.remove('is-ready');
    this.startTyping();
  }

  private clearPortrait(): void {
    this.currentPortraitUrl = null;
    this.portrait.replaceChildren();
    this.portrait.hidden = true;
    this.portrait.className = 'dialogue__portrait';
    this.root.classList.remove('dialogue--has-portrait');
  }

  private renderAvatar(speaker: SpeakerId | null, speakerName: string): void {
    this.avatar.replaceChildren();
    this.avatar.hidden = speaker === null;
    if (!speaker) {
      this.avatar.className = 'dialogue__avatar';
      this.clearPortrait();
      return;
    }

    this.avatar.className = `dialogue__avatar dialogue__avatar--${speaker}`;
    this.avatar.append(
      createElement('span', 'dialogue__avatar-letter', firstCharacter(speakerName, speaker)),
    );

    const portraitUrl = this.portraits[speaker];
    if (!portraitUrl) {
      this.clearPortrait();
      return;
    }

    // 同一说话人连续台词复用已有立绘 DOM，避免逐句闪烁
    if (this.currentPortraitUrl === portraitUrl && !this.portrait.hidden) {
      this.root.classList.add('dialogue--has-portrait');
      return;
    }

    this.currentPortraitUrl = portraitUrl;
    this.portrait.replaceChildren();
    this.portrait.className = `dialogue__portrait dialogue__portrait--${speaker}`;
    this.portrait.hidden = false;
    this.root.classList.add('dialogue--has-portrait');

    const image = createElement('img', 'dialogue__portrait-image');
    image.alt = speakerName;
    image.decoding = 'async';
    image.draggable = false;
    image.addEventListener(
      'error',
      () => {
        if (this.currentPortraitUrl !== portraitUrl) return;
        this.clearPortrait();
      },
      { once: true },
    );
    image.src = portraitUrl;
    this.portrait.append(image);
  }

  private startTyping(): void {
    this.stopTimer();

    if (this.chars.length === 0) {
      this.completeLine();
      return;
    }

    this.typing = true;
    this.timer = window.setInterval(() => this.typeNext(), TYPE_INTERVAL_MS);
  }

  private typeNext(): void {
    if (!this.typing) return;
    this.charIndex += 1;
    this.text.textContent = this.chars.slice(0, this.charIndex).join('');
    if (this.charIndex >= this.chars.length) this.completeLine();
  }

  private completeLine(): void {
    this.stopTimer();
    this.typing = false;
    this.charIndex = this.chars.length;
    this.text.textContent = this.chars.join('');
    this.root.classList.add('is-ready');
  }

  private advance(): void {
    if (!this.active) return;

    if (this.typing) {
      this.completeLine();
      return;
    }

    if (this.lineIndex < this.lines.length - 1) {
      this.lineIndex += 1;
      this.renderLine();
      return;
    }

    this.finish();
  }

  private finish(): void {
    if (!this.active || this.finishing) return;
    this.finishing = true;
    const stepId = this.stepId;
    this.hide();
    this.onEnd(stepId);
  }

  private stopTimer(): void {
    if (this.timer !== 0) {
      window.clearInterval(this.timer);
      this.timer = 0;
    }
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.active) return;
    if (event.code !== 'Space' && event.key !== 'Enter') return;

    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }

    event.preventDefault();
    if (event.repeat) return;
    this.advance();
  };
}

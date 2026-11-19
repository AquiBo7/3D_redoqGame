// ui/credits.ts —— 致谢 / 素材许可弹窗（开始页与章节结尾共用）
// 纯展示：不发任何剧情事件、不触碰存档；关闭后焦点回到打开它的按钮，停留在原界面。
// 条目与 docs/ASSET_CREDITS.md 保持一致，新增第三方素材时两处同步更新。

import { playUiClick } from '../audio/audioManager';
import { createButton, createElement } from './uiDom';
import './credits.css';

interface CreditEntry {
  item: string;
  detail: string;
  license: string;
}

const CREDITS: readonly CreditEntry[] = [
  { item: '标题字体 Noto Serif SC', detail: '按本作用字子集化后本地打包', license: 'SIL Open Font License 1.1' },
  { item: '正文字体 Noto Sans SC', detail: '按本作用字子集化后本地打包', license: 'SIL Open Font License 1.1' },
  { item: '3D 渲染 three.js', detail: '开源 3D 渲染库', license: 'MIT License' },
  { item: '镜头与动画 GSAP', detail: '开源动画库', license: 'GSAP 标准免费许可' },
  { item: '角色模型', detail: '项目团队制作并压缩', license: '本作品自有' },
  { item: '场景、纸纹、胶片颗粒与音效', detail: '全部由代码程序化生成', license: '本作品自有' },
];

let overlay: HTMLElement | null = null;
let closeButton: HTMLButtonElement | null = null;
let returnFocus: HTMLElement | null = null;

function build(): HTMLElement {
  const root = createElement('section', 'credits');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '致谢');

  const sheet = createElement('div', 'credits__sheet');

  closeButton = createButton('credits__close', '');
  closeButton.setAttribute('aria-label', '关闭致谢');
  closeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    closeCredits();
  });

  const eyebrow = createElement('p', 'credits__eyebrow', '《一条截图》');
  const title = createElement('h2', 'credits__title', '致谢');
  const lead = createElement(
    'p',
    'credits__lead',
    '本作品为虚构，人物、学校与事件均不对应现实。以下为本版本使用的素材与开源组件。',
  );

  const list = createElement('dl', 'credits__list');
  for (const entry of CREDITS) {
    const row = createElement('div', 'credits__row');
    row.append(
      createElement('dt', 'credits__item', entry.item),
      createElement('dd', 'credits__detail', entry.detail),
      createElement('dd', 'credits__license', entry.license),
    );
    list.append(row);
  }

  const note = createElement('p', 'credits__note', '本版本未使用第三方贴图、模型或图标。');

  sheet.append(closeButton, eyebrow, title, lead, list, note);
  root.append(sheet);

  // 点击遮罩空白处关闭；点击内容区不冒泡到下层界面
  root.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.target === root) closeCredits();
  });

  const host = document.querySelector<HTMLElement>('#ui-root') ?? document.body;
  host.append(root);
  return root;
}

const handleKeyDown = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  closeCredits();
};

export function openCredits(opener?: HTMLElement): void {
  if (!overlay) overlay = build();
  if (!overlay.hidden) return;
  returnFocus = opener ?? null;
  overlay.hidden = false;
  window.addEventListener('keydown', handleKeyDown, true);
  closeButton?.focus();
}

export function closeCredits(): void {
  if (!overlay || overlay.hidden) return;
  playUiClick();
  overlay.hidden = true;
  window.removeEventListener('keydown', handleKeyDown, true);
  returnFocus?.focus();
  returnFocus = null;
}

/** 创建一个「致谢」文字入口按钮（调用方负责插入 DOM） */
export function createCreditsLink(className: string): HTMLButtonElement {
  const button = createButton(className, '致谢');
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    playUiClick();
    openCredits(button);
  });
  return button;
}

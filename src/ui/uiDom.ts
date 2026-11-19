// ui/uiDom.ts —— 2D 界面通用 DOM 小工具
// 纯展示辅助，不含剧情逻辑。

export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function createButton(className: string, text: string): HTMLButtonElement {
  const button = createElement('button', className, text);
  button.type = 'button';
  return button;
}

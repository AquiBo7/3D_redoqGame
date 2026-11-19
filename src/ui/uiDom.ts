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

/** 快捷键不连发、不抢已处理的事件，也不打断输入（包括可编辑元素的子节点）。 */
export function isShortcutKey(event: KeyboardEvent, code: string): boolean {
  if (event.code !== code || event.repeat || event.defaultPrevented) return false;

  const target = event.target instanceof Element
    ? event.target
    : event.target instanceof Node ? event.target.parentElement : null;
  const editable = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
  return !target?.closest(editable) && !document.activeElement?.closest(editable);
}

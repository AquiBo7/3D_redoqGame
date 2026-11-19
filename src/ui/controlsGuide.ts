import { createButton, createElement, isShortcutKey } from './uiDom';
import './controlsGuide.css';

const CONTROLS = [
  { title: '电脑玩家', rows: [
    ['W / A / S / D', '移动'],
    ['鼠标', '环视 · 点击画面锁鼠，ESC 释放'],
    ['Shift', '开关疾跑'],
    ['E / 左键', '互动 · 查看与收起手机、消息'],
    ['O', '开启 / 关闭声音'],
  ] },
  { title: '手机 / 平板玩家', rows: [
    ['单指拖动', '环视四周'],
    ['单击地面', '步行前往'],
    ['双击地面', '疾跑前往'],
    ['轻点光点与按钮', '互动、查看消息及开关声音'],
  ] },
];

export function showControlsGuide(): Promise<void> {
  return new Promise((resolve) => {
    const root = createElement('div', 'controls-guide');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'controls-guide-title');
    const card = createElement('section', 'controls-guide__card');
    const title = createElement('h2', 'controls-guide__title', '在清晨，慢慢看见');
    title.id = 'controls-guide-title';
    card.append(createElement('p', 'controls-guide__eyebrow', '操作指南'), title);
    const columns = createElement('div', 'controls-guide__columns');
    for (const column of CONTROLS) {
      const section = createElement('section', 'controls-guide__column');
      section.append(createElement('h3', '', column.title));
      const list = createElement('dl');
      for (const [key, text] of column.rows) {
        list.append(createElement('dt', '', key), createElement('dd', '', text));
      }
      section.append(list);
      columns.append(section);
    }
    const button = createButton('controls-guide__enter', '进入清晨（点击 / 空格 / E）');
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      window.removeEventListener('keydown', onKey, true);
      root.remove();
      resolve();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === 'Tab') {
        event.preventDefault();
        button.focus();
        return;
      }
      if (!isShortcutKey(event, 'KeyE') && !isShortcutKey(event, 'Space')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish();
    };
    button.addEventListener('click', finish);
    card.append(columns, button);
    root.append(card);
    document.body.append(root);
    window.addEventListener('keydown', onKey, true);
    button.focus({ preventScroll: true });
  });
}

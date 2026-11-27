// core/debugPanel.ts —— ?debug=1 时挂载的调试面板
// 仅使用原生 DOM，不依赖 three.js；数据源由 GameEngine 注入。

import { SCENE_IDS } from '../data/storySchema';
import type { SceneId } from '../data/storySchema';
import type { EventBus } from './eventBus';
import type { GameEngineSnapshot } from './gameEngine';
import type { LogEntry, StoryState } from './state';
import './debugPanel.css';

export interface DebugPanelDataSource {
  getDebugSnapshot(): GameEngineSnapshot;
  jumpTo(sceneId: SceneId): void;
  clearChapterSaveAndRestart(): void;
  resetMetaProgress(): unknown;
}

const STATE_FIELDS: Array<[keyof StoryState, string]> = [
  ['newsSeen', 'newsSeen'],
  ['helpedPasserby', 'helpedPasserby'],
  ['momReply', 'momReply'],
  ['phoneIgnored', 'phoneIgnored'],
  ['seenBag', 'seenBag'],
  ['seenHandoff', 'seenHandoff'],
  ['noticedTyper', 'noticedTyper'],
  ['handedPen', 'handedPen'],
  ['reasonText', 'reasonText'],
  ['seenCrossedOut', 'seenCrossedOut'],
  ['picked', 'picked'],
  ['seenFatherWatching', 'seenFatherWatching'],
  ['talkedAunt', 'talkedAunt'],
  ['talkedGuard', 'talkedGuard'],
  ['orangeClue', 'orangeClue'],
  ['guardWilling', 'guardWilling'],
  ['finalAnswer', 'finalAnswer'],
  ['draftReactions', 'draftReactions'],
  ['trust', 'trust'],
  ['harm', 'harm'],
  ['log', 'log'],
];

const LOG_TYPE_LABELS: Record<LogEntry['type'], string> = {
  choice: '选择',
  observe: '观察',
  ignore: '忽略',
  system: '系统',
};

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatValue(key: keyof StoryState, state: StoryState): string {
  if (key === 'log') return `${state.log.length} 条`;
  const value = state[key];
  if (value === null) return '—';
  if (Array.isArray(value)) return value.length === 0 ? '[]' : `${value.length} 条`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export function initDebugPanel(source: DebugPanelDataSource, bus: EventBus): () => void {
  const toggle = createElement('button', 'debug-toggle', '调试');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');

  const panel = createElement('section', 'debug-panel');
  panel.hidden = true;
  panel.setAttribute('aria-label', '调试面板');

  const header = createElement('header', 'debug-panel__header');
  const title = createElement('h2', 'debug-panel__title', '调试');
  const status = createElement('span', 'debug-panel__status');
  const fpsBadge = createElement('span', 'debug-panel__status', 'FPS —');
  const close = createElement('button', 'debug-panel__close', '收起');
  close.type = 'button';
  header.append(title, status, fpsBadge, close);

  const body = createElement('div', 'debug-panel__body');
  const sceneLine = createElement('div', 'debug-panel__scene');

  const stateTable = createElement('table', 'debug-panel__state');
  const stateBody = createElement('tbody');

  const logTitle = createElement('h3', 'debug-panel__subtitle', 'log 记录');
  const logList = createElement('ol', 'debug-panel__log');

  const worldEventTitle = createElement('h3', 'debug-panel__subtitle', '3D 触发记录');
  const worldEventList = createElement('ol', 'debug-panel__log debug-panel__log--events');
  const worldEventEntries: string[] = [];

  const jumpTitle = createElement('h3', 'debug-panel__subtitle', '跳到场景');
  const jumpGrid = createElement('div', 'debug-panel__jump-grid');

  const actions = createElement('div', 'debug-panel__actions');
  const clearButton = createElement('button', 'debug-panel__button debug-panel__button--danger', '清空单局存档并重开 S1');
  clearButton.type = 'button';
  const resetMetaButton = createElement(
    'button',
    'debug-panel__button debug-panel__button--secondary',
    '重置多周目元数据',
  );
  resetMetaButton.type = 'button';
  actions.append(clearButton, resetMetaButton);

  body.append(
    sceneLine,
    stateTable,
    logTitle,
    logList,
    worldEventTitle,
    worldEventList,
    jumpTitle,
    jumpGrid,
    actions,
  );
  panel.append(header, body);
  document.body.append(toggle, panel);

  for (const sceneId of SCENE_IDS) {
    const button = createElement('button', 'debug-panel__jump', sceneId);
    button.type = 'button';
    button.dataset.sceneId = sceneId;
    button.addEventListener('click', () => {
      source.jumpTo(sceneId);
      render();
    });
    jumpGrid.append(button);
  }

  function render(): void {
    const snapshot = source.getDebugSnapshot();
    const { state } = snapshot;

    status.textContent = snapshot.debugSession
      ? '调试模式 · 不覆盖正式存档'
      : '正式存档模式';
    status.classList.toggle('is-debug', snapshot.debugSession);

    sceneLine.textContent = `当前：${snapshot.sceneId} · ${snapshot.role}${snapshot.ended ? ' · 已结束' : ''}`;

    stateBody.replaceChildren();
    for (const [key, label] of STATE_FIELDS) {
      const row = createElement('tr');
      const nameCell = createElement('th', undefined, label);
      nameCell.scope = 'row';
      const valueCell = createElement('td', undefined, formatValue(key, state));
      if (key === 'log') valueCell.classList.add('debug-panel__muted');
      row.append(nameCell, valueCell);
      stateBody.append(row);
    }
    if (!stateTable.contains(stateBody)) stateTable.append(stateBody);

    logList.replaceChildren();
    if (state.log.length === 0) {
      const empty = createElement('li', 'debug-panel__log-empty', '暂无记录');
      logList.append(empty);
    } else {
      for (const entry of state.log) {
        const item = createElement('li', 'debug-panel__log-item');
        const meta = createElement(
          'span',
          'debug-panel__log-meta',
          `${formatTime(entry.timestamp)} · ${entry.sceneId} · ${LOG_TYPE_LABELS[entry.type]}`,
        );
        const summary = createElement('span', 'debug-panel__log-summary', entry.summary);
        item.append(meta, summary);
        logList.append(item);
      }
    }

    renderEvents();

    for (const button of jumpGrid.querySelectorAll<HTMLButtonElement>('button[data-scene-id]')) {
      button.classList.toggle('is-current', button.dataset.sceneId === snapshot.sceneId);
    }
  }

  function renderEvents(): void {
    worldEventList.replaceChildren();
    if (worldEventEntries.length === 0) {
      worldEventList.append(createElement('li', 'debug-panel__log-empty', '暂无 3D 触发'));
      return;
    }
    for (let index = worldEventEntries.length - 1; index >= 0; index -= 1) {
      worldEventList.append(
        createElement('li', 'debug-panel__log-item debug-panel__log-item--event', worldEventEntries[index]),
      );
    }
  }

  function pushWorldEvent(text: string): void {
    worldEventEntries.push(`${formatTime(Date.now())} · ${text}`);
    if (worldEventEntries.length > 12) worldEventEntries.shift();
    if (!panel.hidden) renderEvents();
  }

  function openPanel(): void {
    panel.hidden = false;
    toggle.hidden = true;
    toggle.setAttribute('aria-expanded', 'true');
    render();
  }

  function closePanel(): void {
    panel.hidden = true;
    toggle.hidden = false;
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', openPanel);
  close.addEventListener('click', closePanel);

  clearButton.addEventListener('click', () => {
    if (!window.confirm('确定清空单局存档并从 S1 重开吗？多周目元数据会保留。')) return;
    source.clearChapterSaveAndRestart();
    render();
  });

  resetMetaButton.addEventListener('click', () => {
    if (!window.confirm('确定重置多周目解锁记录吗？此操作不可撤销。')) return;
    source.resetMetaProgress();
    render();
  });

  const refreshIfOpen = (): void => {
    if (!panel.hidden) render();
  };
  const unsubscribers = [
    bus.on('state:changed', refreshIfOpen),
    bus.on('game:chapterEnd', refreshIfOpen),
    bus.on('scene:interact', (payload) => {
      pushWorldEvent(`${payload.sceneId} · 交互 ${payload.targetId}`);
    }),
    bus.on('scene:gazeHotspot', (payload) => {
      const dwell = payload.dwellMs ? `（${payload.dwellMs}ms）` : '';
      pushWorldEvent(`${payload.sceneId} · 注视 ${payload.hotspotId}${dwell}`);
    }),
    bus.on('scene:enterZone', (payload) => {
      pushWorldEvent(`${payload.sceneId} · 进入 ${payload.zoneId}`);
    }),
    bus.on('world:fps', ({ fps, degraded }) => {
      fpsBadge.textContent = degraded ? `${Math.round(fps)} FPS（降级）` : `${Math.round(fps)} FPS`;
    }),
  ];

  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    toggle.remove();
    panel.remove();
  };
}
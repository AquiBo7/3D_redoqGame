// main.ts —— 游戏入口
// 流程：解析 URL → 组装 core 引擎（状态机 / 存档 / 事件）→ 挂载开始页与调试 UI
// 玩家开始或继续后，再创建 3D 世界；core 的剧情推进不依赖 3D 是否就绪。

import { bindBgmEvents, playAlarm, playCountdownTick, resetFootsteps, updateFootsteps } from './audio/audioManager';
import { initDebugPanel } from './core/debugPanel';
import { eventBus } from './core/eventBus';
import { GameEngine } from './core/gameEngine';
import { hasChapterSave } from './core/saveStore';
import { parseUrlParams } from './core/urlParams';
import { initChapterEnd } from './ui/chapterEnd';
import { initAchievementsPanel } from './ui/achievementsPanel';
import { initGameUi } from './ui/gameUi';
import { initLiteWorld } from './ui/liteWorld';
import { initMuteButton } from './ui/muteButton';
import { initPhonePreview } from './ui/phonePreview';
import { initStartPage } from './ui/startPage';
import { installTouchGuards } from './ui/touchGuards';
import { WorldApp } from './world/WorldApp';
import './style.css';

installTouchGuards();

const params = parseUrlParams();

if (params.debug) console.info('[debug] 调试模式已开启（右上角调试面板）');
if (params.lite) console.info('[lite] 已启用 2D 降级体验模式');
if (params.phonePreview) console.info('[phonePreview] 手机界面独立调试模式');
if (params.scene) console.info(`[scene] 调试直达：${params.scene}（不覆盖正式存档）`);
if (params.role !== 'bystander') console.info(`[role] 当前视角：${params.role}`);

if (params.modelViewer) {
  // 模型检视台：跳过开始页与剧情状态机，动态 import 独立懒加载 chunk（不影响游戏首屏）
  console.info('[modelViewer] 模型检视台模式（跳过开始页与剧情状态机）');
  const uiRoot = document.getElementById('ui-root');
  if (uiRoot) uiRoot.style.display = 'none';
  const container = document.querySelector<HTMLElement>('#app');
  if (container) {
    void import('./world/modelViewer').then(({ initModelViewer }) => {
      try {
        initModelViewer(container);
      } catch (error) {
        console.warn('模型检视台初始化失败：', error);
        const tip = document.createElement('div');
        tip.className = 'fallback-tip';
        tip.textContent = '当前设备无法启用 3D 渲染，无法打开模型检视台。';
        document.body.appendChild(tip);
      }
    });
  }
} else if (params.phonePreview) {
  // 手机 UI 独立调试：跳过 3D 世界与剧情状态机，只挂载手机面板与切换条
  const startPage = document.querySelector<HTMLElement>('#start-page');
  if (startPage) startPage.hidden = true;
  const exitScreen = document.querySelector<HTMLElement>('#exit-screen');
  if (exitScreen) exitScreen.hidden = true;
  initPhonePreview({ bus: eventBus });
} else {
  // 只在游戏分支绑定一次，先于引擎和世界初始化。
  eventBus.on('audio:motion', updateFootsteps);
  eventBus.on('audio:reset', resetFootsteps);
  eventBus.on('audio:alarm', playAlarm);
  eventBus.on('audio:tick', playCountdownTick);
  bindBgmEvents(eventBus);

  const engine = new GameEngine({ bus: eventBus, params });
  engine.attach();

  initStartPage({
    hasSave: hasChapterSave(),
    autoStart: params.scene !== null,
  });
  initChapterEnd();
  initAchievementsPanel(eventBus);
  initMuteButton();

  if (params.debug) {
    initDebugPanel(engine, eventBus);
  }

  let world: WorldApp | null = null;
  let worldFailed = false;

  const gameUi = initGameUi({
    bus: eventBus,
    getControls: () => world,
  });

  // ?lite=1 直接启用；正常模式待命，WebGL 初始化失败时无缝接管完整第一章
  const liteWorld = initLiteWorld({ bus: eventBus, active: params.lite });

  function ensureWorld(): void {
    if (params.lite) {
      liteWorld.activate(engine.getDebugSnapshot().sceneId);
      return;
    }
    if (world || worldFailed) return;
    const container = document.querySelector<HTMLElement>('#app');
    if (!container) return;

    try {
      world = new WorldApp(container, {
        bus: eventBus,
        sceneId: engine.getDebugSnapshot().sceneId,
        debug: params.debug,
        night: params.night,
      });
      // UI 事件可能先于 3D 创建（如继续存档直达 S2），补上锁定状态
      gameUi.syncControls();
    } catch (error) {
      // WebGL 不可用：自动切换到 2D 降级体验，保留已推进的剧情状态
      worldFailed = true;
      console.warn('3D 初始化失败，已切换到 2D 降级体验：', error);
      liteWorld.activate(engine.getDebugSnapshot().sceneId);
    }
  }

  // 开始 / 继续 / 场景切换时确保 3D 世界已创建（?scene 直达不会触发 game:start）
  eventBus.on('game:start', ensureWorld);
  eventBus.on('ui:continueGame', ensureWorld);
  eventBus.on('scene:transition', ensureWorld);

  engine.initFromUrl();
}
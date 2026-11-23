// core/gameEngine.ts —— 组装事件总线、场景状态机、分层存档与 URL 入口
// 本模块属于 core，严格禁止 import three.js。

import { chapter1 } from '../data/story';
import { ACHIEVEMENTS } from '../data/achievements';
import { CHAPTER_PRESETS } from '../data/chapterPresets';
import type { ChapterId } from '../data/chapterPresets';
import { createInitialStoryState } from './state';
import { buildPhonePresentation } from './phonePresentation';
import type { ChapterStory, Role, SceneId } from '../data/storySchema';
import { eventBus as defaultEventBus } from './eventBus';
import type { EventBus } from './eventBus';
import { SceneMachine } from './sceneMachine';
import type { MachineSnapshot } from './sceneMachine';
import {
  CHAPTER_SAVE_VERSION,
  clearChapterSave,
  clearCheckpoints,
  loadChapterSave,
  loadMetaProgress,
  loadCheckpoint,
  saveCheckpoint,
  unlockAchievement,
  unlockEnding,
  resetMetaProgress as resetMetaProgressStore,
  saveChapterSave,
} from './saveStore';
import type { ChapterSave, CheckpointKey, StorageLike } from './saveStore';
import type { MetaProgress, StoryState } from './state';
import { parseUrlParams } from './urlParams';
import type { UrlParams } from './urlParams';

export interface GameEngineOptions {
  chapter?: ChapterStory;
  bus?: EventBus;
  params?: UrlParams;
  /** undefined 使用真实 localStorage；null 完全禁用持久化（测试用） */
  storage?: StorageLike | null;
  now?: () => number;
}

export interface GameEngineSnapshot {
  sceneId: SceneId;
  role: Role;
  state: StoryState;
  ended: boolean;
  started: boolean;
  debugSession: boolean;
}

export class GameEngine {
  private readonly bus: EventBus;
  private readonly params: UrlParams;
  private readonly storage: StorageLike | null | undefined;
  private readonly now: () => number;
  private readonly machine: SceneMachine;
  private readonly chapter: ChapterStory;

  private autoSave = true;
  private debugSession = false;
  private started = false;
  private attached = false;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(options: GameEngineOptions = {}) {
    this.bus = options.bus ?? defaultEventBus;
    this.params = options.params ?? parseUrlParams();
    this.storage = options.storage;
    this.now = options.now ?? (() => Date.now());

    this.chapter = options.chapter ?? chapter1;
    this.machine = new SceneMachine({
      chapter: this.chapter,
      bus: this.bus,
      now: this.now,
      onPersist: (snapshot, completed) => this.persist(snapshot, completed),
    });
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;

    this.unsubscribers.push(
      this.bus.on('game:start', () => this.startNewGame()),
      this.bus.on('ui:continueGame', () => this.continueGame()),
      this.bus.on('ui:selectChapter', ({ chapterId }) => this.selectChapter(chapterId)),
      this.bus.on('ui:returnTitle', () => this.returnToTitle()),
      this.bus.on('ui:openPhoneArchive', () => {
        if (!this.machine.isEnded() || !this.started) return;
        const panel = buildPhonePresentation({ id: 'ending-archive', closeActionId: 'close', sections: [] }, this.machine.getState(), 'E1', this.chapter);
        panel.defaultTab = 'me';
        this.bus.emit('ui:showPhone', { stepId: 'ending-archive', panel });
      }),
      this.bus.on('ui:requestMeta', () => this.bus.emit('meta:changed', { meta: loadMetaProgress(this.storage), newlyUnlocked: [] })),
      this.bus.on('ui:restoreCheckpoint', ({ key }) => this.restoreCheckpoint(key)),
      this.bus.on('ui:minigameEnd', ({ stepId, hits, kills, tries }) => this.machine.onMinigameEnd(stepId, hits, kills, tries)),
      this.bus.on('scene:enterZone', ({ sceneId, zoneId }) => {
        this.machine.onEnterZone(sceneId, zoneId);
      }),
      this.bus.on('scene:gazeHotspot', ({ sceneId, hotspotId }) => {
        this.machine.onGazeHotspot(sceneId, hotspotId);
      }),
      this.bus.on('scene:interact', ({ sceneId, targetId }) => {
        this.machine.onInteract(sceneId, targetId);
      }),
      this.bus.on('ui:chooseOption', ({ stepId, choiceId }) => {
        this.machine.onChooseOption(stepId, choiceId);
      }),
      this.bus.on('ui:phoneAction', ({ phoneId, action, optionId }) => {
        if (phoneId === 'ending-archive' && action === 'close' && this.machine.isEnded() && this.started) {
          this.bus.emit('game:chapterEnd', { chapterId: 'ch1', sceneId: this.machine.getSceneId(), state: this.machine.getState() });
          return;
        }
        this.machine.onPhoneAction(phoneId, action, optionId);
      }),
      this.bus.on('ui:dialogueEnd', ({ stepId }) => {
        this.machine.onDialogueEnd(stepId);
      }),
      this.bus.on('ui:momentEnd', ({ stepId, outcome }) => {
        this.machine.onMomentEnd(stepId, outcome);
      }),
    );
  }

  /** 若 URL 指定了合法场景，则直接进入隔离的调试会话；返回是否已自动开始 */
  initFromUrl(): boolean {
    if (!this.params.scene) return false;
    this.debugSession = true;
    this.autoSave = false;
    this.started = true;
    this.machine.startNew(this.params.scene, this.params.role);
    return true;
  }

  /** 新开一局：清空单局存档，保留多周目元数据 */
  startNewGame(entryScene: SceneId = 'S1'): void {
    clearChapterSave(this.storage);
    clearCheckpoints(this.storage);
    this.autoSave = true;
    this.debugSession = false;
    this.started = true;
    this.machine.startNew(entryScene, this.params.role);
  }

  selectChapter(chapterId: ChapterId): void {
    const preset = CHAPTER_PRESETS.find((item) => item.id === chapterId);
    if (!preset || !this.chapter.scenes[preset.sceneId]) return;
    if (chapterId === 'ch1') {
      this.startNewGame();
      return;
    }
    const preview = chapterId === 'ch5';
    if (!preview) {
      clearChapterSave(this.storage);
      clearCheckpoints(this.storage);
    }
    this.autoSave = !preview;
    this.debugSession = preview;
    this.started = true;
    const state = createInitialStoryState();
    Object.assign(state, preset.state);
    state.clues = [...state.clues];
    state.yuanKeys = [...state.yuanKeys];
    state.draftReactions = [...state.draftReactions];
    state.log = [{ timestamp: this.now(), sceneId: preset.sceneId, type: 'system', summary: `章节选择预设：${preset.description}` }];
    this.machine.continueFrom({
      version: CHAPTER_SAVE_VERSION, chapterId: 'ch1', savedAt: this.now(),
      sceneId: preset.sceneId, role: this.params.role, state, completed: false,
    });
  }

  returnToTitle(): void {
    this.machine.suspend();
    this.started = false;
    this.bus.emit('audio:reset');
    this.bus.emit('game:title', { hasSave: loadChapterSave(this.storage) !== null });
  }

  /** 继续正式存档；无存档或存档损坏时退化为新开一局 */
  continueGame(): void {
    const save = loadChapterSave(this.storage);
    if (!save) {
      this.startNewGame();
      return;
    }
    this.autoSave = true;
    this.debugSession = false;
    this.started = true;
    const next = this.chapter.scenes[save.sceneId]?.transitions[0];
    const legacyEnd = save.completed && !save.state.ending && (save.sceneId === 'S9' || save.sceneId === 'S10') && next && !next.when;
    this.machine.continueFrom(legacyEnd ? { ...save, sceneId: next.to, completed: false } : save);
  }

  restoreCheckpoint(key: CheckpointKey): boolean {
    const save = loadCheckpoint(key, this.storage);
    if (!save) return false;
    this.autoSave = true;
    this.debugSession = false;
    this.started = true;
    this.machine.continueFrom({ ...save, completed: false });
    return true;
  }

  /** 调试跳关：进入隔离会话，不读写玩家正式单局存档 */
  jumpTo(sceneId: SceneId): void {
    this.debugSession = true;
    this.autoSave = false;
    if (!this.started) {
      this.started = true;
      this.machine.startNew(sceneId, this.params.role);
      return;
    }
    this.machine.jumpTo(sceneId);
  }

  /** 调试面板：清空单局存档并从 S1 重开（恢复正式存档模式） */
  clearChapterSaveAndRestart(): void {
    clearChapterSave(this.storage);
    clearCheckpoints(this.storage);
    this.autoSave = true;
    this.debugSession = false;
    this.started = true;
    this.machine.startNew('S1', this.params.role);
  }

  /** 调试面板：重置多周目元数据（独立于单局存档） */
  resetMetaProgress(): MetaProgress {
    return resetMetaProgressStore(this.storage);
  }

  getDebugSnapshot(): GameEngineSnapshot {
    return {
      sceneId: this.machine.getSceneId(),
      role: this.machine.getRole(),
      state: this.machine.getState(),
      ended: this.machine.isEnded(),
      started: this.started && this.machine.isStarted(),
      debugSession: this.debugSession,
    };
  }

  isDebugSession(): boolean {
    return this.debugSession;
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.attached = false;
  }

  private persist(snapshot: MachineSnapshot, completed: boolean): void {
    if (!this.autoSave) return;
    const save: ChapterSave = {
      version: CHAPTER_SAVE_VERSION, chapterId: 'ch1', savedAt: this.now(),
      sceneId: snapshot.sceneId, role: snapshot.role, state: snapshot.state, completed,
    };
    saveChapterSave(save, this.storage);
    if (completed && snapshot.state.ending) {
      const previous = loadMetaProgress(this.storage);
      const achievement = ACHIEVEMENTS.find((item) => item.ending === snapshot.state.ending);
      let meta = unlockEnding(snapshot.state.ending, this.storage);
      if (achievement) meta = unlockAchievement(achievement.id, this.storage);
      if (ACHIEVEMENTS.filter((item) => item.ending !== null).every((item) => meta.achievements.includes(item.id))) {
        meta = unlockAchievement('A6', this.storage);
      }
      this.bus.emit('meta:changed', { meta, newlyUnlocked: meta.achievements.filter((id) => !previous.achievements.includes(id)) });
    }
    const checkpoints: Partial<Record<SceneId, CheckpointKey>> = {
      S12: 'ch2_canteen', C1: 'ch3_morning', D1: 'ch4_platform',
    };
    const key = checkpoints[snapshot.sceneId];
    if (key && !completed) saveCheckpoint(key, save, this.storage);
  }
}
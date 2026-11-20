// 纯展示层；挂载点与层级由入口管理，不获取控制锁、不推进剧情。
import type { EventBus, GameEvents } from '../core/eventBus';
import { ASSET_MANIFEST, type AssetId } from '../data/assetManifest';
import type { SceneId, SpeakerId } from '../data/storySchema';
import { renderAssetImage } from './assetImage';
import './stage2d.css';

const BACKGROUNDS: Partial<Record<SceneId, AssetId>> = {
  C1: 'bg_dorm_morning', S11: 'bg_dorm_morning', S14: 'bg_dorm_morning',
  C3: 'bg_office_afternoon', C4: 'bg_stairwell_echo',
  D1: 'bg_platform_sunset', D2: 'bg_platform_sunset', D3: 'bg_platform_sunset',
  D4: 'bg_platform_sunset', D6: 'bg_platform_sunset',
};
const PORTRAITS: Partial<Record<SpeakerId, AssetId>> = {
  linxia: 'portrait_linxia_casual', father: 'portrait_father',
  volunteer: 'portrait_volunteer', xiaochen: 'portrait_xiaochen',
  ayuan: 'portrait_ayuan', teacher: 'portrait_teacher',
};

function clearImages(element: HTMLElement): void {
  for (const image of element.querySelectorAll('img')) image.onerror = null;
  element.replaceChildren();
}

export class Stage2D {
  private readonly root: HTMLElement;
  private readonly background: HTMLElement;
  private readonly portrait: HTMLElement;
  private readonly title: HTMLElement;
  private readonly unsubscribe: Array<() => void>;
  private scene: GameEvents['scene:transition'] | null = null;
  private dialogueStep: string | null = null;
  private interiorStarted = false;
  private disposed = false;

  constructor(container: HTMLElement, bus: EventBus) {
    const doc = container.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'stage2d';
    this.root.hidden = true;
    // 标题与人物仅作氛围，避免和对话框重复朗读。
    this.root.setAttribute('aria-hidden', 'true');
    this.background = doc.createElement('div');
    this.background.className = 'stage2d__background';
    this.portrait = doc.createElement('div');
    this.portrait.className = 'stage2d__portrait';
    this.title = doc.createElement('p');
    this.title.className = 'stage2d__title';
    this.root.append(this.background, this.portrait, this.title);
    container.append(this.root);

    this.unsubscribe = [
      bus.on('scene:transition', (scene) => {
        this.reset();
        this.scene = scene;
        this.title.textContent = scene.title;
        this.root.dataset.sceneId = scene.toSceneId;
        this.present();
      }),
      bus.on('ui:showDialogue', ({ stepId, lines }) => {
        this.clearSpeaker();
        if (lines.length === 0) return;
        this.dialogueStep = stepId;
        this.interiorStarted = true;
        this.present();
        if (this.root.hidden) return;
        // 当前协议不广播逐句变化，不读取或劫持 DialogueBox 的内部 DOM。
        const speaker = lines.find((line) => line.speaker !== null)?.speaker;
        const asset = speaker ? PORTRAITS[speaker] : undefined;
        if (asset) renderAssetImage(asset, this.portrait).alt = '';
      }),
      bus.on('ui:dialogueEnd', ({ stepId }) => {
        if (stepId === this.dialogueStep) this.clearSpeaker();
      }),
      bus.on('ui:showPhone', () => { this.clearSpeaker(); this.present(); }),
      bus.on('ui:showChoices', ({ allowMovement }) => {
        this.clearSpeaker();
        if (allowMovement) {
          this.interiorStarted = false;
          this.root.hidden = true;
        } else this.present();
      }),
      bus.on('ui:showObjective', () => {
        if (this.scene?.sceneKey !== 'stage2d') {
          this.interiorStarted = false;
          this.clearSpeaker();
          this.root.hidden = true;
        }
      }),
      bus.on('ui:showIntertitle', () => this.suspend()),
      bus.on('ui:showMinigame', () => this.suspend()),
      bus.on('game:chapterEnd', () => this.reset()),
    ];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.unsubscribe) off();
    this.reset();
    this.root.remove();
  }

  private present(): void {
    const scene = this.scene;
    const interior = scene?.sceneKey === 'interior'
      && (scene.toSceneId === 'C4' || scene.toSceneId === 'D1' || scene.toSceneId === 'D6');
    const visible = !!scene && scene.toSceneId !== 'S10' && scene.toSceneId !== 'E1'
      && (scene.sceneKey === 'stage2d' || (interior && this.interiorStarted));
    this.root.hidden = !visible;
    if (!visible || !scene) return;
    const asset = BACKGROUNDS[scene.toSceneId] ?? 'bg_dorm_morning';
    if (this.background.dataset.assetId === asset) return;
    clearImages(this.background);
    this.background.dataset.assetId = asset;
    renderAssetImage(asset, this.background).alt = '';
  }

  private clearSpeaker(): void {
    this.dialogueStep = null;
    clearImages(this.portrait);
  }

  private suspend(): void {
    this.clearSpeaker();
    this.root.hidden = true;
  }

  private reset(): void {
    this.suspend();
    this.scene = null;
    this.interiorStarted = false;
    this.title.textContent = '';
    clearImages(this.background);
    delete this.background.dataset.assetId;
    delete this.root.dataset.sceneId;
  }
}

/** hide/dispose/替换是取消，不完成；只有当前图片的用户关闭操作回调一次。 */
export class ArtView {
  private readonly root: HTMLElement;
  private readonly doc: Document;
  private previousFocus: HTMLElement | null = null;
  private session: { stepId: string } | null = null;
  private removeClose: (() => void) | null = null;
  private disposed = false;

  constructor(container: HTMLElement, private readonly onEnd: (stepId: string) => void) {
    this.doc = container.ownerDocument;
    this.root = this.doc.createElement('section');
    this.root.className = 'art-view';
    this.root.hidden = true;
    this.root.tabIndex = -1;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', '查看图片');
    container.append(this.root);
  }

  show({ stepId, assetId }: { stepId: string; assetId: string }): void {
    if (this.disposed) return;
    const previous = this.session ? this.previousFocus : this.doc.activeElement as HTMLElement | null;
    this.hide();
    this.previousFocus = previous;
    const session = { stepId };
    this.session = session;
    const panel = this.doc.createElement('div');
    panel.className = 'art-view__panel';
    const figure = this.doc.createElement('figure');
    figure.className = 'art-view__figure';
    if (Object.prototype.hasOwnProperty.call(ASSET_MANIFEST, assetId)) {
      renderAssetImage(assetId as AssetId, figure);
    } else {
      const fallback = this.doc.createElement('p');
      fallback.textContent = '图片暂不可用，可关闭后继续。';
      figure.append(fallback);
    }
    const close = this.doc.createElement('button');
    close.type = 'button';
    close.className = 'art-view__close';
    close.textContent = '关闭图片并继续';
    const finish = (): void => {
      if (this.disposed || this.session !== session) return;
      this.hide();
      this.onEnd(session.stepId);
    };
    const keydown = (event: KeyboardEvent): void => {
      if (this.session !== session) return;
      if (!['Escape', 'Tab', 'Enter', ' '].includes(event.key) && event.code !== 'Space') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Tab') close.focus();
      else if (!event.repeat) finish();
    };
    close.addEventListener('click', finish);
    this.doc.addEventListener('keydown', keydown, true);
    this.removeClose = () => {
      close.removeEventListener('click', finish);
      this.doc.removeEventListener('keydown', keydown, true);
    };
    panel.append(figure, close);
    this.root.append(panel);
    this.root.hidden = false;
    close.focus();
  }

  hide(): void {
    const wasActive = this.session !== null;
    const ownsFocus = this.root.contains(this.doc.activeElement);
    this.session = null;
    this.removeClose?.();
    this.removeClose = null;
    this.root.hidden = true;
    clearImages(this.root);
    const previous = this.previousFocus;
    this.previousFocus = null;
    if (wasActive && ownsFocus && previous?.isConnected) previous.focus?.();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hide();
    this.root.remove();
  }
}

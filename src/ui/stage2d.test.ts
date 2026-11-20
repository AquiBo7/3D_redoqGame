import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus, type GameEvents } from '../core/eventBus';
import { createInitialStoryState } from '../core/state';
import { ASSET_MANIFEST, READY_EXTERNAL_ASSETS, type AssetId } from '../data/assetManifest';
import { Stage2D, ArtView } from './stage2d';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./stage2d.css', import.meta.url), 'utf8');

// 和现有 UI 单测一致：使用轻量 DOM，不增加浏览器框架依赖。
class ElementStub extends EventTarget {
  hidden = false;
  textContent = '';
  className = '';
  tabIndex = 0;
  type = '';
  alt = '';
  width = 0;
  height = 0;
  decoding = '';
  src = '';
  onerror: (() => void) | null = null;
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: ElementStub[] = [];
  parent: ElementStub | null = null;
  constructor(readonly ownerDocument: DocumentStub, readonly tagName = 'div') { super(); }
  get isConnected(): boolean { return this === this.ownerDocument.body || !!this.parent?.isConnected; }
  append(...children: ElementStub[]): void {
    for (const child of children) { child.parent = this; this.children.push(child); }
  }
  replaceChildren(): void {
    for (const child of this.children) child.parent = null;
    this.children = [];
  }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  contains(node: ElementStub | null): boolean {
    return node === this || this.children.some((child) => child.contains(node));
  }
  querySelectorAll(tag: string): ElementStub[] {
    return this.children.flatMap((child) => [
      ...(child.tagName === tag ? [child] : []), ...child.querySelectorAll(tag),
    ]);
  }
  focus(): void { this.ownerDocument.activeElement = this; }
  click(): void { this.dispatchEvent(new Event('click')); }
}
class DocumentStub extends EventTarget {
  body = new ElementStub(this, 'body');
  activeElement: ElementStub | null = this.body;
  createElement(tag: string): ElementStub { return new ElementStub(this, tag); }
}
function key(doc: DocumentStub, value: string, extra: Record<string, unknown> = {}): Event {
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, { key: value, code: value === ' ' ? 'Space' : value, repeat: false, ...extra });
  doc.dispatchEvent(event);
  return event;
}
const ready = { ...READY_EXTERNAL_ASSETS };
let doc: DocumentStub;
let host: ElementStub;
let bus: EventBus;
let disposables: Array<{ dispose(): void }>;
function stage(): Stage2D {
  const view = new Stage2D(host as unknown as HTMLElement, bus);
  disposables.push(view);
  return view;
}
function art(onEnd = vi.fn()): ArtView {
  const view = new ArtView(host as unknown as HTMLElement, onEnd);
  disposables.push(view);
  return view;
}
function transition(toSceneId: GameEvents['scene:transition']['toSceneId'], sceneKey: GameEvents['scene:transition']['sceneKey'] = 'stage2d'): void {
  bus.emit('scene:transition', { toSceneId, sceneKey, fromSceneId: null, title: '安静的片刻', role: 'bystander' });
}
function dialogue(stepId = 'talk', speaker: GameEvents['ui:showDialogue']['lines'][number]['speaker'] = 'linxia'): void {
  bus.emit('ui:showDialogue', { stepId, speakerNames: {}, lines: [{ speaker: null, text: '片刻安静。' }, { speaker, text: '你好。' }] });
}
beforeEach(() => {
  doc = new DocumentStub();
  host = doc.createElement('div');
  doc.body.append(host);
  bus = new EventBus();
  disposables = [];
  for (const id of Object.keys(READY_EXTERNAL_ASSETS) as AssetId[]) delete READY_EXTERNAL_ASSETS[id];
});
afterEach(() => {
  for (const view of disposables) view.dispose();
  for (const id of Object.keys(READY_EXTERNAL_ASSETS) as AssetId[]) delete READY_EXTERNAL_ASSETS[id];
  Object.assign(READY_EXTERNAL_ASSETS, ready);
});

describe('Stage2D 场景展示', () => {
  it.each([
    ['C1', 'bg_dorm_morning'], ['S11', 'bg_dorm_morning'], ['S14', 'bg_dorm_morning'],
    ['C3', 'bg_office_afternoon'], ['C4', 'bg_stairwell_echo'],
    ['D2', 'bg_platform_sunset'], ['D3', 'bg_platform_sunset'], ['D4', 'bg_platform_sunset'],
    ['C5', 'bg_dorm_morning'],
  ] as const)('%s 选择清单中的 %s', (sceneId, assetId) => {
    stage();
    expect(host.children[0].hidden).toBe(true);
    transition(sceneId);
    const root = host.children[0];
    expect(root.hidden).toBe(false);
    expect(root.attributes['aria-hidden']).toBe('true');
    expect(root.children[2].textContent).toBe('安静的片刻');
    expect(root.querySelectorAll('img')[0].dataset.assetId).toBe(assetId);
    expect(root.querySelectorAll('img')[0].src).toMatch(/^data:/);
  });

  it.each(['C4', 'D1', 'D6'] as const)('%s 室内等待时不遮住行动，开始对话才显示', (id) => {
    stage();
    transition(id, 'interior');
    const root = host.children[0];
    expect(root.hidden).toBe(true);
    expect(root.querySelectorAll('img')).toHaveLength(0);
    bus.emit('ui:showPhone', { stepId: 'phone', panel: { id: 'phone', closeActionId: 'close', sections: [] } });
    expect(root.hidden).toBe(true);
    dialogue();
    expect(root.hidden).toBe(false);
    expect(root.children[0].dataset.assetId).toBe(id === 'C4' ? 'bg_stairwell_echo' : 'bg_platform_sunset');
    transition(id, 'interior');
    expect(root.hidden).toBe(true);
    dialogue();
    bus.emit('ui:showChoices', { stepId: 'walk', options: [], allowMovement: true });
    expect(root.hidden).toBe(true);
    dialogue();
    bus.emit('ui:showObjective', { sceneId: id });
    expect(root.hidden).toBe(true);
  });

  it('S10、E1 和自由行走场景不出现舞台；场景切换清理旧人物', () => {
    stage();
    for (const id of ['S10', 'E1'] as const) {
      transition(id);
      dialogue();
      expect(host.children[0].hidden).toBe(true);
      expect(host.querySelectorAll('img')).toHaveLength(0);
    }
    transition('S11');
    dialogue();
    transition('S5', 'gate');
    dialogue();
    expect(host.children[0].hidden).toBe(true);
    expect(host.querySelectorAll('img')).toHaveLength(0);
  });

  it('只取首个非空 speaker，未登记角色不猜测立绘，旧结束事件不清理新人物', () => {
    stage(); transition('C1'); dialogue('old'); dialogue('new', 'xiaochen');
    const portrait = host.children[0].children[1];
    expect(portrait.querySelectorAll('img')[0].dataset.assetId).toBe('portrait_xiaochen');
    bus.emit('ui:dialogueEnd', { stepId: 'old' });
    expect(portrait.children).toHaveLength(1);
    bus.emit('ui:dialogueEnd', { stepId: 'new' });
    expect(portrait.children).toHaveLength(0);
    for (const speaker of ['mom', 'admin', 'passerby', null] as const) {
      dialogue('unknown', speaker);
      expect(portrait.children).toHaveLength(0);
    }
    bus.emit('ui:showDialogue', { stepId: 'empty', lines: [], speakerNames: {} });
    expect(portrait.children).toHaveLength(0);
  });

  it('手机/选项清理人物，字幕/小游戏隐藏舞台；章节结束与销毁不复活', () => {
    const view = stage(); transition('C1'); dialogue();
    const root = host.children[0];
    bus.emit('ui:showPhone', { stepId: 'phone', panel: { id: 'phone', closeActionId: 'close', sections: [] } });
    expect(root.hidden).toBe(false);
    expect(root.children[1].children).toHaveLength(0);
    dialogue();
    bus.emit('ui:showChoices', { stepId: 'choice', options: [] });
    expect(root.children[1].children).toHaveLength(0);
    bus.emit('ui:showIntertitle', { stepId: 'title', lines: [], lineDurationMs: 1000, skippable: true });
    expect(root.hidden).toBe(true);
    dialogue(); expect(root.hidden).toBe(false);
    bus.emit('ui:showMinigame', { stepId: 'game', game: 'bubble', joined: false, tries: 0 });
    expect(root.hidden).toBe(true);
    bus.emit('game:chapterEnd', { chapterId: 'ch1', sceneId: 'C1', state: createInitialStoryState() });
    dialogue(); expect(root.hidden).toBe(true);
    view.dispose(); view.dispose(); transition('C1'); dialogue();
    expect(root.hidden).toBe(true);
    expect(host.children).toHaveLength(0);
  });
});

describe('ArtView 图片与关闭生命周期', () => {
  it('显示真实小票描述与 07:52 回退，不探测未就绪 PNG', () => {
    const view = art();
    view.show({ stepId: 'receipt', assetId: 'prop_pharmacy_receipt' });
    const image = host.querySelectorAll('img')[0];
    expect(image.alt).toBe(ASSET_MANIFEST.prop_pharmacy_receipt.alt);
    expect(image.src).toMatch(/^data:/);
    expect(decodeURIComponent(image.src)).toContain('07:52');
    READY_EXTERNAL_ASSETS.prop_pharmacy_receipt = ASSET_MANIFEST.prop_pharmacy_receipt.path;
    view.show({ stepId: 'receipt', assetId: 'prop_pharmacy_receipt' });
    const external = host.querySelectorAll('img')[0];
    expect(external.src).toBe(ASSET_MANIFEST.prop_pharmacy_receipt.path);
    external.onerror?.();
    expect(external.onerror).toBeNull();
    expect(decodeURIComponent(external.src)).toContain('07:52');
  });

  it.each(['Escape', 'Enter', ' '])('%s 完成当前图片一次并恢复焦点', (value) => {
    const onEnd = vi.fn(); const view = art(onEnd);
    const opener = doc.createElement('button'); doc.body.append(opener); opener.focus();
    view.show({ stepId: 'a', assetId: 'prop_late_form' });
    const root = host.children[0]; const close = root.querySelectorAll('button')[0];
    expect(root.attributes).toMatchObject({ role: 'dialog', 'aria-modal': 'true', 'aria-label': '查看图片' });
    expect(close.type).toBe('button'); expect(close.textContent).toContain('关闭');
    expect(doc.activeElement).toBe(close);
    expect(key(doc, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(doc.activeElement).toBe(close);
    key(doc, value, { repeat: true }); expect(onEnd).not.toHaveBeenCalled();
    expect(key(doc, value).defaultPrevented).toBe(true);
    close.click(); key(doc, value);
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('a');
    expect(root.hidden).toBe(true); expect(doc.activeElement).toBe(opener);
  });

  it('替换相同 stepId 也使旧按钮失效；hide/dispose 不回调', () => {
    const onEnd = vi.fn(); const view = art(onEnd);
    const opener = doc.createElement('button'); doc.body.append(opener); opener.focus();
    view.show({ stepId: 'same', assetId: 'prop_late_form' });
    const old = host.querySelectorAll('button')[0];
    view.show({ stepId: 'same', assetId: 'prop_pharmacy_receipt' });
    old.click(); expect(onEnd).not.toHaveBeenCalled();
    host.querySelectorAll('button')[0].click();
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('same');
    expect(doc.activeElement).toBe(opener);
    view.show({ stepId: 'cancel', assetId: 'prop_late_form' });
    const cancelled = host.querySelectorAll('button')[0];
    view.hide(); cancelled.click(); key(doc, 'Escape');
    expect(onEnd).toHaveBeenCalledTimes(1);
    view.show({ stepId: 'dispose', assetId: 'prop_late_form' });
    view.dispose(); view.dispose(); key(doc, 'Enter');
    view.show({ stepId: 'late', assetId: 'prop_late_form' });
    expect(onEnd).toHaveBeenCalledTimes(1); expect(host.children).toHaveLength(0);
  });

  it('无效 ID 不请求 URL，也能关闭继续；移除 opener 不恢复无效焦点', () => {
    const onEnd = vi.fn(); const view = art(onEnd);
    const opener = doc.createElement('button'); doc.body.append(opener); opener.focus();
    for (const assetId of ['https://invalid/image.png', '__proto__', 'not_registered']) {
      view.show({ stepId: assetId, assetId });
      expect(host.querySelectorAll('img')).toHaveLength(0);
      expect(host.querySelectorAll('p')[0].textContent).toContain('暂不可用');
      opener.remove();
      host.querySelectorAll('button')[0].click();
      expect(onEnd).toHaveBeenLastCalledWith(assetId);
    }
  });

  it('先关闭再回调，支持回调同步显示下一张；隐藏时键盘不会被拦截', () => {
    let view: ArtView;
    const onEnd = vi.fn(() => view.show({ stepId: 'next', assetId: 'prop_late_form' }));
    view = art(onEnd);
    view.show({ stepId: 'first', assetId: 'prop_pharmacy_receipt' });
    key(doc, 'Escape');
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('first');
    expect(host.children[0].hidden).toBe(false);
    expect(host.querySelectorAll('img')[0].dataset.assetId).toBe('prop_late_form');
    view.hide();
    expect(key(doc, 'Escape').defaultPrevented).toBe(false);
  });
});

describe('展示样式契约', () => {
  it('舞台低于对话、图片高于遮罩，背景不吞事件且保留安全区', () => {
    expect(css).toMatch(/\.stage2d\s*\{[^}]*z-index: 8/s);
    const liteCss = readFileSync(new URL('./liteWorld.css', import.meta.url), 'utf8');
    expect(liteCss).toMatch(/\.lite-world\s*\{[^}]*z-index: 7/s);
    expect(css).toMatch(/\.art-view\s*\{[^}]*z-index: 50/s);
    expect(css).toMatch(/\.stage2d\s*\{[^}]*pointer-events: none/s);
    expect(css).toMatch(/\.stage2d\[hidden\],[\s\S]*?display: none/);
    expect(css).toContain('calc(48px + env(safe-area-inset-bottom))');
    expect(css).toContain('safe-area-inset-left'); expect(css).toContain('safe-area-inset-right');
    expect(css).toContain('@media (orientation: portrait)');
    expect(css).toContain(':focus-visible');
  });
  it('减少动态效果时禁用舞台和弹窗动画，不依赖动画结束完成剧情', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important;[\s\S]*transition: none !important;/);
    const onEnd = vi.fn(); const view = art(onEnd);
    view.show({ stepId: 'still', assetId: 'prop_late_form' });
    host.querySelectorAll('button')[0].click();
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('still');
  });
});

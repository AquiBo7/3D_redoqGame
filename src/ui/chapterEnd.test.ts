import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '../core/eventBus';
import { createInitialStoryState, type StoryState } from '../core/state';
import { renderAssetImage } from './assetImage';
import { initChapterEnd } from './chapterEnd';

vi.mock('./assetImage', () => ({
  renderAssetImage: vi.fn((assetId: string, container: HTMLElement) => {
    const image = document.createElement('img');
    image.dataset.assetId = assetId;
    image.onerror = vi.fn();
    container.append(image);
    return image;
  }),
}));

// 最小 DOM 替身：只验证展示契约、焦点与事件，不启动服务器或添加 DOM 依赖。
class ElementStub {
  className = '';
  id = '';
  hidden = false;
  inert = false;
  disabled = false;
  tabIndex = 0;
  scrollTop = 0;
  type = '';
  draggable = true;
  dataset: Record<string, string> = {};
  onerror: (() => void) | null = null;
  parent: ElementStub | null = null;
  children: ElementStub[] = [];
  attributes: Record<string, string> = {};
  listeners = new Map<string, Set<(event: unknown) => void>>();
  private ownText = '';
  constructor(readonly tagName: string) {}
  set textContent(value: string) { this.ownText = value; this.replaceChildren(); }
  get textContent(): string { return this.ownText + this.children.map((child) => child.textContent).join(''); }
  get isConnected(): boolean { return this === body || !!this.parent?.isConnected; }
  append(...children: ElementStub[]): void {
    for (const child of children) { child.parent = this; this.children.push(child); }
  }
  replaceChildren(...children: ElementStub[]): void {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...children);
  }
  setAttribute(key: string, value: string): void { this.attributes[key] = value; }
  contains(node: ElementStub | null): boolean { return node === this || this.children.some((child) => child.contains(node)); }
  matches(selector: string): boolean {
    if (selector === '[hidden]') return this.hidden;
    if (selector === '[inert]') return this.inert;
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }
  closest(selector: string): ElementStub | null {
    return selector.split(',').some((part) => this.matches(part.trim())) ? this : this.parent?.closest(selector) ?? null;
  }
  querySelectorAll(selector: string): ElementStub[] {
    const found: ElementStub[] = [];
    for (const child of this.children) {
      if (selector.split(',').some((part) => child.matches(part.trim()))) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? new Set(); list.add(listener); this.listeners.set(type, list);
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void { this.listeners.get(type)?.delete(listener); }
  dispatch(type: string, event: unknown = {}): void { this.listeners.get(type)?.forEach((listener) => listener(event)); }
  focus(): void { doc.activeElement = this; }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
}

let body: ElementStub;
let host: ElementStub;
let sourceFocus: ElementStub;
let doc: { body: ElementStub; activeElement: ElementStub | null; createElement: (tag: string) => ElementStub; querySelector: () => ElementStub };
let dispose: () => void;
function overlay(): ElementStub { return host.querySelectorAll('.chapter-end')[0]; }
function show(patch: Partial<StoryState> = {}): StoryState {
  const state = { ...createInitialStoryState(), ...patch };
  eventBus.emit('game:chapterEnd', { chapterId: 'ch1', sceneId: 'E1', state });
  return state;
}
function button(label: string): ElementStub {
  const node = overlay().querySelectorAll('button').find((item) => item.textContent === label);
  if (!node) throw new Error(`未找到按钮：${label}`);
  return node;
}
function tab(target: ElementStub, shiftKey = false) {
  const event = { key: 'Tab', shiftKey, target, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  overlay().dispatch('keydown', event);
  return event;
}

beforeEach(() => {
  eventBus.clear(); vi.clearAllMocks();
  body = new ElementStub('BODY'); host = new ElementStub('DIV'); sourceFocus = new ElementStub('BUTTON');
  body.append(host, sourceFocus);
  doc = { body, activeElement: sourceFocus, createElement: (tag) => new ElementStub(tag.toUpperCase()), querySelector: () => host };
  vi.stubGlobal('document', doc); vi.stubGlobal('HTMLElement', ElementStub);
  dispose = initChapterEnd();
});
afterEach(() => { dispose(); eventBus.clear(); vi.unstubAllGlobals(); });

describe('结局页面展示与操作', () => {
  it('保留 overlay 和 summary 契约，按五块呈现，图片只走 assetImage', () => {
    expect(overlay().hidden).toBe(true);
    show({ ending: 'joined', trust: 1, postChoice: 'joke' });
    const root = overlay();
    expect(root.hidden).toBe(false);
    expect(root.attributes).toMatchObject({ role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'chapter-end-title' });
    expect(root.querySelectorAll('summary')[0].textContent).toBe('查看足迹');
    expect(root.children[0].children.map((child) => child.tagName)).toEqual(['HEADER', 'SECTION', 'DETAILS', 'SECTION', 'SECTION', 'FOOTER']);
    expect(root.querySelectorAll('.chapter-end__draft')).toHaveLength(4);
    expect(root.querySelectorAll('.chapter-end__draft--locked')).toHaveLength(3);
    expect(root.querySelectorAll('.chapter-end__action')).toHaveLength(5);
    expect(root.textContent).toContain('想画给他，但……');
    expect(root.textContent).not.toMatch(/harm|trust|分数|他会以为/);
    expect(renderAssetImage).toHaveBeenCalledWith('cg_s11_post_crop', expect.any(ElementStub));
    expect(doc.activeElement?.id).toBe('chapter-end-title');
  });

  it.each([
    ['joined', '回到食堂，再试一次', 'ch2_canteen'],
    ['bystander', '回到第二天，再试一次', 'ch3_morning'],
    ['worst', '回到侧楼梯平台，再试一次', 'ch4_platform'],
  ] as const)('%s 重试只请求对应检查点，不擅自改动状态或关闭页面', (ending, label, key) => {
    const input = show({ ending }); const saved = JSON.stringify(input);
    const received = vi.fn(); eventBus.on('ui:restoreCheckpoint', received);
    button(label).dispatch('click');
    expect(received).toHaveBeenCalledExactlyOnceWith({ key });
    expect(JSON.stringify(input)).toBe(saved);
    expect(overlay().hidden).toBe(false);
  });

  it.each([
    ['章节选择', 'ui:openChapters', false], ['查看成就', 'ui:openAchievements', false],
    ['返回标题', 'ui:returnTitle', true], ['从头开始', 'game:start', true],
  ] as const)('%s 发送约定事件', (label, event, hidden) => {
    show({ ending: 'middle' }); const received = vi.fn(); eventBus.on(event, received);
    button(label).dispatch('click');
    expect(received).toHaveBeenCalledOnce();
    expect(overlay().hidden).toBe(hidden);
  });

  it('首尾 Tab 与 Shift+Tab 循环；不截获其他弹层的焦点', () => {
    show({ ending: 'best' });
    const title = doc.activeElement!;
    expect(tab(title).preventDefault).toHaveBeenCalled();
    const first = overlay().querySelectorAll('summary')[0];
    const last = button('从头开始');
    expect(doc.activeElement).toBe(first);
    tab(first, true); expect(doc.activeElement).toBe(last);
    tab(last); expect(doc.activeElement).toBe(first);
    title.focus(); tab(title, true); expect(doc.activeElement).toBe(last);
    const foreign = tab(sourceFocus);
    expect(foreign.preventDefault).not.toHaveBeenCalled();
    expect(foreign.stopPropagation).not.toHaveBeenCalled();
    host.inert = true;
    expect(tab(first).stopPropagation).not.toHaveBeenCalled();
  });

  it('game:title 与 scene:transition 隐藏，关闭时恢复之前的有效焦点', () => {
    show(); eventBus.emit('game:title', { hasSave: true });
    expect(overlay().hidden).toBe(true); expect(doc.activeElement).toBe(sourceFocus);
    show();
    eventBus.emit('scene:transition', { fromSceneId: 'E1', toSceneId: 'S1', sceneKey: 'room', role: 'bystander', title: '' });
    expect(overlay().hidden).toBe(true); expect(doc.activeElement).toBe(sourceFocus);
  });

  it('生命周期关闭不夺走其他弹层焦点，重复结局替换而非累加', () => {
    show({ ending: 'best', trust: 7, phrase: '删了不够，我们去把话说清楚。' });
    const oldImage = overlay().querySelectorAll('img')[0];
    overlay().scrollTop = 500;
    show({ ending: 'joined', trust: 0 });
    expect(oldImage.onerror).toBeNull();
    expect(overlay().querySelectorAll('img')).toHaveLength(1);
    expect(overlay().scrollTop).toBe(0);
    expect(overlay().textContent).not.toContain('夹在笔记本');
    expect(overlay().textContent).not.toContain('删了不够，我们去把话说清楚。');
    expect(overlay().querySelectorAll('.chapter-end__draft--locked')).toHaveLength(4);
    sourceFocus.focus(); eventBus.emit('game:title', { hasSave: false });
    expect(doc.activeElement).toBe(sourceFocus);
  });

  it('销毁清理订阅、图片回退和节点，可重复调用', () => {
    show(); const root = overlay(); const image = root.querySelectorAll('img')[0];
    dispose(); dispose();
    expect(host.querySelectorAll('.chapter-end')).toHaveLength(0);
    expect(root.listeners.get('keydown')?.size).toBe(0);
    expect(image.onerror).toBeNull();
    expect(doc.activeElement).toBe(sourceFocus);
    show({ ending: 'best' });
    expect(root.hidden).toBe(true);
    expect(host.children).toHaveLength(0);
  });
});

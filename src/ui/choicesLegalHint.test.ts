import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChoicesPanel } from './choicesPanel';

class ClassListStub {
  private readonly items = new Set<string>();
  constructor(private readonly host: ElementStub) {}
  private flush(): void { this.host.setClassNameRaw(Array.from(this.items).join(' ')); }
  sync(raw: string): void {
    this.items.clear();
    for (const part of raw.split(/\s+/)) if (part) this.items.add(part);
    this.flush();
  }
  add(...names: string[]): void { for (const name of names) if (name) this.items.add(name); this.flush(); }
  remove(...names: string[]): void { for (const name of names) this.items.delete(name); this.flush(); }
  toggle(name: string, force?: boolean): boolean {
    const next = force ?? !this.items.has(name);
    if (next) this.items.add(name); else this.items.delete(name);
    this.flush();
    return next;
  }
  contains(name: string): boolean { return this.items.has(name); }
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

class ElementStub extends EventTarget {
  hidden = false;
  type = '';
  scrollTop = 0;
  attributes: Record<string, string> = {};
  children: ElementStub[] = [];
  parent: ElementStub | null = null;
  readonly classList = new ClassListStub(this);
  private rawClassName = '';
  private ownText = '';

  constructor(readonly tagName = 'DIV') { super(); }

  get className(): string { return this.rawClassName; }
  set className(value: string) { this.rawClassName = value; this.classList.sync(value); }
  setClassNameRaw(value: string): void { this.rawClassName = value; }
  get textContent(): string { return this.ownText + this.children.map((child) => child.textContent).join(''); }
  set textContent(value: string) { this.ownText = value; this.replaceChildren(); }

  append(...children: ElementStub[]): void {
    for (const child of children) { child.parent = this; this.children.push(child); }
  }
  replaceChildren(...children: ElementStub[]): void {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...children);
  }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  getAttribute(name: string): string | undefined { return this.attributes[name]; }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  closest(selector: string): ElementStub | null {
    if (!selector.includes('input')) return null;
    let node: ElementStub | null = this;
    while (node) {
      if (EDITABLE_TAGS.has(node.tagName) || node.attributes.contenteditable === 'true') return node;
      node = node.parent;
    }
    return null;
  }
  findByClass(target: string): ElementStub | null {
    if (this.classList.contains(target)) return this;
    for (const child of this.children) {
      const hit = child.findByClass(target);
      if (hit) return hit;
    }
    return null;
  }
  click(): void { this.dispatchEvent(new Event('click')); }
}

interface KeyEventInit {
  code?: string;
  key?: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: ElementStub | null;
}

interface FakeKeyEvent {
  code: string;
  key: string;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: ElementStub | null;
  defaultPrevented: boolean;
  immediateStopped: boolean;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}

const choices: Array<{ stepId: string; choiceId: string }> = [];
let keyListeners: Array<(event: FakeKeyEvent) => void> = [];

function pressKey(init: KeyEventInit = {}): FakeKeyEvent {
  const event: FakeKeyEvent = {
    code: init.code ?? '',
    key: init.key ?? (init.code === 'Escape' ? 'Escape' : ''),
    repeat: init.repeat ?? false,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    altKey: init.altKey ?? false,
    target: init.target ?? null,
    defaultPrevented: false,
    immediateStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.immediateStopped = true; },
  };
  for (const listener of keyListeners.slice()) listener(event);
  return event;
}

describe('ChoicesPanel 的 [Y] 现实与法治提示', () => {
  let host: ElementStub;
  let panel: ChoicesPanel | null = null;

  beforeEach(() => {
    choices.length = 0;
    keyListeners = [];
    host = new ElementStub('DIV');
    const docStub = {
      createElement: (tag: string) => new ElementStub(tag.toUpperCase()),
      activeElement: null,
    };
    const winStub = {
      addEventListener: (_type: string, handler: (event: FakeKeyEvent) => void) => { keyListeners.push(handler); },
      removeEventListener: (_type: string, handler: (event: FakeKeyEvent) => void) => {
        keyListeners = keyListeners.filter((item) => item !== handler);
      },
    };
    vi.stubGlobal('document', docStub);
    vi.stubGlobal('window', winStub);
    vi.stubGlobal('Element', ElementStub);
    vi.stubGlobal('Node', class UnrelatedNode {});
    panel = new ChoicesPanel(host as unknown as HTMLElement, {
      onChoose: (stepId, choiceId) => { choices.push({ stepId, choiceId }); },
    });
  });

  afterEach(() => {
    panel?.dispose();
    panel = null;
    vi.unstubAllGlobals();
  });

  const show = (stepId: string, options = [{ id: 'a', text: '选项一' }, { id: 'b', text: '选项二' }]): void => {
    panel?.show({ stepId, options });
  };

  it('命中关键节点才亮起提示灯，普通选项不显示', () => {
    show('c3-stairs');
    expect(host.findByClass('choices__hint-trigger')?.hidden).toBe(true);
    show('d2-round-1');
    const trigger = host.findByClass('choices__hint-trigger');
    expect(trigger?.hidden).toBe(false);
    expect(trigger?.textContent).toBe('按 [Y] 查看现实做法与法治提示');
    expect(panel?.isListeningForHint).toBe(true);
  });

  it('按 Y 展开提示卡，卡内给出三块内容与法条', () => {
    show('d2-round-1');
    expect(host.findByClass('legal-hint')?.hidden).toBe(true);
    pressKey({ code: 'KeyY' });
    const card = host.findByClass('legal-hint');
    expect(card?.hidden).toBe(false);
    expect(panel?.hintVisible).toBe(true);
    expect(card?.textContent).toContain('现实常规做法');
    expect(card?.textContent).toContain('法治坐标');
    expect(card?.textContent).toContain('镜头外提醒');
    expect(card?.textContent).toContain('治安管理处罚法');
    expect(card?.textContent).toContain('仅供现实参考，选择权仍在你手中');
    expect(host.findByClass('legal-hint__close')?.textContent).toContain('Esc');
  });

  it('再按 Y、点关闭按钮或点卡片以外区域都收起', () => {
    show('s14-choice');
    pressKey({ code: 'KeyY' });
    expect(panel?.hintVisible).toBe(true);
    pressKey({ code: 'KeyY' });
    expect(panel?.hintVisible).toBe(false);

    pressKey({ code: 'KeyY' });
    host.findByClass('legal-hint__close')?.click();
    expect(panel?.hintVisible).toBe(false);

    pressKey({ code: 'KeyY' });
    host.findByClass('legal-hint')?.click();
    expect(panel?.hintVisible).toBe(false);
  });

  it('触屏与鼠标可直接点开，不依赖键盘', () => {
    show('c5-find-path');
    host.findByClass('choices__hint-trigger')?.click();
    expect(panel?.hintVisible).toBe(true);
    expect(host.findByClass('legal-hint')?.hidden).toBe(false);
  });

  it('Esc 关闭提示卡并阻断后续按键处理', () => {
    show('d2-round-1');
    pressKey({ code: 'KeyY' });
    const event = pressKey({ code: '', key: 'Escape' });
    expect(event.immediateStopped).toBe(true);
    expect(panel?.hintVisible).toBe(false);
  });

  it('组合键、长按连发与输入框焦点都不触发提示', () => {
    show('d2-round-1');
    expect(pressKey({ code: 'KeyY', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(pressKey({ code: 'KeyY', metaKey: true }).defaultPrevented).toBe(false);
    expect(pressKey({ code: 'KeyY', altKey: true }).defaultPrevented).toBe(false);
    expect(pressKey({ code: 'KeyY', repeat: true }).defaultPrevented).toBe(false);
    const input = new ElementStub('INPUT');
    host.append(input);
    expect(pressKey({ code: 'KeyY', target: input }).defaultPrevented).toBe(false);
    expect(panel?.hintVisible).toBe(false);
  });

  it('切换节点自动收起提示卡并停止监听', () => {
    show('d2-round-1');
    pressKey({ code: 'KeyY' });
    expect(panel?.hintVisible).toBe(true);
    show('c3-stairs');
    expect(panel?.hintVisible).toBe(false);
    expect(panel?.isListeningForHint).toBe(false);
    pressKey({ code: 'KeyY' });
    expect(panel?.hintVisible).toBe(false);
  });

  it('提示卡打开时仍能正常选择，选项点击后自动清理', () => {
    show('d2-round-1');
    pressKey({ code: 'KeyY' });
    const option = host.findByClass('choices__options')?.children[0];
    option?.click();
    expect(choices).toEqual([{ stepId: 'd2-round-1', choiceId: 'a' }]);
    expect(panel?.hintVisible).toBe(false);
    expect(panel?.isListeningForHint).toBe(false);
    expect(host.findByClass('choices')?.hidden).toBe(true);
  });

  it('dispose 后监听与浮层一并移除', () => {
    show('d6-solo-response');
    pressKey({ code: 'KeyY' });
    expect(keyListeners.length).toBe(1);
    panel?.dispose();
    panel = null;
    expect(keyListeners.length).toBe(0);
    expect(host.findByClass('legal-hint')).toBeNull();
  });
});

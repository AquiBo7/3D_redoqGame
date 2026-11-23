import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MomentView, type MomentOutcome } from './momentView';

vi.mock('./assetImage', () => ({
  renderAssetImage: vi.fn((assetId: string, container: HTMLElement) => {
    const image = document.createElement('img');
    image.dataset.assetId = assetId;
    image.onerror = vi.fn();
    container.append(image);
    return image;
  }),
}));

class FakeClassList {
  private readonly set = new Set<string>();
  constructor(private readonly sync: (value: string) => void) {}
  reset(className: string): void {
    this.set.clear();
    for (const token of className.split(/\s+/).filter(Boolean)) this.set.add(token);
  }
  add(...tokens: string[]): void {
    for (const token of tokens) this.set.add(token);
    this.sync(Array.from(this.set).join(' '));
  }
  remove(...tokens: string[]): void {
    for (const token of tokens) this.set.delete(token);
    this.sync(Array.from(this.set).join(' '));
  }
  toggle(token: string, force?: boolean): boolean {
    const on = force === undefined ? !this.set.has(token) : force;
    if (on) this.set.add(token);
    else this.set.delete(token);
    this.sync(Array.from(this.set).join(' '));
    return on;
  }
  contains(token: string): boolean {
    return this.set.has(token);
  }
}

class FakeElement extends EventTarget {
  private _className = '';
  readonly classList: FakeClassList;
  type = '';
  value = '';
  placeholder = '';
  readOnly = false;
  hidden = false;
  disabled = false;
  tabIndex = 0;
  draggable = true;
  onerror: (() => void) | null = null;
  parentElement: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> & { setProperty: (name: string, value: string) => void };
  private text = '';
  private readonly attributes = new Map<string, string>();

  constructor(readonly tagName: string) {
    super();
    this.classList = new FakeClassList((value) => { this._className = value; });
    const styleObj: Record<string, string> = {};
    this.style = Object.assign(styleObj, {
      setProperty: (name: string, value: string) => { styleObj[name] = value; },
    });
  }

  get className(): string { return this._className; }
  set className(value: string) {
    this._className = value;
    this.classList.reset(value);
  }
  get ownerDocument(): typeof doc { return doc; }
  get isConnected(): boolean { return this === doc.body || !!this.parentElement?.isConnected; }
  get textContent(): string { return this.text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value: string) { this.replaceChildren(); this.text = value; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); }
  }
  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) child.parentElement = null;
    this.children.length = 0;
    this.text = '';
    this.append(...nodes);
  }
  remove(): void {
    const siblings = this.parentElement?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
  matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      const value = part.trim();
      if (value.startsWith('.')) return this.classList.contains(value.slice(1));
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(value);
      if (attr) return this.attributes.has(attr[1]) && (attr[2] === undefined || this.getAttribute(attr[1]) === attr[2]);
      return value.toLowerCase() === this.tagName.toLowerCase();
    });
  }
  querySelectorAll(selector: string): FakeElement[] {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector: string): FakeElement | null { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector: string): FakeElement | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  contains(node: FakeElement | null): boolean { return this === node || this.children.some((child) => child.contains(node)); }
  override dispatchEvent(event: Event): boolean {
    if (!event.target) Object.defineProperty(event, 'target', { value: this });
    const result = super.dispatchEvent(event);
    if (event.bubbles && !event.cancelBubble) this.parentElement?.dispatchEvent(event);
    return result;
  }
  click(): void { this.dispatchEvent(new Event('click', { bubbles: true })); }
  focus(): void { doc.activeElement = this; }
}

let doc: { body: FakeElement; activeElement: FakeElement | null; createElement: (tag: string) => FakeElement };
let win: EventTarget & {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  matchMedia: (query: string) => { matches: boolean };
};
let view: MomentView;
let onEnd: ReturnType<typeof vi.fn<(stepId: string, outcome: MomentOutcome) => void>>;

function query(selector: string): FakeElement {
  const node = doc.body.querySelector(selector);
  if (!node) throw new Error(`未找到 ${selector}`);
  return node;
}

function key(code: string, keyValue = code): Event {
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, { code, key: keyValue, repeat: false, stopImmediatePropagation: vi.fn() });
  win.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  doc = { body: new FakeElement('body'), activeElement: null, createElement: (tag) => new FakeElement(tag) };
  win = Object.assign(new EventTarget(), {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    matchMedia: () => ({ matches: true }),
  });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('Node', FakeElement);
  onEnd = vi.fn();
  view = new MomentView(doc.body as unknown as HTMLElement, onEnd);
});

afterEach(() => {
  view.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('MomentView 叙事演出浮层', () => {
  it('opening-news 自动轮播两句字幕并在结束后完成，也支持点击关闭或 Esc 提前关闭', () => {
    view.show({ stepId: 's1-news', moment: 'opening-news', lines: ['第一句新闻', '第二句新闻'] });
    expect(query('.moment-news__subtitle').textContent).toBe('第一句新闻');
    vi.advanceTimersByTime(3800);
    expect(query('.moment-news__subtitle').textContent).toBe('第二句新闻');
    vi.advanceTimersByTime(4200);
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('s1-news', 'completed');

    onEnd.mockClear();
    view.show({ stepId: 's1-news-2', moment: 'opening-news' });
    query('[data-moment-action="close"]').click();
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('s1-news-2', 'completed');
    expect(vi.getTimerCount()).toBe(0);

    onEnd.mockClear();
    view.show({ stepId: 's1-news-3', moment: 'opening-news' });
    key('Escape', 'Escape');
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('s1-news-3', 'completed');
  });

  it('best-hesitation 等待三次犹豫完成送画；350ms 后点击画面或直接追问则以 interrupted 结束', () => {
    view.show({ stepId: 'hesitate', moment: 'best-hesitation', lines: ['一', '二', '三'] });
    expect(query('.moment-hesitation__text').textContent).toBe('一');
    // 刚出现时误触窗口内点击画面不会立即打断
    query('.moment').click();
    expect(onEnd).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2400);
    expect(query('.moment-hesitation__text').textContent).toBe('二');
    vi.advanceTimersByTime(2400);
    expect(query('.moment-hesitation__text').textContent).toBe('三');
    vi.advanceTimersByTime(2400);
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('hesitate', 'completed');

    // 点击追问按钮立即打断
    onEnd.mockClear();
    view.show({ stepId: 'hesitate-ask', moment: 'best-hesitation' });
    query('[data-moment-action="interrupt"]').click();
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('hesitate-ask', 'interrupted');

    // 超过 350ms 防误触窗口后点击背景也会打断
    onEnd.mockClear();
    view.show({ stepId: 'hesitate-click', moment: 'best-hesitation' });
    vi.advanceTimersByTime(400);
    query('.moment').click();
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('hesitate-click', 'interrupted');
  });

  it('middle-pause 忽略提前按键，精准停满 3 秒后完成', () => {
    view.show({ stepId: 'mid-pause', moment: 'middle-pause', lines: ['……没事。'] });
    expect(query('.moment-pause__line').textContent).toBe('……没事。');
    key('Space', ' ');
    key('Enter', 'Enter');
    vi.advanceTimersByTime(2999);
    expect(onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('mid-pause', 'completed');
  });

  it('worst-flood 通知渐密且暗角收紧，随后同时熄灭只剩一行字幕', () => {
    view.show({ stepId: 'worst', moment: 'worst-flood', lines: ['话题换了一个名字，围观并没有停下。'] });
    vi.advanceTimersByTime(180);
    expect(doc.body.querySelectorAll('.moment-flood__toast')).toHaveLength(1);
    expect(query('.moment-flood__final').hidden).toBe(true);

    // 推进到全部 12 条通知出现但尚未熄灭
    vi.advanceTimersByTime(2600);
    expect(doc.body.querySelectorAll('.moment-flood__toast')).toHaveLength(12);
    expect(query('.moment').classList.contains('is-pressured')).toBe(true);

    // 推进到同时熄灭
    vi.advanceTimersByTime(600);
    expect(doc.body.querySelectorAll('.moment-flood__toast')).toHaveLength(0);
    expect(query('.moment').classList.contains('is-extinguished')).toBe(true);

    // 沉寂后出现唯一一行字幕并允许点击/自动结束
    vi.advanceTimersByTime(700);
    expect(query('.moment-flood__final').hidden).toBe(false);
    expect(query('.moment-flood__subtitle').textContent).toBe('话题换了一个名字，围观并没有停下。');
    vi.advanceTimersByTime(2600);
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('worst', 'completed');
  });

  it('bystander-cursor 无论输入提交还是直接退出，字幕都是“你什么都没做。”且光标一直存在', () => {
    view.show({ stepId: 'bystander-1', moment: 'bystander-cursor', lines: ['你什么都没做。'] });
    const input = query('.moment-bystander__input');
    input.value = '其实那天她脚崴了';
    query('[data-bystander-action="submit"]').click();
    expect(input.value).toBe('');
    expect(input.readOnly).toBe(true);
    expect(query('.moment-bystander__verdict').hidden).toBe(false);
    expect(query('.moment-bystander__subtitle').textContent).toBe('你什么都没做。');
    expect(doc.body.querySelector('.moment-bystander__cursor')).not.toBeNull();
    query('[data-bystander-action="continue"]').click();
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('bystander-1', 'completed');

    onEnd.mockClear();
    view.show({ stepId: 'bystander-2', moment: 'bystander-cursor', lines: ['你什么都没做。'] });
    query('[data-bystander-action="exit"]').click();
    expect(query('.moment-bystander__subtitle').textContent).toBe('你什么都没做。');
    expect(doc.body.querySelector('.moment-bystander__cursor')).not.toBeNull();
    vi.advanceTimersByTime(3200);
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('bystander-2', 'completed');
  });

  it('joined-rewind 按四阶段推进：上滚 → 林夏座位 → 玩笑与归零 → 再滚一遍，也支持跳过', () => {
    view.show({ stepId: 'joined', moment: 'joined-rewind', lines: ['那天我俩都迟到，被拍惨了哈哈。'] });
    expect(query('.moment').dataset.phase).toBe('roll-1');
    expect(query('.moment-rewind__number').textContent).toBe('128,400');

    vi.advanceTimersByTime(2200);
    expect(query('.moment').dataset.phase).toBe('seat');
    expect(query('.moment-rewind__seat').hidden).toBe(false);

    vi.advanceTimersByTime(2000);
    expect(query('.moment').dataset.phase).toBe('joke-zero');
    expect(query('.moment-rewind__joke').hidden).toBe(false);
    expect(query('.moment-rewind__number').textContent).toBe('0');

    vi.advanceTimersByTime(2000);
    expect(query('.moment').dataset.phase).toBe('roll-2');
    expect(query('.moment-rewind__number').textContent).toBe('128,400');

    vi.advanceTimersByTime(2600);
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('joined', 'completed');

    onEnd.mockClear();
    view.show({ stepId: 'joined-skip', moment: 'joined-rewind' });
    query('[data-moment-action="skip"]').click();
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('joined-skip', 'completed');
  });

  it('hide / 替换 / dispose 取消所有定时与监听，不回调旧步骤', () => {
    const external = doc.createElement('button');
    doc.body.append(external);
    external.focus();

    view.show({ stepId: 'old', moment: 'middle-pause' });
    view.hide();
    expect(vi.getTimerCount()).toBe(0);
    expect(doc.activeElement).toBe(external);
    vi.advanceTimersByTime(5000);
    expect(onEnd).not.toHaveBeenCalled();

    view.show({ stepId: 'first', moment: 'opening-news' });
    view.show({ stepId: 'second', moment: 'middle-pause' });
    vi.advanceTimersByTime(3000);
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('second', 'completed');

    onEnd.mockClear();
    view.show({ stepId: 'after-dispose', moment: 'opening-news' });
    view.dispose();
    vi.advanceTimersByTime(10000);
    expect(onEnd).not.toHaveBeenCalled();
    expect(doc.body.querySelector('.moment')).toBeNull();
  });
});

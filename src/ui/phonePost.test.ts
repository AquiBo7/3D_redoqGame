import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhonePanel, PhoneSection } from '../data/storySchema';
import { ASSET_MANIFEST, READY_EXTERNAL_ASSETS, type AssetId } from '../data/assetManifest';
import { PhonePanelView, type PhonePanelCallbacks } from './phonePanel';

// 仅提供 PhonePanel 和真实 renderAssetImage 所需的 DOM；不依赖旧测试或 WebGL。
class FakeElement extends EventTarget {
  className = '';
  type = '';
  hidden = false;
  inert = false;
  disabled = false;
  draggable = true;
  src = '';
  alt = '';
  scrollTop = 0;
  scrollHeight = 0;
  parentElement: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  private text = '';
  private readonly attributes = new Map<string, string>();

  constructor(readonly tagName: string) { super(); }
  get ownerDocument(): typeof fakeDocument { return fakeDocument; }
  get textContent(): string { return this.text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value: string) { this.replaceChildren(); this.text = value; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.remove();
      node.parentElement = this;
      this.children.push(node);
    }
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
      if (value.startsWith('.')) return this.className.split(/\s+/).includes(value.slice(1));
      const attribute = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(value);
      if (attribute) return this.attributes.has(attribute[1])
        && (attribute[2] === undefined || this.getAttribute(attribute[1]) === attribute[2]);
      return this.tagName === value;
    });
  }
  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = [];
    for (const child of this.children) {
      if (child.matches(selector)) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }
  querySelector(selector: string): FakeElement | null { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector: string): FakeElement | null {
    return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null;
  }
  contains(node: FakeElement | null): boolean {
    return this === node || this.children.some((child) => child.contains(node));
  }
  click(): void { this.dispatchEvent(new Event('click')); }
  focus(): void { fakeDocument.activeElement = this; }
}

let fakeDocument: {
  body: FakeElement;
  activeElement: FakeElement | null;
  createElement: (tag: string) => FakeElement;
};
let phone: PhonePanelView;
let onAction: ReturnType<typeof vi.fn<PhonePanelCallbacks['onAction']>>;

function query(selector: string): FakeElement {
  const node = fakeDocument.body.querySelector(selector);
  if (!node) throw new Error(`找不到 DOM 节点：${selector}`);
  return node;
}

function postData(): Extract<PhoneSection, { kind: 'post' }> {
  return {
    kind: 'post', id: 'wall-post', title: '开学日的照片', publishedAt: '今天 12:30',
    assetIds: ['cg_s11_post_crop', 'cg_s6_gate_panorama'],
    views: 1250, commentCount: 86, text: '照片之外，还有未被看见的事情。',
    // 子评论故意先于父评论，验证 replyTo 而非数组顺序决定嵌套。
    comments: [
      { id: 'C', author: '匿名C', text: '先听听当事人的说明。', likes: 5, replyTo: 'A', actionId: 'comment-c' },
      { id: 'A', author: '匿名A', text: '这张图还有完整版本吗？', likes: 18, actionId: 'comment-a' },
      { id: 'B', author: '匿名B', text: '我也看到了这张照片。', likes: 0 },
    ],
    actions: [{ id: 'post-share', text: '转发', effects: { set: { harm: 99 } } }],
  };
}

function panelFor(post = postData()): PhonePanel {
  return { id: 'wall-phone', closeActionId: 'wall-close', sections: [post] };
}

beforeEach(() => {
  fakeDocument = { body: new FakeElement('body'), activeElement: null, createElement: (tag) => new FakeElement(tag) };
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('Node', FakeElement);
  onAction = vi.fn();
  phone = new PhonePanelView(fakeDocument.body as unknown as HTMLElement, { onAction });
});

afterEach(() => {
  phone.dispose();
  vi.unstubAllGlobals();
});

describe('Phase B 校园墙帖子', () => {
  it('主页直接展示标题时间正文、准确计数与按 replyTo 嵌套的匿名跟评', () => {
    phone.open(panelFor());
    expect(query('.phone__post-title').textContent).toBe('开学日的照片');
    expect(query('.phone__post-time').textContent).toBe('今天 12:30');
    expect(query('.phone__post-text').textContent).toBe('照片之外，还有未被看见的事情。');
    expect(query('.phone__post-stats').textContent).toBe('浏览 1250 · 评论 86');
    const a = query('[data-comment-id="A"]');
    const c = query('[data-comment-id="C"]');
    expect(a.querySelector('.phone__post-author')?.textContent).toBe('匿名A');
    expect(c.parentElement?.className).toContain('phone__post-comments--nested');
    expect(a.contains(c)).toBe(true);
    expect(c.querySelector('.phone__post-reply-to')?.textContent).toBe('回复 匿名A');
    expect(a.querySelector('.phone__post-likes')?.textContent).toBe('赞 18');
    expect(c.querySelector('.phone__post-likes')?.textContent).toBe('赞 5');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('评论 A/C 与动作按钮只回传 reply 协议，不改数据、赞数或追加心声', () => {
    const panel = panelFor();
    const snapshot = JSON.stringify(panel);
    phone.open(panel);
    const content = query('.phone__post').textContent;
    for (const id of ['comment-a', 'comment-c', 'post-share']) query(`[data-post-action="${id}"]`).click();
    expect(onAction.mock.calls).toEqual([
      ['wall-phone', 'reply', 'comment-a'],
      ['wall-phone', 'reply', 'comment-c'],
      ['wall-phone', 'reply', 'post-share'],
    ]);
    expect(JSON.stringify(panel)).toBe(snapshot);
    expect(query('.phone__post').textContent).toBe(content);
    expect(phone.isOpen()).toBe(true);
  });

  it('静态评论和点赞数字不伪装成按钮', () => {
    phone.open(panelFor());
    const comment = query('[data-comment-id="B"]');
    expect(comment.querySelectorAll('button')).toHaveLength(0);
    expect(comment.querySelector('.phone__post-text')?.textContent).toBe('我也看到了这张照片。');
    expect(comment.querySelector('.phone__post-likes')?.textContent).toBe('赞 0');
    comment.click();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('图片使用真实资产入口，未就绪图片为内联 SVG 而非缺失路径', () => {
    const post = postData();
    phone.open(panelFor(post));
    const images = query('.phone__post-images').querySelectorAll('img');
    expect(images).toHaveLength(2);
    images.forEach((image, index) => {
      const id = post.assetIds[index] as AssetId;
      expect(image.dataset.assetId).toBe(id);
      expect(image.alt).toBe(ASSET_MANIFEST[id].alt);
      expect(image.draggable).toBe(false);
      if (READY_EXTERNAL_ASSETS[id] === ASSET_MANIFEST[id].path) {
        expect(image.src).toBe(ASSET_MANIFEST[id].path);
      } else {
        expect(image.src).toMatch(/^data:image\/svg\+xml/);
      }
    });
  });

  it('计数从上一时刻滚动到真实数值，关闭取消未完成动画', () => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }) }));
    const frames = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextId, callback); return nextId; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const post = { ...postData(), previousStats: { views: 68, commentCount: 3 } };
    phone.open(panelFor(post));
    expect(query('.phone__post-stats').textContent).toBe('浏览 68 · 评论 3');
    const callback = [...frames.values()][0];
    frames.clear();
    callback(performance.now() + 2000);
    expect(query('.phone__post-stats').textContent).toBe('浏览 1250 · 评论 86');
    expect(frames.size).toBe(0);
    phone.open(panelFor(post));
    expect(frames.size).toBe(1);
    phone.hide();
    expect(frames.size).toBe(0);
  });

  it('减少动态效果直接显示终值而不申请动画帧', () => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), { matchMedia: () => ({ matches: true }) }));
    const request = vi.fn();
    vi.stubGlobal('requestAnimationFrame', request);
    phone.open(panelFor({ ...postData(), previousStats: { views: 68, commentCount: 3 } }));
    expect(query('.phone__post-stats').textContent).toBe('浏览 1250 · 评论 86');
    expect(request).not.toHaveBeenCalled();
  });

  it('删除态仅显示灰色占位，不渲染原图、正文、评论或操作', () => {
    phone.open(panelFor({ ...postData(), deleted: true }));
    const card = query('.phone__post--deleted');
    expect(card.textContent).toContain('该内容已删除');
    expect(card.textContent).not.toContain('照片之外');
    expect(card.querySelectorAll('img')).toHaveLength(0);
    expect(card.querySelectorAll('button')).toHaveLength(0);
    expect(card.querySelectorAll('.phone__post-comment')).toHaveLength(0);
    expect(onAction).not.toHaveBeenCalled();
  });

  it.each(['close', 'hide', 'dispose'] as const)('%s 后旧评论/动作点击无回调', (method) => {
    phone.open(panelFor());
    const oldButtons = query('.phone__post').querySelectorAll('button');
    if (method === 'close') query('.phone__close').click();
    else phone[method]();
    const calls = onAction.mock.calls.length;
    oldButtons.forEach((button) => button.click());
    expect(onAction).toHaveBeenCalledTimes(calls);
    expect(calls).toBe(method === 'close' ? 1 : 0);
    expect(phone.isOpen()).toBe(false);
  });

  it('即使重开同一份面板对象，已脱离 DOM 的旧按钮也不回调', () => {
    const panel = panelFor();
    phone.open(panel);
    const oldButton = query('[data-post-action="comment-a"]');
    phone.hide();
    phone.open(panel);
    oldButton.click();
    expect(onAction).not.toHaveBeenCalled();
    query('[data-post-action="comment-a"]').click();
    expect(onAction).toHaveBeenCalledExactlyOnceWith('wall-phone', 'reply', 'comment-a');
  });

  it('core 回调同步关闭后，其他旧按钮不能继续触发', () => {
    onAction.mockImplementation(() => phone.hide());
    phone.open(panelFor());
    const a = query('[data-post-action="comment-a"]');
    const c = query('[data-post-action="comment-c"]');
    a.click();
    c.click();
    expect(onAction).toHaveBeenCalledExactlyOnceWith('wall-phone', 'reply', 'comment-a');
  });

  it('缺失父评论及循环引用仍可展示，每条评论只渲染一次', () => {
    const post = postData();
    post.comments = [
      { id: 'orphan', author: '匿名', text: '父评论已不可见。', likes: 0, replyTo: 'missing' },
      { id: 'a', author: '匿名A', text: '跟评一。', likes: 1, replyTo: 'b' },
      { id: 'b', author: '匿名B', text: '跟评二。', likes: 2, replyTo: 'a' },
    ];
    phone.open(panelFor(post));
    expect(query('.phone__post').querySelectorAll('.phone__post-comment')).toHaveLength(3);
  });

  it('混合主页仍可进入聊天并按原协议回复', () => {
    const panel = panelFor();
    panel.sections.push({
      kind: 'chat', id: 'chat', title: '迎新群', unread: 1,
      messages: [{ id: 'welcome', from: '同学', text: '欢迎大家。' }],
      replyOptions: [{ id: 'chat-reply', text: '收到' }],
    });
    phone.open(panel);
    query('.phone__row').click();
    expect(query('.phone__message-text').textContent).toBe('欢迎大家。');
    query('.phone__reply').click();
    expect(onAction).toHaveBeenCalledExactlyOnceWith('wall-phone', 'reply', 'chat-reply');
    query('.phone__back').click();
    expect(query('.phone__post-title').textContent).toBe('开学日的照片');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhonePanel, PhoneSection, PhoneTab } from '../data/storySchema';
import { clampPhoneLightbox, PhonePanelView, type PhonePanelCallbacks } from './phonePanel';

// 使用真实 PhonePanelView / 资产入口；补齐尺寸、焦点、冒泡与 pointer capture。
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
  offsetWidth = 400;
  offsetHeight = 200;
  parentElement: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  private text = '';
  private readonly attributes = new Map<string, string>();
  private readonly captures = new Set<number>();
  constructor(readonly tagName: string) { super(); }
  get ownerDocument(): typeof doc { return doc; }
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
      if (value.startsWith('.')) return this.className.split(/\s+/).includes(value.slice(1));
      if (value === '[hidden]') return this.hidden;
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(value);
      if (attr) return this.attributes.has(attr[1]) && (attr[2] === undefined || this.getAttribute(attr[1]) === attr[2]);
      return value === this.tagName;
    });
  }
  querySelectorAll(selector: string): FakeElement[] {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector: string): FakeElement | null { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector: string): FakeElement | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  contains(node: FakeElement | null): boolean { return this === node || this.children.some((child) => child.contains(node)); }
  override dispatchEvent(event: Event): boolean {
    // 原生 EventTarget 每次 dispatch 会重置 target；DOM 冒泡应保留最初节点。
    if (!event.target) Object.defineProperty(event, 'target', { value: this });
    const result = super.dispatchEvent(event);
    if (event.bubbles && !event.cancelBubble) this.parentElement?.dispatchEvent(event);
    return result;
  }
  click(): void { this.dispatchEvent(new Event('click', { bubbles: true })); }
  focus(): void { doc.activeElement = this; }
  hasPointerCapture(id: number): boolean { return this.captures.has(id); }
  setPointerCapture(id: number): void { this.captures.add(id); }
  releasePointerCapture(id: number): void { this.captures.delete(id); }
}

let doc: { body: FakeElement; activeElement: FakeElement | null; createElement: (tag: string) => FakeElement };
let phone: PhonePanelView;
let onAction: ReturnType<typeof vi.fn<PhonePanelCallbacks['onAction']>>;
const photo = (): Extract<PhoneSection, { kind: 'photo' }> => ({
  kind: 'photo', id: 'photo', title: '开学合照', assetId: 'cg_s6_gate_panorama',
  hotspot: { x: 69, y: 37, width: 16, height: 38 }, likeActionId: 'like', noticeActionId: 'notice',
});
const post = (): Extract<PhoneSection, { kind: 'post' }> => ({
  kind: 'post', id: 'post', title: '校园墙投稿', text: '请听听完整的经过。', publishedAt: '今天',
  views: 10, commentCount: 1, assetIds: ['cg_s11_post_crop', 'cg_s6_gate_panorama'],
  comments: [{ id: 'a', author: '匿名', text: '还有其他视角吗？', likes: 1, actionId: 'comment-a' }],
});
function panel(): PhonePanel {
  return {
    id: 'tabs', closeActionId: 'close', sections: [
      { kind: 'chat', id: 'ordinary', title: '同学', unread: 1, messages: [{ id: 'hello', from: '同学', text: '你好。' }] },
      { kind: 'chat', id: 'pinned', title: '迎新群', pinned: true, unread: 2,
        messages: [{ id: 'welcome', from: '同学', text: '欢迎大家。' }], attachments: ['photo', 'post'],
        replyOptions: [{ id: 'reply', text: '收到', effects: { set: { harm: 99 } } }] },
      { kind: 'memo', id: 'memo', title: '报到清单', updatedAt: '今天', items: ['带好证件', '领取钥匙'] },
      { kind: 'alarm', id: 'alarm', label: '起床', dismissed: true },
      { kind: 'notice', id: 'notice-card', text: '报到处已开放。' }, photo(), post(),
    ],
  };
}
function query(selector: string): FakeElement {
  const element = doc.body.querySelector(selector);
  if (!element) throw new Error(`找不到 ${selector}`);
  return element;
}
function tab(id: PhoneTab): void { query('.phone__tabs').querySelector(`[data-phone-tab="${id}"]`)!.click(); }
function key(code: string, shiftKey = false): Event {
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, { code, shiftKey, repeat: false });
  window.dispatchEvent(event);
  return event;
}
function pointer(target: EventTarget, type: string, x: number, y: number, pointerId = 1): void {
  const event = new Event(type, { cancelable: true, bubbles: true });
  Object.assign(event, { clientX: x, clientY: y, pointerId, button: 0 });
  target.dispatchEvent(event);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  doc = { body: new FakeElement('body'), activeElement: null, createElement: (tag) => new FakeElement(tag) };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('Node', FakeElement);
  onAction = vi.fn();
  phone = new PhonePanelView(doc.body as unknown as HTMLElement, { onAction });
});
afterEach(() => { phone.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('v0.6 四 Tab 展示', () => {
  it('默认 post 优先校园墙，消息置顶与附件按 kind 分栏，切换不改输入', () => {
    const data = panel();
    const snapshot = JSON.stringify(data);
    phone.open(data);
    expect(query('.phone__home-title').textContent).toBe('校园墙');
    expect(query('.phone__tabs').querySelectorAll('button')).toHaveLength(4);
    expect(doc.body.querySelector('.phone__row')).toBeNull();
    tab('messages');
    expect(query('.phone__row').getAttribute('data-section-id')).toBe('pinned');
    expect(query('.phone__row--pinned').textContent).toContain('置顶');
    expect(query('.phone__notice-text').textContent).toBe('报到处已开放。');
    expect(doc.body.querySelector('.phone__post')).toBeNull();
    expect(doc.body.querySelector('.phone__photo-card')).toBeNull();
    query('[data-section-id="pinned"]').click();
    expect(query('.phone__photo-card').textContent).toContain('开学合照');
    expect(query('.phone__share-card').querySelectorAll('img')).toHaveLength(1);
    query('[data-open-wall="post"]').click();
    expect(query('.phone__home-title').textContent).toBe('校园墙');
    tab('notes');
    expect(query('.phone__memo-card').textContent).toContain('带好证件');
    expect(query('.phone__memo-list').children).toHaveLength(2);
    expect(doc.body.querySelector('.phone__post')).toBeNull();
    expect(JSON.stringify(data)).toBe(snapshot);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('空墙、memo-only、photo-only 与显式 defaultTab 兼容', () => {
    phone.open({ id: 'empty', sections: [], closeActionId: 'close' });
    expect(query('.phone__home-title').textContent).toBe('消息');
    tab('wall');
    expect(query('.phone__empty').textContent).toBe('校园墙还没有新动态。');
    phone.open({ ...panel(), sections: [panel().sections[2]] });
    expect(query('.phone__home-title').textContent).toBe('备忘录');
    phone.open({ ...panel(), sections: [photo()] });
    expect(query('.phone__home-title').textContent).toBe('消息');
    expect(query('.phone__photo-thumbnail')).toBeDefined();
    phone.open({ ...panel(), defaultTab: 'me' });
    expect(query('.phone__home-title').textContent).toBe('我');
  });

  it('我展示传入资料与已解锁草稿，隐藏未解锁文本且不判断剧情', () => {
    phone.open({ ...panel(), defaultTab: 'me', profile: { name: '新生', account: 'campus_26', drafts: [
      { text: '想说的话', unlocked: true }, { text: '尚未解锁的正文', unlocked: false },
    ] } });
    expect(query('.phone__profile').textContent).toContain('campus_26');
    expect(query('.phone__draft').textContent).toBe('想说的话');
    expect(query('.phone__draft--locked').textContent).toBe('未发送的草稿');
    expect(query('.phone__body').textContent).not.toContain('尚未解锁的正文');
    phone.open({ ...panel(), defaultTab: 'me' });
    expect(query('.phone__empty').textContent).toContain('故事结束后');
  });

  it('删除占位显示传入历史转发数，不显示旧内容或互动', () => {
    phone.open({ ...panel(), sections: [{ ...post(), deleted: true, historicalTransfers: 214 }] });
    expect(query('.phone__post-placeholder').textContent).toBe('该内容已删除');
    expect(query('.phone__post-stats').textContent).toBe('历史转发 214（未归零）');
    expect(query('.phone__post').querySelectorAll('button,img')).toHaveLength(0);
    phone.open({ ...panel(), sections: [{ ...post(), deleted: true, historicalTransfers: 7 }] });
    expect(query('.phone__post-stats').textContent).toContain('7（未归零）');
  });

  it('推送三秒后隐藏，点击定位分区，hide/reopen/dispose 清除旧计时', () => {
    const data = { ...panel(), notification: { title: '迎新群', text: '有新照片', sectionId: 'pinned' } };
    phone.open(data);
    expect(query('.phone__push-banner').textContent).toContain('有新照片');
    vi.advanceTimersByTime(2999);
    expect(query('.phone__push-banner').hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(query('.phone__push-banner').hidden).toBe(true);
    phone.open(data);
    query('.phone__push-banner').click();
    expect(query('.phone__section-title').textContent).toBe('迎新群');
    expect(query('.phone__push-banner').hidden).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    phone.open(data);
    vi.advanceTimersByTime(2000);
    phone.hide();
    expect(vi.getTimerCount()).toBe(0);
    phone.open(data);
    vi.advanceTimersByTime(1000);
    expect(query('.phone__push-banner').hidden).toBe(false);
    phone.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('锁屏 E 解锁；冷却后 E 收起；ESC 不关闭手机；焦点 trap 并恢复外部焦点', () => {
    const external = doc.createElement('button');
    doc.body.append(external);
    external.focus();
    phone.open({ ...panel(), lockTime: '8:47' });
    expect(query('.phone__tabs').hidden).toBe(true);
    vi.advanceTimersByTime(180);
    expect(key('KeyE').defaultPrevented).toBe(true);
    expect(doc.body.querySelector('.phone__lockscreen')).toBeNull();
    expect(phone.isOpen()).toBe(true);
    key('Escape');
    expect(phone.isOpen()).toBe(true);
    const buttons = query('.phone-frame').querySelectorAll('button').filter((button) => !button.hidden);
    buttons[buttons.length - 1].focus();
    key('Tab');
    expect(doc.activeElement).toBe(buttons[0]);
    key('Tab', true);
    expect(doc.activeElement).toBe(buttons[buttons.length - 1]);
    vi.advanceTimersByTime(180);
    key('KeyE');
    expect(phone.isOpen()).toBe(false);
    expect(doc.activeElement).toBe(external);
    expect(onAction).toHaveBeenCalledExactlyOnceWith('tabs', 'close');
  });

  it('旧聊天回复、分享、照片入口、点赞和 Tab 在切页/同对象重开后失效', () => {
    const data = { ...panel(), defaultTab: 'messages' as const };
    phone.open(data);
    query('[data-section-id="pinned"]').click();
    const old = query('.phone__body').querySelectorAll('button');
    const oldTab = query('.phone__tab');
    phone.open(data);
    tab('notes');
    [...old, oldTab].forEach((button) => button.click());
    expect(query('.phone__home-title').textContent).toBe('备忘录');
    expect(query('.phone__photo-modal').hidden).toBe(true);
    expect(onAction).not.toHaveBeenCalled();
    tab('messages');
    query('[data-section-id="pinned"]').click();
    const reply = query('.phone__reply');
    reply.click();
    reply.click();
    expect(onAction).toHaveBeenCalledExactlyOnceWith('tabs', 'reply', 'reply');
    expect(data.sections[1].kind).toBe('chat');
  });
});

describe('Lightbox 缩放拖动与隔离', () => {
  function openPhoto(data: PhonePanel = { ...panel(), sections: [photo()] }): void {
    phone.open(data);
    query('.phone__photo-thumbnail').click();
  }
  it('缩放范围 1..3.2、步长 .55、百分比、还原和图片相对热区', () => {
    openPhoto();
    const hot = query('.phone__photo-hotspot');
    expect(hot.style).toMatchObject({ left: '77%', top: '56%', width: '16%', height: '38%' });
    query('[data-photo-zoom="in"]').click();
    expect(query('.phone__photo-percent').textContent).toBe('155%');
    expect(query('.phone__photo-stage').style.transform).toBe('translate(0px, 0px) scale(1.55)');
    for (let i = 0; i < 8; i++) query('[data-photo-zoom="in"]').click();
    expect(query('.phone__photo-percent').textContent).toBe('320%');
    for (let i = 0; i < 8; i++) query('[data-photo-zoom="out"]').click();
    expect(query('.phone__photo-percent').textContent).toBe('100%');
    query('[data-photo-zoom="in"]').click();
    query('[data-photo-zoom="reset"]').click();
    expect(query('.phone__photo-stage').style.transform).toBe('translate(0px, 0px) scale(1)');
    expect(hot.parentElement).toBe(query('.phone__photo-stage'));
    expect(onAction).not.toHaveBeenCalled();
  });

  it('拖动从热区开始也不会误触，夹紧边界；cancel 释放捕获，下一次轻点仍生效', () => {
    openPhoto();
    query('[data-photo-zoom="in"]').click();
    const viewport = query('.phone__photo-viewport');
    const hot = query('.phone__photo-hotspot');
    pointer(hot, 'pointerdown', 10, 10);
    pointer(window, 'pointermove', 10000, -10000);
    expect(viewport.hasPointerCapture(1)).toBe(true);
    expect(query('.phone__photo-stage').style.transform).toBe('translate(110.00000000000001px, -55.00000000000001px) scale(1.55)');
    pointer(window, 'pointerup', 10000, -10000);
    hot.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(viewport.hasPointerCapture(1)).toBe(false);
    pointer(hot, 'pointerdown', 20, 20);
    pointer(window, 'pointermove', 30, 30);
    pointer(window, 'pointercancel', 30, 30);
    hot.click();
    expect(viewport.hasPointerCapture(1)).toBe(false);
    expect(onAction).not.toHaveBeenCalled();
    pointer(hot, 'pointerdown', 20, 20);
    pointer(window, 'pointerup', 20, 20);
    hot.click();
    hot.click();
    expect(onAction).toHaveBeenCalledExactlyOnceWith('tabs', 'reply', 'notice');
  });

  it('只读帖子图片也能缩放，背景评论被隔离；ESC 恢复焦点及 frame.inert', () => {
    phone.open({ ...panel(), sections: [post()] });
    const opener = query('.phone__post-image');
    const comment = query('[data-post-action="comment-a"]');
    opener.click();
    expect(query('.phone-frame').inert).toBe(true);
    expect(doc.body.querySelector('.phone__photo-hotspot')).toBeNull();
    expect(doc.body.querySelector('.phone__photo-like')).toBeNull();
    query('[data-photo-zoom="in"]').click();
    comment.click();
    expect(onAction).not.toHaveBeenCalled();
    const buttons = query('.phone__photo-modal').querySelectorAll('button');
    buttons[buttons.length - 1].focus();
    key('Tab');
    expect(doc.activeElement).toBe(buttons[0]);
    key('Tab', true);
    expect(doc.activeElement).toBe(buttons[buttons.length - 1]);
    key('Escape');
    expect(query('.phone__photo-modal').hidden).toBe(true);
    expect(query('.phone-frame').inert).toBe(false);
    expect(doc.activeElement).toBe(opener);
    expect(phone.isOpen()).toBe(true);
    comment.click();
    expect(onAction).toHaveBeenCalledExactlyOnceWith('tabs', 'reply', 'comment-a');
  });

  it('关闭/hide 清理拖动，旧热区及缩放按钮重开后无效；like/notice 去重接受新 API', () => {
    const data = { ...panel(), sections: [photo()] };
    openPhoto(data);
    query('[data-photo-zoom="in"]').click();
    const viewport = query('.phone__photo-viewport');
    pointer(viewport, 'pointerdown', 0, 0);
    pointer(window, 'pointermove', 40, 40);
    const old = query('.phone__photo-modal').querySelectorAll('button');
    phone.hide();
    expect(viewport.hasPointerCapture(1)).toBe(false);
    openPhoto(data);
    old.forEach((button) => button.click());
    pointer(window, 'pointermove', 80, 80);
    expect(query('.phone__photo-percent').textContent).toBe('100%');
    expect(query('.phone__photo-modal').hidden).toBe(false);
    expect(onAction).not.toHaveBeenCalled();
    query('.phone__photo-modal').querySelector('.phone__photo-like')!.click();
    query('.phone__photo-modal').querySelector('.phone__photo-like')!.click();
    expect(onAction).toHaveBeenCalledExactlyOnceWith('tabs', 'reply', 'like');
    onAction.mockClear();
    openPhoto({ ...data, likedPhoto: true, noticedPhoto: true });
    query('.phone__photo-hotspot').click();
    query('.phone__photo-modal').querySelector('.phone__photo-like')!.click();
    expect(query('.phone__photo-like').textContent).toBe('已赞');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('Lightbox 中 E 与 ESC 都只返回图片；未打开图片时 E 才收起整部手机', () => {
    openPhoto();
    key('Escape');
    expect(phone.isOpen()).toBe(true);
    expect(query('.phone__photo-modal').hidden).toBe(true);
    query('.phone__photo-thumbnail').click();
    vi.advanceTimersByTime(180);
    key('KeyE');
    expect(phone.isOpen()).toBe(true);
    expect(query('.phone__photo-modal').hidden).toBe(true);
    expect(query('.phone-frame').inert).toBe(false);
    expect(onAction).not.toHaveBeenCalled();
    vi.advanceTimersByTime(180);
    key('KeyE');
    expect(phone.isOpen()).toBe(false);
    expect(query('.phone__photo-modal').hidden).toBe(true);
    expect(query('.phone-frame').inert).toBe(false);
    expect(onAction).toHaveBeenCalledExactlyOnceWith('tabs', 'close');
  });

  it('model 在缩回 1 时归零，任意拖动不丢失图片', () => {
    expect(clampPhoneLightbox({ zoom: 20, x: 9999, y: -9999 }, 400, 200)).toEqual({ zoom: 3.2, x: 440.00000000000006, y: -220.00000000000003 });
    expect(clampPhoneLightbox({ zoom: 0, x: 90, y: -90 }, 400, 200)).toEqual({ zoom: 1, x: 0, y: -0 });
  });
});

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { READY_EXTERNAL_ASSETS } from '../data/assetManifest';
import { EXPRESSION_PORTRAITS } from '../data/expressionPortraits';
import { DialogueBox, SPEAKER_PORTRAIT_URLS } from './dialogueBox';

class ClassListStub {
  private readonly items = new Set<string>();
  constructor(private readonly host: ElementStub) {}
  sync(raw: string): void {
    this.items.clear();
    for (const part of raw.split(/\s+/)) if (part) this.items.add(part);
  }
  add(...names: string[]): void {
    for (const name of names) if (name) this.items.add(name);
    this.host.setClassNameRaw(Array.from(this.items).join(' '));
  }
  remove(...names: string[]): void {
    for (const name of names) this.items.delete(name);
    this.host.setClassNameRaw(Array.from(this.items).join(' '));
  }
  toggle(name: string, force?: boolean): boolean {
    const next = force ?? !this.items.has(name);
    if (next) this.items.add(name);
    else this.items.delete(name);
    this.host.setClassNameRaw(Array.from(this.items).join(' '));
    return next;
  }
  contains(name: string): boolean {
    return this.items.has(name);
  }
}

class ElementStub extends EventTarget {
  hidden = false;
  textContent = '';
  alt = '';
  decoding = '';
  draggable = true;
  src = '';
  attributes: Record<string, string> = {};
  children: ElementStub[] = [];
  parent: ElementStub | null = null;
  private rawClassName = '';
  readonly classList = new ClassListStub(this);

  constructor(readonly tagName = 'div') {
    super();
  }

  get className(): string {
    return this.rawClassName;
  }

  set className(value: string) {
    this.rawClassName = value;
    this.classList.sync(value);
  }

  setClassNameRaw(value: string): void {
    this.rawClassName = value;
  }

  append(...children: ElementStub[]): void {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }

  replaceChildren(): void {
    for (const child of this.children) child.parent = null;
    this.children = [];
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  findByClass(target: string): ElementStub | null {
    if (this.classList.contains(target)) return this;
    for (const child of this.children) {
      const hit = child.findByClass(target);
      if (hit) return hit;
    }
    return null;
  }
}

describe('DialogueBox 左侧人物立绘渲染与降级', () => {
  let rootHost: ElementStub;
  let box: DialogueBox | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    rootHost = new ElementStub('div');
    const docStub = {
      createElement: (tag: string) => new ElementStub(tag),
    };
    const winStub = Object.assign(new EventTarget(), {
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
    });
    vi.stubGlobal('document', docStub);
    vi.stubGlobal('window', winStub);
    vi.stubGlobal('HTMLElement', ElementStub);
  });

  afterEach(() => {
    box?.dispose();
    box = null;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('SPEAKER_PORTRAIT_URLS 与已就绪外部立绘清单对齐', () => {
    expect(SPEAKER_PORTRAIT_URLS.linxia).toBe(READY_EXTERNAL_ASSETS.portrait_linxia_casual);
    expect(SPEAKER_PORTRAIT_URLS.father).toBe(READY_EXTERNAL_ASSETS.portrait_father);
    expect(SPEAKER_PORTRAIT_URLS.volunteer).toBe(READY_EXTERNAL_ASSETS.portrait_volunteer);
    expect(SPEAKER_PORTRAIT_URLS.xiaochen).toBe(READY_EXTERNAL_ASSETS.portrait_xiaochen);
    expect(SPEAKER_PORTRAIT_URLS.ayuan).toBe(READY_EXTERNAL_ASSETS.portrait_ayuan);
    expect(SPEAKER_PORTRAIT_URLS.teacher).toBe(READY_EXTERNAL_ASSETS.portrait_teacher);
  });

  it('有立绘角色在左侧渲染立绘，同人连句不重建 DOM，无立绘或旁白自动隐藏并降级', () => {
    const onEnd = vi.fn();
    box = new DialogueBox({
      container: rootHost as unknown as HTMLElement,
      onEnd,
    });

    box.show({
      stepId: 's7-talk',
      speakerNames: { linxia: '林夏', mom: '妈妈', ayuan: '阿远' },
      lines: [
        { speaker: 'linxia', text: '第一句' },
        { speaker: 'linxia', text: '第二句' },
        { speaker: 'mom', text: '无立绘角色' },
        { speaker: null, text: '旁白台词' },
        { speaker: 'ayuan', text: '切换立绘' },
      ],
    });

    const section = rootHost.findByClass('dialogue')!;
    const portrait = section.findByClass('dialogue__portrait')!;
    const panel = section.findByClass('dialogue__panel')!;

    // 第一句：林夏显示左侧立绘
    expect(portrait.hidden).toBe(false);
    expect(section.classList.contains('dialogue--has-portrait')).toBe(true);
    const firstImg = portrait.findByClass('dialogue__portrait-image')!;
    expect(firstImg.src).toBe(READY_EXTERNAL_ASSETS.portrait_linxia_casual);

    // 点击一次跳过打字，再点击进入第二句（同为林夏，应复用同一 <img> 节点防闪烁）
    panel.dispatchEvent(new Event('click'));
    panel.dispatchEvent(new Event('click'));
    expect(portrait.findByClass('dialogue__portrait-image')).toBe(firstImg);

    // 第三句：妈妈无配置立绘，左侧立绘隐藏，降级显示首字圆标
    panel.dispatchEvent(new Event('click'));
    panel.dispatchEvent(new Event('click'));
    expect(portrait.hidden).toBe(true);
    expect(section.classList.contains('dialogue--has-portrait')).toBe(false);
    expect(section.findByClass('dialogue__avatar-letter')?.textContent).toBe('妈');

    // 第四句：旁白隐藏立绘与圆标
    panel.dispatchEvent(new Event('click'));
    panel.dispatchEvent(new Event('click'));
    expect(portrait.hidden).toBe(true);
    expect(section.classList.contains('dialogue--narration')).toBe(true);

    // 第五句：阿远切回左侧立绘；模拟图片加载失败则自动降级回首字圆标
    panel.dispatchEvent(new Event('click'));
    panel.dispatchEvent(new Event('click'));
    const ayuanImg = portrait.findByClass('dialogue__portrait-image')!;
    expect(ayuanImg.src).toBe(READY_EXTERNAL_ASSETS.portrait_ayuan);
    ayuanImg.dispatchEvent(new Event('error'));
    expect(portrait.hidden).toBe(true);
    expect(section.classList.contains('dialogue--has-portrait')).toBe(false);
  });

  it('30 张差分表情立绘文件真实存在；同角色按台词与情绪原地换脸不重建 DOM，失败回退默认立绘', () => {
    for (const rel of Object.values(EXPRESSION_PORTRAITS)) {
      const file = resolve(process.cwd(), 'public', rel.slice('./'.length));
      expect(existsSync(file), `缺少表情立绘：${rel}`).toBe(true);
    }
    const onEnd = vi.fn();
    box = new DialogueBox({
      container: rootHost as unknown as HTMLElement,
      onEnd,
    });
    box.show({
      stepId: 'e1-best-gift',
      speakerNames: { linxia: '林夏', ayuan: '阿远', teacher: '周老师' },
      lines: [
        { speaker: 'linxia', text: '……给你。' },
        { speaker: 'linxia', text: '我自己画的。' },
        { speaker: 'ayuan', text: '你说的这些话，我也截下来了。' },
        { speaker: 'teacher', text: '林夏同意吗？' },
        { speaker: 'linxia', emotion: 'cry', text: '未收录但带哭泣情绪的台词' },
      ],
    });
    const section = rootHost.findByClass('dialogue')!;
    const portrait = section.findByClass('dialogue__portrait')!;
    const panel = section.findByClass('dialogue__panel')!;

    const img = portrait.findByClass('dialogue__portrait-image')!;
    expect(img.src).toBe(EXPRESSION_PORTRAITS.linxiaSmile2);

    // 同一说话人切换到“我自己画的。”，复用同一 <img> 原地切真心笑
    panel.dispatchEvent(new Event('click'));
    panel.dispatchEvent(new Event('click'));
    expect(portrait.findByClass('dialogue__portrait-image')).toBe(img);
    expect(img.src).toBe(EXPRESSION_PORTRAITS.linxiaJoy2);

    // 切换阿远阴阳怪气_3，若该表情图加载失败先回退基础半身立绘
    panel.dispatchEvent(new Event('click'));
    panel.dispatchEvent(new Event('click'));
    const ayuanImg = portrait.findByClass('dialogue__portrait-image')!;
    expect(ayuanImg.src).toBe(EXPRESSION_PORTRAITS.ayuanSmirk3);
    ayuanImg.dispatchEvent(new Event('error'));
    expect(portrait.hidden).toBe(false);
    expect(ayuanImg.src).toBe(READY_EXTERNAL_ASSETS.portrait_ayuan);

    // 周老师正色_2
    panel.dispatchEvent(new Event('click'));
    panel.dispatchEvent(new Event('click'));
    expect(portrait.findByClass('dialogue__portrait-image')!.src).toBe(EXPRESSION_PORTRAITS.teacherSerious2);

    // 未收录但带 cry 情绪 → 命中林夏低落_3
    panel.dispatchEvent(new Event('click'));
    panel.dispatchEvent(new Event('click'));
    expect(portrait.findByClass('dialogue__portrait-image')!.src).toBe(EXPRESSION_PORTRAITS.linxiaLow3);
  });
});

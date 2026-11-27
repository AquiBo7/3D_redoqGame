import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASSET_MANIFEST, PHOTO_CROP, PHOTO_HOTSPOT, READY_EXTERNAL_ASSETS, type AssetId } from '../data/assetManifest';
import { ASSETS, assetSource, renderAssetImage, renderLinPaintingCard, resolveLinPaintingFlags } from './assetImage';

const ids = Object.keys(ASSET_MANIFEST) as AssetId[];
const originalReady = { ...READY_EXTERNAL_ASSETS };

function clearReady(): void {
  for (const id of ids) delete READY_EXTERNAL_ASSETS[id];
}

function svg(id: AssetId): string {
  return decodeURIComponent(assetSource(id).split(',')[1]);
}

class ImageStub {
  alt = '';
  width = 0;
  height = 0;
  decoding = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  onerror: (() => void) | null = null;
  assignments: string[] = [];
  set src(value: string) { this.assignments.push(value); }
  get src(): string { return this.assignments[this.assignments.length - 1]; }
}

function host(): { container: HTMLElement; children: unknown[]; image: ImageStub } {
  const image = new ImageStub();
  const children: unknown[] = ['保留已有内容'];
  const container = {
    ownerDocument: { createElement: vi.fn(() => image) },
    append: (child: unknown) => children.push(child),
  } as unknown as HTMLElement;
  return { container, image, children };
}

afterEach(() => {
  clearReady();
  Object.assign(READY_EXTERNAL_ASSETS, originalReady);
  vi.unstubAllGlobals();
});

describe('Phase A 美术图片 API', () => {
  it('22 张内置图同步、自包含、独特，无网络探测与重型引擎', () => {
    clearReady();
    const fetch = vi.fn(() => { throw new Error('禁止网络探测'); });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('Image', class { constructor() { throw new Error('禁止图片预探测'); } });
    expect(ids).toHaveLength(22);
    const urls = ids.map(assetSource);
    expect(new Set(urls).size).toBe(22);
    expect(urls.reduce((sum, url) => sum + url.length, 0)).toBeLessThan(512 * 1024);
    for (const id of ids) {
      expect(assetSource(id)).toBe(assetSource(id));
      expect(assetSource(id)).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
      expect(assetSource(id).length).toBeLessThan(64 * 1024);
      const source = svg(id);
      expect(source).toContain(`<title>${ASSET_MANIFEST[id].alt}</title>`);
      expect((source.match(/<path\b/g) || []).length).toBeGreaterThan(4);
      expect(source).not.toMatch(/<script|<foreignObject|<image\b|\bon\w+=|href=|url\(/i);
      expect(ASSET_MANIFEST[id].alt.length).toBeGreaterThan(25);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('只加载 ready 中匹配固定相对路径的图片，拒绝任意 URL', () => {
    clearReady();
    const id = 'portrait_linxia_casual';
    READY_EXTERNAL_ASSETS[id] = ASSET_MANIFEST[id].path;
    expect(assetSource(id)).toBe('./art/portraits/linxia_casual.png');
    expect(assetSource('portrait_father')).toMatch(/^data:/);
    for (const invalid of ['https://example.invalid/a.png', 'javascript:alert(1)', './art/not-there.png', '']) {
      READY_EXTERNAL_ASSETS[id] = invalid;
      expect(assetSource(id)).toMatch(/^data:/);
    }
  });

  it('返回 HTMLImageElement 并追加，不移除容器内容；兜底没有重试 handler', () => {
    clearReady();
    const { container, children, image } = host();
    const returned = renderAssetImage('portrait_father', container);
    expect(returned).toBe(image);
    expect(children).toEqual(['保留已有内容', image]);
    expect(image.alt).toBe(ASSET_MANIFEST.portrait_father.alt);
    expect([image.width, image.height, image.decoding]).toEqual([600, 800, 'async']);
    expect(image.dataset.assetId).toBe('portrait_father');
    expect(image.assignments).toHaveLength(1);
    expect(image.src).toMatch(/^data:/);
    expect(image.onerror).toBeNull();
  });

  it('PNG 出错只回退一次，先移除 onerror，后续新图片仍可尝试替换图', () => {
    clearReady();
    READY_EXTERNAL_ASSETS.trophy_gold = ASSET_MANIFEST.trophy_gold.path;
    const { container, image } = host();
    renderAssetImage('trophy_gold', container);
    expect(image.src).toBe('./art/trophies/trophy_gold.png');
    const handler = image.onerror;
    expect(handler).not.toBeNull();
    handler?.();
    expect(image.onerror).toBeNull();
    expect(image.src).toMatch(/^data:/);
    handler?.();
    expect(image.assignments).toHaveLength(2);
    const next = host();
    renderAssetImage('trophy_gold', next.container);
    expect(next.image.src).toBe('./art/trophies/trophy_gold.png');
  });

  it('全景与 S11 使用完全相同的场景，仅 viewBox 不同；热区包住背负组', () => {
    clearReady();
    const panorama = svg('cg_s6_gate_panorama');
    const crop = svg('cg_s11_post_crop');
    expect(panorama.slice(panorama.indexOf('<g data-composition')))
      .toBe(crop.slice(crop.indexOf('<g data-composition')));
    expect(panorama).toContain('viewBox="0 0 1600 900"');
    expect(crop).toContain(`viewBox="${PHOTO_CROP.x} ${PHOTO_CROP.y} ${PHOTO_CROP.width} ${PHOTO_CROP.height}"`);
    expect(PHOTO_HOTSPOT).toEqual({ x: 69, y: 37, width: 16, height: 38 });
    for (const value of Object.values(PHOTO_HOTSPOT)) expect(value).toBeGreaterThanOrEqual(0);
    expect(PHOTO_HOTSPOT.x + PHOTO_HOTSPOT.width).toBeLessThanOrEqual(100);
    expect(PHOTO_HOTSPOT.y + PHOTO_HOTSPOT.height).toBeLessThanOrEqual(100);
    expect(panorama.includes('translate(1232 458) scale(.42)')).toBe(true);
    expect(PHOTO_HOTSPOT.x * 16).toBeLessThan(1213);
    expect((PHOTO_HOTSPOT.x + PHOTO_HOTSPOT.width) * 16).toBeGreaterThan(1259);
    expect(PHOTO_HOTSPOT.y * 9).toBeLessThan(445);
    expect((PHOTO_HOTSPOT.y + PHOTO_HOTSPOT.height) * 9).toBeGreaterThan(522);
  });

  it('剧情细节由图形实画：小票、划掉的原因、完整画与未完成空台阶', () => {
    clearReady();
    expect(svg('prop_pharmacy_receipt')).toMatch(/<text[^>]*>07:52<\/text>/);
    expect(svg('prop_pharmacy_receipt')).toContain('跌打消肿药贴');
    const form = svg('prop_late_form');
    expect(form).toContain('>脚崴了</text>');
    expect(form).toContain('>路上耽搁了</text>');
    expect(form).toContain('data-motif="crossed-out-reason"');
    const best = svg('cg_ending_best_drawing');
    expect(best).toContain('data-motif="complete-companionship"');
    expect(best).toContain('data-motif="father-watching"');
    expect(best).toContain('data-motif="orange-dot"');
    expect(best).toContain('viewBox="0 0 300 400"');
    expect(best).not.toContain('<text');
    const middle = svg('cg_ending_middle_sketch');
    expect(middle).toContain('data-motif="unfinished-empty-steps"');
    expect(middle).toContain('stroke="#6b6b6b"');
    expect(middle).not.toContain('walking-back');
    expect(middle).not.toContain('<text');
    expect(svg('cg_ending_bystander_seat')).not.toContain('unfinished-empty-steps');
    expect(svg('portrait_linxia_smile')).toContain('M284 281Q301 292 318 279');
    expect(svg('portrait_ayuan')).toContain('fill="#cc8153"');
  });

  it('ASSETS.lin_painting 与 renderLinPaintingCard 根据状态绘制橙点、保安亭与高好感背面字迹', () => {
    const renderSvg = ASSETS.lin_painting as (state?: Record<string, unknown>) => string;
    expect(typeof renderSvg).toBe('function');

    const base = renderSvg({ joined: false, guardWilling: false, trust: 5 });
    expect(base).toContain('viewBox="0 0 300 400"');
    expect(base).toContain('#f3ead8');
    expect(base).toContain('#f2c94c');
    expect(base).toContain('#8c8cf0');
    expect(base).toContain('#1f2745');
    expect(base).not.toContain('orange-dot');
    expect(base).not.toContain('guard-booth');
    expect(base).not.toContain('<text');

    const full = renderSvg({ outcome: '入队', guardWilling: true, trust: 7 });
    expect(full).toContain('data-motif="orange-dot"');
    expect(full).toContain('fill="#f08a24"');
    expect(full).toContain('data-motif="guard-booth"');
    expect(full).not.toContain('<text');

    expect(resolveLinPaintingFlags({ joined: true, guardWilling: false, trust: 6 })).toEqual({
      hasOrangeDot: true,
      hasGuardBooth: false,
      canFlip: false,
    });
    expect(resolveLinPaintingFlags({ outcome: '入队', guardWilling: true, trust: 7 })).toEqual({
      hasOrangeDot: true,
      hasGuardBooth: true,
      canFlip: true,
    });

    // 验证独立卡片 DOM：未达最高好感不可翻面，trust >= 7 可翻面显示“开学第一天。”
    const makeDom = () => {
      const listeners = new Map<string, Array<(e?: unknown) => void>>();
      const makeEl = (tag: string) => {
        const el: Record<string, unknown> = {
          tagName: tag.toUpperCase(),
          className: '',
          textContent: '',
          dataset: {},
          style: {},
          attributes: {} as Record<string, string>,
          children: [] as unknown[],
          tabIndex: 0,
          draggable: true,
          append: (...nodes: unknown[]) => { (el.children as unknown[]).push(...nodes); },
          setAttribute: (k: string, v: string) => { (el.attributes as Record<string, string>)[k] = v; },
          addEventListener: (type: string, fn: (e?: unknown) => void) => {
            const list = listeners.get(type) ?? [];
            list.push(fn);
            listeners.set(type, list);
          },
        };
        return el;
      };
      const container = makeEl('div');
      container.ownerDocument = { createElement: makeEl };
      return { container: container as unknown as HTMLElement, listeners };
    };

    const lockedDom = makeDom();
    const lockedCard = renderLinPaintingCard(lockedDom.container, { hasOrangeDot: true, hasGuardBooth: false, canFlip: false }) as unknown as {
      className: string;
      children: Array<{ children: Array<Record<string, unknown>> }>;
    };
    expect(lockedCard.className).toBe('lin-painting');
    expect(lockedCard.children[0].children).toHaveLength(1);

    const flipDom = makeDom();
    const flipCard = renderLinPaintingCard(flipDom.container, { hasOrangeDot: true, hasGuardBooth: true, canFlip: true }) as unknown as {
      className: string;
      attributes: Record<string, string>;
      children: Array<{ children: Array<Record<string, unknown>> }>;
    };
    expect(flipCard.className).toContain('lin-painting--flippable');
    const back = flipCard.children[0].children[1] as { children: Array<{ textContent: string }> };
    expect(back.children[0].textContent).toBe('开学第一天。');
    expect(back.children[0].textContent).not.toContain('谢谢');
    for (const fn of flipDom.listeners.get('click') ?? []) fn();
    expect(flipCard.className).toContain('is-flipped');
    expect(flipCard.attributes['aria-pressed']).toBe('true');
  });
});

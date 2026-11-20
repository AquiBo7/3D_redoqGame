import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASSET_MANIFEST, PHOTO_CROP, PHOTO_HOTSPOT, READY_EXTERNAL_ASSETS, type AssetId } from '../data/assetManifest';
import { assetSource, renderAssetImage } from './assetImage';

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
    expect(PHOTO_HOTSPOT).toEqual({ x: 35.5, y: 48, width: 4.5, height: 11 });
    for (const value of Object.values(PHOTO_HOTSPOT)) expect(value).toBeGreaterThanOrEqual(0);
    expect(PHOTO_HOTSPOT.x + PHOTO_HOTSPOT.width).toBeLessThanOrEqual(100);
    expect(PHOTO_HOTSPOT.y + PHOTO_HOTSPOT.height).toBeLessThanOrEqual(100);
    expect(PHOTO_HOTSPOT.x * 16).toBeLessThan(579);
    expect((PHOTO_HOTSPOT.x + PHOTO_HOTSPOT.width) * 16).toBeGreaterThan(625);
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
    expect(best).not.toContain('<text');
    const middle = svg('cg_ending_middle_sketch');
    expect(middle).toContain('data-motif="unfinished-empty-steps"');
    expect(middle).not.toContain('walking-back');
    expect(svg('cg_ending_bystander_seat')).not.toContain('unfinished-empty-steps');
    expect(svg('portrait_linxia_smile')).toContain('M284 281Q301 292 318 279');
    expect(svg('portrait_ayuan')).toContain('fill="#cc8153"');
  });
});

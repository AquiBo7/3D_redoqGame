// tools/fontSubset.test.ts —— 本地字体子集契约：文件存在、总量 ≤500KB、正式界面用字无缺字
// 清单由 tools/buildFonts.mjs 回读最终 woff2 的 cmap 生成；改文案后如出现新字，重跑该脚本即可。

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from './fonts-manifest.json';
import { collectCodepoints } from './fontChars.mjs';

interface FontEntry {
  file: string;
  bytes: number;
  codepoints: number[];
}

const fonts = manifest.fonts as Record<string, FontEntry>;
const BUDGET_BYTES = 500 * 1024;

describe('本地中文字体子集', () => {
  it('每个字重只有一个 woff2 文件且真实存在（首屏不发零碎分片请求）', () => {
    expect(Object.keys(fonts)).toEqual(['sans', 'serif']);
    for (const entry of Object.values(fonts)) {
      expect(entry.file.endsWith('.woff2')).toBe(true);
      expect(existsSync(resolve(process.cwd(), 'public/fonts', entry.file))).toBe(true);
    }
  });

  it('字体总增量严格 ≤ 500KB', () => {
    const total = Object.values(fonts).reduce(
      (sum, entry) => sum + statSync(resolve(process.cwd(), 'public/fonts', entry.file)).size,
      0,
    );
    expect(total).toBeLessThanOrEqual(BUDGET_BYTES);
  });

  it('SIL OFL 许可证随字体一起发布', () => {
    expect(existsSync(resolve(process.cwd(), 'public/fonts/OFL.txt'))).toBe(true);
  });

  it('剧本 / UI / 场景招牌全部用字均被两种字体子集覆盖', () => {
    const required = collectCodepoints();
    for (const [id, entry] of Object.entries(fonts)) {
      const covered = new Set(entry.codepoints);
      const missing = required.filter((cp) => !covered.has(cp));
      expect(
        missing,
        `${id} 缺少字形：${String.fromCodePoint(...missing)}，请运行 node tools/buildFonts.mjs`,
      ).toEqual([]);
    }
  });
});

// tools/buildFonts.mjs —— 生成本地中文字体子集：每个字重合并为单个 woff2（首屏只发 2 个字体请求）
// 流程：统计实际用字 → 按 fontsource unicode-range 定位分片 → subset-font 逐片裁剪为 TTF
//      → fontTools 合并分片 → subset-font 输出 woff2 → 回读 cmap 写入清单（供防缺字单测）。
// 依赖：devDependencies 中的 @fontsource/noto-*-sc、subset-font；本机 Python + fontTools（仅改文案后重跑时需要）。
// 用法：node tools/buildFonts.mjs

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import subsetFont from 'subset-font';
import { collectCodepoints } from './fontChars.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'public/fonts');
const MANIFEST_PATH = join(ROOT, 'tools/fonts-manifest.json');
const BUDGET_BYTES = 500 * 1024;

const FONTS = [
  { id: 'sans', pkg: '@fontsource/noto-sans-sc', css: '400.css', out: 'yt-sans-400.woff2', family: 'Noto Sans SC 400' },
  { id: 'serif', pkg: '@fontsource/noto-serif-sc', css: '600.css', out: 'yt-serif-600.woff2', family: 'Noto Serif SC 600' },
];

const MERGE_PY = String.raw`
import sys
from fontTools.ttLib import TTFont
from fontTools.merge import Merger
out, files = sys.argv[1], sys.argv[2:]
clean = []
for i, path in enumerate(files):
    f = TTFont(path)
    for tag in ('GSUB', 'GPOS', 'BASE', 'STAT', 'vhea', 'vmtx', 'VORG', 'DSIG'):
        if tag in f:
            del f[tag]
    p = path + '.clean.ttf'
    f.save(p)
    clean.append(p)
Merger().merge(clean).save(out)
`;

const CMAP_PY = String.raw`
import sys, json
from fontTools.ttLib import TTFont
print(json.dumps(sorted(TTFont(sys.argv[1]).getBestCmap().keys())))
`;

function parseRanges(text) {
  return text.split(',').map((part) => {
    const [a, b] = part.trim().replace(/^U\+/i, '').split('-');
    const start = parseInt(a, 16);
    return [start, b ? parseInt(b, 16) : start];
  });
}

/** 解析 fontsource CSS：返回 [{ file, ranges }] */
function readSlices(pkgDir, cssName) {
  const css = readFileSync(join(pkgDir, cssName), 'utf8');
  const slices = [];
  for (const block of css.split('@font-face').slice(1)) {
    const file = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(block);
    const range = /unicode-range:\s*([^;]+);/.exec(block);
    if (file && range) slices.push({ file: file[1], ranges: parseRanges(range[1]) });
  }
  return slices;
}

function python(args) {
  return execFileSync('python', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

async function buildFont(font, codepoints, workDir) {
  const pkgDir = join(ROOT, 'node_modules', font.pkg);
  const slices = readSlices(pkgDir, font.css);

  const bySlice = new Map();
  const uncovered = [];
  for (const cp of codepoints) {
    const slice = slices.find((s) => s.ranges.some(([a, b]) => cp >= a && cp <= b));
    if (!slice) {
      uncovered.push(cp);
      continue;
    }
    if (!bySlice.has(slice.file)) bySlice.set(slice.file, []);
    bySlice.get(slice.file).push(cp);
  }

  const parts = [];
  for (const [file, cps] of bySlice) {
    const text = String.fromCodePoint(...cps);
    const source = readFileSync(join(pkgDir, 'files', file));
    const ttf = await subsetFont(source, text, { targetFormat: 'truetype' });
    const path = join(workDir, `${font.id}-${parts.length}.ttf`);
    writeFileSync(path, ttf);
    parts.push(path);
  }

  const merged = join(workDir, `${font.id}-merged.ttf`);
  python(['-c', MERGE_PY, merged, ...parts]);

  const allText = String.fromCodePoint(...codepoints);
  const woff2 = await subsetFont(readFileSync(merged), allText, { targetFormat: 'woff2' });
  writeFileSync(join(OUT_DIR, font.out), woff2);

  // 回读最终产物的 cmap（woff2 → ttf 后由 fontTools 解析），清单以真实字形覆盖为准
  const roundTrip = join(workDir, `${font.id}-final.ttf`);
  writeFileSync(roundTrip, await subsetFont(woff2, allText, { targetFormat: 'truetype' }));
  const covered = JSON.parse(python(['-c', CMAP_PY, roundTrip]));

  return { file: font.out, family: font.family, slices: parts.length, bytes: woff2.length, uncovered, codepoints: covered };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), 'yt-fonts-'));
  const codepoints = collectCodepoints();
  console.log(`实际用字（含 ASCII 与招牌预留）：${codepoints.length} 个码位`);

  const manifest = { generatedFrom: 'tools/buildFonts.mjs', fonts: {} };
  let total = 0;
  try {
    for (const font of FONTS) {
      const result = await buildFont(font, codepoints, workDir);
      total += result.bytes;
      manifest.fonts[font.id] = result;
      const missing = codepoints.filter((cp) => !result.codepoints.includes(cp));
      console.log(
        `${font.out}: ${(result.bytes / 1024).toFixed(1)} KB，合并 ${result.slices} 个分片，` +
          `字形覆盖 ${result.codepoints.length}，未覆盖 ${missing.length}` +
          (missing.length ? `（${String.fromCodePoint(...missing)}，走系统字体兜底）` : ''),
      );
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  copyFileSync(join(ROOT, 'node_modules/@fontsource/noto-sans-sc/LICENSE'), join(OUT_DIR, 'OFL.txt'));
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest)}\n`);

  const onDisk = FONTS.reduce((sum, f) => sum + statSync(join(OUT_DIR, f.out)).size, 0);
  console.log(`字体总量：${(onDisk / 1024).toFixed(1)} KB / 预算 ${BUDGET_BYTES / 1024} KB`);
  if (total > BUDGET_BYTES) {
    console.error('超出 500KB 字体预算，请缩小 Serif 字符范围');
    process.exitCode = 1;
  }
}

await main();

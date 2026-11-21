// tools/processPortraits.mjs —— 一次性把队友交付的透明底立绘标准化为 public/art/portraits 成品。
// 用法：node tools/processPortraits.mjs <源目录> [映射表.json]
// 步骤：裁掉四周多余透明空白 → 等比缩放 → 底部居中贴入 600x800 透明画布 → 调色板压缩到 <=400KB。
// 依赖 sharp（当前仓库已随 vite 插件链安装）；产物用 syncArtAssets 的 isCompletePng 复核。
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { isCompletePng } from './syncArtAssets.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CANVAS_W = 600;
const CANVAS_H = 800;
const ALPHA_EDGE = 8;        // 大于此值才算内容，滤掉抗锯齿杂点。
const PADDING = 4;           // 画布四周留白，避免人物贴边被 mask 切到。
const MAX_BYTES = 400 * 1024;

// 源文件名（去扩展名）→ 交付文件名；与 public/art/README 的清单一致。
const PORTRAIT_MAP = {
  '林夏-头像图': 'linxia_casual.png',
  '林夏的爸爸-头像图': 'father.png',
  '室友小陈-头像图': 'xiaochen.png',
  '阿远-头像图': 'ayuan.png',
  '周老师-头像图': 'teacher.png',
  '志愿者-头像图': 'volunteer.png',
  '主角-头像图': 'protagonist.png',
};

/** 求非透明像素包围盒。 */
function contentBounds(data, width, height) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= ALPHA_EDGE) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('整张图都是透明的。');
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** 缩到画布内（不裁切、不溢出），底部居中合成到透明画布。 */
async function normalize(image, bounds) {
  const availW = CANVAS_W - PADDING * 2;
  const availH = CANVAS_H - PADDING * 2;
  const scale = Math.min(availW / bounds.width, availH / bounds.height);
  const targetW = Math.max(1, Math.round(bounds.width * scale));
  const targetH = Math.max(1, Math.round(bounds.height * scale));
  const resized = await image
    .extract({ ...bounds })
    .resize({ width: targetW, height: targetH, fit: 'contain', position: 'centre', kernel: 'lanczos3' })
    .ensureAlpha()
    .toBuffer();
  const { width, height } = await sharpProbe(resized);
  return {
    buffer: resized,
    width,
    height,
    left: Math.round((CANVAS_W - width) / 2),
    top: CANVAS_H - height - PADDING,
    scale,
  };
}

async function sharpProbe(buffer) {
  const meta = await sharp(buffer).metadata();
  return { width: meta.width, height: meta.height };
}

/** 先试无损全色域，超标再退调色板，逐级降质量直到 <=400KB。 */
async function encode(canvas) {
  const attempts = [
    ['rgba', () => canvas.png({ compressionLevel: 9, effort: 10 })],
    ['pal256', () => canvas.png({ palette: true, quality: 95, colors: 256, effort: 10 })],
    ['pal224', () => canvas.png({ palette: true, quality: 88, colors: 224, effort: 10 })],
    ['pal192', () => canvas.png({ palette: true, quality: 80, colors: 192, effort: 10 })],
    ['pal160', () => canvas.png({ palette: true, quality: 72, colors: 160, effort: 10 })],
  ];
  const trail = [];
  for (const [label, attempt] of attempts) {
    const buffer = await attempt().toBuffer();
    trail.push(`${label}=${(buffer.length / 1024).toFixed(0)}KB`);
    if (buffer.length <= MAX_BYTES && isCompletePng(buffer)) return { buffer, used: label, trail };
  }
  throw new Error(`压缩后仍超标或校验失败：${trail.join(' → ')}`);
}

async function main() {
  const srcDir = resolve(ROOT, process.argv[2] ?? '.tmp_portraits/照片');
  const outDir = resolve(ROOT, 'public/art/portraits');
  if (!existsSync(srcDir)) throw new Error(`源目录不存在：${srcDir}`);
  mkdirSync(outDir, { recursive: true });

  const rows = [];
  for (const file of readdirSync(srcDir).filter((n) => n.toLowerCase().endsWith('.png')).sort()) {
    const key = basename(file, '.png');
    const outName = PORTRAIT_MAP[key];
    if (!outName) {
      console.warn(`跳过未登记的文件：${file}`);
      continue;
    }
    const sourcePath = join(srcDir, file);
    const image = sharp(sourcePath, { animated: false });
    const meta = await image.metadata();
    const raw = await image.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bounds = contentBounds(raw.data, raw.info.width, raw.info.height);
    const placed = await normalize(image.clone(), bounds);
    const canvas = sharp({
      create: { width: CANVAS_W, height: CANVAS_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite([{ input: placed.buffer, left: placed.left, top: placed.top }]);
    const { buffer, used, trail } = await encode(canvas);
    writeFileSync(join(outDir, outName), buffer);
    rows.push({
      角色: outName,
      原图: `${meta.width}x${meta.height} ${(statSync(sourcePath).size / 1024).toFixed(0)}KB`,
      内容: `${bounds.width}x${bounds.height}`,
      缩放: placed.scale.toFixed(3),
      成品人物: `${placed.width}x${placed.height}@(${placed.left},${placed.top})`,
      体积KB: (buffer.length / 1024).toFixed(0),
      编码: used,
      尝试: trail.join(' '),
    });
  }
  console.table(rows);
  console.log(`输出目录：${outDir}`);
}

await main();

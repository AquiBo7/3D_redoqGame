import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) throw new Error('请提供队友 v0.6 HTML 的绝对路径。');
const html = await readFile(source, 'utf8');
const assets = /const story\s*=\s*\{\s*assets:\s*\{([\s\S]*?)\n\s*\},/.exec(html)?.[1];
if (!assets) throw new Error('找不到 story.assets 字面量。');
const images = new Map();
for (const match of assets.matchAll(/(campusPanorama|walkingTogether):\s*"data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)"/g)) {
  images.set(match[1], Buffer.from(match[3], 'base64'));
}
if (images.size !== 2) throw new Error('剧情图缺失；不会执行 HTML 中的任何脚本。');
const output = resolve(root, 'public/art/cg');
await mkdir(output, { recursive: true });
for (const [key, filename] of [['campusPanorama', 's6_gate_panorama.png'], ['walkingTogether', 's13_walk_together.png']]) {
  const sourceBytes = images.get(key);
  const metadata = await sharp(sourceBytes).metadata();
  const png = await sharp(sourceBytes).png({ compressionLevel: 9, palette: true, quality: 100, effort: 10 }).toBuffer();
  await writeFile(resolve(output, filename), png);
  console.log(`${filename}: ${metadata.width}×${metadata.height}, ${metadata.format} → PNG, ${png.length} 字节`);
}
const panorama = images.get('campusPanorama');
const { width, height } = await sharp(panorama).metadata();
const side = Math.round(Math.min(width, height) / 2.15);
const left = Math.max(0, Math.min(width - side, Math.round(width * 0.77 - side / 2)));
const top = Math.max(0, Math.min(height - side, Math.round(height * 0.55 - side / 2)));
const crop = await sharp(panorama).extract({ left, top, width: side, height: side })
  .png({ compressionLevel: 9, palette: true, quality: 100, effort: 10 }).toBuffer();
await writeFile(resolve(output, 's11_post_crop.png'), crop);
console.log(`s11_post_crop.png: ${side}×${side}, 中心 77% 55%, ${crop.length} 字节`);

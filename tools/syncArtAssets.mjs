// 只读 public/art；只在内容变化时写 src/data/readyExternalAssets.json。
// 不创建占位 PNG、不改美术说明、不覆盖/删除用户图片；与启动时 cwd 无关。
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 64 * 1024 * 1024;
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// 清单保持纯 TS 数据；只读取受限的字面量，不 eval/执行源码、不另维护第二份路径表。
// 若清单改写得不能识别，明确失败而不是把 ready 静默清空。
export function readAssetPaths(root = ROOT) {
  const source = readFileSync(join(root, 'src/data/assetManifest.ts'), 'utf8');
  const block = /^export const ASSET_MANIFEST = \{([\s\S]*?)^\} as const;/m.exec(source);
  if (!block) throw new Error('无法识别 ASSET_MANIFEST 数据块。');
  const paths = {};
  const pattern = /^\s{2}([a-z][a-z0-9_]+):\s*\{\s*path:\s*'(\.\/art\/(?:portraits|cg|props|bg|trophies)\/[a-z0-9_]+\.png)'/gm;
  for (const match of block[1].matchAll(pattern)) paths[match[1]] = match[2];
  if (Object.keys(paths).length !== 22 || new Set(Object.values(paths)).size !== 22) {
    throw new Error('美术清单必须包含 22 个唯一 ID 与固定相对 PNG 路径。');
  }
  return paths;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * >0 是最低要求；进一步排除伪 PNG、半拷贝、CRC 错误和损坏的压缩像素流。
 * 支持 PNG 标准色型、位深及 Adam7；不安装图片库，不代替最终浏览器解码验收。
 * 64 MiB 文件/解压上限防止误放巨型图片阻塞构建（建议成品每张 <=500 KiB）。
 */
export function isCompletePng(bytes) {
  if (bytes.length < 57 || bytes.length > MAX_BYTES || !bytes.subarray(0, 8).equals(SIGNATURE)) return false;
  let offset = 8;
  let header;
  let palette = false;
  let ended = false;
  let idatClosed = false;
  const imageData = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return false;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) return false;
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) return false;
    const chunk = bytes.subarray(offset + 8, end - 4);
    if (!header && type !== 'IHDR') return false;
    if (type === 'IHDR') {
      if (header || offset !== 8 || length !== 13) return false;
      header = chunk;
    } else if (type === 'PLTE') {
      if (palette || imageData.length || !length || length > 768 || length % 3 !== 0) return false;
      palette = true;
    } else if (type === 'IDAT') {
      if (idatClosed) return false;
      imageData.push(chunk);
    } else if (type === 'IEND') {
      if (length !== 0 || end !== bytes.length || !imageData.length) return false;
      ended = true;
      break;
    } else if (type[0] === type[0].toUpperCase()) {
      return false; // 未知关键块：浏览器不一定可解码。
    }
    if (imageData.length && type !== 'IDAT') idatClosed = true;
    offset = end;
  }
  if (!ended || !header) return false;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const depth = header[8];
  const color = header[9];
  const allowed = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!width || !height || !allowed[color]?.includes(depth) || header[10] || header[11] || header[12] > 1) return false;
  if (color === 3 && !palette) return false;
  if ((color === 0 || color === 4) && palette) return false;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  const passes = header[12] === 0 ? [[0, 0, 1, 1]] : [
    [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
    [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
  ];
  let expected = 0;
  const rows = [];
  for (const [x, y, dx, dy] of passes) {
    const w = Math.max(0, Math.ceil((width - x) / dx));
    const h = Math.max(0, Math.ceil((height - y) / dy));
    if (!w || !h) continue;
    const rowBytes = 1 + Math.ceil(w * channels * depth / 8);
    expected += rowBytes * h;
    if (expected > MAX_BYTES) return false;
    rows.push([h, rowBytes]);
  }
  try {
    const decoded = inflateSync(Buffer.concat(imageData), { maxOutputLength: expected + 1 });
    if (decoded.length !== expected) return false;
    let cursor = 0;
    for (const [count, rowBytes] of rows) {
      for (let i = 0; i < count; i += 1) {
        if (decoded[cursor] > 4) return false;
        cursor += rowBytes;
      }
    }
  } catch {
    return false;
  }
  return true;
}

export function syncArtAssets(root = ROOT) {
  const ready = {};
  const rejected = [];
  for (const [id, relative] of Object.entries(readAssetPaths(root))) {
    const path = join(root, 'public', relative);
    let stat;
    try {
      stat = lstatSync(path);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue;
      throw error;
    }
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES || !isCompletePng(readFileSync(path))) {
      rejected.push(relative);
      continue;
    }
    ready[id] = relative;
  }
  const output = `${JSON.stringify(ready, null, 2)}\n`;
  const target = join(root, 'src/data/readyExternalAssets.json');
  let previous = '';
  try {
    previous = readFileSync(target, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const changed = previous !== output;
  if (changed) writeFileSync(target, output, 'utf8');
  return { ready, rejected, changed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ready, rejected, changed } = syncArtAssets();
  console.log(`美术同步：${Object.keys(ready).length}/22 已就绪；清单${changed ? '已更新' : '未变化'}。`);
  for (const path of rejected) console.warn(`跳过非完整 PNG（保留原文件）：${path}`);
}

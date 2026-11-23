// tools/checkProps.mjs —— 道具成品验收：用游戏同款 three@0.187.0 GLTFLoader + MeshoptDecoder
// 在真实浏览器里解码 public/models/props/*.glb，打印【面数 / DrawCall / 底面Y / 高度 / Rough /
// Metal / 底图 / 体积】实测表，并逐件出两张图供目检（全黑、法线反转、倒立）。
//
// 用法：node tools/checkProps.mjs
// 依赖：devDependencies 里的 playwright-core；浏览器路径取环境变量 CHROME_PATH，
//       没设则依次尝试 Edge(x86) / Edge / Chrome。渲染图落在 .tmp/props-preview/。
// 只读 public/ 与 tools/props-check.html，不写任何业务代码。

import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = resolve('.');
const PORT = 8123;
const SHOT_DIR = '.tmp/props-preview';
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.glb': 'model/gltf-binary',
  '.json': 'application/json',
};

const ids = readdirSync(join(ROOT, 'public', 'models', 'props'))
  .filter((name) => name.toLowerCase().endsWith('.glb'))
  .map((name) => name.replace(/\.glb$/i, ''));
if (!ids.length) {
  console.error('[阻断] public/models/props 里没有 .glb，请先跑 Blender 流水线 + gltf-transform meshopt');
  process.exit(1);
}

const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const rel = normalize(path).replace(/^(\.\.[/\\])+/, '');
  const file = [join(ROOT, rel), join(ROOT, 'public', rel)].find((candidate) => existsSync(candidate));
  if (!file) {
    res.writeHead(404).end('nope');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((done) => server.listen(PORT, '127.0.0.1', done));
mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: BROWSERS.find((candidate) => existsSync(candidate)),
  args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
});

const base = `http://127.0.0.1:${PORT}/tools/props-check.html`;
await page.goto(`${base}?props=${ids.join(',')}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__done === true, null, { timeout: 120000 });
const report = await page.evaluate(() => window.__report);
await page.screenshot({ path: `${SHOT_DIR}/all.png` });

const headers = ['道具', 'KB', '面数', 'DC', '底面Y', '高Y', '尺寸WxHxD', 'Rough', 'Metal', '透明', '底图'];
const rows = [headers];
for (const item of report) {
  if (item.error) {
    rows.push([item.id, '-', '-', '-', '-', '-', '-', '-', '-', '-', `加载失败 ${item.error}`]);
    continue;
  }
  const uniq = (pick) => [...new Set(item.mats.map(pick))].join('/');
  rows.push([
    item.id,
    (statSync(`public/models/props/${item.id}.glb`).size / 1024).toFixed(1),
    item.tris,
    item.drawCalls,
    item.boxMin[1].toFixed(4),
    item.boxMax[1].toFixed(3),
    item.size.map((v) => v.toFixed(2)).join('x'),
    uniq((m) => m.roughness?.toFixed(2)),
    uniq((m) => m.metalness?.toFixed(2)),
    item.mats.some((m) => m.transparent) ? '是' : '否',
    uniq((m) => m.map || '无'),
  ]);
  // 逐件两个角度出图：正面看贴地与外形，背面看有没有翻面或漏底。
  await page.goto(`${base}?props=${ids.join(',')}&prop=${item.id}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__done === true, null, { timeout: 90000 });
  const shots = await page.evaluate(() => [window.__shot_a, window.__shot_b]);
  for (const [i, data] of shots.entries()) {
    writeFileSync(`${SHOT_DIR}/${item.id}_${'ab'[i]}.png`, Buffer.from(String(data).split(',')[1], 'base64'));
  }
}
const widths = headers.map((_, i) => Math.max(...rows.map((row) => String(row[i] ?? '').length)));
for (const row of rows) console.log(row.map((cell, i) => String(cell).padEnd(widths[i])).join(' | '));
const totalKb = rows.slice(1).reduce((sum, row) => sum + (Number(row[1]) || 0), 0);
console.log(`\n合计 ${report.length} 件 / ${totalKb.toFixed(1)} KB | 渲染图：${SHOT_DIR}/`);
console.log('控制台 error/warning：', errors.length ? errors.slice(0, 8) : '无');
await browser.close();
server.close();

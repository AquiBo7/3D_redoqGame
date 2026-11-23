// 启动诊断：只看页面能不能长出 __worldApp，以及控制台首屏报错
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = `http://127.0.0.1:${process.argv[2] ?? '5187'}/`;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => logs.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
for (let i = 0; i < 12; i += 1) {
  await page.waitForTimeout(10000);
  const state = await page.evaluate(() => ({
    app: !!window.__worldApp,
    keys: window.__worldApp ? Object.keys(window.__worldApp).length : 0,
    canvas: document.querySelectorAll('canvas').length,
    overlay: document.body.innerText.slice(0, 120).replace(/\s+/g, ' '),
  }));
  console.log(i, JSON.stringify(state));
  if (state.app) break;
}
fs.writeFileSync('D:/千问比赛/美术优化/_shots/boot.json', JSON.stringify(logs.slice(0, 80), null, 2), 'utf8');
console.log('logs:', JSON.stringify(logs.slice(0, 25), null, 1));
await browser.close();

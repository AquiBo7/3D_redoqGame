// 在卡住的主线程里，用 Debugger.evaluateOnCallFrame 读出局部变量：到底在画哪张贴图、画到第几行。
// 用法：node _tools/hangVars.mjs [URL]
import { createRequire } from 'node:module';

const require = createRequire('D:/千问比赛/美术优化/_repo/3D_redoqGame-master/package.json');
const { chromium } = require('playwright-core');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL_ = process.argv[2] || 'http://127.0.0.1:4399/';
const say = (m) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${m}`);

const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args: ['--use-gl=angle', '--use-angle=d3d11', '--disable-gpu-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on('pageerror', (e) => say(`!! pageerror ${String(e).slice(0, 200)}`));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') say(`!! [${m.type()}] ${m.text().slice(0, 200)}`); });

const cdp = await context.newCDPSession(page);
let pausedEvent = null;
cdp.on('Debugger.paused', (event) => { pausedEvent = event; });
cdp.on('Debugger.resumed', () => { pausedEvent = null; });

await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-start', { timeout: 60000 });
await page.waitForTimeout(1500);
await cdp.send('Debugger.enable');

await page.evaluate(() => document.querySelector('#btn-start')?.click());
await page.waitForTimeout(1200);
void page.evaluate(() => document.querySelector('.controls-guide__enter')?.click()).catch(() => {});

const exprs = [
  ['frame0 fn', 'typeof seed !== "undefined" ? "seed=" + seed + " cells=" + cells + " warm=" + warm : "u=" + u + " v=" + v'],
  ['paint key', 'typeof key !== "undefined" ? key + " " + width + "x" + height + " y=" + y + " x=" + x : "?"'],
  ['batch name', 'typeof name !== "undefined" ? name + " specs=" + specs.length : "?"'],
  ['trees', 'typeof cards !== "undefined" ? "cards=" + cards.length + " clusterCount=" + clusterCount : "?"'],
  ['room build', 'typeof details !== "undefined" ? "details ok" : "?"'],
];

for (let sample = 0; sample < 3; sample += 1) {
  await page.waitForTimeout(sample === 0 ? 6000 : 10000);
  await cdp.send('Debugger.pause').catch((e) => say('pause 失败 ' + e.message));
  await page.waitForTimeout(1200);
  if (!pausedEvent) { say(`样本#${sample}：没有抓到暂停（主线程可能空闲）`); continue; }
  const frames = pausedEvent.callFrames || [];
  say(`样本#${sample} 栈顶 6 层：${frames.slice(0, 6).map((f) => f.functionName || '(anon)').join(' ← ')}`);
  for (const [label, expr] of exprs) {
    for (let fi = 0; fi < Math.min(frames.length, 8); fi += 1) {
      try {
        const res = await cdp.send('Debugger.evaluateOnCallFrame', {
          callFrameId: frames[fi].callFrameId, expression: expr, throwOnSideEffect: false, replMode: true,
        });
        const v = res.result?.value;
        if (v !== undefined && v !== '?' && !/ReferenceError/.test(String(res.result?.description || ''))) {
          say(`    ${label} @#${fi} ${frames[fi].functionName} = ${String(v).slice(0, 120)}`);
          break;
        }
      } catch { /* 该帧没有这个变量，继续上一层 */ }
    }
  }
  await cdp.send('Debugger.resume').catch(() => {});
}

await page.waitForTimeout(1500);
await browser.close();

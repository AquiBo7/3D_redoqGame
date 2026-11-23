// 卡住那一帧的完整现场：栈帧源码位置 + 帧内所有局部变量取值。
// 用法：node _tools/hangFrameDump.mjs [URL]
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
const cdp = await context.newCDPSession(page);
let paused = null;
cdp.on('Debugger.paused', (e) => { paused = e; });

await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-start', { timeout: 60000 });
await page.waitForTimeout(1200);
await cdp.send('Debugger.enable');
await page.evaluate(() => document.querySelector('#btn-start')?.click());
await page.waitForTimeout(1200);
void page.evaluate(() => document.querySelector('.controls-guide__enter')?.click()).catch(() => {});
await page.waitForTimeout(7000);
await cdp.send('Debugger.pause');
await page.waitForTimeout(1500);
if (!paused) { say('没抓到暂停'); await browser.close(); process.exit(0); }

const frames = paused.callFrames || [];
say(`栈深 ${frames.length}`);
for (const [i, f] of frames.slice(0, 10).entries()) {
  say(`  #${i} ${f.functionName || '(anon)'} url="${f.url}" line=${f.lineNumber} col=${f.columnNumber} loc=${JSON.stringify(f.location)}`);
}

const dumpVars = async (frame, names) => {
  const out = [];
  for (const n of names) {
    try {
      const r = await cdp.send('Debugger.evaluateOnCallFrame', {
        callFrameId: frame.callFrameId, expression: `typeof ${n} === "undefined" ? "<undef>" : String(${n})`, throwOnSideEffect: false, replMode: true,
      });
      if (r.result?.value !== '<undef>') out.push(`${n}=${r.result?.value}`);
    } catch { /* ignore */ }
  }
  return out.join('  ');
};

say('  帧#0 局部：' + await dumpVars(frames[0], ['u', 'v', 'seed', 'cells', 'warm', 'radius', 'wobble', 'cx', 'cy', 'ix', 'iy', 'dx', 'dy', 'gx', 'gy', 'drop', 'size', 'coverage', 'tone', 'along', 'across', 't', 'q', 'half', 'inside']));
say('  帧#1 局部：' + await dumpVars(frames[1], ['key', 'width', 'height', 'x', 'y', 'v', 'i', 'cached']));
if (frames[2]) say('  帧#2 局部：' + await dumpVars(frames[2], ['name', 'specs', 'textureKey', 'alphaTest', 'index']));
if (frames[3]) say('  帧#3 局部：' + await dumpVars(frames[3], ['tier', 'clusterCount', 'treeIndex', 'cluster', 'card', 'cards', 'trees']));

// 也列出帧#0 的 Scope 结构，确认它到底是哪个闭包
const scopes = (frames[0].scopeChain || []).map((s) => `${s.type}:${s.object?.objectId ? 'obj' : ''}`).join(' ');
say('  帧#0 scopeChain: ' + scopes);

await cdp.send('Debugger.resume').catch(() => {});
await page.waitForTimeout(1200);
await browser.close();

// 抓「点进入清晨后主线程卡住」的调用栈：CDP Debugger.pause 打断正在执行的脚本。
// 用法：node _tools/hangStack.mjs [URL]
import { createRequire } from 'node:module';

const require = createRequire('D:/千问比赛/美术优化/_repo/3D_redoqGame-master/package.json');
const { chromium } = require('playwright-core');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL_ = (process.argv[2] || 'https://yitiao-jietu-5pz4p8topin.qoder.zone/');
const stamp = () => new Date().toISOString().slice(11, 23);
const say = (m) => console.log(`[${stamp()}] ${m}`);

const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args: ['--use-gl=angle', '--use-angle=d3d11', '--disable-gpu-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.on('pageerror', (e) => say(`!! pageerror ${String(e).slice(0, 240)}`));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') say(`!! [${m.type()}] ${m.text().slice(0, 240)}`); });
page.on('dialog', (d) => say(`!! 原生弹窗 ${d.type()}: ${d.message().slice(0, 200)}`));
page.on('response', (r) => { if (r.status() >= 400) say(`!! http${r.status()} ${r.url().slice(0, 150)}`); });

const cdp = await context.newCDPSession(page);
const frames = [];
cdp.on('Debugger.paused', (event) => {
  const stack = (event.callFrames || []).map((f, i) => `    #${i} ${f.functionName || '(anonymous)'} @ ${f.url.replace(/^https?:\/\//, '').slice(0, 70)}:${f.lineNumber + 1}:${f.columnNumber + 1}`);
  say(`  ---- 卡住的调用栈（${event.reason}）----\n${stack.join('\n')}`);
  frames.push(stack.length);
});
cdp.on('Debugger.resumed', () => say('  ---- 脚本恢复执行 ----'));

await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-start', { timeout: 60000 });
await page.waitForTimeout(2000);
await cdp.send('Runtime.enable');
await cdp.send('Debugger.enable').catch((e) => say('Debugger.enable 失败 ' + e.message));

await page.evaluate(() => document.querySelector('#btn-start')?.click());
await page.waitForTimeout(1500);
say('已点「开始体验」，指南存在=' + (await page.evaluate(() => !!document.querySelector('.controls-guide'))));

// 后台派发点击，不 await
void page.evaluate(() => document.querySelector('.controls-guide__enter')?.click()).then(() => say('enter click 已返回')).catch((e) => say('enter click 抛错 ' + String(e).slice(0, 120)));

for (const waitMs of [4000, 8000, 15000]) {
  await page.waitForTimeout(waitMs);
  say(`等待 ${waitMs}ms 后请求暂停…`);
  await cdp.send('Debugger.pause').catch((e) => say('pause 失败：' + String(e).slice(0, 100)));
  await page.waitForTimeout(2500);
  // 让被暂停的脚本继续跑一会儿，再抓下一次
  await cdp.send('Debugger.resume').catch(() => {});
}

await page.waitForTimeout(2000);
say(`共抓到 ${frames.length} 次暂停栈`);
await browser.close();

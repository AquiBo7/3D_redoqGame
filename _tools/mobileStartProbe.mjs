// 真机竖屏复现：线上站点在 iPhone 竖屏下点击「开始体验 → 进入清晨」是否能进入游戏。
// 用法：node _tools/mobileStartProbe.mjs [BASE_URL]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire('D:/千问比赛/美术优化/_repo/3D_redoqGame-master/package.json');
const { chromium } = require('playwright-core');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = (process.argv[2] || 'https://yitiao-jietu-5pz4p8topin.qoder.zone/').replace(/\/?$/, '/');
const SHOT = 'D:/千问比赛/美术优化/_shots/mobile';
mkdirSync(SHOT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=d3d11', '--disable-gpu-sandbox'],
});

const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await context.newPage();

const events = [];
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') events.push(`[${t}] ${m.text().slice(0, 200)}`);
});
page.on('pageerror', (e) => events.push(`[pageerror] ${String(e).slice(0, 300)}`));
page.on('requestfailed', (r) => events.push(`[reqfail] ${r.url().slice(0, 160)} ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.status() >= 400) events.push(`[http${r.status()}] ${r.url().slice(0, 160)}`);
});

const state = (label) =>
  page.evaluate((tag) => {
    const q = (s) => document.querySelector(s);
    const rect = (s) => {
      const el = q(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const enter = q('.controls-guide__enter');
    let hit = 'n/a';
    if (enter) {
      const r = enter.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      hit = top ? `${top.tagName}.${top.className}` : 'null';
    }
    return {
      tag,
      vw: innerWidth,
      vh: innerHeight,
      coarse: matchMedia('(pointer: coarse)').matches,
      portrait: matchMedia('(orientation: portrait)').matches,
      startPageHidden: q('#start-page')?.hidden,
      guidePresent: !!q('.controls-guide'),
      enterRect: rect('.controls-guide__enter'),
      enterHitTest: hit,
      canvasCount: document.querySelectorAll('#app canvas').length,
      appChildren: Array.from(q('#app')?.children ?? []).map((c) => `${c.tagName}.${c.className}`),
      bodyText: document.body.innerText.replace(/\s+/g, ' ').slice(0, 90),
    };
  }, label);

// 生产首帧资源重，'load' 会长时间不触发；用 domcontentloaded + 轮询按钮出现
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-start', { state: 'visible', timeout: 60000 }).catch(() => console.log('!! #btn-start 未可见'));
await page.waitForTimeout(3000);
console.log(JSON.stringify(await state('1_loaded'), null, 1));

// 真机式触摸点击（不绕过 actionability）
const startBtn = page.getByRole('button', { name: /开始体验|重新开始|继续体验/ }).first();
await startBtn.tap({ timeout: 30000 }).catch(async (e) => {
  console.log('!! 触摸点击失败，改用 DOM click：', String(e).slice(0, 120));
  await page.evaluate(() => document.querySelector('#btn-start, #btn-continue')?.click());
});
await page.waitForTimeout(2000);
console.log(JSON.stringify(await state('2_after_start_tap'), null, 1));
await page.screenshot({ path: `${SHOT}/mobile_2_guide.png` });

// 用真实触摸点「进入清晨」
const r = await page.evaluate(() => {
  const el = document.querySelector('.controls-guide__enter');
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
});
console.log('enter point =', JSON.stringify(r));
if (r) {
  await page.touchscreen.tap(r.x, r.y);
  await page.waitForTimeout(1500);
  console.log(JSON.stringify(await state('3_after_enter_tap'), null, 1));
} else {
  console.log('!! 没有 .controls-guide__enter，指南未出现');
}

for (let i = 0; i < 12; i += 1) {
  await page.waitForTimeout(4000);
  const s = await state(`4_poll_${i}`);
  console.log(
    `poll#${i} guide=${s.guidePresent} canvas=${s.canvasCount} app=[${s.appChildren.join(',')}] ` +
      `startHidden=${s.startPageHidden} text="${s.bodyText.slice(0, 40)}"`,
  );
  if (s.canvasCount > 0 && !s.guidePresent) break;
}
console.log(JSON.stringify(await state('5_final'), null, 1));
await page.screenshot({ path: `${SHOT}/mobile_5_final.png` });

console.log('events:\n' + (events.length ? events.join('\n') : '  零报错'));
await context.close();
await browser.close();

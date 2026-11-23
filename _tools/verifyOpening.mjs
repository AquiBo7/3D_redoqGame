// 开头黄金路径验收：桌面 + 手机竖屏，真点击走「开始体验 → 进入清晨 → S1 出画 → 推进一拍」。
// 用法：node _tools/verifyOpening.mjs [BASE_URL]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire('D:/千问比赛/美术优化/_repo/3D_redoqGame-master/package.json');
const { chromium } = require('playwright-core');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = (process.argv[2] || 'http://127.0.0.1:4400/').replace(/\/?$/, '/');
const SHOT = 'D:/千问比赛/美术优化/_shots/opening';
mkdirSync(SHOT, { recursive: true });
const say = (m) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${m}`);

const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args: ['--use-gl=angle', '--use-angle=d3d11', '--disable-gpu-sandbox'],
});

const probe = () => {
  const q = (s) => document.querySelector(s);
  const c = q('#app canvas');
  let pix = null;
  if (c) {
    try {
      const o = document.createElement('canvas');
      o.width = 96; o.height = 64;
      const x = o.getContext('2d');
      x.drawImage(c, 0, 0, 96, 64);
      const d = x.getImageData(0, 0, 96, 64).data;
      let s = 0, s2 = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; s += l; s2 += l * l; }
      const mean = s / n;
      pix = { mean: +mean.toFixed(1), sd: +Math.sqrt(s2 / n - mean * mean).toFixed(1) };
    } catch (e) { pix = 'ERR ' + e.message; }
  }
  return {
    guide: !!q('.controls-guide'),
    canvas: c ? `${c.width}x${c.height}` : null,
    pixelRatio: c ? +(c.width / Math.max(1, c.clientWidth)).toFixed(2) : null,
    pix,
    fadeOpacity: q('.scene-fade') ? +getComputedStyle(q('.scene-fade')).opacity : null,
    hud: !!q('.world-hud'),
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 70),
  };
};

async function run(label, opts, { realTap }) {
  say(`==== ${label}（${realTap ? '真实触摸/点击' : 'DOM 派发'}）====`);
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const bad = [];
  page.on('pageerror', (e) => bad.push(`pageerror ${String(e).slice(0, 160)}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') bad.push(`[${m.type()}] ${m.text().slice(0, 160)}`); });
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`http${r.status()} ${r.url().slice(0, 140)}`); });
  page.on('requestfailed', (r) => bad.push(`reqfail ${r.url().slice(0, 140)}`));

  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#btn-start', { state: 'visible', timeout: 60000 });
  say(`  首屏可交互耗时 ${Date.now() - t0}ms`);

  const clickEnter = async (sel) => {
    if (realTap) {
      const b = await page.evaluate((s) => {
        const el = document.querySelector(s) || Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('开始') || x.textContent.includes('继续'));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      }, sel);
      if (!b) throw new Error(`找不到 ${sel}`);
      await page.touchscreen.tap(b.x, b.y);
    } else {
      await page.evaluate((s) => {
        const el = document.querySelector(s) || Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('开始') || x.textContent.includes('继续'));
        el.click();
      }, sel);
    }
  };

  await clickEnter('#btn-start');
  await page.waitForTimeout(1200);
  say(`  点「开始体验」后：${JSON.stringify(await page.evaluate(probe))}`);

  const t1 = Date.now();
  await clickEnter('.controls-guide__enter');
  await page.waitForFunction(() => {
    const c = document.querySelector('#app canvas');
    const g = document.querySelector('.controls-guide');
    return !!c && !g;
  }, null, { timeout: 60000 });
  say(`  点「进入清晨」→ canvas 出现、指南消失，用时 ${Date.now() - t1}ms`);

  await page.waitForFunction(() => {
    const f = document.querySelector('.scene-fade');
    return !f || parseFloat(getComputedStyle(f).opacity) <= 0.02;
  }, null, { timeout: 90000 }).catch(() => say('  !! 黑幕未淡出'));

  await page.waitForTimeout(4000);
  const after = await page.evaluate(probe);
  say(`  S1 画面：${JSON.stringify(after)}`);
  await page.screenshot({ path: `${SHOT}/${label.replace(/[^a-z0-9]/gi, '_')}_s1.png` });

  await page.keyboard.press('Space');
  await page.waitForTimeout(2500);
  say(`  推进一拍后：${JSON.stringify(await page.evaluate(probe))}`);

  await context.close();
  say(`  异常：${bad.length ? bad.join(' || ') : '零报错零警告零 4xx'}`);
  return bad.length === 0 && !after.guide && !!after.canvas;
}

const ok1 = await run('desktop', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }, { realTap: false });
const ok2 = await run('mobile-portrait', {
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
}, { realTap: true });
const ok3 = await run('mobile-landscape', {
  viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
}, { realTap: true });

say(`结论：桌面=${ok1} 竖屏=${ok2} 横屏=${ok3}`);
await browser.close();
process.exit(ok1 && ok2 && ok3 ? 0 : 1);

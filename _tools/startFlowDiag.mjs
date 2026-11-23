// 开头卡死定位：分别在桌面横屏与手机竖屏下走「开始体验 → 进入清晨」，
// 用 Promise.race 判断主线程是否被长时间阻塞（evaluate 超时 = 卡住），并逐步打印控制台/网络异常。
// 用法：node _tools/startFlowDiag.mjs [BASE_URL]
import { createRequire } from 'node:module';

const require = createRequire('D:/千问比赛/美术优化/_repo/3D_redoqGame-master/package.json');
const { chromium } = require('playwright-core');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = (process.argv[2] || 'https://yitiao-jietu-5pz4p8topin.qoder.zone/').replace(/\/?$/, '/');

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=d3d11', '--disable-gpu-sandbox'],
});

const stamp = () => new Date().toISOString().slice(11, 23);
const say = (m) => console.log(`[${stamp()}] ${m}`);

const probe = () => {
  const q = (s) => document.querySelector(s);
  const c = q('#app canvas');
  let pix = null;
  if (c) {
    try {
      const o = document.createElement('canvas');
      o.width = 80; o.height = 50;
      const x = o.getContext('2d');
      x.drawImage(c, 0, 0, 80, 50);
      const d = x.getImageData(0, 0, 80, 50).data;
      let s = 0, s2 = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; s += l; s2 += l * l; }
      const mean = s / n;
      pix = { mean: +mean.toFixed(1), sd: +Math.sqrt(s2 / n - mean * mean).toFixed(1) };
    } catch (e) { pix = 'ERR ' + e.message; }
  }
  return {
    guide: !!q('.controls-guide'),
    startHidden: q('#start-page')?.hidden,
    canvas: c ? `${c.width}x${c.height}` : null,
    pix,
    hud: !!q('.world-hud'),
    fade: q('.scene-fade') ? getComputedStyle(q('.scene-fade')).opacity : null,
    lite: !!q('.stage2d'),
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 60),
  };
};

async function raceEvaluate(page, fn, ms) {
  const t0 = Date.now();
  let timer;
  const timeout = new Promise((res) => { timer = setTimeout(() => res('__TIMEOUT__'), ms); });
  const val = await Promise.race([page.evaluate(fn), timeout]);
  clearTimeout(timer);
  const dt = Date.now() - t0;
  return { val, dt, blocked: val === '__TIMEOUT__' };
}

async function run(label, opts) {
  say(`==== ${label} ====`);
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => { errs.push(`pageerror ${String(e).slice(0, 200)}`); say(`  !! pageerror: ${String(e).slice(0, 200)}`); });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') { errs.push(`${m.type()} ${m.text().slice(0, 200)}`); say(`  !! [${m.type()}] ${m.text().slice(0, 200)}`); }
  });
  page.on('response', (r) => { if (r.status() >= 400) { errs.push(`http${r.status()} ${r.url()}`); say(`  !! [http${r.status()}] ${r.url().slice(0, 140)}`); } });
  page.on('requestfailed', (r) => { errs.push(`reqfail ${r.url()}`); say(`  !! [reqfail] ${r.url().slice(0, 140)} ${r.failure()?.errorText}`); });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#btn-start', { timeout: 60000 }).catch(() => say('  !! #btn-start 未出现'));
  await page.waitForTimeout(2500);
  let r = await raceEvaluate(page, probe, 8000);
  say(`  loaded(${opts.viewport.width}x${opts.viewport.height}) dt=${r.dt}ms ${JSON.stringify(r.val)}`);

  // ① 点「开始体验」
  await page.evaluate(() => document.querySelector('#btn-start')?.click());
  await page.waitForTimeout(1500);
  r = await raceEvaluate(page, probe, 8000);
  say(`  after 开始体验 dt=${r.dt}ms ${JSON.stringify(r.val)}`);

  // ② 点「进入清晨」
  const t0 = Date.now();
  await page.evaluate(() => document.querySelector('.controls-guide__enter')?.click());
  say(`  dispatch enter click 用时 ${Date.now() - t0}ms（click 同步链路的耗时）`);

  for (let i = 0; i < 10; i += 1) {
    await page.waitForTimeout(3000);
    r = await raceEvaluate(page, probe, 6000);
    say(`  poll#${i} dt=${r.dt}ms ${r.blocked ? '主线程阻塞中' : ''} ${JSON.stringify(r.val)}`);
    if (!r.blocked && r.val && r.val.canvas && !r.val.guide) break;
  }

  // ③ 空格推进
  await page.keyboard.press('Space');
  await page.waitForTimeout(2500);
  r = await raceEvaluate(page, probe, 6000);
  say(`  after Space dt=${r.dt}ms ${JSON.stringify(r.val)}`);

  await context.close();
  say(`  ${label} 异常汇总：${errs.length ? errs.length + ' 条' : '无'}`);
  return errs;
}

await run('桌面 1280x800', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await run('手机竖屏 390x844 dpr3', {
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
});

await browser.close();

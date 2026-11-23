// 实机冒烟：真 Edge（非软件光栅）跑黄金路径 + 边界，统计控制台与网络异常。
// 用法：node tools/smokePath.mjs        默认 http://localhost:5178/
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.BASE_URL || 'http://localhost:5178/';
const SHOT = process.env.SHOT_DIR || 'D:/千问比赛/美术优化/_shots/smoke';
import { mkdirSync } from 'node:fs';
mkdirSync(SHOT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args: ['--use-gl=angle', '--use-angle=d3d11', '--disable-gpu-sandbox'],
});

const log = [];
const track = (page, tag, bag) => {
  page.on('console', (m) => {
    const type = m.type();
    if (type === 'error' || type === 'warning') bag.push(`[${tag}][${type}] ${m.text().slice(0, 180)}`);
  });
  page.on('pageerror', (e) => bag.push(`[${tag}][pageerror] ${String(e).slice(0, 180)}`));
  page.on('requestfailed', (r) => bag.push(`[${tag}][reqfail] ${r.url().slice(0, 140)} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) bag.push(`[${tag}][http${r.status()}] ${r.url().slice(0, 140)}`); });
};

async function openScene(scene, opts = {}) {
  const context = await browser.newContext({
    viewport: opts.viewport || { width: 1280, height: 800 },
    deviceScaleFactor: opts.dpr || 1,
    hasTouch: Boolean(opts.mobile), isMobile: Boolean(opts.mobile),
  });
  const page = await context.newPage();
  const bag = [];
  track(page, scene || 'start', bag);
  // 与 artCapture 同理：角色 GLB 在 dev server 上能拖过 30 s，等 load 会假失败
  await page.goto(scene ? `${BASE}?scene=${scene}` : BASE, { waitUntil: 'domcontentloaded' });
  if (scene) await page.waitForFunction(() => Boolean(window.__worldApp), null, { timeout: 120000 });
  return { context, page, bag };
}

// 1) 黄金路径：开始页 → 点击开始 → 进入首个场景 → 推进一段对话
{
  const { context, page, bag } = await openScene(null);
  const before = await page.evaluate(() => document.body.innerText.slice(0, 80));
  await page.getByRole('button', { name: '开始体验' }).click();
  // 开始页 → 操作指南 → 「进入清晨」才真正挂载 3D 世界
  await page.getByRole('button', { name: '进入清晨', exact: false }).click();
  try {
    await page.waitForFunction(() => Boolean(window.__worldApp), null, { timeout: 90000 });
    await page.waitForFunction(() => Boolean(window.__worldApp.getSceneId()), null, { timeout: 90000 });
  } catch (err) {
    log.push(`  ⚠ 进入场景等待超时：${String(err).slice(0, 120)}`);
  }
  const sceneId = await page.evaluate(() => window.__worldApp?.getSceneId() ?? null);
  const canvasBox = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return c ? { w: c.width, h: c.height, cssW: Math.round(c.clientWidth), cssH: Math.round(c.clientHeight) } : null;
  });
  // 空格推进，确认状态在走（取去重后的文本序列）
  const texts = [];
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(1200);
    const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 70));
    if (texts[texts.length - 1] !== t) texts.push(t);
  }
  await page.screenshot({ path: `${SHOT}/smoke_golden.png` });
  log.push(`1 黄金路径：开始页文本「${before.split('\n')[0]}」→ scene=${sceneId} canvas=${JSON.stringify(canvasBox)}`);
  log.push(`  推进文本：${texts.map((t, i) => `#${i} ${t}`).join(' | ')}`);
  log.push(`  控制台/网络：${bag.length ? bag.join(' || ') : '零报错零警告'}`);
  await context.close();
}

// 2) 食堂 S12 走一段：横屏 1440×900，第一人称推进 + 交互热点
{
  const { context, page, bag } = await openScene('S12', { viewport: { width: 1440, height: 900 } });
  await page.waitForFunction(() => {
    const fade = document.querySelector('.scene-fade');
    return !fade || parseFloat(getComputedStyle(fade).opacity) <= 0.001;
  }, null, { timeout: 120000 });
  await page.evaluate(() => window.__worldApp.teleport(0, 2.5, 0));
  await page.waitForTimeout(1500);
  const moved = await page.evaluate(async () => {
    const fmt = (v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
    const before = fmt(window.__worldApp.getPlayerPosition().feet);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
    await new Promise((r) => setTimeout(r, 1200));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));
    const after = fmt(window.__worldApp.getPlayerPosition().feet);
    return { before, after };
  });
  await page.screenshot({ path: `${SHOT}/smoke_s12_walk.png` });
  const info = await page.evaluate(() => window.__worldApp.getRenderInfo());
  log.push(`2 S12 行走：feet ${JSON.stringify(moved)}  renderInfo=${JSON.stringify(info)}`);
  log.push(`  控制台/网络：${bag.length ? bag.join(' || ') : '零报错零警告'}`);
  await context.close();
}

// 3) 竖屏边界：390×844 + 触屏 + dpr2（应被 clamp 到 1.5），底部安全区
{
  const { context, page, bag } = await openScene('S12', { viewport: { width: 390, height: 844 }, dpr: 2, mobile: true });
  await page.waitForTimeout(2500);
  const probe = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const effDpr = c ? c.width / c.clientWidth : null;
    const H = window.innerHeight;
    const bottomUi = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.height < 12 || r.width < 12) continue;
      // 贴底：元素下缘离视口底不到 40px
      if (H - r.bottom > 40) continue;
      bottomUi.push({
        cls: (el.className && String(el.className).split(' ')[0]) || el.tagName,
        gap: Math.round(H - r.bottom),
        padB: s.paddingBottom,
        overflow: Math.round(r.bottom - H),
      });
    }
    const seen = new Set();
    const uniq = bottomUi.filter((x) => !seen.has(x.cls) && seen.add(x.cls));
    return { effDpr: +Number(effDpr).toFixed(3), innerH: H, bottomUi: uniq.slice(0, 10) };
  });
  await page.screenshot({ path: `${SHOT}/smoke_s12_portrait.png` });
  log.push(`3 竖屏 390×844 触屏 dpr2 → canvas 有效 DPR=${probe.effDpr}（红线 ≤1.5）innerH=${probe.innerH}`);
  log.push(`  贴底 UI：${probe.bottomUi.map((l) => `${l.cls} 离底${l.gap}px padB=${l.padB}${l.overflow > 0 ? ` 溢出${l.overflow}px` : ''}`).join(' ; ') || '无'}`);
  log.push(`  控制台/网络：${bag.length ? bag.join(' || ') : '零报错零警告'}`);
  await context.close();
}

// 4) 横竖切换：同一页面里 resize，确认不黑屏、不抛错
{
  const { context, page, bag } = await openScene('S8', { viewport: { width: 1280, height: 720 } });
  const seq = [[390, 844], [844, 390], [1440, 900], [390, 844]];
  for (const [w, h] of seq) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(900);
  }
  const alive = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return { scene: window.__worldApp.getSceneId(), w: c.width, h: c.height };
  });
  await page.screenshot({ path: `${SHOT}/smoke_rotate.png` });
  log.push(`4 横竖切换 4 次后：${JSON.stringify(alive)}`);
  log.push(`  控制台/网络：${bag.length ? bag.join(' || ') : '零报错零警告'}`);
  await context.close();
}

await browser.close();
console.log(log.join('\n'));

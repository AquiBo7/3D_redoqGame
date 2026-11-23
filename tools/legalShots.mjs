// 参赛截图：① 关键节点 [Y] 现实做法与法治提示卡；② 结局页三视角应对与法治清单。
// 用法：BASE_URL=http://127.0.0.1:5179/ node tools/legalShots.mjs <输出目录>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const OUT = process.argv[2] || 'docs/qoder-log';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5179/';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const LAND = { width: 1440, height: 900 };
const WIDE = { width: 844, height: 390 };
const PORT = { width: 390, height: 844 };

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const report = [];

async function newPage(viewport = LAND) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  return { context, page, problems };
}

async function openScene(scene, viewport = LAND) {
  const session = await newPage(viewport);
  await session.page.goto(`${BASE}?scene=${scene}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await session.page.waitForFunction(() => Boolean(window.__worldApp), null, { timeout: 120000 });
  await session.page.waitForFunction((id) => window.__worldApp.getSceneId() === id, scene, { timeout: 120000 });
  return session;
}

/** 淡入动画在软件渲染下会晚于 CSS 时长，等不透明度真正到位再拍。 */
async function settle(page, selector) {
  await page.waitForFunction((css) => {
    const node = document.querySelector(css);
    return node && !node.hasAttribute('hidden') && parseFloat(getComputedStyle(node).opacity) > 0.98;
  }, selector, { timeout: 30000 });
}

async function toChoices(page) {
  for (let i = 0; i < 14; i++) {
    if (await page.locator('.choices__hint-trigger:not([hidden])').count()) return;
    const panel = page.locator('.dialogue__panel');
    if (await panel.count()) await panel.click().catch(() => {});
    else await page.keyboard.press('Space').catch(() => {});
    await page.waitForTimeout(700);
  }
  throw new Error('对话推进后仍未出现法治提示灯');
}

/** 选项之后可能还有黑幕/字幕/过场，逐个点掉直到目标出现。 */
async function advanceUntil(page, targetSelector, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.locator(targetSelector).count()) return;
    for (const css of ['.intertitle__skip', '.caption--inner', '.dialogue__panel']) {
      const node = page.locator(css);
      if (await node.count()) await node.first().click({ timeout: 2000 }).catch(() => {});
    }
    await page.waitForTimeout(800);
  }
  throw new Error(`推进超时：${targetSelector}`);
}

// ① [Y] 提示卡：桌面键盘、窄高横屏、竖屏触摸三条入口
for (const shot of [
  { file: 'feature_y_legal_hint.png', viewport: LAND, mode: 'key' },
  { file: 'feature_y_legal_hint_landscape_844x390.png', viewport: WIDE, mode: 'key' },
  { file: 'feature_y_legal_hint_portrait.png', viewport: PORT, mode: 'tap' },
]) {
  const { context, page, problems } = await openScene('D2', shot.viewport);
  try {
    await toChoices(page);
    if (shot.mode === 'key') await page.keyboard.press('KeyY');
    else await page.click('.choices__hint-trigger');
    await settle(page, '.legal-hint');
    await page.screenshot({ path: join(OUT, shot.file) });
    report.push({ shot: shot.file, viewport: shot.viewport, mode: shot.mode, problems: problems.slice(0, 3) });
  } catch (err) {
    report.push({ shot: shot.file, error: String(err).slice(0, 200), problems: problems.slice(0, 3) });
  }
  await context.close();
}

// ② 结局页三视角清单：S14 走玩笑路线，以真结局与真实日志进入复盘
{
  const { context, page, problems } = await openScene('S14');
  try {
    await page.waitForSelector('.choices__options button', { timeout: 60000 });
    await page.locator('.choices__options button', { hasText: '被拍惨了哈哈' }).first().click();
    await advanceUntil(page, '.chapter-end:not([hidden]) .chapter-end__node-list');
    await page.waitForFunction(() => document.querySelectorAll('.chapter-end__node').length === 6, null, { timeout: 60000 });
    await settle(page, '.chapter-end');
    await page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll('.chapter-end__heading'))
        .find((node) => node.textContent.includes('三视角'));
      heading?.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, 'feature_ending_three_perspectives.png') });
    report.push({ shot: 'feature_ending_three_perspectives.png', viewport: LAND, problems: problems.slice(0, 3) });

    await page.click('.chapter-end__tab:has-text("旁观者抵制")');
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, 'feature_ending_three_perspectives_filter_bystander.png') });
    report.push({ shot: 'feature_ending_three_perspectives_filter_bystander.png', viewport: LAND, problems: problems.slice(0, 3) });
  } catch (err) {
    report.push({ shot: 'ending page', error: String(err).slice(0, 240), problems: problems.slice(0, 3) });
    await page.screenshot({ path: join(OUT, '_ending_failure.png') }).catch(() => {});
  }
  await context.close();
}

await browser.close();
writeFileSync(join(OUT, 'legalShots.json'), JSON.stringify(report, null, 2));
console.log(report.map((r) => r.shot || `${r.stage} FAILED ${r.error}`).join('\n'));

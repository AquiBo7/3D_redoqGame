// tools/verifyScenes.mjs —— 无头 Chromium 逐场景实机核查（S4/S5/S7/S8 + 首屏房间零模型）
// 运行前先启动 dev server：npm run dev -- --port 5173 --strictPort
//   node tools/verifyScenes.mjs
// 核查项：角色 GLB 按场景契约加载（房间为零）、无控制台报错 / 警告 / 404、
//        切图黑幕正常淡入、截图供人工核对朝向 / 脚贴地面 / 穿模。

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT_DIR = 'tools/shots';
const BASE_URL = 'http://localhost:5173/';
const CHROME_PATH =
  'C:/Users/AnQi/AppData/Local/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-win64/chrome-headless-shell.exe';

const EXPECTED_MODELS = {
  S1: [],
  // S4 挂载后会静默预热 S5 的 linxia / father（不阻塞街段），因此允许这两个额外请求
  S4: ['volunteer', 'ayuan', 'linxia', 'father'],
  S5: ['linxia', 'father', 'ayuan', 'volunteer'],
  S7: ['volunteer', 'linxia', 'father'],
  S8: ['linxia', 'father'],
};

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});

let failed = false;

async function openScene(sceneId) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const problems = [];
  const glbRequests = new Set();

  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      problems.push(`console:${msg.type()} ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror ${error.message}`));
  page.on('requestfailed', (request) => {
    if (request.url().endsWith('favicon.ico')) return;
    problems.push(`requestfailed ${request.url()} ${request.failure()?.errorText ?? ''}`);
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    if (response.url().endsWith('favicon.ico')) return;
    problems.push(`http ${response.status()} ${response.url()}`);
  });
  page.on('request', (request) => {
    const match = request.url().match(/\/models\/chr_([a-z]+)\.glb/);
    if (match) glbRequests.add(match[1]);
  });

  await page.goto(`${BASE_URL}?scene=${sceneId}`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__worldApp), { timeout: 60000 });
  await page.waitForFunction((id) => window.__worldApp.getSceneId() === id, sceneId, { timeout: 60000 });
  // 等黑幕淡入完成（opacity < 0.05）
  await page.waitForFunction(
    () => {
      const fade = document.querySelector('.scene-fade');
      if (!fade) return true;
      return Number.parseFloat(getComputedStyle(fade).opacity) < 0.05;
    },
    { timeout: 20000 },
  );
  await page.waitForTimeout(1200);

  return { context, page, problems, glbRequests };
}

for (const sceneId of Object.keys(EXPECTED_MODELS)) {
  const { context, page, problems, glbRequests } = await openScene(sceneId);

  const expected = EXPECTED_MODELS[sceneId];
  const missing = expected.filter((id) => !glbRequests.has(id));
  const unexpected = [...glbRequests].filter((id) => !expected.includes(id));
  const sceneProblems = [...problems];
  if (missing.length > 0) sceneProblems.push(`缺少 GLB 请求：${missing.join(', ')}`);
  if (unexpected.length > 0) sceneProblems.push(`多余 GLB 请求：${unexpected.join(', ')}`);

  await page.screenshot({ path: `${OUT_DIR}/scene-${sceneId}.png` });
  console.log(
    `${sceneId}: 模型 [${[...glbRequests].join(', ') || '无'}] 期望 [${expected.join(', ') || '无'}] → ${
      sceneProblems.length === 0 ? 'PASS' : 'FAIL'
    }`,
  );

  // 额外的近景 / 回头视角，供人工核对朝向与构图
  if (sceneId === 'S4') {
    await page.evaluate(() => window.__worldApp.teleport(0.5, 2, 0));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT_DIR}/scene-S4-mid.png` });
    await page.evaluate(() => window.__worldApp.teleport(2.4, -5.2, -43));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT_DIR}/scene-S4-closeup.png` });
  }
  if (sceneId === 'S5') {
    // 等演出拆分完成（9.6s 拆分 + 行走），核对林夏 / 爸爸为真实模型、袋子在手下垂高度
    await page.waitForTimeout(10500);
    await page.evaluate(() => window.__worldApp.teleport(0.4, 5.8, 0));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT_DIR}/scene-S5-split.png` });
    await page.evaluate(() => window.__worldApp.teleport(-0.2, 3.6, 0));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT_DIR}/scene-S5-bags.png` });
    await page.evaluate(() => window.__worldApp.teleport(-0.6, 5.4, 63));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT_DIR}/scene-S5-typer.png` });
  }
  if (sceneId === 'S7') {
    await page.evaluate(() => window.__worldApp.teleport(0, -1.2, 180));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT_DIR}/scene-S7-father.png` });
  }
  if (sceneId === 'S8') {
    await page.evaluate(() => window.__worldApp.teleport(0.2, 1.2, 180));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT_DIR}/scene-S8-lookback.png` });
  }

  for (const problem of sceneProblems) console.log(`  [${sceneId}] ${problem}`);
  if (sceneProblems.length > 0) failed = true;

  await context.close();
}

await browser.close();
if (failed) {
  console.log('RESULT: FAIL');
  process.exit(1);
}
console.log('RESULT: PASS — 场景模型预载、首屏零模型、控制台与网络均无异常');
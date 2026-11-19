// tools/verifyRigScenes.mjs —— 无头验证 S5/S8 真实骨骼走路：位移速度与剧本标定一致、控制台零告警
// 运行前先启动 dev server：npm run dev -- --port 5173 --strictPort

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT_DIR = 'tools/shots';
const BASE_URL = 'http://localhost:5173/';
const CHROME_PATH =
  'C:/Users/AnQi/AppData/Local/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-win64/chrome-headless-shell.exe';

mkdirSync(OUT_DIR, { recursive: true });

const problems = [];
const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});

async function openScene(sceneId) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      problems.push(`[${sceneId}] console:${msg.type()} ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`[${sceneId}] pageerror ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('favicon.ico')) {
      problems.push(`[${sceneId}] http ${response.status()} ${response.url()}`);
    }
  });

  await page.goto(`${BASE_URL}?scene=${sceneId}`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__worldApp), { timeout: 60000 });
  await page.waitForFunction((id) => window.__worldApp.getSceneId() === id, sceneId, { timeout: 60000 });
  await page.waitForTimeout(1500);
  return { context, page };
}

const readPosition = (page, name) =>
  page.evaluate((actorName) => window.__worldApp.getActorPosition(actorName), name);

// ---------- S5：连续采样整段行走区间（9.6–12.05s 剧本时间线），按实际移动段计算均速 ----------
{
  const { context, page } = await openScene('S5');
  await page.evaluate(() => window.__worldApp.teleport(0.4, 5.8, 0));

  const samples = [];
  const samplingStart = Date.now();
  while (Date.now() - samplingStart < 16000) {
    const position = await readPosition(page, 'linxiaSolo');
    if (position) samples.push({ t: Date.now(), x: position[0], z: position[2] });
    await page.waitForTimeout(100);
  }

  // 首末移动样本界定走路区间：无头环境帧率低，位置按帧跳变；
// 取第一次与最后一次“有位移”的采样计算均速，避免把静帧计入移动段。
  let firstMoving = -1;
  let lastMoving = -1;
  for (let index = 1; index < samples.length; index += 1) {
    const step = Math.hypot(samples[index].x - samples[index - 1].x, samples[index].z - samples[index - 1].z);
    if (step > 0.02) {
      if (firstMoving < 0) firstMoving = index - 1;
      lastMoving = index;
    }
  }

  const duration = firstMoving >= 0 ? (samples[lastMoving].t - samples[firstMoving].t) / 1000 : 0;
  if (firstMoving < 0 || duration < 1) {
    problems.push('[S5] 拆分后林夏未按剧本开始行走');
  } else {
    const first = samples[firstMoving];
    const last = samples[lastMoving];
    const speed = Math.hypot(last.x - first.x, last.z - first.z) / duration;
    // 剧本标定：0.8 倍速步态 ≈ 0.84m/s，允许 0.5–1.1 m/s
    console.log(`S5 行走速度：${speed.toFixed(2)} m/s（移动段 ${duration.toFixed(2)}s）`);
    if (speed < 0.5 || speed > 1.1) problems.push(`[S5] 行走速度异常：${speed.toFixed(2)} m/s`);
  }
  await context.close();
}

// ---------- S5：独立第二遍入场抓取行走中画面（截图会阻塞采样，故与测速分开） ----------
{
  const { context, page } = await openScene('S5');
  await page.evaluate(() => window.__worldApp.teleport(0.4, 5.8, 0));
  // 剧本 9.6–12.05s 行走；openScene 已等 1.5s，再等 9s 正好落在步态中段
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${OUT_DIR}/S5-walk-1.png` });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/S5-walk-2.png` });
  await context.close();
}

// ---------- S8：26 秒路线 ≈1.65m/s ----------
{
  const { context, page } = await openScene('S8');
  await page.screenshot({ path: `${OUT_DIR}/S8-walk-1.png` });
  const before = await readPosition(page, 'linxia');
  const t0 = Date.now();
  await page.waitForTimeout(2000);
  const after = await readPosition(page, 'linxia');
  const elapsed = (Date.now() - t0) / 1000;
  await page.screenshot({ path: `${OUT_DIR}/S8-walk-2.png` });
  const distance = Math.hypot(after[0] - before[0], after[2] - before[2]) / elapsed;
  console.log(`S8 行走速度：${distance.toFixed(2)} m/s（目标 ≈1.65）`);
  if (distance < 1.45 || distance > 1.85) problems.push(`[S8] 行走速度偏离路线标定：${distance.toFixed(2)} m/s`);
  await context.close();
}

await browser.close();
if (problems.length > 0) {
  console.log(problems.join('\n'));
  console.log('RESULT: FAIL');
  process.exit(1);
}
console.log('RESULT: PASS — S5/S8 走路速度与标定一致，控制台零错误零告警');

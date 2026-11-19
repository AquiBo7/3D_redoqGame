// tools/verifyArtBatch2.mjs —— 第二批美术升级无头验收
// 运行前先启动 dev server：npm run dev -- --port 5173 --strictPort
//   node tools/verifyArtBatch2.mjs
// 覆盖：S1/S4/S5/S7/S8 实机截图；晨曦天空球随相机且与雾色融合；PMREM 环境光生效；
//       地面角色接触阴影、S5 背人上的 carryLinxia 无悬空阴影；控制台零报错零警告零 404。

import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT_DIR = 'tools/shots';
const BASE_URL = 'http://localhost:5173/';
const CHROME_PATH =
  'C:/Users/AnQi/AppData/Local/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-win64/chrome-headless-shell.exe';

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});

let failed = false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { checks: [], problems: [] };

function check(name, ok, detail = '') {
  report.checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
}

function watch(page, tag) {
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      report.problems.push(`${tag} console:${msg.type()} ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => report.problems.push(`${tag} pageerror ${error.message}`));
  page.on('requestfailed', (request) => {
    if (request.url().includes('favicon')) return;
    report.problems.push(`${tag} requestfailed ${request.url()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().includes('favicon')) {
      report.problems.push(`${tag} http${response.status()} ${response.url()}`);
    }
  });
}

async function waitForFade(page) {
  await page.waitForFunction(
    () => {
      const fade = document.querySelector('.scene-fade');
      if (!fade) return true;
      return Number.parseFloat(getComputedStyle(fade).opacity) < 0.05;
    },
    { timeout: 30000 },
  );
}

async function enterScene(page, sceneId) {
  await page.goto(`${BASE_URL}?scene=${sceneId}`, { waitUntil: 'load' });
  // ?scene= 直达会自动开始；仅当开始页仍展示时才点击
  const startButton = page.locator('#btn-start');
  if (await startButton.isVisible().catch(() => false)) await startButton.click();
  await page.waitForFunction(() => Boolean(window.__worldApp), { timeout: 60000 });
  await page.waitForFunction((id) => window.__worldApp.getSceneId() === id, sceneId, { timeout: 30000 });
  await waitForFade(page);
  await sleep(1200);
}

const OUTER_ACTOR_NAME = /^actor-(linxia|father|ayuan|volunteer)$/;

async function diagnostics(page) {
  return page.evaluate(() => window.__worldApp.getVisualDiagnostics());
}

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
watch(page, 'main');

try {
  // —— S1 房间：室内光照回归 + 无角色无接触阴影 ——
  await enterScene(page, 'S1');
  await page.screenshot({ path: `${OUT_DIR}/art2-S1-room.png` });
  const s1 = await diagnostics(page);
  check('S1 天空球随相机', s1.skyCameraDelta < 0.001, `delta=${s1.skyCameraDelta}`);
  check('S1 天空球半径/远平面', s1.skyRadius === 90 && s1.cameraFar === 120);
  check('S1 天空不受雾影响且不写深度', s1.skyFogDisabled && s1.skyDepthWrite === false);
  check('S1 PMREM 环境光已挂载', s1.environment && s1.environmentIntensity > 0,
    `intensity=${s1.environmentIntensity}`);
  check('S1 室内无角色接触阴影', s1.shadowActors.length === 0);

  // —— S4 街道：天空融合 + 角色光照 + 地面接触阴影 ——
  await enterScene(page, 'S4');
  await page.screenshot({ path: `${OUT_DIR}/art2-S4-street.png` });
  const s4 = await diagnostics(page);
  check('S4 地面角色有接触阴影', s4.shadowActors.length >= 2, s4.shadowActors.join(','));
  check('S4 阴影只挂角色外层组', s4.shadowActors.every((n) => OUTER_ACTOR_NAME.test(n)));
  await page.evaluate(() => window.__worldApp.teleport(1.5, 5.5, 12));
  await sleep(400);
  const s4Moved = await diagnostics(page);
  check('S4 传送后天空球仍贴合相机', s4Moved.skyCameraDelta < 0.001,
    `delta=${s4Moved.skyCameraDelta}`);
  await page.screenshot({ path: `${OUT_DIR}/art2-S4-street-moved.png` });

  // —— S5 校门：背人演出初期，carryLinxia 严禁悬空阴影 ——
  await enterScene(page, 'S5');
  await sleep(1500);
  await page.screenshot({ path: `${OUT_DIR}/art2-S5-gate-carry.png` });
  const s5 = await diagnostics(page);
  check('S5 地面角色有接触阴影', s5.shadowActors.length >= 5, s5.shadowActors.join(','));
  check('S5 阴影只挂角色外层组', s5.shadowActors.every((n) => OUTER_ACTOR_NAME.test(n)));
  check('S5 carryFather 有接触阴影', s5.shadowActors.includes('actor-father'));
  check('S5 carryLinxia 无接触阴影', s5.carryLinxiaHasShadow === false);
  // 拆分演出结束后复查：林夏落地独立行走，依旧不应出现悬空黑盘
  await sleep(12500);
  await page.screenshot({ path: `${OUT_DIR}/art2-S5-gate-split.png` });
  const s5Split = await diagnostics(page);
  check('S5 拆分后 carryLinxia 仍无接触阴影', s5Split.carryLinxiaHasShadow === false);

  // —— S7 课桌 / S8 教学楼：角色光照与接触阴影回归 ——
  await enterScene(page, 'S7');
  await page.screenshot({ path: `${OUT_DIR}/art2-S7-desk.png` });
  const s7 = await diagnostics(page);
  check('S7 PMREM 环境光已挂载', s7.environment && s7.environmentIntensity > 0);
  check('S7 地面角色有接触阴影', s7.shadowActors.length >= 1, s7.shadowActors.join(','));

  await enterScene(page, 'S8');
  await page.screenshot({ path: `${OUT_DIR}/art2-S8-building.png` });
  const s8 = await diagnostics(page);
  check('S8 地面角色有接触阴影', s8.shadowActors.length >= 1, s8.shadowActors.join(','));
} catch (error) {
  failed = true;
  report.problems.push(`exception ${error.message}`);
  console.error(error);
  try {
    await page.screenshot({ path: `${OUT_DIR}/art2-99-error.png` });
  } catch {
    // 页面已崩溃时忽略截图失败
  }
}

check('控制台零报错/零警告/零404', report.problems.length === 0,
  report.problems.slice(0, 8).join(' | '));

writeFileSync(`${OUT_DIR}/art-batch2-report.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log(failed ? '第二批美术验收：FAIL' : '第二批美术验收：PASS');
process.exit(failed ? 1 : 0);

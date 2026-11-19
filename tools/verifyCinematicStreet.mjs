// tools/verifyCinematicStreet.mjs —— 清晨电影感街道与多场景调色回归
// 运行前：npm run dev -- --port 5173 --strictPort

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { checks: [], problems: [], diagnostics: {} };
let failed = false;

function check(name, ok, detail = '') {
  report.checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
}

function watch(page, tag) {
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      report.problems.push(`${tag} console:${message.type()} ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => report.problems.push(`${tag} pageerror ${error.message}`));
  page.on('requestfailed', (request) => {
    if (!request.url().includes('favicon')) report.problems.push(`${tag} requestfailed ${request.url()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().includes('favicon')) {
      report.problems.push(`${tag} http${response.status()} ${response.url()}`);
    }
  });
}

async function dismissPhonePreview(page) {
  const ignore = page.getByRole('button', { name: '忽略', exact: true });
  if (await ignore.isVisible().catch(() => false)) await ignore.click();
}

async function enterScene(page, sceneId) {
  await page.goto(`${BASE_URL}?scene=${sceneId}`, { waitUntil: 'load' });
  const start = page.locator('#btn-start');
  if (await start.isVisible().catch(() => false)) await start.click();
  await page.waitForFunction(() => Boolean(window.__worldApp), { timeout: 60000 });
  await page.waitForFunction((id) => window.__worldApp.getSceneId() === id, sceneId, { timeout: 30000 });
  await page.waitForFunction(() => {
    const fade = document.querySelector('.scene-fade');
    return !fade || Number.parseFloat(getComputedStyle(fade).opacity) < 0.05;
  }, { timeout: 30000 });
  await sleep(1400);
  await dismissPhonePreview(page);
}

async function diagnostics(page) {
  return page.evaluate(() => window.__worldApp.getVisualDiagnostics());
}

async function capture(page, name) {
  await dismissPhonePreview(page);
  await sleep(250);
  await page.screenshot({ path: `${OUT_DIR}/${name}.png` });
}

const desktop = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
watch(desktop, 'desktop');

try {
  await enterScene(desktop, 'S4');
  await desktop.waitForFunction(() => window.__worldApp.hasModel('volunteer') && window.__worldApp.hasModel('ayuan'));
  await capture(desktop, 'cinematic-S4-start');
  const s4 = await diagnostics(desktop);
  report.diagnostics.S4 = s4;
  check('S4 桌面 HDR 后处理启用', s4.postprocessing === true);
  check('S4 柔光阈值与强度克制', s4.bloomThreshold === 1.25 && s4.bloomStrength === 0.24);
  check('S4 户外微尘数量', s4.airParticles === 48, `count=${s4.airParticles}`);
  check('S4 ACES 曝光与 IBL 已压白', s4.toneMappingExposure === 0.94 && s4.environmentIntensity === 0.42);

  await desktop.evaluate(() => window.__worldApp.teleport(0.1, -8.7, -23));
  await sleep(600);
  await capture(desktop, 'cinematic-S4-shop-volunteer');

  await desktop.evaluate(() => window.__worldApp.teleport(0, -34.5, 0));
  await sleep(600);
  await capture(desktop, 'cinematic-S4-gate');

  for (const sceneId of ['S1', 'S5', 'S7', 'S8']) {
    await enterScene(desktop, sceneId);
    if (sceneId === 'S5') await sleep(1200);
    await capture(desktop, `cinematic-${sceneId}-color-check`);
    const values = await diagnostics(desktop);
    report.diagnostics[sceneId] = values;
    check(`${sceneId} 调色回归`, values.toneMappingExposure === 0.94 && values.environmentIntensity === 0.42);
    check(`${sceneId} 天空与后处理生命周期`, values.skyCameraDelta < 0.001 && values.postprocessing === true);
  }

  await desktop.close();
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  watch(mobile, 'mobile');
  await enterScene(mobile, 'S4');
  const mobileValues = await diagnostics(mobile);
  const canvas = await mobile.evaluate(() => {
    const element = document.querySelector('canvas');
    return element ? { width: element.width, cssWidth: element.clientWidth } : null;
  });
  const ratio = canvas ? canvas.width / canvas.cssWidth : 0;
  report.diagnostics.mobile = { ...mobileValues, pixelRatio: ratio };
  check('竖屏高 DPR 保持原生渲染', mobileValues.postprocessing === false);
  check('手机 pixelRatio ≤ 1.5', ratio > 0 && ratio <= 1.5, `ratio=${ratio}`);
  await capture(mobile, 'cinematic-S4-portrait');
  await mobile.close();
} catch (error) {
  failed = true;
  report.problems.push(`exception ${error.stack ?? error.message}`);
  console.error(error);
  try {
    await desktop.screenshot({ path: `${OUT_DIR}/cinematic-99-error.png` });
  } catch {
    // 页面已崩溃时无需再截图
  }
}

check('控制台零错误零警告、资源零 404', report.problems.length === 0, report.problems.slice(0, 10).join(' | '));
writeFileSync(`${OUT_DIR}/cinematic-street-report.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log(failed ? '清晨电影感验收：FAIL' : '清晨电影感验收：PASS');
process.exit(failed ? 1 : 0);

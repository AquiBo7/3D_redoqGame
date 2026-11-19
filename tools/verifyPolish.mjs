import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.CAMPUS_URL ?? 'http://127.0.0.1:5180/';
const browser = await chromium.launch({
  executablePath: 'C:/Users/AnQi/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',
  headless: true,
});
const report = { scope: ['M1: 模块1、2'], checks: [], screenshots: [], problems: [], diagnostics: {} };
function check(name, ok, detail) {
  report.checks.push({ name, ok, detail });
  assert.ok(ok, `${name}: ${JSON.stringify(detail)}`);
  console.log(`PASS ${name}`);
}
function watch(page) {
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type())) report.problems.push(message.text());
  });
  page.on('pageerror', (error) => report.problems.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) report.problems.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => report.problems.push(`${request.url()} ${request.failure()?.errorText}`));
}
async function shot(page, name) {
  const path = `tools/shots/polish-${name}.png`;
  await page.screenshot({ path, timeout: 60000 });
  report.screenshots.push(path);
}
async function settleAssets(page) {
  await page.waitForFunction(() => {
    if (!window.__worldApp) return true;
    const models = {
      S4: ['volunteer', 'ayuan', 'linxia', 'father'],
      S5: ['linxia', 'father', 'fatherCarry', 'ayuan', 'studentFemale', 'studentMale'],
      S6: ['linxia', 'father', 'fatherCarry', 'ayuan', 'studentFemale', 'studentMale'],
      S7: ['volunteer', 'linxia', 'father'],
      S8: ['linxia', 'father', 'studentFemale', 'studentMale'],
      S9: ['linxia', 'father', 'studentFemale', 'studentMale'],
    };
    return (models[window.__worldApp.getSceneId()] ?? []).every((id) => window.__worldApp.hasModel(id));
  }, null, { timeout: 60000 });
  await page.waitForLoadState('networkidle');
}
async function enter(page, sceneId) {
  await settleAssets(page);
  await page.goto(`${base}?scene=${sceneId}`, { waitUntil: 'load' });
  await page.waitForFunction((id) => window.__worldApp?.getSceneId() === id, sceneId, { timeout: 60000 });
  await page.waitForFunction(() => Number.parseFloat(getComputedStyle(document.querySelector('.scene-fade')).opacity) < .05, null, { timeout: 60000 });
  check(`${sceneId} 调试直达跳过指南`, await page.locator('.controls-guide').count() === 0);
  await settleAssets(page);
}
async function dialogue(page) {
  for (let i = 0; i < 20; i += 1) {
    const panel = page.locator('.dialogue:not([hidden]) .dialogue__panel');
    if (!await panel.isVisible()) return;
    await panel.click();
    await page.waitForTimeout(120);
  }
  throw new Error('对话不能结束');
}
async function waitObjective(page, sceneId) {
  await page.locator('.objective-prompt:not([hidden]):not(.is-fading)').waitFor({ timeout: 30000 });
  const geometry = await page.locator('.objective-prompt').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top / innerHeight, bottom: rect.bottom / innerHeight, text: element.textContent };
  });
  check(`${sceneId} 正面行动提醒不遮准星`, geometry.top > .18 && geometry.top < .24 && geometry.bottom < .48, geometry);
  await shot(page, `${sceneId}-objective-${page.viewportSize().width}`);
}
async function guide(page, name, enterKey = 'KeyE', continued = false) {
  await settleAssets(page);
  await page.goto(base, { waitUntil: 'load' });
  await page.locator(continued ? '#btn-continue' : '#btn-start').click();
  await page.locator('.controls-guide').waitFor();
  const layout = await page.locator('.controls-guide__enter').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, gap: innerHeight - rect.bottom, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  check(`${name} 指南保留触控热区与安全区`, layout.width >= 44 && layout.height >= 44 && layout.gap >= 48 && !layout.overflow, layout);
  check(`${name} 指南关闭前没有进入世界`, await page.evaluate(() => !window.__worldApp));
  await shot(page, `guide-${name}`);
  await page.keyboard.press(enterKey);
  await page.waitForFunction(() => !!window.__worldApp, null, { timeout: 60000 });
  check(`${name} 指南键盘确认后进入世界`, await page.locator('.controls-guide').count() === 0);
}
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  const glbs = [];
  page.on('request', (request) => { if (/\.glb(?:\?|$)/.test(request.url())) glbs.push(request.url()); });
  await guide(page, 'desktop');
  await waitObjective(page, 'S1');
  check('S1 首屏零 GLB', glbs.length === 0, [...glbs]);
  await page.evaluate(() => window.__worldApp.teleport(-2.85, -2.7, 0));
  await page.waitForTimeout(120);
  const phoneCooldown = await page.evaluate(() => {
    const press = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }));
    press();
    const opened = !document.querySelector('.phone-overlay').hidden;
    const started = performance.now();
    press();
    return { opened, protected: !!document.querySelector('.phone__lockscreen'), elapsed: performance.now() - started };
  });
  check('S1 同次 E 打开后不误解锁', phoneCooldown.opened && phoneCooldown.protected, phoneCooldown);
  check('手机180ms内 E 被防抖', phoneCooldown.elapsed < 180 && phoneCooldown.protected, phoneCooldown);
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyE');
  await page.locator('.phone__home-title').waitFor();
  await shot(page, 'phone-E-home');
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', repeat: true })));
  check('手机 E 长按不关闭', await page.locator('.phone-overlay:not([hidden])').isVisible());
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'polish-input';
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press('KeyE');
  check('输入焦点内 E 不关闭手机', await page.locator('.phone-overlay:not([hidden])').isVisible());
  await page.evaluate(() => document.querySelector('#polish-input').remove());
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => document.querySelector('.phone-overlay').hidden);
  await page.waitForFunction(() => window.__worldApp.getSceneId() === 'S3');
  await waitObjective(page, 'S3');
  const preparation = await page.evaluate(() => window.__worldApp.getPlayerPosition());
  check('S3 准备阶段可自由行动拾取', preparation.enabled, preparation);
  await page.evaluate(() => window.__worldApp.interact('document-bag'));
  await page.waitForFunction(() => window.__worldApp.getSceneId() === 'S4', null, { timeout: 30000 });
  await waitObjective(page, 'S4');
  await page.locator('.phone-vibrate:not([hidden])').waitFor();
  await page.waitForTimeout(200);
  const messageCooldown = await page.evaluate(() => {
    const press = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }));
    press();
    const opened = !document.querySelector('.vibration-message').hidden;
    const started = performance.now();
    press();
    return { opened, protected: !document.querySelector('.vibration-message').hidden, elapsed: performance.now() - started };
  });
  check('消息180ms内 E 不误收起', messageCooldown.opened && messageCooldown.protected && messageCooldown.elapsed < 180, messageCooldown);
  await shot(page, 'message-E-open');
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => document.querySelector('.vibration-message').hidden);
  check('消息收起后恢复移动控制', await page.evaluate(() => window.__worldApp.getPlayerPosition().enabled));
  const mutedBefore = await page.locator('.mute-toggle').getAttribute('aria-pressed');
  await page.keyboard.press('KeyO');
  check('O 切换静音状态', await page.locator('.mute-toggle').getAttribute('aria-pressed') !== mutedBefore);
  await page.keyboard.press('KeyO');
  check('O 再次恢复声音状态', await page.locator('.mute-toggle').getAttribute('aria-pressed') === mutedBefore);
  await page.waitForLoadState('networkidle');
  await guide(page, 'continue', 'Space', true);
  await page.waitForLoadState('networkidle');
  await enter(page, 'S5');
  await dialogue(page);
  await waitObjective(page, 'S5');
  await enter(page, 'S7');
  await dialogue(page);
  await waitObjective(page, 'S7');
  await enter(page, 'S8');
  await dialogue(page);
  await page.getByRole('button', { name: '我陪你走一段。', exact: true }).click();
  await waitObjective(page, 'S8');
  await page.waitForLoadState('networkidle');
  await page.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  watch(mobile);
  await guide(mobile, 'portrait', 'Space');
  await waitObjective(mobile, 'S1');
  await mobile.waitForLoadState('networkidle');
  await mobile.setViewportSize({ width: 844, height: 390 });
  await guide(mobile, 'landscape', 'KeyE');
  await enter(mobile, 'S4');
  const layout = await mobile.evaluate(() => ({
    ratio: document.querySelector('canvas').width / document.querySelector('canvas').clientWidth,
    postprocessing: window.__worldApp.getVisualDiagnostics().postprocessing,
  }));
  check('触屏像素比≤1.5且不启用后处理', layout.ratio <= 1.5 && layout.ratio > 0 && layout.postprocessing === false, layout);
  await mobile.evaluate(() => window.__worldApp.teleport(0, 3, 0));
  const before = await mobile.evaluate(() => window.__worldApp.getPlayerPosition());
  await mobile.touchscreen.tap(422, 250);
  await mobile.waitForTimeout(650);
  const walking = await mobile.evaluate(() => window.__worldApp.getPlayerPosition());
  const walkDistance = Math.hypot(walking.feet.x - before.feet.x, walking.feet.z - before.feet.z);
  await mobile.evaluate(() => window.__worldApp.teleport(0, 3, 0));
  await mobile.touchscreen.tap(422, 250);
  await mobile.touchscreen.tap(422, 250);
  await mobile.waitForTimeout(650);
  const running = await mobile.evaluate(() => window.__worldApp.getPlayerPosition());
  const runDistance = Math.hypot(running.feet.x - before.feet.x, running.feet.z - before.feet.z);
  check('触屏双击地面实际移动快于单击', walkDistance > .5 && runDistance > walkDistance * 1.25, { walkDistance, runDistance });
  await shot(mobile, 'touch-sprint');
  await mobile.waitForLoadState('networkidle');
  await mobile.close();
  check('浏览器零错误零警告及资源失败', report.problems.length === 0, report.problems);
} catch (error) {
  report.problems.push(error.stack ?? String(error));
  console.error(error);
  process.exitCode = 1;
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages[pages.length - 1];
  if (page) {
    report.failure = await page.evaluate(() => ({ sceneId: window.__worldApp?.getSceneId(), text: document.body.innerText }));
    await shot(page, 'failure');
  }
} finally {
  writeFileSync('tools/shots/polish-report.json', JSON.stringify(report, null, 2));
  await browser.close();
}

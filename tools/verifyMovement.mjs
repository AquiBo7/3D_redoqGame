import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.CAMPUS_URL ?? 'http://127.0.0.1:5174/';
const browser = await chromium.launch({
  executablePath: 'C:/Users/AnQi/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',
  headless: true,
});
const report = { checks: [], problems: [], diagnostics: {} };
const check = (name, result, detail) => {
  report.checks.push({ name, result, detail });
  assert.ok(result, `${name}: ${JSON.stringify(detail)}`);
  console.log(`PASS ${name}`);
};
function watch(page) {
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) report.problems.push(message.text());
  });
  page.on('pageerror', (error) => report.problems.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) report.problems.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => report.problems.push(`${request.url()} ${request.failure()?.errorText}`));
}
async function enter(page, id) {
  await page.goto(id === 'S1' ? base : `${base}?scene=${id}`, { waitUntil: 'load' });
  if (await page.locator('#btn-start').isVisible()) {
    await page.locator('#btn-start').click();
    await page.locator('.controls-guide__enter').click();
  }
  await page.waitForFunction((id) => window.__worldApp?.getSceneId() === id, id, { timeout: 60000 });
  if (id === 'S1') {
    await page.waitForFunction(() => window.__worldApp.getPlayerPosition().enabled, null, { timeout: 60000 });
  } else {
    await page.waitForFunction(() => {
      const fade = document.querySelector('.scene-fade');
      return fade && Number.parseFloat(getComputedStyle(fade).opacity) < 0.05;
    }, null, { timeout: 60000 });
  }
}
async function dismissDialogue(page) {
  for (let i = 0; i < 20; i += 1) {
    const panel = page.locator('.dialogue:not([hidden]) .dialogue__panel');
    if (!await panel.isVisible()) return;
    await panel.click();
    await page.waitForTimeout(100);
  }
}
async function shot(page, name) {
  await page.screenshot({ path: `tools/shots/motion-${name}.png`, timeout: 60000 });
}
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await page.addInitScript(() => {
    window.__stepSounds = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer?.length > 1) window.__stepSounds += 1;
      return start.apply(this, args);
    };
  });
  await enter(page, 'S1');
  await page.waitForTimeout(2500);
  const before = await page.evaluate(() => window.__worldApp.getPlayerPosition());
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyW');
  const moved = await page.evaluate(() => ({ ...window.__worldApp.getPlayerPosition(), sounds: window.__stepSounds }));
  check('S1 未看手机即可实际走动', before.feet.z - moved.feet.z > 0.6, { before, moved });
  check('真实 Web Audio 已触发木地板脚步', moved.sounds > 0, moved.sounds);
  await page.waitForTimeout(350);
  const stopped = await page.evaluate(() => window.__stepSounds);
  await page.waitForTimeout(600);
  check('停步后不继续补播脚步', await page.evaluate(() => window.__stepSounds) === stopped, stopped);
  await shot(page, 'S1-free-walk');
  await page.getByRole('button', { name: '静音', exact: true }).click();
  const mutedSounds = await page.evaluate(() => window.__stepSounds);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(650);
  await page.keyboard.up('KeyD');
  check('静音期间行走不播放脚步', await page.evaluate(() => window.__stepSounds) === mutedSounds, mutedSounds);
  await page.getByRole('button', { name: '取消静音', exact: true }).click();
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(650);
  await page.keyboard.up('KeyA');
  check('取消静音后脚步恢复', await page.evaluate(() => window.__stepSounds) > mutedSounds, await page.evaluate(() => window.__stepSounds));
  await page.evaluate(() => window.__worldApp.interact('phone'));
  await page.locator('.phone-overlay:not([hidden])').waitFor();
  const phoneBefore = await page.evaluate(() => window.__worldApp.getPlayerPosition());
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyW');
  const phoneAfter = await page.evaluate(() => window.__worldApp.getPlayerPosition());
  check('手机打开期间移动暂停', phoneBefore.feet.x === phoneAfter.feet.x && phoneBefore.feet.z === phoneAfter.feet.z && !phoneAfter.enabled, { phoneBefore, phoneAfter });
  await shot(page, 'S2-phone-lock');
  await page.evaluate(async () => {
    const { eventBus } = await import('/src/core/eventBus.ts');
    window.__worldApp.teleport(-1.6, 0.2, 180);
    window.__runFrames = [];
    eventBus.on('scene:transition', ({ toSceneId }) => {
      if (toSceneId !== 'S3') return;
      const began = performance.now();
      const capture = () => {
        if (window.__worldApp.getSceneId() !== 'S3') return;
        window.__runFrames.push({ time: (performance.now() - began) / 1000, ...window.__worldApp.getPlayerPosition() });
        requestAnimationFrame(capture);
      };
      requestAnimationFrame(capture);
    });
  });
  await page.getByRole('button', { name: '收起手机', exact: true }).click();
  await page.waitForFunction(() => window.__worldApp.getSceneId() === 'S4', null, { timeout: 30000 });
  const runFrames = await page.evaluate(() => window.__runFrames);
  report.diagnostics.runFrames = runFrames;
  const moving = runFrames.filter((frame) => Math.hypot(frame.camera[0] + 1.6, frame.camera[2] - 0.2) > 0.001);
  check('S3 错误朝向先原地转向', runFrames.filter((frame) => frame.time < 0.3).every((frame) => Math.hypot(frame.camera[0] + 1.6, frame.camera[2] - 0.2) < 0.001), runFrames.slice(0, 3));
  check('S3 推进期间门始终在视线正前方', moving.length > 5 && moving.every((frame) => {
    const dx = 3.39 - frame.camera[0];
    const dz = 2.7 - frame.camera[2];
    return (dx * frame.direction[0] + dz * frame.direction[2]) / Math.hypot(dx, dz) > 0.999;
  }), moving[moving.length - 1]);
  await page.waitForFunction(() => Number.parseFloat(getComputedStyle(document.querySelector('.scene-fade')).opacity) < 0.05, null, { timeout: 60000 });

  await enter(page, 'S5');
  await dismissDialogue(page);
  await page.evaluate(async () => {
    const { eventBus } = await import('/src/core/eventBus.ts');
    const { unlockAudio } = await import('/src/audio/audioManager.ts');
    window.__motionSources = {};
    eventBus.on('audio:motion', (motion) => {
      if (motion.allow && motion.distance > 0 && motion.gain > 0) {
        window.__motionSources[motion.sourceId] = (window.__motionSources[motion.sourceId] ?? 0) + motion.distance;
      }
    });
    window.addEventListener('pointerdown', unlockAudio, { once: true });
  });
  await page.mouse.click(1250, 690);
  const terrain = [];
  for (let step = 0; step < 6; step += 1) {
    const z = 6 - (step + 0.5) * 0.55;
    const position = await page.evaluate((z) => { window.__worldApp.teleport(0, z); return window.__worldApp.getPlayerPosition(); }, z);
    terrain.push(position);
    check(`第 ${step + 1} 级台阶脚底高度`, Math.abs(position.feet.y - (step + 1) * 0.07) < 1e-6, position);
  }
  await page.evaluate(() => window.__worldApp.teleport(0, 2.5, 0));
  const landing = await page.evaluate(() => window.__worldApp.getPlayerPosition());
  check('台顶脚底保持 0.42m', Math.abs(landing.feet.y - 0.42) < 1e-6, landing);
  await page.evaluate(() => window.__worldApp.teleport(0, 7.6, 0));
  await shot(page, 'S5-carry');
  await page.waitForFunction(() => window.__worldApp.getActorPosition('linxiaSolo')?.[2] < 0.51, null, { timeout: 30000 });
  const actors = await page.evaluate(() => ({
    carry: window.__worldApp.getActorPosition('carryGroup'),
    linxia: window.__worldApp.getActorPosition('linxiaSolo'),
    father: window.__worldApp.getActorPosition('fatherSolo'),
    bags: window.__worldApp.getActorPosition('bagsSolo'),
    typer: window.__worldApp.getActorPosition('typer'),
    diagnostics: window.__worldApp.getVisualDiagnostics(),
    sources: window.__motionSources,
  }));
  check('父女与行李拆分后不落回平地', [actors.carry, actors.linxia, actors.father, actors.bags].every((position) => Math.abs(position[1] - 0.42) < 1e-6), actors);
  check('打字男生左后方站位保持贴地', Math.abs(actors.typer[1]) < 1e-6 && actors.typer[0] === -3.6 && actors.typer[2] === 7.95, actors.typer);
  check('地形相对接触阴影排除背负的林夏', !actors.diagnostics.carryLinxiaHasShadow && actors.diagnostics.shadowActors.includes('actor-fatherCarry'), actors.diagnostics);
  check('新模型已经加载，不是胶囊体占位', await page.evaluate(() => ['fatherCarry', 'studentFemale', 'studentMale'].every((id) => window.__worldApp.hasModel(id))), true);
  check('附近 NPC 实际位移产生独立声源', actors.sources.carryGroup > 0 || actors.sources.linxiaSolo > 0 || actors.sources['student-walker'] > 0, actors.sources);
  await shot(page, 'S5-split');
  await page.evaluate(() => window.__worldApp.teleport(2.5, 2.6, -32));
  await shot(page, 'S5-students');
  report.diagnostics.terrain = terrain;
  report.diagnostics.actors = actors;
  await page.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  watch(mobile);
  await enter(mobile, 'S5');
  await dismissDialogue(mobile);
  await mobile.setViewportSize({ width: 844, height: 390 });
  await mobile.evaluate(() => window.__worldApp.teleport(0, 6.4, 0));
  await mobile.touchscreen.tap(422, 230);
  await mobile.waitForTimeout(1800);
  const mobilePosition = await mobile.evaluate(() => window.__worldApp.getPlayerPosition());
  check('手机轻点地面可爬升台阶', mobilePosition.feet.z < 6.0 && mobilePosition.feet.y > 0, mobilePosition);
  await shot(mobile, 'mobile-stairs');
  await mobile.waitForFunction(() => window.__worldApp.getSceneId() === 'S7' && window.__worldApp.hasModel('volunteer') && Number.parseFloat(getComputedStyle(document.querySelector('.scene-fade')).opacity) < 0.05, null, { timeout: 60000 });
  await mobile.waitForLoadState('networkidle');
  await mobile.close();
  check('浏览器零错误零警告、资源零失败', report.problems.length === 0, report.problems);
} catch (error) {
  report.problems.push(error.stack ?? String(error));
  console.error(error);
  process.exitCode = 1;
  const page = browser.contexts().flatMap((context) => context.pages()).pop();
  if (page) {
    report.failureState = await page.evaluate(() => ({ scene: window.__worldApp?.getSceneId(), text: document.body.innerText }));
    await shot(page, 'failure');
  }
} finally {
  writeFileSync('tools/shots/movement-report.json', JSON.stringify(report, null, 2));
  await browser.close();
}

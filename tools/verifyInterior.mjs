import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.V05_URL ?? 'http://127.0.0.1:5177/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? 'C:/Users/AnQi/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const report = { checks: [], problems: [] };
async function open(scene, seed = {}, mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 });
  const page = await context.newPage();
  page.on('pageerror', e => report.problems.push(e.message));
  page.on('console', m => { if (['warning', 'error'].includes(m.type())) report.problems.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) report.problems.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${base}?scene=${scene}`, { waitUntil: 'networkidle' });
  await page.evaluate(async ({ scene, seed }) => {
    const { eventBus } = await import('/src/core/eventBus.ts');
    const { createEmptyChapterSave, saveChapterSave } = await import('/src/core/saveStore.ts');
    window.__interior = { state: null, step: '', options: [] };
    eventBus.on('state:changed', ({ state }) => window.__interior.state = state);
    for (const type of ['ui:showChoices', 'ui:showDialogue', 'ui:showCaption', 'ui:showPhone', 'ui:showIntertitle', 'scene:cutscene']) eventBus.on(type, payload => {
      window.__interior.step = payload.stepId;
      if (type === 'ui:showChoices') window.__interior.options = payload.options;
    });
    const save = createEmptyChapterSave({ sceneId: scene }); Object.assign(save.state, seed); saveChapterSave(save);
    eventBus.emit('ui:continueGame');
  }, { scene, seed });
  await page.waitForFunction(scene => window.__worldApp?.getSceneId() === scene && ['linxia', 'ayuan', 'studentFemale', 'studentMale'].every(id => window.__worldApp.hasModel(id)), scene);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.scene-fade')).opacity === '0');
  return { context, page };
}
async function advance(page, step) {
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate(step => window.__interior.step === step, step)) return;
    let acted = false;
    for (const selector of ['.dialogue:not([hidden]) .dialogue__panel', '.caption--inner.is-visible:not([hidden])', '.phone-overlay:not([hidden]) .phone__close', '.intertitle:not([hidden]) .intertitle__skip:not([hidden])']) {
      if (await page.locator(selector).isVisible()) { await page.locator(selector).click(); acted = true; break; }
    }
    if (!acted) throw new Error(`无法推进到 ${step}，当前 ${await page.evaluate(() => window.__interior.step)}`);
  }
  throw new Error(`未到达 ${step}`);
}
async function choose(page, id) {
  const text = await page.evaluate(id => window.__interior.options.find(o => o.id === id)?.text, id);
  assert.ok(text, id); await page.getByRole('button', { name: text, exact: true }).click();
}
async function move(page, x, z, yaw = 0) {
  await page.waitForFunction(() => window.__worldApp.getPlayerPosition().enabled);
  await page.evaluate(([x, z, yaw]) => window.__worldApp.teleport(x, z, yaw), [x, z, yaw]);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function shot(page, name) { await page.screenshot({ path: `tools/shots/interior-${name}.png` }); }
try {
  const classroom = await open('C2', { trust: 2 });
  await advance(classroom.page, 'c2-seat');
  await shot(classroom.page, 'classroom');
  await move(classroom.page, -5.3, 4.75, -90);
  await move(classroom.page, -5.3, 4.75, 90); await shot(classroom.page, 'linxia-drawing');
  await classroom.page.keyboard.press('e');
  await classroom.page.waitForFunction(() => window.__interior.state.seat === 'beside');
  assert.equal(await classroom.page.evaluate(() => window.__interior.state.trust), 3);
  await classroom.context.close(); report.checks.push('真实教室模型、坐姿速写与 E 键选座');

  const stairs = await open('C4', { picked: true, trust: 3 }, true);
  await shot(stairs.page, 'stairs-landscape');
  const dpr = await stairs.page.locator('#app canvas').first().evaluate(c => c.width / c.getBoundingClientRect().width);
  assert.ok(dpr <= 1.5);
  await stairs.page.setViewportSize({ width: 390, height: 844 });
  await shot(stairs.page, 'stairs-portrait');
  await move(stairs.page, 7, -1, -90);
  await stairs.page.waitForFunction(() => window.__interior.state.visitedStairwell);
  await advance(stairs.page, 'c4-father-question');
  assert.equal(await stairs.page.evaluate(() => window.__interior.state.fatherKnows), false);
  await stairs.context.close(); report.checks.push('手机横竖屏教学楼、DPR 上限、真实楼梯区域与父亲来电');

  const corridor = await open('C5', { noticedTyper: true });
  await advance(corridor.page, 'c5-find-path'); await choose(corridor.page, 'recognize');
  await move(corridor.page, 2.7, -7, -90); await corridor.page.keyboard.press('e');
  await corridor.page.waitForFunction(() => window.__interior.state.wrongAsks === 1);
  await advance(corridor.page, 'c5-recognize');
  await move(corridor.page, 2.7, 2, -90); await shot(corridor.page, 'orange-phone');
  await corridor.page.keyboard.press('e'); await advance(corridor.page, 'c5-find-path');
  assert.equal(await corridor.page.evaluate(() => window.__interior.state.foundAyuanWay), 'recognize');
  await corridor.context.close(); report.checks.push('走廊六名同学、真实 E 键错认与辨认、橙色手机线索');

  const night = await open('C6');
  await move(night.page, 7, 0, -130); await shot(night.page, 'night');
  await move(night.page, 7, -1, -90);
  await night.page.waitForFunction(() => window.__worldApp.getSceneId() === 'D1');
  await night.context.close(); report.checks.push('夜晚楼梯间近距触发与第四章衔接');

  const platform = await open('D1', { foundAyuanWay: 'recognize', yuanState: 'unprepared' });
  if (await platform.page.locator('.intertitle__skip').isVisible()) await platform.page.locator('.intertitle__skip').click();
  await move(platform.page, 7, 3.7, -135); await shot(platform.page, 'sunset');
  await move(platform.page, 7, 5, -90);
  await platform.page.waitForFunction(() => window.__interior.step === 'd1-unprepared');
  await shot(platform.page, 'approach');
  await platform.context.close(); report.checks.push('夕阳平台区域与真实推近镜头');

  const meeting = await open('D6', { joined: true, route: 'team', postDeleted: true });
  await move(meeting.page, 2.8, -2.8, 0); await shot(meeting.page, 'meeting');
  await move(meeting.page, 2.8, -4, -90); await advance(meeting.page, 'd6-team-response');
  await choose(meeting.page, 'd6-team-speak');
  assert.equal(await meeting.page.evaluate(() => window.__interior.state.apologized), true);
  await meeting.context.close(); report.checks.push('傍晚走廊并肩会面与道歉结算');
  assert.deepEqual(report.problems, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close(); writeFileSync('tools/shots/interior-report.json', JSON.stringify(report, null, 2));
}

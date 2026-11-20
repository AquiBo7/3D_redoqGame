import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.V05_URL ?? 'http://127.0.0.1:5177/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? 'C:/Users/AnQi/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',
  headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const report = { checks: [], problems: [] };
async function open(scene, seed = {}, mobile = false, world = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 });
  const page = await context.newPage();
  page.on('pageerror', error => report.problems.push(error.message));
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) report.problems.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) report.problems.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${base}?${world ? '' : 'lite=1&'}scene=${scene}`, { waitUntil: 'networkidle' });
  await page.evaluate(async ({ scene, seed }) => {
    const { eventBus } = await import('/src/core/eventBus.ts');
    const { createEmptyChapterSave, saveChapterSave } = await import('/src/core/saveStore.ts');
    window.__ch34 = { state: null, scene, step: '', choices: [], settlements: [], history: [] };
    eventBus.on('state:changed', ({ state }) => { window.__ch34.state = state; });
    eventBus.on('scene:transition', ({ toSceneId }) => { window.__ch34.scene = toSceneId; window.__ch34.history.push(toSceneId); window.__ch34.step = ''; });
    for (const event of ['ui:showDialogue', 'ui:showChoices', 'ui:showPhone', 'ui:showArt', 'ui:showIntertitle', 'ui:showMinigame', 'ui:showCaption', 'scene:cutscene']) {
      eventBus.on(event, payload => { window.__ch34.step = payload.stepId; if (event === 'ui:showChoices') window.__ch34.choices = payload.options; });
    }
    eventBus.on('ui:minigameEnd', result => window.__ch34.settlements.push(result));
    const save = createEmptyChapterSave({ sceneId: scene });
    Object.assign(save.state, seed);
    saveChapterSave(save);
    eventBus.emit('ui:continueGame');
  }, { scene, seed });
  return { page, context };
}
async function state(page) { return page.evaluate(() => window.__ch34.state); }
async function shot(page, name) { await page.screenshot({ path: `tools/shots/ch34-${name}.png` }); }
async function choose(page, id) {
  const text = await page.evaluate(id => window.__ch34.choices.find(option => option.id === id)?.text, id);
  assert.ok(text, `当前没有选项 ${id}`);
  await page.getByRole('button', { name: text, exact: true }).click();
}
async function advanceTo(page, step) {
  for (let count = 0; count < 120; count++) {
    if (await page.evaluate(id => window.__ch34.step === id, step)) return;
    const selectors = ['.dialogue:not([hidden]) .dialogue__panel', '.caption--inner.is-visible:not([hidden])', '.phone-overlay:not([hidden]) .phone__close', '.art-view:not([hidden]) .art-view__close', '.intertitle:not([hidden]) .intertitle__skip:not([hidden])', '.lite-cutscene:not([hidden]) .lite-cutscene__skip:not([hidden])', '.lite-world:not(.is-blocked) .lite-world__onward:not([hidden])'];
    let clicked = false;
    for (const selector of selectors) {
      const element = page.locator(selector);
      if (await element.isVisible()) { await element.click(); clicked = true; break; }
    }
    if (!clicked) {
      if (await page.locator('.choices:not([hidden])').isVisible()) throw new Error(`未处理选项，目标 ${step}，当前 ${await page.evaluate(() => window.__ch34.step)}`);
      const current = await page.evaluate(() => window.__ch34.step);
      await page.waitForFunction(value => window.__ch34.step !== value, current, { timeout: 12000 });
    }
  }
  throw new Error(`未到达 ${step}`);
}
async function waitEnding(page) {
  for (let count = 0; count < 30; count++) {
    if (await page.locator('.chapter-end:not([hidden])').isVisible()) return;
    for (const selector of ['.caption--inner.is-visible:not([hidden])', '.dialogue:not([hidden]) .dialogue__panel', '.intertitle:not([hidden]) .intertitle__skip:not([hidden])']) {
      if (await page.locator(selector).isVisible()) { await page.locator(selector).click(); break; }
    }
  }
  await page.locator('.chapter-end:not([hidden])').waitFor();
}
try {
  const run = await open('C1', { picked: true, trust: 2, noticedTyper: true, postChoice: 'explain', pointedOut: true });
  const p = run.page;
  await advanceTo(p, 'c1-post');
  await p.waitForFunction(() => document.querySelector('.phone__post-stats')?.textContent === '浏览 48200 · 评论 1360');
  await advanceTo(p, 'c1-reply');
  await choose(p, 'c1-stop-spreading');
  await advanceTo(p, 'c2-seat'); await choose(p, 'seat-beside');
  await advanceTo(p, 'c3-response'); await shot(p, 'office'); await choose(p, 'c3-ask-her');
  await advanceTo(p, 'c4-father-question'); await choose(p, 'c4-father-teacher');
  await advanceTo(p, 'c4-response'); await choose(p, 'c4-respect');
  assert.equal((await state(p)).evidence, false);
  await advanceTo(p, 'c5-find-path');
  assert.equal((await state(p)).evidence, true);
  assert.equal((await state(p)).fatherKnows, false);
  await choose(p, 'recognize');
  for (const id of ['student-1', 'student-2', 'student-3']) {
    await choose(p, id); await advanceTo(p, 'c5-recognize');
  }
  assert.equal((await state(p)).wrongAsks, 3);
  assert.equal((await state(p)).harm, 26);
  await choose(p, 'student-4'); await advanceTo(p, 'c5-find-path'); await choose(p, 'c5-proceed');
  await advanceTo(p, 'd2-round-1'); await choose(p, 'd2-r1-fact');
  await advanceTo(p, 'd2-round-2'); await choose(p, 'd2-r2-fact');
  await p.locator('.art-view:not([hidden]) img').waitFor();
  assert.equal(await p.locator('.art-view img').getAttribute('data-asset-id'), 'prop_pharmacy_receipt');
  await shot(p, 'receipt');
  await advanceTo(p, 'd2-round-3'); await choose(p, 'd2-r3-company');
  await advanceTo(p, 'd3-deleted-post');
  assert.equal(await p.locator('.phone__post-placeholder').textContent(), '该内容已删除');
  await advanceTo(p, 'd4-team-phrase'); await choose(p, 'd4-team-act');
  await p.locator('.crystal-game__button').click();
  await p.keyboard.down('Space');
  await p.waitForFunction(() => document.querySelector('.crystal-game')?.dataset.mode === 'phase2', null, { timeout: 45000 });
  await shot(p, 'crystal-team');
  await p.waitForFunction(() => document.querySelector('.crystal-game')?.dataset.mode === 'ended', null, { timeout: 20000 });
  await p.keyboard.up('Space');
  const before = (await state(p)).harm;
  await p.locator('.crystal-game__button').click();
  const result = await p.evaluate(() => window.__ch34.settlements[0]);
  assert.equal((await state(p)).harm, before + Math.min(result.hits, 8) - Math.min(Math.floor(result.kills / 5), 4));
  assert.ok(result.kills >= 20);
  await advanceTo(p, 'd6-team-response'); await choose(p, 'd6-team-speak'); await waitEnding(p);
  assert.equal((await state(p)).ending, 'best');
  assert.equal((await state(p)).apologized, true);
  assert.equal((await state(p)).helpedByAyuan, true);
  const history = await p.evaluate(() => window.__ch34.history);
  for (const id of ['C1','C2','C3','C4','C5','C6','D1','D2','D3','D4','D5','D6','E1']) assert.ok(history.includes(id), id);
  report.checks.push('真实界面 C1→D6 全链路、授权留证、三次错问、当面删帖、真实水晶双阶段与最好结局');
  await run.context.close();

  const bystander = await open('C2');
  await advanceTo(bystander.page, 'c2-seat'); await choose(bystander.page, 'seat-far');
  await advanceTo(bystander.page, 'c3-response'); await choose(bystander.page, 'c3-think');
  await choose(bystander.page, 'c3-skip-stairs'); await waitEnding(bystander.page);
  assert.equal((await state(bystander.page)).ending, 'bystander');
  assert.equal((await state(bystander.page)).visitedStairwell, false);
  await bystander.context.close(); report.checks.push('旁观三条件真实分流');

  const force = await open('D2', { yuanState: 'hostile', yuanScore: -1 }, true);
  await advanceTo(force.page, 'd2-round-1'); await choose(force.page, 'd2-r1-force');
  await waitEnding(force.page);
  assert.equal((await state(force.page)).ending, 'worst');
  assert.equal((await state(force.page)).harm, 35);
  assert.equal(await force.page.locator('.crystal-game').count(), 0);
  await shot(force.page, 'worst-mobile');
  await force.context.close(); report.checks.push('手机竖屏即时谈崩，无后续小游戏串线');

  const solo = await open('D5', { route: 'deleteOnly', postDeleted: true }, true);
  await solo.page.clock.install();
  await solo.page.locator('.crystal-game__button').click();
  for (let fail = 1; fail <= 5; fail++) {
    await solo.page.clock.runFor(18000);
    assert.equal(await solo.page.locator('.crystal-game').getAttribute('data-mode'), 'failed');
    assert.equal(await solo.page.locator('.crystal-game__skip').isVisible(), fail >= 5);
    if (fail < 5) await solo.page.locator('.crystal-game__button').click();
  }
  await solo.page.locator('.crystal-game__skip').click();
  await shot(solo.page, 'crystal-portrait');
  await solo.page.setViewportSize({ width: 844, height: 390 });
  await solo.page.clock.runFor(100);
  const bounds = await solo.page.locator('.crystal-game__controls').evaluate(el => ({ bottom: el.getBoundingClientRect().bottom, height: innerHeight }));
  assert.ok(bounds.bottom <= bounds.height - 48, JSON.stringify(bounds));
  await shot(solo.page, 'crystal-landscape');
  await solo.page.clock.runFor(14000);
  await solo.page.locator('.crystal-game__button').click();
  assert.equal((await state(solo.page)).stage1Tries, 5);
  assert.equal((await state(solo.page)).helpedByAyuan, false);
  await advanceTo(solo.page, 'd6-solo-response'); await choose(solo.page, 'd6-solo-tell-me'); await waitEnding(solo.page);
  assert.equal((await state(solo.page)).ending, 'middle');
  assert.equal((await state(solo.page)).soloRepair, true);
  await solo.context.close(); report.checks.push('真实失败五次、主动跳过、手机横竖安全区、独自补救结局（边界采用浏览器虚拟时钟）');
  assert.deepEqual(report.problems, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  writeFileSync('tools/shots/ch34-report.json', JSON.stringify(report, null, 2));
}

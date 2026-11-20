import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.V05_URL ?? 'http://127.0.0.1:5176/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? 'C:/Users/AnQi/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',
  headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const report = { checks: [], problems: [] };
async function open(scene, mobile = false, world = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 });
  const page = await context.newPage();
  page.on('pageerror', error => report.problems.push(error.message));
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) report.problems.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) report.problems.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${base}?${world ? '' : 'lite=1&'}scene=${scene}`, { waitUntil: 'networkidle' });
  await page.evaluate(async sceneId => {
    const { eventBus } = await import('/src/core/eventBus.ts');
    const { createEmptyChapterSave, saveChapterSave } = await import('/src/core/saveStore.ts');
    window.__ch2 = { state: null, scene: sceneId, settlements: [] };
    eventBus.on('state:changed', ({ state }) => { window.__ch2.state = state; });
    eventBus.on('scene:transition', ({ toSceneId }) => { window.__ch2.scene = toSceneId; });
    eventBus.on('ui:minigameEnd', result => window.__ch2.settlements.push(result));
    const save = createEmptyChapterSave({ sceneId });
    save.state.picked = true;
    save.state.trust = 2;
    saveChapterSave(save);
    eventBus.emit('ui:continueGame');
  }, scene);
  return { page, context };
}
async function readUntil(page, selector) {
  for (let i = 0; i < 80; i++) {
    if (await page.locator(selector).isVisible()) return;
    const dialogue = page.locator('.dialogue:not([hidden]) .dialogue__panel');
    const caption = page.locator('.caption--inner:not([hidden])');
    if (await dialogue.isVisible()) await dialogue.click();
    else if (await caption.isVisible()) await caption.click();
    else await page.waitForFunction(() => document.querySelector('.dialogue:not([hidden]), .caption--inner:not([hidden]), .choices:not([hidden]), .phone-overlay:not([hidden]), .bubble-game, .intertitle:not([hidden])'), null, { timeout: 10000 });
  }
  throw new Error(`未到达 ${selector}`);
}
async function choose(page, text) { await page.getByRole('button', { name: text, exact: true }).click(); }
async function state(page) { return page.evaluate(() => window.__ch2.state); }
async function shot(page, name) { await page.screenshot({ path: `tools/shots/ch2-${name}.png` }); }

try {
  const { page, context } = await open('S11');
  await readUntil(page, '.phone__post');
  assert.equal(await page.locator('.phone__post-stats').textContent(), '浏览 68 · 评论 3');
  await choose(page, '收起手机');
  await choose(page, '这是我们班的吧。');
  await readUntil(page, '.lite-world__action--interact');
  for (const label of ['经过靠窗的餐桌', '走过中间的队伍', '走近取餐窗口']) {
    await page.getByRole('button', { name: new RegExp(label) }).click();
  }
  assert.equal((await state(page)).canteenSeen, 3);
  await page.getByRole('button', { name: /三号窗口/ }).click();
  await readUntil(page, '.phone__post');
  assert.equal(await page.locator('.phone__post-stats').textContent(), '浏览 4820 · 评论 136');
  for (const id of ['s13-comment-a', 's13-comment-c']) {
    await page.locator(`[data-post-action="${id}"]`).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.caption--inner')).opacity === '1');
    assert.ok(await page.locator('.caption--inner').evaluate(element => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }));
    if (id === 's13-comment-a') await page.locator('.caption--inner').click();
  }
  assert.equal((await state(page)).harm, 23);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.phone-overlay')).opacity === '1');
  await shot(page, 'post-desktop');
  await choose(page, '收起手机');
  await readUntil(page, '.choices:not([hidden])');
  await choose(page, '发一条：“那天我俩都迟到，被拍惨了哈哈。”');
  await page.locator('.intertitle__skip').click();
  await page.locator('.chapter-end:not([hidden])').waitFor();
  assert.equal((await state(page)).ending, 'joined');
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('yitiaojietu.meta.v1')).achievements.includes('A5')));
  await choose(page, '回到食堂，再试一次');
  await page.locator('.lite-world__action--interact').waitFor();
  assert.equal((await state(page)).canteenSeen, 0);
  assert.equal((await state(page)).ending, null);
  assert.equal((await state(page)).pointedOut, true);
  report.checks.push('S11→S12→S13→玩笑结局、A5与真实食堂检查点回退');
  await context.close();

  const mobile = await open('S14', true);
  await choose(mobile.page, '回一句：“她那天脚崴了。”');
  await readUntil(mobile.page, '.choices:not([hidden])');
  await choose(mobile.page, '想说的话，我听着。不想说也没事。');
  await readUntil(mobile.page, '.choices:not([hidden])');
  await choose(mobile.page, '那天药店的小票还在吗？你愿意的话，我想留一份，之后需要时先问你。');
  assert.equal((await state(mobile.page)).evidence, false);
  await readUntil(mobile.page, '.bubble-game');
  assert.equal((await state(mobile.page)).evidence, true);
  await mobile.page.locator('.bubble-game__button').click();
  await mobile.page.keyboard.down('Space');
  await shot(mobile.page, 'bubble-portrait');
  await mobile.page.setViewportSize({ width: 844, height: 390 });
  const bounds = await mobile.page.locator('.bubble-game__field').evaluate(element => ({ bottom: element.getBoundingClientRect().bottom, height: innerHeight }));
  assert.ok(bounds.bottom <= bounds.height - 48);
  await mobile.page.waitForFunction(() => document.querySelector('.bubble-game')?.dataset.mode === 'finished', null, { timeout: 45000 });
  await mobile.page.keyboard.up('Space');
  await mobile.page.waitForFunction(() => getComputedStyle(document.querySelector('.bubble-game__button')).opacity === '1');
  await shot(mobile.page, 'bubble-landscape');
  const before = (await state(mobile.page)).harm;
  await mobile.page.locator('.bubble-game__button').click();
  await mobile.page.locator('.intertitle:not([hidden])').waitFor();
  const result = await mobile.page.evaluate(() => window.__ch2.settlements[0]);
  assert.equal((await state(mobile.page)).harm, before + Math.min(result.hits, 8) - Math.min(Math.floor(result.kills / 5), 4));
  assert.equal(await mobile.page.evaluate(() => window.__ch2.scene), 'C1');
  report.checks.push('解释→倾听→同意后留证→真实25秒小游戏→C1；竖横屏安全区与结算');
  await mobile.context.close();

  const waiting = await open('S14');
  await choose(waiting.page, '先不回，等热度过去。');
  await choose(waiting.page, '加她，说一声。');
  await readUntil(waiting.page, '.choices:not([hidden])');
  await choose(waiting.page, '（先不提小票的事）');
  await waiting.page.locator('.intertitle:not([hidden])').waitFor();
  assert.equal((await state(waiting.page)).addedHer, true);
  assert.equal((await state(waiting.page)).evidence, false);
  assert.equal(await waiting.page.locator('.bubble-game').count(), 0);
  await waiting.context.close();
  report.checks.push('等等→主动加她→不留证→C1，无小游戏串线');

  const world = await open('S12', false, true);
  await world.page.waitForFunction(() => window.__worldApp?.getSceneId() === 'S12' && window.__worldApp.getPlayerPosition().enabled);
  await world.page.waitForFunction(() => getComputedStyle(document.querySelector('.scene-fade')).opacity === '0');
  await shot(world.page, 'canteen-overview');
  for (const [x, z, count] of [[-3.5, 5.4, 1], [0, 2.4, 2], [2.1, -5.5, 3]]) {
    await world.page.evaluate(([x, z]) => window.__worldApp.teleport(x, z), [x, z]);
    await world.page.waitForFunction(count => window.__ch2.state.canteenSeen === count, count);
  }
  await world.page.evaluate(() => window.__worldApp.teleport(2.2, -6.65));
  await shot(world.page, 'canteen');
  await world.page.keyboard.press('e');
  await readUntil(world.page, '.phone__post');
  assert.equal(await world.page.evaluate(() => window.__ch2.scene), 'S13');
  await world.context.close();
  report.checks.push('食堂3D异步加载、真实区域检测与E键打饭进入S13');
  assert.deepEqual(report.problems, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  writeFileSync('tools/shots/ch2-report.json', JSON.stringify(report, null, 2));
}

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.V05_URL ?? 'http://127.0.0.1:5174/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? 'C:/Users/AnQi/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',
  headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const report = { checks: [], problems: [], screenshots: [] };
mkdirSync(new URL('./shots/', import.meta.url), { recursive: true });

async function pageFor(query = '', mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 });
  const page = await context.newPage();
  page.on('pageerror', error => report.problems.push(error.message));
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) report.problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('response', response => {
    if (response.status() >= 400) report.problems.push(`${response.status()}: ${response.url()}`);
  });
  await page.goto(`${base}${query}`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const { eventBus } = await import('/src/core/eventBus.ts');
    window.__v05 = { events: [], state: null };
    eventBus.on('state:changed', payload => { window.__v05.state = payload.state; });
    for (const name of ['scene:transition', 'ui:showIntertitle', 'ui:showChoices', 'ui:showDialogue', 'ui:showPhone', 'game:chapterEnd']) {
      eventBus.on(name, payload => window.__v05.events.push({ name, payload }));
    }
  });
  return { page, context };
}
async function shot(page, name) {
  const path = new URL(`./shots/v05-${name}.png`, import.meta.url);
  await page.screenshot({ path: path.pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  report.screenshots.push(path.href);
}
async function checkPhoto(mobile) {
  const { page, context } = await pageFor('?lite=1&scene=S9', mobile);
  await page.getByRole('button', { name: '看一眼。', exact: true }).click();
  await page.getByRole('button', { name: /开学第一天照片合集/ }).click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.phone-overlay')).opacity === '1');
  await page.locator('.phone__photo-stage img').evaluate(image => image.decode());
  const assertPhotoBounds = async () => {
    const bounds = await page.evaluate(() => {
      const image = document.querySelector('.phone__photo-stage img').getBoundingClientRect();
      const hotspot = document.querySelector('.phone__photo-hotspot').getBoundingClientRect();
      const like = document.querySelector('.phone__photo-modal .phone__photo-like').getBoundingClientRect();
      return { image: image.toJSON(), hotspot: hotspot.toJSON(), like: like.toJSON(), height: innerHeight };
    });
    assert.ok(bounds.hotspot.width >= 44 && bounds.hotspot.height >= 44);
    assert.ok(Math.abs(bounds.hotspot.x + bounds.hotspot.width / 2 - bounds.image.x - bounds.image.width * .3775) < 1);
    assert.ok(Math.abs(bounds.hotspot.y + bounds.hotspot.height / 2 - bounds.image.y - bounds.image.height * .535) < 1);
    assert.ok(bounds.like.bottom <= bounds.height - 48 && bounds.like.height >= 44);
  };
  await assertPhotoBounds();
  await shot(page, mobile ? 'photo-mobile' : 'photo-desktop');
  if (mobile) {
    await page.setViewportSize({ width: 844, height: 390 });
    await assertPhotoBounds();
    await shot(page, 'photo-landscape');
  }
  const hotspot = page.getByRole('button', { name: '看看台阶上的浅黄色背影' });
  await hotspot.click();
  await hotspot.click();
  assert.equal(await page.evaluate(() => window.__v05.state.noticedPhoto), true);
  assert.equal(await page.evaluate(() => window.__v05.state.likedPhoto), false);
  const like = page.locator('.phone__photo-modal .phone__photo-like');
  await like.click();
  await like.evaluate(button => button.click());
  assert.equal(await page.evaluate(() => window.__v05.state.likedPhoto), true);
  assert.equal(await page.evaluate(() => window.__v05.state.log.filter(entry => entry.summary === '给迎新群的合照点了赞。').length), 1);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.phone__photo-modal').hidden);
  assert.equal(await page.locator('.phone__photo-thumbnail').evaluate(button => document.activeElement === button), true);
  await page.getByRole('button', { name: '收起手机', exact: true }).click();
  await page.locator('.intertitle:not([hidden])').waitFor();
  assert.equal(await page.locator('.intertitle__line').textContent(), '入学第三天，你记住了室友的名字。');
  await page.locator('.intertitle__skip').click();
  await page.waitForFunction(() => document.querySelector('.intertitle').hidden);
  assert.equal(await page.evaluate(() => window.__v05.events.filter(event => event.name === 'game:chapterEnd').length), 1);
  await context.close();
  report.checks.push(`S9 合照解码、热点、点赞幂等、返回焦点、48px安全区及S10跳过：${mobile ? '竖屏与横屏' : '桌面'}`);
}

async function checkAssetsAndVignette() {
  const { page, context } = await pageFor('?lite=1&scene=S9');
  const result = await page.evaluate(async () => {
    const { ASSET_MANIFEST } = await import('/src/data/assetManifest.ts');
    const { assetSource } = await import('/src/ui/assetImage.ts');
    const decoded = await Promise.all(Object.keys(ASSET_MANIFEST).map(async id => {
      const image = new Image();
      image.src = assetSource(id);
      await image.decode();
      return image.naturalWidth > 0;
    }));
    const { eventBus } = await import('/src/core/eventBus.ts');
    const { createInitialStoryState } = await import('/src/core/state.ts');
    eventBus.emit('state:changed', { sceneId: 'S9', role: 'bystander', state: { ...createInitialStoryState(), harm: 75 }, changedKeys: ['harm'] });
    const layer = document.querySelector('.vignette');
    const world = document.querySelector('.lite-world');
    return { decoded, opacity: layer.style.opacity, sameHost: layer.parentElement === world.parentElement, above: +getComputedStyle(layer).zIndex > +getComputedStyle(world).zIndex, missingRequests: performance.getEntriesByType('resource').filter(entry => /\/art\/.*\.png/.test(entry.name)).length };
  });
  assert.equal(result.decoded.length, 22);
  assert.ok(result.decoded.every(Boolean));
  assert.equal(result.missingRequests, 0);
  assert.equal(result.opacity, '0.78');
  assert.ok(result.sameHost && result.above);
  await context.close();
  report.checks.push('22 项插画真实解码、缺图零请求、轻量世界暗角层级');
}

async function checkWorld() {
  const { page, context } = await pageFor('');
  const models = [];
  page.on('request', request => { if (/\.glb(?:\?|$)/.test(request.url())) models.push(request.url()); });
  await page.locator('#btn-start').click();
  await page.locator('.controls-guide__enter').click();
  await page.waitForFunction(() => window.__worldApp?.getSceneId() === 'S1');
  await page.locator('.caption--inner:not([hidden])').waitFor();
  await page.locator('.caption--inner').click();
  await page.waitForFunction(() => window.__worldApp.getPlayerPosition().enabled, null, { timeout: 20000 });
  assert.equal(models.length, 0);
  await page.evaluate(() => window.__worldApp.interact('phone'));
  await page.locator('.phone__lock-time').waitFor();
  assert.equal(await page.locator('.phone__lock-time').textContent(), '8:40');
  await context.close();
  report.checks.push('开始页、操作指南、S1 起床与手机推进，S1 零 GLB 请求');

  const scene = await pageFor('?scene=S8');
  await scene.page.waitForFunction(() => window.__worldApp?.getActorPosition('campusPhotographer') !== null);
  await scene.page.locator('.dialogue.is-ready .dialogue__panel').click();
  await scene.page.getByRole('button', { name: '我陪你走一段。', exact: true }).click();
  await scene.page.evaluate(() => window.__worldApp.teleport(2.5, -7, -48));
  await scene.page.waitForFunction(() => window.__v05.state?.noticedPhoneBehind === true, null, { timeout: 15000 });
  await shot(scene.page, 's8-photographer');
  await scene.context.close();
  report.checks.push('S8 路人 3D 实景与两秒注视触发');

  const mobile = await pageFor('?scene=S1', true);
  await mobile.page.waitForFunction(() => window.__worldApp?.getSceneId() === 'S1');
  const ratio = await mobile.page.locator('#app canvas').evaluate(canvas => canvas.width / canvas.clientWidth);
  assert.ok(ratio <= 1.5 && ratio > 0);
  await mobile.context.close();
  report.checks.push('手机 DPR 3 环境的 3D 实际渲染比例不超过 1.5');
}

try {
  await checkPhoto(false);
  await checkPhoto(true);
  const { page, context } = await pageFor('?lite=1&scene=S2');
  assert.equal(await page.locator('.phone__lock-time').textContent(), '8:40');
  await page.getByRole('button', { name: '轻点进入手机主界面' }).click();
  await page.getByRole('button', { name: /妈妈/ }).click();
  await page.getByRole('button', { name: '起了起了。', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__v05.state.momReply), '起了起了。');
  await page.getByRole('button', { name: '收起手机', exact: true }).click();
  await context.close();
  report.checks.push('S2 8:40、解锁、回复妈妈及收起手机');
  await checkAssetsAndVignette();
  await checkWorld();
  assert.deepEqual(report.problems, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  writeFileSync(new URL('./shots/v05-report.json', import.meta.url), JSON.stringify(report, null, 2));
}

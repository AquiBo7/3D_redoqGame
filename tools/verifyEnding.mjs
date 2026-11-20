import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

// 终版五结局复盘、成就、章节选择与结局草稿箱的浏览器验收。
// 存档注入只作起点，页面渲染与成就解锁走真实 DOM / localStorage。
const base = process.env.V05_URL ?? 'http://127.0.0.1:5177/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? 'C:/Users/AnQi/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',
  headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const report = { checks: [], problems: [] };
const META_KEY = 'yitiaojietu.meta.v1';

function watch(page) {
  page.on('pageerror', (error) => report.problems.push(error.message));
  page.on('console', (message) => { if (['warning', 'error'].includes(message.type())) report.problems.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400) report.problems.push(`${response.status()} ${response.url()}`); });
}

async function openContext() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  watch(page);
  await page.goto(`${base}?lite=1`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const { eventBus } = await import('/src/core/eventBus.ts');
    window.__vEnd = { transitions: [], meta: null, newlyUnlocked: [] };
    eventBus.on('scene:transition', ({ toSceneId }) => window.__vEnd.transitions.push(toSceneId));
    eventBus.on('meta:changed', ({ meta, newlyUnlocked }) => { window.__vEnd.meta = meta; window.__vEnd.newlyUnlocked = newlyUnlocked; });
  });
  return { page, context };
}

async function seedEnding(page, ending, extra = {}) {
  await page.evaluate(async ({ ending, extra }) => {
    const { eventBus } = await import('/src/core/eventBus.ts');
    const { createEmptyChapterSave, saveChapterSave } = await import('/src/core/saveStore.ts');
    const save = createEmptyChapterSave({ sceneId: 'E1', completed: true });
    save.state.ending = ending;
    Object.assign(save.state, extra);
    saveChapterSave(save);
    eventBus.emit('ui:continueGame');
  }, { ending, extra });
  await page.locator('.chapter-end:not([hidden])').waitFor({ timeout: 15000 });
}

const ENDINGS = {
  best: { title: '完整的那一天', cg: 'cg_ending_best_drawing', retry: null, achievement: 'A1' },
  middle: { title: '未完成的画', cg: 'cg_ending_middle_sketch', retry: null, achievement: 'A2' },
  worst: { title: '另一种围观', cg: 'cg_ending_bystander_seat', retry: '回到侧楼梯平台，再试一次', achievement: 'A3' },
  bystander: { title: '沉默的席位', cg: 'cg_ending_bystander_seat', retry: '回到第二天，再试一次', achievement: 'A4' },
  joined: { title: '随手一笑', cg: 'cg_s11_post_crop', retry: '回到食堂，再试一次', achievement: 'A5' },
};

async function readMeta(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : { unlockedEndings: [], achievements: [] };
  }, META_KEY);
}

try {
  // —— 五结局页面渲染 + 成就累计（同一 context 保留 localStorage） ——
  const acc = await openContext();
  for (const ending of ['joined', 'bystander', 'worst', 'middle', 'best']) {
    const expected = ENDINGS[ending];
    await seedEnding(acc.page, ending, { trust: ending === 'best' ? 7 : 2 });
    assert.equal(await acc.page.locator('.chapter-end__title').textContent(), expected.title);
    assert.equal(await acc.page.locator('.chapter-end__figure img').getAttribute('data-asset-id'), expected.cg);
    assert.equal(await acc.page.locator('.chapter-end__draft').count(), 4);
    assert.equal(await acc.page.locator('.chapter-end__action').count(), 5);
    if (expected.retry) assert.equal(await acc.page.getByRole('button', { name: expected.retry, exact: true }).count(), 1);
    else assert.equal(await acc.page.locator('.chapter-end__retry').count(), 0);
    const meta = await readMeta(acc.page);
    assert.ok(meta.achievements.includes(expected.achievement), `${ending} 应解锁 ${expected.achievement}`);
    report.checks.push(`结局页与成就 ${expected.achievement}：${expected.title}`);
  }
  const finalMeta = await readMeta(acc.page);
  assert.equal(finalMeta.achievements.length, 6);
  assert.equal(finalMeta.achievements[finalMeta.achievements.length - 1], 'A6');
  assert.ok(['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].every((id) => finalMeta.achievements.includes(id)));
  assert.ok(['best', 'bystander', 'joined', 'middle', 'worst'].every((id) => finalMeta.unlockedEndings.includes(id)));
  report.checks.push('五个结局全部解锁，成就 A1–A6 齐备且 A6 最后');

  // 成就面板展示六项无锁定
  await acc.page.getByRole('button', { name: '查看成就', exact: true }).click();
  await acc.page.locator('.achievements:not([hidden])').waitFor();
  assert.equal(await acc.page.locator('.achievements__list .achievements__entry').count(), 6);
  assert.equal(await acc.page.locator('.achievements__list .achievements__entry--locked').count(), 0);
  await acc.page.locator('.achievements__close').click();
  report.checks.push('成就面板渲染六项且全部解锁');
  await acc.context.close();

  // —— 最好结局低信任：未赠画用中间线稿 CG，草稿锁 2 项，结局草稿箱可回看 ——
  const low = await openContext();
  await seedEnding(low.page, 'best', { trust: 4 });
  assert.equal(await low.page.locator('.chapter-end__title').textContent(), '完整的那一天');
  assert.equal(await low.page.locator('.chapter-end__figure img').getAttribute('data-asset-id'), 'cg_ending_middle_sketch');
  assert.equal(await low.page.locator('.chapter-end__draft--locked').count(), 2);
  await low.page.getByRole('button', { name: '手机 · 草稿箱', exact: true }).click();
  await low.page.locator('.phone-overlay:not([hidden])').waitFor();
  assert.equal(await low.page.locator('.phone__profile-name').textContent(), '2026级新生');
  assert.equal(await low.page.locator('.phone__draft').count(), 4);
  assert.equal(await low.page.locator('.phone__draft--locked').count(), 2);
  await low.page.getByRole('button', { name: '收起手机', exact: true }).click();
  await low.page.locator('.chapter-end:not([hidden])').waitFor();
  assert.equal(await low.page.locator('.chapter-end__title').textContent(), '完整的那一天');
  const lowMeta = await readMeta(low.page);
  assert.deepEqual(lowMeta.achievements, ['A1']);
  report.checks.push('低信任最好结局线稿 CG、草稿箱四稿两锁、收起后回看且不复记成就');
  await low.context.close();

  // —— 章节选择：五项、第五章预览进入 E1 且不解锁成就 ——
  const sel = await openContext();
  await sel.page.locator('#btn-chapters').click();
  await sel.page.locator('.chapter-select:not([hidden])').waitFor();
  assert.equal(await sel.page.locator('.chapter-select__item').count(), 5);
  assert.deepEqual(await sel.page.locator('.chapter-select__item').evaluateAll((nodes) => nodes.map((node) => node.dataset.chapterId)), ['ch1', 'ch2', 'ch3', 'ch4', 'ch5']);
  await sel.page.locator('[data-chapter-id="ch5"]').click();
  await sel.page.locator('.controls-guide').waitFor();
  await sel.page.locator('.controls-guide__enter').click();
  await sel.page.waitForFunction(() => window.__vEnd.transitions.includes('E1'), null, { timeout: 10000 });
  const ch5Meta = await readMeta(sel.page);
  assert.equal(ch5Meta.achievements.length, 0);
  report.checks.push('章节选择五项，第五章预览进入 E1 且不解锁成就');
  await sel.context.close();

  const ch2 = await openContext();
  await ch2.page.locator('#btn-chapters').click();
  await ch2.page.locator('[data-chapter-id="ch2"]').click();
  await ch2.page.locator('.controls-guide').waitFor();
  await ch2.page.locator('.controls-guide__enter').click();
  await ch2.page.waitForFunction(() => window.__vEnd.transitions.includes('S11'), null, { timeout: 10000 });
  report.checks.push('章节选择第二章进入 S11');
  await ch2.context.close();

  assert.deepEqual(report.problems, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  writeFileSync('tools/shots/ending-report.json', JSON.stringify(report, null, 2));
}

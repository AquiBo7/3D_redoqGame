// tools/verifyStep11.mjs —— Step 11 全链路无头验收
// 运行前先启动 dev server：npm run dev -- --port 5173 --strictPort
//   node tools/verifyStep11.mjs
// 覆盖：① 3D 正式流程 S1→S9 与章节结束重开；② S2/S4/S7 断点续玩；③ ?lite=1 全程 2D 降级；
//       ④ ?phonePreview=1 面板切换与回传参数；⑤ 移动端像素比 / 安全区 / 静音与调试面板不重叠。

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT_DIR = 'tools/shots';
const BASE_URL = 'http://localhost:5173/';
const CHROME_PATH =
  'C:/Users/AnQi/AppData/Local/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-win64/chrome-headless-shell.exe';
const SAVE_KEY = 'yitiaojietu.ch1.save.v1';
const MUTE_KEY = 'yitiaojietu:muted';

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});

let failed = false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function report(name, problems) {
  if (problems.length > 0) {
    failed = true;
    console.log(`${name}: FAIL`);
    for (const problem of problems) console.log(`  ${problem}`);
  } else {
    console.log(`${name}: PASS`);
  }
}

function watch(page) {
  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      problems.push(`console:${msg.type()} ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror ${error.message}`));
  page.on('requestfailed', (request) => {
    if (request.url().includes('favicon')) return;
    problems.push(`requestfailed ${request.url()} ${request.failure()?.errorText ?? ''}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().includes('favicon')) {
      problems.push(`http${response.status()} ${response.url()}`);
    }
  });
  return problems;
}

async function clickIfVisible(page, selector, timeout = 1500) {
  const locator = page.locator(selector).first();
  try {
    if ((await locator.count()) === 0) return false;
    if (!(await locator.isVisible())) return false;
    await locator.click({ timeout });
    return true;
  } catch {
    return false;
  }
}

async function readState(page) {
  try {
    return await page.evaluate(() => ({
      chapterEnd: Boolean(document.querySelector('.chapter-end:not([hidden])')),
      sceneId: window.__worldApp?.getSceneId?.() ?? null,
      liteTitle: document.querySelector('.lite-world:not([hidden]) .lite-world__title')?.textContent ?? null,
      cutscene: Boolean(document.querySelector('.lite-cutscene:not([hidden])')),
      blocked: document.querySelector('.lite-world')?.classList.contains('is-blocked') ?? false,
    }));
  } catch {
    return { chapterEnd: false, sceneId: null, liteTitle: null, cutscene: false, blocked: false };
  }
}

async function waitForFade(page, timeout = 20000) {
  await page.waitForFunction(
    () => {
      const fade = document.querySelector('.scene-fade');
      if (!fade) return true;
      return Number.parseFloat(getComputedStyle(fade).opacity) < 0.05;
    },
    { timeout },
  );
}

async function start3D(page, url = BASE_URL) {
  await page.goto(url, { waitUntil: 'load' });
  await page.click('#btn-start');
  await page.waitForFunction(() => Boolean(window.__worldApp), { timeout: 60000 });
  await waitForFade(page);
}

async function drive3D(page, options = {}) {
  const maxMs = options.maxMs ?? 120000;
  const stopAt = options.stopAt ?? null;
  const prefix = options.prefix ?? 'step11-3d';
  const seen = new Set();
  const start = Date.now();

  while (Date.now() - start < maxMs) {
    const state = await readState(page);

    if (state.chapterEnd) {
      if (options.shotEnd !== false) await page.screenshot({ path: `${OUT_DIR}/${prefix}-end.png` });
      return state;
    }
    if (state.sceneId && !seen.has(state.sceneId)) {
      seen.add(state.sceneId);
      if (options.shots !== false) {
        await page.screenshot({ path: `${OUT_DIR}/${prefix}-${state.sceneId}.png` });
      }
    }
    if (stopAt && state.sceneId === stopAt) return state;

    if (state.sceneId === 'S1') await page.evaluate(() => window.__worldApp?.interact?.('phone'));
    if (state.sceneId === 'S4') await page.evaluate(() => window.__worldApp?.enterZone?.('stairs'));
    if (state.sceneId === 'S5') await page.evaluate(() => window.__worldApp?.enterZone?.('school-gate'));
    if (state.sceneId === 'S8') {
      await page.evaluate(() => window.__worldApp?.enterZone?.('building-entrance'));
    }

    if (await clickIfVisible(page, '.cutscene-skip:not([hidden])')) {
      await sleep(250);
      continue;
    }
    if (
      await clickIfVisible(
        page,
        '.phone-vibrate:not([hidden]) .phone-vibrate__button:not(.phone-vibrate__button--primary)',
      )
    ) {
      await sleep(250);
      continue;
    }
    if (await clickIfVisible(page, '.phone-overlay:not([hidden]) .phone__close')) {
      await sleep(250);
      continue;
    }
    if (await clickIfVisible(page, '.dialogue:not([hidden]) .dialogue__panel')) {
      await sleep(200);
      continue;
    }
    if (await clickIfVisible(page, '.choices:not([hidden]) .choices__option')) {
      await sleep(300);
      continue;
    }
    if (await clickIfVisible(page, '.caption--inner:not([hidden])')) {
      await sleep(250);
      continue;
    }
    await sleep(300);
  }

  throw new Error('3D 流程超时');
}

async function driveLite(page, options = {}) {
  const maxMs = options.maxMs ?? 120000;
  const prefix = options.prefix ?? 'step11-lite';
  const seenTitles = new Set();
  let shotIndex = 0;
  const start = Date.now();

  while (Date.now() - start < maxMs) {
    const state = await readState(page);
    if (state.chapterEnd) {
      await page.screenshot({ path: `${OUT_DIR}/${prefix}-end.png` });
      return state;
    }
    if (state.liteTitle && !seenTitles.has(state.liteTitle)) {
      seenTitles.add(state.liteTitle);
      shotIndex += 1;
      await page.screenshot({ path: `${OUT_DIR}/${prefix}-${shotIndex}-${state.liteTitle}.png` });
      console.log(`  lite 场景：${state.liteTitle}`);
    }

    if (await clickIfVisible(page, '.lite-cutscene:not([hidden]) .lite-cutscene__skip:not([hidden])')) {
      await sleep(250);
      continue;
    }
    if (await clickIfVisible(page, '.phone-overlay:not([hidden]) .phone__close')) {
      await sleep(250);
      continue;
    }
    if (
      await clickIfVisible(
        page,
        '.phone-vibrate:not([hidden]) .phone-vibrate__button:not(.phone-vibrate__button--primary)',
      )
    ) {
      await sleep(250);
      continue;
    }
    if (await clickIfVisible(page, '.dialogue:not([hidden]) .dialogue__panel')) {
      await sleep(200);
      continue;
    }
    if (await clickIfVisible(page, '.choices:not([hidden]) .choices__option')) {
      await sleep(300);
      continue;
    }
    if (await clickIfVisible(page, '.caption--inner:not([hidden])')) {
      await sleep(250);
      continue;
    }
    if (!state.cutscene && !state.blocked) {
      if (await clickIfVisible(page, '.lite-world__onward:not([hidden])')) {
        await sleep(250);
        continue;
      }
      if (await clickIfVisible(page, '.lite-world:not(.is-blocked) .lite-world__action')) {
        await sleep(300);
        continue;
      }
    }
    await sleep(250);
  }

  throw new Error('2D 降级流程超时');
}

function saveOf(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, SAVE_KEY);
}

/* ---------------- ① 正式 3D 模式：S1 → S9 + 结束页重开 ---------------- */
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const problems = watch(page);
  try {
    await start3D(page);
    // 先开启静音，验证重开后静音设置不被清空
    await page.waitForSelector('.mute-toggle', { timeout: 10000 });
    await page.click('.mute-toggle');
    const mutedBefore = await page.evaluate((key) => localStorage.getItem(key), MUTE_KEY);

    const endState = await drive3D(page, { prefix: 'step11-3d' });
    if (!endState.chapterEnd) problems.push('未到达章节结束页');

    await page.waitForSelector('.chapter-end__restart', { timeout: 10000 });
    await page.click('.chapter-end__restart');
    await page.waitForFunction(
      () => window.__worldApp?.getSceneId?.() === 'S1',
      { timeout: 30000 },
    );
    await waitForFade(page);
    await page.waitForTimeout(800);

    const after = await page.evaluate(
      (keys) => ({
        sceneId: window.__worldApp?.getSceneId?.() ?? null,
        chapterEndVisible: Boolean(document.querySelector('.chapter-end:not([hidden])')),
        muted: document.querySelector('.mute-toggle')?.classList.contains('is-muted') ?? null,
        mutedStored: localStorage.getItem(keys.mute),
        save: (() => {
          const raw = localStorage.getItem(keys.save);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          return {
            sceneId: parsed.sceneId,
            logLength: parsed.state.log.length,
            trust: parsed.state.trust,
            phoneIgnored: parsed.state.phoneIgnored,
          };
        })(),
        cutscene: Boolean(document.querySelector('.lite-cutscene:not([hidden])')),
      }),
      { save: SAVE_KEY, mute: MUTE_KEY },
    );

    if (after.sceneId !== 'S1') problems.push(`重开后场景未复位：${after.sceneId}`);
    if (after.chapterEndVisible) problems.push('重开后章节结束页未隐藏');
    if (after.cutscene) problems.push('重开后残留过场层');
    if (mutedBefore !== '1') problems.push(`静音状态未写入：${mutedBefore}`);
    if (after.mutedStored !== '1' || after.muted !== true) {
      problems.push(`重开后静音设置丢失：stored=${after.mutedStored} class=${after.muted}`);
    }
    if (!after.save || after.save.sceneId !== 'S1') {
      problems.push(`重开后的存档未复位：${JSON.stringify(after.save)}`);
    } else if (after.save.logLength !== 1 || after.save.trust !== 0 || after.save.phoneIgnored !== 0) {
      problems.push(`重开后状态未清零：${JSON.stringify(after.save)}`);
    }
    await page.screenshot({ path: `${OUT_DIR}/step11-3d-restart.png` });
  } catch (error) {
    problems.push(`异常：${error.message}`);
  }
  report('① 3D 正式流程 S1→S9 + 结束重开', problems);
  await context.close();
}

/* ---------------- ② 断点续玩：S2 / S4 / S7 刷新后继续 ---------------- */
for (const target of ['S2', 'S4', 'S7']) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const problems = watch(page);
  try {
    await start3D(page);
    await drive3D(page, { stopAt: target, shots: false });
    // S4 挂载后会静默预热 S5 角色模型；留出完成时间再刷新，避免误报请求中断
    if (target === 'S4') await page.waitForTimeout(3500);
    const save = await saveOf(page);
    if (!save || save.sceneId !== target) {
      problems.push(`未在 ${target} 写入存档：${save?.sceneId ?? 'null'}`);
    }

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#btn-continue:not([hidden])', { timeout: 10000 });
    await page.click('#btn-continue');
    await page.waitForFunction(() => Boolean(window.__worldApp), { timeout: 60000 });
    await page.waitForFunction(
      (id) => window.__worldApp?.getSceneId?.() === id,
      target,
      { timeout: 60000 },
    );
    await waitForFade(page);
    await page.waitForTimeout(400);

    const resumed = await page.evaluate(() => ({
      sceneId: window.__worldApp?.getSceneId?.() ?? null,
      phone: Boolean(document.querySelector('.phone-overlay:not([hidden])')),
      dialogue: Boolean(document.querySelector('.dialogue:not([hidden])')),
      choices: Boolean(document.querySelector('.choices:not([hidden])')),
      fade: (() => {
        const el = document.querySelector('.scene-fade');
        return el ? Number.parseFloat(getComputedStyle(el).opacity) : 0;
      })(),
    }));
    if (resumed.sceneId !== target) problems.push(`续玩后场景错误：${resumed.sceneId}`);
    if (resumed.fade >= 0.05) problems.push(`续玩后黑幕未淡出：${resumed.fade}`);
    if (target === 'S2' && !resumed.phone) problems.push('续玩 S2 未恢复手机面板');
    if (target === 'S7' && !resumed.dialogue && !resumed.choices) {
      problems.push('续玩 S7 未恢复登记处对话 / 选项');
    }
    if (target === 'S4' && (resumed.phone || resumed.dialogue || resumed.choices)) {
      problems.push('续玩 S4 出现不应存在的阻塞界面');
    }
    await page.screenshot({ path: `${OUT_DIR}/step11-resume-${target}.png` });

    // 继续推进到下一场景，确认恢复后流程不卡死
    const next = { S2: 'S3', S4: 'S5', S7: 'S8' }[target];
    await drive3D(page, { stopAt: next, shots: false, maxMs: 60000 });
  } catch (error) {
    problems.push(`异常：${error.message}`);
  }
  report(`② 断点续玩 ${target}`, problems);
  await context.close();
}

/* ---------------- ③ ?lite=1 全程 2D 降级 + 结束重开 ---------------- */
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const problems = watch(page);
  try {
    await page.goto(`${BASE_URL}?lite=1`, { waitUntil: 'load' });
    await page.click('#btn-start');
    await page.waitForSelector('.lite-world:not([hidden]) .lite-world__title', { timeout: 15000 });
    const endState = await driveLite(page, { prefix: 'step11-lite' });
    if (!endState.chapterEnd) problems.push('降级模式未到达章节结束页');

    await page.click('.chapter-end__restart');
    await page.waitForSelector('.lite-world:not([hidden]) .lite-world__title', { timeout: 15000 });
    await page.waitForTimeout(600);
    const after = await page.evaluate(
      (key) => ({
        title: document.querySelector('.lite-world__title')?.textContent ?? null,
        chapterEndVisible: Boolean(document.querySelector('.chapter-end:not([hidden])')),
        save: (() => {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw).sceneId : null;
        })(),
        overlays: Boolean(
          document.querySelector('.phone-overlay:not([hidden]), .dialogue:not([hidden]), .choices:not([hidden])'),
        ),
      }),
      SAVE_KEY,
    );
    if (after.title !== '起床') problems.push(`降级重开未回到 S1：${after.title}`);
    if (after.chapterEndVisible) problems.push('降级重开后结束页未隐藏');
    if (after.save !== 'S1') problems.push(`降级重开存档错误：${after.save}`);
    if (after.overlays) problems.push('降级重开后残留阻塞界面');
    await page.screenshot({ path: `${OUT_DIR}/step11-lite-restart.png` });
  } catch (error) {
    problems.push(`异常：${error.message}`);
  }
  report('③ ?lite=1 全程 2D 降级', problems);
  await context.close();
}

/* ---------------- ④ ?phonePreview=1 面板与回传参数 ---------------- */
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const problems = watch(page);
  try {
    await page.goto(`${BASE_URL}?phonePreview=1`, { waitUntil: 'load' });
    await page.waitForSelector('.phone-overlay:not([hidden])', { timeout: 10000 });
    if (!(await page.locator('.phone-preview__tab').count())) problems.push('缺少顶部切换条');

    await page.click('.phone-preview__tab:has-text("S9 未读提示")');
    await page.waitForSelector('.phone__notice-text', { timeout: 5000 });
    const notice = await page.locator('.phone__notice-text').first().textContent();
    if (!notice || !notice.includes('未读')) problems.push(`S9 通知内容异常：${notice}`);

    await page.click('.phone-preview__tab:has-text("模拟 S4 震动")');
    await page.waitForSelector('.phone-vibrate:not([hidden])', { timeout: 5000 });
    await page.click('.phone-vibrate__button--primary');
    await page.waitForSelector('.vibration-message:not([hidden])', { timeout: 5000 });
    await page.click('.vibration-message__close');

    await page.click('.phone-preview__tab:has-text("S2 手机面板")');
    if (await page.locator('.phone__lockscreen').isVisible().catch(() => false)) {
      await page.click('.phone__lockscreen');
    }
    await page.waitForSelector('.phone__row:has-text("妈妈")', { timeout: 5000 });
    await page.click('.phone__row:has-text("妈妈")');
    await page.click('.phone__reply:has-text("起了起了。")');
    await page.waitForTimeout(300);

    const logs = await page.locator('.phone-preview__log-item').allTextContents();
    const joined = logs.join('\n');
    if (!joined.includes('street-vibration-1 · open')) problems.push('未打印震动 open 回传');
    if (!joined.includes('s2-phone · reply · mom-reply-rise')) {
      problems.push(`未打印回复回传：${joined}`);
    }
    await page.screenshot({ path: `${OUT_DIR}/step11-phone-preview.png` });
  } catch (error) {
    problems.push(`异常：${error.message}`);
  }
  report('④ ?phonePreview=1 手机 UI 调试入口', problems);
  await context.close();
}

/* ---------------- ⑤ 像素比 / 安全区 / 静音与调试面板 ---------------- */
{
  const problems = [];
  // 移动端（DPR=3）像素比上限 1.5
  const mobile = await browser.newContext({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobile.newPage();
  const mobileProblems = watch(mobilePage);
  try {
    await mobilePage.goto(`${BASE_URL}?scene=S1`, { waitUntil: 'load' });
    await mobilePage.waitForFunction(() => Boolean(window.__worldApp), { timeout: 60000 });
    await waitForFade(mobilePage);
    const ratio = await mobilePage.evaluate(() => {
      const canvas = document.querySelector('#app canvas');
      if (!canvas) return null;
      return canvas.width / Math.max(canvas.clientWidth, 1);
    });
    if (ratio === null || ratio > 1.51) problems.push(`移动端像素比超限：${ratio}`);
    await mobilePage.screenshot({ path: `${OUT_DIR}/step11-mobile-S1.png` });
  } catch (error) {
    problems.push(`异常：${error.message}`);
  }
  problems.push(...mobileProblems);
  await mobile.close();

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const layoutProblems = watch(page);
    try {
      await page.goto(`${BASE_URL}?lite=1&debug=1`, { waitUntil: 'load' });
      await page.click('#btn-start');
      await page.waitForSelector('.lite-world:not([hidden]) .lite-world__title', { timeout: 15000 });
      await page.click('.debug-toggle');
      await page.waitForSelector('.debug-panel:not([hidden])', { timeout: 5000 });
      await page.waitForTimeout(300);

      const layout = await page.evaluate(() => {
        const rect = (selector) => {
          const el = document.querySelector(selector);
          return el ? el.getBoundingClientRect().toJSON() : null;
        };
        const overlap = (a, b) =>
          Boolean(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
        const mute = rect('.mute-toggle');
        const debug = rect('.debug-panel');
        const toggle = rect('.debug-toggle');
        const root = document.querySelector('.lite-world');
        return {
          mute,
          debugOverlap: overlap(mute, debug) || overlap(mute, toggle),
          paddingBottom: root ? Number.parseFloat(getComputedStyle(root).paddingBottom) : 0,
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
        };
      });

      if (!layout.mute) problems.push(`${viewport.width}x${viewport.height} 缺少静音按钮`);
      else if (layout.mute.width < 44 || layout.mute.height < 44) {
        problems.push(`${viewport.width}x${viewport.height} 静音热区不足 44px`);
      }
      if (layout.debugOverlap) problems.push(`${viewport.width}x${viewport.height} 静音按钮与调试面板重叠`);
      if (layout.paddingBottom < 48) {
        problems.push(`${viewport.width}x${viewport.height} 底部安全区不足：${layout.paddingBottom}`);
      }
      if (layout.overflowX > 1) {
        problems.push(`${viewport.width}x${viewport.height} 出现横向滚动：${layout.overflowX}`);
      }
      await page.screenshot({ path: `${OUT_DIR}/step11-layout-${viewport.width}x${viewport.height}.png` });
    } catch (error) {
      problems.push(`异常（${viewport.width}x${viewport.height}）：${error.message}`);
    }
    problems.push(...layoutProblems);
    await context.close();
  }
  report('⑤ 像素比 / 安全区 / 静音与调试面板', problems);
}

await browser.close();
if (failed) {
  console.log('RESULT: FAIL');
  process.exit(1);
}
console.log('RESULT: PASS — 3D / 降级 / 手机调试 / 断点续玩 / 布局全部通过');
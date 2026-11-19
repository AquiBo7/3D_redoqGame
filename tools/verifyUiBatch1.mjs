// tools/verifyUiBatch1.mjs —— 第一批（UI 电影感重构）三视口无头验收
// 运行前先启动 dev server：npm run dev -- --port 5173 --strictPort
//   node tools/verifyUiBatch1.mjs
// 覆盖：开始页 / 致谢（Esc + 关闭按钮）/ S1 心声字幕 / 手机锁屏·主页·群聊·备忘录 /
//       S7 对话与选项 / S9 选项与章节结尾 / ?lite=1 纸纹卡片 / ?modelViewer=1 无颗粒层。
// 断言：本地字体命中（document.fonts.ready + 中文样本）、字体请求 ≤2、贴底内容 ≥48px 安全区、
//       按钮热区 ≥44px、短屏可滚动、控制台零报错零警告零 404。截图写入 tools/shots/。

import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT_DIR = 'tools/shots';
const BASE_URL = 'http://localhost:5173/';
const CHROME_PATH =
  'C:/Users/AnQi/AppData/Local/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-win64/chrome-headless-shell.exe';
const SAVE_KEY = 'yitiaojietu.ch1.save.v1';

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 720, dpr: 1, mobile: false },
  { name: 'landscape', width: 844, height: 390, dpr: 2, mobile: true },
  { name: 'portrait', width: 390, height: 844, dpr: 3, mobile: true },
];

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});

let failed = false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = [];

function check(scope, name, ok, detail = '') {
  report.push({ scope, name, ok, detail });
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function watch(page) {
  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`console:${msg.type()} ${msg.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror ${error.message}`));
  page.on('requestfailed', (request) => {
    if (request.url().includes('favicon')) return;
    problems.push(`requestfailed ${request.url()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().includes('favicon')) {
      problems.push(`http${response.status()} ${response.url()}`);
    }
  });
  return problems;
}

async function shot(page, viewport, label) {
  await sleep(450);
  await page.screenshot({ path: `${OUT_DIR}/ui-${viewport.name}-${label}.png` });
}

/** 元素底边距视口底部 ≥48px（刘海安全区在桌面/无头环境为 0） */
async function bottomClear(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const rect = el.getBoundingClientRect();
    return { found: true, clear: window.innerHeight - rect.bottom >= 47.5, gap: Math.round(window.innerHeight - rect.bottom) };
  }, selector);
}

async function minSize(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const rect = el.getBoundingClientRect();
    return { found: true, ok: rect.width >= 43.5 && rect.height >= 43.5, w: Math.round(rect.width), h: Math.round(rect.height) };
  }, selector);
}

async function waitVisible(page, selector, timeout = 30000) {
  await page.waitForSelector(selector, { state: 'visible', timeout });
}

async function waitFade(page) {
  await page.waitForFunction(
    () => {
      const fade = document.querySelector('.scene-fade');
      if (!fade) return true;
      return Number.parseFloat(getComputedStyle(fade).opacity) < 0.05;
    },
    { timeout: 30000 },
  );
}

/** 通用推进：点掉过场 / 对话 / 选项 / 字幕 / 手机，直到目标选择器可见 */
async function advanceUntil(page, targetSelector, timeout = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await page.locator(targetSelector).count()) > 0 && (await page.locator(targetSelector).first().isVisible())) return true;
    const clicked = await page.evaluate(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel);
        if (el && el.getBoundingClientRect().height > 0) {
          el.click();
          return true;
        }
        return false;
      };
      return (
        pick('.cutscene-skip:not([hidden])') ||
        pick('.dialogue:not([hidden]) .dialogue__panel') ||
        pick('.choices:not([hidden]) .choices__option') ||
        pick('.caption--inner:not([hidden])') ||
        pick('.phone-overlay:not([hidden]) .phone__close')
      );
    });
    await sleep(clicked ? 220 : 350);
  }
  return false;
}

/* ---------------- 每个视口执行同一组场景 ---------------- */
for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.dpr,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
  });
  const page = await context.newPage();
  const problems = watch(page);
  const fontRequests = new Set();
  page.on('request', (request) => {
    if (request.url().includes('/fonts/')) fontRequests.add(request.url().split('/').pop());
  });
  const scope = viewport.name;

  try {
    /* ① 开始页 + 字体 */
    await page.goto(BASE_URL, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const fonts = await page.evaluate(() => ({
      serif: document.fonts.check('600 24px "YT Serif"', '一条截图'),
      sans: document.fonts.check('400 16px "YT Sans"', '一条截图'),
      titleFamily: getComputedStyle(document.querySelector('.start-page__title')).fontFamily,
      grainVar: getComputedStyle(document.documentElement).getPropertyValue('--yt-grain').slice(0, 24),
    }));
    check(scope, 'Serif 中文字体命中', fonts.serif, fonts.titleFamily);
    check(scope, 'Sans 中文字体命中', fonts.sans);
    check(scope, '颗粒纹理变量已生成', fonts.grainVar.startsWith('url("data:image/png'));
    await sleep(400);
    await shot(page, viewport, '01-start');

    /* ② 致谢：Esc 与关闭按钮，且不开始游戏、不写存档 */
    await page.click('#btn-credits');
    await waitVisible(page, '.credits:not([hidden])');
    await shot(page, viewport, '02-credits');
    const closeSize = await minSize(page, '.credits__close');
    check(scope, '致谢关闭按钮 ≥44px', closeSize.found && closeSize.ok, JSON.stringify(closeSize));
    const sheetClear = await bottomClear(page, '.credits__sheet');
    check(scope, '致谢内容避开 48px 安全区', sheetClear.found && sheetClear.clear, `gap=${sheetClear.gap}`);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.credits', { state: 'hidden' });
    check(scope, 'Esc 关闭后停留在开始页', await page.locator('#start-page').isVisible());
    await page.click('#btn-credits');
    await waitVisible(page, '.credits:not([hidden])');
    await page.click('.credits__close');
    await page.waitForSelector('.credits', { state: 'hidden' });
    const untouched = await page.evaluate((key) => ({
      startVisible: !document.querySelector('#start-page').hidden,
      save: localStorage.getItem(key),
      world: Boolean(window.__worldApp),
    }), SAVE_KEY);
    check(scope, '致谢开关不开始游戏、不写存档', untouched.startVisible && untouched.save === null && !untouched.world);

    /* ③ S1：颗粒层级 + 心声字幕 */
    await page.click('#btn-start');
    await page.waitForFunction(() => Boolean(window.__worldApp), { timeout: 60000 });
    const layers = await page.evaluate(() => {
      const grain = document.querySelector('.film-grain');
      const fade = document.querySelector('.scene-fade');
      return {
        grainZ: grain ? Number(getComputedStyle(grain).zIndex) : -1,
        grainPointer: grain ? getComputedStyle(grain).pointerEvents : 'missing',
        fadeZ: fade ? Number(getComputedStyle(fade).zIndex) : -1,
      };
    });
    check(scope, '颗粒层在黑幕之下且不拦截指针', layers.grainZ === 1 && layers.fadeZ > layers.grainZ && layers.grainPointer === 'none', JSON.stringify(layers));
    const captionShown = await advanceUntil(page, '.caption--inner.is-visible', 40000);
    check(scope, 'S1 心声字幕出现', captionShown);
    if (captionShown) {
      await sleep(200);
      await shot(page, viewport, '03-caption');
    }
    await waitFade(page);

    /* ④ 手机：锁屏 → 主页 → 群聊 → 备忘录 */
    const phoneOpened = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 60000) {
        if (await page.locator('.phone-overlay:not([hidden])').isVisible().catch(() => false)) return true;
        const acted = await page.evaluate(() => {
          const vibrate = document.querySelector('.phone-vibrate:not([hidden]) .phone-vibrate__button--primary');
          if (vibrate) { vibrate.click(); return true; }
          const caption = document.querySelector('.caption--inner:not([hidden])');
          if (caption) { caption.click(); return true; }
          window.__worldApp?.interact?.('phone');
          return false;
        });
        await sleep(acted ? 300 : 500);
      }
      return false;
    })();
    check(scope, 'S1 手机面板可打开', phoneOpened);
    await waitVisible(page, '.phone-overlay:not([hidden])');
    await sleep(300);
    await shot(page, viewport, '04-phone-lock');
    const frameClear = await bottomClear(page, '.phone-frame');
    check(scope, '手机框避开 48px 安全区', frameClear.found && frameClear.clear, `gap=${frameClear.gap}`);
    if (await page.locator('.phone__lockscreen').isVisible().catch(() => false)) {
      await page.click('.phone__lockscreen');
    }
    await waitVisible(page, '.phone__home-title');
    await shot(page, viewport, '05-phone-home');
    await page.click('.phone__row:has-text("迎新群")');
    await waitVisible(page, '.phone__chat');
    await shot(page, viewport, '06-phone-chat');
    await page.click('.phone__back');
    const closeBtn = await minSize(page, '.phone__close');
    check(scope, '收起手机热区 ≥44px', closeBtn.found && closeBtn.ok);
    await page.click('.phone__close');

    /* ④b S2：备忘录页 */
    await page.goto(`${BASE_URL}?scene=S2`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await advanceUntil(page, '.phone-overlay:not([hidden])', 60000);
    await waitVisible(page, '.phone-overlay:not([hidden])');
    if (await page.locator('.phone__lockscreen').isVisible().catch(() => false)) {
      await page.click('.phone__lockscreen');
    }
    await page.click('.phone__row:has-text("新生攻略")');
    await waitVisible(page, '.phone__memo-list');
    await sleep(200);
    await shot(page, viewport, '07-phone-memo');
    await page.click('.phone__back');
    await page.click('.phone__close');

    /* ⑤ S7 对话与选项 */
    await page.goto(`${BASE_URL}?scene=S7`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const dialogueShown = await advanceUntil(page, '.dialogue:not([hidden])', 60000);
    check(scope, 'S7 对话框出现', dialogueShown);
    if (dialogueShown) {
      await page.evaluate(() => {
        const panel = document.querySelector('.dialogue__panel');
        if (panel) panel.scrollTop = panel.scrollHeight;
      });
      await sleep(300);
      await shot(page, viewport, '08-dialogue');
      const panelClear = await bottomClear(page, '.dialogue__panel');
      check(scope, '对话文字与点击区避开 48px 安全区', panelClear.found && panelClear.clear, `gap=${panelClear.gap}`);
      const panelBox = await page.evaluate(() => {
        const el = document.querySelector('.dialogue__panel');
        const rect = el.getBoundingClientRect();
        return { top: rect.top, scrollable: el.scrollHeight > el.clientHeight + 2, scrolled: el.scrollTop > 0 };
      });
      check(scope, '对话不顶出屏幕且长文可滚动', panelBox.top >= 0 && (!panelBox.scrollable || panelBox.scrolled), JSON.stringify(panelBox));
    }
    const choicesShown = await advanceUntil(page, '.choices:not([hidden])', 60000);
    check(scope, 'S7 选项出现', choicesShown);
    if (choicesShown) {
      await sleep(200);
      await shot(page, viewport, '09-choices');
      const optionSize = await minSize(page, '.choices__option');
      check(scope, '选项热区 ≥44px', optionSize.found && optionSize.ok);
      const scrolled = await page.evaluate(() => {
        const root = document.querySelector('.choices');
        const before = root.scrollTop;
        root.scrollTop = root.scrollHeight;
        const last = root.querySelector('.choices__option:last-child').getBoundingClientRect();
        return { canScroll: root.scrollHeight <= root.clientHeight + 2 || root.scrollTop > before, gap: window.innerHeight - last.bottom };
      });
      check(scope, '短屏选项可滚动且末项避开安全区', scrolled.canScroll && scrolled.gap >= 47.5, `gap=${Math.round(scrolled.gap)}`);
    }

    /* ⑥ S9 选项 → 章节结尾 → 致谢 */
    await page.goto(`${BASE_URL}?scene=S9`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await advanceUntil(page, '.chapter-end:not([hidden])', 60000);
    await waitVisible(page, '.chapter-end:not([hidden])');
    await sleep(700);
    await shot(page, viewport, '10-chapter-end');
    await page.click('.chapter-end__credits');
    await waitVisible(page, '.credits:not([hidden])');
    await shot(page, viewport, '11-end-credits');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.credits', { state: 'hidden' });
    check(scope, '结尾页致谢关闭后仍在结尾页', await page.locator('.chapter-end').isVisible());

    /* ⑦ 降级模式纸纹卡片 */
    await page.goto(`${BASE_URL}?lite=1`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.click('#btn-start');
    await waitVisible(page, '.lite-world:not([hidden]) .lite-world__title');
    await page.waitForSelector('.lite-cutscene', { state: 'hidden', timeout: 30000 });
    await sleep(400);
    await shot(page, viewport, '12-lite');
    const paper = await page.evaluate(() => ({
      panel: getComputedStyle(document.querySelector('.lite-world__panel')).backgroundImage.slice(0, 40),
      grain: Boolean(document.querySelector('.film-grain')),
    }));
    check(scope, '降级卡片使用程序化纸纹', paper.panel.startsWith('url("data:image/png'));

    /* ⑧ 模型检视台不受颗粒层影响 */
    await page.goto(`${BASE_URL}?modelViewer=1`, { waitUntil: 'load' });
    await sleep(2500);
    const viewer = await page.evaluate(() => ({
      grain: Boolean(document.querySelector('.film-grain')),
      uiHidden: getComputedStyle(document.querySelector('#ui-root')).display === 'none',
    }));
    check(scope, 'modelViewer 无颗粒层且隐藏 ui-root', !viewer.grain && viewer.uiHidden);

    check(scope, '控制台零报错 / 零警告 / 零 404', problems.length === 0, problems.slice(0, 6).join(' | '));
    check(scope, '首屏字体请求 ≤2 个文件', fontRequests.size <= 2, [...fontRequests].join(','));
  } catch (error) {
    failed = true;
    console.log(`FAIL [${scope}] 场景执行异常：${error.message}`);
    report.push({ scope, name: '场景执行异常', ok: false, detail: error.message });
    await shot(page, viewport, '99-error').catch(() => {});
  }

  await context.close();
}

await browser.close();
writeFileSync('tools/shots/ui-batch1-report.json', JSON.stringify(report, null, 2));
console.log(failed ? '\n第一批 UI 验收：存在失败项' : '\n第一批 UI 验收：全部通过');
process.exit(failed ? 1 : 0);

// tools/verifyFraming.mjs —— 自动断言 ?modelViewer=1 初始取景：
// 模型头顶投影必须落在顶栏底边之下、脚底投影必须落在底栏顶边之上（各留 ≥ 8px 余量）。
// 覆盖：横屏 1280×720 全部 5 位角色 + 竖屏 390×844 最短/最高两位。
// 运行前先启动 dev server：npm run dev -- --port 5173 --strictPort
// 任一角色遮挡即 exit 1。

import { chromium } from 'playwright-core';

const DEV_URL = 'http://localhost:5173/?modelViewer=1';
const CHROME_PATH =
  'C:/Users/AnQi/AppData/Local/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-win64/chrome-headless-shell.exe';
const MARGIN_PX = 8;

const cases = [
  { name: '横屏 1280×720', viewport: { width: 1280, height: 720 }, chars: ['linxia', 'father', 'ayuan', 'volunteer', 'protagonist'] },
  { name: '竖屏 390×844', viewport: { width: 390, height: 844 }, chars: ['linxia', 'father'] },
];

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});

let failed = false;

for (const testCase of cases) {
  const page = await browser.newPage({ viewport: testCase.viewport });
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[console:${msg.type()}] ${msg.text()}`);
      failed = true;
    }
  });
  page.on('pageerror', (error) => {
    console.log(`[pageerror] ${error.message}`);
    failed = true;
  });
  await page.goto(DEV_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__modelViewer), { timeout: 60000 });

  for (const id of testCase.chars) {
    await page.evaluate((modelId) => window.__modelViewer.select(modelId), id);
    await page.waitForFunction(
      () => {
        const loading = document.querySelector('.mv-loading');
        return loading ? loading.hidden : true;
      },
      { timeout: 60000 },
    );
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => window.__modelViewer.getFrameInfo());
    const headGap = info.headTopPx - info.topbarBottomPx;
    const feetGap = info.bottombarTopPx - info.feetBottomPx;
    const ok = headGap >= MARGIN_PX && feetGap >= MARGIN_PX;
    if (!ok) failed = true;
    console.log(
      `[${testCase.name}] ${id}: 头顶 ${info.headTopPx.toFixed(0)}px / 栏下 ${info.topbarBottomPx.toFixed(0)}px（余 ${headGap.toFixed(0)}px）；` +
        `脚底 ${info.feetBottomPx.toFixed(0)}px / 栏上 ${info.bottombarTopPx.toFixed(0)}px（余 ${feetGap.toFixed(0)}px）→ ${ok ? 'PASS' : 'FAIL'}`,
    );
  }
  await page.close();
}

await browser.close();
if (failed) {
  console.log('RESULT: FAIL');
  process.exit(1);
}
console.log('RESULT: PASS');

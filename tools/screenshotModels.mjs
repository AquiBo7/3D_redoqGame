// tools/screenshotModels.mjs —— 用 Playwright(headless Chromium) 打开 ?modelViewer=1 截图
// 用途：验证初始取景构图（头脚完整落在顶/底栏之间）与贴图质量。运行前先启动 dev server：
//   npm run dev -- --port 5173 --strictPort
//   node tools/screenshotModels.mjs [输出目录]
// 产物：<输出目录>/<角色>-frame.png（默认取景）/ -front.png（正脸）/ -back.png（背面）/ -side.png（侧面）

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT_DIR = process.argv[2] ?? 'tools/shots';
const DEV_URL = 'http://localhost:5173/?modelViewer=1';
const CHROME_PATH =
  'C:/Users/AnQi/AppData/Local/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-win64/chrome-headless-shell.exe';

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (msg) => console.log(`[console:${msg.type()}] ${msg.text()}`));
page.on('pageerror', (error) => console.log(`[pageerror] ${error.message}`));

await page.goto(DEV_URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => {
    const loading = document.querySelector('.mv-loading');
    return loading ? loading.hidden : true;
  },
  { timeout: 60000 },
);

const chars = ['linxia', 'father', 'ayuan', 'volunteer', 'protagonist'];
// 模型归正后正面朝 +Z：相机在 +Z（yaw=0）看到正脸，-Z（yaw=π）为背面，±X 为侧面
const views = [
  { name: 'front', yawDeg: 0 },
  { name: 'back', yawDeg: 180 },
  { name: 'side', yawDeg: 90 },
];

for (const id of chars) {
  await page.evaluate((modelId) => window.__modelViewer.select(modelId), id);
  await page.waitForFunction(
    () => {
      const loading = document.querySelector('.mv-loading');
      return loading ? loading.hidden : true;
    },
    { timeout: 60000 },
  );
  await page.waitForTimeout(400);
  // 默认自动取景：头脚应完整落在顶栏与底栏之间的可视带内
  await page.screenshot({ path: `${OUT_DIR}/${id}-frame.png` });
  console.log(`saved ${id}-frame.png`);
  for (const view of views) {
    await page.evaluate((deg) => window.__modelViewer.setCameraYaw((deg * Math.PI) / 180), view.yawDeg);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT_DIR}/${id}-${view.name}.png` });
    console.log(`saved ${id}-${view.name}.png`);
  }
}

await browser.close();
console.log('done');

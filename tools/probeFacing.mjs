// tools/probeFacing.mjs —— 用头部区域平均颜色判定角色正脸朝向（数据化验证，不依赖目测）
// 原理：正脸机位 → 头部中心采样为暖肤色（r 明显高于 b）；背面机位 → 深发色（r/g/b 均低）。
// 约定：模型归正后正面应朝 +Z，即相机在 +Z（yaw=0）看到正脸（r 高），在 -Z（yaw=π）看到后脑（r 低）。
// 运行前先启动 dev server：npm run dev -- --port 5173 --strictPort

import { chromium } from 'playwright-core';

const DEV_URL = 'http://localhost:5173/?modelViewer=1';
const CHROME_PATH =
  'C:/Users/AnQi/AppData/Local/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-win64/chrome-headless-shell.exe';

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') console.log(`[console:${msg.type()}] ${msg.text()}`);
});
await page.goto(DEV_URL, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__modelViewer), { timeout: 60000 });

let allPass = true;
for (const id of ['linxia', 'father', 'ayuan', 'volunteer', 'protagonist']) {
  await page.evaluate((modelId) => window.__modelViewer.select(modelId), id);
  await page.waitForFunction(
    () => {
      const loading = document.querySelector('.mv-loading');
      return loading ? loading.hidden : true;
    },
    { timeout: 60000 },
  );
  await page.waitForTimeout(400);
  // 停止骨骼动画并回到绑定姿势，排除动作摆姿对头部采样的干扰
  await page.evaluate(() => window.__modelViewer.stopAnimation());
  await page.waitForTimeout(300);

  const sample = async (deg) => {
    await page.evaluate((d) => window.__modelViewer.setCameraYaw((d * Math.PI) / 180), deg);
    await page.waitForTimeout(400);
    return page.evaluate(() => window.__modelViewer.sampleHeadColor());
  };

  const atPlusZ = await sample(0); // 相机在 +Z：归正后应看到正脸（肤色比发色在红绿通道更亮）
  const atMinusZ = await sample(180); // 相机在 -Z：应为后脑（深发色）
  const atPlusX = await sample(90); // 侧面
  // 红绿双通道判据：部分角色刘海会遮住鼻口采样区，单通道阈值易误判
  const pass = atPlusZ.r > atMinusZ.r + 8 && atPlusZ.g > atMinusZ.g + 5;
  if (!pass) allPass = false;
  console.log(
    `${id}: +Z(r=${atPlusZ.r.toFixed(0)},g=${atPlusZ.g.toFixed(0)},b=${atPlusZ.b.toFixed(0)}) ` +
      `-Z(r=${atMinusZ.r.toFixed(0)},g=${atMinusZ.g.toFixed(0)},b=${atMinusZ.b.toFixed(0)}) ` +
      `+X(r=${atPlusX.r.toFixed(0)},g=${atPlusX.g.toFixed(0)},b=${atPlusX.b.toFixed(0)}) ` +
      `Δr=${(atPlusZ.r - atMinusZ.r).toFixed(0)} Δg=${(atPlusZ.g - atMinusZ.g).toFixed(0)} → ${pass ? 'PASS(正面朝+Z)' : 'FAIL'}`,
  );
}

await browser.close();
if (!allPass) {
  console.log('RESULT: FAIL');
  process.exit(1);
}
console.log('RESULT: PASS — 5 位角色归正后正面均朝 +Z');

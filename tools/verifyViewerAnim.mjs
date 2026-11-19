// tools/verifyViewerAnim.mjs —— 无头验证林夏骨骼动画：动作列表、走路驱动骨骼、原地循环、控制台零告警
// 运行前先启动 dev server：npm run dev -- --port 5173 --strictPort

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const DEV_URL = 'http://localhost:5173/?modelViewer=1';
const OUT_DIR = 'tools/shots';
const CHROME_PATH =
  'C:/Users/AnQi/AppData/Local/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-win64/chrome-headless-shell.exe';
const EXPECTED = ['afraid', 'agree', 'greet_04', 'walk', 'wave_goodbye_02'];

mkdirSync(OUT_DIR, { recursive: true });

const problems = [];
const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    problems.push(`[console:${msg.type()}] ${msg.text()}`);
  }
});
page.on('pageerror', (error) => problems.push(`[pageerror] ${error.message}`));
page.on('requestfailed', (request) => {
  if (request.url().includes('favicon')) return;
  problems.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`);
});
page.on('response', (response) => {
  if (response.status() >= 400 && !response.url().includes('favicon')) {
    problems.push(`[http${response.status()}] ${response.url()}`);
  }
});

await page.goto(DEV_URL, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__modelViewer), { timeout: 60000 });
await page.evaluate(() => window.__modelViewer.select('linxia'));
await page.waitForFunction(
  () => {
    const loading = document.querySelector('.mv-loading');
    return loading ? loading.hidden : true;
  },
  { timeout: 60000 },
);
await page.waitForTimeout(500);

const animations = await page.evaluate(() => window.__modelViewer.getAnimations());
const sorted = [...animations].sort();
if (JSON.stringify(sorted) !== JSON.stringify(EXPECTED)) {
  problems.push(`动画列表不符：${JSON.stringify(sorted)}`);
}

// 多 primitive 挂载：2 个 SkinnedMesh 同骨骼图、关闭视锥剔除、投影/接收阴影、共享标记
const meshes = await page.evaluate(() => window.__modelViewer.getSkinnedMeshInfo());
if (meshes.length !== 2) problems.push(`SkinnedMesh 数量应为 2，实际 ${meshes.length}`);
const shoe = meshes.find((mesh) => mesh.material.includes('Shoe inner leather'));
if (!shoe) problems.push('未找到鞋内衬 SkinnedMesh（Shoe inner leather）');
for (const mesh of meshes) {
  if (mesh.frustumCulled) problems.push(`${mesh.material} 未关闭视锥剔除`);
  if (!mesh.castShadow || !mesh.receiveShadow) problems.push(`${mesh.material} 阴影开关未开启`);
  if (!mesh.geometryShared || !mesh.materialShared) problems.push(`${mesh.material} 缺少共享资源标记`);
  if (!mesh.sameBoneGraph) problems.push(`${mesh.material} 骨骼图与其他 primitive 不一致`);
  if (mesh.bones !== 41) problems.push(`${mesh.material} 骨骼数异常：${mesh.bones}`);
}
if (shoe && shoe.tris !== 152) problems.push(`鞋内衬面数异常：${shoe.tris}（期望 152）`);

const sampleBone = () => page.evaluate(() => window.__modelViewer.getBoneState('Hip'));

// 默认应自动播放走路：连续采样 Hip，位置/朝向必须随时间变化
const first = await sampleBone();
await page.waitForTimeout(450);
const second = await sampleBone();
const deltaQuat = first && second
  ? Math.max(
      Math.abs(first.quaternion[0] - second.quaternion[0]),
      Math.abs(first.quaternion[1] - second.quaternion[1]),
      Math.abs(first.quaternion[2] - second.quaternion[2]),
      Math.abs(first.quaternion[3] - second.quaternion[3]),
    )
  : 0;
if (!(deltaQuat > 1e-4)) problems.push(`走路未驱动骨骼：四元数最大差 ${deltaQuat}`);

// 原地循环：连续 3 秒内 Hip 本地 X/Y 漂移必须接近 0，Z（步态起伏）必须存在
let minX = Infinity;
let maxX = -Infinity;
let minY = Infinity;
let maxY = -Infinity;
let minZ = Infinity;
let maxZ = -Infinity;
const start = Date.now();
while (Date.now() - start < 3000) {
  const state = await sampleBone();
  if (state) {
    minX = Math.min(minX, state.position[0]);
    maxX = Math.max(maxX, state.position[0]);
    minY = Math.min(minY, state.position[1]);
    maxY = Math.max(maxY, state.position[1]);
    minZ = Math.min(minZ, state.position[2]);
    maxZ = Math.max(maxZ, state.position[2]);
  }
  await page.waitForTimeout(120);
}
const driftY = maxY - minY;
const swayX = maxX - minX;
const bobZ = maxZ - minZ;
// 注意：Hip 本地 X 是左右摆胯（首尾帧相等、无净位移），不能当作前进漂移；
// 前进位移（原始 Y 轴）已在压缩阶段锁定为常量，这里只需断言其零波动。
if (driftY > 0.01) problems.push(`Hip Y 存在前进漂移：${driftY.toFixed(4)}`);
if (bobZ < 0.005) problems.push(`Hip Z 缺少步态起伏：${bobZ.toFixed(4)}`);

await page.screenshot({ path: `${OUT_DIR}/linxia-walk-front.png` });
await page.evaluate(() => window.__modelViewer.setCameraYaw(Math.PI / 2));
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT_DIR}/linxia-walk-side.png` });

// 双脚 / 鞋部特写：正前与侧面近距离取景，核对双脚修复与鞋内衬贴合
await page.evaluate(() => window.__modelViewer.setCameraFocus(0.12, 1.15, 0));
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT_DIR}/linxia-feet-front.png` });
await page.evaluate(() => window.__modelViewer.setCameraFocus(0.12, 1.15, Math.PI / 2));
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT_DIR}/linxia-feet-side.png` });

await browser.close();

console.log(`动画列表：${JSON.stringify(sorted)}`);
console.log(`骨骼驱动：Δquat=${deltaQuat.toFixed(5)}`);
console.log(`定位漂移：Y=${driftY.toFixed(4)} 摆胯X=${swayX.toFixed(4)} 起伏Z=${bobZ.toFixed(4)}`);
console.log(
  `蒙皮网格：${meshes
    .map(
      (mesh) =>
        `${mesh.material}（${mesh.tris} 面 / ${mesh.vertices} 顶点，骨骼 ${mesh.bones}，同图 ${mesh.sameBoneGraph}，剔除 ${mesh.frustumCulled}）`,
    )
    .join('；')}`,
);
if (problems.length > 0) {
  console.log(problems.join('\n'));
  console.log('RESULT: FAIL');
  process.exit(1);
}
console.log('RESULT: PASS — 走路动画驱动骨骼、原地循环、控制台零错误零告警');

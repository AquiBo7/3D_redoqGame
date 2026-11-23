// 演出末态多机位复核：正面 / 侧面 / 背侧，看清父女是否互相遮挡、爸爸站姿是否自然。
// 并发会话频繁存盘会触发 Vite 整页重载，因此每次轮询都容忍重载并重新进场。
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = `http://127.0.0.1:${process.argv[2] ?? '5187'}/`;
const OUT = 'D:/千问比赛/美术优化/_shots/gateViews';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

async function enter() {
  await page.goto(`${BASE}?scene=S5`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => !!window.__worldApp, null, { timeout: 240000 });
  if (await page.locator('#btn-start').isVisible().catch(() => false)) {
    await page.locator('#btn-start').click();
    await page.locator('.controls-guide__enter').click().catch(() => {});
  }
  await page.waitForFunction(() => window.__worldApp.getSceneId() === 'S5', null, { timeout: 120000 });
}

async function clearDialog() {
  for (let i = 0; i < 12; i += 1) {
    const panel = page.locator('.dialogue:not([hidden]) .dialogue__panel');
    if (!(await panel.isVisible().catch(() => false))) return;
    await panel.click().catch(() => {});
    await page.waitForTimeout(150);
  }
}

const probeScript = () => {
  const app = window.__worldApp;
  const carry = app.getActorPosition('carryGroup');
  const solo = app.getActorPosition('linxiaSolo');
  const ended = !!carry && Math.abs(carry[2] - 0.9) < 0.08 && !!solo && solo[2] < 0.9;
  return {
    ended,
    carry,
    solo,
    father: app.getActorBonePosition('carryFather', 'Father_Pelvis'),
    knee: app.getActorBonePosition('carryFather', 'Father_L_Calf'),
    foot: app.getActorBonePosition('carryFather', 'Father_L_Foot'),
    bag: app.getActorBonePosition('carryFather', 'Bag_L'),
  };
};

await enter();
let state = null;
for (let round = 0; round < 120; round += 1) {
  try {
    await clearDialog();
    state = await page.evaluate(probeScript);
  } catch {
    await enter();
    continue;
  }
  if (state.ended) break;
  await page.waitForTimeout(700);
}
console.log('state', JSON.stringify(state));
if (!state || !state.ended) {
  console.log('演出未收尾');
  fs.writeFileSync(path.join(OUT, 'errors.json'), JSON.stringify(errors, null, 2), 'utf8');
  await browser.close();
  process.exit(1);
}

const [fx, , fz] = state.father;
const [gx, , gz] = state.solo;
const midZ = (fz + gz) / 2;
const views = [
  ['front', [gx, midZ - 3.6, 180, 3]],
  ['side', [fx + 3.2, midZ, 90, -2]],
  ['back', [fx + 1.2, fz + 4.2, 0, -3]],
];
for (const [name, args] of views) {
  try {
    await page.evaluate(([x, z, yaw, pitch]) => window.__worldApp.teleport(x, z, yaw, pitch), args);
    await page.waitForTimeout(2200);
    await clearDialog();
    await page.screenshot({ path: path.join(OUT, `${name}.jpg`), timeout: 60000 });
    console.log('shot', name);
  } catch (error) {
    console.log('shot failed', name, error.message);
  }
}
fs.writeFileSync(path.join(OUT, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
fs.writeFileSync(path.join(OUT, 'errors.json'), JSON.stringify(errors, null, 2), 'utf8');
console.log('errors', JSON.stringify(errors.slice(0, 6)));
await browser.close();

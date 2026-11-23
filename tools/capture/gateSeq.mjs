// 校门演出逐段实拍：连续录帧 + 在页内以 150ms 采样骨骼世界坐标，事后按采样曲线挑出
// 「抱人 / 放袋 / 重提 / 交接跟行 / 目送站姿」五个关键帧，避免抢相位漏拍。
// 依赖 WorldApp 的 DEV 钩子：getActorPosition / getActorBonePosition / teleport。
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = `http://127.0.0.1:${process.argv[2] ?? '5187'}/`;
const OUT = 'D:/千问比赛/美术优化/_shots/gateSeq3';
const DURATION_MS = Number(process.argv[3] ?? 30000);
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));

await page.goto(`${BASE}?scene=S5`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => !!window.__worldApp, null, { timeout: 240000 });
if (await page.locator('#btn-start').isVisible().catch(() => false)) {
  await page.locator('#btn-start').click();
  await page.locator('.controls-guide__enter').click().catch(() => {});
}
await page.waitForFunction(() => window.__worldApp.getSceneId() === 'S5', null, { timeout: 120000 });
await page.waitForFunction(() => {
  const fade = document.querySelector('.scene-fade');
  return !fade || Number.parseFloat(getComputedStyle(fade).opacity) < 0.05;
}, null, { timeout: 120000 });

const rig = await page.evaluate(() => {
  const app = window.__worldApp;
  const names = ['Bag_L', 'Bag_R', 'Father_Pelvis', 'Father_L_Thigh', 'Father_L_Calf', 'Father_L_Foot', 'Linxia_Pelvis'];
  const found = {};
  for (const name of names) {
    found[name] = app.getActorBonePosition?.('carryFather', name) ?? null;
  }
  return {
    models: ['linxia', 'fatherCarry'].map((id) => [id, app.hasModel?.(id)]),
    carry: app.getActorPosition?.('carryGroup') ?? null,
    girl: app.getActorPosition?.('linxiaSolo') ?? null,
    found,
  };
});
console.log('rig', JSON.stringify(rig));

// 页内连续采样：骨骼世界坐标 + 演员位置，150ms 一拍
await page.evaluate(() => {
  const app = window.__worldApp;
  const BONES = ['Bag_L', 'Bag_R', 'Father_Pelvis', 'Father_L_Thigh', 'Father_L_Calf', 'Father_L_Foot',
    'Father_R_Thigh', 'Father_R_Calf', 'Father_R_Foot', 'Linxia_Pelvis'];
  window.__samples = [];
  const began = performance.now();
  window.__began = began;
  const rnd = (p) => (p ? p.map((v) => Number(v.toFixed(3))) : null);
  setInterval(() => {
    const row = { t: Number(((performance.now() - began) / 1000).toFixed(2)) };
    for (const bone of BONES) {
      row[bone] = rnd(app.getActorBonePosition('carryFather', bone));
    }
    row.carry = rnd(app.getActorPosition('carryGroup'));
    row.girl = rnd(app.getActorPosition('linxiaSolo'));
    row.dialogue = !!document.querySelector('.dialogue:not([hidden])');
    window.__samples.push(row);
  }, 150);
});

const frames = [];
const start = Date.now();
let index = 0;
while (Date.now() - start < DURATION_MS) {
  const panel = page.locator('.dialogue:not([hidden]) .dialogue__panel');
  if (await panel.isVisible().catch(() => false)) await panel.click().catch(() => {});
  const file = `frames/${String(index).padStart(3, '0')}.jpg`;
  await page.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 74, timeout: 60000 });
  frames.push({ file, at: Number(((Date.now() - start) / 1000).toFixed(2)) });
  index += 1;
  await page.waitForTimeout(520);
}

const samples = await page.evaluate(() => window.__samples);
fs.writeFileSync(path.join(OUT, 'samples.json'), JSON.stringify(samples, null, 1), 'utf8');
fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(frames, null, 1), 'utf8');

// 关键帧挑选：袋子最低点、袋子回到手里、林夏开始前行、演出结束
const bagY = (row) => (row.Bag_L ? row.Bag_L[1] : null);
const bags = samples.filter((row) => row.Bag_L !== null);
const minY = bags.length ? Math.min(...bags.map(bagY)) : null;
const maxY = bags.length ? Math.max(...bags.map(bagY)) : null;
const girlMoveStart = samples.find((row, i) => i > 0 && row.girl && samples[i - 1].girl
  && row.girl[2] < samples[i - 1].girl[2] - 0.005);
const last = samples[samples.length - 1];
const moments = {
  bagRange: [minY, maxY],
  bagDown: bags.find((row) => minY !== null && maxY !== null && bagY(row) <= minY + 0.05) ?? null,
  bagUpAfterDown: bags.find((row) => {
    const down = bags.find((x) => bagY(x) <= minY + 0.05);
    return down && row.t > down.t && maxY !== null && bagY(row) >= maxY - 0.05;
  }) ?? null,
  girlWalks: girlMoveStart ?? null,
  stand: samples.filter((row) => row.t > (girlMoveStart?.t ?? 0) + 4).pop() ?? null,
  tail: last ?? null,
};
const nearest = (t) => (t === null || t === undefined ? null : frames.reduce((best, f) => (Math.abs(f.at - t) < Math.abs(best.at - t) ? f : best), frames[0]));
moments.frames = {
  bagDown: nearest(moments.bagDown?.t),
  bagUp: nearest(moments.bagUpAfterDown?.t),
  girlWalks: nearest(moments.girlWalks?.t),
  stand: nearest(moments.stand?.t),
};
fs.writeFileSync(path.join(OUT, 'moments.json'), JSON.stringify(moments, null, 2), 'utf8');
console.log('moments', JSON.stringify(moments.frames));

// 目送站姿：从爸爸正前方低机位再拍两张（膝盖是否仍直挺）
const pose = await page.evaluate(() => {
  const app = window.__worldApp;
  const pelvis = app.getActorBonePosition('carryFather', 'Father_Pelvis');
  return { pelvis, carry: app.getActorPosition('carryGroup'), girl: app.getActorPosition('linxiaSolo') };
});
if (pose.pelvis) {
  const [dx, , dz] = pose.pelvis;
  const clearDialog = async () => {
    for (let i = 0; i < 12; i += 1) {
      const panel = page.locator('.dialogue:not([hidden]) .dialogue__panel');
      if (!(await panel.isVisible().catch(() => false))) return;
      await panel.click().catch(() => {});
      await page.waitForTimeout(150);
    }
  };
  await clearDialog();
  await page.evaluate(([x, z]) => window.__worldApp.teleport(x, z + 2.5, 0, -6), [dx, dz]);
  await page.waitForTimeout(1600);
  await clearDialog();
  await page.screenshot({ path: path.join(OUT, 'legs-close.jpg'), timeout: 60000 });
  await page.evaluate(([x, z]) => window.__worldApp.teleport(x, z + 3.6, 8, 0), [dx, dz]);
  await page.waitForTimeout(1600);
  await clearDialog();
  await page.screenshot({ path: path.join(OUT, 'front-wide.jpg'), timeout: 60000 });
}
fs.writeFileSync(path.join(OUT, 'pose.json'), JSON.stringify(pose, null, 2), 'utf8');
fs.writeFileSync(path.join(OUT, 'errors.json'), JSON.stringify(errors, null, 2), 'utf8');
console.log('errors', JSON.stringify(errors.slice(0, 8)));
await browser.close();

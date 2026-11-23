// 相位末态探针：列出合体骨架里每个网格的可见性、父/女骨骼世界坐标，并从侧面补拍两张
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = `http://127.0.0.1:${process.argv[2] ?? '5187'}/`;
const WAIT_S = Number(process.argv[3] ?? 22);
const OUT = 'D:/千问比赛/美术优化/_shots/gateSeq3';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(`${BASE}?scene=S5`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => !!window.__worldApp, null, { timeout: 240000 });
if (await page.locator('#btn-start').isVisible().catch(() => false)) {
  await page.locator('#btn-start').click();
  await page.locator('.controls-guide__enter').click().catch(() => {});
}
await page.waitForFunction(() => window.__worldApp.getSceneId() === 'S5', null, { timeout: 120000 });

const began = Date.now();
while (Date.now() - began < WAIT_S * 1000) {
  const panel = page.locator('.dialogue:not([hidden]) .dialogue__panel');
  if (await panel.isVisible().catch(() => false)) await panel.click().catch(() => {});
  await page.waitForTimeout(400);
}

const dump = await page.evaluate(() => {
  const app = window.__worldApp;
  const carry = app.getActorPosition('carryGroup');
  const girl = app.getActorPosition('linxiaSolo');
  const bonePos = {};
  for (const name of ['Father_Pelvis', 'Father_Spine1', 'Father_L_Thigh', 'Father_L_Calf', 'Father_L_Foot',
    'Father_R_Thigh', 'Father_R_Calf', 'Father_R_Foot', 'Linxia_Pelvis', 'Bag_L', 'Bag_R']) {
    bonePos[name] = app.getActorBonePosition('carryFather', name);
  }
  // 借 getAirParticles() 拿到任意 THREE 节点，向上走到 Scene，再遍历演员根节点看命名与可见性
  let root = app.getAirParticles?.() ?? null;
  const meshes = [];
  const nodes = [];
  if (root) {
    while (root.parent) root = root.parent;
    root.updateMatrixWorld(true);
    const actorRoots = [];
    root.traverse((node) => {
      if (typeof node.name === 'string' && /^actor-/.test(node.name)) actorRoots.push(node);
    });
    for (const actorRoot of actorRoots) {
      actorRoot.traverse((node) => {
        const world = node.matrixWorld.elements;
        let effective = node.visible;
        for (let parent = node.parent; effective && parent; parent = parent.parent) effective = parent.visible;
        const row = {
          actor: actorRoot.name,
          name: node.name,
          type: node.type,
          own: node.visible,
          eff: effective,
          y: Number(world[13].toFixed(3)),
          z: Number(world[14].toFixed(3)),
        };
        if (node.isMesh) meshes.push(row);
        else if (node.name) nodes.push(row);
      });
    }
  }
  return { carry, girl, bonePos, meshes, nodeNames: nodes.map((row) => `${row.actor} ${row.name} own=${row.own}`) };
});
fs.writeFileSync(path.join(OUT, 'dump.json'), JSON.stringify(dump, null, 2), 'utf8');
console.log('carry', JSON.stringify(dump.carry), 'girl', JSON.stringify(dump.girl));
console.log('meshes', JSON.stringify(dump.meshes.map((m) => `${m.actor} | ${m.name} | own=${m.own} eff=${m.eff} y=${m.y} z=${m.z}`), null, 1));
console.log('nodes', JSON.stringify(dump.nodeNames.slice(0, 30), null, 1));

// 侧面机位：把父女两人拉开视差，看清谁在画面里
if (dump.bonePos.Father_Pelvis) {
  const [fx, , fz] = dump.bonePos.Father_Pelvis;
  const [gx, , gz] = dump.bonePos.Linxia_Pelvis;
  const mid = [(fx + gx) / 2, (fz + gz) / 2];
  const views = [
    ['side-right', [mid[0] + 3.4, mid[1], 90, -4]],
    ['side-left', [mid[0] - 3.4, mid[1], 270, -4]],
    ['behind-girl', [gx, gz + 2.4, 0, -3]],
  ];
  for (const [name, args] of views) {
    await page.evaluate(([x, z, yaw, pitch]) => window.__worldApp.teleport(x, z, yaw, pitch), args);
    await page.waitForTimeout(1500);
    for (let i = 0; i < 8; i += 1) {
      const panel = page.locator('.dialogue:not([hidden]) .dialogue__panel');
      if (!(await panel.isVisible().catch(() => false))) break;
      await panel.click().catch(() => {});
      await page.waitForTimeout(150);
    }
    await page.screenshot({ path: path.join(OUT, `view-${name}.jpg`), timeout: 60000 });
  }
}
fs.writeFileSync(path.join(OUT, 'errors2.json'), JSON.stringify(errors, null, 2), 'utf8');
console.log('errors', JSON.stringify(errors.slice(0, 6)));
await browser.close();

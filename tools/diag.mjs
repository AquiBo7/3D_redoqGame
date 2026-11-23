// 诊断：同一机位在不同 base / settle 下的渲染参数与截图，用于定位曝光差异
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'D:/千问比赛/美术优化/_shots/diag';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});

for (const base of process.argv.slice(2)) {
  for (const settle of [1500, 6000]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`${base}?scene=S12`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__worldApp), null, { timeout: 90000 });
    await page.waitForFunction(() => window.__worldApp.getSceneId() === 'S12', null, { timeout: 90000 });
    await page.waitForTimeout(settle);
    const r = await page.evaluate(() => {
      const app = window.__worldApp;
      const fade = document.querySelector('.scene-fade');
      const canvas = document.querySelector('canvas');
      const gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'));
      return {
        fadeOpacity: fade ? getComputedStyle(fade).opacity : 'none',
        info: app.getRenderInfo ? app.getRenderInfo() : null,
        glRenderer: gl ? gl.getParameter(gl.RENDERER) : 'n/a',
        maxTex: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0,
        cores: navigator.hardwareConcurrency,
        dpr: window.devicePixelRatio,
      };
    });
    const tag = `${base.replace(/[^0-9a-z]/gi, '_')}_${settle}`;
    await page.screenshot({ path: `${OUT}/diag_${tag}.png` });
    console.log(base, 'settle=' + settle, JSON.stringify(r));
    await ctx.close();
  }
}
await browser.close();

// 帧率探针：与 artCapture.mjs 同一套 Edge + 同一机位，只测 rAF 帧间隔。
// 用法：node fpsProbe.mjs [scene ...]      默认 S12 S8 S5
// 说明：headless Edge 默认走 swiftshader（纯软件光栅），得到的 fps 是**下界**；
//       加 GPU=1 走真机 ANGLE，数值才接近玩家手机/PC 的真实体验。
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.BASE_URL || 'http://localhost:5178/';
const SCENES = process.argv.slice(2).length ? process.argv.slice(2) : ['S12', 'S8', 'S5'];
const SAMPLES = Number(process.env.SAMPLES || 180);
const gpu = process.env.GPU === '1';

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: gpu
    ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu-rasterization', '--disable-gpu-sandbox']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});

for (const scene of SCENES) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}?scene=${scene}`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__worldApp), null, { timeout: 120000 });
    await page.waitForFunction((id) => window.__worldApp.getSceneId() === id, scene, { timeout: 120000 });
    await page.waitForFunction(() => {
      const fade = document.querySelector('.scene-fade');
      return !fade || parseFloat(getComputedStyle(fade).opacity) <= 0.001;
    }, null, { timeout: 120000 });
    await page.waitForTimeout(2500);
    const result = await page.evaluate(async (n) => {
      const t = [];
      await new Promise((resolve) => {
        let last = performance.now();
        const tick = (now) => {
          t.push(now - last);
          last = now;
          if (t.length >= n) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const sorted = t.slice(5).sort((a, b) => a - b);
      const info = window.__worldApp.getRenderInfo?.() ?? null;
      const dpr = window.devicePixelRatio;
      return {
        frames: sorted.length,
        medianMs: sorted[Math.floor(sorted.length / 2)],
        p95Ms: sorted[Math.floor(sorted.length * 0.95)],
        fps: 1000 / sorted[Math.floor(sorted.length / 2)],
        info,
        dpr,
        renderer: (() => {
          const c = document.createElement('canvas');
          const gl = c.getContext('webgl2');
          const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
          return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).slice(0, 60) : 'unknown';
        })(),
      };
    }, SAMPLES);
    console.log(
      `${scene} dpr=${result.dpr} median=${result.medianMs.toFixed(1)}ms p95=${result.p95Ms.toFixed(1)}ms `
      + `fps=${result.fps.toFixed(1)} draw=${result.info?.drawables} tri=${result.info?.triangles} tex=${result.info?.textures} gpu=${result.renderer}`
    );
  } catch (err) {
    console.log(`${scene} FAILED ${String(err).slice(0, 160)}`);
  }
  await context.close();
}
await browser.close();

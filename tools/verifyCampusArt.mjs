import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.env.CAMPUS_URL ?? 'http://127.0.0.1:5174/';
const browser = await chromium.launch({
  executablePath: 'C:/Users/AnQi/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',
  headless: true,
});
const report = { checks: [], problems: [], diagnostics: {} };

async function trackDraws(page) {
  await page.addInitScript(() => {
    window.__campusGLStats = { calls: 0, triangles: 0 };
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args) {
      const gl = getContext.apply(this, args);
      if (!gl || !String(args[0]).startsWith('webgl') || gl.__campusTracked) return gl;
      gl.__campusTracked = true;
      for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        const draw = gl[name].bind(gl);
        gl[name] = (...values) => {
          const count = name.startsWith('drawArrays') ? values[2] : values[1];
          const instances = name.endsWith('Instanced') ? values[values.length - 1] : 1;
          window.__campusGLStats.calls += 1;
          if (values[0] === gl.TRIANGLES) window.__campusGLStats.triangles += count / 3 * instances;
          return draw(...values);
        };
      }
      return gl;
    };
  });
}

async function frames(page, name, count = 90) {
  const result = await page.evaluate((count) => new Promise((resolve) => {
    const intervals = [];
    let previous;
    const start = { ...window.__campusGLStats };
    const gl = document.querySelector('canvas').getContext('webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const device = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const sample = (time) => {
      if (previous !== undefined) intervals.push(time - previous);
      previous = time;
      if (intervals.length < count) return requestAnimationFrame(sample);
      const sum = intervals.reduce((a, b) => a + b, 0);
      const sorted = [...intervals].sort((a, b) => a - b);
      resolve({
        device, fps: 1000 * count / sum, meanMs: sum / count,
        medianMs: sorted[Math.floor(count / 2)], p95Ms: sorted[Math.floor(count * 0.95)],
        drawCalls: (window.__campusGLStats.calls - start.calls) / (count + 1),
        triangles: (window.__campusGLStats.triangles - start.triangles) / (count + 1),
      });
    };
    requestAnimationFrame(sample);
  }), count);
  report.diagnostics[name] = result;
  console.log(`PERF ${name} ${JSON.stringify(result)}`);
  check(`${name} 持续帧时间无明显卡顿`, result.medianMs < 40 && result.p95Ms < 80, result);
}

async function campusGeometry(page, id) {
  const result = await page.evaluate(async (id) => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { getSceneDefinition } = await import('/src/scenes3d/index.ts');
    const root = new THREE.Group();
    const built = getSceneDefinition(id).build(root);
    root.updateMatrixWorld(true);
    const violations = [];
    let details = 0;
    let instances = 0;
    root.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) instances += object.count;
      if (!object.userData.campusDetail) return;
      details += 1;
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.geometry.computeBoundingBox();
        const test = (matrix) => {
          const bounds = child.geometry.boundingBox.clone().applyMatrix4(matrix);
          const material = Array.isArray(child.material) ? child.material[0] : child.material;
          if (material.userData.windTime) bounds.expandByScalar(child.userData.meadow ? 0.09 : 0.04);
          if (bounds.min.x <= 1.2 && bounds.max.x >= -1.2) violations.push(`${object.name}: ${bounds.min.x}..${bounds.max.x}`);
        };
        if (child instanceof THREE.InstancedMesh) {
          const matrix = new THREE.Matrix4();
          for (let i = 0; i < child.count; i += 1) {
            child.getMatrixAt(i, matrix);
            test(matrix.clone().premultiply(child.matrixWorld));
          }
        } else test(child.matrixWorld);
      });
    });
    const environment = root.children.filter((child) => !Object.values(built.actors).includes(child));
    const hits = [];
    if (id === 'S8') {
      for (const z of [-1, -12, -25, -37, -43]) {
        const from = new THREE.Vector3(0.2, 1.6, z);
        const to = new THREE.Vector3(0, 1.5, 8.6);
        const ray = new THREE.Raycaster(from, to.clone().sub(from).normalize(), 0, from.distanceTo(to) - 0.6);
        hits.push(...ray.intersectObjects(environment, true).map((hit) => hit.object.name));
      }
    }
    const meadows = root.children.filter((child) => child.userData.meadow);
    const meadowScene = new THREE.Scene();
    for (const meadow of meadows) meadowScene.add(meadow);
    meadowScene.add(new THREE.HemisphereLight(0xffefd2, 0x698a70, 2.4));
    const camera = new THREE.PerspectiveCamera(55, 480 / 270, 0.1, 160);
    camera.position.set(0, 18, 18);
    camera.lookAt(0, 0, id === 'S5' ? -8 : -20);
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.setSize(480, 270);
    renderer.render(meadowScene, camera);
    const meadowCalls = renderer.info.render.calls;
    const imageBefore = renderer.domElement.toDataURL();
    for (const meadow of meadows) meadow.material.userData.windTime.value = 1.7;
    renderer.render(meadowScene, camera);
    const changed = renderer.domElement.toDataURL() !== imageBefore;
    const meadowCounts = meadows.map((mesh) => ({ name: mesh.name, count: mesh.count }));
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    for (const group of [root, meadowScene]) group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (!object.geometry.userData.sharedResource) geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material.userData.sharedResource) continue;
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture && !value.userData.sharedResource) textures.add(value);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    return { violations, details, instances, hits, meadowCalls, meadowCounts, changed };
  }, id);
  report.diagnostics[`${id}Geometry`] = result;
  check(`${id} 新增布景完整包围盒避开中央通廊`, result.details > 5 && result.violations.length === 0, result);
  check(`${id} 草花实测合计两个 DrawCall`, result.meadowCalls === 2, result.meadowCounts);
  check(`${id} 风场时钟改变实际渲染像素`, result.changed, result);
  if (id === 'S8') check('回头看爸爸的全程中央视线无布景遮挡', result.hits.length === 0, result.hits);
}

function check(name, result, detail) {
  report.checks.push({ name, result, detail });
  assert.ok(result, `${name}: ${JSON.stringify(detail)}`);
  console.log(`PASS ${name}`);
}

function watch(page) {
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) report.problems.push(message.text());
  });
  page.on('pageerror', (error) => report.problems.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) report.problems.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => report.problems.push(`${request.url()} ${request.failure()?.errorText}`));
}

async function settle(page) {
  const models = await page.evaluate(async () => {
    if (!window.__worldApp) return [];
    const { getSceneDefinition } = await import('/src/scenes3d/index.ts');
    return getSceneDefinition(window.__worldApp.getSceneId()).requiredModels ?? [];
  });
  await page.waitForFunction((ids) => ids.every((id) => window.__worldApp.hasModel(id)), models, { timeout: 60000 });
  await page.waitForLoadState('networkidle');
}

async function enter(page, id) {
  await settle(page);
  await page.goto(id === 'S1' ? base : `${base}?scene=${id}`, { waitUntil: 'load' });
  const start = page.locator('#btn-start');
  if (await start.isVisible()) {
    await start.click();
    await page.locator('.controls-guide__enter').click();
  }
  await page.waitForFunction((sceneId) => window.__worldApp?.getSceneId() === sceneId, id, { timeout: 60000 });
  await page.waitForFunction(() => {
    const fade = document.querySelector('.scene-fade');
    return fade && Number.parseFloat(getComputedStyle(fade).opacity) < 0.05;
  }, null, { timeout: 60000 });
}

async function shot(page, name) {
  const sceneId = await page.evaluate(() => window.__worldApp.getSceneId());
  if (name.startsWith('S6-')) check(`${name} 截图处于 S6 全景演出`, sceneId === 'S6', sceneId);
  report.diagnostics.captures ??= [];
  report.diagnostics.captures.push({ name, sceneId });
  await page.screenshot({ path: `tools/shots/campus-${name}.png`, timeout: 60000 });
  console.log(`SHOT ${name}`);
}

async function dialogue(page) {
  for (let i = 0; i < 16; i += 1) {
    const panel = page.locator('.dialogue:not([hidden]) .dialogue__panel');
    if (!await panel.isVisible()) return;
    await panel.click();
    await page.waitForTimeout(120);
  }
  throw new Error('对话未正常结束');
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await trackDraws(page);
  const glbs = [];
  page.on('request', (request) => {
    if (/\.glb(?:\?|$)/.test(request.url())) glbs.push(request.url());
  });
  await enter(page, 'S1');
  check('S1 首屏零 GLB', glbs.length === 0, [...glbs]);
  await shot(page, 'S1-regression');

  await enter(page, 'S5');
  await shot(page, 'S5-entry');
  await dialogue(page);
  await page.waitForFunction(() => {
    const pos = window.__worldApp.getActorPosition('linxiaSolo');
    return pos && pos[2] < 0.51;
  }, null, { timeout: 30000 });
  check('S5 拆分后林夏到达既有落点', true);
  await shot(page, 'S5-split');
  report.diagnostics.gate = await page.evaluate(() => window.__worldApp.getVisualDiagnostics());
  await page.evaluate(() => window.__worldApp.teleport(-4.8, 6.8, -38));
  await shot(page, 'S5-court');
  await page.evaluate(() => window.__worldApp.teleport(0, 7.6, 65));
  await shot(page, 'S5-left-exterior');
  await page.evaluate(() => window.__worldApp.teleport(0, 7.6, -65));
  await shot(page, 'S5-right-exterior');
  await page.evaluate(() => window.__worldApp.teleport(0, 7.6, 0));
  await frames(page, 'S5Desktop');
  await page.keyboard.down('KeyW');
  try {
    await page.waitForFunction(() => window.__worldApp.getSceneId() === 'S6', null, { timeout: 15000 });
  } finally {
    await page.keyboard.up('KeyW');
  }
  check('S5 步行穿过原触发区进入 S6', true);
  await page.waitForTimeout(1250);
  await shot(page, 'S6-early');
  await frames(page, 'S6Desktop', 60);
  await shot(page, 'S6-panorama');
  await page.waitForTimeout(250);
  await shot(page, 'S6-wide');
  await page.waitForFunction(() => window.__worldApp.getSceneId() === 'S7', null, { timeout: 20000 });
  check('S6 全景自然完成进入 S7', true);
  await shot(page, 'S7-regression');

  await enter(page, 'S8');
  await shot(page, 'S8-entry');
  await dialogue(page);
  await page.getByRole('button', { name: '我陪你走一段。', exact: true }).click();
  await page.evaluate(() => window.__worldApp.teleport(0.2, -20, 0));
  await shot(page, 'S8-middle');
  await frames(page, 'S8Desktop');
  await page.evaluate(() => window.__worldApp.teleport(-4.6, -11, 60));
  await shot(page, 'S8-reading-pocket');
  await page.evaluate(() => window.__worldApp.teleport(4.6, -5.2, -62));
  await shot(page, 'S8-cycle-shelter');
  await page.evaluate(() => window.__worldApp.teleport(0.2, -12, 180));
  await shot(page, 'S8-father');
  await page.waitForFunction(() => {
    const pos = window.__worldApp.getActorPosition('linxia');
    return pos && pos[2] < -43.9;
  }, null, { timeout: 40000 });
  check('S8 林夏正常完成原有路线', true);
  await page.evaluate(() => window.__worldApp.teleport(0.2, -39.5, 0));
  await shot(page, 'S8-facade');
  report.diagnostics.building = await page.evaluate(() => window.__worldApp.getVisualDiagnostics());
  await page.keyboard.down('KeyW');
  try {
    await page.waitForFunction(() => window.__worldApp.getSceneId() === 'S9', null, { timeout: 15000 });
  } finally {
    await page.keyboard.up('KeyW');
  }
  check('S8 实际步行进入 S9', true);
  await shot(page, 'S9-arrival');
  await frames(page, 'S9Desktop');
  await page.evaluate(() => window.__worldApp.teleport(-4.6, -43.6, -22));
  await shot(page, 'S9-entry-left');
  await page.evaluate(() => window.__worldApp.teleport(4.6, -43.6, 22));
  await shot(page, 'S9-entry-right');
  await page.getByRole('button', { name: '不看。', exact: true }).click();
  await page.locator('.chapter-end:not([hidden])').waitFor();
  check('S9 选项到章节结尾', true);
  await settle(page);
  await page.close();

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  watch(mobile);
  await trackDraws(mobile);
  for (const id of ['S5', 'S8']) {
    await enter(mobile, id);
    const layout = await mobile.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const dialogue = document.querySelector('.dialogue');
      const bounds = dialogue.getBoundingClientRect();
      return {
        pixelRatio: canvas.width / canvas.clientWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
        bottomGap: innerHeight - bounds.bottom,
        paddingBottom: Number.parseFloat(getComputedStyle(dialogue).paddingBottom),
        postprocessing: window.__worldApp.getVisualDiagnostics().postprocessing,
      };
    });
    check(`${id} 手机像素比与横向溢出`, layout.pixelRatio > 0 && layout.pixelRatio <= 1.5 && !layout.overflow, layout);
    check(`${id} 手机底部安全区`, layout.bottomGap + layout.paddingBottom >= 48, layout);
    check(`${id} 手机不启用高开销后处理`, layout.postprocessing === false, layout);
    await shot(mobile, `${id}-portrait`);
    await mobile.setViewportSize({ width: 844, height: 390 });
    await shot(mobile, `${id}-landscape`);
    await frames(mobile, `${id}MobileLandscape`);
    const size = await mobile.evaluate(() => ({ width: document.querySelector('canvas').clientWidth, height: document.querySelector('canvas').clientHeight }));
    check(`${id} 横屏旋转后画布匹配`, size.width === 844 && size.height === 390, size);
    await mobile.setViewportSize({ width: 390, height: 844 });
  }
  await settle(mobile);
  await mobile.close();
  const geometryPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(geometryPage);
  await enter(geometryPage, 'S5');
  await settle(geometryPage);
  await campusGeometry(geometryPage, 'S5');
  await campusGeometry(geometryPage, 'S8');
  await settle(geometryPage);
  await geometryPage.close();
  check('浏览器零错误零警告、资源零失败', report.problems.length === 0, report.problems);
} catch (error) {
  report.problems.push(error.stack ?? String(error));
  console.error(error);
  process.exitCode = 1;
  const pages = browser.contexts().flatMap((context) => context.pages());
  const current = pages[pages.length - 1];
  if (current) {
    report.failureState = await current.evaluate(() => ({
      sceneId: window.__worldApp?.getSceneId(), text: document.body.innerText,
    }));
    await current.screenshot({ path: 'tools/shots/campus-failure.png', timeout: 60000 });
  }
} finally {
  writeFileSync('tools/shots/campus-art-report.json', JSON.stringify(report, null, 2));
  await browser.close();
}

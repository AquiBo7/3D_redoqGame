import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.CAMPUS_URL ?? 'http://127.0.0.1:5180/';
const browser = await chromium.launch({
  executablePath: 'C:/Users/AnQi/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',
  headless: true,
});
const report = { scope: ['M1: 模块1、2', 'M2: 模块3、4'], checks: [], screenshots: [], problems: [], diagnostics: {} };
function check(name, ok, detail) {
  report.checks.push({ name, ok, detail });
  assert.ok(ok, `${name}: ${JSON.stringify(detail)}`);
  console.log(`PASS ${name}`);
}
function watch(page) {
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type())) report.problems.push(message.text());
  });
  page.on('pageerror', (error) => report.problems.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) report.problems.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => report.problems.push(`${request.url()} ${request.failure()?.errorText}`));
}
async function shot(page, name) {
  const path = `tools/shots/polish-${name}.png`;
  await page.screenshot({ path, timeout: 60000 });
  report.screenshots.push(path);
}
async function settleAssets(page) {
  await page.waitForFunction(() => {
    if (!window.__worldApp) return true;
    const models = {
      S4: ['volunteer', 'ayuan', 'linxia', 'father'],
      S5: ['linxia', 'father', 'fatherCarry', 'ayuan', 'studentFemale', 'studentMale'],
      S6: ['linxia', 'father', 'fatherCarry', 'ayuan', 'studentFemale', 'studentMale'],
      S7: ['volunteer', 'linxia', 'father'],
      S8: ['linxia', 'father', 'studentFemale', 'studentMale'],
      S9: ['linxia', 'father', 'studentFemale', 'studentMale'],
    };
    return (models[window.__worldApp.getSceneId()] ?? []).every((id) => window.__worldApp.hasModel(id));
  }, null, { timeout: 60000 });
  await page.waitForLoadState('networkidle');
}
async function enter(page, sceneId) {
  await settleAssets(page);
  await page.goto(`${base}?scene=${sceneId}`, { waitUntil: 'load' });
  await page.waitForFunction((id) => window.__worldApp?.getSceneId() === id, sceneId, { timeout: 60000 });
  await page.waitForFunction(() => Number.parseFloat(getComputedStyle(document.querySelector('.scene-fade')).opacity) < .05, null, { timeout: 60000 });
  check(`${sceneId} 调试直达跳过指南`, await page.locator('.controls-guide').count() === 0);
  await settleAssets(page);
}
async function dialogue(page) {
  for (let i = 0; i < 20; i += 1) {
    const panel = page.locator('.dialogue:not([hidden]) .dialogue__panel');
    if (!await panel.isVisible()) return;
    await panel.click();
    await page.waitForTimeout(120);
  }
  throw new Error('对话不能结束');
}
async function waitObjective(page, sceneId) {
  await page.locator('.objective-prompt:not([hidden]):not(.is-fading)').waitFor({ timeout: 30000 });
  const geometry = await page.locator('.objective-prompt').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top / innerHeight, bottom: rect.bottom / innerHeight, text: element.textContent };
  });
  check(`${sceneId} 正面行动提醒不遮准星`, geometry.top > .18 && geometry.top < .24 && geometry.bottom < .48, geometry);
  await shot(page, `${sceneId}-objective-${page.viewportSize().width}`);
}
async function guide(page, name, enterKey = 'KeyE', continued = false) {
  await settleAssets(page);
  await page.goto(base, { waitUntil: 'load' });
  await page.locator(continued ? '#btn-continue' : '#btn-start').click();
  await page.locator('.controls-guide').waitFor();
  const layout = await page.locator('.controls-guide__enter').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, gap: innerHeight - rect.bottom, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  check(`${name} 指南保留触控热区与安全区`, layout.width >= 44 && layout.height >= 44 && layout.gap >= 48 && !layout.overflow, layout);
  check(`${name} 指南关闭前没有进入世界`, await page.evaluate(() => !window.__worldApp));
  await shot(page, `guide-${name}`);
  await page.keyboard.press(enterKey);
  await page.waitForFunction(() => !!window.__worldApp, null, { timeout: 60000 });
  check(`${name} 指南键盘确认后进入世界`, await page.locator('.controls-guide').count() === 0);
}
async function roomChecks(page) {
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { createRoomDefinition } = await import('/src/scenes3d/room.ts');
    const root = new THREE.Group();
    const definition = createRoomDefinition('S1');
    definition.build(root);
    root.updateMatrixWorld(true);
    const get = (name) => root.getObjectByName(name);
    const light = get('room-lamp-point-light');
    const bulb = get('room-lamp-emissive-bulb');
    const floor = get('room-oak-floor');
    const basket = get('room-open-trapezoid-wastebasket');
    const openingRay = new THREE.Raycaster(new THREE.Vector3(-3.08, .65, -1.75), new THREE.Vector3(0, -1, 0), 0, 1);
    const result = {
      walls: root.children.filter((object) => /room-(cream|terracotta)-wall/.test(object.name)).map((object) => ({ name: object.name, color: object.material.color.getHex(), z: object.position.z })),
      lamp: { intensity: light.intensity, distance: light.distance, decay: light.decay, color: light.color.getHex(), shadow: light.castShadow, bulbColor: bulb.material.emissive.getHex(), bulbIntensity: bulb.material.emissiveIntensity, glow: get('room-lamp-soft-glow') instanceof THREE.Sprite },
      floor: { texture: !!floor.material.map, roughness: !!floor.material.roughnessMap, linearRoughness: floor.material.roughnessMap?.colorSpace === THREE.NoColorSpace },
      slats: get('room-blind-slats').count,
      stripes: ['floor', 'wall'].map((side) => get(`room-sun-stripes-${side}`).geometry.getAttribute('position').count),
      shelves: ['lower', 'upper'].map((level) => get(`room-shelf-${level}`).position.y),
      books: ['brick', 'forest', 'yellow', 'lake'].map((color) => !!get(`room-shelf-book-${color}-white-pages`)),
      desk: { monitors: [1, 2].every((i) => !!get(`room-monitor-${i}-dark-screen`)), keys: get('room-keyboard-keys').count, drawers: [1, 2].every((i) => !!get(`room-desk-black-handle-${i}`)), bag: get('document-bag').position.toArray(), mug: !!get('room-desk-mug'), mouse: !!get('room-desk-mouse') },
      textiles: ['room-coral-fabric-duvet', 'room-white-folded-sheet'].every((name) => !!get(name).material.map),
      basketOpeningHits: openingRay.intersectObject(basket, true).map((hit) => hit.point.y),
      paper: [1, 2].map((i) => get(`room-crumpled-paper-${i}`).position.toArray()),
      zeroGlb: definition.requiredModels.length === 0,
    };
    const { SHARED_RESOURCE_FLAG } = await import('/src/scenes3d/materials.ts');
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return;
      if (!object.geometry.userData[SHARED_RESOURCE_FLAG]) object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material.userData[SHARED_RESOURCE_FLAG]) material.dispose();
      }
    });
    return result;
  });
  report.diagnostics.room = result;
  check('S1 陶土后墙与米白侧墙分别染色', result.walls.every((wall) => wall.color === (wall.name.includes('terracotta') ? 0xc46d45 : 0xf1ece1)), result.walls);
  check('S1 常亮双层吊灯和零阴影暖光符合参数', result.lamp.intensity === 1.15 && result.lamp.distance === 9 && result.lamp.decay === 1.6 && result.lamp.color === 0xffcb82 && !result.lamp.shadow && result.lamp.bulbColor === 0xffd27d && result.lamp.bulbIntensity === 1.8 && result.lamp.glow, result.lamp);
  check('S1 橡木纹理包含线性清漆粗糙度贴图', result.floor.texture && result.floor.roughness && result.floor.linearRoughness, result.floor);
  check('S1 十一片百叶和墙地真实条纹光斑', result.slats === 11 && result.stripes.every((vertices) => vertices > 400), { slats: result.slats, stripes: result.stripes });
  check('S1 双层错落书架与四色白纸芯精装书', result.shelves[0] === 1.48 && result.shelves[1] === 1.76 && result.books.every(Boolean), { shelves: result.shelves, books: result.books });
  check('S1 双屏键鼠双抽屉保留证件袋', result.desk.monitors && result.desk.keys === 36 && result.desk.drawers && result.desk.mug && result.desk.mouse && result.desk.bag[0] === 2.7 && result.desk.bag[2] === -2.2, result.desk);
  check('S1 红被白折边与真实开口废纸篓及桶外纸团', result.textiles && result.basketOpeningHits.length > 0 && result.basketOpeningHits.every((y) => y < .04) && result.paper.length === 2, { textiles: result.textiles, opening: result.basketOpeningHits, paper: result.paper });
  check('S1 卧室新增几何仍无模型依赖', result.zeroGlb);
  await page.evaluate(() => window.__worldApp.teleport(0, 1.4, 0));
  await shot(page, 'S1-warm-room');
  await page.evaluate(() => window.__worldApp.teleport(-.6, -2.2, 5));
  await shot(page, 'S1-shelves-blinds-wall');
  await page.evaluate(() => window.__worldApp.teleport(.4, -.45, -55));
  await shot(page, 'S1-dual-monitor-desk');
  await page.evaluate(() => window.__worldApp.teleport(-1.3, -.7, 45));
  await page.mouse.move(640, 230);
  await page.mouse.down();
  await page.mouse.move(640, 410, { steps: 6 });
  await page.mouse.up();
  await shot(page, 'S1-coral-bed-wastebasket');
}
async function gateChecks(page) {
  const geometry = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { createGateDefinition, GATE_WALKERS } = await import('/src/scenes3d/gate.ts');
    const { yawToward } = await import('/src/scenes3d/shared.ts');
    const root = new THREE.Group();
    const definition = createGateDefinition('S5');
    const { actors } = definition.build(root);
    const typer = actors.typer;
    const direction = new THREE.Vector3(typer.position.x, 0, typer.position.z - definition.spawn.z);
    const result = {
      position: typer.position.toArray(),
      yaw: typer.rotation.y,
      expectedYaw: yawToward(typer.position, { x: -0.2, z: 2.8 }),
      lean: typer.children[0].rotation.x,
      angle: direction.angleTo(new THREE.Vector3(0, 0, -1)) * 180 / Math.PI,
      hotspot: definition.hotspots.find((hotspot) => hotspot.id === 'typer').position,
      walkers: GATE_WALKERS.map((path) => ({ ...path, position: actors[path.id].position.toArray(), nativeModel: !!actors[path.id].getObjectByName('actor-pose') })),
      crowdYaw: [0, 1, 2, 3].map((i) => actors[`crowd-${i}`].rotation.y),
    };
    const { SHARED_RESOURCE_FLAG } = await import('/src/scenes3d/materials.ts');
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (!object.geometry.userData[SHARED_RESOURCE_FLAG]) object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material.userData[SHARED_RESOURCE_FLAG]) material.dispose();
      }
    });
    return result;
  });
  check('S5 男生在左后方约96度且自然面向台阶', geometry.angle > 94 && geometry.angle < 98 && Math.abs(geometry.yaw - geometry.expectedYaw) < 1e-6 && geometry.lean <= .02, geometry);
  check('S5 男生光点随真实站位迁移', geometry.position[0] === geometry.hotspot.x && geometry.position[2] === geometry.hotspot.z, geometry.hotspot);
  check('S5 两侧路人真实模型走向校内远处', geometry.walkers.length === 2 && geometry.walkers.every((path) => path.nativeModel && Math.abs(path.x) === 2.85 && path.endZ <= -20 && path.endZ >= -24), geometry.walkers);
  check('S5 围观人群存在错落朝向', Math.max(...geometry.crowdYaw) - Math.min(...geometry.crowdYaw) > 1.5, geometry.crowdYaw);
  await page.evaluate(() => window.__worldApp.teleport(0, 7.6, 0));
  await shot(page, 'S5-front-no-typer');
  await page.evaluate(async () => {
    const { eventBus } = await import('/src/core/eventBus.ts');
    window.__polishGaze = [];
    eventBus.on('scene:gazeHotspot', ({ hotspotId }) => window.__polishGaze.push(hotspotId));
    window.__worldApp.teleport(0, 7.6, 95.55);
  });
  await page.waitForFunction(() => window.__polishGaze.includes('typer'), null, { timeout: 5000 });
  check('S5 左转真实注视可触发男生热点', await page.evaluate(() => window.__polishGaze.includes('typer')));
  await shot(page, 'S5-left-rear-typer');
  const before = await page.evaluate(() => ['student-walker', 'student-walker-right'].map((id) => window.__worldApp.getActorPosition(id)));
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ['student-walker', 'student-walker-right'].map((id) => window.__worldApp.getActorPosition(id)));
  check('S5 双侧路人实际逐帧向校内行走', after.every((position, i) => position[2] < before[i][2] && Math.abs(position[0]) === 2.85), { before, after });
  await page.waitForFunction(() => window.__worldApp.getActorPosition('student-walker')?.[2] === -22 && window.__worldApp.getActorPosition('student-walker-right')?.[2] === -24, null, { timeout: 60000 });
  const arrived = await page.evaluate(() => ['student-walker', 'student-walker-right'].map((id) => window.__worldApp.getActorPosition(id)));
  check('S5 路人终点在校内且脚底贴平台', arrived.every((position) => Math.abs(position[1] - .42) < 1e-6), arrived);
  await page.evaluate(() => window.__worldApp.teleport(0, 2.75, 0));
  await shot(page, 'S5-walkers-inside');
}
try {
  const entryHtml = readFileSync('dist/index.html', 'utf8');
  const entryFiles = ['index.html', ...Array.from(entryHtml.matchAll(/(?:src|href)="\.\/assets\/([^"]+)"/g), (match) => `assets/${match[1]}`), 'fonts/yt-sans-400.woff2', 'fonts/yt-serif-600.woff2'];
  const entryBytes = entryFiles.reduce((bytes, file) => bytes + statSync(`dist/${file}`).size, 0);
  report.diagnostics.entry = { bytes: entryBytes, files: entryFiles };
  check('首屏构建资源和本地字体≤3MB', entryBytes <= 3 * 1024 * 1024, report.diagnostics.entry);
  check('构建资源使用相对assets路径', /(?:src|href)="\.\/assets\//.test(entryHtml) && !/(?:src|href)="\/assets\//.test(entryHtml));
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  const glbs = [];
  page.on('request', (request) => { if (/\.glb(?:\?|$)/.test(request.url())) glbs.push(request.url()); });
  await guide(page, 'desktop');
  await waitObjective(page, 'S1');
  check('S1 首屏零 GLB', glbs.length === 0, [...glbs]);
  await roomChecks(page);
  await page.evaluate(() => window.__worldApp.teleport(-2.85, -2.7, 0));
  await page.waitForTimeout(120);
  const phoneCooldown = await page.evaluate(() => {
    const press = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }));
    press();
    const opened = !document.querySelector('.phone-overlay').hidden;
    const started = performance.now();
    press();
    return { opened, protected: !!document.querySelector('.phone__lockscreen'), elapsed: performance.now() - started };
  });
  check('S1 同次 E 打开后不误解锁', phoneCooldown.opened && phoneCooldown.protected, phoneCooldown);
  check('手机180ms内 E 被防抖', phoneCooldown.elapsed < 180 && phoneCooldown.protected, phoneCooldown);
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyE');
  await page.locator('.phone__home-title').waitFor();
  await shot(page, 'phone-E-home');
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', repeat: true })));
  check('手机 E 长按不关闭', await page.locator('.phone-overlay:not([hidden])').isVisible());
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'polish-input';
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press('KeyE');
  check('输入焦点内 E 不关闭手机', await page.locator('.phone-overlay:not([hidden])').isVisible());
  await page.evaluate(() => document.querySelector('#polish-input').remove());
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => document.querySelector('.phone-overlay').hidden);
  await page.waitForFunction(() => window.__worldApp.getSceneId() === 'S3');
  await waitObjective(page, 'S3');
  const preparation = await page.evaluate(() => window.__worldApp.getPlayerPosition());
  check('S3 准备阶段可自由行动拾取', preparation.enabled, preparation);
  await page.evaluate(() => window.__worldApp.interact('document-bag'));
  await page.waitForFunction(() => window.__worldApp.getSceneId() === 'S4', null, { timeout: 30000 });
  await waitObjective(page, 'S4');
  await page.locator('.phone-vibrate:not([hidden])').waitFor();
  await page.waitForTimeout(200);
  const messageCooldown = await page.evaluate(() => {
    const press = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }));
    press();
    const opened = !document.querySelector('.vibration-message').hidden;
    const started = performance.now();
    press();
    return { opened, protected: !document.querySelector('.vibration-message').hidden, elapsed: performance.now() - started };
  });
  check('消息180ms内 E 不误收起', messageCooldown.opened && messageCooldown.protected && messageCooldown.elapsed < 180, messageCooldown);
  await shot(page, 'message-E-open');
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => document.querySelector('.vibration-message').hidden);
  check('消息收起后恢复移动控制', await page.evaluate(() => window.__worldApp.getPlayerPosition().enabled));
  const mutedBefore = await page.locator('.mute-toggle').getAttribute('aria-pressed');
  await page.keyboard.press('KeyO');
  check('O 切换静音状态', await page.locator('.mute-toggle').getAttribute('aria-pressed') !== mutedBefore);
  await page.keyboard.press('KeyO');
  check('O 再次恢复声音状态', await page.locator('.mute-toggle').getAttribute('aria-pressed') === mutedBefore);
  await page.waitForLoadState('networkidle');
  await guide(page, 'continue', 'Space', true);
  await page.waitForLoadState('networkidle');
  await enter(page, 'S5');
  await dialogue(page);
  await waitObjective(page, 'S5');
  await gateChecks(page);
  await enter(page, 'S7');
  await dialogue(page);
  await waitObjective(page, 'S7');
  await enter(page, 'S8');
  await dialogue(page);
  await page.getByRole('button', { name: '我陪你走一段。', exact: true }).click();
  await waitObjective(page, 'S8');
  await page.waitForLoadState('networkidle');
  await page.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  watch(mobile);
  await guide(mobile, 'portrait', 'Space');
  await waitObjective(mobile, 'S1');
  await mobile.waitForLoadState('networkidle');
  await mobile.setViewportSize({ width: 844, height: 390 });
  await guide(mobile, 'landscape', 'KeyE');
  await enter(mobile, 'S4');
  const layout = await mobile.evaluate(() => ({
    ratio: document.querySelector('canvas').width / document.querySelector('canvas').clientWidth,
    postprocessing: window.__worldApp.getVisualDiagnostics().postprocessing,
  }));
  check('触屏像素比≤1.5且不启用后处理', layout.ratio <= 1.5 && layout.ratio > 0 && layout.postprocessing === false, layout);
  await mobile.evaluate(() => window.__worldApp.teleport(0, 3, 0));
  const before = await mobile.evaluate(() => window.__worldApp.getPlayerPosition());
  await mobile.touchscreen.tap(422, 250);
  await mobile.waitForTimeout(650);
  const walking = await mobile.evaluate(() => window.__worldApp.getPlayerPosition());
  const walkDistance = Math.hypot(walking.feet.x - before.feet.x, walking.feet.z - before.feet.z);
  await mobile.evaluate(() => window.__worldApp.teleport(0, 3, 0));
  await mobile.touchscreen.tap(422, 250);
  await mobile.touchscreen.tap(422, 250);
  await mobile.waitForTimeout(650);
  const running = await mobile.evaluate(() => window.__worldApp.getPlayerPosition());
  const runDistance = Math.hypot(running.feet.x - before.feet.x, running.feet.z - before.feet.z);
  check('触屏双击地面实际移动快于单击', walkDistance > .5 && runDistance > walkDistance * 1.25, { walkDistance, runDistance });
  await shot(mobile, 'touch-sprint');
  await mobile.waitForLoadState('networkidle');
  await mobile.close();
  check('浏览器零错误零警告及资源失败', report.problems.length === 0, report.problems);
} catch (error) {
  report.problems.push(error.stack ?? String(error));
  console.error(error);
  process.exitCode = 1;
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages[pages.length - 1];
  if (page) {
    report.failure = await page.evaluate(() => ({ sceneId: window.__worldApp?.getSceneId(), text: document.body.innerText }));
    await shot(page, 'failure');
  }
} finally {
  writeFileSync('tools/shots/polish-report.json', JSON.stringify(report, null, 2));
  await browser.close();
}

import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.CAMPUS_URL ?? 'http://127.0.0.1:5180/';
const browser = await chromium.launch({
  executablePath: 'C:/Users/AnQi/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',
  headless: true,
});
const report = { scope: ['M1: 模块1、2', 'M2: 模块3、4', 'M3: 模块5、6、7', 'M4: 模块8，水彩漫染与朝霞复位'], checks: [], screenshots: [], problems: [], diagnostics: {} };
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
  const models = await page.evaluate(async () => {
    if (!window.__worldApp) return [];
    const { getSceneDefinition } = await import('/src/scenes3d/index.ts');
    const required = getSceneDefinition(window.__worldApp.getSceneId()).requiredModels ?? [];
    return window.__worldApp.getSceneId() === 'S4' ? [...required, 'linxia', 'father'] : required;
  });
  await page.waitForFunction((ids) => ids.every((id) => window.__worldApp.hasModel(id)), models, { timeout: 60000 });
  await page.waitForLoadState('networkidle');
}
async function enter(page, sceneId, debug = false) {
  await settleAssets(page);
  await page.goto(`${base}?scene=${sceneId}${debug ? '&debug=1' : ''}`, { waitUntil: 'load' });
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
      grass: root.getObjectByName('gate-meadow-wind-grass').count,
      actorShadows: Object.values(actors).filter((actor) => actor.userData.actorModelId).map((actor) => {
        const meshes = [];
        actor.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push({ cast: object.castShadow, receive: object.receiveShadow }); });
        return { model: actor.userData.actorModelId, meshes };
      }),
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
  check('S5 草海保留2800–3200簇', geometry.grass >= 2800 && geometry.grass <= 3200, geometry.grass);
  check('S5 群众不投影而主角投影，全员接收阴影', geometry.actorShadows.length > 0 && geometry.actorShadows.every((actor) => actor.meshes.length > 0 && actor.meshes.every((mesh) => mesh.receive && mesh.cast === ['linxia', 'father', 'fatherCarry'].includes(actor.model))), geometry.actorShadows);
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
async function deskChecks(page) {
  const details = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { getSceneDefinition } = await import('/src/scenes3d/index.ts');
    const root = new THREE.Group();
    const definition = getSceneDefinition('S7');
    const { actors } = definition.build(root);
    root.updateMatrixWorld(true);
    const named = [];
    root.traverse((object) => { if (object.name) named.push(object.name); });
    const result = {
      volunteer: actors.volunteer.position.toArray(),
      collision: definition.nav.obstacles.find((box) => box.id === 'desk-volunteer'),
      medicine: definition.interactables.find((item) => item.id === 'medicine-bag').position,
      form: definition.hotspots.find((item) => item.id === 'reason-form').position,
      models: definition.requiredModels,
      students: Object.values(actors).filter((actor) => ['studentFemale', 'studentMale'].includes(actor.userData.actorModelId)).map((actor) => ({ model: actor.userData.actorModelId, position: actor.position.toArray(), loaded: !!actor.getObjectByName('actor-pose') })),
      named,
      tentPosts: root.getObjectByName('desk-tent-posts').count,
      braces: root.getObjectByName('desk-tent-cross-braces').count,
      clothVertices: root.getObjectByName('desk-tablecloth-front').geometry.getAttribute('position').count,
      stationery: root.getObjectByName('desk-cup-stationery').count,
      guidePages: ['teal', 'ochre'].map((color) => root.getObjectByName(`desk-guide-${color}-white-pages`).count),
      supplyOpening: new THREE.Raycaster(new THREE.Vector3(-2.55, 1.5, -4.25), new THREE.Vector3(0, -1, 0)).intersectObject(root.getObjectByName('desk-open-supply-box'), true)[0]?.object.name,
      schoolWindows: root.getObjectByName('desk-school-reflective-glass').count,
      warmWindows: root.getObjectByName('desk-school-warm-interior-windows').count,
      lamps: root.getObjectByName('desk-courtyard-lamp-poles').count,
      trees: root.getObjectByName('desk-campus-tree-trunks').count,
    };
    const { SHARED_RESOURCE_FLAG } = await import('/src/world/resources.ts');
    const geometries = new Set(), materials = new Set();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return;
      if (!object.geometry.userData[SHARED_RESOURCE_FLAG]) geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (!material.userData[SHARED_RESOURCE_FLAG]) materials.add(material);
    });
    geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose());
    return result;
  });
  report.diagnostics.desk = details;
  check('S7 志愿者紧贴桌后且碰撞同步', details.volunteer[0] === 0 && details.volunteer[2] === -4.68 && details.collision.minZ === -5 && details.collision.maxZ === -4.35, details);
  check('S7 登记表和药袋交互锚点保持原位', details.form.x === 0 && details.form.z === -3.56 && details.medicine.x === 1.15 && details.medicine.y === .09 && details.medicine.z === -3.15, details);
  check('S7 校内背景同学使用既有真实模型', details.students.length >= 1 && details.students.length <= 2 && details.students.every((student) => student.loaded && student.position[2] < -9), details.students);
  check('S7 帐篷骨架与褶皱桌布为完整实体', details.tentPosts === 4 && details.braces === 9 && details.clothVertices > 100, details);
  check('S7 两摞指南、文具、挂绳杯板齐备且纸箱真实开口', details.guidePages.every((count) => count === 3) && details.stationery === 8 && details.supplyOpening === 'desk-supply-bottom' && ['desk-lanyard-box', 'desk-volunteer-flask', 'desk-volunteer-clipboard', 'desk-welcome-rollup'].every((name) => details.named.includes(name)), details);
  check('S7 校园背景三层反光窗、暖窗、树灯与围墙完整', details.schoolWindows === 43 && details.warmWindows === 11 && details.lamps === 6 && details.trees === 8 && details.named.includes('desk-campus-enclosing-walls'), details);
  await page.evaluate(() => window.__worldApp.teleport(0, -1.6, 0));
  await shot(page, 'S7-welcome-registration');
  await page.evaluate(() => window.__worldApp.teleport(-3.3, -2, -35));
  await shot(page, 'S7-tent-desk-details');
  await page.evaluate(() => window.__worldApp.teleport(3.3, -3, 25));
  await shot(page, 'S7-campus-background');
  check('S7 药袋选项期间真正开放移动控制', await page.evaluate(() => window.__worldApp.getPlayerPosition().enabled));
  await page.evaluate(async () => {
    const { eventBus } = await import('/src/core/eventBus.ts');
    window.__polishBagPicked = false;
    eventBus.on('state:changed', ({ state }) => { if (state.picked) window.__polishBagPicked = true; });
  });
  await page.evaluate(() => window.__worldApp.teleport(1.15, -1.6, 0));
  const startFeet = await page.evaluate(() => window.__worldApp.getPlayerPosition().feet);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(200);
  await page.keyboard.up('KeyW');
  check('S7 选项保留时仍能实际前行', await page.evaluate((start) => window.__worldApp.getPlayerPosition().feet.z < start.z - .1, startFeet));
  // 靠近光点后按 E：命中 1.8m 近距拾取（与真实玩家走向发光药袋再按 E 一致），不依赖指针锁定。
  await page.evaluate(() => window.__worldApp.teleport(1.15, -1.95, 0));
  await page.waitForTimeout(120);
  await page.keyboard.press('KeyE');
  await page.getByRole('button', { name: '给你。', exact: true }).waitFor();
  check('S7 靠近药袋按 E 真正拾取并进入交还选项', await page.evaluate(() => window.__polishBagPicked));
  await page.getByRole('button', { name: '给你。', exact: true }).click();
  await page.locator('.dialogue:not([hidden])').waitFor();
  await page.evaluate(() => window.__worldApp.teleport(0, -1.6, 0));
  await shot(page, 'S7-registration-after-return');
  await page.evaluate(() => window.__worldApp.teleport(-3.3, -2, -35));
  await shot(page, 'S7-supply-cloth-props');
}
async function bloomGpuChecks(page) {
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { applyColorBloomShader, createColorBloomUniforms } = await import('/src/scenes3d/colorBloom.ts');
    const { createFoliageWindMaterial, createCampusMeadow } = await import('/src/scenes3d/foliageWind.ts');
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(64, 64);
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 1);
    const gl = renderer.getContext();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 20);
    camera.position.set(0, 8, -12);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, -12);
    const cases = [
      ['standard', 'mesh', false], ['standard', 'instance', false], ['standard', 'batch', false],
      ['lambert', 'mesh', false], ['lambert', 'instance', false], ['lambert', 'batch', false],
      ['standard', 'instance', true], ['standard', 'batch', true], ['lambert', 'instance', true],
    ];
    const results = [];
    try {
      for (const [kind, branch, wind] of cases) {
        const scene = new THREE.Scene();
        scene.add(new THREE.AmbientLight(0xffffff, 2));
        const geometry = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
        const source = kind === 'standard'
          ? new THREE.MeshStandardMaterial({ color: 0x579e48, roughness: 1 })
          : new THREE.MeshLambertMaterial({ color: 0x579e48 });
        let material = source;
        if (wind && kind === 'standard') material = createFoliageWindMaterial(source, { value: 0 });
        if (wind && kind === 'lambert') {
          const meadowRoot = new THREE.Group();
          const meadow = createCampusMeadow(meadowRoot, 'gpu-test', [{ x: 0, z: 0, width: 1, depth: 1, y: 0, density: 1, flowers: 1 }], { value: 0 });
          material = meadow.grass.material;
          material.color.setHex(0x579e48);
          for (const mesh of [meadow.grass, meadow.flowers]) {
            mesh.geometry.dispose();
            if (mesh.material !== material) mesh.material.dispose();
          }
        }
        const uniforms = createColorBloomUniforms();
        applyColorBloomShader(material, uniforms);
        let mesh;
        const transform = new THREE.Matrix4().makeTranslation(0, 0, -12);
        if (branch === 'instance') {
          mesh = new THREE.InstancedMesh(geometry, material, 1);
          mesh.setMatrixAt(0, transform);
          mesh.instanceMatrix.needsUpdate = true;
        } else if (branch === 'batch') {
          mesh = new THREE.BatchedMesh(1, geometry.getAttribute('position').count, geometry.index.count, material);
          mesh.setMatrixAt(mesh.addInstance(mesh.addGeometry(geometry)), transform);
        } else {
          mesh = new THREE.Mesh(geometry, material);
          mesh.position.z = -12;
        }
        scene.add(mesh);
        const sample = () => {
          renderer.render(scene, camera);
          const rgba = new Uint8Array(4);
          gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
          return Array.from(rgba);
        };
        const cold = sample();
        uniforms.uRevealedZ.value = -20;
        const warm = sample();
        uniforms.uPlayerPos.value.set(0, 0, 8);
        uniforms.uCompanionPos.value.set(1, 0, 9);
        uniforms.uBloomTime.value = 1000;
        const retained = sample();
        results.push({ kind, branch, wind, cold, warm, retained, glError: gl.getError(),
          programs: renderer.info.programs.map((program) => ({ runnable: program.diagnostics?.runnable ?? true })) });
        scene.remove(mesh);
        if (mesh.isInstancedMesh || mesh.isBatchedMesh) mesh.dispose();
        geometry.dispose();
        material.dispose();
        if (source !== material) source.dispose();
      }
      return results;
    } finally {
      renderer.dispose();
      renderer.domElement.width = 0;
      renderer.domElement.height = 0;
    }
  });
  report.diagnostics.bloomGpu = results;
  check('水彩普通/实例/批次及风草链实际 GPU 编译零错误', results.length === 9 && results.every((result) => result.glError === 0 && result.programs.every((program) => program.runnable)), results);
  const saturation = (rgba) => Math.max(...rgba.slice(0, 3)) - Math.min(...rgba.slice(0, 3));
  check('九种真实世界坐标着色均由冷灰恢复彩色', results.every((result) => saturation(result.warm) > saturation(result.cold) + 12 && result.warm[3] === 255), results);
  check('GPU 回头与长时间流动不让已走区域褪色', results.every((result) => result.warm.every((channel, i) => channel === result.retained[i])), results);
}
async function particleGpuChecks(page) {
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const source = window.__worldApp.getAirParticles();
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(64, 64);
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x132026, 0);
    const material = source.material.clone();
    material.size = 24;
    material.opacity = .9;
    const shape = { value: 0 };
    material.onBeforeCompile = (shader, renderer) => {
      source.material.onBeforeCompile(shader, renderer);
      shader.uniforms.uAirShape = shape;
      shader.uniforms.uAirTime = { value: 0 };
    };
    material.customProgramCacheKey = () => `${source.material.customProgramCacheKey()}:visual-test`;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute([1, .75, .65], 3));
    geometry.setAttribute('airType', new THREE.Float32BufferAttribute([0], 1));
    const scene = new THREE.Scene();
    const points = new THREE.Points(geometry, material);
    scene.add(points);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10);
    camera.position.z = 2;
    const gl = renderer.getContext();
    const masks = [];
    try {
      for (const [type, progress] of [[0, 0], [1, 1], [2, 1]]) {
        geometry.getAttribute('airType').setX(0, type);
        geometry.getAttribute('airType').needsUpdate = true;
        shape.value = progress;
        renderer.render(scene, camera);
        const pixels = new Uint8Array(64 * 64 * 4);
        gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const samples = [];
        for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) if (pixels[(y * 64 + x) * 4 + 3] > 20) samples.push([x, y]);
        const cx = samples.reduce((sum, [x]) => sum + x, 0) / samples.length;
        const cy = samples.reduce((sum, [, y]) => sum + y, 0) / samples.length;
        let xx = 0, yy = 0, xy = 0;
        for (const [x, y] of samples) { xx += (x - cx) ** 2; yy += (y - cy) ** 2; xy += (x - cx) * (y - cy); }
        const delta = Math.sqrt((xx - yy) ** 2 + 4 * xy ** 2);
        masks.push({ type, count: samples.length, anisotropy: (xx + yy + delta) / (xx + yy - delta), glError: gl.getError() });
      }
      renderer.setSize(192, 64);
      camera.left = -3; camera.right = 3; camera.updateProjectionMatrix();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([-2, 0, 0, 0, 0, 0, 2, 0, 0], 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute([1, .75, .4, 1, .65, .78, .65, .9, .5], 3));
      geometry.setAttribute('airType', new THREE.Float32BufferAttribute([0, 1, 2], 1));
      geometry.computeBoundingSphere();
      shape.value = 1;
      renderer.render(scene, camera);
      return { masks, image: renderer.domElement.toDataURL('image/png'), sourceCount: source.geometry.getAttribute('position').count };
    } finally {
      geometry.dispose(); material.dispose(); renderer.dispose();
      renderer.domElement.width = 0; renderer.domElement.height = 0;
    }
  });
  report.diagnostics.particleGpu = { masks: result.masks, sourceCount: result.sourceCount };
  check('48粒子原生材质实际GPU呈现圆形光尘与非圆形花瓣嫩叶', result.sourceCount === 48 && result.masks.every((mask) => mask.glError === 0 && mask.count > 30) && result.masks[0].anisotropy < 1.1 && result.masks.slice(1).every((mask) => mask.anisotropy > 1.8), result.masks);
  const path = 'tools/shots/polish-S8-particle-shapes-gpu.png';
  writeFileSync(path, Buffer.from(result.image.split(',')[1], 'base64'));
  report.screenshots.push(path);
}
function atmosphereSnapshot(diagnostics) {
  return {
    sky: diagnostics.skyColors, sun: diagnostics.sunColor, intensity: diagnostics.sunIntensity,
    fog: diagnostics.fogColor, colors: diagnostics.particleColors, shape: diagnostics.shapeProgress,
  };
}
async function moveToZ(page, key, z, decreasing = true) {
  await page.keyboard.down(key);
  try {
    await page.waitForFunction(({ z, decreasing }) => {
      const feet = window.__worldApp.getPlayerPosition().feet;
      return decreasing ? feet.z <= z : feet.z >= z;
    }, { z, decreasing }, { timeout: 40000 });
  } finally { await page.keyboard.up(key); }
}
async function debugJump(page, sceneId, sceneKey) {
  await settleAssets(page);
  await page.locator('.debug-toggle').click();
  await page.locator(`.debug-panel__jump[data-scene-id="${sceneId}"]`).click();
  await page.locator('.debug-panel__close').click();
  await page.waitForFunction(({ sceneId, sceneKey }) => {
    const diagnostics = window.__worldApp.getVisualDiagnostics();
    return diagnostics.sceneId === sceneId && diagnostics.sceneKey === sceneKey;
  }, { sceneId, sceneKey }, { timeout: 60000 });
  await page.waitForFunction(() => Number.parseFloat(getComputedStyle(document.querySelector('.scene-fade')).opacity) < .05, null, { timeout: 60000 });
  await settleAssets(page);
}
async function bloomStoryChecks(page) {
  await page.evaluate(() => { window.__polishWorldIdentity = window.__worldApp; });
  const cold = await page.evaluate(() => window.__worldApp.getVisualDiagnostics());
  report.diagnostics.bloomCold = cold;
  check('S8 起点冷灰，景观共享漫染且皮肤与楼牌不被染色', cold.atmosphereProgress < .2 && cold.shapeProgress === 0 && cold.colorBloom.shared && cold.colorBloom.characterBloomCount === 0 && cold.colorBloom.materials.length >= 10, cold.colorBloom);
  await shot(page, 'S8-cold-start');
  await bloomGpuChecks(page);
  await moveToZ(page, 'KeyW', -25);
  const middle = await page.evaluate(() => window.__worldApp.getVisualDiagnostics());
  check('真实键盘同行脚底推进已走边界和天空', middle.colorBloom.player[2] <= -25 && middle.colorBloom.player[1] === 0 && middle.colorBloom.revealedZ <= -25 && middle.atmosphereProgress > .5, middle.colorBloom);
  await shot(page, 'S8-watercolor-middle');
  await moveToZ(page, 'KeyW', -38);
  await page.waitForFunction(() => window.__worldApp.getActorPosition('linxia')[2] <= -40, null, { timeout: 60000 });
  const warm = await page.evaluate(() => window.__worldApp.getVisualDiagnostics());
  report.diagnostics.bloomWarm = warm;
  check('S8 后半段金粉朝霞、转暖晨光与金尘粉瓣渐变', warm.atmosphereProgress > .9 && warm.shapeProgress > .85 && warm.skyColors.mid !== cold.skyColors.mid && warm.skyColors.cloudHighlight !== cold.skyColors.cloudHighlight && warm.sunColor !== cold.sunColor && warm.particleTypeDistribution.petal === 8 && warm.particleTypeDistribution.leaf === 8 && warm.particleTypeDistribution.dust === 32, atmosphereSnapshot(warm));
  check('S8 演出没有新增桌面后处理Pass', warm.postprocessingPasses === 3, warm.postprocessingPasses);
  await shot(page, 'S8-watercolor-golden-dawn');
  await particleGpuChecks(page);
  await moveToZ(page, 'KeyS', 1.2, false);
  await page.evaluate(() => window.__worldApp.teleport(.2, 1.2, 0));
  const back = await page.evaluate(() => window.__worldApp.getVisualDiagnostics());
  report.diagnostics.bloomBacktrack = back;
  check('真实回头行走不重置脚步历史或朝霞', back.colorBloom.revealedZ <= warm.colorBloom.revealedZ && back.atmosphereProgress >= warm.atmosphereProgress && back.colorBloom.instanceId === cold.colorBloom.instanceId, back.colorBloom);
  await shot(page, 'S8-warm-start-same-view');
  await horizonChecks(page);
  await page.evaluate(() => window.__worldApp.teleport(.2, -40, 0));
  const beforeS9 = await page.evaluate(() => window.__worldApp.getVisualDiagnostics());
  await page.keyboard.down('KeyW');
  try { await page.waitForFunction(() => window.__worldApp.getSceneId() === 'S9', null, { timeout: 30000 }); }
  finally { await page.keyboard.up('KeyW'); }
  const s9 = await page.evaluate(() => window.__worldApp.getVisualDiagnostics());
  check('真实门口触发S9保留同一漫染实例和全部朝霞', s9.colorBloom.instanceId === beforeS9.colorBloom.instanceId && s9.colorBloom.revealedZ <= beforeS9.colorBloom.revealedZ && JSON.stringify(atmosphereSnapshot(s9)) === JSON.stringify(atmosphereSnapshot(beforeS9)), s9.colorBloom);
  await shot(page, 'S9-retained-dawn');
  await page.getByRole('button', { name: '不看。', exact: true }).click();
  await page.locator('.chapter-end:not([hidden])').waitFor();
  await page.getByRole('button', { name: '重新体验第一章', exact: true }).click();
  await page.waitForFunction(() => window.__worldApp.getVisualDiagnostics().sceneKey === 'room', null, { timeout: 60000 });
  await page.waitForFunction(() => Number.parseFloat(getComputedStyle(document.querySelector('.scene-fade')).opacity) < .05, null, { timeout: 60000 });
  const room = await page.evaluate(() => ({ sameWorld: window.__worldApp === window.__polishWorldIdentity, diagnostics: window.__worldApp.getVisualDiagnostics() }));
  report.diagnostics.bloomResetRoom = room;
  check('同一个WorldApp真实重开S1完全恢复天空灯光与粒子', room.sameWorld && room.diagnostics.colorBloom === null && room.diagnostics.atmosphereProgress === 0 && JSON.stringify(atmosphereSnapshot(room.diagnostics)) === JSON.stringify(report.diagnostics.defaultRoom), room);
  await shot(page, 'S1-restart-atmosphere-restored');
  await debugJump(page, 'S5', 'gate');
  const gate = await page.evaluate(() => window.__worldApp.getVisualDiagnostics());
  check('同一WorldApp重入校门天空灯光雾与48粒子精确复位', gate.colorBloom === null && gate.atmosphereProgress === 0 && JSON.stringify(atmosphereSnapshot(gate)) === JSON.stringify(report.diagnostics.defaultGate), atmosphereSnapshot(gate));
  await debugJump(page, 'S8', 'building');
  const reentered = await page.evaluate(() => window.__worldApp.getVisualDiagnostics());
  check('再进S8新漫染实例从冷灰起步且无跨场景缓存污染', reentered.colorBloom.instanceId !== cold.colorBloom.instanceId && reentered.colorBloom.revealedZ > -8 && reentered.shapeProgress === 0 && reentered.atmosphereProgress < .2, reentered.colorBloom);
  await dialogue(page);
  await page.getByRole('button', { name: '你慢慢来。', exact: true }).click();
  await shot(page, 'S8-reentered-cold-reset');
}
async function horizonChecks(page) {
  const details = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { getSceneDefinition } = await import('/src/scenes3d/index.ts');
    const root = new THREE.Group();
    getSceneDefinition('S8').build(root);
    root.updateMatrixWorld(true);
    const rings = [];
    root.traverse((object) => { if (object.userData.horizonRing) rings.push(object); });
    const ring = rings[0];
    const bounds = ring ? new THREE.Box3().setFromObject(ring) : null;
    const coverage = [];
    if (ring) for (const z of [-1, -20, -43]) for (let yaw = 0; yaw < 360; yaw += 15) {
      const angle = yaw * Math.PI / 180;
      const ray = new THREE.Raycaster(new THREE.Vector3(0, 1.6, z), new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)), 0, 160);
      coverage.push({ z, yaw, hit: ray.intersectObject(ring, true).length > 0 });
    }
    const result = { rings: rings.length, instanced: ring instanceof THREE.InstancedMesh, count: ring?.count, bounds: bounds ? { min: bounds.min.toArray(), max: bounds.max.toArray() } : null, coverage };
    const { SHARED_RESOURCE_FLAG } = await import('/src/world/resources.ts');
    const geometries = new Set(), materials = new Set();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (!object.geometry.userData[SHARED_RESOURCE_FLAG]) geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (!material.userData[SHARED_RESOURCE_FLAG]) materials.add(material);
    });
    geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose());
    return result;
  });
  report.diagnostics.horizon = details;
  check('S8 层叠远山单实例批次覆盖校园四周', details.rings === 1 && details.instanced && details.count >= 48 && details.bounds.min[0] < -55 && details.bounds.max[0] > 55 && details.bounds.min[2] < -70 && details.bounds.max[2] > 25, details);
  check('S8 起中终点每15度树缝视线均有远山封边', details.coverage.length === 72 && details.coverage.every((sample) => sample.hit), details.coverage.filter((sample) => !sample.hit));
  await page.evaluate(() => window.__worldApp.teleport(0, -32, 0));
  await shot(page, 'S8-linked-corridors');
  for (const [side, yaw] of [['left', 35], ['right', -35]]) {
    await page.evaluate((yaw) => window.__worldApp.teleport(0, -32, yaw), yaw);
    await shot(page, `S8-complete-corridor-${side}`);
  }
  for (const [name, yaw] of [['west', 90], ['east', -90], ['rear', 180]]) {
    await page.evaluate((yaw) => window.__worldApp.teleport(0, -20, yaw), yaw);
    await shot(page, `S8-horizon-${name}`);
  }
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
  report.diagnostics.defaultRoom = atmosphereSnapshot(await page.evaluate(() => window.__worldApp.getVisualDiagnostics()));
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
  report.diagnostics.defaultGate = atmosphereSnapshot(await page.evaluate(() => window.__worldApp.getVisualDiagnostics()));
  await gateChecks(page);
  await enter(page, 'S7');
  await dialogue(page);
  for (const name of ['你先写吧。', '路上耽搁了。']) await page.getByRole('button', { name, exact: true }).click();
  await waitObjective(page, 'S7');
  await deskChecks(page);
  await enter(page, 'S8', true);
  await dialogue(page);
  await page.getByRole('button', { name: '我陪你走一段。', exact: true }).click();
  await waitObjective(page, 'S8');
  await bloomStoryChecks(page);
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
  await enter(mobile, 'S8');
  await dialogue(mobile);
  await mobile.getByRole('button', { name: '我陪你走一段。', exact: true }).click();
  const mobileCold = await mobile.evaluate(() => window.__worldApp.getVisualDiagnostics());
  await shot(mobile, 'S8-mobile-cold-start');
  await mobile.evaluate(() => window.__worldApp.teleport(.2, -36, 0));
  await mobile.waitForFunction(() => window.__worldApp.getActorPosition('linxia')[2] <= -40, null, { timeout: 60000 });
  const mobileWarm = await mobile.evaluate(() => window.__worldApp.getVisualDiagnostics());
  report.diagnostics.mobileBloom = { cold: mobileCold, warm: mobileWarm };
  check('触屏S8运行同款GPU漫染朝霞与粉瓣且始终零后处理', mobileWarm.atmosphereProgress > .9 && mobileWarm.shapeProgress > .85 && mobileCold.postprocessingPasses === 0 && mobileWarm.postprocessingPasses === 0 && mobileWarm.colorBloom.shared && mobileWarm.colorBloom.characterBloomCount === 0, report.diagnostics.mobileBloom);
  await shot(mobile, 'S8-mobile-watercolor-dawn');
  await mobile.setViewportSize({ width: 390, height: 844 });
  const portrait = await mobile.evaluate(() => ({
    ratio: document.querySelector('canvas').width / document.querySelector('canvas').clientWidth,
    overflow: document.documentElement.scrollWidth > innerWidth,
    padding: Number.parseFloat(getComputedStyle(document.querySelector('.dialogue')).paddingBottom),
    diagnostics: window.__worldApp.getVisualDiagnostics(),
  }));
  check('漫染朝霞竖屏切换仍保留1.5像素比、安全区与零Pass', portrait.ratio <= 1.5 && !portrait.overflow && portrait.padding >= 48 && portrait.diagnostics.postprocessingPasses === 0 && portrait.diagnostics.atmosphereProgress >= mobileWarm.atmosphereProgress, portrait);
  await shot(mobile, 'S8-portrait-watercolor-dawn');
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

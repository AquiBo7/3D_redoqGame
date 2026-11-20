// 真实 Three 几何/导航/射线测试；只替代下载边界与 Canvas，不替代角色工厂。
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import { createInitialStoryState } from '../core/state';
import type { SceneId } from '../data/storySchema';
import { isInsideBounds, resolveMovement, type Vec2 } from '../world/navMath';
import * as resources from '../world/resources';
import type { SceneRuntimeContext } from '../world/worldSceneTypes';
import { getCharacterModel } from './modelManifest';
import { INTERIOR_LOCATIONS as L, createSchoolInteriorDefinition, schoolInteriorRuntime as runtime } from './schoolInterior';

const IDS = ['C2', 'C4', 'C5', 'C6', 'D1', 'D6'] as const;
const roots: THREE.Object3D[] = [];
const printed: string[] = [];
beforeEach(() => {
  printed.length = 0;
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ fillRect() {}, fillText(text: string) { printed.push(text); } }),
  }) });
  vi.spyOn(resources, 'loadCharacterModel').mockImplementation(() => new Promise(() => {}));
});
function disposeTree(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    if (!node.geometry.userData.sharedResource) node.geometry.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material])
      if (!material.userData.sharedResource) material.dispose();
  });
  root.clear();
}
afterEach(() => {
  runtime.exit();
  roots.forEach(disposeTree); roots.length = 0;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function build(id: SceneId = 'C2') {
  const root = new THREE.Scene(); roots.push(root);
  const definition = createSchoolInteriorDefinition(id);
  const result = definition.build(root);
  const actors = result.actors!;
  root.updateMatrixWorld(true);
  return { root, definition, result, actors };
}
function context(actors: Record<string, THREE.Object3D>, sceneId: SceneId = 'C5'): SceneRuntimeContext {
  return { sceneId, actors, bus: new EventBus(), setInteractableVisible: vi.fn() };
}
function recognize(ctx: SceneRuntimeContext, ids = L.students.map(({ id }) => id)): void {
  ctx.bus.emit('ui:showChoices', { stepId: 'c5-recognize', allowMovement: true, options: ids.map((id) => ({ id, text: id })) });
}
function state(ctx: SceneRuntimeContext, sceneId = ctx.sceneId, noticedTyper = true, joined = false): void {
  ctx.bus.emit('state:changed', { sceneId, role: 'bystander', state: { ...createInitialStoryState(), noticedTyper, joined }, changedKeys: ['noticedTyper', 'joined'] });
}
function mesh(root: THREE.Object3D, name: string): THREE.Mesh {
  const result = root.getObjectByName(name);
  expect(result, name).toBeInstanceOf(THREE.Mesh);
  return result as THREE.Mesh;
}
function allResources(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>(); const instances = new Set<THREE.InstancedMesh>();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    if (node instanceof THREE.InstancedMesh) instances.add(node);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      Object.values(material).forEach((v) => { if (v instanceof THREE.Texture) textures.add(v); });
    }
  });
  return { geometries, materials, textures, instances };
}

describe('共享教学楼契约', () => {
  it('无 DOM definition 不启动加载/订阅/计时器；六场共享同一个 build，模型 ID 全部有效且实际使用', () => {
    vi.stubGlobal('document', undefined);
    const timer = vi.spyOn(globalThis, 'setInterval');
    const definitions = IDS.map(createSchoolInteriorDefinition);
    for (const d of definitions) {
      expect(d.sceneKey).toBe('interior'); expect(d.build).toBe(definitions[0].build);
      expect(d.footstepSurface).toBe('stone');
      d.requiredModels!.forEach((id) => expect(getCharacterModel(id).path).toMatch(/^\.\/models\/chr_/));
    }
    expect(resources.loadCharacterModel).not.toHaveBeenCalled(); expect(timer).not.toHaveBeenCalled();
    expect(() => createSchoolInteriorDefinition('S1')).toThrow();
    definitions[0].nav.obstacles.length = 0; definitions[0].spawn.x = 999;
    expect(createSchoolInteriorDefinition('C2').nav.obstacles.length).toBeGreaterThan(10);
    expect(createSchoolInteriorDefinition('C2').spawn.x).toBe(L.spawns.C2.x);
  });
  it('仅对应场景提供准确交互/区域 ID，D1 提供近景锚点', () => {
    expect(createSchoolInteriorDefinition('C2').interactables!.map((p) => p.id)).toEqual(['seat-beside', 'seat-front', 'seat-far']);
    expect(createSchoolInteriorDefinition('C5').interactables!.map((p) => p.id)).toEqual(L.students.map((p) => p.id));
    for (const [id, zone] of [['C4', 'stairwell-corner'], ['C6', 'night-phone'], ['D1', 'platform-ayuan'], ['D6', 'corridor-linxia']] as const) {
      const d = createSchoolInteriorDefinition(id);
      expect(d.zones!.map((z) => z.id)).toEqual([zone]); expect(d.interactables).toEqual([]);
    }
    expect(createSchoolInteriorDefinition('D1').panoramaAnchor!.lookAt.x).toBe(L.platformActor.x);
  });
});

describe('真实 Three 建筑与资源', () => {
  it('水磨石、闭合屋顶墙窗、黑板桌椅、速写本铅笔、窗外绿植和七个工厂演员', () => {
    const { root, definition, actors } = build();
    for (const name of ['roof', 'interior-walls', 'window-pane', 'blackboard', 'podium', 'stairwell-flight',
      'sketchbook-cover', 'sketchbook-page', 'pencil', 'pencilled-window-study', 'window-greenery']) expect(root.getObjectByName(name), name).toBeDefined();
    expect(printed).toContain('二楼 · 教室'); expect(printed).toContain('侧楼梯 · 平台');
    const floor = mesh(root, 'interior-terrazzo-floor');
    expect((floor.material as THREE.MeshStandardMaterial).map).toBeInstanceOf(THREE.DataTexture);
    expect(new THREE.Box3().setFromObject(floor).max.y).toBeCloseTo(0);
    expect(actors['student-4']).toBe(actors.ayuan);
    const modelIds = new Set<string>(); let people = 0;
    root.traverse((node) => {
      expect(node.castShadow).toBe(false);
      if (node.userData.actorModelId) { modelIds.add(node.userData.actorModelId); people += 1; }
      if (node instanceof THREE.Mesh) expect(Array.from(node.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
    });
    expect(people).toBe(7); expect([...modelIds].sort()).toEqual([...definition.requiredModels!].sort());
    expect(getCharacterModel(actors.linxia.userData.actorModelId).path).toBe('./models/chr_linxia.glb');
    for (const { id } of L.students) {
      const phone = actors[id].getObjectByName('actor-props')!.children[0] as THREE.Mesh;
      expect(phone.geometry).toBeInstanceOf(THREE.BoxGeometry);
      const color = (phone.material as THREE.MeshStandardMaterial).color.getHex();
      expect(color === 0xcd793c).toBe(id === 'student-4');
    }
    expect(root.getObjectByName('orange-phone-screen')).toBeDefined();
    // 从教室、走廊、平台中心，水平四周与正上方均能命中封闭外壳。
    for (const origin of [new THREE.Vector3(-4, 1.6, 6), new THREE.Vector3(3, 1.6, 0), new THREE.Vector3(7, 1.6, 5)]) {
      for (let a = 0; a < 32; a += 1) {
        const ray = new THREE.Raycaster(origin, new THREE.Vector3(Math.cos(a * Math.PI / 16), 0, Math.sin(a * Math.PI / 16)), 0, 40);
        expect(ray.intersectObject(root.getObjectByName('interior-walls')!, true).length).toBeGreaterThan(0);
      }
      expect(new THREE.Raycaster(origin, new THREE.Vector3(0, 1, 0), 0, 5).intersectObject(root.getObjectByName('roof')!).length).toBeGreaterThan(0);
    }
  });
  it('重复 build 无本地共享泄漏；WorldApp 清理规则释放全部 owned 资源和实例缓冲', () => {
    const a = build(); const b = build(); const ar = allResources(a.root); const br = allResources(b.root);
    const disposed = new Set<unknown>();
    ar.geometries.forEach((r) => r.addEventListener('dispose', () => disposed.add(r)));
    ar.materials.forEach((r) => r.addEventListener('dispose', () => disposed.add(r)));
    ar.textures.forEach((r) => r.addEventListener('dispose', () => disposed.add(r)));
    ar.instances.forEach((r) => r.addEventListener('dispose', () => disposed.add(r)));
    const instanceSpies = [...ar.instances].map((r) => vi.spyOn(r, 'dispose'));
    for (const r of ar.geometries) expect(br.geometries.has(r)).toBe(false);
    for (const r of ar.materials) expect(br.materials.has(r)).toBe(false);
    for (const r of ar.textures) expect(br.textures.has(r)).toBe(false);
    disposeTree(a.root);
    for (const set of Object.values(ar)) for (const r of set) expect(disposed.has(r)).toBe(true);
    instanceSpies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    for (const r of br.materials) expect(disposed.has(r)).toBe(false);
  });
});

const RADIUS = 0.32;
/** 网格 BFS 用真实 movement 验证连接，不允许跨薄墙或只证明目标位于矩形内。 */
function walkableGrid(id: SceneId) {
  const d = createSchoolInteriorDefinition(id); const { nav } = d;
  const points = new Map<string, Vec2>(); const step = 0.2;
  for (let ix = -42; ix <= 47; ix += 1) for (let iz = -42; iz <= 42; iz += 1) {
    const p = { x: ix * step, z: iz * step };
    if (!isInsideBounds(p, nav.bounds) || nav.obstacles.some((o) => p.x > o.minX - RADIUS + 1e-6 && p.x < o.maxX + RADIUS - 1e-6 && p.z > o.minZ - RADIUS + 1e-6 && p.z < o.maxZ + RADIUS - 1e-6)) continue;
    points.set(`${ix},${iz}`, p);
  }
  const first = [...points].sort((a, b) => Math.hypot(a[1].x - d.spawn.x, a[1].z - d.spawn.z) - Math.hypot(b[1].x - d.spawn.x, b[1].z - d.spawn.z))[0][0];
  const queue = [first]; const reached = new Set(queue);
  for (let i = 0; i < queue.length; i += 1) {
    const [x, z] = queue[i].split(',').map(Number);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${x + dx},${z + dz}`;
      if (reached.has(key) || !points.has(key)) continue;
      const from = points.get(queue[i])!; const to = points.get(key)!;
      const end = resolveMovement(from, { x: to.x - from.x, z: to.z - from.z }, nav.bounds, nav.obstacles, RADIUS);
      if (Math.hypot(end.x - to.x, end.z - to.z) > 1e-6) continue;
      reached.add(key); queue.push(key);
    }
  }
  expect(reached.size).toBe(points.size);
  return { d, points, reached };
}
describe('教学楼导航与无遮挡目标', () => {
  it.each(IDS)('%s：全导航连通、出生远离区域、目标接近点可达且无遮挡', (id) => {
    const { d, points, reached } = walkableGrid(id);
    const { root, result, actors } = build(id); runtime.enter(context(actors, id)); root.updateMatrixWorld(true);
    const targets = id === 'C2' ? L.seats.map((seat, i) => ({ approach: seat.approach, interaction: d.interactables![i] }))
      : id === 'C5' ? L.students.map((p, i) => ({ approach: p.approach, interaction: d.interactables![i] })) : [];
    const approaches: Vec2[] = [...targets.map((t) => t.approach), ...d.zones!.map((z) => z.center), L.classroomDoor, L.stairwellDoor];
    for (const p of approaches) {
      const nearest = [...points].sort((a, b) => Math.hypot(a[1].x - p.x, a[1].z - p.z) - Math.hypot(b[1].x - p.x, b[1].z - p.z))[0];
      expect(reached.has(nearest[0])).toBe(true);
      const end = resolveMovement(nearest[1], { x: p.x - nearest[1].x, z: p.z - nearest[1].z }, d.nav.bounds, d.nav.obstacles, RADIUS);
      expect(end.x).toBeCloseTo(p.x); expect(end.z).toBeCloseTo(p.z);
    }
    for (const zone of d.zones!) {
      expect(zone.kind).toBe('circle');
      expect(Math.hypot(d.spawn.x - zone.center.x, d.spawn.z - zone.center.z)).toBeGreaterThan(2);
    }
    for (const { approach, interaction } of targets) {
      const eye = new THREE.Vector3(approach.x, 1.6, approach.z);
      const p = interaction.position; const target = new THREE.Vector3(p.x, p.y + interaction.lightOffsetY!, p.z);
      const distance = eye.distanceTo(target);
      expect(distance).toBeLessThan(interaction.maxDistance!);
      expect(new THREE.Raycaster(eye, target.sub(eye).normalize(), 0, distance - 0.08).intersectObjects(result.occluders, true)).toHaveLength(0);
    }
    if (d.panoramaAnchor) {
      const a = d.panoramaAnchor; const from = new THREE.Vector3(a.position.x, a.position.y, a.position.z);
      const target = new THREE.Vector3(a.lookAt.x, a.lookAt.y, a.lookAt.z);
      const distance = from.distanceTo(target);
      expect(distance).toBeLessThan(2);
      expect(new THREE.Raycaster(from, target.sub(from).normalize(), 0, distance - 0.08).intersectObjects(result.occluders, true)).toHaveLength(0);
    }
  });
  it('墙/桌椅/楼梯/同学的碰撞不可穿过', () => {
    const d = createSchoolInteriorDefinition('C5'); const nav = d.nav;
    const move = (from: Vec2, delta: Vec2) => resolveMovement(from, delta, nav.bounds, nav.obstacles, RADIUS);
    expect(move({ x: 3, z: 0 }, { x: -5, z: 0 }).x).toBeGreaterThan(1.4);
    expect(move({ x: -5.3, z: 4 }, { x: -3, z: 0 }).x).toBeGreaterThan(-6);
    expect(move({ x: 7, z: -5 }, { x: 2, z: 0 }).x).toBeLessThan(7.2);
    expect(move({ x: 2.7, z: -4 }, { x: 2, z: 0 }).x).toBeLessThan(3.44);
  });
});

describe('局部 runtime 与过期订阅', () => {
  it('异步加载完成后使用最近的只读快照初始化橙色线索和并肩演员', () => {
    const { actors } = build('C5');
    const ctx = context(actors);
    ctx.storyFlags = { noticedTyper: true, joined: true };
    runtime.enter(ctx);
    expect((actors['orange-phone-hint'] as THREE.PointLight).intensity).toBe(0.09);
    runtime.enter({ ...ctx, sceneId: 'D6' });
    expect(actors.ayuan.visible).toBe(true);
    expect(ctx.storyFlags).toEqual({ noticedTyper: true, joined: true });
  });
  it('C5 初始全隐藏，仅辨认时显示可用 options，其他模态重新隐藏', () => {
    const { actors } = build('C5'); const ctx = context(actors); runtime.enter(ctx);
    const visible = vi.mocked(ctx.setInteractableVisible);
    expect(visible.mock.calls).toEqual(L.students.map(({ id }) => [id, false]));
    recognize(ctx); expect(visible.mock.calls.slice(-6)).toEqual(L.students.map(({ id }) => [id, true]));
    recognize(ctx, ['student-4']);
    expect(visible.mock.calls.slice(-6)).toEqual(L.students.map(({ id }) => [id, id === 'student-4']));
    ctx.bus.emit('ui:showDialogue', { stepId: 'c5-wrong', lines: [], speakerNames: {} });
    expect(visible.mock.calls.slice(-6).every(([, show]) => !show)).toBe(true);
    recognize(ctx); ctx.bus.emit('ui:showChoices', { stepId: 'c5-find-path', options: [] });
    expect(visible.mock.calls.slice(-6).every(([, show]) => !show)).toBe(true);
    recognize(ctx); ctx.bus.emit('ui:showArt', { stepId: 'art', assetId: 'test' });
    expect(visible.mock.calls.slice(-6).every(([, show]) => !show)).toBe(true);
  });
  it('只读 noticedTyper / joined，错 scene 忽略，无反向状态变更', () => {
    const { actors } = build('C5'); const ctx = context(actors); runtime.enter(ctx);
    const hint = actors['orange-phone-hint'] as THREE.PointLight;
    const emit = vi.spyOn(ctx.bus, 'emit');
    state(ctx, 'C4'); expect(hint.intensity).toBe(0);
    state(ctx); expect(hint.intensity).toBeGreaterThan(0); expect(hint.intensity).toBeLessThan(0.15);
    state(ctx, 'C5', false); expect(hint.intensity).toBe(0); expect(emit).toHaveBeenCalledTimes(3);
    const d6 = { ...ctx, sceneId: 'D6' as const }; runtime.enter(d6);
    expect(actors.ayuan.visible).toBe(false); state(d6, 'D6', false, true); expect(actors.ayuan.visible).toBe(true);
    state(d6, 'D6', false, false); expect(actors.ayuan.visible).toBe(false);
  });
  it('同 key 连续进入按配置重摆角色、坐姿/电话与日夜夕阳灯光均正确恢复', () => {
    const { actors } = build(); const ctx = context(actors, 'C2');
    runtime.enter(ctx); expect(actors.linxia.visible).toBe(true); expect(actors.ayuan.visible).toBe(false);
    expect(actors.linxia.position.z).toBe(L.linxiaDesk.z);
    expect(actors.linxia.getObjectByName('actor-props')!.visible).toBe(false);
    expect(actors.linxia.getObjectByName('seated-fallback-legs')!.visible).toBe(true);
    const day = (actors['interior-fill'] as THREE.Light).intensity;
    runtime.enter({ ...ctx, sceneId: 'C4' });
    expect(actors.linxia.position.x).toBe(L.stairwellActor.x); expect(actors.linxia.getObjectByName('actor-props')!.visible).toBe(true);
    expect(actors.linxia.getObjectByName('seated-fallback-legs')!.visible).toBe(false);
    runtime.enter({ ...ctx, sceneId: 'C6' });
    expect(actors.linxia.visible).toBe(false); expect(actors.ayuan.visible).toBe(true);
    expect((actors['interior-fill'] as THREE.Light).intensity).toBeLessThan(day);
    expect((actors['orange-phone-hint'] as THREE.Light).intensity).toBeGreaterThan(0.2);
    runtime.enter({ ...ctx, sceneId: 'D1' });
    expect(actors.ayuan.position.z).toBe(L.platformActor.z); expect((actors['interior-sunset'] as THREE.Light).intensity).toBeGreaterThan(0);
    runtime.enter(ctx); expect((actors['interior-fill'] as THREE.Light).intensity).toBe(day);
    expect((actors['interior-sunset'] as THREE.Light).intensity).toBe(0);
  });
  it('重复 enter 不叠加订阅，旧 bus/已取消回调/错场景和 exit 后 tick 均无效', () => {
    const a = build('C5'); const ctx = context(a.actors); const on = vi.spyOn(ctx.bus, 'on');
    const off = vi.spyOn(ctx.bus, 'off'); runtime.enter(ctx); const count = on.mock.calls.length;
    const stale = on.mock.calls.find(([name]) => name === 'ui:showChoices')![1] as (payload: { stepId: string; options: { id: string; text: string }[] }) => void;
    runtime.enter(ctx); expect(on).toHaveBeenCalledTimes(count);
    runtime.tick!(0.05); expect(a.actors.ayuan.rotation.z).not.toBe(0);
    const next = context(build('C5').actors); runtime.enter(next); expect(off).toHaveBeenCalledTimes(count);
    vi.mocked(ctx.setInteractableVisible).mockClear(); vi.mocked(next.setInteractableVisible).mockClear();
    recognize(ctx); stale({ stepId: 'c5-recognize', options: [{ id: 'student-4', text: '' }] });
    expect(ctx.setInteractableVisible).not.toHaveBeenCalled(); expect(next.setInteractableVisible).not.toHaveBeenCalled();
    expect(a.actors.ayuan.rotation.z).toBe(0);
    runtime.enter({ ...next, sceneId: 'S1' }); vi.mocked(next.setInteractableVisible).mockClear(); recognize(next);
    runtime.tick!(0.1); expect(next.setInteractableVisible).not.toHaveBeenCalled();
    runtime.exit(); runtime.exit();
    expect(() => { runtime.enter(context({}, 'C6')); for (const dt of [NaN, Infinity, -1, 0, 0.1]) runtime.tick!(dt); runtime.exit(); }).not.toThrow();
  });
});

/** 简化可预测的真实 Three 骨架，验证工厂缓存路径/实例骨骼姿态，不假冒真实美术质量验收。 */
function rig(): THREE.Group {
  const root = new THREE.Group();
  const hip = new THREE.Bone(); hip.name = 'Hip'; hip.position.y = 0.9; root.add(hip);
  const bones = [hip];
  for (const side of ['L', 'R']) {
    const thigh = new THREE.Bone(); thigh.name = `${side}_Thigh`; thigh.position.x = side === 'L' ? -0.1 : 0.1;
    const calf = new THREE.Bone(); calf.name = `${side}_Calf`; calf.position.y = -0.4;
    const foot = new THREE.Bone(); foot.name = `${side}_Foot`; foot.position.y = -0.4;
    hip.add(thigh); thigh.add(calf); calf.add(foot); bones.push(thigh, calf, foot);
  }
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(0.3, 0.6, 0.2), new THREE.MeshStandardMaterial());
  mesh.geometry.userData.sharedResource = true; (mesh.material as THREE.Material).userData.sharedResource = true;
  const count = mesh.geometry.getAttribute('position').count;
  mesh.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = new Float32Array(count * 4); for (let i = 0; i < count; i += 1) weights[i * 4] = 1;
  mesh.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  mesh.bind(new THREE.Skeleton(bones)); root.add(mesh);
  return root;
}
describe('缓存角色与热替换资源', () => {
  it('模型就绪使用工厂真实模型根，坐姿调整实例骨骼，退出复位，释放独有 skeleton 不释放共享材质', () => {
    vi.spyOn(resources, 'hasCharacterModel').mockReturnValue(true);
    const instances: THREE.Group[] = [];
    vi.spyOn(resources, 'instantiateCharacterModel').mockImplementation(() => { const model = rig(); instances.push(model); return model; });
    const { root, actors } = build(); const ctx = context(actors, 'C2');
    const hip = actors.linxia.getObjectByName('Hip')!; const calf = actors.linxia.getObjectByName('L_Calf')!;
    const thigh = actors.linxia.getObjectByName('L_Thigh')!; const original = thigh.quaternion.clone();
    runtime.enter(ctx); root.updateMatrixWorld(true);
    expect(actors.linxia.getObjectByName('actor-fallback')).toBeUndefined();
    expect(actors.linxia.worldToLocal(hip.getWorldPosition(new THREE.Vector3())).y).toBeCloseTo(0.62);
    expect(Math.abs(calf.getWorldPosition(new THREE.Vector3()).y - thigh.getWorldPosition(new THREE.Vector3()).y)).toBeLessThan(0.04);
    runtime.exit(); expect(thigh.quaternion.equals(original)).toBe(true);
    const ownedSkeletons: THREE.Skeleton[] = [];
    root.traverse((node) => { if (node instanceof THREE.SkinnedMesh) ownedSkeletons.push(node.skeleton); });
    const spies = ownedSkeletons.map((s) => vi.spyOn(s, 'dispose'));
    const sharedMaterials = instances.map((model) => (model.children[1] as THREE.Mesh).material as THREE.Material);
    const materialSpies = sharedMaterials.map((m) => vi.spyOn(m, 'dispose'));
    disposeTree(root); spies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    materialSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    // 测试夹具扮演资源缓存，最后自行释放其持有的共享模板资源。
    instances.forEach((model) => model.traverse((node) => {
      if (node instanceof THREE.Mesh) { node.geometry.dispose(); (node.material as THREE.Material).dispose(); }
    }));
  });
  it('运行中模型晚到会重新应用坐姿；退出后不再补姿态', async () => {
    let ready = false; let finish!: (asset: resources.CharacterModelAsset) => void;
    vi.spyOn(resources, 'hasCharacterModel').mockImplementation(() => ready);
    vi.mocked(resources.loadCharacterModel).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const models: THREE.Group[] = [];
    vi.spyOn(resources, 'instantiateCharacterModel').mockImplementation(() => { const model = rig(); models.push(model); return model; });
    const { root, actors } = build(); runtime.enter(context(actors, 'C2'));
    ready = true; finish({ scene: new THREE.Group(), animations: [] });
    await Promise.resolve(); await Promise.resolve(); runtime.tick!(0.05); root.updateMatrixWorld(true);
    expect(actors.linxia.getObjectByName('actor-pose')).toBeDefined();
    expect(actors.linxia.getObjectByName('seated-fallback-legs')!.visible).toBe(false);
    expect(actors.linxia.worldToLocal(actors.linxia.getObjectByName('Hip')!.getWorldPosition(new THREE.Vector3())).y).toBeCloseTo(0.62, 2);
    runtime.exit(); disposeTree(root);
    models.forEach((model) => model.traverse((node) => {
      if (node instanceof THREE.Mesh) { node.geometry.dispose(); (node.material as THREE.Material).dispose(); }
    }));
  });
});

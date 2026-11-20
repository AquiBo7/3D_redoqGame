// 真实食堂 build / 导航 / 资源 / 事件测试；仅替代 Canvas 2D，不 mock Three.js 几何。
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import { isInsideBounds, isPointInZone, resolveMovement, type Vec2 } from '../world/navMath';
import type { SceneRuntimeContext } from '../world/worldSceneTypes';
import { CANTEEN_LOCATIONS, canteenRuntime, createCanteenDefinition } from './canteen';

const roots: THREE.Group[] = [];
let printed: string[] = [];
beforeEach(() => {
  printed = [];
  vi.stubGlobal('document', { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ fillRect: () => {}, fillText: (text: string) => printed.push(text) }),
  }) });
});

/** 与 WorldApp 一致：共享的局部几何可能多次 dispose，实例缓冲只释放一次。 */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
  });
  root.clear();
}
afterEach(() => {
  canteenRuntime.exit();
  roots.forEach(disposeTree);
  roots.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function build(sceneId: 'S12' | 'S13' = 'S12') {
  const root = new THREE.Group();
  roots.push(root);
  const definition = createCanteenDefinition(sceneId);
  const result = definition.build(root);
  root.updateMatrixWorld(true);
  return { root, definition, result, actors: result.actors! };
}
function mesh(root: THREE.Object3D, name: string): THREE.Mesh {
  const object = root.getObjectByName(name);
  expect(object, name).toBeInstanceOf(THREE.Mesh);
  return object as THREE.Mesh;
}
function context(actors: Record<string, THREE.Object3D>, sceneId: 'S12' | 'S13' = 'S12'): SceneRuntimeContext {
  return { actors, sceneId, bus: new EventBus(), setInteractableVisible: vi.fn(),
    getPlayerFeet: (target) => target.set(-3.5, 0, 5.4) };
}
function pose(actor: THREE.Object3D) {
  const motion = actor.getObjectByName('canteen-student-motion')!;
  const head = actor.getObjectByName('canteen-student-head')!;
  return { motion, head };
}
function advance(seconds = 1): void {
  for (let i = 0; i < seconds * 60; i += 1) canteenRuntime.tick!(1 / 60);
}

function resources(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const instances = new Set<THREE.InstancedMesh>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    if (object instanceof THREE.InstancedMesh) instances.add(object);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  return { geometries, materials, textures, instances };
}

const PLAYER_RADIUS = 0.32;
describe('食堂模块预载与场景数据', () => {
  it('动态 import / definition 在无 DOM 时不建资源、不请求 GLB、不启动计时器', async () => {
    vi.stubGlobal('document', undefined);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    vi.resetModules();
    const module = await import('./canteen');
    expect(module.createCanteenDefinition('S12').requiredModels).toEqual([]);
    expect(module.canteenRuntime).toHaveProperty('enter');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
  });

  it('S12/S13 共用 build，三个一次性 circle 区域仅配置于 S12，窗口与引导同 ID', () => {
    const s12 = createCanteenDefinition('S12');
    const s13 = createCanteenDefinition('S13');
    expect(s12.sceneKey).toBe('canteen');
    expect(s12.build).toBe(s13.build);
    expect(s12.zones).toEqual([
      { id: 'canteen-whisper-1', kind: 'circle', center: { x: -3.5, y: 0, z: 5.4 }, radius: 1.1, once: true },
      { id: 'canteen-whisper-2', kind: 'circle', center: { x: 0, y: 0, z: 2.4 }, radius: 1.1, once: true },
      { id: 'canteen-whisper-3', kind: 'circle', center: { x: 2.1, y: 0, z: -5.5 }, radius: 1.05, once: true },
    ]);
    expect(s13.zones).toEqual([]);
    expect(s12.interactables?.map(({ id }) => id)).toEqual(['window-three']);
    expect(s12.targetGuides).toEqual([{ id: 'window-three', position: CANTEEN_LOCATIONS.windowThree }]);
    expect(s12.footstepSurface).toBe('stone');
    // 返回配置不是可污染下一次 build 的共享可变对象。
    s12.nav.obstacles.length = 0;
    s12.spawn.x = 99;
    expect(createCanteenDefinition('S12').nav.obstacles.length).toBeGreaterThan(6);
    expect(createCanteenDefinition('S12').spawn.x).toBe(0);
  });
});

describe('食堂真实几何与行走', () => {
  it('构建完整室内、六桌二十四椅、四档口、托盘保温台、窗外绿植及九名学生', () => {
    const { root, actors } = build();
    expect(printed).toEqual(['一号窗口', '二号窗口', '三号窗口', '四号窗口']);
    expect((mesh(root, 'canteen-tabletops') as THREE.InstancedMesh).count).toBe(6);
    expect((mesh(root, 'canteen-chair-seats-backs') as THREE.InstancedMesh).count).toBe(48);
    expect((mesh(root, 'canteen-tray-stacks') as THREE.InstancedMesh).count).toBe(24);
    expect((mesh(root, 'canteen-hot-food-pans') as THREE.InstancedMesh).count).toBe(16);
    expect(root.getObjectByName('canteen-window-garden')).toBeDefined();
    expect(root.getObjectByName('canteen-ceiling')).toBeDefined();
    const floor = mesh(root, 'canteen-terrazzo-floor');
    const material = floor.material as THREE.MeshStandardMaterial;
    expect(material.map).toBeInstanceOf(THREE.DataTexture);
    expect(material.map!.repeat.toArray()).toEqual([9, 10]);
    expect(new THREE.Box3().setFromObject(floor).max.y).toBeCloseTo(0);
    expect(Object.keys(actors)).toEqual(CANTEEN_LOCATIONS.whispers.map(({ id }) => id));
    for (const crowd of Object.values(actors)) {
      expect(crowd.children).toHaveLength(3);
      for (const actor of crowd.children) expect(actor.getObjectByName('canteen-student-phone-screen')).toBeDefined();
    }
    for (let i = 1; i <= 4; i += 1) {
      const lightbox = mesh(root, `canteen-lightbox-${i}`);
      expect((lightbox.material as THREE.MeshStandardMaterial).emissiveIntensity).toBeGreaterThan(0);
    }
    let meshes = 0;
    root.traverse((object) => {
      expect(object.castShadow).toBe(false);
      if (!(object instanceof THREE.Mesh)) return;
      meshes += 1;
      const attribute = object.geometry.getAttribute('position');
      expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      expect(object.scale.toArray().every((n) => n > 0)).toBe(true);
    });
    expect(meshes).toBeLessThan(240);
  });

  it('玩家半径下从出生点连续走到三个触发区与三号窗口，目标视线无遮挡', () => {
    const { root, definition, result } = build();
    const { nav } = definition;
    let position: Vec2 = { ...definition.spawn };
    const route = [
      { x: -3.5, z: 8.4 }, CANTEEN_LOCATIONS.whispers[0],
      { x: 0, z: 5.4 }, CANTEEN_LOCATIONS.whispers[1],
      { x: 2.2, z: 2.4 }, { x: 2.2, z: -3.5 }, CANTEEN_LOCATIONS.whispers[2],
      CANTEEN_LOCATIONS.windowApproach,
    ];
    for (const target of route) {
      position = resolveMovement(position, { x: target.x - position.x, z: target.z - position.z },
        nav.bounds, nav.obstacles, PLAYER_RADIUS);
      expect(position.x).toBeCloseTo(target.x, 6);
      expect(position.z).toBeCloseTo(target.z, 6);
      expect(isInsideBounds(position, nav.bounds)).toBe(true);
    }
    for (const zone of definition.zones!) {
      if (zone.kind !== 'circle') throw new Error('食堂区域必须是 circle');
      expect(isPointInZone(zone.center, { kind: 'circle', centerX: zone.center.x,
        centerZ: zone.center.z, radius: zone.radius })).toBe(true);
      expect(isPointInZone(definition.spawn, { kind: 'circle', centerX: zone.center.x,
        centerZ: zone.center.z, radius: zone.radius })).toBe(false);
    }
    const eye = new THREE.Vector3(position.x, 1.6, position.z);
    const interaction = definition.interactables![0];
    const target = new THREE.Vector3(interaction.position.x,
      interaction.position.y + interaction.lightOffsetY!, interaction.position.z);
    expect(eye.distanceTo(target)).toBeLessThan(interaction.maxDistance!);
    root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(eye, target.clone().sub(eye).normalize(), 0, eye.distanceTo(target) - 0.01);
    expect(ray.intersectObjects(result.occluders, true)).toHaveLength(0);
  });

  it('全体可行走网格属于同一连通分量；家具和学生不会被玩家穿过', () => {
    const { definition } = build();
    const { nav } = definition;
    const points = new Map<string, Vec2>();
    const step = 0.2;
    for (let ix = -42; ix <= 42; ix += 1) for (let iz = -44; iz <= 47; iz += 1) {
      const point = { x: ix * step, z: iz * step };
      const blocked = nav.obstacles.some((o) => point.x > o.minX - PLAYER_RADIUS && point.x < o.maxX + PLAYER_RADIUS &&
        point.z > o.minZ - PLAYER_RADIUS && point.z < o.maxZ + PLAYER_RADIUS);
      if (isInsideBounds(point, nav.bounds) && !blocked) points.set(`${ix},${iz}`, point);
    }
    const queue = ['0,42'];
    const reached = new Set(queue);
    for (let i = 0; i < queue.length; i += 1) {
      const [x, z] = queue[i].split(',').map(Number);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${x + dx},${z + dz}`;
        if (reached.has(key) || !points.has(key)) continue;
        const from = points.get(queue[i])!;
        const target = points.get(key)!;
        const end = resolveMovement(from, { x: target.x - from.x, z: target.z - from.z },
          nav.bounds, nav.obstacles, PLAYER_RADIUS);
        if (Math.hypot(end.x - target.x, end.z - target.z) > 1e-6) continue;
        reached.add(key);
        queue.push(key);
      }
    }
    expect(reached.size).toBe(points.size);
    expect(reached.size).toBeGreaterThan(4000);
    const tableHit = resolveMovement({ x: -3.5, z: 5.4 }, { x: -3, z: 0 }, nav.bounds, nav.obstacles, PLAYER_RADIUS);
    expect(tableHit.x).toBeGreaterThanOrEqual(-3.63);
    const counterHit = resolveMovement(CANTEEN_LOCATIONS.windowApproach, { x: 0, z: -5 },
      nav.bounds, nav.obstacles, PLAYER_RADIUS);
    expect(counterHit.z).toBeGreaterThanOrEqual(-7.43);
    const crowdHit = resolveMovement({ x: 0.95, z: 2.4 }, { x: 0, z: -2 }, nav.bounds, nav.obstacles, PLAYER_RADIUS);
    expect(crowdHit.z).toBeGreaterThanOrEqual(1.01);
  });

  it('所有桌椅的实际实例包围盒落在碰撞占地内', () => {
    const { root, definition } = build();
    const obstacles = definition.nav.obstacles.filter((o) => o.id?.startsWith('canteen-table-'));
    for (const name of ['canteen-tabletops', 'canteen-chair-seats-backs', 'canteen-table-chair-legs']) {
      const batch = mesh(root, name) as THREE.InstancedMesh;
      batch.geometry.computeBoundingBox();
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < batch.count; i += 1) {
        batch.getMatrixAt(i, matrix);
        const box = batch.geometry.boundingBox!.clone().applyMatrix4(matrix.premultiply(batch.matrixWorld));
        expect(obstacles.some((o) => box.min.x >= o.minX && box.max.x <= o.maxX &&
          box.min.z >= o.minZ && box.max.z <= o.maxZ)).toBe(true);
      }
    }
  });
});

describe('食堂资源生命周期', () => {
  it('全部材质、几何、纹理及实例缓冲能由世界清理规则释放；多次 build 互不污染', () => {
    const first = build();
    const second = build('S13');
    const a = resources(first.root);
    const b = resources(second.root);
    expect(a.textures.size).toBe(5);
    const disposed = new Set<unknown>();
    // Three.js 各资源使用不同的 EventDispatcher 泛型，分别注册以保留严格类型。
    a.geometries.forEach((resource) => resource.addEventListener('dispose', () => disposed.add(resource)));
    a.materials.forEach((resource) => resource.addEventListener('dispose', () => disposed.add(resource)));
    a.textures.forEach((resource) => resource.addEventListener('dispose', () => disposed.add(resource)));
    a.instances.forEach((resource) => resource.addEventListener('dispose', () => disposed.add(resource)));
    for (const collection of [a.geometries, a.materials, a.textures, a.instances]) for (const resource of collection) {
      expect(resource.userData.sharedResource).not.toBe(true);
    }
    const instanceSpies = [...a.instances].map((instance) => vi.spyOn(instance, 'dispose'));
    for (const resource of a.geometries) expect(b.geometries.has(resource)).toBe(false);
    for (const resource of a.materials) expect(b.materials.has(resource)).toBe(false);
    for (const resource of a.textures) expect(b.textures.has(resource)).toBe(false);
    disposeTree(first.root);
    for (const collection of [a.geometries, a.materials, a.textures, a.instances]) for (const resource of collection) {
      expect(disposed.has(resource)).toBe(true);
    }
    instanceSpies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    for (const material of b.materials) expect(disposed.has(material)).toBe(false);
    expect(second.root.children.length).toBeGreaterThan(0);
  });
});

describe('食堂 runtime 只修改视觉', () => {
  it.each(CANTEEN_LOCATIONS.whispers.map(({ id }) => id))('%s 只让对应三人停摆转头，重复事件幂等', (id) => {
    const { actors } = build();
    const ctx = context(actors);
    const stateChanged = vi.fn();
    ctx.bus.on('state:changed', stateChanged);
    canteenRuntime.enter(ctx);
    advance();
    const poses = actors[id].children.map(pose);
    const before = poses.map(({ motion, head }) => ({ z: motion.rotation.z, yaw: head.rotation.y, scale: motion.scale.y }));
    expect(before.some(({ z }) => Math.abs(z) > 0)).toBe(true);
    const emit = vi.spyOn(ctx.bus, 'emit');
    ctx.bus.emit('scene:enterZone', { sceneId: 'S12', zoneId: id });
    advance();
    poses.forEach(({ motion, head }, i) => {
      expect(motion.rotation.z).toBe(before[i].z);
      expect(motion.scale.y).toBe(before[i].scale);
      expect(Math.abs(head.rotation.y - before[i].yaw)).toBeGreaterThan(0.01);
      expect(head.rotation.x).toBeCloseTo(0, 3);
    });
    const otherId = CANTEEN_LOCATIONS.whispers.find((zone) => zone.id !== id)!.id;
    const other = pose(actors[otherId].children[0]);
    const otherZ = other.motion.rotation.z;
    ctx.bus.emit('scene:enterZone', { sceneId: 'S12', zoneId: id });
    advance();
    expect(other.motion.rotation.z).not.toBe(otherZ);
    expect(poses[0].motion.rotation.z).toBe(before[0].z);
    expect(emit).toHaveBeenCalledTimes(2); // 只有测试发出的两次事件，runtime 不反向驱动状态。
    expect(stateChanged).not.toHaveBeenCalled();
    expect(ctx.setInteractableVisible).not.toHaveBeenCalled();
  });

  it('忽略错场景/未知区域，重复 enter 不增加订阅，exit 解除监听并完整复位', () => {
    const { actors } = build();
    const ctx = context(actors);
    const on = vi.spyOn(ctx.bus, 'on');
    const off = vi.spyOn(ctx.bus, 'off');
    const { motion, head } = pose(actors['canteen-whisper-1'].children[0]);
    const initial = { rotation: motion.rotation.clone(), scale: motion.scale.clone(), head: head.rotation.clone() };
    canteenRuntime.enter(ctx);
    canteenRuntime.enter(ctx);
    expect(on).toHaveBeenCalledTimes(1);
    ctx.bus.emit('scene:enterZone', { sceneId: 'S13', zoneId: 'canteen-whisper-1' });
    ctx.bus.emit('scene:enterZone', { sceneId: 'S12', zoneId: 'unknown' });
    advance();
    expect(motion.rotation.z).not.toBe(initial.rotation.z);
    const moving = motion.rotation.z;
    advance();
    expect(motion.rotation.z).not.toBe(moving);
    ctx.bus.emit('scene:enterZone', { sceneId: 'S12', zoneId: 'canteen-whisper-1' });
    advance();
    canteenRuntime.exit();
    expect(off).toHaveBeenCalledTimes(1);
    expect(motion.rotation.equals(initial.rotation)).toBe(true);
    expect(motion.scale.equals(initial.scale)).toBe(true);
    expect(head.rotation.equals(initial.head)).toBe(true);
    ctx.bus.emit('scene:enterZone', { sceneId: 'S12', zoneId: 'canteen-whisper-1' });
    advance();
    expect(head.rotation.equals(initial.head)).toBe(true);
    canteenRuntime.exit();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('S12→S13 复用几何并移除监听；返回 S12 重新初始化；旧 bus 不影响新场景', () => {
    const { actors } = build();
    const ctx = context(actors);
    const off = vi.spyOn(ctx.bus, 'off');
    canteenRuntime.enter(ctx);
    advance();
    ctx.bus.emit('scene:enterZone', { sceneId: 'S12', zoneId: 'canteen-whisper-1' });
    advance();
    const first = pose(actors['canteen-whisper-1'].children[0]);
    const stopped = first.motion.rotation.z;
    canteenRuntime.enter({ ...ctx, sceneId: 'S13' });
    expect(off).toHaveBeenCalledTimes(1);
    advance();
    expect(first.motion.rotation.z).toBe(stopped);
    const second = pose(actors['canteen-whisper-2'].children[0]);
    const secondZ = second.motion.rotation.z;
    ctx.bus.emit('scene:enterZone', { sceneId: 'S12', zoneId: 'canteen-whisper-2' });
    advance();
    expect(second.motion.rotation.z).not.toBe(secondZ);
    canteenRuntime.enter(ctx);
    expect(first.motion.rotation.z).toBe(0);
    advance();
    expect(first.motion.rotation.z).not.toBe(0);
    const next = build();
    const nextContext = context(next.actors);
    canteenRuntime.enter(nextContext);
    const nextPose = pose(next.actors['canteen-whisper-1'].children[0]);
    ctx.bus.emit('scene:enterZone', { sceneId: 'S12', zoneId: 'canteen-whisper-1' });
    advance();
    expect(nextPose.motion.rotation.z).not.toBe(0);
    expect(first.motion.rotation.z).toBe(0);
  });

  it('直接进入 S13 不订阅区域；缺演员、缺玩家定位与非法 dt 均可安全处理', () => {
    const { actors } = build('S13');
    const ctx = context(actors, 'S13');
    const on = vi.spyOn(ctx.bus, 'on');
    canteenRuntime.enter(ctx);
    expect(on).not.toHaveBeenCalled();
    const { motion } = pose(actors['canteen-whisper-3'].children[0]);
    ctx.bus.emit('scene:enterZone', { sceneId: 'S12', zoneId: 'canteen-whisper-3' });
    advance();
    const before = motion.rotation.z;
    for (const dt of [NaN, Infinity, -1, 0]) canteenRuntime.tick!(dt);
    expect(motion.rotation.z).toBe(before);
    canteenRuntime.enter({ ...ctx, sceneId: 'S12', getPlayerFeet: undefined });
    ctx.bus.emit('scene:enterZone', { sceneId: 'S12', zoneId: 'canteen-whisper-3' });
    advance();
    expect(pose(actors['canteen-whisper-3'].children[0]).head.rotation.x).toBeCloseTo(0, 3);
    canteenRuntime.enter({ ...ctx, sceneId: 'S12', actors: {} });
    expect(() => {
      ctx.bus.emit('scene:enterZone', { sceneId: 'S12', zoneId: 'canteen-whisper-1' });
      advance();
      canteenRuntime.exit();
    }).not.toThrow();
  });
});

// S7 精装契约：实际 build 与材质工厂，只替代 Canvas；运行时使用真实 AnimationMixer。
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { gsap } from 'gsap';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import { createInitialStoryState } from '../core/state';
import type { SceneRuntimeContext } from '../world/worldSceneTypes';
import * as resources from '../world/resources';
import * as shared from './shared';
import { createDeskDefinition, deskRuntime } from './desk';
import { disposeMaterialCache, getFabricMaterial, getFoliageMaterial, getWindowGlassMaterial } from './materials';
import type { WindTime } from './foliageWind';

const roots: THREE.Group[] = [];
let printed: string[] = [];
beforeEach(() => {
  printed = [];
  vi.stubGlobal('document', { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {}, fillRect: () => {}, strokeRect: () => {},
      fillText: (text: string) => printed.push(text),
      createRadialGradient: () => ({ addColorStop: () => {} }),
    }),
  }) });
});

/** 重现 WorldApp 清理规则（包括同一局部几何被多个网格复用时的重复 dispose）。 */
function disposeScene(root: THREE.Group): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.geometry.userData[resources.SHARED_RESOURCE_FLAG] !== true) object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material.userData[resources.SHARED_RESOURCE_FLAG] !== true) material.dispose();
    }
  });
  root.clear();
}
afterEach(() => {
  deskRuntime.exit();
  roots.forEach(disposeScene);
  roots.length = 0;
  disposeMaterialCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function build() {
  const root = new THREE.Group();
  roots.push(root);
  const definition = createDeskDefinition('S7');
  const built = definition.build(root);
  root.updateMatrixWorld(true);
  return { root, definition, built, actors: built.actors! };
}
function mesh(root: THREE.Object3D, name: string): THREE.Mesh {
  const object = root.getObjectByName(name);
  expect(object, name).toBeInstanceOf(THREE.Mesh);
  return object as THREE.Mesh;
}
function bounds(root: THREE.Object3D, name: string): THREE.Box3 {
  return new THREE.Box3().setFromObject(root.getObjectByName(name)!);
}
function instanceBounds(batch: THREE.InstancedMesh): THREE.Box3[] {
  batch.geometry.computeBoundingBox();
  return Array.from({ length: batch.count }, (_, i) => {
    const matrix = new THREE.Matrix4();
    batch.getMatrixAt(i, matrix);
    return batch.geometry.boundingBox!.clone().applyMatrix4(matrix.premultiply(batch.matrixWorld));
  });
}
function context(actors: Record<string, THREE.Object3D>): SceneRuntimeContext {
  return { sceneId: 'S7', bus: new EventBus(), actors, setInteractableVisible: vi.fn() };
}
function picked(bus: EventBus, value: boolean): void {
  bus.emit('state:changed', { sceneId: 'S7', role: 'bystander',
    state: { ...createInitialStoryState(), picked: value }, changedKeys: ['picked'] });
}

/** 仅提供短测试剪辑与模型根：角色工厂、场景、材质、动画控制器均仍是生产实现。 */
function attachTestAnimations(actors: Record<string, THREE.Object3D>): THREE.Group[] {
  vi.spyOn(resources, 'getCharacterAnimations').mockReturnValue(['afraid', 'walk', 'idle', 'fold_arms'].map((name) =>
    new THREE.AnimationClip(name, 2, [new THREE.NumberKeyframeTrack('.rotation[x]', [0, 2], [0, 0.4])])));
  return ['linxia', 'studentWalker', 'studentReader'].map((id) => {
    const model = new THREE.Group();
    model.userData.actorModelRootId = actors[id].userData.actorModelId;
    actors[id].add(model);
    return model;
  });
}

describe('S7 真实精装几何、碰撞与热点', () => {
  it('仅前移志愿者，保留导航界限、出生点、热点坐标和药袋交互参数', () => {
    const { root, actors, definition } = build();
    expect(definition.sceneKey).toBe('desk');
    expect(definition.spawn).toEqual({ x: 0, z: -1.6, yaw: 0, pitchDeg: -6 });
    expect(definition.nav.bounds).toEqual({ minX: -5, maxX: 5, minZ: -6.5, maxZ: 5.5 });
    expect(definition.nav.groundY).toBe(0);
    expect(actors.volunteer.position.toArray()).toEqual([0, 0, -4.68]);
    expect(actors.linxia.position.toArray()).toEqual([1.95, 0, -3.1]);
    expect(actors.father.position.toArray()).toEqual([0, 0, 4.8]);
    expect(definition.nav.obstacles.find(({ id }) => id === 'desk-volunteer')).toEqual({
      id: 'desk-volunteer', minX: -0.45, maxX: 0.45, minZ: -5, maxZ: -4.35, height: 1.7,
    });
    expect(definition.hotspots).toEqual([{ id: 'reason-form', position: { x: 0, y: 0.85, z: -3.56 }, maxDistance: 8 }]);
    expect(definition.interactables).toEqual([{ id: 'medicine-bag', position: { x: 1.15, y: 0.09, z: -3.15 },
      lightOffsetY: 0.3, hitRadius: 0.4, maxDistance: 3.5 }]);
    expect(mesh(root, 'desk-reason-form').position.toArray()).toEqual([0, 0.83, -3.56]);
    expect(actors.medicineBag.position.toArray()).toEqual([1.15, 0.09, -3.15]);
    expect(definition.requiredModels).toEqual(['studentFemale2', 'linxia', 'father', 'studentFemale', 'studentMale']);
  });

  it('四柱、真实交叉斜撑、坡屋面与四边褶皱帘眉均有几何且不挤占主角通路', () => {
    const { root, definition } = build();
    const posts = mesh(root, 'desk-tent-posts') as THREE.InstancedMesh;
    expect(posts.count).toBe(4);
    const boxes = instanceBounds(posts);
    boxes.forEach((box, i) => {
      const obstacle = definition.nav.obstacles.find(({ id }) => id === `desk-tent-post-${Math.floor(i / 2)}-${i % 2}`)!;
      expect(box.min.x).toBeGreaterThan(obstacle.minX);
      expect(box.max.x).toBeLessThan(obstacle.maxX);
      expect(box.min.z).toBeGreaterThan(obstacle.minZ);
      expect(box.max.z).toBeLessThan(obstacle.maxZ);
    });
    const braces = instanceBounds(mesh(root, 'desk-tent-cross-braces') as THREE.InstancedMesh);
    expect(braces).toHaveLength(9);
    expect(braces[0].min.y).toBeGreaterThan(2.4);
    expect(braces[0].max.y - braces[0].min.y).toBeGreaterThan(0.5);
    expect(braces[0].max.x - braces[0].min.x).toBeGreaterThan(3.4);
    for (const index of [0, 1]) {
      const roof = mesh(root, `desk-tent-roof-${index}-green`);
      const position = roof.geometry.getAttribute('position');
      const ys = Array.from({ length: position.count }, (_, i) => position.getY(i));
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.36);
      expect((roof.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x475b58);
    }
    for (const side of ['front', 'rear', 'left', 'right']) {
      expect(mesh(root, `desk-tent-valance-${side}`).geometry.getAttribute('position').count).toBeGreaterThan(40);
      expect(mesh(root, `desk-tent-hem-${side}`)).toBeDefined();
    }
    expect(printed).toContain('新生报到 · 迟到登记');
  });

  it('桌布顶边以下有褶皱，桌牌真实成三角，指南带封面/白页，文具与挂绳不是空盒', () => {
    const { root } = build();
    const drape = mesh(root, 'desk-tablecloth-front').geometry.getAttribute('position');
    const depths = Array.from({ length: drape.count }, (_, i) => drape.getZ(i));
    expect(Math.max(...depths) - Math.min(...depths)).toBeGreaterThan(0.03);
    const triangle = bounds(root, 'desk-triangle-nameplate');
    expect(triangle.max.y - triangle.min.y).toBeGreaterThan(0.22);
    expect(triangle.max.z - triangle.min.z).toBeGreaterThan(0.31);
    expect(mesh(root, 'desk-triangle-sign').rotation.x).toBeLessThan(-0.5);
    for (const color of ['teal', 'ochre']) {
      expect((mesh(root, `desk-guide-${color}-white-pages`) as THREE.InstancedMesh).count).toBe(3);
      expect((mesh(root, `desk-guide-${color}-covers`) as THREE.InstancedMesh).count).toBe(9);
      expect((mesh(root, `desk-guide-${color}-white-pages`).material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xf1eddf);
    }
    expect((mesh(root, 'desk-cup-stationery') as THREE.InstancedMesh).count).toBe(8);
    expect((mesh(root, 'desk-lanyard-cord-loops') as THREE.InstancedMesh).count).toBe(5);
    expect(mesh(root, 'desk-flask-body-and-lid').geometry).toBeInstanceOf(THREE.CylinderGeometry);
    expect(mesh(root, 'desk-clipboard-paper')).toBeDefined();
    expect(printed).toContain('迟到登记处');
    expect(printed.filter((text) => text === '新生报到指南')).toHaveLength(2);
    expect(printed).toContain('欢迎新同学');
  });

  it('纸箱四壁四翼向外展开，正中央向下射线穿过开口直达薄底', () => {
    const { root, definition } = build();
    const supply = root.getObjectByName('desk-open-supply-box')!;
    expect((mesh(root, 'desk-supply-walls') as THREE.InstancedMesh).count).toBe(4);
    expect((mesh(root, 'desk-supply-open-flaps') as THREE.InstancedMesh).count).toBe(4);
    const ray = new THREE.Raycaster(new THREE.Vector3(-2.55, 1.5, -4.25), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(supply, true);
    expect(hits[0].object.name).toBe('desk-supply-bottom');
    expect(hits[0].point.y).toBeCloseTo(0.0425);
    for (const [name, id] of [['desk-open-supply-box', 'desk-supply-box'], ['desk-welcome-rollup', 'desk-welcome-stand']] as const) {
      const box = bounds(root, name);
      const obstacle = definition.nav.obstacles.find((item) => item.id === id)!;
      expect(box.min.x).toBeGreaterThanOrEqual(obstacle.minX);
      expect(box.max.x).toBeLessThanOrEqual(obstacle.maxX);
      expect(box.min.z).toBeGreaterThanOrEqual(obstacle.minZ);
      expect(box.max.z).toBeLessThanOrEqual(obstacle.maxZ);
      expect(box.max.y).toBeLessThanOrEqual(obstacle.height ?? 0);
    }
  });

  it('出生点与桌前左右可用视点的登记表、签字笔、药袋光点射线不被新增实体遮挡', () => {
    const { root, built, definition } = build();
    const form = new THREE.Vector3(0, 0.85, -3.56);
    const bagLight = new THREE.Vector3(1.15, 0.39, -3.15);
    const pen = new THREE.Vector3(0.34, 0.856, -3.5);
    for (const x of [-0.55, 0, 0.55]) {
      const origin = new THREE.Vector3(x, 1.62, definition.spawn.z);
      for (const [target, tolerance] of [[form, 0.15], [bagLight, 0.08], [pen, 0.025]] as const) {
        const direction = target.clone().sub(origin);
        const ray = new THREE.Raycaster(origin, direction.clone().normalize(), 0, direction.length() - tolerance);
        expect(ray.intersectObjects(built.occluders, true).map(({ object }) => object.name)).toEqual([]);
        // 全树测试防止通过不加入 occluders 偷藏遮挡道具。
        expect(ray.intersectObject(root, true).map(({ object }) => object.name)).toEqual([]);
      }
    }
  });

  it('广场铺石、草花、对称树灯、公告栏、三层窗框与连廊围墙有实际层次，保持轻量实例化', () => {
    const { root } = build();
    const paving = mesh(root, 'desk-campus-paving');
    expect((paving.material as THREE.MeshStandardMaterial).map!.repeat.toArray()).toEqual([20, 18]);
    expect(bounds(root, 'desk-campus-paving').min.z).toBeCloseTo(-38);
    expect((mesh(root, 'desk-paving-inset-joints') as THREE.InstancedMesh).count).toBeGreaterThan(20);
    expect((mesh(root, 'desk-campus-tree-trunks') as THREE.InstancedMesh).count).toBe(8);
    expect((mesh(root, 'desk-courtyard-lamp-poles') as THREE.InstancedMesh).count).toBe(6);
    expect(bounds(root, 'desk-notice-board--1').min.x).toBeLessThan(-9);
    expect(bounds(root, 'desk-notice-board-1').max.x).toBeGreaterThan(9);
    for (const wing of ['main', 'left', 'right']) {
      const mass = bounds(root, `desk-school-${wing}-mass`);
      expect(mass.min.z).toBeGreaterThanOrEqual(-32);
      expect(mass.max.z).toBeLessThanOrEqual(-24);
      expect(mass.max.y).toBeCloseTo(9.3);
    }
    const panes = instanceBounds(mesh(root, 'desk-school-reflective-glass') as THREE.InstancedMesh);
    expect(new Set(panes.map((box) => Math.round(box.getCenter(new THREE.Vector3()).y * 100))).size).toBe(3);
    expect(panes).toHaveLength(43);
    expect((mesh(root, 'desk-school-warm-interior-windows') as THREE.InstancedMesh).count).toBe(11);
    expect((mesh(root, 'desk-school-warm-interior-windows').material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0.4);
    const frames = instanceBounds(mesh(root, 'desk-school-window-frames-and-sills') as THREE.InstancedMesh);
    expect(frames[0].max.z).toBeGreaterThan(panes[0].max.z + 0.1);
    expect(mesh(root, 'desk-school-entry-rain-canopy')).toBeDefined();
    expect((mesh(root, 'desk-school-covered-walkway-roofs') as THREE.InstancedMesh).count).toBe(2);
    expect((mesh(root, 'desk-campus-enclosing-walls') as THREE.InstancedMesh).count).toBe(3);
    const grass = mesh(root, 'desk-campus-wind-grass') as THREE.InstancedMesh;
    const flowers = mesh(root, 'desk-campus-wind-flowers') as THREE.InstancedMesh;
    expect(grass.count).toBeGreaterThan(1000);
    expect(flowers.count).toBe(76);
    let meshes = 0;
    let triangles = 0;
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      meshes += 1;
      const positions = object.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i += 1) {
        expect(Number.isFinite(positions.getX(i) + positions.getY(i) + positions.getZ(i))).toBe(true);
      }
      triangles += (object.geometry.index?.count ?? positions.count) / 3 * (object instanceof THREE.InstancedMesh ? object.count : 1);
    });
    expect(meshes).toBeLessThan(180);
    expect(triangles).toBeLessThan(65000);
  });
});

describe('S7 运行时、角色与资源所有权', () => {
  it('桌面文具克隆几何为场景私有，清理时保留缓存母本及共享材质', async () => {
    const geometry = new THREE.BoxGeometry(0.2, 0.02, 0.15);
    const material = new THREE.MeshStandardMaterial();
    geometry.userData[resources.SHARED_RESOURCE_FLAG] = true;
    material.userData[resources.SHARED_RESOURCE_FLAG] = true;
    const asset = { scene: new THREE.Group(), geometry, material, heightM: 0.02 };
    vi.spyOn(resources, 'loadPropModel').mockImplementation(async (id) => id === 'stationery' ? asset : null);
    const { root } = build();
    await Promise.resolve();
    const stationery = mesh(root, 'desk-stationery-props');
    expect(stationery.geometry).not.toBe(geometry);
    expect(stationery.geometry.userData[resources.SHARED_RESOURCE_FLAG]).not.toBe(true);
    expect(stationery.material).toBe(material);
    const releaseClone = vi.spyOn(stationery.geometry, 'dispose');
    const releaseTemplate = vi.spyOn(geometry, 'dispose');
    const releaseMaterial = vi.spyOn(material, 'dispose');
    disposeScene(root);
    expect(releaseClone).toHaveBeenCalledTimes(1);
    expect(releaseTemplate).not.toHaveBeenCalled();
    expect(releaseMaterial).not.toHaveBeenCalled();
    geometry.dispose();
    material.dispose();
  });

  it('现有学生 GLB 含对应原生动作，驻足男生使用 fold_arms 而非不存在的 idle', () => {
    for (const [filename, expected] of [
      ['chr_student_female.glb', ['walk', 'idle']], ['chr_student_male.glb', ['fold_arms']],
    ] as const) {
      const binary = readFileSync(new URL(`../../public/models/${filename}`, import.meta.url));
      expect(binary.readUInt32LE(0)).toBe(0x46546c67);
      const metadata = JSON.parse(binary.subarray(20, 20 + binary.readUInt32LE(12)).toString()) as {
        animations: Array<{ name: string }>;
      };
      expect(metadata.animations.map(({ name }) => name)).toEqual(expect.arrayContaining([...expected]));
    }
    const { actors } = build();
    attachTestAnimations(actors);
    const mixerAction = vi.spyOn(THREE.AnimationMixer.prototype, 'clipAction');
    deskRuntime.enter(context(actors));
    const actions = mixerAction.mock.results.map(({ value }) => value as THREE.AnimationAction);
    expect(actions.filter((action) => action.isRunning()).map((action) => action.getClip().name).sort())
      .toEqual(['afraid', 'fold_arms', 'walk']);
    deskRuntime.tick!(10);
    expect(actions.filter((action) => action.isRunning()).map((action) => action.getClip().name)).toContain('idle');
  });

  it('两学生远处贴地，女生短路走动后站定，动画与共享风时钟由 tick 推进', () => {
    const { root, actors, definition } = build();
    expect(actors.studentWalker.userData.actorModelId).toBe('studentFemale');
    expect(actors.studentReader.userData.actorModelId).toBe('studentMale');
    expect(actors.studentWalker.position.toArray()).toEqual([-3.4, 0, -13.5]);
    expect(actors.studentReader.position.toArray()).toEqual([4, 0, -19.7]);
    const walkBounds = definition.nav.bounds;
    if (Array.isArray(walkBounds)) throw new Error('S7 应保留原单矩形导航边界');
    for (const id of ['studentWalker', 'studentReader']) {
      expect(new THREE.Box3().setFromObject(actors[id]).min.y).toBeCloseTo(0);
      expect(actors[id].position.z).toBeLessThan(walkBounds.minZ - 5);
    }
    const models = attachTestAnimations(actors);
    deskRuntime.enter(context(actors));
    const time = actors.deskEnvironment.userData.windTime as WindTime;
    deskRuntime.tick!(0.5);
    expect(time.value).toBeCloseTo(0.5);
    expect(actors.studentWalker.position.z).toBeCloseTo(-13.81);
    expect(models[0].rotation.x).toBeGreaterThan(0);
    expect(models[1].rotation.x).toBeGreaterThan(0);
    expect(models[2].rotation.x).toBeGreaterThan(0);
    for (const name of ['desk-campus-wind-grass', 'desk-campus-wind-flowers', 'desk-campus-tree-crowns', 'desk-campus-shrubs']) {
      expect((mesh(root, name).material as THREE.Material).userData.windTime).toBe(time);
    }
    deskRuntime.tick!(10);
    expect(actors.studentWalker.position.toArray()).toEqual([-3.4, 0, -17.5]);
    deskRuntime.tick!(5);
    expect(actors.studentWalker.position.toArray()).toEqual([-3.4, 0, -17.5]);
    expect(actors.studentReader.position.toArray()).toEqual([4, 0, -19.7]);
  });

  it('picked 只隐藏完整药袋及光点，重复 enter 与 exit 清除订阅、真实 mixer 和呼吸补间', () => {
    const { actors } = build();
    const models = attachTestAnimations(actors);
    const ctx = context(actors);
    const off = vi.spyOn(ctx.bus, 'off');
    const uncache = vi.spyOn(THREE.AnimationMixer.prototype, 'uncacheRoot');
    deskRuntime.enter(ctx);
    expect(gsap.getTweensOf(actors.volunteer.scale)).toHaveLength(1);
    picked(ctx.bus, false);
    expect(actors.medicineBag.visible).toBe(true);
    deskRuntime.enter(ctx);
    expect(off).toHaveBeenCalledTimes(1);
    expect(uncache).toHaveBeenCalledTimes(3);
    expect(gsap.getTweensOf(actors.volunteer.scale)).toHaveLength(1);
    picked(ctx.bus, true);
    expect(actors.medicineBag.visible).toBe(false);
    expect(actors.medicineBag.children).toHaveLength(3);
    expect(ctx.setInteractableVisible).toHaveBeenCalledExactlyOnceWith('medicine-bag', false);
    deskRuntime.tick!(0.2);
    deskRuntime.exit();
    expect(off).toHaveBeenCalledTimes(2);
    expect(uncache).toHaveBeenCalledTimes(6);
    for (const actor of [actors.volunteer, actors.linxia, actors.father]) {
      expect(gsap.getTweensOf(actor.scale)).toHaveLength(0);
      expect(gsap.getTweensOf(actor.rotation)).toHaveLength(0);
      expect(actor.scale.y).toBe(1);
      expect(actor.rotation.z).toBe(0);
    }
    const positions = models.map((model) => model.rotation.x);
    const z = actors.studentWalker.position.z;
    const time = (actors.deskEnvironment.userData.windTime as WindTime).value;
    actors.medicineBag.visible = true;
    picked(ctx.bus, true);
    expect(actors.medicineBag.visible).toBe(true);
    deskRuntime.tick!(1);
    deskRuntime.exit();
    expect(models.map((model) => model.rotation.x)).toEqual(positions);
    expect(actors.studentWalker.position.z).toBe(z);
    expect((actors.deskEnvironment.userData.windTime as WindTime).value).toBe(time);
    expect(off).toHaveBeenCalledTimes(2);
  });

  it('预载未完成时不崩溃，模型后到仍能启动动画；新 build 风场不被旧运行时更新', () => {
    const first = build();
    const ctx = context(first.actors);
    const create = vi.spyOn(shared, 'createActorAnimation');
    deskRuntime.enter(ctx);
    expect(create).toHaveReturnedWith(null);
    const models = attachTestAnimations(first.actors);
    deskRuntime.tick!(0.3);
    expect(models.every((model) => model.rotation.x > 0)).toBe(true);
    const second = build();
    const firstTime = first.actors.deskEnvironment.userData.windTime as WindTime;
    const secondTime = second.actors.deskEnvironment.userData.windTime as WindTime;
    expect(firstTime).not.toBe(secondTime);
    deskRuntime.enter(context(second.actors));
    deskRuntime.tick!(0.2);
    expect(firstTime.value).toBeCloseTo(0.3);
    expect(secondTime.value).toBeCloseTo(0.2);
  });

  it('全部实例经几何 dispose 释放且只释放一次，局部染色/风材质不污染共享缓存和贴图', () => {
    const { root } = build();
    const sharedFabric = getFabricMaterial();
    const sharedFoliage = getFoliageMaterial();
    const sharedGlass = getWindowGlassMaterial();
    const localFabric = mesh(root, 'desk-tent-roof-0-green').material as THREE.MeshStandardMaterial;
    const localFoliage = mesh(root, 'desk-campus-shrubs').material as THREE.MeshStandardMaterial;
    const localGlass = mesh(root, 'desk-school-warm-interior-windows').material as THREE.MeshStandardMaterial;
    expect(localFabric.map).toBe(sharedFabric.map);
    expect(localFoliage.map).toBe(sharedFoliage.map);
    expect(localGlass.map).toBe(sharedGlass.map);
    const cached = [sharedFabric, sharedFoliage, sharedGlass];
    const originalColors = cached.map((material) => material.color.getHex());
    const cachedDisposers = cached.map((material) => vi.spyOn(material, 'dispose'));
    const textureDisposers = cached.map((material) => vi.spyOn(material.map!, 'dispose'));
    const localDisposers = [localFabric, localFoliage, localGlass].map((material) => vi.spyOn(material, 'dispose'));
    const instances: THREE.InstancedMesh[] = [];
    root.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) instances.push(object);
    });
    expect(instances.length).toBeGreaterThan(30);
    const releases = instances.map((object) => vi.spyOn(object, 'dispose'));
    disposeScene(root);
    releases.forEach((release) => expect(release).toHaveBeenCalledTimes(1));
    cachedDisposers.forEach((dispose) => expect(dispose).not.toHaveBeenCalled());
    textureDisposers.forEach((dispose) => expect(dispose).not.toHaveBeenCalled());
    localDisposers.forEach((dispose) => expect(dispose).toHaveBeenCalled());
    expect(cached.map((material) => material.color.getHex())).toEqual(originalColors);
    expect(sharedFoliage.userData.windTime).toBeUndefined();
    for (const material of [localFabric, localFoliage, localGlass]) expect(material.userData[resources.SHARED_RESOURCE_FLAG]).toBeUndefined();
    cached.forEach((material) => expect(material.userData[resources.SHARED_RESOURCE_FLAG]).toBe(true));
    const second = build();
    expect((mesh(second.root, 'desk-tent-roof-0-green').material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x475b58);
  });
});

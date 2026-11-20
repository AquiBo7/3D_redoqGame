import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSceneDefinition, getSceneRuntime } from '../scenes3d';
import type { SceneId, SceneKey } from '../data/storySchema';
import type { SceneRuntime, SceneRuntimeContext, WorldSceneDefinition } from './worldSceneTypes';
import { smoothAtmosphereProgress, WorldApp } from './WorldApp';

vi.mock('../scenes3d', () => ({ getSceneDefinition: vi.fn(), getSceneRuntime: vi.fn() }));
vi.mock('gsap', () => ({ gsap: { to: vi.fn(), killTweensOf: vi.fn() } }));

const colorKeys = ['uZenith', 'uMid', 'uHorizon', 'uBelow', 'uCloud', 'uCloudHighlight', 'uSunHighlight'];
const sceneKeys: Record<SceneId, SceneKey> = {
  S1: 'room', S2: 'room', S3: 'room', S4: 'street', S5: 'gate', S6: 'gate',
  S7: 'desk', S8: 'building', S9: 'building',
};

function definition(sceneKey: SceneKey): WorldSceneDefinition {
  return {
    sceneKey,
    spawn: { x: 0, z: 0 },
    nav: { bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, obstacles: [] },
    fog: sceneKey === 'room' ? undefined : { color: 0xb7d0cd, near: 12, far: 75 },
    build: () => ({ occluders: [], actors: {} }),
  };
}

function createWorld(sceneKey: SceneKey = 'building') {
  const uniforms: Record<string, THREE.IUniform> = { uTime: { value: 0 } };
  for (const key of colorKeys) uniforms[key] = { value: new THREE.Color() };
  const methods = Object.create(WorldApp.prototype) as {
    applyFog(definition: WorldSceneDefinition): void;
    applyAtmosphere(building?: boolean): void;
    resetAtmosphere(): void;
    rebuildAirParticles(sceneKey: SceneKey): void;
    disposeAirParticles(): void;
    updateAirParticles(dt: number): void;
    mountDefinition(definition: WorldSceneDefinition, sceneId: SceneId): void;
    createRuntimeContext(sceneId: SceneId): SceneRuntimeContext;
    handleSceneTransition(payload: { toSceneId: SceneId; sceneKey: SceneKey; fromSceneId?: SceneId | null }): void;
  };
  const world = Object.assign(methods, {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    skyMaterial: new THREE.ShaderMaterial({ uniforms }),
    sun: new THREE.DirectionalLight(0xffd29b, 2.05),
    baseHaze: new THREE.Color(0xa7bec8),
    atmosphereHaze: new THREE.Color(),
    atmosphereHorizon: new THREE.Color(),
    particleColor: new THREE.Color(),
    airParticleShape: { value: 0 },
    atmosphereProgress: 0,
    runtimeContextToken: 0,
    transitionToken: 0,
    currentDefinition: definition(sceneKey),
    currentSceneId: 'S8' as SceneId,
    currentRuntime: null as SceneRuntime | null,
    actors: {} as Record<string, THREE.Object3D>,
    levelGroup: new THREE.Group(),
    airParticles: null as THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null,
    airParticleSpeeds: null as Float32Array | null,
    pendingDefinition: null as WorldSceneDefinition | null,
    pendingSceneId: null as SceneId | null,
    disposed: false,
    debugOverlay: null,
    fadeEl: { style: { opacity: '0' } } as HTMLDivElement,
    bus: { emit: vi.fn() },
    controller: {
      getFeetPosition: vi.fn(() => ({ x: 2, y: 0.42, z: -9 })),
      setTransitionLocked: vi.fn(), setNavigation: vi.fn(), setSpawn: vi.fn(),
    },
    interaction: { setup: vi.fn(), setItemVisible: vi.fn() },
    attachContactShadows: vi.fn(), syncHudHints: vi.fn(), resetMotionAudio: vi.fn(),
    preloadRequiredModels: vi.fn(async () => undefined),
  });
  world.applyFog(world.currentDefinition);
  world.rebuildAirParticles(sceneKey);
  worlds.push(world);
  return world;
}

type TestWorld = ReturnType<typeof createWorld>;
const worlds: Array<{ disposeAirParticles(): void; skyMaterial: THREE.ShaderMaterial }> = [];

function snapshot(world: TestWorld) {
  return {
    progress: world.atmosphereProgress,
    sky: colorKeys.map((key) => (world.skyMaterial.uniforms[key].value as THREE.Color).toArray()),
    sun: world.sun.color.toArray(),
    intensity: world.sun.intensity,
    fog: world.scene.fog?.color.toArray() ?? null,
    shape: world.airParticleShape.value,
    colors: world.airParticles ? Array.from(world.airParticles.geometry.getAttribute('color').array) : [],
    size: world.airParticles?.material.size ?? null,
    opacity: world.airParticles?.material.opacity ?? null,
  };
}

function expectParticleColor(world: TestWorld, index: number, expected: THREE.Color): void {
  const colors = world.airParticles!.geometry.getAttribute('color');
  expect(colors.getX(index)).toBeCloseTo(expected.r, 6);
  expect(colors.getY(index)).toBeCloseTo(expected.g, 6);
  expect(colors.getZ(index)).toBeCloseTo(expected.b, 6);
}

beforeEach(() => {
  vi.mocked(getSceneDefinition).mockImplementation((id) => definition(sceneKeys[id]));
  vi.mocked(getSceneRuntime).mockReturnValue(null);
  vi.stubGlobal('window', { getComputedStyle: () => ({ opacity: '1' }) });
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop: vi.fn() }),
        fillRect: vi.fn(), fillStyle: '',
      }),
    }),
  });
});

afterEach(() => {
  for (const world of worlds) {
    world.disposeAirParticles();
    world.skyMaterial.dispose();
  }
  worlds.length = 0;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('smoothAtmosphereProgress', () => {
  it('夹紧进度并保持平滑端点', () => {
    expect(smoothAtmosphereProgress(-1)).toBe(0);
    expect(smoothAtmosphereProgress(0)).toBe(0);
    expect(smoothAtmosphereProgress(0.25)).toBe(0.15625);
    expect(smoothAtmosphereProgress(0.5)).toBe(0.5);
    expect(smoothAtmosphereProgress(0.75)).toBe(0.84375);
    expect(smoothAtmosphereProgress(1)).toBe(1);
    expect(smoothAtmosphereProgress(2)).toBe(1);
    expect(smoothAtmosphereProgress(NaN)).toBe(0);
    expect(smoothAtmosphereProgress(Infinity)).toBe(1);
    expect(smoothAtmosphereProgress(-Infinity)).toBe(0);
    expect(smoothAtmosphereProgress(0.001)).toBeLessThan(0.00001);
    expect(1 - smoothAtmosphereProgress(0.999)).toBeLessThan(0.00001);
  });

  it('全程单调且关于中点对称', () => {
    let previous = 0;
    for (let index = 0; index <= 100; index += 1) {
      const t = index / 100;
      const current = smoothAtmosphereProgress(t);
      expect(current).toBeGreaterThanOrEqual(previous);
      expect(current + smoothAtmosphereProgress(1 - t)).toBeCloseTo(1, 12);
      previous = current;
    }
  });
});

describe('WorldApp 氛围与运行时钩子', () => {
  it('普通场景保持原天空、线性云高光、灯光和雾配置', () => {
    const world = createWorld('gate');
    const uniforms = world.skyMaterial.uniforms;
    expect(uniforms.uZenith.value).toEqual(new THREE.Color(0x82acd0));
    expect(uniforms.uMid.value).toEqual(new THREE.Color(0xc2d2d7));
    expect(uniforms.uCloud.value).toEqual(new THREE.Color(0.7, 0.78, 0.82));
    expect(uniforms.uCloudHighlight.value).toEqual(new THREE.Color(0.94, 0.87, 0.75));
    expect(uniforms.uSunHighlight.value).toEqual(new THREE.Color(1, 0.58, 0.25));
    const haze = new THREE.Color(0xb7d0cd).lerp(new THREE.Color(0x91b3c2), 0.36);
    expect(world.scene.fog!.color).toEqual(haze);
    expect(uniforms.uBelow.value).toEqual(haze);
    expect(uniforms.uHorizon.value).toEqual(haze.clone().lerp(new THREE.Color(0xf3c28e), 0.62));
    expect(world.sun.color).toEqual(new THREE.Color(0xffd29b));
    expect(world.sun.intensity).toBe(2.05);
    const before = snapshot(world);
    world.createRuntimeContext('S5').setAtmosphereProgress!(1);
    expect(snapshot(world)).toEqual(before);
  });

  it('真实脚底写入同一个 target，不使用带视高与抖动的 cameraY', () => {
    const world = createWorld();
    world.camera.position.set(7, 999, 8);
    const target = new THREE.Vector3();
    expect(world.createRuntimeContext('S8').getPlayerFeet!(target)).toBe(target);
    expect(target.toArray()).toEqual([2, 0.42, -9]);
    expect(world.controller.getFeetPosition).toHaveBeenCalledOnce();
  });

  it('青灰蓝起点到金粉朝霞完整插值，复用颜色、雾与粒子对象', () => {
    const world = createWorld();
    const setProgress = world.createRuntimeContext('S8').setAtmosphereProgress!;
    const cold = snapshot(world);
    const references = colorKeys.map((key) => world.skyMaterial.uniforms[key].value);
    const fog = world.scene.fog;
    const particles = world.airParticles;
    expect(world.scene.fog!.color).toEqual(new THREE.Color(0x9eb7c2));
    setProgress(1);
    const warm = snapshot(world);
    expect(world.sun.color).toEqual(new THREE.Color(0xffc48f));
    expect(world.scene.fog!.color).toEqual(new THREE.Color(0xe3c6ba));
    expect(world.skyMaterial.uniforms.uMid.value).toEqual(new THREE.Color(0xe7c4d0));
    for (const key of colorKeys) expect(world.skyMaterial.uniforms[key].value).toBe(references[colorKeys.indexOf(key)]);
    expect(world.scene.fog).toBe(fog);
    expect(world.airParticles).toBe(particles);
    setProgress(0.25);
    const blend = smoothAtmosphereProgress(0.25);
    const partial = snapshot(world);
    for (let color = 0; color < cold.sky.length; color += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        expect(partial.sky[color][channel]).toBeCloseTo(cold.sky[color][channel] * (1 - blend) + warm.sky[color][channel] * blend, 12);
      }
    }
    expect(world.sun.intensity).toBe(2.05);
  });

  it('钩子夹紧合法输入、忽略非有限值，相同进度不重复上传', () => {
    const world = createWorld();
    const setProgress = world.createRuntimeContext('S8').setAtmosphereProgress!;
    setProgress(2);
    expect(world.atmosphereProgress).toBe(1);
    const colors = world.airParticles!.geometry.getAttribute('color') as THREE.BufferAttribute;
    const version = colors.version;
    const before = snapshot(world);
    for (const value of [1, 2, NaN, Infinity, -Infinity]) setProgress(value);
    expect(snapshot(world)).toEqual(before);
    expect(colors.version).toBe(version);
    setProgress(-2);
    expect(world.atmosphereProgress).toBe(0);
  });

  it('后半程才变形为光尘、花瓣与嫩叶，保留 48 Points 和原材质备用配置', () => {
    const world = createWorld();
    const particles = world.airParticles!;
    const material = particles.material;
    const map = material.map;
    const baseline = snapshot(world).colors;
    const setProgress = world.createRuntimeContext('S8').setAtmosphereProgress!;
    setProgress(0.5);
    expect(world.airParticleShape.value).toBe(0);
    expect(snapshot(world).colors).toEqual(baseline);
    setProgress(0.75);
    expect(world.airParticleShape.value).toBe(0.5);
    setProgress(1);
    const types = Array.from(particles.geometry.getAttribute('airType').array);
    expect(types.filter((type) => type === 0)).toHaveLength(32);
    expect(types.filter((type) => type === 1)).toHaveLength(8);
    expect(types.filter((type) => type === 2)).toHaveLength(8);
    expect(particles.geometry.getAttribute('position').count).toBe(48);
    expectParticleColor(world, 1, new THREE.Color(0xffd58b));
    expectParticleColor(world, 3, new THREE.Color(0xffc9d9));
    expectParticleColor(world, 0, new THREE.Color(0xc5d99c));
    expect(material.size).toBe(0.055);
    expect(material.opacity).toBe(0.38);
    expect(material.map).toBe(map);
    expect(material.vertexColors).toBe(true);
    expect(material.depthWrite).toBe(false);
    world.resetAtmosphere();
    expect(world.airParticleShape.value).toBe(0);
    expect(snapshot(world).colors).toEqual(baseline);
  });

  it('r187 Points 注入旋转非圆形遮罩，保留默认 map 路径并共享实时 uniform', () => {
    const world = createWorld();
    const material = world.airParticles!.material;
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.points.vertexShader,
      fragmentShader: THREE.ShaderLib.points.fragmentShader,
    } as Parameters<THREE.PointsMaterial['onBeforeCompile']>[0];
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.uAirShape).toBe(world.airParticleShape);
    expect(shader.uniforms.uAirTime).toBe(world.skyMaterial.uniforms.uTime);
    expect(shader.vertexShader).toContain('attribute float airType;');
    expect(shader.vertexShader).toContain('gl_PointSize = size * mix(1.0,');
    expect(shader.fragmentShader).toContain('#include <map_particle_fragment>');
    expect(shader.fragmentShader).toContain('vAirType > 0.5 && uAirShape > 0.0');
    expect(shader.fragmentShader).toContain('mat2(c, -s, s, c) * p');
    expect(shader.fragmentShader).toContain('pow(abs(q.y) / 0.46, 1.5)');
    expect(material.customProgramCacheKey()).toBe('morning-air-shapes-v1');
    world.createRuntimeContext('S8').setAtmosphereProgress!(0.75);
    expect(shader.uniforms.uAirShape.value).toBe(0.5);
  });

  it('默认下落保持不变，朝霞花瓣增加横向轻摆且复用位置缓冲', () => {
    const world = createWorld();
    const particles = world.airParticles!;
    const positions = particles.geometry.getAttribute('position') as THREE.BufferAttribute;
    const buffer = positions.array;
    world.camera.position.set(10, 999, 20);
    world.skyMaterial.uniforms.uTime.value = 1;
    world.airParticleSpeeds![0] = 0.1;
    positions.setXYZ(0, 1, 2, 3);
    world.updateAirParticles(0.1);
    expect(positions.getX(0)).toBeCloseTo(1 + Math.sin(2) * 0.0025, 6);
    expect(positions.getY(0)).toBeCloseTo(1.99, 6);
    expect(positions.getZ(0)).toBe(3);
    world.createRuntimeContext('S8').setAtmosphereProgress!(1);
    positions.setXYZ(0, 1, 2, 3);
    world.updateAirParticles(0.1);
    expect(positions.getX(0)).toBeCloseTo(1 + Math.sin(2) * 0.0025 + Math.sin(1.4) * 0.012, 6);
    expect(positions.getZ(0)).toBeCloseTo(3 + Math.cos(1.1) * 0.012, 6);
    expect(positions.array).toBe(buffer);
    expect(particles.position.toArray()).toEqual([10, 0, 20]);
  });

  it('S8→S9 保持渐变和几何，旧 enter 钩子失效，新钩子继续生效', () => {
    const world = createWorld();
    const old = world.createRuntimeContext('S8');
    old.setAtmosphereProgress!(0.8);
    const before = snapshot(world);
    const particles = world.airParticles;
    const contexts: SceneRuntimeContext[] = [];
    world.currentRuntime = { enter: (context) => contexts.push(context), exit: vi.fn() };
    world.handleSceneTransition({ toSceneId: 'S9', sceneKey: 'building', fromSceneId: 'S8' });
    expect(world.airParticles).toBe(particles);
    expect(snapshot(world)).toEqual(before);
    old.setAtmosphereProgress!(0);
    expect(snapshot(world)).toEqual(before);
    world.applyFog(world.currentDefinition);
    expect(snapshot(world)).toEqual(before);
    contexts[0].setAtmosphereProgress!(1);
    expect(world.atmosphereProgress).toBe(1);
  });

  it('同 key 全新一局恢复起点，不沿用上一局的朝霞', () => {
    const world = createWorld();
    const initial = snapshot(world);
    const old = world.createRuntimeContext('S8');
    old.setAtmosphereProgress!(1);
    const oldParticles = world.airParticles;
    const oldActors = world.actors;
    world.handleSceneTransition({ toSceneId: 'S8', sceneKey: 'building', fromSceneId: null });
    expect(world.airParticles).not.toBe(oldParticles);
    expect(world.actors).not.toBe(oldActors);
    expect(world.controller.setSpawn).toHaveBeenCalledWith(world.currentDefinition.spawn);
    expect(snapshot(world)).toEqual(initial);
    old.setAtmosphereProgress!(1);
    expect(snapshot(world)).toEqual(initial);
  });

  it('异 key 过渡请求立即复位并阻断黑幕期间的旧回调', () => {
    const world = createWorld();
    const old = world.createRuntimeContext('S8');
    old.setAtmosphereProgress!(1);
    vi.stubGlobal('window', { getComputedStyle: () => ({ opacity: '0' }) });
    world.handleSceneTransition({ toSceneId: 'S1', sceneKey: 'room' });
    expect(world.pendingSceneId).toBe('S1');
    expect(world.atmosphereProgress).toBe(0);
    expect(world.sun.color).toEqual(new THREE.Color(0xffd29b));
    expect(world.airParticleShape.value).toBe(0);
    const before = snapshot(world);
    old.setAtmosphereProgress!(1);
    expect(snapshot(world)).toEqual(before);
  });

  it('无模型的新局同步挂载房间，起床过场不能取消尚未完成的切图', () => {
    const world = createWorld();
    world.createRuntimeContext('S9').setAtmosphereProgress!(1);
    vi.stubGlobal('window', { getComputedStyle: () => ({ opacity: '0' }) });
    world.handleSceneTransition({ toSceneId: 'S1', sceneKey: 'room', fromSceneId: null });
    expect(world.currentDefinition.sceneKey).toBe('room');
    expect(world.pendingSceneId).toBeNull();
    expect(world.atmosphereProgress).toBe(0);
    expect(world.controller.setTransitionLocked).toHaveBeenLastCalledWith(false);
  });

  it('同一个 WorldApp 重开 S9→S1→S5→S8 完全复原，旧钩子不能污染新 building', async () => {
    const world = createWorld();
    const old = world.createRuntimeContext('S9');
    old.setAtmosphereProgress!(1);
    world.handleSceneTransition({ toSceneId: 'S1', sceneKey: 'room', fromSceneId: null });
    await Promise.resolve();
    expect(world.currentDefinition.sceneKey).toBe('room');
    expect(snapshot(world)).toEqual(snapshot(createWorld('room')));
    old.setAtmosphereProgress!(1);
    expect(world.atmosphereProgress).toBe(0);
    world.handleSceneTransition({ toSceneId: 'S5', sceneKey: 'gate', fromSceneId: 'S1' });
    await Promise.resolve();
    expect(snapshot(world)).toEqual(snapshot(createWorld('gate')));
    world.handleSceneTransition({ toSceneId: 'S8', sceneKey: 'building', fromSceneId: 'S5' });
    await Promise.resolve();
    const initial = snapshot(createWorld());
    expect(snapshot(world)).toEqual(initial);
    old.setAtmosphereProgress!(1);
    expect(snapshot(world)).toEqual(initial);
    world.createRuntimeContext('S8').setAtmosphereProgress!(1);
    expect(world.atmosphereProgress).toBe(1);
  });

  it('全量 rebuild 与 dispose 身份均让旧钩子失效', () => {
    const world = createWorld();
    const old = world.createRuntimeContext('S8');
    old.setAtmosphereProgress!(1);
    world.mountDefinition(definition('building'), 'S8');
    expect(world.atmosphereProgress).toBe(0);
    old.setAtmosphereProgress!(1);
    expect(world.atmosphereProgress).toBe(0);
    const current = world.createRuntimeContext('S8');
    world.disposed = true;
    current.setAtmosphereProgress!(1);
    expect(world.atmosphereProgress).toBe(0);
  });

  it('重复粒子 rebuild 释放每代 geometry、map、material，离场不残留 Points', () => {
    const world = createWorld('gate');
    for (let generation = 0; generation < 3; generation += 1) {
      const old = world.airParticles!;
      const geometryDispose = vi.spyOn(old.geometry, 'dispose');
      const materialDispose = vi.spyOn(old.material, 'dispose');
      const mapDispose = vi.spyOn(old.material.map!, 'dispose');
      world.rebuildAirParticles(generation === 2 ? 'room' : 'gate');
      expect(geometryDispose).toHaveBeenCalledOnce();
      expect(materialDispose).toHaveBeenCalledOnce();
      expect(mapDispose).toHaveBeenCalledOnce();
      expect(world.scene.children).not.toContain(old);
      expect(world.scene.children.filter((object) => object instanceof THREE.Points)).toHaveLength(generation === 2 ? 0 : 1);
    }
    expect(world.airParticles).toBeNull();
    expect(world.airParticleSpeeds).toBeNull();
  });
});

// 卧室精装真实几何 / PBR / 交互与资源所有权契约：不 mock 场景或材质工厂。
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHARED_RESOURCE_FLAG } from '../world/resources';
import { disposeMaterialCache, getPlasterMaterial, getWarmLampGlowMaterial } from './materials';
import { createRoomDefinition } from './room';

const roots: THREE.Group[] = [];
beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {}, fillRect: () => {}, strokeRect: () => {},
      createRadialGradient: () => ({ addColorStop: () => {} }),
    }),
  }) });
});

/** 与 WorldApp 的所有权规则一致：场景网格释放自身资源，缓存贴图与 Sprite 等全局释放。 */
function disposeScene(root: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return;
    if (object.geometry.userData[SHARED_RESOURCE_FLAG] !== true) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material.userData[SHARED_RESOURCE_FLAG] !== true) materials.add(material);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  root.clear();
}

afterEach(() => {
  roots.forEach(disposeScene);
  roots.length = 0;
  disposeMaterialCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function build() {
  const root = new THREE.Group();
  roots.push(root);
  const definition = createRoomDefinition('S3');
  const result = definition.build(root);
  root.updateMatrixWorld(true);
  return { root, definition, result };
}
function object(root: THREE.Object3D, name: string): THREE.Object3D {
  const found = root.getObjectByName(name);
  expect(found, `缺少实体 ${name}`).toBeDefined();
  return found!;
}
function mesh(root: THREE.Object3D, name: string): THREE.Mesh {
  const found = object(root, name);
  expect(found).toBeInstanceOf(THREE.Mesh);
  return found as THREE.Mesh;
}
function material(root: THREE.Object3D, name: string): THREE.MeshStandardMaterial {
  const found = mesh(root, name).material;
  expect(found).toBeInstanceOf(THREE.MeshStandardMaterial);
  return found as THREE.MeshStandardMaterial;
}
function bounds(root: THREE.Object3D, name: string): THREE.Box3 {
  return new THREE.Box3().setFromObject(object(root, name));
}

describe('M2 模块3 卧室精装', () => {
  it('S1–S3 仍共用纯几何 build、首屏空模型，锚点与 S3 准备时长保持不变', () => {
    const { root, definition, result } = build();
    for (const id of ['S1', 'S2', 'S3'] as const) {
      const scene = createRoomDefinition(id);
      expect(scene.requiredModels).toEqual([]);
      expect(scene.build).toBe(definition.build);
      expect(scene.spawn).toEqual({ x: -1.6, z: 0.2, yaw: 0.35, pitchDeg: -8 });
      expect(scene.exitAnchor).toEqual({ position: { x: 3.39, y: 1.6, z: 2.7 }, stopDistance: 0.85, preparationMs: 4200 });
    }
    expect(result.actors).toBeUndefined();
    expect(definition.interactables).toEqual([
      { id: 'culture-shirt', position: { x: 2.42, y: 1.06, z: -0.62 }, maxDistance: 3.5 },
      { id: 'document-bag', position: { x: 2.7, y: 0.84, z: -2.2 }, maxDistance: 3.5 },
    ]);
    expect(createRoomDefinition('S1').interactables?.[0].position).toEqual({ x: -2.85, y: 0.66, z: -4.02 });
    expect(createRoomDefinition('S2').interactables).toEqual([]);
    expect(object(root, 'culture-shirt').position.toArray()).toEqual([2.42, 1.06, -0.62]);
    expect(definition.nav.bounds).toEqual({ minX: -3.3, maxX: 3.3, minZ: -6.2, maxZ: 3.2 });
  });

  it('四段后墙陶土、其余墙米白和深木踢脚；场景染色不污染共享材质或另一间房', () => {
    const first = build().root;
    const source = getPlasterMaterial({ repeatX: 3, repeatY: 1 });
    const cream = material(first, 'room-cream-wall-0');
    for (let i = 0; i < 4; i += 1) {
      expect(material(first, `room-terracotta-wall-${i}`).color.getHex()).toBe(0xc46d45);
      expect(object(first, `room-terracotta-wall-${i}`).position.z).toBe(-6.4);
    }
    for (let i = 0; i < 3; i += 1) expect(material(first, `room-cream-wall-${i}`).color.getHex()).toBe(0xf1ece1);
    expect(material(first, 'room-dark-skirting-x-3.37').color.getHex()).toBe(0x59412e);
    expect(source.color.getHex()).toBe(0xffffff);
    expect(cream).not.toBe(source);
    expect(cream.map).toBe(source.map);
    expect(cream.userData[SHARED_RESOURCE_FLAG]).toBeUndefined();
    expect(source.userData[SHARED_RESOURCE_FLAG]).toBe(true);
    const second = build().root;
    expect(material(second, 'room-cream-wall-0')).not.toBe(cream);
    cream.color.setHex(0x000000);
    expect(material(second, 'room-cream-wall-0').color.getHex()).toBe(0xf1ece1);
    expect(source.color.getHex()).toBe(0xffffff);
    expect(material(first, 'room-oak-floor').roughnessMap).toBeInstanceOf(THREE.CanvasTexture);
  });

  it('吊灯位于指定高度，开口米白/黄铜双罩、常亮 PBR 灯泡与无阴影 PointLight 参数准确', () => {
    const { root } = build();
    const lamp = object(root, 'room-ceiling-lamp');
    expect(lamp.position.toArray()).toEqual([0, 2.82, -1.6]);
    expect(object(root, 'room-lamp-canopy').getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(2.8);
    expect((mesh(root, 'room-lamp-stem').geometry as THREE.CylinderGeometry).parameters.height).toBe(0.45);
    for (const name of ['room-lamp-cream-shade', 'room-lamp-brass-shade']) {
      const shade = mesh(root, name);
      expect((shade.geometry as THREE.CylinderGeometry).parameters.openEnded).toBe(true);
      expect(material(root, name).side).toBe(THREE.DoubleSide);
    }
    expect(material(root, 'room-lamp-brass-shade').metalness).toBe(0.72);
    expect(bounds(root, 'room-lamp-cream-shade').min.y).toBeCloseTo(2.18);
    const bulb = material(root, 'room-lamp-emissive-bulb');
    expect(bulb.emissive.getHex()).toBe(0xffd27d);
    expect(bulb.emissiveIntensity).toBe(1.8);
    expect(bounds(root, 'room-lamp-emissive-bulb').min.y).toBeCloseTo(2.18);
    const light = object(root, 'room-lamp-point-light') as THREE.PointLight;
    expect(light).toBeInstanceOf(THREE.PointLight);
    expect([light.color.getHex(), light.intensity, light.distance, light.decay, light.castShadow]).toEqual([0xffcb82, 1.15, 9, 1.6, false]);
    const lightPosition = light.getWorldPosition(new THREE.Vector3());
    expect(lightPosition.x).toBe(0); expect(lightPosition.y).toBeCloseTo(2.2); expect(lightPosition.z).toBe(-1.6);
    const glow = object(root, 'room-lamp-soft-glow') as THREE.Sprite;
    expect(glow).toBeInstanceOf(THREE.Sprite);
    expect(glow.material).toBe(getWarmLampGlowMaterial());
    expect(glow.scale.toArray()).toEqual([0.48, 0.48, 1]);
    lamp.traverse((child) => { expect(child.visible).toBe(true); expect(child.castShadow).toBe(false); });
  });

  it('11 片暖木百叶真实倾斜且单批渲染，顶盒/拉绳完整，墙/地各 11 条柔边斜平行光纹', () => {
    const { root } = build();
    const slats = mesh(root, 'room-blind-slats') as THREE.InstancedMesh;
    expect(slats).toBeInstanceOf(THREE.InstancedMesh);
    expect(slats.count).toBe(11);
    expect(material(root, 'room-blind-slats').color.getHex()).toBe(0xb88750);
    const transform = new THREE.Matrix4();
    for (let i = 0; i < slats.count; i += 1) {
      slats.getMatrixAt(i, transform);
      const position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
      transform.decompose(position, rotation, scale);
      expect(position.y).toBeCloseTo(2.38 - i * 0.096);
      expect(new THREE.Euler().setFromQuaternion(rotation).x).toBeCloseTo(-0.2);
      expect(scale.toArray()[0]).toBeCloseTo(1.31);
    }
    expect((mesh(root, 'room-blind-ladder-cords') as THREE.InstancedMesh).count).toBe(2);
    object(root, 'room-blind-headbox'); object(root, 'room-blind-pull-cord'); object(root, 'room-blind-pull-toggle');
    for (const name of ['room-sun-stripes-floor', 'room-sun-stripes-wall']) {
      const stripes = mesh(root, name);
      const vertices = stripes.geometry.getAttribute('position');
      const colors = stripes.geometry.getAttribute('color');
      expect(vertices.count).toBe(11 * 45);
      expect(stripes.geometry.index!.count).toBe(11 * 4 * 8 * 6);
      expect(colors.itemSize).toBe(4);
      expect(colors.getW(0)).toBeCloseTo(0);
      expect(colors.getW(22)).toBeGreaterThan(0.5);
      const baseDirection = new THREE.Vector3().fromBufferAttribute(vertices, 40).sub(new THREE.Vector3().fromBufferAttribute(vertices, 0));
      for (let i = 0; i < 11; i += 1) {
        const direction = new THREE.Vector3().fromBufferAttribute(vertices, i * 45 + 40).sub(new THREE.Vector3().fromBufferAttribute(vertices, i * 45));
        expect(direction.distanceTo(baseDirection)).toBeLessThan(0.00001);
        expect(direction.z).toBeGreaterThan(1);
      }
      const pbr = stripes.material as THREE.MeshBasicMaterial;
      expect(pbr.transparent).toBe(true); expect(pbr.depthWrite).toBe(false);
      expect(stripes.castShadow).toBe(false);
      expect(name.endsWith('floor') ? Math.abs(bounds(root, name).min.y - 0.014) : Math.abs(bounds(root, name).min.x - 3.393)).toBeLessThan(0.00001);
    }
  });

  it('双层错落搁板承托四色精装书白纸内芯、平放叠书和深灰陶盆绿植', () => {
    const { root } = build();
    expect(object(root, 'room-shelf-lower').position.y).toBe(1.48);
    expect(object(root, 'room-shelf-upper').position.y).toBe(1.76);
    expect(object(root, 'room-shelf-lower').position.x).not.toBe(object(root, 'room-shelf-upper').position.x);
    expect(bounds(root, 'room-shelf-upper').max.x).toBeLessThan(0.75);
    expect(bounds(root, 'room-shelf-potted-plant').max.x).toBeLessThan(0.75);
    for (const [key, color] of Object.entries({ brick: 0xa44735, forest: 0x365b44, yellow: 0xd7a841, lake: 0x397c89 })) {
      const name = `room-shelf-book-${key}`;
      expect(material(root, `${name}-hard-covers`).color.getHex()).toBe(color);
      expect((mesh(root, `${name}-hard-covers`) as THREE.InstancedMesh).count).toBe(3);
      expect(material(root, `${name}-white-pages`).color.getHex()).toBe(0xfffcf3);
      const pages = bounds(root, `${name}-white-pages`);
      const covers = bounds(root, `${name}-hard-covers`);
      expect(pages.min.x).toBeGreaterThan(covers.min.x);
      expect(pages.max.y).toBeLessThan(covers.max.y);
      expect(pages.getSize(new THREE.Vector3()).z).toBeGreaterThan(0.15);
      expect(bounds(root, name).min.y).toBeGreaterThanOrEqual(bounds(root, 'room-shelf-lower').max.y);
    }
    const lower = bounds(root, 'room-shelf-stacked-book-lake');
    const upper = bounds(root, 'room-shelf-stacked-book-yellow');
    expect(upper.min.y).toBeCloseTo(lower.max.y, 2);
    expect(object(root, 'room-shelf-stacked-book-lake').rotation.z).toBeCloseTo(Math.PI / 2);
    expect(material(root, 'room-plant-dark-gray-pot').color.getHex()).toBe(0x424444);
    expect((mesh(root, 'room-plant-dark-gray-pot').geometry as THREE.CylinderGeometry).parameters.openEnded).toBe(true);
    expect((mesh(root, 'room-plant-green-leaves') as THREE.InstancedMesh).count).toBe(9);
  });

  it('桌后双哑光灰边框暗屏，键鼠红本马克杯齐全，双抽屉黑拉手不重叠', () => {
    const { root } = build();
    for (let i = 1; i <= 2; i += 1) {
      expect(material(root, `room-monitor-${i}-matte-frame`).roughness).toBe(0.85);
      expect(material(root, `room-monitor-${i}-dark-screen`).roughness).toBe(0.28);
      expect(material(root, `room-monitor-${i}-dark-screen`).color.getHex()).toBe(0x19272d);
      expect(bounds(root, `room-monitor-${i}`).max.z).toBeLessThan(-2.32);
      expect(material(root, `room-desk-black-handle-${i}`).color.getHex()).toBe(0x242728);
    }
    expect(bounds(root, 'room-desk-drawer-front-1').intersectsBox(bounds(root, 'room-desk-drawer-front-2'))).toBe(false);
    expect((mesh(root, 'room-keyboard-keys') as THREE.InstancedMesh).count).toBe(36);
    expect(bounds(root, 'room-keyboard-base').intersectsBox(bounds(root, 'room-monitor-2-foot'))).toBe(false);
    expect(material(root, 'room-red-notebook-hard-covers').color.getHex()).toBe(0xa44735);
    expect(mesh(root, 'room-desk-mouse').geometry).toBeInstanceOf(THREE.SphereGeometry);
    expect((mesh(root, 'room-desk-mug').geometry as THREE.CylinderGeometry).parameters.openEnded).toBe(true);
    expect(mesh(root, 'room-mug-handle').geometry).toBeInstanceOf(THREE.TorusGeometry);
    object(root, 'room-mug-coffee');
  });

  it('证件袋几何/标签与原锚点对齐，前中央留白且三条实际交互视线无遮挡', () => {
    const { root, result } = build();
    const bag = mesh(root, 'document-bag');
    expect(bag.position.toArray()).toEqual([2.7, 0.792, -2.2]);
    expect(result.occluders).toContain(bag);
    const footprint = bounds(root, 'document-bag');
    for (const name of ['room-monitor-1', 'room-monitor-2', 'room-keyboard-base', 'room-desk-mouse', 'room-red-notebook', 'room-desk-mug']) {
      const prop = bounds(root, name);
      expect(prop.min.x > footprint.max.x || prop.max.x < footprint.min.x || prop.max.z < footprint.min.z || prop.min.z > footprint.max.z, name).toBe(true);
    }
    expect(object(root, 'document-bag-label').position.y).toBe(0.827);
    const anchor = new THREE.Vector3(2.7, 0.84, -2.2);
    for (const origin of [new THREE.Vector3(-0.5, 1.6, -0.5), new THREE.Vector3(2.7, 1.6, -1.4), new THREE.Vector3(1.3, 1.6, -2.0)]) {
      const ray = new THREE.Raycaster(origin, anchor.clone().sub(origin).normalize(), 0, origin.distanceTo(anchor));
      expect(ray.intersectObject(root, true).map((hit) => ({ name: hit.object.name, type: hit.object.type }))).toEqual([]);
    }
  });

  it('珊瑚织物被面有真实起伏和垂边，白色折边床单共用贴图但不共用染色材质', () => {
    const { root } = build();
    const duvet = material(root, 'room-coral-fabric-duvet');
    const sheet = material(root, 'room-white-folded-sheet');
    expect(duvet.color.getHex()).toBe(0xcd705d);
    expect(sheet.color.getHex()).toBe(0xfffcf5);
    expect(duvet.roughness).toBe(0.98);
    expect(duvet.map).toBe(sheet.map);
    expect(duvet).not.toBe(sheet);
    expect(duvet.userData[SHARED_RESOURCE_FLAG]).toBeUndefined();
    expect(bounds(root, 'room-coral-fabric-duvet').getSize(new THREE.Vector3()).y).toBeGreaterThan(0.03);
    expect(bounds(root, 'room-coral-fabric-duvet').min.y).toBeGreaterThan(0.45);
    expect(bounds(root, 'room-coral-duvet-drape').getSize(new THREE.Vector3()).y).toBeCloseTo(0.3);
    expect(mesh(root, 'room-white-sheet-rolled-edge').geometry).toBeInstanceOf(THREE.CylinderGeometry);
  });

  it('木色梯形纸篓是有厚度内壁/底板的真开口，桶外两团白皱纸贴地并避开床体', () => {
    const { root, definition } = build();
    const shell = mesh(root, 'room-wastebasket-hollow-shell');
    expect(shell.geometry).not.toBeInstanceOf(THREE.CylinderGeometry);
    expect(shell.geometry.index!.count).toBe(12 * 6);
    expect(material(root, 'room-wastebasket-hollow-shell').color.getHex()).toBe(0xab7b4e);
    const vertices = shell.geometry.getAttribute('position');
    let topWidth = 0, bottomWidth = 0;
    for (let i = 0; i < vertices.count; i += 1) {
      if (vertices.getY(i) > 0.3) topWidth = Math.max(topWidth, Math.abs(vertices.getX(i)));
      else bottomWidth = Math.max(bottomWidth, Math.abs(vertices.getX(i)));
    }
    expect(topWidth).toBeGreaterThan(bottomWidth);
    const ray = new THREE.Raycaster(new THREE.Vector3(-3.08, 0.6, -1.75), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(object(root, 'room-open-trapezoid-wastebasket'), true);
    expect(hits[0].object.name).toBe('room-wastebasket-bottom');
    expect(hits[0].point.y).toBeCloseTo(0.023);
    expect(definition.nav.obstacles.find((item) => item.id === 'room-wastebasket')?.height).toBe(0.34);
    expect(bounds(root, 'room-open-trapezoid-wastebasket').max.z).toBeLessThan(-1.55);
    expect(mesh(root, 'room-crumpled-paper-1').geometry).toBe(mesh(root, 'room-crumpled-paper-2').geometry);
    for (let i = 1; i <= 2; i += 1) {
      const name = `room-crumpled-paper-${i}`;
      expect(material(root, name).color.getHex()).toBe(0xfffcf6);
      expect(bounds(root, name).min.y).toBeCloseTo(0.002);
      expect(bounds(root, name).min.z).toBeGreaterThan(-2.0);
      expect(bounds(root, name).intersectsBox(bounds(root, 'room-open-trapezoid-wastebasket'))).toBe(false);
    }
  });

  it('新增盒体复用局部几何、百叶/按键/叶片批量化；场景释放克隆而全局释放共享贴图与光晕', () => {
    const { root } = build();
    expect(mesh(root, 'room-blind-headbox').geometry).toBe(mesh(root, 'room-keyboard-base').geometry);
    expect(mesh(root, 'room-keyboard-keys').geometry).toBe(mesh(root, 'room-shelf-book-brick-hard-covers').geometry);
    const clone = material(root, 'room-cream-wall-0');
    const source = getPlasterMaterial({ repeatX: 3, repeatY: 1 });
    const glow = getWarmLampGlowMaterial();
    const slats = mesh(root, 'room-blind-slats') as THREE.InstancedMesh;
    const leaves = mesh(root, 'room-plant-green-leaves') as THREE.InstancedMesh;
    const slatsDispose = vi.spyOn(slats, 'dispose');
    const leavesDispose = vi.spyOn(leaves, 'dispose');
    const cloneDispose = vi.spyOn(clone, 'dispose');
    const sourceDispose = vi.spyOn(source, 'dispose');
    const textureDispose = vi.spyOn(source.map!, 'dispose');
    const roughDispose = vi.spyOn(material(root, 'room-oak-floor').roughnessMap!, 'dispose');
    const glowDispose = vi.spyOn(glow, 'dispose');
    const glowTextureDispose = vi.spyOn(glow.map!, 'dispose');
    disposeScene(root);
    expect(cloneDispose).toHaveBeenCalledTimes(1);
    expect(slatsDispose).toHaveBeenCalledTimes(1);
    expect(leavesDispose).toHaveBeenCalledTimes(1);
    for (const spy of [sourceDispose, textureDispose, roughDispose, glowDispose, glowTextureDispose]) expect(spy).not.toHaveBeenCalled();
    disposeMaterialCache();
    for (const spy of [sourceDispose, textureDispose, roughDispose, glowDispose, glowTextureDispose]) expect(spy).toHaveBeenCalledTimes(1);
    const rebuilt = build().root;
    expect(material(rebuilt, 'room-cream-wall-0').map).not.toBe(clone.map);
    expect(material(rebuilt, 'room-cream-wall-0').color.getHex()).toBe(0xf1ece1);
  });
});

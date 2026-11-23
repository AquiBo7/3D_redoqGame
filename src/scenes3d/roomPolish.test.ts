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
      { id: 'culture-shirt', position: { x: 2.78, y: 1.6, z: 1.14 }, lightOffsetY: 0.2, maxDistance: 3.5 },
      { id: 'document-bag', position: { x: 2.7, y: 0.84, z: -2.2 }, maxDistance: 3.5 },
    ]);
    expect(createRoomDefinition('S1').interactables?.[0].position).toEqual({ x: -2.85, y: 0.66, z: -4.02 });
    expect(createRoomDefinition('S2').interactables).toEqual([]);
    // 文化衫从椅背改挂进衣柜，注视 / 点击锚点落在敞开的柜门口
    expect(object(root, 'culture-shirt').position.toArray()).toEqual([3.06, 1.76, 1.15]);
    expect(object(root, 'culture-shirt').rotation.y).toBeCloseTo(-Math.PI / 2);
    expect(createRoomDefinition('S1').hotspots?.find((item) => item.id === 'suitcase')?.position)
      .toEqual({ x: 1.75, y: 0.55, z: 3.1 });
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
      expect(new THREE.Euler().setFromQuaternion(rotation).x).toBeCloseTo(-0.78);
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
    expect(material(root, 'room-plant-pot').color.getHex()).toBe(0x424444);
    expect((mesh(root, 'room-plant-pot').geometry as THREE.CylinderGeometry).parameters.openEnded).toBe(true);
    expect((mesh(root, 'room-plant-leaves') as THREE.InstancedMesh).count).toBe(9);
  });

  it('桌后双哑光灰边框亮屏分别出 NVIDIA / Qoder，键鼠杯绿植齐全，双抽屉黑拉手不重叠', () => {
    const { root } = build();
    for (let i = 1; i <= 2; i += 1) {
      expect(material(root, `room-monitor-${i}-matte-frame`).roughness).toBe(0.85);
      const screen = material(root, `room-monitor-${i}-lit-screen`);
      expect(screen.roughness).toBe(0.32);
      expect(screen.emissive.getHex()).toBe(0xffffff);
      expect(screen.emissiveIntensity).toBe(0.52);
      expect(screen.emissiveMap).toBeInstanceOf(THREE.CanvasTexture);
      expect(bounds(root, `room-monitor-${i}`).max.z).toBeLessThan(-2.32);
      expect(material(root, `room-desk-black-handle-${i}`).color.getHex()).toBe(0x242728);
    }
    // 靠里一台出 NVIDIA、靠外那台（更挨着椅子与房门）出 Qoder，两张贴图不能混用
    expect(material(root, 'room-monitor-1-lit-screen')).not.toBe(material(root, 'room-monitor-2-lit-screen'));
    expect(bounds(root, 'room-desk-drawer-front-1').intersectsBox(bounds(root, 'room-desk-drawer-front-2'))).toBe(false);
    expect((mesh(root, 'room-keyboard-keys') as THREE.InstancedMesh).count).toBe(36);
    expect(bounds(root, 'room-keyboard-base').intersectsBox(bounds(root, 'room-monitor-2-foot'))).toBe(false);
    expect(material(root, 'room-red-notebook-hard-covers').color.getHex()).toBe(0xa44735);
    expect(mesh(root, 'room-desk-mouse').geometry).toBeInstanceOf(THREE.SphereGeometry);
    expect((mesh(root, 'room-desk-mug').geometry as THREE.CylinderGeometry).parameters.openEnded).toBe(true);
    expect(mesh(root, 'room-mug-handle').geometry).toBeInstanceOf(THREE.TorusGeometry);
    object(root, 'room-mug-coffee');
    // 桌面收干净：红皮本搬进书架，桌面只剩键 / 鼠 / 杯 / 一小盆绿植
    expect(bounds(root, 'room-red-notebook').min.x).toBeGreaterThan(3);
    expect(bounds(root, 'room-desk-plant').min.y).toBeGreaterThan(0.7);
    expect(bounds(root, 'room-desk-plant').max.x).toBeLessThan(2.2);
    expect(object(root, 'room-desk-plant-leaves')).toBeInstanceOf(THREE.InstancedMesh);
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

  it('木色梯形纸篓是有厚度内壁/底板的真开口，床侧两团皱纸已清空', () => {
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
    expect(root.getObjectByName('room-crumpled-paper-1')).toBeUndefined();
    expect(root.getObjectByName('room-crumpled-paper-2')).toBeUndefined();
  });

  it('居家化布置：衣柜 / 书架贴右墙且不挡开门，地毯居中留出通道，画像并排挂床头橙墙', () => {
    const { root, result, definition } = build();
    const wardrobe = bounds(root, 'room-wardrobe-carcass');
    expect(wardrobe.min.x).toBeCloseTo(2.82);
    expect(wardrobe.max.x).toBeCloseTo(3.4);
    expect(wardrobe.max.y).toBeCloseTo(2.2);
    expect(wardrobe.getSize(new THREE.Vector3()).z).toBeCloseTo(1.2);
    expect(2.09 - wardrobe.max.z).toBeGreaterThan(0.59);
    expect(object(root, 'room-wardrobe-door-near').rotation.y).toBe(0);
    expect(object(root, 'room-wardrobe-door-far').rotation.y).toBeCloseTo((55 * Math.PI) / 180);
    // 敞开那扇斜在柜口的门扇不进遮挡列表，否则文化衫在 S1/S3 永远点不到
    expect(result.occluders).not.toContain(object(root, 'room-wardrobe-door-far'));
    // 柜门口不能被柜体 / 关着那扇门糊住：S3 文化衫是可点击带走的交互
    const shirtAnchor = new THREE.Vector3(2.78, 1.6, 1.14);
    for (const origin of [
      new THREE.Vector3(1.6, 1.5, 0.9), new THREE.Vector3(2.0, 1.5, 1.6), new THREE.Vector3(0.4, 1.6, 1.2),
    ]) {
      const ray = new THREE.Raycaster(origin, shirtAnchor.clone().sub(origin).normalize(), 0, origin.distanceTo(shirtAnchor) - 0.02);
      const blockers = result.occluders.flatMap((item) => ray.intersectObject(item, true).map((hit) => hit.object.name));
      expect(blockers, `${origin.toArray()} 看向文化衫`).toEqual([]);
    }
    const shirt = object(root, 'culture-shirt');
    expect(shirt.parent?.name).toBe('room-wardrobe');
    expect(shirt.position.toArray()).toEqual([3.06, 1.76, 1.15]);
    expect(object(root, 'room-wardrobe-hanging-rail').rotation.x).toBeCloseTo(Math.PI / 2);
    expect(object(root, 'room-wardrobe-top-basket').position.y).toBeGreaterThan(2.2);
    expect(object(root, 'room-wardrobe-top-plant').position.y).toBe(2.2);
    expect(bounds(root, 'room-wardrobe-top-plant').max.y).toBeLessThan(2.8);
    expect(root.getObjectByName('room-wardrobe-plant-leaves')).toBeInstanceOf(THREE.InstancedMesh);

    const shelf = bounds(root, 'room-bookshelf-carcass');
    expect(shelf.min.x).toBeCloseTo(3.1);
    expect(shelf.max.y).toBeCloseTo(1.7);
    expect(shelf.getSize(new THREE.Vector3()).z).toBeCloseTo(1.1);
    expect(shelf.getSize(new THREE.Vector3()).x).toBeCloseTo(0.3);
    expect(wardrobe.min.z - shelf.max.z).toBeGreaterThanOrEqual(0.4);
    expect(shelf.min.z).toBeGreaterThan(-1.71);
    expect((mesh(root, 'room-bookshelf-book-spines') as THREE.InstancedMesh).count).toBe(39);
    expect((mesh(root, 'room-bookshelf-book-pages') as THREE.InstancedMesh).count).toBe(39);
    // 书只占七层满，余量给了陶瓷杯 / 小绿植 / 从桌面收下来的红皮本
    expect(bounds(root, 'room-bookshelf-ceramic-cup').intersectsBox(bounds(root, 'room-bookshelf-book-spines'))).toBe(false);
    expect(bounds(root, 'room-red-notebook').min.z).toBeGreaterThan(shelf.max.z - 0.4);
    expect(bounds(root, 'room-bookshelf-top-plant').max.x).toBeLessThan(3.38);

    const rug = bounds(root, 'room-rug-field');
    expect(rug.getSize(new THREE.Vector3()).x).toBeCloseTo(2);
    expect(rug.getSize(new THREE.Vector3()).z).toBeCloseTo(1.5);
    // 地毯离床脚 40cm（床体障碍 max z = -2.0），且不在椅子推拉路径上
    // 地毯离床脚 40cm，且不压在椅子的推拉路径上
    const bedFoot = definition.nav.obstacles.find((item) => item.id === 'room-bed')!.maxZ;
    expect(rug.min.z - bedFoot).toBeCloseTo(0.4);
    expect(rug.max.x).toBeLessThan(2.15);
    expect(rug.min.y).toBeCloseTo(0);
    const mat = bounds(root, 'room-bedfoot-round-mat');
    expect(mat.getSize(new THREE.Vector3()).x).toBeCloseTo(0.6);
    expect(mat.intersectsBox(rug)).toBe(false);
    expect(mat.intersectsBox(bounds(root, 'room-open-trapezoid-wastebasket'))).toBe(false);

    const her = bounds(root, 'room-portrait-her-oak-frame');
    const dad = bounds(root, 'room-portrait-father-oak-frame');
    for (const [name, box] of [['her', her], ['father', dad]] as const) {
      expect(box.getSize(new THREE.Vector3()).x, name).toBeCloseTo(0.4);
      expect(box.getSize(new THREE.Vector3()).y, name).toBeCloseTo(0.5);
      expect(box.getSize(new THREE.Vector3()).z, name).toBeCloseTo(0.035);
      expect(box.getCenter(new THREE.Vector3()).y, name).toBeCloseTo(1.5);
      expect(box.max.z, name).toBeLessThan(-6.26);
      expect(object(root, `room-portrait-${name}-print`), name).toBeInstanceOf(THREE.Mesh);
    }
    // 两幅并排挂在床头橙墙，以床的正中线 x −2.85 对称，框间留 20cm
    expect(dad.min.x).toBeGreaterThan(her.max.x);
    expect(dad.min.x - her.max.x).toBeCloseTo(0.2);
    expect((her.min.x + dad.max.x) / 2).toBeCloseTo(-2.85, 2);
    // 离窗洞（x 1.1~2.5）≥80cm；书桌那面白墙已空出，不再挂任何东西
    expect(1.1 - dad.max.x).toBeGreaterThan(0.8);
    expect(her.min.x).toBeGreaterThan(-3.4);

    expect(object(root, 'room-trolley').position.toArray()).toEqual([1.15, 0, 0.7]);
    expect(bounds(root, 'room-trolley').max.x).toBeLessThan(2.2);
    expect(bounds(root, 'room-trolley').min.z).toBeGreaterThan(2.8);

    // 房间中央 60×60 行走净空不被任何障碍体占用
    const aisle = new THREE.Box3(
      new THREE.Vector3(-0.3, 0, -0.1), new THREE.Vector3(0.3, 1.8, 0.7),
    );
    for (const obstacle of definition.nav.obstacles) {
      const box = new THREE.Box3(
        new THREE.Vector3(obstacle.minX, 0, obstacle.minZ),
        new THREE.Vector3(obstacle.maxX, obstacle.height, obstacle.maxZ),
      );
      expect(box.intersectsBox(aisle), obstacle.id).toBe(false);
    }
  });

  it('床头只留长枕；梳妆区贴 +Z 墙成套，不压地毯、不挡开门、推车仍可活动', () => {
    const { root, definition } = build();
    // 两只圆形靠枕删除后，那颗形变球体只剩长枕独占，手机与被子不动
    const pillow = mesh(root, 'room-bed-long-pillow');
    expect(pillow.scale.toArray()).toEqual([0.9, 0.14, 0.42]);
    expect(root.children.filter((item) => item instanceof THREE.Mesh
      && item.geometry === pillow.geometry)).toEqual([pillow]);
    expect(object(root, 'room-bedside-phone')).toBeDefined();
    expect(object(root, 'room-coral-fabric-duvet')).toBeDefined();

    const carcass = bounds(root, 'room-dresser-carcass');
    const dresser = bounds(root, 'room-dresser');
    expect(carcass.max.z).toBeCloseTo(3.3);
    expect(carcass.getSize(new THREE.Vector3()).z).toBeGreaterThan(0.4);
    expect(dresser.min.x).toBeCloseTo(-2.1);
    expect(bounds(root, 'room-dresser-top').max.y).toBeCloseTo(0.75);
    // 靠房门那一侧的台边缘远超 60cm，门开到最大的开启弧（x 2.2~3.3）碰不到台面
    expect(3.24 - dresser.max.x).toBeGreaterThan(0.6);
    expect(dresser.max.x).toBeLessThan(2.2);
    // 与小推车之间还留得下推车进出
    expect(bounds(root, 'room-trolley').min.x - dresser.max.x).toBeGreaterThan(0.6);

    const mirror = bounds(root, 'room-dressing-mirror');
    expect(mirror.getCenter(new THREE.Vector3()).y).toBeCloseTo(1.5, 1);
    expect(mirror.min.z).toBeGreaterThan(3.2);
    expect(object(root, 'room-dressing-mirror-glass').rotation.y).toBeCloseTo(Math.PI);

    // 圆凳推在台面开口正中：坐面低于台底，平面完全落在开口内
    const stool = bounds(root, 'room-dressing-stool');
    expect(stool.max.y).toBeLessThan(0.7);
    expect(stool.min.x).toBeGreaterThan(-1.73);
    expect(stool.max.x).toBeLessThan(-1.065);
    expect(stool.min.z).toBeGreaterThan(carcass.min.z);

    // 落地灯 1.5~1.6m、灯头朝梳妆台（+X）倾，立在梳妆台与小推车之间靠墙角一侧
    const shade = bounds(root, 'room-floor-lamp-shade');
    expect(shade.max.y).toBeGreaterThan(1.5);
    expect(shade.max.y).toBeLessThan(1.6);
    expect(object(root, 'room-floor-lamp-head').rotation.z).toBeLessThan(-0.2);
    expect((object(root, 'room-floor-lamp-point-light') as THREE.PointLight).castShadow).toBe(false);
    const lampBase = bounds(root, 'room-floor-lamp-base');
    expect(lampBase.min.x).toBeGreaterThan(-3.4);
    expect(dresser.min.x - lampBase.max.x).toBeGreaterThan(0.3);
    expect(lampBase.intersectsBox(bounds(root, 'room-trolley'))).toBe(false);

    // 地毯不被梳妆台、镜子或落地灯压到
    const rug = bounds(root, 'room-rug-field');
    for (const name of ['room-dresser', 'room-dressing-mirror', 'room-floor-lamp']) {
      expect(rug.intersectsBox(bounds(root, name)), name).toBe(false);
    }
    // 红框这一片台前仍留 60cm 以上走动净空
    const standing = new THREE.Box3(new THREE.Vector3(-2.2, 0, 2.1), new THREE.Vector3(-0.9, 1.8, 2.7));
    for (const obstacle of definition.nav.obstacles) {
      const box = new THREE.Box3(
        new THREE.Vector3(obstacle.minX, 0, obstacle.minZ),
        new THREE.Vector3(obstacle.maxX, obstacle.height, obstacle.maxZ),
      );
      expect(box.intersectsBox(standing), obstacle.id).toBe(false);
    }
    expect(definition.nav.obstacles.map((item) => item.id)).toEqual([
      'room-bed', 'room-desk', 'room-chair', 'room-suitcase', 'room-wastebasket',
      'room-wardrobe', 'room-wardrobe-door', 'room-bookshelf', 'room-dresser', 'room-floor-lamp',
    ]);
  });

  it('新增盒体复用局部几何、百叶/按键/叶片批量化；场景释放克隆而全局释放共享贴图与光晕', () => {
    const { root } = build();
    expect(mesh(root, 'room-blind-headbox').geometry).toBe(mesh(root, 'room-keyboard-base').geometry);
    expect(mesh(root, 'room-keyboard-keys').geometry).toBe(mesh(root, 'room-shelf-book-brick-hard-covers').geometry);
    const clone = material(root, 'room-cream-wall-0');
    const source = getPlasterMaterial({ repeatX: 3, repeatY: 1 });
    const glow = getWarmLampGlowMaterial();
    const slats = mesh(root, 'room-blind-slats') as THREE.InstancedMesh;
    const leaves = mesh(root, 'room-plant-leaves') as THREE.InstancedMesh;
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

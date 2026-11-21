// scenes3d/materials.test.ts —— 接触阴影贴地判定与缓存释放的 Node 契约（不触碰 DOM / WebGL）

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHARED_RESOURCE_FLAG } from '../world/resources';
import {
  disposeMaterialCache, getFabricMaterial, getFacadeBrickMaterial,
  getFacadeConcreteMaterial, getFacadeTileMaterial, getFacadeWindowMaterial,
  getPlasterMaterial, getStoreInteriorMaterial,
  getWarmLampGlowMaterial, getWoodFloorMaterial, isGroundedActor,
} from './materials';

function createActor(name: string): THREE.Group {
  const actor = new THREE.Group();
  actor.name = name;
  actor.userData.actorModelId = name.replace(/^actor-/, '');
  return actor;
}

describe('接触阴影贴地判定', () => {
  it('地面上的 actor-* 角色挂阴影，非角色对象不挂', () => {
    const scene = new THREE.Scene();
    const actor = createActor('actor-linxia');
    const prop = new THREE.Group();
    prop.name = 'medicine-bag';
    scene.add(actor, prop);
    scene.updateMatrixWorld(true);

    expect(isGroundedActor(actor)).toBe(true);
    expect(isGroundedActor(prop)).toBe(false);
  });

  it('gate 背人组合：carryFather 贴地可挂，carryLinxia 悬空 0.45m 必须跳过', () => {
    const scene = new THREE.Scene();
    const carryGroup = new THREE.Group();
    carryGroup.name = 'carryGroup';
    const carryFather = createActor('actor-father');
    const carryLinxia = createActor('actor-linxia');
    carryLinxia.position.set(0, 0.45, 0.3);
    carryGroup.add(carryFather, carryLinxia);
    scene.add(carryGroup);
    scene.updateMatrixWorld(true);

    expect(isGroundedActor(carryFather)).toBe(true);
    expect(isGroundedActor(carryLinxia)).toBe(false);
  });

  it('父级整体抬高时，即使本地 y = 0 也不挂（世界脚底不在地面）', () => {
    const scene = new THREE.Scene();
    const platform = new THREE.Group();
    platform.position.y = 0.5;
    const actor = createActor('actor-ayuan');
    platform.add(actor);
    scene.add(platform);
    scene.updateMatrixWorld(true);

    expect(isGroundedActor(actor)).toBe(false);
  });

  it('角色内部 actor-pose / actor-props 同名前缀子组不重复挂阴影', () => {
    const scene = new THREE.Scene();
    const actor = createActor('actor-linxia');
    const pose = new THREE.Group();
    pose.name = 'actor-pose';
    const props = new THREE.Group();
    props.name = 'actor-props';
    actor.add(pose, props);
    scene.add(actor);
    scene.updateMatrixWorld(true);

    expect(isGroundedActor(actor)).toBe(true);
    expect(isGroundedActor(pose)).toBe(false);
    expect(isGroundedActor(props)).toBe(false);
  });
});

describe('平台接触阴影', () => {
  it('站在高台上的角色相对地形贴地，背负角色仍不挂阴影', () => {
    const scene = new THREE.Scene();
    const father = createActor('actor-father');
    father.position.y = 0.42;
    const linxia = createActor('actor-linxia');
    linxia.position.y = 0.45;
    father.add(linxia);
    scene.add(father);
    scene.updateMatrixWorld(true);
    expect(isGroundedActor(father, 0.42)).toBe(true);
    expect(isGroundedActor(linxia, 0.42)).toBe(false);
  });
});

describe('材质缓存释放', () => {
  it('空缓存（未生成任何贴图）时 disposeMaterialCache 不触碰 DOM 且不报错', () => {
    expect(() => disposeMaterialCache()).not.toThrow();
  });
});

interface PixelCanvas {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  stops: Array<[number, string]>;
}

/** 沿用 Node Canvas 替身方式，但保留工厂逐像素输出，避免把真实 PBR 材质 mock 掉。 */
function stubCanvas(): void {
  vi.stubGlobal('document', { createElement: () => {
    const canvas: PixelCanvas = { width: 0, height: 0, pixels: new Uint8ClampedArray(), stops: [] };
    const context = {
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (image: { data: Uint8ClampedArray }) => { canvas.pixels = image.data; },
      createRadialGradient: () => ({ addColorStop: (offset: number, color: string) => canvas.stops.push([offset, color]) }),
      fillRect: () => {},
    };
    return { ...canvas, getContext: () => context,
      get pixels() { return canvas.pixels; }, get stops() { return canvas.stops; } };
  } });
}

function pixel(texture: THREE.Texture, x: number, y: number): number[] {
  const canvas = texture.image as PixelCanvas;
  const offset = (y * canvas.width + x) * 4;
  return Array.from(canvas.pixels.slice(offset, offset + 4));
}

describe('卧室程序化 PBR 纹理与所有权', () => {
  beforeEach(stubCanvas);
  afterEach(() => { disposeMaterialCache(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('乳胶漆是中性低对比逐像素微粒，可染色且不再出现粗砂云斑', () => {
    const plaster = getPlasterMaterial();
    const data = (plaster.map!.image as PixelCanvas).pixels;
    let min = 255, max = 0;
    let neutral = true;
    for (let i = 0; i < data.length; i += 4) {
      min = Math.min(min, data[i]); max = Math.max(max, data[i]);
      neutral = neutral && data[i] === data[i + 1] && data[i] === data[i + 2];
    }
    expect(neutral).toBe(true);
    expect(max - min).toBeGreaterThan(0);
    expect(max - min).toBeLessThanOrEqual(5);
    expect(min).toBeGreaterThan(245);
    expect(plaster.color.getHex()).toBe(0xffffff);
    expect(plaster.roughness).toBe(0.94);
  });

  it('橡木具备清晰窄缝、自然板间色差与低对比顺纹年轮', () => {
    const wood = getWoodFloorMaterial();
    expect((wood.map!.image as PixelCanvas).width).toBe(512);
    expect(pixel(wood.map!, 200, 0).slice(0, 3)).toEqual([91, 66, 43]);
    const boardTones = [64, 192, 320, 448].map((y) => pixel(wood.map!, 200, y)[0]);
    expect(Math.min(...boardTones)).toBeGreaterThan(145);
    expect(Math.max(...boardTones) - Math.min(...boardTones)).toBeGreaterThan(5);
    const grain = Array.from({ length: 32 }, (_, i) => pixel(wood.map!, 20 + i * 12, 64)[0]).filter((r) => r > 130);
    expect(Math.max(...grain) - Math.min(...grain)).toBeGreaterThan(3);
    expect(Math.max(...grain) - Math.min(...grain)).toBeLessThan(35);
  });

  it('清漆 roughnessMap 与木纹同平铺、线性数据；板内微光泽而板缝粗糙', () => {
    const wood = getWoodFloorMaterial({ repeatX: 2, repeatY: 12 });
    const roughness = wood.roughnessMap!;
    expect(roughness).toBeInstanceOf(THREE.CanvasTexture);
    expect(wood.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(roughness.colorSpace).toBe(THREE.NoColorSpace);
    expect(roughness.repeat.toArray()).toEqual([2, 12]);
    expect(roughness.wrapS).toBe(THREE.RepeatWrapping);
    expect(roughness.wrapT).toBe(THREE.RepeatWrapping);
    expect(roughness.anisotropy).toBe(4);
    const board = pixel(roughness, 200, 64);
    expect(board[0]).toBe(board[1]); expect(board[1]).toBe(board[2]);
    expect(board[0] / 255 * wood.roughness).toBeGreaterThan(0.4);
    expect(board[0] / 255 * wood.roughness).toBeLessThan(0.55);
    expect(pixel(roughness, 200, 0)[0]).toBeGreaterThan(board[0] + 35);
  });

  it('同参数共享、不同平铺独立；全局释放恰好一次且下次获取重建', () => {
    const first = getWoodFloorMaterial({ repeatX: 2, repeatY: 12 });
    expect(getWoodFloorMaterial({ repeatX: 2, repeatY: 12 })).toBe(first);
    const other = getWoodFloorMaterial({ repeatX: 3, repeatY: 4 });
    expect(other).not.toBe(first);
    expect(other.map).not.toBe(first.map);
    expect(other.map!.image).toBe(first.map!.image);
    expect(other.roughnessMap!.image).toBe(first.roughnessMap!.image);
    expect(first.map!.repeat.toArray()).toEqual([2, 12]);
    const resources = [first, first.map!, first.roughnessMap!, other, other.map!, other.roughnessMap!];
    const dispose = resources.map((resource) => {
      expect(resource.userData[SHARED_RESOURCE_FLAG]).toBe(true);
      return vi.spyOn(resource, 'dispose');
    });
    disposeMaterialCache(); disposeMaterialCache();
    dispose.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    const rebuilt = getWoodFloorMaterial({ repeatX: 2, repeatY: 12 });
    expect(rebuilt).not.toBe(first);
    expect(rebuilt.map!.image).not.toBe(first.map!.image);
  });

  it('被面与床单复用中性细织纹，粗糙度体现无金属布料', () => {
    const fabric = getFabricMaterial({ repeatX: 6, repeatY: 8 });
    expect(getFabricMaterial({ repeatX: 6, repeatY: 8 })).toBe(fabric);
    expect((fabric.map!.image as PixelCanvas).width).toBe(128);
    expect(fabric.roughness).toBe(0.98);
    expect(fabric.metalness).toBe(0);
    expect(pixel(fabric.map!, 32, 32)[0]).not.toBe(pixel(fabric.map!, 33, 33)[0]);
  });

  it('Sprite 光晕缓存带共享标记、柔边透明且随全局材质缓存释放重建', () => {
    const glow = getWarmLampGlowMaterial();
    expect(getWarmLampGlowMaterial()).toBe(glow);
    expect(glow.userData[SHARED_RESOURCE_FLAG]).toBe(true);
    expect(glow.map!.userData[SHARED_RESOURCE_FLAG]).toBe(true);
    expect((glow.map!.image as PixelCanvas).width).toBe(64);
    expect((glow.map!.image as PixelCanvas).stops).toEqual([
      [0, 'rgba(255, 255, 255, 0.55)'], [0.28, 'rgba(255, 255, 255, 0.22)'], [1, 'rgba(255, 255, 255, 0)'],
    ]);
    expect(glow.depthWrite).toBe(false);
    expect(glow.blending).toBe(THREE.AdditiveBlending);
    const materialDispose = vi.spyOn(glow, 'dispose');
    const textureDispose = vi.spyOn(glow.map!, 'dispose');
    disposeMaterialCache(); disposeMaterialCache();
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
    expect(getWarmLampGlowMaterial()).not.toBe(glow);
  });

  it('街道外墙与橱窗程序化材质带共享标记、独立贴图且随全局缓存释放一次', () => {
    const tile = getFacadeTileMaterial({ repeatX: 3, repeatY: 2 });
    const concrete = getFacadeConcreteMaterial({ repeatX: 2, repeatY: 3 });
    const brick = getFacadeBrickMaterial({ repeatX: 3, repeatY: 2 });
    const win = getFacadeWindowMaterial();
    const interior = getStoreInteriorMaterial();

    expect(getFacadeTileMaterial({ repeatX: 3, repeatY: 2 })).toBe(tile);
    expect(tile.roughnessMap).toBeInstanceOf(THREE.CanvasTexture);
    expect(tile.roughnessMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(concrete.roughness).toBeGreaterThanOrEqual(0.85);
    expect(brick.roughness).toBeGreaterThanOrEqual(0.88);
    expect(win.roughness).toBeLessThan(0.3);
    expect(interior.emissiveMap).toBe(interior.map);
    expect(interior.emissiveIntensity).toBeLessThanOrEqual(0.4);

    const resources = [
      tile, tile.map!, tile.roughnessMap!,
      concrete, concrete.map!,
      brick, brick.map!,
      win, win.map!,
      interior, interior.map!,
    ];
    const spies = resources.map((resource) => {
      expect(resource.userData[SHARED_RESOURCE_FLAG]).toBe(true);
      return vi.spyOn(resource, 'dispose');
    });
    disposeMaterialCache();
    disposeMaterialCache();
    spies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
  });
});

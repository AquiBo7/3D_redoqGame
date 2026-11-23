// world/InteractionSystem.test.ts —— 触发区高度判定与 scene:enterZone 事件契约
// 重点验证多层场景：站在 1F 区域正上方的 2F 玩家绝不隔层触发，真正踏入后准确触发一次。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../core/eventBus';
import { InteractionSystem } from './InteractionSystem';
import type { InteractionHudBridge } from './InteractionSystem';
import { FIRST_PERSON_CONFIG } from './worldConfig';
import type { ZoneConfig } from './worldSceneTypes';
import { F1_DOORWAY_BOX_ZONE, F1_OFFICE_ZONE, FLOOR2_Y } from './twoFloorNavFixture';

type Listener = (event: unknown) => void;

class FakeWindow {
  innerWidth = 800;
  innerHeight = 450;
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
}

const OFFICE_X = F1_OFFICE_ZONE.kind === 'circle' ? F1_OFFICE_ZONE.center.x : -2;
const OFFICE_Z = F1_OFFICE_ZONE.kind === 'circle' ? F1_OFFICE_ZONE.center.z : 4.4;

let bus: EventBus;
let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let system: InteractionSystem | null = null;
let feetY = 0;

function createHud(): InteractionHudBridge {
  return { setAimed: vi.fn(), setGazeProgress: vi.fn(), setTargets: vi.fn() };
}

function buildSystem(options: { getFeetY?: () => number } = {}): InteractionSystem {
  const instance = new InteractionSystem({
    scene,
    camera,
    domElement: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450 }),
    } as unknown as HTMLElement,
    bus,
    hud: createHud(),
    getSceneId: () => 'S8',
    isInputEnabled: () => true,
    getFeetY: options.getFeetY,
  });
  system = instance;
  return instance;
}

/** 把玩家挪到指定平面位置与脚底高度（控制器已按楼层算好高度） */
function placeAt(x: number, z: number, y: number): void {
  feetY = y;
  camera.position.set(x, y + FIRST_PERSON_CONFIG.eyeHeight, z);
}

function advance(frames: number): void {
  for (let index = 0; index < frames; index += 1) system?.update(0.05, index * 16);
}

/** 订阅 scene:enterZone，返回已收到的 zoneId 列表（实时观察增长） */
function recordZoneEvents(): { zoneIds: string[]; payloads: { sceneId: string; zoneId: string }[] } {
  const state = { zoneIds: [] as string[], payloads: [] as { sceneId: string; zoneId: string }[] };
  bus.on('scene:enterZone', ({ sceneId, zoneId }) => {
    state.zoneIds.push(zoneId);
    state.payloads.push({ sceneId, zoneId });
  });
  return state;
}

beforeEach(() => {
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  });
  vi.stubGlobal('window', new FakeWindow());
  feetY = 0;
});

afterEach(() => {
  system?.dispose();
  system = null;
  vi.unstubAllGlobals();
});

describe('InteractionSystem 隔层误触发防护', () => {
  it('2F 玩家站在 1F 办公室区域正上方不触发，走下 1F 踏入后准确触发一次', () => {
    bus = new EventBus();
    camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 120);
    scene = new THREE.Scene();
    const system = buildSystem({ getFeetY: () => feetY });

    // 区域中心在 1F 办公室门口，梯脚方向 1.7 米外是区域外
    const outsideZ = OFFICE_Z - 1.7;
    placeAt(OFFICE_X, outsideZ, FLOOR2_Y);
    const events = recordZoneEvents();
    system.setup({ zones: [F1_OFFICE_ZONE], occluders: [] });

    // 走到区域中心正上方的 2F：XZ 完全重合，只有脚底高度不同
    placeAt(OFFICE_X, OFFICE_Z, FLOOR2_Y);
    advance(30);
    expect(events.zoneIds).toEqual([]);

    // 沿楼梯下到 1F（仍在区域外），不触发
    placeAt(OFFICE_X, outsideZ, 0);
    advance(10);
    expect(events.zoneIds).toEqual([]);

    // 踏上 1F 区域：准确触发一次
    placeAt(OFFICE_X, OFFICE_Z, 0);
    advance(5);
    expect(events.zoneIds).toEqual(['f1-office']);
    expect(events.payloads[0].sceneId).toBe('S8');

    // once 区域走出再走回：不再重复触发
    placeAt(OFFICE_X, outsideZ, 0);
    advance(5);
    placeAt(OFFICE_X, OFFICE_Z, 0);
    advance(5);
    expect(events.zoneIds).toEqual(['f1-office']);
  });

  it('盒形区域按自身楼层命中：1F 门口踩到触发，2F 同一 XZ 不触发', () => {
    bus = new EventBus();
    camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 120);
    scene = new THREE.Scene();
    const system = buildSystem({ getFeetY: () => feetY });

    placeAt(-6.5, -3, FLOOR2_Y);
    const events = recordZoneEvents();
    system.setup({ zones: [F1_DOORWAY_BOX_ZONE], occluders: [] });

    advance(20);
    expect(events.zoneIds).toEqual([]);

    placeAt(-6.5, -3, 0);
    advance(5);
    expect(events.zoneIds).toEqual(['f1-doorway']);
  });

  it('非 once 区域每进出一次各触发一次：证明 once 语义未被高度判定改动', () => {
    bus = new EventBus();
    camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 120);
    scene = new THREE.Scene();
    const system = buildSystem({ getFeetY: () => feetY });
    const loopZone: ZoneConfig = {
      id: 'f1-loop',
      kind: 'circle',
      center: { x: OFFICE_X, y: 0, z: OFFICE_Z },
      radius: 1.5,
      once: false,
    };

    const outsideZ = OFFICE_Z - 1.7;
    placeAt(OFFICE_X, outsideZ, 0);
    const events = recordZoneEvents();
    system.setup({ zones: [loopZone], occluders: [] });

    for (let round = 0; round < 3; round += 1) {
      placeAt(OFFICE_X, OFFICE_Z, 0);
      advance(3);
      placeAt(OFFICE_X, outsideZ, 0);
      advance(3);
    }

    expect(events.zoneIds).toEqual(['f1-loop', 'f1-loop', 'f1-loop']);
  });

  it('未注入 getFeetY 时按相机高度回退：单层旧场景行为不变', () => {
    bus = new EventBus();
    camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 120);
    scene = new THREE.Scene();
    const system = buildSystem();

    camera.position.set(OFFICE_X, FIRST_PERSON_CONFIG.eyeHeight, OFFICE_Z - 1.7);
    const events = recordZoneEvents();
    system.setup({ zones: [{ ...F1_OFFICE_ZONE, once: false }], occluders: [] });
    advance(5);
    expect(events.zoneIds).toEqual([]);

    camera.position.set(OFFICE_X, FIRST_PERSON_CONFIG.eyeHeight, OFFICE_Z);
    advance(5);
    expect(events.zoneIds).toEqual(['f1-office']);
  });

  it('setup 时已站在区域内不补触发：只有真正跨入边界才发事件', () => {
    bus = new EventBus();
    camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 120);
    scene = new THREE.Scene();
    const system = buildSystem({ getFeetY: () => feetY });

    placeAt(OFFICE_X, OFFICE_Z, 0);
    const events = recordZoneEvents();
    system.setup({ zones: [F1_OFFICE_ZONE], occluders: [] });
    advance(20);
    expect(events.zoneIds).toEqual([]);
  });
});

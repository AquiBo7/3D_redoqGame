import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import { sampleGroundHeight } from '../world/navMath';

vi.mock('./shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('./shared')>();
  return {
    ...original,
    createActorAnimation: (actor: THREE.Object3D) => ({
      play: (clip: string) => { actor.userData.clip = clip; },
      update: (dt: number) => { actor.userData.animationTime = (actor.userData.animationTime ?? 0) + dt; },
      dispose: () => { actor.userData.disposed = true; },
    }),
  };
});

import { createGateDefinition, GATE_WALKERS, gateRuntime } from './gate';

function enter() {
  const actors: Record<string, THREE.Object3D> = {};
  for (const path of GATE_WALKERS) {
    actors[path.id] = new THREE.Group();
    actors[path.id].position.set(path.x, 0, path.startZ);
  }
  const context = { sceneId: 'S6' as const, bus: new EventBus(), actors, setInteractableVisible: vi.fn() };
  gateRuntime.enter(context);
  return { actors, context };
}

afterEach(() => gateRuntime.exit());

describe('校门左后方观察与双侧进校路人', () => {
  it('打字男生在出生点左后方约96度，光点与碰撞锚点一致', () => {
    const definition = createGateDefinition('S5');
    const position = definition.hotspots!.find((item) => item.id === 'typer')!.position;
    const angle = new THREE.Vector3(position.x, 0, position.z - definition.spawn.z)
      .angleTo(new THREE.Vector3(0, 0, -1)) * 180 / Math.PI;
    expect(position).toEqual({ x: -3.6, y: 1.35, z: 7.95 });
    expect(angle).toBeGreaterThan(94);
    expect(angle).toBeLessThan(98);
    expect(definition.nav.obstacles.find((item) => item.id === 'gate-typer')).toMatchObject({
      minX: -4, maxX: -3.2, minZ: 7.55, maxZ: 8.35,
    });
  });

  it('两条完整路线连同角色半径避开中央通路、门柱与静态围观者', () => {
    const definition = createGateDefinition('S5');
    expect(GATE_WALKERS).toHaveLength(2);
    for (const path of GATE_WALKERS) {
      expect(Math.abs(path.x)).toBe(2.85);
      expect(path.endZ).toBeLessThanOrEqual(-20);
      expect(path.endZ).toBeGreaterThanOrEqual(-24);
      for (let z = path.startZ; z >= path.endZ; z -= 0.05) {
        for (const obstacle of definition.nav.obstacles) {
          const overlap = path.x + 0.24 >= obstacle.minX && path.x - 0.24 <= obstacle.maxX
            && z + 0.24 >= obstacle.minZ && z - 0.24 <= obstacle.maxZ;
          expect(overlap, `${path.id} ${obstacle.id} ${z}`).toBe(false);
        }
      }
    }
  });

  it('逐帧前进并逐级贴地，错峰后进入原生walk动画', () => {
    const { actors } = enter();
    const definition = createGateDefinition('S5');
    gateRuntime.tick!(0.5);
    expect(actors['student-walker'].position.z).toBeCloseTo(8.2 - 1.15 * 0.5);
    expect(actors['student-walker-right'].position.z).toBe(7.4);
    expect(actors['student-walker-right'].userData.clip).toBe('idle');
    for (let frame = 0; frame < 220; frame += 1) {
      gateRuntime.tick!(0.05);
      for (const path of GATE_WALKERS) {
        const actor = actors[path.id];
        expect(actor.position.y).toBeCloseTo(sampleGroundHeight(actor.position, definition.nav.surfaces));
        expect(actor.position.x).toBe(path.x);
        if (frame > 20) expect(actor.userData.clip).toBe('walk');
      }
    }
    expect(actors['student-walker'].userData.animationTime).toBeGreaterThan(10);
  });

  it('共享场景重复enter不重启路线，终点钳制并切换待机动画', () => {
    const { actors, context } = enter();
    gateRuntime.tick!(2);
    const before = actors['student-walker-right'].position.z;
    gateRuntime.enter(context);
    gateRuntime.tick!(0.2);
    expect(actors['student-walker-right'].position.z).toBeCloseTo(before - 1.08 * 0.2);
    gateRuntime.tick!(60);
    for (const path of GATE_WALKERS) {
      expect(actors[path.id].position.z).toBe(path.endZ);
      expect(actors[path.id].position.y).toBeCloseTo(0.42);
      expect(actors[path.id].userData.clip).toBe(path.arrivedClip);
    }
    gateRuntime.tick!(2);
    expect(actors['student-walker'].position.z).toBe(-22);
  });

  it('退出释放动画和错峰状态，新场景能重新开始', () => {
    const { actors } = enter();
    gateRuntime.tick!(4);
    gateRuntime.exit();
    expect(actors['student-walker'].userData.disposed).toBe(true);
    const previous = actors['student-walker'].position.z;
    gateRuntime.tick!(1);
    expect(actors['student-walker'].position.z).toBe(previous);
    const next = enter();
    gateRuntime.tick!(0.5);
    expect(next.actors['student-walker-right'].position.z).toBe(7.4);
  });
});

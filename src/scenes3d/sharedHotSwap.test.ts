// scenes3d/sharedHotSwap.test.ts —— 弱网降级：胶囊体占位 + 模型到达后原地热替换
// 纯 Node 环境：mock 掉 world/resources 的下载入口，用微任务模拟异步到达。

import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  loaded: false,
  complete: null as (() => void) | null,
  instantiateCount: 0,
}));

vi.mock('../world/resources', async () => {
  const three = await import('three');
  return {
    hasCharacterModel: () => h.loaded,
    loadCharacterModel: () =>
      new Promise((resolve) => {
        h.complete = () => {
          h.loaded = true;
          const template = new three.Group();
          template.add(
            new three.Mesh(new three.BoxGeometry(1, 1, 1), new three.MeshBasicMaterial()),
          );
          resolve(template);
        };
      }),
    instantiateCharacterModel: () => {
      h.instantiateCount += 1;
      const group = new three.Group();
      group.add(new three.Mesh(new three.BoxGeometry(1, 1, 1), new three.MeshBasicMaterial()));
      return group;
    },
    getCharacterAnimations: () => [],
  };
});

import { createCharacterActor } from './shared';

function findByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let hit: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (object.name === name) hit = object;
  });
  return hit;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('createCharacterActor 异步热替换', () => {
  beforeEach(() => {
    h.loaded = false;
    h.complete = null;
    h.instantiateCount = 0;
  });

  it('模型未就绪时先挂胶囊体；仍在场景树内则下载完成后热替换为真实模型并保留道具', async () => {
    const scene = new THREE.Scene();
    const actor = createCharacterActor('linxia', 1.62, 0xd9c98f, {
      yaw: Math.PI,
      props: [{ kind: 'phone', color: 0x9aa2ab }],
    });
    scene.add(actor);

    expect(findByName(actor, 'actor-fallback')).not.toBeNull();
    expect(findByName(actor, 'actor-pose')).toBeNull();
    expect(h.instantiateCount).toBe(0);

    expect(h.complete).not.toBeNull();
    h.complete?.();
    await flushMicrotasks();

    expect(findByName(actor, 'actor-fallback')).toBeNull();
    const pose = findByName(actor, 'actor-pose');
    expect(pose).not.toBeNull();
    expect(h.instantiateCount).toBe(1);
    // 外层朝向不被热替换改写
    expect(actor.rotation.y).toBeCloseTo(Math.PI);

    // 道具重新按真实身高校准后仍挂在角色上
    const props = findByName(actor, 'actor-props');
    expect(props?.children.length).toBe(1);

    // 热替换后的模型网格启用阴影
    let shadowCasters = 0;
    pose?.traverse((object) => {
      if (object instanceof THREE.Mesh && object.castShadow) shadowCasters += 1;
    });
    expect(shadowCasters).toBeGreaterThanOrEqual(1);
  });

  it.each(['ayuan', 'studentFemale', 'studentMale', 'volunteer'] as const)('%s 热替换保持不投影且道具与模型完整接收阴影', async (id) => {
    const scene = new THREE.Scene();
    const actor = createCharacterActor(id, 1.7, 0xffffff, { props: [{ kind: 'phone' }] });
    scene.add(actor);
    h.complete?.();
    await flushMicrotasks();
    expect(findByName(actor, 'actor-pose')).not.toBeNull();
    let meshes = 0;
    actor.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      meshes += 1;
      expect(object.castShadow).toBe(false);
      expect(object.receiveShadow).toBe(true);
    });
    expect(meshes).toBe(2);
  });

  it('显式关闭主角投影在热替换后仍保持，手持道具同样不投影', async () => {
    const scene = new THREE.Scene();
    const actor = createCharacterActor('linxia', 1.62, 0xffffff, { castShadow: false, props: [{ kind: 'phone' }] });
    scene.add(actor);
    h.complete?.();
    await flushMicrotasks();
    expect(findByName(actor, 'actor-pose')).not.toBeNull();
    actor.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        expect(object.castShadow).toBe(false);
        expect(object.receiveShadow).toBe(true);
      }
    });
  });

  it('角色已脱离场景树时，异步结果到达后不再替换（防止切场景后回填幽灵节点）', async () => {
    const actor = createCharacterActor('father', 1.78, 0x8f8578);
    expect(findByName(actor, 'actor-fallback')).not.toBeNull();

    h.complete?.();
    await flushMicrotasks();

    expect(findByName(actor, 'actor-fallback')).not.toBeNull();
    expect(findByName(actor, 'actor-pose')).toBeNull();
    expect(h.instantiateCount).toBe(0);
  });
});
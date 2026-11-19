// scenes3d/materials.test.ts —— 接触阴影贴地判定与缓存释放的 Node 契约（不触碰 DOM / WebGL）

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { disposeMaterialCache, isGroundedActor } from './materials';

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

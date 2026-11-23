import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { poseHandsOnChestPhone } from './shared';

/** 一副与真实角色同名的手臂骨骼：肩在 y=1.35、大臂 0.28、小臂 0.26，本地 +X 是角色的左手边 */
function buildRig(yaw: number): {
  actor: THREE.Group;
  phone: THREE.Mesh;
  template: THREE.Group;
  before: THREE.Quaternion[];
} {
  const template = new THREE.Group();
  for (const [prefix, side] of [['L', 1], ['R', -1]] as const) {
    const shoulder = new THREE.Bone();
    shoulder.name = `${prefix}_Upperarm`;
    shoulder.position.set(side * 0.19, 1.35, 0);
    shoulder.rotation.set(0, 0, side * 0.12);
    const elbow = new THREE.Bone();
    elbow.name = `${prefix}_Forearm`;
    elbow.position.y = -0.28;
    const wrist = new THREE.Bone();
    wrist.name = `${prefix}_Hand`;
    wrist.position.y = -0.26;
    elbow.add(wrist);
    shoulder.add(elbow);
    template.add(shoulder);
  }
  const head = new THREE.Bone();
  head.name = 'Head';
  head.position.set(0, 1.52, 0);
  template.add(head);

  const before = template.children.map((bone) => bone.quaternion.clone());
  const instance = template.clone(true);
  const modelRoot = new THREE.Group();
  modelRoot.userData.actorModelRootId = 'ayuan';
  modelRoot.add(instance);

  const actor = new THREE.Group();
  actor.rotation.y = yaw;
  actor.position.set(2.4, 0, -3.1);
  actor.add(modelRoot);

  const props = new THREE.Group();
  props.name = 'actor-props';
  // 与 createCharacterProp 的手机位一致：0.71 身高、胸前 0.2 m
  const phone = new THREE.Mesh(new THREE.BoxGeometry(0.084, 0.16, 0.024));
  phone.position.set(0, 1.68 * 0.71, 0.2);
  props.add(phone);
  actor.add(props);
  return { actor, phone, template, before };
}

describe('胸前双手持机姿态', () => {
  it('模型仍在占位、没有手持道具时不摆姿态也不报错', () => {
    expect(poseHandsOnChestPhone(new THREE.Group())).toBe(false);

    const bare = new THREE.Group();
    const props = new THREE.Group();
    props.name = 'actor-props';
    bare.add(props);
    expect(poseHandsOnChestPhone(bare)).toBe(false);
  });

  it.each([0, Math.PI, -1.2])('朝向 %f 下两只手掌都收到手机下缘两侧', (yaw) => {
    const { actor, phone, template, before } = buildRig(yaw);
    expect(poseHandsOnChestPhone(actor)).toBe(true);
    actor.updateWorldMatrix(true, true);
    const center = phone.getWorldPosition(new THREE.Vector3());
    for (const prefix of ['L', 'R']) {
      const hand = actor.getObjectByName(`${prefix}_Hand`)!;
      const wrist = hand.getWorldPosition(new THREE.Vector3());
      // 掌心落在机身下缘左右各 5 cm、下方 3.5 cm
      expect(wrist.distanceTo(center)).toBeLessThan(0.09);
      expect(wrist.y).toBeLessThan(center.y);
      const elbow = actor.getObjectByName(`${prefix}_Forearm`)!;
      const shoulder = actor.getObjectByName(`${prefix}_Upperarm`)!;
      const elbowPos = elbow.getWorldPosition(new THREE.Vector3());
      const shoulderPos = shoulder.getWorldPosition(new THREE.Vector3());
      // 大臂下垂、肘部收在肋侧，小臂向上内收托住手机（与 S8 路人同一套持机骨架读法）
      expect(elbowPos.y).toBeLessThan(wrist.y);
      expect(elbowPos.y).toBeLessThan(shoulderPos.y);
      expect(elbowPos.y).toBeGreaterThan(0.85);
      // 肘不外翻：横向不超过肩宽
      expect(Math.abs(elbowPos.x - actor.getWorldPosition(new THREE.Vector3()).x)).toBeLessThan(0.32);
      // 不反关节：大臂-小臂夹角小于 180°
      const a = elbowPos.clone().sub(shoulderPos).normalize();
      const b = wrist.clone().sub(elbowPos).normalize();
      expect(a.dot(b)).toBeLessThan(0.99);
    }
    // 共享母本一根骨头都没被改动
    template.children.forEach((bone, index) => expect(bone.quaternion.equals(before[index])).toBe(true));
  });

  it('重复调用先把上一次改过的骨骼还原，姿态不逐次累积', () => {
    const { actor } = buildRig(0.6);
    expect(poseHandsOnChestPhone(actor)).toBe(true);
    actor.updateWorldMatrix(true, true);
    const first = ['L', 'R'].map((prefix) =>
      actor.getObjectByName(`${prefix}_Hand`)!.getWorldPosition(new THREE.Vector3()).clone());
    const headFirst = actor.getObjectByName('Head')!.quaternion.clone();
    expect(poseHandsOnChestPhone(actor)).toBe(true);
    actor.updateWorldMatrix(true, true);
    for (let index = 0; index < 2; index += 1) {
      const hand = actor.getObjectByName(index === 0 ? 'L_Hand' : 'R_Hand')!;
      expect(hand.getWorldPosition(new THREE.Vector3()).distanceTo(first[index])).toBeLessThan(1e-6);
    }
    expect(actor.getObjectByName('Head')!.quaternion.angleTo(headFirst)).toBeLessThan(1e-6);
  });

  it('头颈只低一次，手机位置改变后重摆会跟到新位置', () => {
    const { actor, phone } = buildRig(0);
    expect(poseHandsOnChestPhone(actor)).toBe(true);
    const head = actor.getObjectByName('Head')!;
    const lowered = head.quaternion.clone();
    phone.position.set(0.02, 1.2, 0.24);
    expect(poseHandsOnChestPhone(actor)).toBe(true);
    actor.updateWorldMatrix(true, true);
    expect(head.quaternion.angleTo(lowered)).toBeLessThan(1e-6);
    const center = phone.getWorldPosition(new THREE.Vector3());
    for (const prefix of ['L', 'R']) {
      const wrist = actor.getObjectByName(`${prefix}_Hand`)!.getWorldPosition(new THREE.Vector3());
      expect(wrist.distanceTo(center)).toBeLessThan(0.09);
    }
  });
});

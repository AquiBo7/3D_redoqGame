// scenes3d/modelManifest.test.ts —— 模型清单契约：相对路径前缀、文件真实存在、身高与 id 合法

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHARACTER_MODELS, getCharacterModel } from './modelManifest';

describe('CHARACTER_MODELS 清单', () => {
  it('包含 5 位主角模型与 3 份新动画资源，id 不重复', () => {
    expect(CHARACTER_MODELS).toHaveLength(8);
    const ids = CHARACTER_MODELS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(8);
  });

  it('所有模型路径以 ./models/ 开头且为 .glb（禁止写死根路径）', () => {
    for (const entry of CHARACTER_MODELS) {
      expect(entry.path.startsWith('./models/')).toBe(true);
      expect(entry.path.endsWith('.glb')).toBe(true);
      expect(entry.path.startsWith('/')).toBe(false);
    }
  });

  it('清单中的模型文件真实存在于 public/models/', () => {
    for (const entry of CHARACTER_MODELS) {
      // 运行期相对路径基于站点根目录（vite public/），测试按项目根目录校验
      const file = resolve(process.cwd(), 'public', entry.path.slice('./'.length));
      expect(existsSync(file), `缺少模型文件：${entry.path}`).toBe(true);
    }
  });

  it('每位角色身高为正且在合理区间（1.5m–1.9m）', () => {
    for (const entry of CHARACTER_MODELS) {
      expect(entry.heightM).toBeGreaterThan(1.5);
      expect(entry.heightM).toBeLessThan(1.9);
    }
  });

  it('每位角色 frontYawRad 为有限值且在 (-π, π] 区间（绕 Y 归正后正面朝 +Z）', () => {
    for (const entry of CHARACTER_MODELS) {
      expect(Number.isFinite(entry.frontYawRad)).toBe(true);
      expect(entry.frontYawRad).toBeGreaterThan(-Math.PI);
      expect(entry.frontYawRad).toBeLessThanOrEqual(Math.PI);
    }
  });

  it('主角与路人模型 frontYawRad 为 -π/2（原生 +X 正面归正为 +Z）', () => {
    const yaws = CHARACTER_MODELS.map((entry) => entry.frontYawRad);
    expect(new Set(yaws).size).toBe(1);
    for (const yaw of yaws) expect(yaw).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('frontYawRad 经 three.js 旋转矩阵实测将原生 +X 正面归正到 +Z（防止符号回退）', () => {
    for (const entry of CHARACTER_MODELS) {
      const object = new THREE.Object3D();
      object.rotation.y = entry.frontYawRad;
      const front = new THREE.Vector3(1, 0, 0).applyQuaternion(object.quaternion);
      expect(front.x).toBeCloseTo(0, 6);
      expect(front.y).toBeCloseTo(0, 6);
      expect(front.z).toBeCloseTo(1, 6);
    }
  });

  it('getCharacterModel 按 id 取回对应条目，未知 id 抛错', () => {
    expect(getCharacterModel('linxia').name).toBe('林夏');
    expect(getCharacterModel('father').heightM).toBe(1.78);
    expect(() => getCharacterModel('nobody' as never)).toThrow();
  });
});

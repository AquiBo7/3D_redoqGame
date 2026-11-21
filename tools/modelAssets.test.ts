// tools/modelAssets.test.ts —— 压缩产物契约：文件存在、面数与体积达标、UV 撕裂硬校验 === 0
// 纯 Node 环境运行：直接用 gltf-transform NodeIO 读回 public/models/*.glb 校验。

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import { countTris, countUvTears, UV_TEAR_HARD, UV_TEAR_SOFT } from './uvCheck.mjs';

const IO = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const MODEL_FILES = [
  'chr_linxia.glb',
  'chr_father.glb',
  'chr_ayuan.glb',
  'chr_volunteer.glb',
  'chr_protagonist.glb',
] as const;

beforeAll(async () => {
  await MeshoptDecoder.ready;
});

describe('public/models 压缩产物', () => {  it('5 个角色模型文件真实存在', () => {
    for (const file of MODEL_FILES) {
      const path = resolve(process.cwd(), 'public/models', file);
      expect(existsSync(path), `缺少模型文件：${file}`).toBe(true);
    }
  });

  it('每个模型 UV 撕裂硬校验：边 UV 距离 > 0.25 的三角形数量必须为 0', async () => {
    for (const file of MODEL_FILES) {
      const doc = await IO.read(resolve(process.cwd(), 'public/models', file));
      const result = countUvTears(doc);
      expect(
        result.overHard,
        `${file} 存在 ${result.overHard} 个 UV 撕裂三角形（边距 > ${UV_TEAR_HARD}），贴图会出现裂纹`,
      ).toBe(0);
    }
  });

  it('每个模型 UV 软阈值（> 0.10）三角形数量接近 0', async () => {
    for (const file of MODEL_FILES) {
      const doc = await IO.read(resolve(process.cwd(), 'public/models', file));
      const result = countUvTears(doc);
      expect(
        result.overSoft,
        `${file} 边 UV 距离 > ${UV_TEAR_SOFT} 的三角形过多（${result.overSoft} 个）`,
      ).toBeLessThanOrEqual(20);
    }
  });

  it('每个模型面数在 2 万–6 万之间（画质与性能平衡区）', async () => {
    for (const file of MODEL_FILES) {
      const doc = await IO.read(resolve(process.cwd(), 'public/models', file));
      const tris = countTris(doc);
      expect(tris, `${file} 面数 ${tris} 超出预期区间`).toBeGreaterThan(20000);
      expect(tris, `${file} 面数 ${tris} 超出预期区间`).toBeLessThan(60000);
    }
  });

  it('每个模型文件体积 ≤ 2MB（目标 1–1.8MB）', () => {
    for (const file of MODEL_FILES) {
      const sizeMb = statSync(resolve(process.cwd(), 'public/models', file)).size / (1024 * 1024);
      expect(sizeMb, `${file} 体积 ${sizeMb.toFixed(2)}MB 超限`).toBeLessThanOrEqual(2);
    }
  });
});

const NEW_ANIMATED_MODELS = [
  {
    file: 'chr_father_carry.glb',
    clips: ['CarryBags_Dismount', 'CarryBags_SetDown', 'CarryBags_Walk_Loop'],
    expectedSkins: 2,
    allowUnskinnedMeshes: true,
    lockedHipClips: [] as string[],
    minTris: 20000,
  },
  {
    file: 'chr_volunteer.glb',
    clips: ['agree', 'bow', 'wait', 'wave_goodbye_02'],
    expectedSkins: 1,
    allowUnskinnedMeshes: false,
    lockedHipClips: ['wave_goodbye_02'],
    minTris: 20000,
  },
  {
    file: 'chr_student_female.glb',
    clips: ['agree', 'greet_04', 'idle', 'make_a_call_01', 'wait', 'walk'],
    expectedSkins: 1,
    allowUnskinnedMeshes: false,
    lockedHipClips: ['walk', 'greet_04'],
    minTris: 20000,
  },
  {
    file: 'chr_student_male.glb',
    clips: ['agree', 'complain_01', 'fold_arms', 'greet_04', 'make_a_call_02', 'walk'],
    expectedSkins: 1,
    allowUnskinnedMeshes: false,
    lockedHipClips: ['walk', 'greet_04'],
    minTris: 20000,
  },
];

describe('新父女、女老师与同学动画资源', () => {
  it.each(NEW_ANIMATED_MODELS)('$file 体积、面数、UV 与 41 骨蒙皮完整', async (model) => {
    const path = resolve(process.cwd(), 'public/models', model.file);
    expect(statSync(path).size).toBeLessThanOrEqual(2 * 1024 * 1024);
    const doc = await IO.read(path);
    expect(countTris(doc)).toBeGreaterThan(model.minTris);
    expect(countTris(doc)).toBeLessThan(60000);
    expect(countUvTears(doc).overHard).toBe(0);
    expect(countUvTears(doc).overSoft).toBeLessThanOrEqual(20);
    const skins = doc.getRoot().listSkins();
    expect(skins).toHaveLength(model.expectedSkins);
    for (const skin of skins) {
      expect(skin.listJoints()).toHaveLength(41);
    }
    const skinnedMeshes = new Set(
      doc.getRoot().listNodes().filter((node) => node.getMesh() && node.getSkin()).map((node) => node.getMesh()),
    );
    for (const mesh of doc.getRoot().listMeshes()) {
      const mustBeSkinned = !model.allowUnskinnedMeshes || skinnedMeshes.has(mesh);
      for (const primitive of mesh.listPrimitives()) {
        if (mustBeSkinned) {
          expect(primitive.getAttribute('JOINTS_0')).toBeTruthy();
          expect(primitive.getAttribute('WEIGHTS_0')).toBeTruthy();
        }
      }
    }
    expect(doc.getRoot().listAnimations().map((clip) => clip.getName()).sort()).toEqual(model.clips);
    for (const clipName of model.lockedHipClips) {
      const animation = doc.getRoot().listAnimations().find((item) => item.getName() === clipName);
      expect(animation).toBeDefined();
      const channel = animation!.listChannels().find((item) => item.getTargetNode()?.getName() === 'Hip' && item.getTargetPath() === 'translation');
      expect(channel).toBeDefined();
      const values = channel!.getSampler()!.getOutput()!.getArray()!;
      const last = values.length - 3;
      const samples = Array.from({ length: values.length / 3 }, (_, index) => values[index * 3 + 1]);
      expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(1e-4);
      expect(Math.abs(values[last] - values[0])).toBeLessThan(1e-4);
      const heights = Array.from({ length: values.length / 3 }, (_, index) => values[index * 3 + 2]);
      expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.005);
    }
  });
});

const EXPECTED_ANIMATIONS = ['afraid', 'agree', 'greet_04', 'walk', 'wave_goodbye_02'];

describe('林夏双 primitive 共享顶点缓冲契约（双脚修复版）', () => {
  it('主体 + 鞋内衬两个蒙皮 primitive 均保留 JOINTS/WEIGHTS，且不再共享 accessor', async () => {
    const doc = await IO.read(resolve(process.cwd(), 'public/models/chr_linxia.glb'));
    const meshes = doc.getRoot().listMeshes();
    expect(meshes).toHaveLength(1);
    const prims = meshes[0].listPrimitives();
    expect(prims).toHaveLength(2);

    for (const prim of prims) {
      expect(prim.getAttribute('JOINTS_0'), '缺少 JOINTS_0').toBeTruthy();
      expect(prim.getAttribute('WEIGHTS_0'), '缺少 WEIGHTS_0').toBeTruthy();
    }

    const usage = new Map<unknown, number>();
    const add = (accessor: unknown | null): void => {
      if (!accessor) return;
      usage.set(accessor, (usage.get(accessor) ?? 0) + 1);
    };
    for (const prim of prims) {
      add(prim.getIndices());
      for (const semantic of prim.listSemantics()) add(prim.getAttribute(semantic));
    }
    const shared = [...usage.values()].filter((count) => count > 1);
    expect(shared, `仍有 ${shared.length} 个 accessor 被两个 primitive 共享`).toHaveLength(0);

    // 共享的 537,566 顶点缓冲不得残留：各 primitive 顶点数应为其自身压缩后的规模
    for (const prim of prims) {
      expect(prim.getAttribute('POSITION')?.getCount() ?? 0).toBeLessThan(60000);
    }
  });

  it('鞋内衬补丁原样保留：152 面、材质 Shoe inner leather、蒙皮完整', async () => {
    const doc = await IO.read(resolve(process.cwd(), 'public/models/chr_linxia.glb'));
    const prims = doc.getRoot().listMeshes()[0].listPrimitives();
    const shoe = prims.find((prim) => prim.getMaterial()?.getName() === 'Shoe inner leather');
    expect(shoe, '缺少鞋内衬 primitive').toBeDefined();
    expect(shoe?.getIndices()?.getCount()).toBe(152 * 3);
    expect(shoe?.getAttribute('POSITION')?.getCount() ?? 0).toBeLessThanOrEqual(1000);
  });

  it('双 primitive 总面数约 3.3 万（主体减面 + 补丁原样）', async () => {
    const doc = await IO.read(resolve(process.cwd(), 'public/models/chr_linxia.glb'));
    const tris = countTris(doc);
    expect(tris).toBeGreaterThan(32000);
    expect(tris).toBeLessThan(34000);
  });
});

describe('可动林夏骨骼动画契约', () => {
  it('只保留约定的 5 个动画剪辑', async () => {
    const doc = await IO.read(resolve(process.cwd(), 'public/models/chr_linxia.glb'));
    const names = doc
      .getRoot()
      .listAnimations()
      .map((animation) => animation.getName())
      .sort();
    expect(names).toEqual(EXPECTED_ANIMATIONS);
  });

  it('蒙皮与骨骼完整保留', async () => {
    const doc = await IO.read(resolve(process.cwd(), 'public/models/chr_linxia.glb'));
    const skins = doc.getRoot().listSkins();
    expect(skins).toHaveLength(1);
    expect(skins[0].listJoints().length).toBe(41);
    const skinnedNodes = doc.getRoot().listNodes().filter((node) => node.getMesh() && node.getSkin());
    expect(skinnedNodes.length).toBeGreaterThanOrEqual(1);
  });

  it('walk 已原地化：前进轴恒定、首尾无漂移、保留竖向步态起伏', async () => {
    const doc = await IO.read(resolve(process.cwd(), 'public/models/chr_linxia.glb'));
    const walk = doc.getRoot().listAnimations().find((animation) => animation.getName() === 'walk');
    expect(walk).toBeDefined();

    // 该 Tripo 骨架经 Root 旋转后：Hip 本地 Y 为前进轴、X 为侧向、Z 为竖直
    const channel = walk?.listChannels().find((item) => {
      const node = item.getTargetNode();
      return item.getTargetPath() === 'translation' && node !== null && node.getName() === 'Hip';
    });
    expect(channel).toBeDefined();

    const output = channel?.getSampler().getOutput().getArray();
    expect(output).toBeDefined();
    const values = output as Float32Array;
    const frames = values.length / 3;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let index = 0; index < frames; index += 1) {
      const x = values[index * 3];
      const y = values[index * 3 + 1];
      const z = values[index * 3 + 2];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }

    expect(frames).toBeGreaterThan(30);
    // 前进轴（本地 Y）必须锁死
    expect(maxY - minY).toBeLessThan(1e-4);
    // 侧向（本地 X）首尾一致：循环回接不跳变、无净漂移
    const lastIndex = frames - 1;
    expect(Math.abs(values[lastIndex * 3] - values[0])).toBeLessThan(1e-4);
    expect(Math.abs(values[lastIndex * 3 + 2] - values[2])).toBeLessThan(1e-4);
    // 竖向（本地 Z）保留步态起伏
    expect(maxZ - minZ).toBeGreaterThan(0.005);
    expect(maxX - minX).toBeGreaterThan(0.01);
  });
});

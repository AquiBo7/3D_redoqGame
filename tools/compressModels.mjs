// tools/compressModels.mjs —— 把 art/raw/ 原始 Tripo 模型压缩为游戏用轻量 GLB 到 public/models/
// 画质优先 + 零 UV 撕裂流程（修复版）：
//   simplifyWithAttributes 一步减面：5 维属性 [nx, ny, nz, u, v] 保护法线与 UV，
//   属性权重 [0.05, 0.05, 0.05, 25, 25]（UV 极高权重防跨岛塌陷），flags ['Permissive']，
//   目标 33,000 面、target_error 0.05；单模型异常时允许上调至 3.5–4.5 万面。
//   之后 compactPrimitive → prune → meshopt(high) 压缩写出。
// 严禁使用无属性保护的 simplifySloppy：会把 UV 跨岛三角形塌缩成裂纹（贴图黑锯齿）。
// 减面后做 UV 撕裂硬校验：任一三角形任一条边 UV 距离 > 0.25 的数量必须为 0。
//
// 骨骼动画模型路径：
//   1. 按模型配置保留动画，其余动画连同 channels / samplers 一并 dispose，再 prune() 清残留 accessor；
//   2. 按 clip / 节点 / 轴配置去除水平 Root Motion，依据父节点坐标系保留真实高度起伏；
//      Hip：锁 Y、X 去漂移、保留 Z；背人父亲 Root：锁 X、Z 去漂移、保留 Y；
//   3. 减面只替换索引缓冲，JOINTS_0 / WEIGHTS_0 与 Skin 原样保留，compactPrimitive 完整重映射。
//
// 多 primitive 共享顶点缓冲（linxia 双脚修复版）：
//   单个 mesh 含 2 个 primitive（主体 999,580 面 + 鞋内衬 152 面），共享同一套 537,566 顶点 accessor。
//   - 面数 <= targetTris 的小补丁 primitive 跳过 simplifyWithAttributes，保留修复网格原始拓扑；
//   - compactPrimitive 会为当前 primitive 生成独立属性副本并解除共享，另一个 primitive 的原缓冲不受影响；
//   - 压缩后复查：任意两个 primitive 不得再共享 accessor，避免 53 万冗余顶点或索引越界。
//
// art/raw/ 原文件只读，绝不修改。只处理指定模型：
// node tools/compressModels.mjs --models fatherCarry,studentFemale,studentMale
// 不带参数保持全量处理行为；UV / 体积 / 动画校验在写入任何产物前完成。

import { statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, meshopt, prune, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { countTris, countUvTears } from './uvCheck.mjs';

// 默认 12 位指数滤波会改变步态高度超过 0.1mm，平移轨道保留 20 位精度。
const assetEncoder = {
  ...MeshoptEncoder,
  encodeFilterExp(source, count, stride, bits) {
    return MeshoptEncoder.encodeFilterExp(source, count, stride, Math.max(bits, 20));
  },
};
const IO = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': assetEncoder, 'meshopt.decoder': MeshoptDecoder });

/** 减面目标（面数）：优先 33K；UV 异常模型允许 35K–45K */
const TARGET_TRIS = 33000;
/** 单步减面的几何误差上限（Permissive 允许为达目标轻微放宽） */
const TARGET_ERROR = 0.05;
/** 属性权重：[nx, ny, nz, u, v] —— UV 高权重杜绝跨岛塌陷 */
const ATTR_WEIGHTS = [0.05, 0.05, 0.05, 25, 25];

/** 可动林夏保留的剧情动画（其余舞蹈 / 欢呼 / 摔倒等全部剔除） */
const LINXIA_KEEP_ANIMATIONS = ['walk', 'afraid', 'agree', 'greet_04', 'wave_goodbye_02'];

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 2 * 1024 * 1024;

// 平移轨道使用父节点坐标系，而不是目标骨骼自身旋转后的轴。
// Hip 的父节点 Root 把本地 (X,Y,Z) 映射为世界 (-Z,-X,+Y)。
const hipMotion = (clip) => ({ clip, node: 'Hip', lockAxis: 1, driftAxes: [0], preserveAxis: 2 });
const HIP_WALK_MOTION = hipMotion('walk');
const CARRY_CLIPS = ['CarryBags_Walk_Loop', 'CarryBags_Dismount', 'CarryBags_SetDown'];

export const MODELS = [
  {
    id: 'linxia',
    raw: 'art/raw/女主-可动-双脚修复.glb',
    out: 'public/models/chr_linxia.glb',
    name: '林夏',
    animated: true,
    keepAnimations: LINXIA_KEEP_ANIMATIONS,
    rootMotion: [HIP_WALK_MOTION],
  },
  { id: 'father', raw: 'art/raw/爸爸3d模型.glb', out: 'public/models/chr_father.glb', name: '爸爸' },
  { id: 'ayuan', raw: 'art/raw/男同学1.glb', out: 'public/models/chr_ayuan.glb', name: '阿远' },
  {
    id: 'volunteer',
    raw: 'art/raw/老师3d可动.glb',
    out: 'public/models/chr_volunteer.glb',
    name: '女老师（迎新登记）',
    animated: true,
    keepAnimations: ['wave_goodbye_02', 'wait', 'agree', 'bow'],
    rootMotion: [hipMotion('wave_goodbye_02')],
    textureSize: 768,
  },
  { id: 'protagonist', raw: 'art/raw/男主3d建模.glb', out: 'public/models/chr_protagonist.glb', name: '主角' },
  {
    id: 'fatherCarry',
    raw: 'art/raw/父女-背行提袋-下背放袋.glb',
    out: 'public/models/chr_father_carry.glb',
    name: '父女（背行提袋+下背放袋）',
    animated: true,
    keepAnimations: CARRY_CLIPS,
    // 三个拆分动作（背行循环 / 下背 / 放袋）均已原地化，无需二次去漂移
    rootMotion: [],
    targetTris: 24000,
    textureSize: 768,
    expectedSkins: 2,
    allowUnskinnedMeshes: true,
    prefixArmatureNodes: true,
  },
  {
    id: 'studentFemale',
    raw: 'art/raw/女同学2可动.glb',
    out: 'public/models/chr_student_female.glb',
    name: '女同学',
    animated: true,
    keepAnimations: ['walk', 'idle', 'wait', 'greet_04', 'agree', 'make_a_call_01'],
    rootMotion: [HIP_WALK_MOTION, hipMotion('greet_04')],
    textureSize: 768,
  },
  {
    id: 'studentMale',
    raw: 'art/raw/胖男同学可动.glb',
    out: 'public/models/chr_student_male.glb',
    name: '男同学',
    animated: true,
    keepAnimations: ['walk', 'fold_arms', 'make_a_call_02', 'greet_04', 'agree', 'complain_01'],
    rootMotion: [HIP_WALK_MOTION, hipMotion('greet_04')],
    textureSize: 768,
  },
  {
    id: 'studentMale2',
    raw: 'art/raw/男同学2-键盘侠3d可动.glb',
    out: 'public/models/chr_student_male2.glb',
    name: '男同学（发帖起哄）',
    animated: true,
    keepAnimations: ['walk', 'wait', 'make_a_call_01', 'laugh_02', 'angry_01', 'swagger'],
    rootMotion: [HIP_WALK_MOTION, hipMotion('swagger')],
    targetTris: 26000,
    textureSize: 768,
  },
  {
    id: 'studentMale3',
    raw: 'art/raw/男同学3可动.glb',
    out: 'public/models/chr_student_male3.glb',
    name: '男同学（围观看热闹）',
    animated: true,
    keepAnimations: ['walk', 'wait', 'make_a_call_02', 'cheer', 'greet_01', 'bow'],
    rootMotion: [HIP_WALK_MOTION, hipMotion('greet_01')],
    targetTris: 26000,
    textureSize: 768,
  },
  {
    id: 'studentMale4',
    raw: 'art/raw/男同学4可动.glb',
    out: 'public/models/chr_student_male4.glb',
    name: '男同学（理性同学）',
    animated: true,
    keepAnimations: ['walk', 'agree', 'look_around', 'make_a_call_02', 'greet_01', 'wave_goodbye_02'],
    rootMotion: [HIP_WALK_MOTION, hipMotion('greet_01'), hipMotion('wave_goodbye_02')],
    targetTris: 26000,
    textureSize: 768,
  },
  {
    id: 'studentFemale3',
    raw: 'art/raw/女同学3-网上阴阳怪气讽刺的3d-可动-后脑勺修复.glb',
    out: 'public/models/chr_student_female3.glb',
    name: '女同学（冷嘲热讽）',
    animated: true,
    keepAnimations: ['walk', 'agree', 'laugh_01', 'make_a_call_01', 'swagger', 'afraid'],
    rootMotion: [HIP_WALK_MOTION, hipMotion('swagger')],
    targetTris: 26000,
    textureSize: 768,
  },
  {
    id: 'studentFemale4',
    raw: 'art/raw/女同学4 可动.glb',
    out: 'public/models/chr_student_female4.glb',
    name: '女同学（沉默旁观）',
    animated: true,
    keepAnimations: ['walk', 'fold_arms', 'look_around', 'afraid', 'sit', 'make_a_call_02'],
    rootMotion: [HIP_WALK_MOTION],
    targetTris: 26000,
    textureSize: 768,
  },
  {
    id: 'studentFemale1',
    raw: 'art/raw/女同学1-备用角色3d可动.glb',
    out: 'public/models/chr_student_female1.glb',
    name: '女同学（备用角色1）',
    animated: true,
    keepAnimations: ['walk', 'standing_relax', 'laugh_02', 'frustrated_01', 'swagger', 'sit', 'bow'],
    rootMotion: [HIP_WALK_MOTION, hipMotion('swagger')],
    targetTris: 26000,
    textureSize: 768,
  },
  {
    id: 'studentFemale2',
    raw: 'art/raw/女同学2-备用3d可动.glb',
    out: 'public/models/chr_student_female2.glb',
    name: '女同学（备用角色2）',
    animated: true,
    keepAnimations: ['walk', 'fold_arms', 'wave_goodbye_02', 'greet_04', 'cheer'],
    rootMotion: [HIP_WALK_MOTION, hipMotion('greet_04')],
    targetTris: 26000,
    textureSize: 768,
  },
  {
    id: 'canteenAuntie',
    raw: 'art/raw/食堂大妈3d可动.glb',
    out: 'public/models/chr_canteen_auntie.glb',
    name: '女员工（食堂大妈）',
    animated: true,
    keepAnimations: ['walk', 'wait', 'standing_relax', 'agree', 'greet_01', 'wave_goodbye_02'],
    rootMotion: [HIP_WALK_MOTION, hipMotion('greet_01')],
    targetTris: 26000,
    textureSize: 768,
  },
  {
    id: 'studentMale5',
    raw: 'art/raw/男同学5-备用角色可动3d.glb',
    out: 'public/models/chr_student_male5.glb',
    name: '男同学（备用角色5）',
    animated: true,
    keepAnimations: ['walk', 'standing_relax', 'sit', 'cheer', 'angry_01', 'swagger', 'bow'],
    rootMotion: [HIP_WALK_MOTION, hipMotion('swagger')],
    targetTris: 26000,
    textureSize: 768,
  },
  {
    id: 'securityGuard',
    raw: 'art/raw/3d可动保安大爷.glb',
    out: 'public/models/chr_security_guard.glb',
    name: '男员工（保安大爷）',
    animated: true,
    keepAnimations: ['walk', 'wave_goodbye_02', 'bow', 'laugh_01'],
    rootMotion: [HIP_WALK_MOTION],
    targetTris: 26000,
    textureSize: 768,
  },
];

/** 显式选模，未知 / 重复 / 空参数必须在读取及写出资源前失败。 */
export function selectModels(args) {
  if (args.length === 0) return MODELS;
  if (args.length !== 2 || args[0] !== '--models') {
    throw new Error('用法：node tools/compressModels.mjs --models fatherCarry,studentFemale,studentMale');
  }
  const ids = args[1].split(',');
  if (new Set(ids).size !== ids.length) throw new Error('模型 id 不可重复');
  return ids.map((id) => {
    const model = MODELS.find((item) => item.id === id);
    if (!model) throw new Error(`未知模型 id：${id || '(空)'}`);
    return model;
  });
}

/** 读取 accessor 为 Float32Array（FLOAT 直接取，其余类型逐个 getElement 解码归一化） */
function readFloatAttribute(accessor, components) {
  const array = accessor.getArray();
  if (accessor.getType() === 'VEC3' || accessor.getType() === 'VEC2') {
    if (array instanceof Float32Array && accessor.getComponentType() === 5126) return array;
  }
  const count = accessor.getCount();
  const result = new Float32Array(count * components);
  const temp = new Array(components).fill(0);
  for (let i = 0; i < count; i += 1) {
    accessor.getElement(i, temp);
    for (let c = 0; c < components; c += 1) result[i * components + c] = temp[c];
  }
  return result;
}

function fileSizeMb(path) {
  return statSync(path).size / (1024 * 1024);
}

/**
 * 仅保留指定动画：删除的动画先 dispose channel，再 dispose 采样器（无其他父级引用时），
 * 最后 dispose 动画本体；随后 prune() 会清掉没有任何引用的 accessor。
 */
function pruneAnimations(doc, keepNames) {
  const keep = new Set(keepNames);
  const removed = [];
  for (const animation of [...doc.getRoot().listAnimations()]) {
    if (keep.has(animation.getName())) continue;
    removed.push(animation.getName());

    const samplers = new Set();
    for (const channel of [...animation.listChannels()]) {
      const sampler = channel.getSampler();
      if (sampler) samplers.add(sampler);
      channel.dispose();
    }
    for (const sampler of samplers) {
      if (sampler.listParents().length === 0) sampler.dispose();
    }
    animation.dispose();
  }
  return removed;
}

function motionTrack(doc, config) {
  const animation = doc.getRoot().listAnimations().find((item) => item.getName() === config.clip);
  if (!animation) throw new Error(`缺少 ${config.clip} 动画，无法执行原地化`);
  const channels = animation.listChannels().filter((item) =>
    item.getTargetPath() === 'translation' && item.getTargetNode()?.getName() === config.node);
  if (channels.length !== 1) throw new Error(`${config.clip} 必须有唯一 ${config.node} translation 轨道`);
  return { animation, channel: channels[0] };
}

/** 轴配置必须覆盖 XYZ，且只修改水平轴；防止把目标节点自身旋转误用于 translation。 */
function verifyMotionAxes(channel, config) {
  const axes = [config.lockAxis, ...config.driftAxes, config.preserveAxis];
  if (axes.length !== 3 || [...axes].sort().join(',') !== '0,1,2') throw new Error('根运动轴配置必须覆盖 XYZ 且不重复');
  const parent = channel.getTargetNode().getParentNode();
  const matrix = parent?.getWorldMatrix() ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const axis of axes) {
    const length = Math.hypot(matrix[axis * 4], matrix[axis * 4 + 1], matrix[axis * 4 + 2]);
    const vertical = Math.abs(matrix[axis * 4 + 1]) / length;
    if (!Number.isFinite(vertical) || (axis === config.preserveAxis ? vertical < 0.9999 : vertical > 1e-4)) {
      throw new Error(`${config.clip}/${config.node} 轴 ${axis} 与父节点水平/竖直坐标不符`);
    }
  }
}

/** 使用真实时间比例去除首尾水平漂移，保留其他姿态轨道及高度的每个采样值。 */
export function stripRootMotion(doc, configs) {
  return configs.map((config) => {
    const { animation, channel } = motionTrack(doc, config);
    verifyMotionAxes(channel, config);
    const sampler = channel.getSampler();
    if (sampler.getInterpolation() !== 'LINEAR') throw new Error(`${config.clip} 根运动仅支持 LINEAR 采样`);
    const input = sampler.getInput();
    const output = sampler.getOutput();
    const times = readFloatAttribute(input, 1);
    const frames = input.getCount();
    if (frames < 2 || output.getType() !== 'VEC3' || output.getCount() !== frames || times[frames - 1] <= times[0]) {
      throw new Error(`${config.clip} 根骨骼轨道帧数或时长无效`);
    }
    const values = Float32Array.from(readFloatAttribute(output, 3));
    const first = Array.from(values.slice(0, 3));
    const drift = first.map((value, axis) => values[(frames - 1) * 3 + axis] - value);
    for (let i = 0; i < frames; i += 1) {
      const t = (times[i] - times[0]) / (times[frames - 1] - times[0]);
      values[i * 3 + config.lockAxis] = first[config.lockAxis];
      for (const axis of config.driftAxes) values[i * 3 + axis] -= drift[axis] * t;
    }
    // 采样器 / accessor 可能由其他轨道复用，只替换本轨道。
    const replacement = sampler.clone().setOutput(output.clone().setArray(values));
    animation.addSampler(replacement);
    channel.setSampler(replacement);
    if (!animation.listChannels().some((item) => item.getSampler() === sampler)) animation.removeSampler(sampler);
    return { ...config, frames, drift };
  });
}

/**
 * 对单个模型执行属性保护减面（返回各 primitive 实际误差）。
 * 多 primitive 共享顶点缓冲时，小面数补丁（<= targetTris）跳过减面、
 * 仅做 compactPrimitive：它会为当前 primitive 生成独立副本并解除共享，
 * 不改变另一个 primitive 的索引与缓冲。
 */
function simplifyModel(doc, targetTris) {
  const errors = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      const indicesAccessor = prim.getIndices();
      if (!position || !indicesAccessor) continue;

      const primTris = indicesAccessor.getCount() / 3;
      if (primTris <= targetTris) {
        compactPrimitive(prim);
        errors.push(0);
        continue;
      }

      const positions = readFloatAttribute(position, 3);
      const srcIndices = indicesAccessor.getArray();
      const indices =
        srcIndices instanceof Uint32Array ? srcIndices : new Uint32Array(srcIndices);
      const vertexCount = positions.length / 3;

      // 组装 5 维属性 [nx, ny, nz, u, v]；无 UV 的 primitive 退化为 3 维法线保护
      const normal = prim.getAttribute('NORMAL');
      const uv = prim.getAttribute('TEXCOORD_0');
      const attributeCount = uv ? 5 : 3;
      const weights = uv ? ATTR_WEIGHTS : ATTR_WEIGHTS.slice(0, 3);
      const attributes = new Float32Array(vertexCount * attributeCount);

      if (normal) {
        const normals = readFloatAttribute(normal, 3);
        for (let i = 0; i < vertexCount; i += 1) {
          attributes[i * attributeCount] = normals[i * 3];
          attributes[i * attributeCount + 1] = normals[i * 3 + 1];
          attributes[i * attributeCount + 2] = normals[i * 3 + 2];
        }
      }
      if (uv) {
        const uvs = readFloatAttribute(uv, 2);
        for (let i = 0; i < vertexCount; i += 1) {
          attributes[i * attributeCount + 3] = uvs[i * 2];
          attributes[i * attributeCount + 4] = uvs[i * 2 + 1];
        }
      }

      const targetIndices = Math.min(targetTris * 3, indices.length);
      const [resultIndices, resultError] = MeshoptSimplifier.simplifyWithAttributes(
        indices,
        positions,
        3,
        attributes,
        attributeCount,
        weights,
        null,
        targetIndices,
        TARGET_ERROR,
        ['Permissive'],
      );
      errors.push(resultError);

      prim.setIndices(doc.createAccessor().setArray(resultIndices));
      if (indicesAccessor.listParents().length === 0) indicesAccessor.dispose();
      compactPrimitive(prim);
    }
  }
  return errors;
}

/** 统计同一 mesh 内仍被多个 primitive 同时引用的 accessor（含索引）：压缩后必须为空 */
function findSharedPrimitiveAccessors(doc) {
  const shared = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    const usage = new Map();
    for (const prim of mesh.listPrimitives()) {
      const accessors = [prim.getIndices()];
      for (const semantic of prim.listSemantics()) accessors.push(prim.getAttribute(semantic));
      for (const accessor of accessors) {
        if (!accessor) continue;
        usage.set(accessor, (usage.get(accessor) ?? 0) + 1);
      }
    }
    for (const entry of usage.entries()) {
      if (entry[1] > 1) shared.push(entry);
    }
  }
  return shared;
}

/** 为多骨架模型（如 Father_Armature + Linxia_Armature）消歧同名骨骼节点，防止 Three.js AnimationMixer 绑定串轨 */
function disambiguateArmatureNodes(doc) {
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) return 0;
  let renamed = 0;
  const walk = (node, prefix) => {
    const current = node.getName();
    if (current && !current.startsWith(prefix)) {
      node.setName(`${prefix}${current}`);
      renamed += 1;
    }
    for (const child of node.listChildren()) walk(child, prefix);
  };
  for (const top of scene.listChildren()) {
    const name = top.getName();
    if (!name.endsWith('_Armature')) continue;
    const prefix = `${name.replace(/_Armature$/, '')}_`;
    for (const child of top.listChildren()) walk(child, prefix);
  }
  return renamed;
}

/** 骨骼蒙皮检查：蒙皮节点对应 mesh 必须有 JOINTS_0 / WEIGHTS_0，文档含预期数量 Skin，且无共享顶点缓冲残留 */
function inspectSkin(doc, options = {}) {
  const expectedSkins = options.expectedSkins ?? 1;
  const allowUnskinnedMeshes = options.allowUnskinnedMeshes ?? false;
  const skinnedMeshes = new Set(
    doc.getRoot().listNodes().filter((node) => node.getMesh() && node.getSkin()).map((node) => node.getMesh()),
  );
  const primitives = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    const mustBeSkinned = !allowUnskinnedMeshes || skinnedMeshes.has(mesh);
    for (const prim of mesh.listPrimitives()) {
      const hasJoints = Boolean(prim.getAttribute('JOINTS_0'));
      const hasWeights = Boolean(prim.getAttribute('WEIGHTS_0'));
      if (mustBeSkinned && (!hasJoints || !hasWeights)) {
        throw new Error(`减面后蒙皮属性丢失：${mesh.getName()} 缺少 JOINTS_0 / WEIGHTS_0`);
      }
      primitives.push({
        material: prim.getMaterial()?.getName() ?? '(无材质)',
        tris: Math.round((prim.getIndices()?.getCount() ?? 0) / 3),
        verts: prim.getAttribute('POSITION')?.getCount() ?? 0,
      });
    }
  }
  const shared = findSharedPrimitiveAccessors(doc);
  if (shared.length > 0) {
    throw new Error(`压缩后仍有 ${shared.length} 个 accessor 被多个 primitive 共享，顶点缓冲未拆分`);
  }
  const skins = doc.getRoot().listSkins();
  if (skins.length !== expectedSkins) {
    throw new Error(`Skin 数量不符：期望 ${expectedSkins}，实际 ${skins.length}`);
  }
  for (const skin of skins) {
    if (skin.listJoints().length !== 41) {
      throw new Error(`Skin 骨骼数不符：期望 41，实际 ${skin.listJoints().length}`);
    }
  }
  return {
    skinnedPrimitives: primitives.length,
    skins: skins.length,
    joints: skins[0].listJoints().length,
    primitives,
    sharedAccessors: shared.length,
  };
}

/** 序列化后读回动画：逐模型配置校验，而不是假定所有模型都是 walk/Hip。 */
function verifyAnimatedOutput(doc, model, snapshots) {
  const names = doc.getRoot().listAnimations().map((animation) => animation.getName()).sort();
  const expected = [...model.keepAnimations].sort();
  if (names.join(',') !== expected.join(',')) {
    throw new Error(`动画名单不符：期望 [${expected.join(', ')}]，实际 [${names.join(', ')}]`);
  }
  const motion = model.rootMotion.map((config, index) => {
    const { channel } = motionTrack(doc, config);
    verifyMotionAxes(channel, config);
    const values = readFloatAttribute(channel.getSampler().getOutput(), 3);
    const before = snapshots[index];
    if (values.length !== before.length) throw new Error(`${config.clip} 根运动采样数量改变`);
    const frames = values.length / 3;
    const ranges = [0, 1, 2].map((axis) => {
      const samples = Array.from({ length: frames }, (_, i) => values[i * 3 + axis]);
      return Math.max(...samples) - Math.min(...samples);
    });
    if (ranges[config.lockAxis] > 1e-4) throw new Error(`${config.clip}/${config.node} 前进轴未锁定`);
    for (const axis of config.driftAxes) {
      if (Math.abs(values[(frames - 1) * 3 + axis] - values[axis]) > 1e-4) {
        throw new Error(`${config.clip}/${config.node} 轴 ${axis} 仍有水平漂移`);
      }
    }
    for (let i = 0; i < frames; i += 1) {
      const offset = i * 3 + config.preserveAxis;
      if (Math.abs(values[offset] - before[offset]) > 1e-4) throw new Error(`${config.clip} 竖向起伏改变：帧 ${i} ${before[offset]} → ${values[offset]}`);
    }
    return { clip: config.clip, node: config.node, frames, ranges };
  });
  const skin = inspectSkin(doc, {
    expectedSkins: model.expectedSkins ?? 1,
    allowUnskinnedMeshes: model.allowUnskinnedMeshes ?? false,
  });
  return { animations: names, motion, skin };
}

/** 硬 UV 校验针对最终 meshopt GLB 的解码结果，失败时绝不写出文件。 */
export function assertOutputUv(doc, label) {
  const uv = countUvTears(doc);
  if (uv.overHard !== 0) throw new Error(`${label} UV 硬阈值失败：${uv.overHard} 面 > 0.25，拒绝写出`);
  return uv;
}

async function compressModel(model) {
  const rawPath = resolve(PROJECT_ROOT, model.raw);
  const outPath = resolve(PROJECT_ROOT, model.out);
  const rawDoc = await IO.read(rawPath);
  const rawTris = countTris(rawDoc);
  const rawUv = countUvTears(rawDoc);
  console.log(`[原始] ${model.id}：${rawTris} 面 / ${fileSizeMb(rawPath).toFixed(3)} MiB / UV 硬 ${rawUv.overHard}、软 ${rawUv.overSoft}`);

  const snapshots = [];
  if (model.animated) {
    const removed = pruneAnimations(rawDoc, model.keepAnimations);
    const stripped = stripRootMotion(rawDoc, model.rootMotion);
    for (const config of model.rootMotion) {
      snapshots.push(Float32Array.from(motionTrack(rawDoc, config).channel.getSampler().getOutput().getArray()));
    }
    console.log(`  [动画] 保留 [${model.keepAnimations.join(', ')}]；删除 ${removed.length} 个剪辑`);
    for (const report of stripped) console.log(`  [原地化] ${JSON.stringify(report)}`);
  }
  if (model.prefixArmatureNodes) {
    const renamed = disambiguateArmatureNodes(rawDoc);
    console.log(`  [骨架消歧] 已为双骨架子节点加前缀：${renamed} 个节点`);
  }

  const errors = simplifyModel(rawDoc, model.targetTris ?? TARGET_TRIS);
  for (const mesh of rawDoc.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMaterial()?.getName() !== 'Shoe inner leather') continue;
      // 平面鞋内衬使用连续投影，避免补丁原有随机 UV 跨越整张皮革贴图。
      const position = primitive.getAttribute('POSITION');
      const bounds = [0, 1, 2].map((axis) => {
        const values = readFloatAttribute(position, 3);
        const samples = Array.from({ length: position.getCount() }, (_, i) => values[i * 3 + axis]);
        return { axis, min: Math.min(...samples), span: Math.max(...samples) - Math.min(...samples) };
      }).sort((a, b) => b.span - a.span);
      const positions = readFloatAttribute(position, 3);
      const uv = new Float32Array(position.getCount() * 2);
      for (let i = 0; i < position.getCount(); i += 1) {
        for (let axis = 0; axis < 2; axis += 1) {
          uv[i * 2 + axis] = 0.4 + (positions[i * 3 + bounds[axis].axis] - bounds[axis].min) * 0.5;
        }
      }
      primitive.setAttribute('TEXCOORD_0', rawDoc.createAccessor().setType('VEC2').setArray(uv));
    }
  }
  // 沿用可动模型的贴图管线，不改变材质或蒙皮语义。
  if (model.animated) {
    const { default: sharp } = await import('sharp');
    await rawDoc.transform(textureCompress({ encoder: sharp, quality: 84,
      ...(model.textureSize ? { resize: [model.textureSize, model.textureSize] } : {}),
    }));
  }
  await rawDoc.transform(prune());
  await rawDoc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));

  // 在内存中生成并解码实际 GLB，所有硬门禁通过后才写入 public/models。
  const binary = await IO.writeBinary(rawDoc);
  const outDoc = await IO.readBinary(binary);
  const outUv = assertOutputUv(outDoc, model.id);
  if (binary.byteLength > MAX_BYTES) throw new Error(`${model.id} ${(binary.byteLength / 1024 ** 2).toFixed(3)} MiB 超过 2 MiB，拒绝写出`);
  const report = model.animated ? verifyAnimatedOutput(outDoc, model, snapshots) : null;
  await writeFile(outPath, binary);
  console.log(`[产物] ${outPath}：${countTris(outDoc)} 面 / ${binary.byteLength} 字节 / ${(binary.byteLength / 1024 ** 2).toFixed(3)} MiB / UV 硬 ${outUv.overHard}、软 ${outUv.overSoft} / 误差 ${Math.max(0, ...errors).toFixed(4)}`);
  if (report) console.log(`  [校验] ${JSON.stringify(report)}`);
}

async function main() {
  const models = selectModels(process.argv.slice(2));
  await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready, MeshoptDecoder.ready]);
  for (const model of models) {
    try {
      await compressModel(model);
    } catch (error) {
      // 单模型阻断不能阻止其他独立资源得到处理，也不得留下不合格的新产物。
      console.error(`[阻断] ${model.id}：${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

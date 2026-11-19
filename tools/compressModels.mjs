// tools/compressModels.mjs —— 把 art/raw/ 原始 Tripo 模型压缩为游戏用轻量 GLB 到 public/models/
// 画质优先 + 零 UV 撕裂流程（修复版）：
//   simplifyWithAttributes 一步减面：5 维属性 [nx, ny, nz, u, v] 保护法线与 UV，
//   属性权重 [0.05, 0.05, 0.05, 25, 25]（UV 极高权重防跨岛塌陷），flags ['Permissive']，
//   目标 33,000 面、target_error 0.05；单模型异常时允许上调至 3.5–4.5 万面。
//   之后 compactPrimitive → prune → meshopt(high) 压缩写出。
// 严禁使用无属性保护的 simplifySloppy：会把 UV 跨岛三角形塌缩成裂纹（贴图黑锯齿）。
// 减面后做 UV 撕裂硬校验：任一三角形任一条边 UV 距离 > 0.25 的数量必须为 0。
//
// 骨骼动画模型（linxia）专用路径：
//   1. 仅保留剧情相关动画，其余动画连同 channels / samplers 一并 dispose，再 prune() 清残留 accessor；
//   2. walk 去除 Root Motion 转原地循环：锁定 Hip 局部 Y 为首帧值（消除 ~1.5m 前进位移），
//      减去 X 轴线性漂移，保留 Z 轴步态微起伏；
//   3. 减面只替换索引缓冲，JOINTS_0 / WEIGHTS_0 与 Skin 原样保留，compactPrimitive 完整重映射。
//
// 多 primitive 共享顶点缓冲（linxia 双脚修复版）：
//   单个 mesh 含 2 个 primitive（主体 999,580 面 + 鞋内衬 152 面），共享同一套 537,566 顶点 accessor。
//   - 面数 <= targetTris 的小补丁 primitive 跳过 simplifyWithAttributes，保留修复网格原始拓扑；
//   - compactPrimitive 会为当前 primitive 生成独立属性副本并解除共享，另一个 primitive 的原缓冲不受影响；
//   - 压缩后复查：任意两个 primitive 不得再共享 accessor，避免 53 万冗余顶点或索引越界。
//
// art/raw/ 原文件只读，绝不修改。运行：node tools/compressModels.mjs

import { statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, meshopt, prune, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { countTris, countUvTears } from './uvCheck.mjs';

const IO = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

/** 减面目标（面数）：优先 33K；UV 异常模型允许 35K–45K */
const TARGET_TRIS = 33000;
/** 单步减面的几何误差上限（Permissive 允许为达目标轻微放宽） */
const TARGET_ERROR = 0.05;
/** 属性权重：[nx, ny, nz, u, v] —— UV 高权重杜绝跨岛塌陷 */
const ATTR_WEIGHTS = [0.05, 0.05, 0.05, 25, 25];

/** 可动林夏保留的剧情动画（其余舞蹈 / 欢呼 / 摔倒等全部剔除） */
const LINXIA_KEEP_ANIMATIONS = ['walk', 'afraid', 'agree', 'greet_04', 'wave_goodbye_02'];

/** walk 原地化的根骨骼节点名（Tripo 绑骨版为 Hip；同时兼容 Pelvis 命名） */
const ROOT_MOTION_NODE_NAMES = ['Hip', 'Pelvis'];

const MODELS = [
  {
    raw: 'art/raw/女主-可动-双脚修复.glb',
    out: 'public/models/chr_linxia.glb',
    name: '林夏',
    animated: true,
    keepAnimations: LINXIA_KEEP_ANIMATIONS,
  },
  { raw: 'art/raw/爸爸3d模型.glb', out: 'public/models/chr_father.glb', name: '爸爸' },
  { raw: 'art/raw/男同学1.glb', out: 'public/models/chr_ayuan.glb', name: '阿远' },
  { raw: 'art/raw/女同学1.glb', out: 'public/models/chr_volunteer.glb', name: '志愿者' },
  { raw: 'art/raw/男主3d建模.glb', out: 'public/models/chr_protagonist.glb', name: '主角' },
];

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

/**
 * walk 原地循环：Hip 局部 Y 锁定首帧值（消除 2.33s 内约 1.5m 前进），
 * X 减去首尾线性漂移、保留步态摆动，Z（垂直微起伏）不动。
 */
function stripWalkRootMotion(doc) {
  const walk = doc.getRoot().listAnimations().find((animation) => animation.getName() === 'walk');
  if (!walk) throw new Error('缺少 walk 动画，无法执行原地化');

  const channel = walk.listChannels().find((item) => {
    if (item.getTargetPath() !== 'translation') return false;
    const node = item.getTargetNode();
    return node !== null && ROOT_MOTION_NODE_NAMES.includes(node.getName());
  });
  if (!channel) throw new Error(`walk 缺少 ${ROOT_MOTION_NODE_NAMES.join('/')} 的 translation 轨道`);

  const sampler = channel.getSampler();
  const input = sampler.getInput();
  const output = sampler.getOutput();
  const frames = input.getCount();
  if (frames < 2) throw new Error('walk 根骨骼轨道帧数不足');

  const values = Float32Array.from(output.getArray());
  const x0 = values[0];
  const y0 = values[1];
  const xLast = values[(frames - 1) * 3];
  const driftX = xLast - x0;

  for (let i = 0; i < frames; i += 1) {
    const t = i / (frames - 1);
    const base = i * 3;
    values[base] -= driftX * t;
    values[base + 1] = y0;
  }
  output.setArray(values);

  const node = channel.getTargetNode();
  return { node: node ? node.getName() : '?', frames, driftX, restY: y0 };
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

/** 统计仍被多个 primitive 同时引用的 accessor（含索引）：压缩后必须为空 */
function findSharedPrimitiveAccessors(doc) {
  const usage = new Map();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const accessors = [prim.getIndices()];
      for (const semantic of prim.listSemantics()) accessors.push(prim.getAttribute(semantic));
      for (const accessor of accessors) {
        if (!accessor) continue;
        usage.set(accessor, (usage.get(accessor) ?? 0) + 1);
      }
    }
  }
  return [...usage.entries()].filter(([, count]) => count > 1);
}

/** 骨骼蒙皮检查：所有 mesh primitive 必须有 JOINTS_0 / WEIGHTS_0，文档含 Skin，且无共享顶点缓冲残留 */
function inspectSkin(doc) {
  const primitives = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const hasJoints = Boolean(prim.getAttribute('JOINTS_0'));
      const hasWeights = Boolean(prim.getAttribute('WEIGHTS_0'));
      if (!hasJoints || !hasWeights) {
        throw new Error('减面后蒙皮属性丢失：缺少 JOINTS_0 / WEIGHTS_0');
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
  if (skins.length === 0) throw new Error('减面后 Skin 丢失');
  return {
    skinnedPrimitives: primitives.length,
    skins: skins.length,
    joints: skins[0].listJoints().length,
    primitives,
    sharedAccessors: shared.length,
  };
}

/** 读回输出做动画契约校验：动画名单、walk Hip 原地化、Z 步态起伏 */
async function verifyAnimatedOutput(path, keepNames) {
  const doc = await IO.read(path);
  const root = doc.getRoot();
  const names = root.listAnimations().map((animation) => animation.getName()).sort();
  const expected = [...keepNames].sort();
  if (names.join(',') !== expected.join(',')) {
    throw new Error(`动画名单不符：期望 [${expected.join(', ')}]，实际 [${names.join(', ')}]`);
  }

  const walk = root.listAnimations().find((animation) => animation.getName() === 'walk');
  const channel = walk.listChannels().find((item) => {
    if (item.getTargetPath() !== 'translation') return false;
    const node = item.getTargetNode();
    return node !== null && ROOT_MOTION_NODE_NAMES.includes(node.getName());
  });
  if (!channel) throw new Error('输出缺少 walk 根骨骼 translation 轨道');

  const input = channel.getSampler().getInput();
  const values = channel.getSampler().getOutput().getArray();
  const frames = input.getCount();
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < frames; i += 1) {
    minY = Math.min(minY, values[i * 3 + 1]);
    maxY = Math.max(maxY, values[i * 3 + 1]);
    minZ = Math.min(minZ, values[i * 3 + 2]);
    maxZ = Math.max(maxZ, values[i * 3 + 2]);
  }
  const firstX = values[0];
  const lastX = values[(frames - 1) * 3];

  if (maxY - minY > 1e-4) throw new Error(`walk 根骨骼 Y 未锁定（波动 ${(maxY - minY).toFixed(4)}）`);
  if (Math.abs(lastX - firstX) > 1e-4) {
    throw new Error(`walk 根骨骼 X 仍存在线性漂移（${(lastX - firstX).toFixed(4)}）`);
  }
  if (maxZ - minZ < 0.005) throw new Error('walk 根骨骼 Z 步态起伏丢失');

  return {
    animations: names,
    frames,
    yRange: maxY - minY,
    xDrift: lastX - firstX,
    zRange: maxZ - minZ,
    skin: inspectSkin(doc),
  };
}

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;

console.log('模型\t原始面数\t原始MB\t压缩面数\t压缩MB\tUV>0.25\tUV>0.10\t误差');
let allClean = true;
for (const model of MODELS) {
  const rawDoc = await IO.read(model.raw);
  const rawTris = countTris(rawDoc);
  const rawMb = fileSizeMb(model.raw);
  const rawUv = countUvTears(rawDoc);

  let animationNote = '';
  if (model.animated) {
    const removed = pruneAnimations(rawDoc, model.keepAnimations);
    const strip = stripWalkRootMotion(rawDoc);
    animationNote =
      `\n  [骨骼动画] 保留 [${model.keepAnimations.join(', ')}]；删除 [${removed.join(', ')}]` +
      `；walk 根骨骼 ${strip.node} 原地化（X 漂移 ${strip.driftX.toFixed(4)}，${strip.frames} 帧）`;
  }

  const errors = simplifyModel(rawDoc, TARGET_TRIS);
  const worstError = errors.length > 0 ? Math.max(...errors) : 0;

  // 骨骼动画模型：贴图重编码为质量 84 的 JPEG，把总包体积压回 1.1–1.5MB 目标区间
  if (model.animated) {
    const { default: sharp } = await import('sharp');
    await rawDoc.transform(textureCompress({ encoder: sharp, quality: 84 }));
  }

  await rawDoc.transform(prune());
  await rawDoc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await IO.write(model.out, rawDoc);

  const outDoc = await IO.read(model.out);
  const outTris = countTris(outDoc);
  const outMb = fileSizeMb(model.out);
  const outUv = countUvTears(outDoc);
  const clean = outUv.overHard === 0;
  if (!clean) allClean = false;

  console.log(
    `${model.name}\t${rawTris.toLocaleString('zh-CN')}\t${rawMb.toFixed(1)}\t${outTris.toLocaleString('zh-CN')}\t${outMb.toFixed(2)}\t${outUv.overHard}\t${outUv.overSoft}\t${worstError.toFixed(4)}` +
      (rawUv.overHard > 0 ? `\t[原始模型已有硬撕裂 ${rawUv.overHard}]` : '') +
      animationNote,
  );

  if (model.animated) {
    const report = await verifyAnimatedOutput(model.out, model.keepAnimations);
    console.log(
      `  [校验] 动画 [${report.animations.join(', ')}]；walk ${report.frames} 帧，` +
        `Hip Y 波动 ${report.yRange.toFixed(6)}，X 漂移 ${report.xDrift.toFixed(6)}，` +
        `Z 起伏 ${report.zRange.toFixed(4)}；Skin ${report.skin.skins} 个 / ` +
        `${report.skin.joints} 骨骼，蒙皮 primitive ${report.skin.skinnedPrimitives} 个，` +
        `共享 accessor ${report.skin.sharedAccessors} 个`,
    );
    for (const prim of report.skin.primitives) {
      console.log(`  [primitive] ${prim.material}：${prim.tris.toLocaleString('zh-CN')} 面 / ${prim.verts.toLocaleString('zh-CN')} 顶点`);
    }
  }
}

if (!allClean) {
  console.error('存在 UV 硬撕裂（> 0.25）！请上调该模型目标面数或 UV 权重后重新压缩。');
  process.exitCode = 1;
} else {
  console.log('全部模型 UV 硬撕裂校验通过（> 0.25 数量为 0）。');
}

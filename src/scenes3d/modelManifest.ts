// scenes3d/modelManifest.ts —— 角色模型清单：相对路径、显示名、标准化目标身高、正脸朝向
// 纯数据配置，不含业务逻辑；路径必须以 ./models/ 开头（vite base './'，禁止写死根路径）。
// 原始 Tripo 模型高约 0.98m，运行时由 resources.normalizeModelToHeight 等比缩放到真实身高。
//
// 正脸朝向约定（frontYawRad）：
// 绕 Y 轴旋转该弧度后，模型正面朝向 +Z（glTF 常用朝向）。2026-11-19 经四方位角
// 截图 + 头部区域像素采样实测：5 个模型原生正面全部朝向 +X（相机从 +X 方向观察可见正脸），
// 方向完全一致，故统一为 -Math.PI / 2。
// 推导：three.js 右手系绕 Y 轴旋转 θ 的矩阵将局部 +X 映射到 (cosθ, 0, -sinθ)；
// 要求 (1,0,0) → (0,0,1)，需 cosθ = 0 且 -sinθ = 1，即 θ = -π/2。
// （+π/2 会把 +X 转到 -Z，导致检视台初始机位拍到背影——Step 9 已修正。）
// 场景摆放约定：先 rotation.y = frontYawRad 归正（正面朝 +Z），再叠加所需朝向角：
// yaw=0 → 面向 +Z，yaw=π → 面向 -Z，yaw=π/2 → 面向 +X。

export type CharacterModelId = 'linxia' | 'father' | 'ayuan' | 'volunteer' | 'protagonist' | 'fatherCarry' | 'studentFemale' | 'studentMale';

export interface CharacterModelEntry {
  id: CharacterModelId;
  /** 显示名（模型预览台 / 调试面板用） */
  name: string;
  /** 相对模型路径，部署到任意子路径均可加载 */
  path: string;
  /** 标准化目标身高（米） */
  heightM: number;
  /** 绕 Y 轴旋转该弧度后，模型正面朝向 +Z（见文件头朝向约定） */
  frontYawRad: number;
}

export const CHARACTER_MODELS: readonly CharacterModelEntry[] = [
  { id: 'linxia', name: '林夏', path: './models/chr_linxia.glb', heightM: 1.62, frontYawRad: -Math.PI / 2 },
  { id: 'father', name: '爸爸', path: './models/chr_father.glb', heightM: 1.78, frontYawRad: -Math.PI / 2 },
  { id: 'ayuan', name: '阿远', path: './models/chr_ayuan.glb', heightM: 1.68, frontYawRad: -Math.PI / 2 },
  { id: 'volunteer', name: '志愿者', path: './models/chr_volunteer.glb', heightM: 1.66, frontYawRad: -Math.PI / 2 },
  { id: 'protagonist', name: '主角', path: './models/chr_protagonist.glb', heightM: 1.74, frontYawRad: -Math.PI / 2 },
  { id: 'fatherCarry', name: '爸爸（背人）', path: './models/chr_father_carry.glb', heightM: 1.78, frontYawRad: -Math.PI / 2 },
  { id: 'studentFemale', name: '女同学', path: './models/chr_student_female.glb', heightM: 1.65, frontYawRad: -Math.PI / 2 },
  { id: 'studentMale', name: '男同学', path: './models/chr_student_male.glb', heightM: 1.7, frontYawRad: -Math.PI / 2 },
];

export function getCharacterModel(id: CharacterModelId): CharacterModelEntry {
  const entry = CHARACTER_MODELS.find((item) => item.id === id);
  if (!entry) throw new Error(`未知角色模型：${id}`);
  return entry;
}

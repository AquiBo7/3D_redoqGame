// world/resources.ts —— GLB 角色模型懒加载器：按需加载、缓存、身高标准化、实例化与销毁安全
// 边界：只负责 3D 资源加载与标准化，不 import core 剧情状态。
// 模型 URL 一律相对路径（vite base './'），运行时解析为绝对地址，跟随任意部署子路径。
// 销毁安全：缓存模板的几何 / 材质打上 userData.sharedResource 标记，
// WorldApp.disposeObjectTree 等通用清理逻辑遇到标记一律跳过，
// 避免切场景把缓存模板的 GPU 资源销毁，导致再次进入场景模型变黑 / 报错。

import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { CharacterModelId } from '../scenes3d/modelManifest';
import { getCharacterModel } from '../scenes3d/modelManifest';

/** 缓存模板：场景母本 + 骨骼动画剪辑（无动画的模型为空数组） */
export interface CharacterModelAsset {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

/** 共享资源标记：打在缓存模板的几何 / 材质 userData 上，通用销毁逻辑必须跳过 */
export const SHARED_RESOURCE_FLAG = 'sharedResource';

/**
 * 加载器单例：GLTFLoader / MeshoptDecoder 用动态 import 懒加载，
 * 避免把解码器与加载器打进游戏首屏 chunk（房间场景完全不加载角色模型）。
 * setMeshoptDecoder 必须在加载 EXT_meshopt_compression 压缩 GLB 之前调用，故二者在同一个 Promise 里初始化。
 */
let loaderPromise: Promise<GLTFLoader> | null = null;

function getLoader(): Promise<GLTFLoader> {
  if (!loaderPromise) {
    loaderPromise = Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/libs/meshopt_decoder.module.js'),
    ]).then(([gltfModule, meshoptModule]) => {
      const loader = new gltfModule.GLTFLoader();
      loader.setMeshoptDecoder(meshoptModule.MeshoptDecoder);
      return loader;
    });
  }
  return loaderPromise;
}

/** 已标准化模板缓存：modelId → 克隆母本 + 动画剪辑（实例与母本共享几何 / 材质 / 剪辑） */
const templateCache = new Map<CharacterModelId, CharacterModelAsset>();

/** 进行中的加载：同一模型的并发请求合并为同一个 Promise */
const pendingLoads = new Map<CharacterModelId, Promise<CharacterModelAsset>>();

/** 相对模型路径（./models/xxx.glb）解析为绝对 URL：自动跟随页面部署的任意子路径 */
function resolveModelUrl(relativePath: string): string {
  return new URL(relativePath, document.baseURI).href;
}

/** 给模板全部几何 / 材质打共享标记；贴图随材质一起受保护，无需单独标记 */
function markSharedResources(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.userData[SHARED_RESOURCE_FLAG] = true;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      material.userData[SHARED_RESOURCE_FLAG] = true;
    }
  });
}

/**
 * 身高标准化：Box3 计算整体包围盒，等比缩放到目标身高（米），
 * XZ 平移到中心 0，脚底 min.y 精确贴齐 y = 0。
 * 兼容两种原始摆放：脚底在 y=0（Tripo 标准导出）与垂直居中（部分导出器）。
 */
export function normalizeModelToHeight(root: THREE.Object3D, targetHeight: number): void {
  if (targetHeight <= 0) throw new Error(`目标身高必须为正数：${targetHeight}`);

  root.updateWorldMatrix(true, true);
  const initial = new THREE.Box3().setFromObject(root);
  const currentHeight = initial.max.y - initial.min.y;
  if (currentHeight <= 0) return;

  root.scale.multiplyScalar(targetHeight / currentHeight);
  root.updateWorldMatrix(true, true);

  const scaled = new THREE.Box3().setFromObject(root);
  // 世界空间需要的平移量：XZ 居中到 0、脚底归零到 y=0
  const delta = new THREE.Vector3(
    -(scaled.min.x + scaled.max.x) / 2,
    -scaled.min.y,
    -(scaled.min.z + scaled.max.z) / 2,
  );
  // root.position 是父级局部空间：经父矩阵把目标世界位置换算回局部，抵消父级旋转 / 缩放
  if (root.parent) {
    const worldPosition = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld).add(delta);
    root.position.copy(root.parent.worldToLocal(worldPosition));
  } else {
    root.position.add(delta);
  }
  root.updateWorldMatrix(true, true);
}

/**
 * 从缓存模板克隆实例。
 * 骨骼动画模型必须走 SkeletonUtils.clone：普通 Object3D.clone(true) 只复制骨骼节点，
 * 不会重建 SkinnedMesh 的 skeleton 绑定，动画播放时会出现网格炸开 / 不跟随。
 * SkeletonUtils.clone 复制骨骼层级与 SkinnedMesh，但几何 / 材质仍按引用共享（受共享标记保护）。
 */
export function instantiateCharacterModel(id: CharacterModelId): THREE.Group {
  const asset = templateCache.get(id);
  if (!asset) throw new Error(`模型尚未加载，无法实例化：${id}`);
  const instance = cloneSkeleton(asset.scene) as THREE.Group;
  instance.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) object.frustumCulled = false;
  });
  return instance;
}

/** 查询模型自带的动画剪辑（首次调用前需已加载；无动画返回空数组，调用方可安全遍历） */
export function getCharacterAnimations(id: CharacterModelId): readonly THREE.AnimationClip[] {
  return templateCache.get(id)?.animations ?? [];
}

/** 模型下载进度（字节）：total 来自 XHR 的 Content-Length，缺失时为 0 */
export interface ModelLoadProgress {
  loaded: number;
  total: number;
}

/** 同步检查模板是否已就绪（Node 单测无 WebGL / 未预载时为 false，用于胶囊体降级） */
export function hasCharacterModel(id: CharacterModelId): boolean {
  return templateCache.has(id);
}

/**
 * 按需懒加载 + 缓存：首次调用才真正发起网络请求，游戏首屏不预载任何角色；
 * 加载器与解码器本身也随首次调用动态 import。
 */
export function loadCharacterModel(
  id: CharacterModelId,
  onProgress?: (progress: ModelLoadProgress) => void,
): Promise<CharacterModelAsset> {
  const cached = templateCache.get(id);
  if (cached) return Promise.resolve(cached);

  const pending = pendingLoads.get(id);
  if (pending) return pending;

  const entry = getCharacterModel(id);
  const loadPromise = getLoader()
    .then((loader) =>
      loader.loadAsync(resolveModelUrl(entry.path), (event: ProgressEvent) => {
        if (onProgress) onProgress({ loaded: event.loaded, total: event.total });
      }),
    )
    .then((gltf) => {
      const root = gltf.scene;
      markSharedResources(root);
      // 动画播放时骨骼会超出静态包围盒，视锥剔除会误裁 SkinnedMesh
      root.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) object.frustumCulled = false;
      });
      normalizeModelToHeight(root, entry.heightM);
      const asset: CharacterModelAsset = {
        scene: root,
        // 剪辑只读共享：AnimationMixer 不会改写剪辑数据
        animations: gltf.animations,
      };
      templateCache.set(id, asset);
      return asset;
    })
    .finally(() => {
      pendingLoads.delete(id);
    });

  pendingLoads.set(id, loadPromise);
  return loadPromise;
}

/** 预加载指定角色（供场景进场前使用；游戏首屏严禁预载全部 5 个模型） */
export function preloadCharacterModels(
  ids: readonly CharacterModelId[],
): Promise<CharacterModelAsset[]> {
  return Promise.all(ids.map((id) => loadCharacterModel(id)));
}

/** 清空模板缓存并释放 GPU 资源（退出模型预览台时调用；游戏运行期不调用） */
export function disposeCharacterModelCache(): void {
  for (const asset of templateCache.values()) {
    asset.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
  }
  templateCache.clear();
  pendingLoads.clear();
}

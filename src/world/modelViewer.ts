// world/modelViewer.ts —— ?modelViewer=1 独立模型检视台（懒加载 chunk，不影响游戏首屏）
// 与游戏主流程完全隔离：不创建剧情状态机、不挂载开始页，只复用 resources 加载器与模型清单。
// 5 位角色一律按需懒加载 + 缓存；切换角色只移除旧展示实例，绝不 dispose 共享缓存资源。
// 展示实例克隆材质（贴图共享），线框开关只影响展示实例，不污染缓存模板。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CharacterModelEntry, CharacterModelId } from '../scenes3d/modelManifest';
import { CHARACTER_MODELS, getCharacterModel } from '../scenes3d/modelManifest';
import { SHARED_RESOURCE_FLAG, instantiateCharacterModel, loadCharacterModel } from './resources';
import './modelViewer.css';

/** 手机端像素比上限（性能红线） */
const MOBILE_PIXEL_RATIO = 1.5;
/** 桌面端像素比上限 */
const DESKTOP_PIXEL_RATIO = 2;
/** 参照标尺高度（米）：人物身高对比基准 */
const RULER_HEIGHT_M = 1.7;
/** 动画剪辑中文名；未收录的直接显示原始名 */
const ANIMATION_LABELS: Record<string, string> = {
  walk: '走路',
  afraid: '拘谨',
  agree: '点头',
  greet_04: '打招呼',
  wave_goodbye_02: '挥手告别',
};
/** 动作切换交叉淡入时长（秒） */
const ANIMATION_FADE_SEC = 0.25;
/**
 * 初始机位方位角（弧度）：相机位置为 (sinφ·d, y, cosφ·d)。
 * 模型归正后正面朝 +Z，φ = −π/6 使相机位于 +Z 侧偏 −X 的前方 30°，
 * 第一眼即清晰四分之三正脸；φ=0 为完全正脸（相机在 +Z），φ=π 为背面（相机在 −Z）。
 */
const INITIAL_AZIMUTH = -Math.PI / 6;
/** 取景留白系数：模型身高 × 该系数必须完整落在顶栏与底栏之间的可视带内 */
const FRAME_PADDING = 1.12;
/** 取景时相机高度 = 模型身高 × 该系数（略高于腰线，头部留白充足） */
const CAMERA_HEIGHT_RATIO = 0.52;
/** 窗口尺寸变化时，相机仍在取景位（误差 < 该值）则自动重取景，避免脚/头被新栏位遮挡 */
const REFRAME_EPSILON = 0.05;

/** 统计展示实例实际三角面数 */
function countTriangles(root: THREE.Object3D): number {
  let triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry;
    if (geometry.index) triangles += geometry.index.count / 3;
    else triangles += (geometry.attributes.position ? geometry.attributes.position.count : 0) / 3;
  });
  return Math.round(triangles);
}

/** 收集展示实例全部贴图尺寸（去重），无贴图返回“无贴图” */
function collectTextureSizes(root: THREE.Object3D): string {
  const sizes = new Set<string>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const map = (material as THREE.MeshStandardMaterial).map;
      const image = map ? (map.image as { width?: number; height?: number }) : null;
      if (image && (image.width ?? 0) > 0) {
        sizes.add(`${image.width}×${image.height}`);
      }
    }
  });
  if (sizes.size === 0) return '无贴图';
  return [...sizes].join(' / ');
}

export function initModelViewer(container: HTMLElement): void {
  new ModelViewer(container);
}

class ModelViewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly stats: {
    tris: HTMLElement;
    texture: HTMLElement;
    fileSize: HTMLElement;
    height: HTMLElement;
  };
  private readonly loadingEl: HTMLDivElement;
  private readonly charButtons = new Map<CharacterModelId, HTMLButtonElement>();
  private readonly animBar: HTMLElement;
  private readonly animButtons = new Map<string, HTMLButtonElement>();
  private readonly fileSizeCache = new Map<CharacterModelId, number | null>();
  private topbarEl: HTMLElement | null = null;
  private bottombarEl: HTMLElement | null = null;
  private rotateButton: HTMLButtonElement | null = null;

  private currentModel: THREE.Group | null = null;
  private currentEntry: CharacterModelEntry | null = null;
  private wireframeOn = false;
  private loadToken = 0;
  /** 骨骼动画：mixer 与动作均绑定当前展示实例，切换角色时必须彻底清理 */
  private mixer: THREE.AnimationMixer | null = null;
  private mixerRoot: THREE.Object3D | null = null;
  private readonly actionMap = new Map<string, THREE.AnimationAction>();
  private currentAction: THREE.AnimationAction | null = null;
  /** 上一帧时间戳（毫秒）：r187 起 THREE.Clock 已弃用，改为手动计算帧间隔 */
  private lastFrameTime = 0;
  /** 最近一次自动取景用的模型身高；null 表示尚未取景 */
  private framedHeightM: number | null = null;
  /** 最近一次自动取景后的相机位置（窗口变化时判断是否仍在取景位） */
  private readonly lastFramedCamera = new THREE.Vector3();

  constructor(container: HTMLElement) {
    const isCoarse = window.matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, isCoarse ? MOBILE_PIXEL_RATIO : DESKTOP_PIXEL_RATIO),
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xb9c6d2);
    this.buildLights();
    this.buildGround();

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.85, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 6;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.autoRotateSpeed = 0.6;
    // 手机：单指旋转、双指缩放（关闭双指旋转避免误触）
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    // 用户手动操作即退出自动慢转
    this.controls.addEventListener('start', () => {
      if (this.controls.autoRotate) this.setAutoRotate(false);
    });

    const ui = this.buildUi(container);
    this.stats = ui.stats;
    this.loadingEl = ui.loadingEl;
    this.animBar = ui.animBar;
    this.topbarEl = ui.topbar;
    this.bottombarEl = ui.bottombar;

    window.addEventListener('resize', this.handleResize);
    requestAnimationFrame(this.tick);

    // 开发期自动化钩子：供截图脚本控制机位、角色与动画（生产构建剔除）
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__modelViewer = {
        select: (id: CharacterModelId) => this.selectCharacter(id),
        setCameraYaw: (yaw: number) => this.debugSetCameraYaw(yaw),
        getFrameInfo: () => this.getFrameInfo(),
        sampleHeadColor: () => this.sampleHeadColor(),
        playAnimation: (name: string) => this.playAnimation(name),
        getAnimations: () => [...this.actionMap.keys()],
        /** 停止动画并回到绑定姿势，供朝向采样排除动作干扰 */
        stopAnimation: () => this.stopAnimation(true),
        /** 读取指定骨骼的本地变换，供无头脚本验证动画确实在驱动骨骼 */
        getBoneState: (boneName = 'Hip') => this.getBoneState(boneName),
        getBoneNames: () => this.getBoneNames(),
        getBoneWorldPosition: (boneName: string) => this.getBoneWorldPosition(boneName),
        /** 模型根缩放：1.62 / 原始高度，用于反推骨骼动画的世界位移 */
        getModelScale: () => this.currentModel?.scale.y ?? 1,
        setAnimationTimeScale: (value: number) => {
          if (this.currentAction) this.currentAction.setEffectiveTimeScale(value);
        },
        /** 多 primitive 蒙皮网格挂载状态：骨骼同图、视锥剔除、阴影与共享标记 */
        getSkinnedMeshInfo: () => this.getSkinnedMeshInfo(),
        /** 近距离取景（脚部特写）：目标高度 / 相机半径 / 方位角 */
        setCameraFocus: (targetY: number, radius: number, yawRad: number) =>
          this.debugSetCameraFocus(targetY, radius, yawRad),
      };
    }

    void this.selectCharacter(CHARACTER_MODELS[0].id);
  }

  /** 与正式游戏一致的清晨柔光：暖黄平行光（软阴影）+ 冷蓝灰半球环境光 */
  private buildLights(): void {
    const hemisphere = new THREE.HemisphereLight(0xc3d2e0, 0x5e665c, 0.9);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight(0xffd9a8, 2.4);
    sun.position.set(8, 6, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 40;
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  /** 阴影地面 + 参考网格 + 1.7m 身高参照标尺 */
  private buildGround(): void {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(5, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xd7dfe5, roughness: 0.95 }),
    );
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(8, 16, 0x8799a6, 0x5f7484);
    grid.position.y = 0.01;
    this.scene.add(grid);

    // 标尺：细柱 + 0.5m 间隔刻度，1.7m 顶刻度用暖色突出
    const ruler = new THREE.Group();
    const column = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, RULER_HEIGHT_M, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x8fa3b0, roughness: 0.7 }),
    );
    column.position.y = RULER_HEIGHT_M / 2;
    ruler.add(column);

    const tickMaterial = new THREE.MeshStandardMaterial({ color: 0x9fb3c0, roughness: 0.6 });
    const topMaterial = new THREE.MeshStandardMaterial({ color: 0xf2cfa4, roughness: 0.6 });
    for (const y of [0, 0.5, 1, 1.5, RULER_HEIGHT_M]) {
      const isTop = Math.abs(y - RULER_HEIGHT_M) < 0.001;
      const tick = new THREE.Mesh(
        new THREE.BoxGeometry(isTop ? 0.5 : 0.32, 0.012, 0.012),
        isTop ? topMaterial : tickMaterial,
      );
      tick.position.y = y;
      ruler.add(tick);
    }
    ruler.position.set(-1.7, 0, -1.6);
    this.scene.add(ruler);
  }

  /** 顶部角色切换栏 + 底部动画栏、数据面板与开关 */
  private buildUi(container: HTMLElement): {
    stats: ModelViewer['stats'];
    loadingEl: HTMLDivElement;
    animBar: HTMLElement;
    topbar: HTMLElement;
    bottombar: HTMLElement;
  } {
    const root = document.createElement('div');
    root.className = 'mv-root';
    container.appendChild(root);

    // 顶部栏：标题 + 角色按钮
    const topbar = document.createElement('header');
    topbar.className = 'mv-topbar';
    const title = document.createElement('h1');
    title.className = 'mv-topbar__title';
    title.textContent = '模型检视台';
    topbar.appendChild(title);

    const chars = document.createElement('nav');
    chars.className = 'mv-chars';
    for (const entry of CHARACTER_MODELS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mv-btn';
      button.textContent = entry.name;
      button.addEventListener('click', () => void this.selectCharacter(entry.id));
      chars.appendChild(button);
      this.charButtons.set(entry.id, button);
    }
    topbar.appendChild(chars);
    root.appendChild(topbar);

    // 底部栏：动画切换 + 实时数据 + 显示开关
    const bottombar = document.createElement('footer');
    bottombar.className = 'mv-bottombar';

    // 骨骼动画动作栏：仅对自带动画剪辑的角色显示（林夏），默认播放走路
    const animBar = document.createElement('div');
    animBar.className = 'mv-anims';
    animBar.hidden = true;
    bottombar.appendChild(animBar);

    const stats = document.createElement('div');
    stats.className = 'mv-stats';
    const makeItem = (label: string): { item: HTMLDivElement; value: HTMLElement } => {
      const item = document.createElement('div');
      item.className = 'mv-stats__item';
      const strong = document.createElement('strong');
      strong.textContent = '—';
      item.append(`${label}：`, strong);
      return { item, value: strong };
    };
    const trisItem = makeItem('三角面数');
    const textureItem = makeItem('贴图尺寸');
    const fileSizeItem = makeItem('文件大小');
    const heightItem = makeItem('标准化身高');
    stats.append(trisItem.item, textureItem.item, fileSizeItem.item, heightItem.item);
    bottombar.appendChild(stats);

    const toggles = document.createElement('div');
    toggles.className = 'mv-toggles';
    const wireButton = document.createElement('button');
    wireButton.type = 'button';
    wireButton.className = 'mv-btn';
    wireButton.textContent = '线框对比';
    wireButton.addEventListener('click', () => {
      this.wireframeOn = !this.wireframeOn;
      wireButton.classList.toggle('mv-btn--active', this.wireframeOn);
      if (this.currentModel) this.applyWireframe(this.currentModel);
    });
    toggles.appendChild(wireButton);

    const rotateButton = document.createElement('button');
    rotateButton.type = 'button';
    rotateButton.className = 'mv-btn';
    rotateButton.textContent = '自动慢转';
    rotateButton.addEventListener('click', () => this.setAutoRotate(!this.controls.autoRotate));
    toggles.appendChild(rotateButton);
    this.rotateButton = rotateButton;

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'mv-btn';
    resetButton.textContent = '复位视角';
    resetButton.addEventListener('click', () => this.resetView());
    toggles.appendChild(resetButton);
    bottombar.appendChild(toggles);
    root.appendChild(bottombar);

    // 加载浮层
    const loadingEl = document.createElement('div');
    loadingEl.className = 'mv-loading';
    loadingEl.hidden = true;
    root.appendChild(loadingEl);

    return {
      stats: { tris: trisItem.value, texture: textureItem.value, fileSize: fileSizeItem.value, height: heightItem.value },
      loadingEl,
      animBar,
      topbar,
      bottombar,
    };
  }

  /** 切换角色：懒加载 + 缓存；用 token 忽略过期结果，防连点错位 */
  private async selectCharacter(id: CharacterModelId): Promise<void> {
    this.charButtons.forEach((button, buttonId) => {
      button.classList.toggle('mv-btn--active', buttonId === id);
    });

    const token = ++this.loadToken;
    this.loadingEl.hidden = false;
    this.loadingEl.textContent = '模型加载中…';

    try {
      const asset = await loadCharacterModel(id, (progress) => {
        // 文件大小直接取自下载进度（Content-Length），不再额外发 HEAD 请求（部分 CDN 不支持 HEAD）
        if (progress.total <= 0) return;
        this.fileSizeCache.set(id, progress.total / (1024 * 1024));
        if (token === this.loadToken) {
          this.stats.fileSize.textContent = `${(progress.total / (1024 * 1024)).toFixed(2)} MB`;
        }
      });
      if (token !== this.loadToken) return;

      const entry = getCharacterModel(id);
      this.disposeMixer();
      if (this.currentModel) this.scene.remove(this.currentModel);
      // 骨骼模型必须用 SkeletonUtils.clone 实例化，普通 clone(true) 破坏骨骼绑定
      const display = instantiateCharacterModel(id);
      // 按清单归正朝向：rotation.y = frontYawRad 后正面朝 +Z，与场景摆放约定一致
      display.rotation.y = entry.frontYawRad;
      // 克隆材质（贴图共享）：线框开关只影响展示实例，不污染缓存模板
      display.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          if (Array.isArray(object.material)) {
            object.material = object.material.map((material) => material.clone());
          } else {
            object.material = object.material.clone();
          }
        }
      });
      this.applyWireframe(display);
      display.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      this.scene.add(display);
      this.currentModel = display;
      this.currentEntry = entry;
      this.setupAnimations(display, asset.animations);
      this.updateStats(display, id);
      // 加载完成仍未收到 Content-Length（如已命中缓存模板）时标记未知，避免永远停留在“读取中…”
      if (!this.fileSizeCache.has(id)) {
        this.fileSizeCache.set(id, null);
        this.stats.fileSize.textContent = '未知';
      }
      // 按身高与顶/底栏之间的可视带自动取景：头脚完整、无遮挡
      this.applyFraming(entry.heightM);
      this.loadingEl.hidden = true;
    } catch (error) {
      if (token !== this.loadToken) return;
      this.loadingEl.textContent = '模型加载失败，请检查网络后重试';
      console.warn(`[modelViewer] 加载模型失败：${id}`, error);
    }
  }

  /** 绑定动画：为当前展示实例建立 mixer 与动作按钮；无动画角色隐藏动作栏 */
  private setupAnimations(root: THREE.Object3D, clips: readonly THREE.AnimationClip[]): void {
    this.animBar.replaceChildren();
    this.animButtons.clear();
    this.animBar.hidden = clips.length === 0;
    if (clips.length === 0) return;

    const makeButton = (key: string, label: string, onSelect: () => void): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mv-btn';
      button.textContent = label;
      button.addEventListener('click', () => {
        onSelect();
        this.syncAnimButtons();
      });
      this.animBar.appendChild(button);
      this.animButtons.set(key, button);
      return button;
    };

    makeButton('__idle', '静止', () => this.stopAnimation(true));
    for (const clip of clips) {
      makeButton(clip.name, ANIMATION_LABELS[clip.name] ?? clip.name, () => this.playAnimation(clip.name));
    }

    this.mixer = new THREE.AnimationMixer(root);
    this.mixerRoot = root;
    for (const clip of clips) {
      this.actionMap.set(clip.name, this.mixer.clipAction(clip));
    }
    // 默认播放走路（原地循环），无 walk 时停在绑定姿势
    if (this.actionMap.has('walk')) this.playAnimation('walk');
    else this.syncAnimButtons();
  }

  /** 播放指定剪辑：与当前动作交叉淡入，重复调用同一动作只重置播放 */
  private playAnimation(name: string): void {
    const next = this.actionMap.get(name);
    if (!next) return;
    if (this.currentAction && this.currentAction !== next) {
      this.currentAction.fadeOut(ANIMATION_FADE_SEC);
    }
    next.reset();
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.fadeIn(ANIMATION_FADE_SEC);
    next.play();
    this.currentAction = next;
    this.syncAnimButtons();
  }

  /** 停止动画并回到绑定姿势；绑定姿势下朝向判定不受动作干扰 */
  private stopAnimation(resetPose: boolean): void {
    if (this.currentAction) {
      this.currentAction.stop();
      this.currentAction = null;
    }
    this.mixer?.stopAllAction();
    if (resetPose && this.currentModel) {
      this.currentModel.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) object.skeleton.pose();
      });
    }
    this.syncAnimButtons();
  }

  private syncAnimButtons(): void {
    const activeName = this.currentAction ? this.currentAction.getClip().name : '__idle';
    this.animButtons.forEach((button, key) => {
      button.classList.toggle('mv-btn--active', key === activeName);
    });
  }

  /** 切换角色前清理旧 mixer，避免残留骨骼缓存与动作 */
  private disposeMixer(): void {
    this.mixer?.stopAllAction();
    if (this.mixer && this.mixerRoot) this.mixer.uncacheRoot(this.mixerRoot);
    this.mixer = null;
    this.mixerRoot = null;
    this.currentAction = null;
    this.actionMap.clear();
    this.animButtons.clear();
    this.animBar.replaceChildren();
    this.animBar.hidden = true;
  }

  /** 调试用：读取指定骨骼的本地变换（骨骼名优先精确匹配，未命中返回 null） */
  private getBoneState(
    boneName: string,
  ): { position: [number, number, number]; quaternion: [number, number, number, number] } | null {
    let result: { position: [number, number, number]; quaternion: [number, number, number, number] } | null =
      null;
    this.currentModel?.traverse((object) => {
      if (result || !(object as THREE.Bone).isBone || object.name !== boneName) return;
      result = {
        position: [object.position.x, object.position.y, object.position.z],
        quaternion: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
      };
    });
    return result;
  }

  private getBoneNames(): string[] {
    const names: string[] = [];
    this.currentModel?.traverse((object) => {
      if ((object as THREE.Bone).isBone) names.push(object.name);
    });
    return names;
  }

  /** 调试用：骨骼世界坐标（含模型归一化缩放与朝向旋转） */
  private getBoneWorldPosition(boneName: string): [number, number, number] | null {
    let result: [number, number, number] | null = null;
    this.currentModel?.updateWorldMatrix(true, true);
    this.currentModel?.traverse((object) => {
      if (result || !(object as THREE.Bone).isBone || object.name !== boneName) return;
      const position = new THREE.Vector3();
      object.getWorldPosition(position);
      result = [position.x, position.y, position.z];
    });
    return result;
  }

  private applyWireframe(root: THREE.Object3D): void {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial) material.wireframe = this.wireframeOn;
      }
    });
  }

  private setAutoRotate(enabled: boolean): void {
    this.controls.autoRotate = enabled;
    this.rotateButton?.classList.toggle('mv-btn--active', enabled);
  }

  private resetView(): void {
    this.applyFraming(this.currentEntry ? this.currentEntry.heightM : RULER_HEIGHT_M);
  }

  /**
   * 按角色身高自动取景：保证 模型身高×FRAME_PADDING 的纵向范围完整落在
   * 顶栏底边与底栏顶边之间的可视带内，脚底与头顶不被任何固定栏遮挡。
   * 相机放在左前 45°（INITIAL_AZIMUTH），呈正脸偏四分之三构图。
   */
  private applyFraming(heightM: number): void {
    const top = this.topbarEl ? this.topbarEl.offsetHeight : 0;
    const bottom = this.bottombarEl ? this.bottombarEl.offsetHeight : 0;
    const viewportH = Math.max(window.innerHeight, 1);
    const bandPx = Math.max(viewportH - top - bottom, 80);
    const fovRad = (this.camera.fov * Math.PI) / 180;

    // 取景高度恰占满可视带所需的相机距离（留白系数内置于 visibleH）
    const visibleH = heightM * FRAME_PADDING;
    const distance = (visibleH * viewportH) / (2 * Math.tan(fovRad / 2) * bandPx);
    const clamped = Math.min(Math.max(distance, this.controls.minDistance), this.controls.maxDistance);

    // 可视带中心相对屏幕中心的像素偏移 → 换算为目标点世界纵向偏移，保证头脚对称落带
    const bandCenterPx = top + bandPx / 2;
    const offsetWorld = ((bandCenterPx - viewportH / 2) / viewportH) * (2 * clamped * Math.tan(fovRad / 2));

    this.camera.position.set(
      Math.sin(INITIAL_AZIMUTH) * clamped,
      heightM * CAMERA_HEIGHT_RATIO,
      Math.cos(INITIAL_AZIMUTH) * clamped,
    );
    this.controls.target.set(0, heightM * 0.5 + offsetWorld, 0);
    this.controls.update();
    this.lastFramedCamera.copy(this.camera.position);
    this.framedHeightM = heightM;
  }

  /** 调试用：固定半径与高度，把相机放到目标方位角（yaw=0 相机在 +Z 看到正脸；yaw=π 相机在 -Z 看到背面） */
  private debugSetCameraYaw(yawRad: number): void {
    const radius = 2.6;
    this.camera.position.set(Math.sin(yawRad) * radius, 1.2, Math.cos(yawRad) * radius);
    this.controls.target.set(0, 0.8, 0);
    this.controls.update();
  }

  /** 调试用：脚部 / 局部特写取景，目标高度与半径可调 */
  private debugSetCameraFocus(targetY: number, radius: number, yawRad: number): void {
    this.camera.position.set(
      Math.sin(yawRad) * radius,
      targetY + radius * 0.25,
      Math.cos(yawRad) * radius,
    );
    this.controls.target.set(0, targetY, 0);
    this.controls.update();
  }

  /**
   * 调试用：读取当前展示实例全部 SkinnedMesh 的挂载状态。
   * 多 primitive 模型应得到 2 个子网格：骨骼图为同一套克隆骨骼（同步跟随）、
   * 关闭视锥剔除、投影/接收阴影、几何与材质带共享标记。
   */
  private getSkinnedMeshInfo(): Array<{
    material: string;
    tris: number;
    vertices: number;
    frustumCulled: boolean;
    castShadow: boolean;
    receiveShadow: boolean;
    geometryShared: boolean;
    materialShared: boolean;
    bones: number;
    sameBoneGraph: boolean;
  }> {
    const meshes: THREE.SkinnedMesh[] = [];
    this.currentModel?.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) meshes.push(object);
    });
    const firstBones = meshes.length > 0 ? meshes[0].skeleton.bones : [];
    return meshes.map((mesh) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const indexCount = mesh.geometry.index
        ? mesh.geometry.index.count
        : (mesh.geometry.attributes.position?.count ?? 0);
      return {
        material: materials.map((material) => material.name || '(无材质)').join(' / '),
        tris: Math.round(indexCount / 3),
        vertices: mesh.geometry.attributes.position?.count ?? 0,
        frustumCulled: mesh.frustumCulled,
        castShadow: mesh.castShadow,
        receiveShadow: mesh.receiveShadow,
        geometryShared: mesh.geometry.userData[SHARED_RESOURCE_FLAG] === true,
        materialShared: materials.every(
          (material) => material.userData[SHARED_RESOURCE_FLAG] === true,
        ),
        bones: mesh.skeleton.bones.length,
        sameBoneGraph:
          mesh.skeleton.bones.length === firstBones.length &&
          mesh.skeleton.bones.every((bone, index) => bone === firstBones[index]),
      };
    });
  }

  /**
   * 调试用取景边界测量：把当前模型头顶与脚底投影到屏幕像素坐标，
   * 与顶/底栏实际边界对比，供自动化脚本断言“头脚不被固定栏遮挡”。
   */
  private getFrameInfo(): {
    headTopPx: number;
    feetBottomPx: number;
    topbarBottomPx: number;
    bottombarTopPx: number;
  } {
    const heightM = this.currentEntry ? this.currentEntry.heightM : 0;
    const project = (worldY: number): number => {
      const vector = new THREE.Vector3(0, worldY, 0).project(this.camera);
      return (1 - vector.y) * 0.5 * window.innerHeight;
    };
    const topbar = this.topbarEl ? this.topbarEl.getBoundingClientRect().bottom : 0;
    const bottombar = this.bottombarEl ? this.bottombarEl.getBoundingClientRect().top : window.innerHeight;
    return {
      headTopPx: project(heightM),
      feetBottomPx: project(0),
      topbarBottomPx: topbar,
      bottombarTopPx: bottombar,
    };
  }

  /** 调试用：采样当前模型头部中心小区域的平均颜色（正脸=暖肤色，背面=深发色），供朝向判定 */
  private sampleHeadColor(): { r: number; g: number; b: number } {
    this.renderer.render(this.scene, this.camera);
    const canvas = this.renderer.domElement;
    const width = 64;
    const height = 56;
    const copy = document.createElement('canvas');
    copy.width = width;
    copy.height = height;
    const context = copy.getContext('2d');
    if (!context) return { r: -1, g: -1, b: -1 };
    const heightM = this.currentEntry ? this.currentEntry.heightM : RULER_HEIGHT_M;
    // 采样框中心取鼻口区域（0.86×身高），避开刘海/发际线，正脸与后脑色差最大
    const head = new THREE.Vector3(0, heightM * 0.86, 0).project(this.camera);
    const sx = (head.x * 0.5 + 0.5) * canvas.width;
    const sy = (1 - (head.y * 0.5 + 0.5)) * canvas.height;
    context.drawImage(canvas, sx - width / 2, sy - height / 2, width, height, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height).data;
    let r = 0;
    let g = 0;
    let b = 0;
    const count = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    return { r: r / count, g: g / count, b: b / count };
  }

  private updateStats(display: THREE.Group, id: CharacterModelId): void {
    const entry = CHARACTER_MODELS.find((item) => item.id === id);
    if (!entry) return;

    this.stats.tris.textContent = countTriangles(display).toLocaleString('zh-CN');
    this.stats.texture.textContent = collectTextureSizes(display);
    this.stats.height.textContent = `${entry.heightM.toFixed(2)} m`;

    const cached = this.fileSizeCache.get(id);
    if (cached !== undefined) {
      this.stats.fileSize.textContent = cached === null ? '未知' : `${cached.toFixed(2)} MB`;
    } else {
      // 下载进度回调会在加载过程中写入；若加载完成仍未拿到 Content-Length，标记未知
      this.stats.fileSize.textContent = '读取中…';
    }
  }

  private readonly handleResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    // 用户未手动转动机位时，窗口变化会改变栏位占比，重新取景保证头脚不被遮挡
    if (this.framedHeightM !== null && this.camera.position.distanceTo(this.lastFramedCamera) < REFRAME_EPSILON) {
      this.applyFraming(this.framedHeightM);
    }
  };

  private readonly tick = (): void => {
    requestAnimationFrame(this.tick);
    this.controls.update();
    const now = performance.now();
    const delta = this.lastFrameTime === 0 ? 0 : Math.min((now - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = now;
    this.mixer?.update(delta);
    this.renderer.render(this.scene, this.camera);
  };
}

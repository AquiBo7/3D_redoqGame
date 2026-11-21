// world/WorldApp.ts —— 3D 世界编排：渲染器 / 相机 / 灯光 / 场景 / 控制器 / 交互 / HUD / 过场 / 调试层
// 边界：3D 世界不直接修改剧情状态；跨模块通知一律走 core 事件总线。
// S1–S9 按 sceneKey 装载：同 key 切 sceneId 只更新交互配置，绝不销毁重建或重置站位；
// 异 key 切换以黑幕淡出 → 重建 → 淡入过渡（transitionLocked 只锁输入，不触碰 uiLock）。

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { gsap } from 'gsap';
import { sampleGroundHeight } from './navMath';
import type { EventBus } from '../core/eventBus';
import { eventBus as defaultEventBus } from '../core/eventBus';
import type { SceneId, SceneKey } from '../data/storySchema';
import { getSceneDefinition, getSceneRuntime, isSceneModuleReady, prepareSceneModule } from '../scenes3d';
import {
  createContactShadowDisc,
  disposeMaterialCache,
  isGroundedActor,
} from '../scenes3d/materials';
import type { CharacterModelId } from '../scenes3d/modelManifest';
import type { ColorBloomUniforms } from '../scenes3d/colorBloom';
import { CutscenePlayer } from './CutscenePlayer';
import { DebugOverlay } from './debugOverlay';
import { FirstPersonController } from './FirstPersonController';
import { InteractionSystem } from './InteractionSystem';
import {
  loadCharacterModel,
  hasCharacterModel,
  preloadCharacterModels,
  SHARED_RESOURCE_FLAG,
} from './resources';
import { WorldHud } from './WorldHud';
import type {
  SceneRuntime,
  SceneRuntimeContext,
  WorldSceneDefinition,
} from './worldSceneTypes';

/** 横屏（宽 ≥ 高）下的第一人称垂直视野（度），62° 为自然舒适的水平视野 */
const LANDSCAPE_FOV = 62;
/** 横屏参考宽高比，用于竖屏时换算水平视野 */
const REFERENCE_ASPECT = 16 / 9;
/** 竖屏垂直 FOV 上限，避免视野过度拉大产生鱼眼 */
const PORTRAIT_MAX_FOV = 90;
/** 手机端像素比上限（性能红线） */
const MOBILE_PIXEL_RATIO = 1.5;
/** 核显桌面端像素比上限（兼顾清晰度与填充率） */
const INTEGRATED_GPU_PIXEL_RATIO = 1.25;
/** 独显桌面端像素比上限 */
const DESKTOP_PIXEL_RATIO = 2;
/** 核显 / 移动端低功耗 GPU 特征匹配（用于关闭离屏 MSAA 与收紧像素比） */
const INTEGRATED_GPU_PATTERN = /Radeon\(TM\)\s*610M|Radeon\s*\d{3}M|Intel.*(UHD|Iris|HD Graphics)|Mali|Adreno/i;
/** 切图黑幕淡出 / 淡入时长（秒） */
const FADE_OUT_SEC = 0.4;
const FADE_IN_SEC = 0.55;
/** 首屏（无过场时）黑幕淡入时长（秒） */
const INITIAL_FADE_SEC = 0.5;
/** 切图预载角色模型的总时长上限（毫秒）：超时直接进场景，缺失模型由 shared 回退并异步补载 */
const MODEL_PRELOAD_TIMEOUT_MS = 8000;

/** 清晨天空球半径：小于 camera.far = 120，且每帧跟随相机，玩家永远到不了天穹边缘 */
const SKY_DOME_RADIUS = 90;
/** 无雾场景（房间等）用于地平线下方的默认雾色，与旧的纯色背景一致 */
const DEFAULT_HAZE_COLOR = 0xa7bec8;
/** 清晨天顶 / 中层薄雾 / 地平线暖杏金（线性工作空间由 THREE.Color 自动换算） */
const SKY_ZENITH_COLOR = 0x82acd0;
const SKY_MID_COLOR = 0xc2d2d7;
const SKY_HORIZON_WARM = 0xf3c28e;
const DEFAULT_ATMOSPHERE = {
  uZenith: new THREE.Color(SKY_ZENITH_COLOR),
  uMid: new THREE.Color(SKY_MID_COLOR),
  uHorizon: new THREE.Color(SKY_HORIZON_WARM),
  uCloud: new THREE.Color(0.7, 0.78, 0.82),
  uCloudHighlight: new THREE.Color(0.94, 0.87, 0.75),
  uSunHighlight: new THREE.Color(1, 0.58, 0.25),
  sun: new THREE.Color(0xffd29b),
};
const COOL_ATMOSPHERE = {
  uZenith: new THREE.Color(0x7e9aae),
  uMid: new THREE.Color(0xa9bec7),
  uHorizon: new THREE.Color(0xb4c6ca),
  uCloud: new THREE.Color(0.52, 0.62, 0.68),
  uCloudHighlight: new THREE.Color(0.68, 0.75, 0.79),
  uSunHighlight: new THREE.Color(0.64, 0.73, 0.8),
  sun: new THREE.Color(0xd4dee4),
  fog: new THREE.Color(0x9eb7c2),
};
const DAWN_ATMOSPHERE = {
  uZenith: new THREE.Color(0x9caed0),
  uMid: new THREE.Color(0xe7c4d0),
  uHorizon: new THREE.Color(0xffcb99),
  uCloud: new THREE.Color(0.82, 0.72, 0.79),
  uCloudHighlight: new THREE.Color(1, 0.82, 0.63),
  uSunHighlight: new THREE.Color(1, 0.55, 0.27),
  sun: new THREE.Color(0xffc48f),
  fog: new THREE.Color(0xe3c6ba),
};
const SKY_COLOR_UNIFORMS = ['uZenith', 'uMid', 'uCloud', 'uCloudHighlight', 'uSunHighlight'] as const;
const HAZE_TINT = new THREE.Color(0x91b3c2);
const DEFAULT_DUST = new THREE.Color(0xffdfad);
const DEFAULT_LEAF = new THREE.Color(0xa6ad79);
const DAWN_PARTICLE_COLORS = [
  new THREE.Color(0xffd58b),
  new THREE.Color(0xffc9d9),
  new THREE.Color(0xc5d99c),
];
const SUN_DIRECTION = new THREE.Vector3(-11, 6.5, 9).normalize();

export function smoothAtmosphereProgress(progress: number): number {
  const t = Number.isNaN(progress) ? 0 : Math.max(0, Math.min(1, progress));
  return t * t * (3 - 2 * t);
}
const OUTDOOR_PARTICLE_SCENE_KEYS: ReadonlySet<SceneKey> = new Set<SceneKey>([
  'street',
  'gate',
  'building',
]);

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uBelow;
  uniform vec3 uCloud;
  uniform vec3 uCloudHighlight;
  uniform vec3 uSunHighlight;
  uniform vec3 uSunDirection;
  uniform float uTime;
  varying vec3 vDir;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise21(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.52;
    for (int i = 0; i < 4; i++) {
      value += noise21(p) * amplitude;
      p = mat2(1.62, 1.18, -1.18, 1.62) * p;
      amplitude *= 0.48;
    }
    return value;
  }

  void main() {
    vec3 direction = normalize(vDir);
    float h = direction.y;
    vec3 sky = mix(uHorizon, uMid, smoothstep(0.0, 0.24, h));
    sky = mix(sky, uZenith, smoothstep(0.14, 0.66, h));

    vec2 cloudUv = direction.xz / max(h + 0.3, 0.18);
    cloudUv = cloudUv * 1.35 + vec2(uTime * 0.0035, uTime * 0.0012);
    float cloudNoise = fbm(cloudUv) * 0.76 + fbm(cloudUv * 2.3 + 7.1) * 0.24;
    float clouds = smoothstep(0.5, 0.7, cloudNoise) * smoothstep(0.015, 0.17, h);
    vec3 cloudColor = mix(uCloud, uCloudHighlight,
      pow(max(dot(direction, uSunDirection), 0.0), 5.0));
    sky = mix(sky, cloudColor, clouds * 0.46);

    float sunDot = max(dot(direction, uSunDirection), 0.0);
    float halo = pow(sunDot, 24.0) * 0.22 + pow(sunDot, 180.0) * 0.5;
    sky += uSunHighlight * halo * smoothstep(-0.04, 0.12, h);

    vec3 color = mix(uBelow, sky, smoothstep(-0.12, 0.015, h));
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface WorldAppOptions {
  bus?: EventBus;
  sceneId?: SceneId;
  debug?: boolean;
}

function disposeObjectTree(root: THREE.Object3D): void {
  const children = [...root.children];
  for (const child of children) {
    child.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        // 共享模板资源（角色模型缓存）：几何跳过销毁；未共享的材质（如纯色覆盖）仍需释放
        if (object.geometry.userData[SHARED_RESOURCE_FLAG] !== true) {
          object.geometry.dispose();
        }
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material.userData[SHARED_RESOURCE_FLAG] !== true) material.dispose();
        }
      }
    });
    root.remove(child);
  }
}

export class WorldApp {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly bus: EventBus;
  private readonly hud: WorldHud;
  private readonly interaction: InteractionSystem;
  private readonly controller: FirstPersonController;
  private readonly cutscenePlayer: CutscenePlayer;
  private readonly debugOverlay: DebugOverlay | null;
  private readonly levelGroup = new THREE.Group();
  private readonly skyDome: THREE.Mesh;
  private readonly skyMaterial: THREE.ShaderMaterial;
  private readonly sun = new THREE.DirectionalLight(0xffd29b, 2.05);
  private readonly baseHaze = new THREE.Color(DEFAULT_HAZE_COLOR);
  private readonly atmosphereHaze = new THREE.Color();
  private readonly atmosphereHorizon = new THREE.Color();
  private readonly particleColor = new THREE.Color();
  private readonly airParticleShape = { value: 0 };
  private atmosphereProgress = 0;
  private runtimeContextToken = 0;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private outputPass: OutputPass | null = null;
  private airParticles: THREE.Points | null = null;
  private airParticleSpeeds: Float32Array | null = null;
  /** PMREM 烘焙产物：必须一直保留到 dispose()，提前释放会导致环境贴图失效黑屏 */
  private envRenderTarget: THREE.WebGLCubeRenderTarget | null = null;
  private readonly fadeEl: HTMLDivElement;
  private readonly unsubscribers: Array<() => void> = [];
  /** 纯触摸设备：不显示桌面准星引导 / 疾跑角标（触屏笔记本仍按桌面处理） */
  private readonly pureTouch: boolean;
  /** 是否命中核显特征（收紧像素比上限并关闭离屏 MSAA，零画质感知损失） */
  private readonly integratedGpu: boolean;

  private currentSceneId: SceneId;
  private currentDefinition: WorldSceneDefinition;
  private interactionOptions: { sceneId: SceneId; ids: string[] } | null = null;
  private storyFlags = { noticedTyper: false, joined: false };
  private currentRuntime: SceneRuntime | null = null;
  private pendingDefinition: WorldSceneDefinition | null = null;
  private pendingSceneId: SceneId | null = null;
  private builtOccluders: THREE.Object3D[] = [];
  private actors: Record<string, THREE.Object3D> = {};
  private baseFov = LANDSCAPE_FOV;
  private initialFadeTimer = 0;
  private orientationResizeTimer = 0;
  /** 递增的切图 token：预载期间发生新跳关时旧提交作废，防止串台 */
  private transitionToken = 0;
  /** 初始场景是否已真正挂载（需要预载时会晚于首帧） */
  private initialMounted = false;
  /** 首屏黑幕是否已开始淡入（保证只执行一次） */
  private initialFadeDone = false;
  private disposed = false;
  /** 当前 2D 模态界面是否阻塞控制（同步 ui:worldBlocked / lockControls） */
  private modalBlocked = false;
  /** 构造函数同步触发的初始 scene:transition（由 mountInitialScene 接管，避免同帧 EventBus Set 遍历重入） */
  private inConstructorEmit = false;
  private rafId = 0;
  private lastFrameTime = 0;
  private readonly motionPositions = new Map<string, THREE.Vector3>();
  private readonly scratchWorldPos = new THREE.Vector3();

  constructor(container: HTMLElement, options: WorldAppOptions = {}) {
    const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
    this.pureTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    this.bus = options.bus ?? defaultEventBus;
    this.currentSceneId = options.sceneId ?? 'S1';

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.integratedGpu = this.detectIntegratedGpu();
    const maxPixelRatio = isCoarsePointer
      ? MOBILE_PIXEL_RATIO
      : this.integratedGpu
        ? INTEGRATED_GPU_PIXEL_RATIO
        : DESKTOP_PIXEL_RATIO;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // 程序化清晨天空球替代纯色背景：BackSide + 不写深度 + 不受雾影响
    this.skyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color(SKY_ZENITH_COLOR) },
        uMid: { value: new THREE.Color(SKY_MID_COLOR) },
        uHorizon: { value: new THREE.Color(SKY_HORIZON_WARM) },
        uBelow: { value: new THREE.Color(DEFAULT_HAZE_COLOR) },
        uCloud: { value: DEFAULT_ATMOSPHERE.uCloud.clone() },
        uCloudHighlight: { value: DEFAULT_ATMOSPHERE.uCloudHighlight.clone() },
        uSunHighlight: { value: DEFAULT_ATMOSPHERE.uSunHighlight.clone() },
        uSunDirection: { value: SUN_DIRECTION.clone() },
        uTime: { value: 0 },
      },
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_DOME_RADIUS, 32, 20),
      this.skyMaterial,
    );
    this.skyDome.name = 'morning-sky';
    this.skyDome.frustumCulled = false;
    this.scene.add(this.skyDome);
    this.scene.add(this.levelGroup);
    this.updateSkyHaze(this.baseHaze);

    // 远裁剪面 120：street/gate/building 的雾最远 75，充足不裁切
    this.camera = new THREE.PerspectiveCamera(LANDSCAPE_FOV, 1, 0.1, 120);
    this.camera.rotation.order = 'YXZ';

    this.buildLights();
    this.bakeEnvironment();

    this.hud = new WorldHud(container);

    this.interaction = new InteractionSystem({
      scene: this.scene,
      camera: this.camera,
      domElement: this.renderer.domElement,
      bus: this.bus,
      hud: this.hud,
      getSceneId: () => this.currentSceneId,
      isInputEnabled: () => this.controller.isEnabled(),
      debug: options.debug ?? false,
    });

    this.controller = new FirstPersonController({
      camera: this.camera,
      domElement: this.renderer.domElement,
      scene: this.scene,
      spawn: { x: 0, z: 0 },
      navigation: { bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }, obstacles: [] },
      callbacks: {
        onTap: (clientX, clientY) => this.interaction.tryTapInteract(clientX, clientY),
        onPrimaryAction: () => this.interaction.handlePrimaryClick(),
        onPointerLockChange: (locked) => this.handlePointerLockChange(locked),
        onEnabledChange: (enabled) => {
          this.hud.setControlsVisible(enabled);
          this.syncHudHints();
        },
        onSprintToggleChange: () => this.syncHudHints(),
      },
    });

    // 场景装载（注册表按 sceneId → sceneKey）；实际建场交给 mountInitialScene：
    // 房间（requiredModels 为空）同步建好，需要角色的直达场景等预载完成后再建（黑幕期间）
    this.currentDefinition = getSceneDefinition(isSceneModuleReady(this.currentSceneId) ? this.currentSceneId : 'S10');

    this.debugOverlay = options.debug ? new DebugOverlay(this.scene) : null;

    // 黑幕与过场播放器（黑幕在 canvas / HUD 之上、game-ui 之下）
    this.fadeEl = document.createElement('div');
    this.fadeEl.className = 'scene-fade';
    container.appendChild(this.fadeEl);

    this.cutscenePlayer = new CutscenePlayer({
      bus: this.bus,
      canvas: this.renderer.domElement,
      fadeEl: this.fadeEl,
      skipHost: this.fadeEl,
      camera: this.camera,
      setCinematic: (value) => this.controller.setCinematic(value),
      getPanoramaAnchor: () => this.currentDefinition.panoramaAnchor ?? null,
      getExitAnchor: () => this.currentDefinition.exitAnchor ?? null,
      getBaseFov: () => this.baseFov,
      getSceneKey: () => this.currentDefinition.sceneKey,
    });

    // 初始场景挂载 + 运行时装（震动定时器 / 胶囊演出 / 药袋隐藏）
    this.inConstructorEmit = true;
    queueMicrotask(() => {
      this.inConstructorEmit = false;
    });
    this.mountInitialScene();

    this.unsubscribers.push(
      this.bus.on('scene:transition', (payload) => this.handleSceneTransition(payload)),
      this.bus.on('state:changed', ({ state }) => {
        this.storyFlags = { noticedTyper: state.noticedTyper, joined: state.joined };
      }),
      this.bus.on('scene:interactionOptions', (payload) => {
        this.interactionOptions = payload;
        this.applyInteractionOptions();
      }),
      this.bus.on('ui:worldBlocked', ({ blocked }) => {
        this.modalBlocked = blocked;
      }),
    );

    // 首屏淡入：有过场时黑幕交给过场（s1-wake 从黑屏开始），否则挂载完成后自行淡入
    this.scheduleInitialFade();

    // 开发期自动化钩子：供无头浏览器逐场景截图核对朝向 / 预载（生产构建剔除）
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__worldApp = {
        getSceneId: () => this.currentSceneId,
        getPlayerPosition: () => ({ feet: this.controller.getFeetPosition(), camera: this.camera.position.toArray(), direction: this.camera.getWorldDirection(new THREE.Vector3()).toArray(), enabled: this.controller.isEnabled() }),
        getAirParticles: () => this.airParticles,
        /** 传送并设定视角（yawDeg=0 面向 -Z，180 面向 +Z） */
        teleport: (x: number, z: number, yawDeg = 0) => {
          this.controller.setSpawn({ x, z, yaw: (yawDeg * Math.PI) / 180 });
        },
        hasModel: (id: string) => hasCharacterModel(id as CharacterModelId),
        // 无头回归脚本：按当前场景发出与交互系统相同的事件，避免依赖 3D 瞄准
        enterZone: (zoneId: string) => {
          this.bus.emit('scene:enterZone', { sceneId: this.currentSceneId, zoneId });
        },
        interact: (targetId: string) => {
          this.bus.emit('scene:interact', { sceneId: this.currentSceneId, targetId });
        },
        /** 无头回归：读取场景演员世界位置（验证行走速度 / 位移） */
        getActorPosition: (name: string) => {
          const actor = this.actors[name];
          return actor ? [actor.position.x, actor.position.y, actor.position.z] : null;
        },
        /** 美术验收：天空跟随 / IBL / 接触阴影挂载情况（只读，不影响剧情） */
        getVisualDiagnostics: () => {
          const shadowActors: string[] = [];
          this.levelGroup.traverse((object) => {
            if (object.name === 'contact-shadow' && object.parent) {
              shadowActors.push(object.parent.name);
            }
          });
          const carryLinxia = this.actors.carryLinxia;
          const bloomEnvironment = this.actors.bloomEnvironment;
          const bloomUniforms = bloomEnvironment?.userData.colorBloomUniforms as ColorBloomUniforms | undefined;
          const bloomMaterials = new Set<THREE.Material>();
          let characterBloomCount = 0;
          this.levelGroup.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
              if (!material.userData.colorBloomUniforms) continue;
              bloomMaterials.add(material);
              let parent: THREE.Object3D | null = object;
              while (parent && !parent.userData.actorModelId) parent = parent.parent;
              if (parent) characterBloomCount += 1;
            }
          });
          const types = this.airParticles?.geometry.getAttribute('airType');
          const colors = this.airParticles?.geometry.getAttribute('color');
          const particleTypeDistribution = { dust: 0, petal: 0, leaf: 0 };
          if (types) {
            for (let index = 0; index < types.count; index += 1) {
              const type = types.getX(index);
              if (type === 0) particleTypeDistribution.dust += 1;
              else if (type === 1) particleTypeDistribution.petal += 1;
              else particleTypeDistribution.leaf += 1;
            }
          }
          return {
            sceneId: this.currentSceneId,
            sceneKey: this.currentDefinition.sceneKey,
            atmosphereProgress: this.atmosphereProgress,
            colorBloom: bloomUniforms ? {
              instanceId: bloomEnvironment.uuid,
              player: bloomUniforms.uPlayerPos.value.toArray(),
              companion: bloomUniforms.uCompanionPos.value.toArray(),
              revealedZ: bloomUniforms.uRevealedZ.value,
              time: bloomUniforms.uBloomTime.value,
              materials: Array.from(bloomMaterials, (material) => material.name),
              shared: Array.from(bloomMaterials).every((material) => material.userData.colorBloomUniforms === bloomUniforms),
              characterBloomCount,
            } : null,
            skyColors: {
              zenith: (this.skyMaterial.uniforms.uZenith.value as THREE.Color).getHexString(),
              mid: (this.skyMaterial.uniforms.uMid.value as THREE.Color).getHexString(),
              horizon: (this.skyMaterial.uniforms.uHorizon.value as THREE.Color).getHexString(),
              below: (this.skyMaterial.uniforms.uBelow.value as THREE.Color).getHexString(),
              cloud: (this.skyMaterial.uniforms.uCloud.value as THREE.Color).getHexString(),
              cloudHighlight: (this.skyMaterial.uniforms.uCloudHighlight.value as THREE.Color).getHexString(),
              sunHighlight: (this.skyMaterial.uniforms.uSunHighlight.value as THREE.Color).getHexString(),
            },
            sunColor: this.sun.color.getHexString(),
            sunIntensity: this.sun.intensity,
            fogColor: this.scene.fog?.color.getHexString() ?? null,
            particleColors: colors ? Array.from(colors.array) : [],
            shapeProgress: this.airParticleShape.value,
            particleTypeDistribution,
            skyCameraDelta: this.skyDome.position.distanceTo(this.camera.position),
            skyRadius: SKY_DOME_RADIUS,
            cameraFar: this.camera.far,
            skyFogDisabled: this.skyMaterial.fog === false,
            skyDepthWrite: this.skyMaterial.depthWrite,
            environment: this.scene.environment !== null,
            environmentIntensity: this.scene.environmentIntensity,
            toneMappingExposure: this.renderer.toneMappingExposure,
            postprocessing: this.composer !== null,
            bloomThreshold: this.bloomPass?.threshold ?? null,
            bloomStrength: this.bloomPass?.strength ?? null,
            bloomBuffer: this.bloomPass ? [this.bloomPass.renderTargetBright.width, this.bloomPass.renderTargetBright.height] : null,
            postprocessingPasses: this.composer?.passes.length ?? 0,
            airParticles: this.airParticles?.geometry.getAttribute('position').count ?? 0,
            renderCalls: this.renderer.info.render.calls,
            renderTriangles: this.renderer.info.render.triangles,
            shadowActors,
            carryLinxiaHasShadow: carryLinxia
              ? carryLinxia.getObjectByName('contact-shadow') !== undefined
              : false,
          };
        },
      };
    }

    this.setupPostprocessing();
    this.handleResize();
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('orientationchange', this.handleOrientationChange);

    this.lastFrameTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  /**
   * 初始场景挂载：房间（含 ?scene=S1–S3 直达）requiredModels 为空，同步建场；
   * 直达 S4/S5/S7/S8 等需要角色的场景，保持黑幕等待预载（≤8s），完成后再建场并淡入。
   */
  private mountInitialScene(): void {
    if (!isSceneModuleReady(this.currentSceneId)) {
      const sceneId = this.currentSceneId;
      const token = ++this.transitionToken;
      this.controller.setTransitionLocked(true);
      void prepareSceneModule(sceneId).then(() => {
        if (this.disposed || token !== this.transitionToken || this.currentSceneId !== sceneId) return;
        this.currentDefinition = getSceneDefinition(sceneId);
        this.mountInitialScene();
      });
      return;
    }
    const definition = this.currentDefinition;
    const ids = definition.requiredModels ?? [];
    if (ids.length === 0) {
      this.mountDefinition(definition, this.currentSceneId);
      this.controller.setTransitionLocked(false);
      this.tryInitialFade();
      return;
    }

    const token = ++this.transitionToken;
    this.controller.setTransitionLocked(true);
    void this.preloadRequiredModels(definition).then(() => {
      if (this.disposed || token !== this.transitionToken) return;
      this.mountDefinition(definition, this.currentSceneId);
      this.controller.setTransitionLocked(false);
      this.tryInitialFade();
    });
  }

  /** 预载场景声明的角色模型：单个失败只告警（后续回退胶囊体），总时长封顶，绝不卡死黑幕 */
  private async preloadRequiredModels(definition: WorldSceneDefinition): Promise<void> {
    const ids = definition.requiredModels ?? [];
    if (ids.length === 0) return;

    const loads = Promise.all(
      ids.map((id) =>
        loadCharacterModel(id).catch((error) => {
          console.warn(`[WorldApp] 角色模型预载失败，将回退胶囊体：${id}`, error);
          return null;
        }),
      ),
    ).then(() => undefined);

    let timer = 0;
    const timeout = new Promise<void>((resolve) => {
      timer = window.setTimeout(resolve, MODEL_PRELOAD_TIMEOUT_MS);
    });
    try {
      await Promise.race([loads, timeout]);
    } finally {
      if (timer !== 0) window.clearTimeout(timer);
    }
  }

  /** 建场 + 雾 + 调试线框 + 运行时装 + 站位策略（初始与切图共用） */
  private mountDefinition(definition: WorldSceneDefinition, sceneId: SceneId): void {
    this.currentDefinition = definition;
    this.buildDefinition(definition);
    this.applyFog(definition);
    this.debugOverlay?.setDefinition(definition);

    this.currentRuntime = getSceneRuntime(sceneId);
    this.currentRuntime?.enter(this.createRuntimeContext(sceneId));
    this.applyInteractionOptions();
    if (sceneId === 'S4') this.bus.emit('ui:showObjective', { sceneId });
    this.syncHudHints();
    this.initialMounted = true;

    this.resetMotionAudio();
    if (sceneId === 'S1') this.bus.emit('audio:alarm');

    // S4 挂载完成后静默预热 S5 主角与爸爸模型：不阻塞街段游玩，S5 黑幕预载必命中缓存
    if (sceneId === 'S4') {
      void preloadCharacterModels(['linxia', 'father']).catch(() => {
        // 预热失败不影响街段；S5 预载与 shared 异步补载仍会兜底
      });
    }
  }

  private scheduleInitialFade(): void {
    this.initialFadeTimer = window.setTimeout(() => {
      this.initialFadeTimer = 0;
      this.tryInitialFade();
    }, 50);
  }

  /** 首屏淡入只执行一次；黑幕已在过场播放或仍在切图时不介入 */
  private tryInitialFade(): void {
    if (this.initialFadeDone || this.disposed) return;
    if (!this.initialMounted) return;
    if (this.cutscenePlayer.isPlaying() || this.pendingDefinition !== null) return;
    this.initialFadeDone = true;
    gsap.to(this.fadeEl, { opacity: 0, duration: INITIAL_FADE_SEC, ease: 'power1.out' });
  }

  /** scene:transition：同 sceneKey 只换交互配置；异 key 黑幕淡出 → 重建 → 淡入 */
  private handleSceneTransition(payload: { toSceneId: SceneId; sceneKey: SceneKey; fromSceneId?: SceneId | null }): void {
    if (this.inConstructorEmit && payload.fromSceneId === null && payload.toSceneId === this.currentSceneId) {
      this.inConstructorEmit = false;
      return;
    }
    this.inConstructorEmit = false;
    this.runtimeContextToken += 1;
    this.resetMotionAudio();
    this.currentSceneId = payload.toSceneId;
    const token = ++this.transitionToken;
    this.pendingDefinition = null;
    this.pendingSceneId = null;
    gsap.killTweensOf(this.fadeEl);
    if (!isSceneModuleReady(payload.toSceneId)) {
      this.controller.setTransitionLocked(true);
      this.currentRuntime?.exit();
      void prepareSceneModule(payload.toSceneId).then(() => {
        if (this.disposed || token !== this.transitionToken || this.currentSceneId !== payload.toSceneId) return;
        this.handleSceneTransition(payload);
      });
      return;
    }
    const definition = getSceneDefinition(payload.toSceneId);

    if (definition.sceneKey === this.currentDefinition.sceneKey) {
      this.controller.setTransitionLocked(false);
      this.fadeEl.style.opacity = '0';
      if (payload.fromSceneId === null && definition.sceneKey === 'building') {
        this.currentRuntime?.exit();
        this.mountDefinition(definition, payload.toSceneId);
        return;
      }
      // 同 sceneKey（S1→S2→S3 / S5→S6 / S8→S9）：绝不销毁重建或重置站位，
      // 复用几何体与 occluders，仅更新交互配置与调试线框
      this.currentDefinition = definition;
      if (payload.fromSceneId === null) {
        this.atmosphereProgress = 0;
        this.applyFog(definition);
      }
      if (definition.sceneKey === 'interior') {
        this.controller.setNavigation(definition.nav);
        this.controller.setSpawn(definition.spawn);
        this.applyFog(definition);
      }
      this.applyInteraction(definition);
      this.debugOverlay?.setDefinition(definition);
      this.currentRuntime = getSceneRuntime(payload.toSceneId);
      // 共享 runtime 按 sceneId 自行判断是否重启演出（如 gate 只在 S5 播放）
      this.currentRuntime?.enter(this.createRuntimeContext(payload.toSceneId));
      this.applyInteractionOptions();
      this.syncHudHints();
      return;
    }

    if (payload.fromSceneId === null && (definition.requiredModels?.length ?? 0) === 0) {
      // 起床过场会接管黑幕，零模型新局必须先同步挂载，避免淡出回调被取消。
      this.transitionToken += 1;
      this.pendingDefinition = null;
      this.pendingSceneId = null;
      gsap.killTweensOf(this.fadeEl);
      this.currentRuntime?.exit();
      this.mountDefinition(definition, payload.toSceneId);
      this.fadeEl.style.opacity = '0';
      this.controller.setTransitionLocked(false);
      return;
    }

    // 异 sceneKey：黑幕过渡。transitionLocked 只锁输入，与 uiLock（controlsLocked）相互独立
    this.resetAtmosphere();
    this.controller.setTransitionLocked(true);
    this.pendingDefinition = definition;
    this.pendingSceneId = payload.toSceneId;
    gsap.killTweensOf(this.fadeEl);

    const opacity = parseFloat(window.getComputedStyle(this.fadeEl).opacity);
    if (Number.isFinite(opacity) && opacity >= 0.999) {
      // 已全黑（如 s3-run 结尾保持的黑幕）：立即重建，避免切图瞬间闪帧
      this.commitScene();
      return;
    }

    gsap.to(this.fadeEl, {
      opacity: 1,
      duration: FADE_OUT_SEC,
      ease: 'power1.in',
      onComplete: () => this.commitScene(),
    });
  }

  /** 黑幕全黑后：退出旧 runtime → 预载角色 → 重建关卡 → 进入新 runtime → 淡入 */
  private commitScene(): void {
    const definition = this.pendingDefinition;
    const sceneId = this.pendingSceneId;
    this.pendingDefinition = null;
    this.pendingSceneId = null;
    if (!definition || sceneId === null) return;

    // 离开旧场景：kill 时间轴 / 定时器 / 订阅（黑幕保持全黑，几何体等预载后再清理）
    this.currentRuntime?.exit();
    this.currentRuntime = null;

    // token 防止快速跳关串台：预载期间再发生切换时，本提交整体作废
    const token = ++this.transitionToken;
    void this.preloadRequiredModels(definition).then(() => {
      if (this.disposed || token !== this.transitionToken) return;

      this.mountDefinition(definition, sceneId);

      gsap.killTweensOf(this.fadeEl);
      gsap.to(this.fadeEl, {
        opacity: 0,
        duration: FADE_IN_SEC,
        ease: 'power1.out',
        // 只释放 transitionLocked，绝不调用 unlockControls（不覆盖 uiLock 的 2D 界面锁）
        onComplete: () => this.controller.setTransitionLocked(false),
      });
    });
  }

  private detectIntegratedGpu(): boolean {
    try {
      const gl = this.renderer.getContext();
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const gpuName = debugInfo
        ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? '')
        : String(gl.getParameter(gl.RENDERER) ?? '');
      return INTEGRATED_GPU_PATTERN.test(gpuName);
    } catch {
      return false;
    }
  }

  private setupPostprocessing(): void {
    if (this.pureTouch || window.matchMedia('(pointer: coarse)').matches) return;

    const samples = this.integratedGpu ? 0 : Math.min(2, this.renderer.capabilities.maxSamples);
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: true,
      samples,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.24, 0.32, 1.25);
    this.composer.addPass(this.bloomPass);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  private disposeAirParticles(): void {
    if (!this.airParticles) return;
    this.scene.remove(this.airParticles);
    this.airParticles.geometry.dispose();
    const material = this.airParticles.material as THREE.PointsMaterial;
    material.map?.dispose();
    material.dispose();
    this.airParticles = null;
    this.airParticleSpeeds = null;
  }

  private rebuildAirParticles(sceneKey: SceneKey): void {
    this.disposeAirParticles();
    if (!OUTDOOR_PARTICLE_SCENE_KEYS.has(sceneKey)) return;

    const count = 48;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const types = new Float32Array(count);
    this.airParticleSpeeds = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      positions[offset] = (Math.random() - 0.5) * 16;
      positions[offset + 1] = 0.35 + Math.random() * 4.5;
      positions[offset + 2] = (Math.random() - 0.5) * 18;
      const color = index % 7 === 0 ? DEFAULT_LEAF : DEFAULT_DUST;
      types[index] = index % 6 === 0 ? 2 : index % 6 === 3 ? 1 : 0;
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
      this.airParticleSpeeds[index] = 0.07 + Math.random() * 0.11;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前环境不支持 2D Canvas，无法生成粒子');
    const gradient = context.createRadialGradient(16, 16, 1, 16, 16, 15);
    gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.45)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 32, 32);
    const texture = new THREE.CanvasTexture(canvas);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('airType', new THREE.BufferAttribute(types, 1));
    const material = new THREE.PointsMaterial({
      map: texture,
      size: 0.055,
      transparent: true,
      opacity: 0.38,
      vertexColors: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uAirShape = this.airParticleShape;
      shader.uniforms.uAirTime = this.skyMaterial.uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float airType;
          uniform float uAirShape;
          uniform float uAirTime;
          varying float vAirType;
          varying float vAirAngle;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vAirType = airType;
          vAirAngle = position.x * 0.6 + airType * 1.37 + uAirTime * (0.5 + airType * 0.12);`)
        .replace('gl_PointSize = size;',
          'gl_PointSize = size * mix(1.0, airType > 0.5 ? 2.2 : 1.1, uAirShape);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uAirShape;
          varying float vAirType;
          varying float vAirAngle;`)
        .replace('#include <map_particle_fragment>', `
          float airOpacity = diffuseColor.a;
          #include <map_particle_fragment>
          if (vAirType > 0.5 && uAirShape > 0.0) {
            vec2 p = gl_PointCoord - 0.5;
            float c = cos(vAirAngle), s = sin(vAirAngle);
            vec2 q = mat2(c, -s, s, c) * p;
            float radius = vAirType > 1.5
              ? abs(q.x) / 0.25 + pow(abs(q.y) / 0.46, 1.5)
              : length(vec2(q.x / (0.22 + q.y * 0.16), (q.y + 0.02) / 0.43));
            float mask = 1.0 - smoothstep(0.84, 1.0, radius);
            diffuseColor.a = mix(diffuseColor.a, airOpacity * mask * 0.72, uAirShape);
            if (vAirType > 1.5) diffuseColor.rgb *=
              1.0 - uAirShape * 0.16 * (1.0 - smoothstep(0.007, 0.025, abs(q.x)));
          }`);
    };
    material.customProgramCacheKey = () => 'morning-air-shapes-v1';
    this.airParticles = new THREE.Points(geometry, material);
    this.airParticles.name = 'morning-air-particles';
    this.airParticles.frustumCulled = false;
    this.airParticles.raycast = () => {};
    this.scene.add(this.airParticles);
  }

  private updateAirParticles(dt: number): void {
    if (!this.airParticles || !this.airParticleSpeeds) return;
    const attribute = this.airParticles.geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = attribute.array as Float32Array;
    const types = this.airParticles.geometry.getAttribute('airType');
    const time = this.skyMaterial.uniforms.uTime.value as number;
    for (let index = 0; index < this.airParticleSpeeds.length; index += 1) {
      const offset = index * 3;
      positions[offset] += Math.sin(index * 1.7 + positions[offset + 1]) * dt * 0.025;
      if (this.airParticleShape.value > 0 && types.getX(index) > 0) {
        const flutter = this.airParticleShape.value * dt * 0.12;
        positions[offset] += Math.sin(time * 1.4 + index) * flutter;
        positions[offset + 2] += Math.cos(time * 1.1 + index) * flutter;
      }
      positions[offset + 1] -= this.airParticleSpeeds[index] * dt;
      if (positions[offset + 1] < 0.22) positions[offset + 1] = 4.85;
    }
    attribute.needsUpdate = true;
    this.airParticles.position.set(this.camera.position.x, 0, this.camera.position.z);
  }

  /** 全量装载：清理旧关卡几何 → build 新场景 → 重置导航与站位 → 更新交互配置 */
  private buildDefinition(definition: WorldSceneDefinition): void {
    this.runtimeContextToken += 1;
    this.resetAtmosphere();
    disposeObjectTree(this.levelGroup);
    this.rebuildAirParticles(definition.sceneKey);
    const built = definition.build(this.levelGroup);
    this.builtOccluders = built.occluders;
    this.actors = built.actors ?? {};
    this.attachContactShadows();

    this.controller.setNavigation(definition.nav);
    this.controller.setSpawn(definition.spawn);
    this.applyInteraction(definition);
  }

  /** 交互配置装载：occluders 复用当前关卡（同 key 切换时几何体未重建） */
  private applyInteraction(definition: WorldSceneDefinition): void {
    this.interaction.setup({
      interactables: definition.interactables,
      hotspots: definition.hotspots,
      zones: definition.zones,
      targetGuides: definition.targetGuides,
      occluders: this.builtOccluders,
    });
  }

  private applyInteractionOptions(): void {
    const options = this.interactionOptions;
    if (!options || options.sceneId !== this.currentSceneId) return;
    for (const item of this.currentDefinition.interactables ?? []) {
      this.interaction.setItemVisible(item.id, options.ids.includes(item.id));
    }
  }

  /** 切换 sceneKey 时更新雾；无 fog 的场景清除上一场景残留 */
  private applyFog(definition: WorldSceneDefinition): void {
    this.baseHaze.setHex(definition.fog?.color ?? DEFAULT_HAZE_COLOR).lerp(HAZE_TINT, 0.36);
    this.scene.fog = definition.fog
      ? new THREE.Fog(this.baseHaze, definition.fog.near, definition.fog.far)
      : null;
    this.applyAtmosphere();
  }

  /** 天空球地平线以下与雾色衔接：暖橘金只在地平线附近混入，避免与地面尽头出现硬切线 */
  private updateSkyHaze(haze: THREE.Color, horizon = DEFAULT_ATMOSPHERE.uHorizon): void {
    (this.skyMaterial.uniforms.uBelow.value as THREE.Color).copy(haze);
    (this.skyMaterial.uniforms.uHorizon.value as THREE.Color).copy(haze).lerp(horizon, 0.62);
  }

  private setAtmosphereProgress(progress: number): void {
    if (this.currentDefinition.sceneKey !== 'building' || !Number.isFinite(progress)) return;
    const next = Math.max(0, Math.min(1, progress));
    if (next === this.atmosphereProgress) return;
    this.atmosphereProgress = next;
    this.applyAtmosphere();
  }

  private resetAtmosphere(): void {
    this.atmosphereProgress = 0;
    this.applyAtmosphere(false);
  }

  private applyAtmosphere(building = this.currentDefinition.sceneKey === 'building'): void {
    const blend = smoothAtmosphereProgress(this.atmosphereProgress);
    for (const key of SKY_COLOR_UNIFORMS) {
      const color = this.skyMaterial.uniforms[key].value as THREE.Color;
      if (building) color.lerpColors(COOL_ATMOSPHERE[key], DAWN_ATMOSPHERE[key], blend);
      else color.copy(DEFAULT_ATMOSPHERE[key]);
    }
    this.atmosphereHaze.copy(this.baseHaze);
    this.atmosphereHorizon.copy(DEFAULT_ATMOSPHERE.uHorizon);
    this.sun.color.copy(DEFAULT_ATMOSPHERE.sun);
    if (building) {
      this.atmosphereHaze.lerpColors(COOL_ATMOSPHERE.fog, DAWN_ATMOSPHERE.fog, blend);
      this.atmosphereHorizon.lerpColors(COOL_ATMOSPHERE.uHorizon, DAWN_ATMOSPHERE.uHorizon, blend);
      this.sun.color.lerpColors(COOL_ATMOSPHERE.sun, DAWN_ATMOSPHERE.sun, blend);
    }
    this.scene.fog?.color.copy(this.atmosphereHaze);
    this.updateSkyHaze(this.atmosphereHaze, this.atmosphereHorizon);
    this.airParticleShape.value = building ? smoothAtmosphereProgress((this.atmosphereProgress - 0.5) * 2) : 0;
    if (!this.airParticles) return;
    const colors = this.airParticles.geometry.getAttribute('color') as THREE.BufferAttribute;
    const types = this.airParticles.geometry.getAttribute('airType');
    for (let index = 0; index < colors.count; index += 1) {
      this.particleColor.copy(index % 7 === 0 ? DEFAULT_LEAF : DEFAULT_DUST)
        .lerp(DAWN_PARTICLE_COLORS[types.getX(index)], this.airParticleShape.value);
      colors.setXYZ(index, this.particleColor.r, this.particleColor.g, this.particleColor.b);
    }
    colors.needsUpdate = true;
  }

  /**
   * 初始化时一次性烘焙 IBL 环境贴图（严禁每帧调用）：
   * 临时天空场景与主天空球共享几何 / 材质，烘焙后只释放 PMREMGenerator 内部资源；
   * fromScene() 返回的 WebGLCubeRenderTarget 归调用方所有，保留到 dispose() 才释放。
   */
  private bakeEnvironment(): void {
    const skyScene = new THREE.Scene();
    const bakeMesh = new THREE.Mesh(this.skyDome.geometry, this.skyMaterial);
    skyScene.add(bakeMesh);

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.envRenderTarget = pmremGenerator.fromScene(skyScene, 0.03, 0.1, 120, { size: 256 });
    this.scene.environment = this.envRenderTarget.texture;
    // 柔和冷青天光：保留湿地反射，同时避免白墙与人物高光洗白
    this.scene.environmentIntensity = 0.42;

    pmremGenerator.dispose();
    skyScene.remove(bakeMesh);
  }

  /** 建场后为贴地角色挂共享接触阴影；carryLinxia 等悬空子角色由 isGroundedActor 排除 */
  private attachContactShadows(): void {
    const grounded: THREE.Object3D[] = [];
    this.levelGroup.traverse((object) => {
      if (!object.userData.actorModelId) return;
      const position = object.getWorldPosition(this.scratchWorldPos);
      const groundY = sampleGroundHeight(position, this.currentDefinition.nav.surfaces, this.currentDefinition.nav.groundY);
      if (isGroundedActor(object, groundY)) grounded.push(object);
    });
    for (const actor of grounded) {
      if (actor.getObjectByName('contact-shadow')) continue;
      actor.add(createContactShadowDisc());
    }
  }

  private createRuntimeContext(sceneId: SceneId): SceneRuntimeContext {
    const token = this.runtimeContextToken;
    const level = this.actors;
    return {
      sceneId,
      storyFlags: this.storyFlags,
      bus: this.bus,
      actors: level,
      setInteractableVisible: (id, visible) => this.interaction.setItemVisible(id, visible),
      isModalBlocked: () => this.modalBlocked,
      getPlayerFeet: (target) => {
        const feet = this.controller.getFeetPosition();
        return target.set(feet.x, feet.y, feet.z);
      },
      setAtmosphereProgress: (progress) => {
        if (this.disposed || token !== this.runtimeContextToken || level !== this.actors
          || this.pendingSceneId !== null) return;
        this.setAtmosphereProgress(progress);
      },
    };
  }

  /** 低角度暖金晨阳 + 冷青蓝环境补光，拉长楼影并保留阴影层次 */
  private buildLights(): void {
    const hemisphere = new THREE.HemisphereLight(0xa9cada, 0x586e68, 0.46);
    this.scene.add(hemisphere);

    const sun = this.sun;
    sun.position.copy(SUN_DIRECTION).multiplyScalar(16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 40;
    // 收紧平行光阴影投影包围盒至核心活动视区（±11.5m），提高阴影像素利用率并减少边缘开销
    sun.shadow.camera.left = -11.5;
    sun.shadow.camera.right = 11.5;
    sun.shadow.camera.top = 11.5;
    sun.shadow.camera.bottom = -11.5;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 3;
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  /** 竖屏时按“保持水平视野”反推垂直 FOV 并设上限，横屏固定 62° */
  private updateCameraProjection(width: number, height: number): void {
    const aspect = width / Math.max(height, 1);
    this.camera.aspect = aspect;

    if (aspect < 1) {
      const landscapeHalfFov = THREE.MathUtils.degToRad(LANDSCAPE_FOV / 2);
      const referenceHorizontalFov = 2 * Math.atan(Math.tan(landscapeHalfFov) * REFERENCE_ASPECT);
      const portraitFov = THREE.MathUtils.radToDeg(
        2 * Math.atan(Math.tan(referenceHorizontalFov / 2) / aspect),
      );
      this.camera.fov = Math.min(portraitFov, PORTRAIT_MAX_FOV);
    } else {
      this.camera.fov = LANDSCAPE_FOV;
    }

    // 记录当前默认响应视野，供全景 CG 结束 / 打断时恢复
    this.baseFov = this.camera.fov;
    this.camera.updateProjectionMatrix();
  }

  private readonly handleResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.composer?.setSize(width, height);
    const ratio = this.renderer.getPixelRatio();
    this.bloomPass?.setSize(Math.round(width * ratio * 0.5), Math.round(height * ratio * 0.5));
    this.updateCameraProjection(width, height);
  };

  /** 横竖屏切换后视口尺寸更新可能滞后，延迟再校正一次 */
  private readonly handleOrientationChange = (): void => {
    this.handleResize();
    if (this.orientationResizeTimer !== 0) window.clearTimeout(this.orientationResizeTimer);
    this.orientationResizeTimer = window.setTimeout(() => {
      this.orientationResizeTimer = 0;
      this.handleResize();
    }, 150);
  };

  private handlePointerLockChange(locked: boolean): void {
    if (locked) {
      this.hud.hideReleaseHint();
    } else if (this.controller.isEnabled()) {
      // lockControls() / 过场 / 切图主动退出时不提示；只有玩家按 ESC 等外部行为才提示
      this.hud.showReleaseHint();
    }
    this.syncHudHints();
  }

  /** HUD 提示同步：仅桌面自由控制态显示锁鼠引导与疾跑角标 */
  private syncHudHints(): void {
    const desktopFree = !this.pureTouch && this.controller.isEnabled();
    this.hud.setLockPromptVisible(desktopFree && !this.controller.isPointerLocked());
    this.hud.setSprintHintVisible(desktopFree && this.controller.isSprintToggled());
  }

  private readonly tick = (): void => {
    this.rafId = requestAnimationFrame(this.tick);

    const now = performance.now();
    const dt = Math.max(0, Math.min((now - this.lastFrameTime) / 1000, 0.05));
    this.lastFrameTime = now;

    this.controller.update(dt);
    this.interaction.update(dt, now);
    this.currentRuntime?.tick?.(dt);
    this.updateMotionAudio(dt);
    this.skyDome.position.copy(this.camera.position);
    this.skyMaterial.uniforms.uTime.value += dt;
    this.updateAirParticles(dt);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  };

  private resetMotionAudio(): void {
    this.motionPositions.clear();
    this.bus.emit('audio:reset');
  }

  private updateMotionAudio(dt: number): void {
    const surface = this.currentDefinition.footstepSurface ?? 'stone';
    const sample = (sourceId: string, position: THREE.Vector3, allow: boolean, gain: number): void => {
      const previous = this.motionPositions.get(sourceId);
      const distance = previous ? Math.hypot(position.x - previous.x, position.z - previous.z) : 0;
      if (previous) previous.copy(position);
      else this.motionPositions.set(sourceId, position.clone());
      this.bus.emit('audio:motion', {
        sourceId, distance, gain, surface,
        allow: allow && distance <= dt * 12 && this.initialMounted && this.pendingSceneId === null,
      });
    };
    sample('player', this.camera.position,
      this.controller.isEnabled() || (this.currentSceneId === 'S3' && this.cutscenePlayer.isPlaying()), 0.5);
    for (const id of this.currentDefinition.footstepActors ?? []) {
      const actor = this.actors[id];
      if (!actor) continue;
      let visible = true;
      let ancestor: THREE.Object3D | null = actor;
      while (ancestor) {
        visible = visible && ancestor.visible;
        ancestor = ancestor.parent;
      }
      const position = actor.getWorldPosition(this.scratchWorldPos);
      const distance = position.distanceTo(this.camera.position);
      const gain = 0.3 * Math.max(0, 1 - distance / 8) ** 2;
      sample(id, position, visible && gain > 0, gain);
    }
  }

  /** 供 2D 阻塞式界面调用：锁定输入并主动退出 PointerLock */
  lockControls(): void {
    this.modalBlocked = true;
    this.controller.lockControls();
  }

  unlockControls(): void {
    this.modalBlocked = false;
    this.controller.unlockControls();
  }

  /** 释放渲染资源（进入降级模式或销毁场景时调用） */
  dispose(): void {
    this.disposed = true;
    this.resetMotionAudio();
    this.transitionToken += 1;
    cancelAnimationFrame(this.rafId);
    if (this.initialFadeTimer !== 0) window.clearTimeout(this.initialFadeTimer);
    if (this.orientationResizeTimer !== 0) window.clearTimeout(this.orientationResizeTimer);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('orientationchange', this.handleOrientationChange);
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;

    gsap.killTweensOf(this.fadeEl);

    this.currentRuntime?.exit();
    this.currentRuntime = null;
    this.cutscenePlayer.dispose();
    this.controller.dispose();
    this.interaction.dispose();
    this.hud.dispose();
    this.debugOverlay?.dispose();

    disposeObjectTree(this.levelGroup);
    this.scene.remove(this.levelGroup);
    this.disposeAirParticles();

    this.bloomPass?.dispose();
    this.outputPass?.dispose();
    this.composer?.dispose();
    this.bloomPass = null;
    this.outputPass = null;
    this.composer = null;

    // 天空球不挂在 levelGroup 下，单独释放；环境贴图 RenderTarget 到此刻才允许销毁
    this.scene.environment = null;
    this.envRenderTarget?.dispose();
    this.envRenderTarget = null;
    this.skyDome.geometry.dispose();
    this.skyMaterial.dispose();
    this.scene.remove(this.skyDome);
    disposeMaterialCache();

    this.fadeEl.remove();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

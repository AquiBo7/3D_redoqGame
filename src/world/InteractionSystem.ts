// world/InteractionSystem.ts —— 交互光点、注视热点、触发区与目标指引
// 只通过 core 事件总线通知剧情层（scene:interact / scene:gazeHotspot / scene:enterZone）。

import * as THREE from 'three';
import type { EventBus } from '../core/eventBus';
import type { SceneId } from '../data/storySchema';
import { angleBetweenDeg, GazeDwellTracker } from './gazeTracker';
import type { GazeUpdateResult } from './gazeTracker';
import { INTERACTION_CONFIG } from './worldConfig';
import type { InteractionConfig } from './worldConfig';
import { isPointInZone } from './navMath';
import type { Vec2, ZoneShape } from './navMath';
import { computeGuidePlacement } from './screenMath';
import type {
  HotspotConfig,
  InteractableConfig,
  TargetGuideConfig,
  ZoneConfig,
} from './worldSceneTypes';

export interface TargetMarkerState {
  id: string;
  x: number;
  y: number;
  clamped: boolean;
  angleRad: number;
}

/** InteractionSystem 只负责把状态推给 HUD，不直接操作 DOM */
export interface InteractionHudBridge {
  setAimed(aimed: boolean): void;
  setGazeProgress(progress: number | null): void;
  setTargets(markers: TargetMarkerState[]): void;
}

export interface InteractionSetupInput {
  interactables?: InteractableConfig[];
  hotspots?: HotspotConfig[];
  zones?: ZoneConfig[];
  targetGuides?: TargetGuideConfig[];
  occluders: THREE.Object3D[];
}

export interface InteractionSystemOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  bus: EventBus;
  hud: InteractionHudBridge;
  getSceneId: () => SceneId;
  /** 与 controller.isEnabled() 联动；为 false 时暂停瞄准、注视与交互 */
  isInputEnabled: () => boolean;
  config?: InteractionConfig;
  debug?: boolean;
}

interface InteractableItem {
  config: InteractableConfig;
  anchor: THREE.Vector3;
  maxDistance: number;
  sprite: THREE.Sprite;
  spriteMaterial: THREE.SpriteMaterial;
  hitMesh: THREE.Mesh;
  baseScale: number;
  phase: number;
  occluded: boolean;
  /** 由场景 Runtime 手动隐藏（如捡起药袋后） */
  hidden: boolean;
  nextOcclusionCheck: number;
}

interface HotspotState {
  config: HotspotConfig;
  position: THREE.Vector3;
  maxDistance: number;
  maxAngleDeg: number;
  dwellMs: number;
  requireLineOfSight: boolean;
  fired: boolean;
  tracker: GazeDwellTracker;
}

interface ZoneState {
  config: ZoneConfig;
  shape: ZoneShape;
  once: boolean;
  firedOnce: boolean;
  wasInside: boolean;
}

interface TargetState {
  config: TargetGuideConfig;
  position: THREE.Vector3;
}

function createGlowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');

  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255, 246, 218, 1)');
    gradient.addColorStop(0.35, 'rgba(255, 236, 190, 0.85)');
    gradient.addColorStop(1, 'rgba(255, 236, 190, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class InteractionSystem {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private readonly bus: EventBus;
  private readonly hud: InteractionHudBridge;
  private readonly getSceneId: () => SceneId;
  private readonly isInputEnabled: () => boolean;
  private readonly config: InteractionConfig;
  private readonly debug: boolean;

  private readonly group = new THREE.Group();
  private readonly glowTexture: THREE.CanvasTexture;
  private readonly hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
  private readonly itemById = new Map<string, InteractableItem>();
  private readonly hitMeshes: THREE.Mesh[] = [];
  private items: InteractableItem[] = [];
  private hotspots: HotspotState[] = [];
  private zones: ZoneState[] = [];
  private targets: TargetState[] = [];
  private occluders: THREE.Object3D[] = [];

  private readonly aimRaycaster = new THREE.Raycaster();
  private readonly occlusionRaycaster = new THREE.Raycaster();
  private readonly centerNdc = new THREE.Vector2(0, 0);
  private readonly cameraForward = new THREE.Vector3();
  private readonly cameraSpace = new THREE.Vector3();
  private readonly scratchPosition = new THREE.Vector3();
  private readonly scratchDirection = new THREE.Vector3();

  private aimedItem: InteractableItem | null = null;
  private gazeAimedId: string | null = null;
  private elapsed = 0;
  private lastInteractAt = Number.NEGATIVE_INFINITY;

  constructor(options: InteractionSystemOptions) {
    this.scene = options.scene;
    this.camera = options.camera;
    this.domElement = options.domElement;
    this.bus = options.bus;
    this.hud = options.hud;
    this.getSceneId = options.getSceneId;
    this.isInputEnabled = options.isInputEnabled;
    this.config = options.config ?? INTERACTION_CONFIG;
    this.debug = options.debug ?? false;

    this.glowTexture = createGlowTexture();
    this.group.name = 'interaction-group';
    this.scene.add(this.group);

    window.addEventListener('keydown', this.handleKeyDown);
  }

  setup(input: InteractionSetupInput): void {
    this.clear();

    this.occluders = input.occluders;

    const interactables = input.interactables ?? [];
    interactables.forEach((config, index) => {
      const anchor = new THREE.Vector3(
        config.position.x,
        config.position.y + (config.lightOffsetY ?? 0.55),
        config.position.z,
      );

      const spriteMaterial = new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0xfff2cc,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.position.copy(anchor);
      sprite.scale.setScalar(0.24);
      sprite.renderOrder = 3;

      const hitMesh = new THREE.Mesh(
        new THREE.SphereGeometry(config.hitRadius ?? 0.35, 12, 8),
        this.hitMaterial,
      );
      hitMesh.position.copy(anchor);
      hitMesh.userData.interactableId = config.id;

      this.group.add(sprite, hitMesh);

      const item: InteractableItem = {
        config,
        anchor,
        maxDistance: config.maxDistance ?? this.config.clickMaxDistance,
        sprite,
        spriteMaterial,
        hitMesh,
        baseScale: 0.24,
        phase: index * 1.7,
        occluded: false,
        hidden: false,
        nextOcclusionCheck: 0,
      };

      this.items.push(item);
      this.hitMeshes.push(hitMesh);
      this.itemById.set(config.id, item);
    });

    for (const config of input.hotspots ?? []) {
      const dwellMs = config.dwellMs ?? this.config.gazeDwellMs;
      this.hotspots.push({
        config,
        position: new THREE.Vector3(config.position.x, config.position.y, config.position.z),
        maxDistance: config.maxDistance ?? this.config.gazeMaxDistance,
        maxAngleDeg: config.maxAngleDeg ?? this.config.gazeMaxAngleDeg,
        dwellMs,
        requireLineOfSight: config.requireLineOfSight ?? true,
        fired: false,
        tracker: new GazeDwellTracker(dwellMs),
      });
    }

    const playerPosition: Vec2 = { x: this.camera.position.x, z: this.camera.position.z };
    for (const config of input.zones ?? []) {
      const shape = this.createZoneShape(config);
      this.zones.push({
        config,
        shape,
        once: config.once ?? true,
        firedOnce: false,
        wasInside: isPointInZone(playerPosition, shape),
      });
    }

    for (const config of input.targetGuides ?? []) {
      this.targets.push({
        config,
        position: new THREE.Vector3(config.position.x, config.position.y, config.position.z),
      });
    }
  }

  private createZoneShape(config: ZoneConfig): ZoneShape {
    if (config.kind === 'circle') {
      return {
        kind: 'circle',
        centerX: config.center.x,
        centerZ: config.center.z,
        radius: config.radius,
      };
    }
    return {
      kind: 'box',
      centerX: config.center.x,
      centerZ: config.center.z,
      halfX: config.size.x / 2,
      halfZ: config.size.z / 2,
    };
  }

  update(dt: number, nowMs: number): void {
    this.elapsed += dt;

    this.updateInteractableVisuals();
    this.updateAim();

    if (this.isInputEnabled()) {
      this.updateGaze(nowMs);
    } else {
      this.resetGaze();
    }

    this.updateZones();
    this.updateTargets();
  }

  private updateInteractableVisuals(): void {
    const time = this.elapsed;
    for (const item of this.items) {
      if (time >= item.nextOcclusionCheck) {
        item.occluded = this.isOccluded(item.anchor);
        item.nextOcclusionCheck = time + this.config.occlusionIntervalSec;
      }

      if (item.occluded || item.hidden) {
        item.sprite.visible = false;
        continue;
      }

      item.sprite.visible = true;
      const breathe = Math.sin(time * 1.8 + item.phase);
      item.sprite.scale.setScalar(item.baseScale * (1 + breathe * 0.12));
      item.spriteMaterial.opacity = 0.72 + breathe * 0.18;
    }
  }

  private updateAim(): void {
    let next: InteractableItem | null = null;

    if (this.isInputEnabled()) {
      this.aimRaycaster.setFromCamera(this.centerNdc, this.camera);
      const hits = this.aimRaycaster.intersectObjects(this.hitMeshes, false);

      for (const hit of hits) {
        const id = (hit.object.userData as { interactableId?: string }).interactableId;
        if (!id) continue;
        const item = this.itemById.get(id);
        if (!item || item.occluded || item.hidden) continue;
        if (hit.distance > item.maxDistance) continue;
        next = item;
        break;
      }
    }

    if (next !== this.aimedItem) {
      this.aimedItem = next;
      this.hud.setAimed(next !== null);
    }
  }

  private updateGaze(nowMs: number): void {
    this.camera.getWorldDirection(this.cameraForward);

    let best: HotspotState | null = null;
    let bestAngle = Number.POSITIVE_INFINITY;
    const cameraPosition = this.camera.position;

    for (const hotspot of this.hotspots) {
      if (hotspot.fired) continue;

      this.scratchDirection.copy(hotspot.position).sub(cameraPosition);
      const distance = this.scratchDirection.length();
      if (distance <= 0.01 || distance > hotspot.maxDistance) continue;

      this.scratchDirection.divideScalar(distance);
      const angle = angleBetweenDeg(this.cameraForward, this.scratchDirection);
      if (angle > hotspot.maxAngleDeg) continue;

      if (
        hotspot.requireLineOfSight &&
        this.isBlocked(cameraPosition, hotspot.position, 0.15)
      ) {
        continue;
      }

      if (angle < bestAngle) {
        bestAngle = angle;
        best = hotspot;
      }
    }

    if (!best) {
      this.resetGaze();
      return;
    }

    if (this.gazeAimedId !== best.config.id) {
      if (this.gazeAimedId) {
        const previous = this.findHotspot(this.gazeAimedId);
        previous?.tracker.reset();
      }
      this.gazeAimedId = best.config.id;
    }

    const result: GazeUpdateResult = best.tracker.update(best.config.id, nowMs);

    if (result.completed) {
      best.fired = true;
      this.emitGaze(best);
      this.gazeAimedId = null;
      this.hud.setGazeProgress(null);
      return;
    }

    this.hud.setGazeProgress(result.progress);
  }

  private resetGaze(): void {
    if (this.gazeAimedId) {
      const hotspot = this.findHotspot(this.gazeAimedId);
      hotspot?.tracker.reset();
    }
    this.gazeAimedId = null;
    this.hud.setGazeProgress(null);
  }

  private findHotspot(id: string): HotspotState | undefined {
    for (const hotspot of this.hotspots) {
      if (hotspot.config.id === id) return hotspot;
    }
    return undefined;
  }

  private updateZones(): void {
    const position: Vec2 = { x: this.camera.position.x, z: this.camera.position.z };

    for (const zone of this.zones) {
      const inside = isPointInZone(position, zone.shape);
      if (inside && !zone.wasInside) {
        if (!(zone.once && zone.firedOnce)) {
          this.emitZone(zone.config);
          if (zone.once) zone.firedOnce = true;
        }
      }
      zone.wasInside = inside;
    }
  }

  private updateTargets(): void {
    if (this.targets.length === 0) {
      this.hud.setTargets([]);
      return;
    }

    this.camera.updateMatrixWorld();
    const width = window.innerWidth;
    const height = window.innerHeight;
    const markers: TargetMarkerState[] = [];

    for (const target of this.targets) {
      this.cameraSpace.copy(target.position).applyMatrix4(this.camera.matrixWorldInverse);
      this.scratchPosition.copy(target.position).project(this.camera);

      const screenX = (this.scratchPosition.x * 0.5 + 0.5) * width;
      const screenY = (-this.scratchPosition.y * 0.5 + 0.5) * height;
      const behind = this.cameraSpace.z >= -0.01;

      const directionX = behind ? this.cameraSpace.x : screenX - width / 2;
      const directionY = behind ? -this.cameraSpace.y : screenY - height / 2;

      const placement = computeGuidePlacement({
        screenX,
        screenY,
        behind,
        directionX,
        directionY,
        width,
        height,
      });

      markers.push({
        id: target.config.id,
        x: placement.x,
        y: placement.y,
        clamped: placement.clamped,
        angleRad: placement.angleRad,
      });
    }

    this.hud.setTargets(markers);
  }

  /** 单击 / 轻点光点：受每个可交互物的 maxDistance 限制 */
  tryTapInteract(clientX: number, clientY: number): boolean {
    if (!this.isInputEnabled()) return false;

    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.aimRaycaster.setFromCamera(ndc, this.camera);

    const hits = this.aimRaycaster.intersectObjects(this.hitMeshes, false);
    for (const hit of hits) {
      const id = (hit.object.userData as { interactableId?: string }).interactableId;
      if (!id) continue;
      const item = this.itemById.get(id);
      if (!item || item.occluded || item.hidden) continue;
      if (hit.distance > item.maxDistance) continue;
      if (this.isBlocked(this.camera.position, item.anchor, 0.1)) continue;
      return this.emitInteract(item.config.id);
    }

    return false;
  }

  /** PointerLock 状态下按左键：只交互准星瞄准且距离达标的目标 */
  handlePrimaryClick(): boolean {
    if (!this.isInputEnabled() || !this.aimedItem) return false;
    const distance = this.camera.position.distanceTo(this.aimedItem.anchor);
    if (distance > this.aimedItem.maxDistance) return false;
    return this.emitInteract(this.aimedItem.config.id);
  }

  /** E 键：优先准星目标，否则 1.8 米内最近的光点 */
  tryInteractNearby(): boolean {
    if (!this.isInputEnabled()) return false;

    if (this.aimedItem) {
      const aimedDistance = this.camera.position.distanceTo(this.aimedItem.anchor);
      if (aimedDistance <= this.aimedItem.maxDistance) {
        return this.emitInteract(this.aimedItem.config.id);
      }
    }

    let nearest: InteractableItem | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const item of this.items) {
      if (item.occluded || item.hidden) continue;
      const distance = this.camera.position.distanceTo(item.anchor);
      if (distance <= this.config.nearRange && distance < nearestDistance) {
        nearest = item;
        nearestDistance = distance;
      }
    }

    if (!nearest) return false;
    return this.emitInteract(nearest.config.id);
  }

  private emitInteract(targetId: string): boolean {
    const now = performance.now();
    if (now - this.lastInteractAt < this.config.interactCooldownMs) return false;
    this.lastInteractAt = now;

    const sceneId = this.getSceneId();
    this.bus.emit('scene:interact', { sceneId, targetId });
    if (this.debug) console.info('[world] scene:interact', sceneId, targetId);
    return true;
  }

  private emitGaze(hotspot: HotspotState): void {
    const sceneId = this.getSceneId();
    this.bus.emit('scene:gazeHotspot', {
      sceneId,
      hotspotId: hotspot.config.id,
      dwellMs: hotspot.dwellMs,
    });
    if (this.debug) {
      console.info('[world] scene:gazeHotspot', sceneId, hotspot.config.id, `${hotspot.dwellMs}ms`);
    }
  }

  private emitZone(zone: ZoneConfig): void {
    const sceneId = this.getSceneId();
    this.bus.emit('scene:enterZone', { sceneId, zoneId: zone.id });
    if (this.debug) console.info('[world] scene:enterZone', sceneId, zone.id);
  }

  private isOccluded(anchor: THREE.Vector3): boolean {
    const cameraPosition = this.camera.position;
    this.scratchDirection.copy(anchor).sub(cameraPosition);
    const distance = this.scratchDirection.length();
    if (distance <= 0.05) return false;

    this.scratchDirection.divideScalar(distance);
    this.occlusionRaycaster.set(cameraPosition, this.scratchDirection);
    this.occlusionRaycaster.far = Math.max(0, distance - 0.08);
    return this.occlusionRaycaster.intersectObjects(this.occluders, true).length > 0;
  }

  private isBlocked(from: THREE.Vector3, to: THREE.Vector3, skipDistance: number): boolean {
    this.scratchDirection.copy(to).sub(from);
    const distance = this.scratchDirection.length();
    if (distance <= skipDistance + 0.01) return false;

    this.scratchDirection.divideScalar(distance);
    this.occlusionRaycaster.set(from, this.scratchDirection);
    this.occlusionRaycaster.far = Math.max(0.01, distance - skipDistance);
    return this.occlusionRaycaster.intersectObjects(this.occluders, true).length > 0;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'KeyE' || event.repeat) return;
    if (!this.isInputEnabled()) return;

    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

    this.tryInteractNearby();
  };

  /** 供场景 Runtime 显式隐藏/恢复某交互物（如捡起药袋后隐藏光点与命中体） */
  setItemVisible(id: string, visible: boolean): void {
    const item = this.itemById.get(id);
    if (!item || item.hidden === !visible) return;
    item.hidden = !visible;
    item.hitMesh.visible = visible;
    item.sprite.visible = visible && !item.occluded;
    if (item.hidden && this.aimedItem === item) {
      this.aimedItem = null;
      this.hud.setAimed(false);
    }
  }

  clear(): void {
    for (const item of this.items) {
      this.group.remove(item.sprite);
      this.group.remove(item.hitMesh);
      item.spriteMaterial.dispose();
      item.hitMesh.geometry.dispose();
    }

    this.items = [];
    this.hitMeshes.length = 0;
    this.itemById.clear();
    this.hotspots = [];
    this.zones = [];
    this.targets = [];
    this.occluders = [];
    this.aimedItem = null;
    this.gazeAimedId = null;
    this.elapsed = 0;
    this.lastInteractAt = Number.NEGATIVE_INFINITY;

    this.hud.setAimed(false);
    this.hud.setGazeProgress(null);
    this.hud.setTargets([]);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    this.clear();
    this.scene.remove(this.group);
    this.glowTexture.dispose();
    this.hitMaterial.dispose();
  }
}

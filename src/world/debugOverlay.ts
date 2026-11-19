// world/debugOverlay.ts —— ?debug=1 时的可行走边界、障碍物、触发区与热点范围线框
// 仅用于开发调试，不参与碰撞和交互判定。

import * as THREE from 'three';
import { normalizeBounds } from './navMath';
import type { RectBounds } from './navMath';
import { INTERACTION_CONFIG } from './worldConfig';
import type { WorldSceneDefinition } from './worldSceneTypes';

const COLOR_BOUNDS = 0x7fd1ff;
const COLOR_OBSTACLE = 0xaab4be;
const COLOR_ZONE = 0x8be09a;
const COLOR_HOTSPOT = 0xffd9a8;

export class DebugOverlay {
  private readonly scene: THREE.Scene;
  private readonly group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group.name = 'debug-overlay';
    this.scene.add(this.group);
  }

  setDefinition(definition: WorldSceneDefinition): void {
    this.clearGroup();

    const groundY = definition.nav.groundY ?? 0;

    for (const rect of normalizeBounds(definition.nav.bounds)) {
      this.addBoundsRect(rect, groundY);
    }

    for (const obstacle of definition.nav.obstacles) {
      this.addBoxOutline(
        (obstacle.minX + obstacle.maxX) / 2,
        (obstacle.minZ + obstacle.maxZ) / 2,
        obstacle.maxX - obstacle.minX,
        obstacle.height ?? 1.6,
        obstacle.maxZ - obstacle.minZ,
        groundY,
        COLOR_OBSTACLE,
        0.3,
      );
    }

    for (const zone of definition.zones ?? []) {
      if (zone.kind === 'circle') {
        this.addCircle(
          zone.center.x,
          zone.center.z,
          zone.radius,
          zone.center.y + 0.02,
          COLOR_ZONE,
          0.6,
        );
        this.addVerticalLine(
          zone.center.x,
          zone.center.z,
          zone.center.y,
          zone.center.y + 1.4,
          COLOR_ZONE,
          0.4,
        );
      } else {
        this.addBoxOutline(
          zone.center.x,
          zone.center.z,
          zone.size.x,
          Math.max(zone.size.y, 0.05),
          zone.size.z,
          zone.center.y - zone.size.y / 2,
          COLOR_ZONE,
          0.6,
        );
      }
    }

    for (const hotspot of definition.hotspots ?? []) {
      const maxDistance = hotspot.maxDistance ?? INTERACTION_CONFIG.gazeMaxDistance;
      this.addCircle(
        hotspot.position.x,
        hotspot.position.z,
        maxDistance,
        groundY + 0.03,
        COLOR_HOTSPOT,
        0.22,
      );
      this.addVerticalLine(
        hotspot.position.x,
        hotspot.position.z,
        groundY,
        hotspot.position.y,
        COLOR_HOTSPOT,
        0.55,
      );
      this.addCircle(
        hotspot.position.x,
        hotspot.position.z,
        0.18,
        hotspot.position.y,
        COLOR_HOTSPOT,
        0.8,
        24,
      );
    }
  }

  private addBoundsRect(rect: RectBounds, groundY: number): void {
    const y = groundY + 0.03;
    this.addLineLoop(
      [
        new THREE.Vector3(rect.minX, y, rect.minZ),
        new THREE.Vector3(rect.maxX, y, rect.minZ),
        new THREE.Vector3(rect.maxX, y, rect.maxZ),
        new THREE.Vector3(rect.minX, y, rect.maxZ),
      ],
      COLOR_BOUNDS,
      0.5,
    );
  }

  private addCircle(
    centerX: number,
    centerZ: number,
    radius: number,
    y: number,
    color: number,
    opacity: number,
    segments = 64,
  ): void {
    const points: THREE.Vector3[] = [];
    for (let index = 0; index < segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      points.push(
        new THREE.Vector3(centerX + Math.cos(angle) * radius, y, centerZ + Math.sin(angle) * radius),
      );
    }
    this.addLineLoop(points, color, opacity);
  }

  private addVerticalLine(
    x: number,
    z: number,
    fromY: number,
    toY: number,
    color: number,
    opacity: number,
  ): void {
    const material = this.createMaterial(color, opacity);
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, fromY, z),
      new THREE.Vector3(x, toY, z),
    ]);
    this.group.add(new THREE.Line(geometry, material));
  }

  private addBoxOutline(
    centerX: number,
    centerZ: number,
    width: number,
    height: number,
    depth: number,
    baseY: number,
    color: number,
    opacity: number,
  ): void {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const edges = new THREE.EdgesGeometry(geometry);
    geometry.dispose();

    const material = this.createMaterial(color, opacity);
    const lines = new THREE.LineSegments(edges, material);
    lines.position.set(centerX, baseY + height / 2, centerZ);
    this.group.add(lines);
  }

  private addLineLoop(points: THREE.Vector3[], color: number, opacity: number): void {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = this.createMaterial(color, opacity);
    this.group.add(new THREE.LineLoop(geometry, material));
  }

  private createMaterial(color: number, opacity: number): THREE.LineBasicMaterial {
    return new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });
  }

  private clearGroup(): void {
    this.group.traverse((object) => {
      if (object instanceof THREE.LineSegments || object instanceof THREE.Line) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) {
          material.forEach((item) => item.dispose());
        } else {
          material.dispose();
        }
      }
    });
    this.group.clear();
  }

  dispose(): void {
    this.clearGroup();
    this.scene.remove(this.group);
  }
}

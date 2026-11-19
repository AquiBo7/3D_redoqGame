import * as THREE from 'three';
import { SHARED_RESOURCE_FLAG } from '../world/resources';

export interface WindTime { value: number }
export interface MeadowBed {
  x: number;
  z: number;
  width: number;
  depth: number;
  y: number;
  density?: number;
  flowers?: number;
  bladeWidth?: number;
}
interface WindOptions {
  base?: number;
  height?: number;
  amplitude?: number;
  bottom?: number;
  top?: number;
}

function attachWind<T extends THREE.MeshStandardMaterial | THREE.MeshLambertMaterial>(
  material: T,
  time: WindTime,
  options: WindOptions,
): T {
  const gradient = options.bottom !== undefined && options.top !== undefined;
  const compile = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms.uTime = time;
    shader.uniforms.uWindBase = { value: options.base ?? 0 };
    shader.uniforms.uWindHeight = { value: options.height ?? 1 };
    shader.uniforms.uWindAmplitude = { value: options.amplitude ?? 0.08 };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
#include <common>
uniform float uTime;
uniform float uWindBase;
uniform float uWindHeight;
uniform float uWindAmplitude;
varying float vMeadowHeight;`);
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
vec4 mvPosition = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
vec4 foliageWorldPosition = modelMatrix * mvPosition;
float heightFactor = clamp((position.y - uWindBase) / uWindHeight, 0.0, 1.0);
vMeadowHeight = heightFactor;
float breeze = sin(uTime * 2.0 + foliageWorldPosition.x * 0.7 + foliageWorldPosition.z * 0.5) * heightFactor * uWindAmplitude;
foliageWorldPosition.x += breeze;
foliageWorldPosition.z += breeze * 0.35;
mvPosition = viewMatrix * foliageWorldPosition;
gl_Position = projectionMatrix * mvPosition;`);
    shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `
#if defined(USE_ENVMAP) || defined(DISTANCE) || defined(USE_SHADOWMAP) || defined(USE_TRANSMISSION) || NUM_SPOT_LIGHT_COORDS > 0
  vec4 worldPosition = foliageWorldPosition;
#endif`);
    if (gradient) {
      shader.uniforms.uMeadowBottom = { value: new THREE.Color(options.bottom) };
      shader.uniforms.uMeadowTop = { value: new THREE.Color(options.top) };
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
#include <common>
uniform vec3 uMeadowBottom;
uniform vec3 uMeadowTop;
varying float vMeadowHeight;`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
#include <color_fragment>
diffuseColor.rgb *= mix(uMeadowBottom, uMeadowTop, smoothstep(0.0, 1.0, vMeadowHeight));`);
    }
  };
  material.customProgramCacheKey = () => `${cacheKey}:campus-wind-v1:${gradient ? 'gradient' : 'plain'}`;
  material.userData.windTime = time;
  return material;
}

export function createFoliageWindMaterial(
  source: THREE.MeshStandardMaterial,
  time: WindTime,
  options: WindOptions = {},
): THREE.MeshStandardMaterial {
  const material = source.clone();
  delete material.userData[SHARED_RESOURCE_FLAG];
  return attachWind(material, time, options);
}

type Point = [number, number, number];

function meadowGeometry(flowers: boolean): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  const triangle = (a: Point, b: Point, c: Point, hex: number): void => {
    positions.push(...a, ...b, ...c);
    color.setHex(hex);
    for (let i = 0; i < 3; i += 1) colors.push(color.r, color.g, color.b);
  };
  for (let leaf = 0; leaf < 3; leaf += 1) {
    const angle = leaf * 2.399;
    const x = Math.cos(angle) * 0.13;
    const z = Math.sin(angle) * 0.13;
    if (!flowers) {
      const tangentX = Math.cos(angle + 0.7);
      const tangentZ = Math.sin(angle + 0.7);
      const point = (width: number, y: number, bend: number): Point =>
        [x + tangentX * width + Math.cos(angle) * bend, y, z + tangentZ * width + Math.sin(angle) * bend];
      const a = point(-0.025, 0, 0);
      const b = point(0.025, 0, 0);
      const c = point(-0.038, 0.55, 0.03);
      const d = point(0.038, 0.55, 0.03);
      const tip = point(0, 1 - leaf * 0.12, 0.17);
      triangle(a, b, c, 0xffffff);
      triangle(b, d, c, 0xffffff);
      triangle(c, d, tip, 0xffffff);
    } else {
      const height = 0.75 + leaf * 0.1;
      triangle([x - 0.009, 0, z], [x + 0.009, 0, z], [x, height, z], 0x668b54);
      triangle([x, 0.35, z], [x + 0.1, 0.46, z + 0.04], [x, 0.5, z], 0x8aab60);
      for (let petal = 0; petal < 5; petal += 1) {
        const a = petal * Math.PI * 0.4;
        const b = a + Math.PI * 0.4;
        const center: Point = [x, height - 0.015, z];
        const tip: Point = [x + Math.cos(a + 0.628) * 0.12, height + 0.012, z + Math.sin(a + 0.628) * 0.12];
        const left: Point = [x + Math.cos(a) * 0.055, height + 0.025, z + Math.sin(a) * 0.055];
        const right: Point = [x + Math.cos(b) * 0.055, height + 0.025, z + Math.sin(b) * 0.055];
        triangle(center, left, tip, 0xfff9df);
        triangle(center, tip, right, 0xfff9df);
        triangle(center, [x + Math.cos(a) * 0.025, height - 0.014, z + Math.sin(a) * 0.025],
          [x + Math.cos(b) * 0.025, height - 0.014, z + Math.sin(b) * 0.025], 0xe6b752);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (flowers) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function meadowRandom(seed: number): number {
  let value = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function createCampusMeadow(
  parent: THREE.Object3D,
  name: string,
  beds: MeadowBed[],
  time: WindTime,
): { grass: THREE.InstancedMesh; flowers: THREE.InstancedMesh } {
  const grassCounts = beds.map((bed) => Math.floor(bed.width * bed.depth * (bed.density ?? 22)));
  const flowerCounts = beds.map((bed) => bed.flowers ?? Math.floor(bed.width * bed.depth * 0.8));
  const build = (flowers: boolean): THREE.InstancedMesh => {
    const counts = flowers ? flowerCounts : grassCounts;
    const material = attachWind(new THREE.MeshLambertMaterial({
      side: THREE.DoubleSide, vertexColors: flowers,
    }), time, flowers ? {} : { bottom: 0x235b4b, top: 0xb3c967 });
    const geometry = meadowGeometry(flowers);
    const mesh = new THREE.InstancedMesh(geometry, material, counts.reduce((sum, count) => sum + count, 0));
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    let instance = 0;
    beds.forEach((bed, bedIndex) => {
      for (let i = 0; i < counts[bedIndex]; i += 1) {
        const seed = (bedIndex + 1) * 7919 + i * 17 + (flowers ? 104729 : 0);
        transform.position.set(
          bed.x + (meadowRandom(seed) - 0.5) * Math.max(0, bed.width - 0.48),
          bed.y,
          bed.z + (meadowRandom(seed + 1) - 0.5) * Math.max(0, bed.depth - 0.48),
        );
        const height = (flowers ? 0.48 : 0.3) + meadowRandom(seed + 2) * 0.24;
        const spread = ((flowers ? 0.85 : 0.65) + meadowRandom(seed + 3) * 0.4) * (flowers ? 1 : bed.bladeWidth ?? 1);
        transform.scale.set(spread, height, spread);
        transform.rotation.set(0, meadowRandom(seed + 4) * Math.PI * 2, 0);
        transform.updateMatrix();
        mesh.setMatrixAt(instance, transform.matrix);
        mesh.setColorAt(instance, color.setHex(flowers
          ? (i % 3 === 0 ? 0xf5cf63 : 0xfffbea)
          : [0xffffff, 0xe4edbd, 0xccdfa4][i % 3]));
        instance += 1;
      }
    });
    mesh.name = `${name}-wind-${flowers ? 'flowers' : 'grass'}`;
    mesh.userData.campusDetail = true;
    mesh.userData.meadow = flowers ? 'flowers' : 'grass';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    // 风在世界坐标偏移，剔除包围体也需包含叶尖的最大摆幅。
    mesh.boundingBox!.expandByScalar(0.09);
    mesh.boundingSphere!.radius += 0.09;
    geometry.addEventListener('dispose', () => mesh.dispose());
    parent.add(mesh);
    return mesh;
  };
  return { grass: build(false), flowers: build(true) };
}

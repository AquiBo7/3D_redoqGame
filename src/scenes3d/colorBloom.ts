import * as THREE from 'three';

export interface ColorBloomUniforms {
  uPlayerPos: { value: THREE.Vector3 };
  uCompanionPos: { value: THREE.Vector3 };
  uRevealedZ: { value: number };
  uBloomTime: { value: number };
}

export function createColorBloomUniforms(): ColorBloomUniforms {
  return {
    uPlayerPos: { value: new THREE.Vector3(0.2, 0, 1.2) },
    uCompanionPos: { value: new THREE.Vector3(1.3, 0, -1) },
    uRevealedZ: { value: -1 },
    uBloomTime: { value: 0 },
  };
}

export function advanceColorBloom(
  uniforms: ColorBloomUniforms,
  player: THREE.Vector3,
  companion: THREE.Vector3,
  dt: number,
): number {
  const px = player.x, py = player.y, pz = player.z;
  const cx = companion.x, cy = companion.y, cz = companion.z;
  uniforms.uPlayerPos.value.set(px, py, pz);
  uniforms.uCompanionPos.value.set(cx, cy, cz);
  uniforms.uRevealedZ.value = Math.min(uniforms.uRevealedZ.value, pz, cz);
  uniforms.uBloomTime.value += dt;
  return THREE.MathUtils.clamp((-1 - uniforms.uRevealedZ.value) / 43, 0, 1);
}

export function sampleColorBloomReveal(x: number, z: number, uniforms: ColorBloomUniforms): number {
  const player = uniforms.uPlayerPos.value;
  const companion = uniforms.uCompanionPos.value;
  const distance = Math.min(Math.hypot(x - player.x, z - player.z), Math.hypot(x - companion.x, z - companion.z));
  // 与片元同式，已走区域不受时钟扰动。
  const trail = THREE.MathUtils.smoothstep(z - uniforms.uRevealedZ.value, -0.8, 0);
  const edge = Math.sin(x * 1.7 + z * 1.3 + uniforms.uBloomTime.value * 0.65) * 0.12 * (1 - trail);
  const footprint = 1 - THREE.MathUtils.smoothstep(distance + edge, 2, 3.2);
  return Math.max(trail, footprint);
}

const bloomVertex = `
vec4 bloomWorldPosition = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  bloomWorldPosition = batchingMatrix * bloomWorldPosition;
#endif
#ifdef USE_INSTANCING
  bloomWorldPosition = instanceMatrix * bloomWorldPosition;
#endif
vBloomWorldPos = (modelMatrix * bloomWorldPosition).xyz;`;

const bloomFragment = `
float bloomDistance = min(length(vBloomWorldPos.xz - uPlayerPos.xz), length(vBloomWorldPos.xz - uCompanionPos.xz));
float bloomTrail = smoothstep(-0.8, 0.0, vBloomWorldPos.z - uRevealedZ);
float bloomEdge = sin(vBloomWorldPos.x * 1.7 + vBloomWorldPos.z * 1.3 + uBloomTime * 0.65) * 0.12 * (1.0 - bloomTrail);
float bloomFootprint = 1.0 - smoothstep(2.0, 3.2, bloomDistance + bloomEdge);
float bloomReveal = max(bloomTrail, bloomFootprint);
vec3 bloomSource = diffuseColor.rgb;
float bloomLuma = dot(bloomSource, vec3(0.2126, 0.7152, 0.0722));
vec3 bloomCold = mix(vec3(bloomLuma), bloomSource, 0.22) * vec3(0.94, 0.98, 1.06);
vec3 bloomWarm = bloomSource * vec3(1.08, 1.04, 1.0) + vec3(0.018, 0.012, 0.004);
diffuseColor.rgb = mix(bloomCold, bloomWarm, bloomReveal);
`;

export function applyColorBloomShader<T extends THREE.MeshStandardMaterial | THREE.MeshLambertMaterial>(
  material: T,
  sharedUniforms: ColorBloomUniforms,
): T {
  const compile = material.onBeforeCompile;
  // 默认缓存键依赖回调文本，需在包装前读取。
  const cacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms.uPlayerPos = sharedUniforms.uPlayerPos;
    shader.uniforms.uCompanionPos = sharedUniforms.uCompanionPos;
    shader.uniforms.uRevealedZ = sharedUniforms.uRevealedZ;
    shader.uniforms.uBloomTime = sharedUniforms.uBloomTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
#include <common>
varying vec3 vBloomWorldPos;`);
    if (/\bvec4\s+foliageWorldPosition\s*=/.test(shader.vertexShader)) {
      shader.vertexShader = shader.vertexShader.replace(
        /gl_Position\s*=\s*projectionMatrix\s*\*\s*mvPosition\s*;/,
        '$&\nvBloomWorldPos = foliageWorldPosition.xyz;',
      );
    } else {
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>${bloomVertex}`);
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
#include <common>
varying vec3 vBloomWorldPos;
uniform vec3 uPlayerPos;
uniform vec3 uCompanionPos;
uniform float uRevealedZ;
uniform float uBloomTime;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `${bloomFragment}#include <alphatest_fragment>`);
  };
  material.customProgramCacheKey = () => `${cacheKey}:color-bloom-v1`;
  material.userData.colorBloomUniforms = sharedUniforms;
  material.needsUpdate = true;
  return material;
}

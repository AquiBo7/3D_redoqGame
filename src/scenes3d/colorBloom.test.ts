import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  advanceColorBloom, applyColorBloomShader, createColorBloomUniforms, sampleColorBloomReveal,
  type ColorBloomUniforms,
} from './colorBloom';
import { createCampusMeadow, createFoliageWindMaterial } from './foliageWind';

type BloomMaterial = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
type Shader = Parameters<THREE.Material['onBeforeCompile']>[0];

function makeMaterial(kind: 'standard' | 'lambert'): BloomMaterial {
  return kind === 'standard' ? new THREE.MeshStandardMaterial() : new THREE.MeshLambertMaterial();
}

function makeShader(material: BloomMaterial): Shader {
  const template = material instanceof THREE.MeshLambertMaterial ? THREE.ShaderLib.lambert : THREE.ShaderLib.standard;
  return { uniforms: {}, vertexShader: template.vertexShader, fragmentShader: template.fragmentShader } as Shader;
}

function compile(material: BloomMaterial, shader = makeShader(material), renderer = {} as THREE.WebGLRenderer): Shader {
  material.onBeforeCompile(shader, renderer);
  return shader;
}

function activeIfdefs(source: string, defines: ReadonlySet<string>): string {
  const active = [true];
  const lines: string[] = [];
  for (const line of source.split('\n')) {
    const condition = /^\s*#ifdef\s+(\w+)/.exec(line);
    if (condition) active.push(active[active.length - 1] && defines.has(condition[1]));
    else if (/^\s*#endif/.test(line)) active.pop();
    else if (active[active.length - 1]) lines.push(line);
  }
  expect(active).toEqual([true]);
  return lines.join('\n');
}

function bloomWorldFromShader(
  shader: Shader, defines: ReadonlySet<string>, transformed: THREE.Vector3, matrices: Record<string, THREE.Matrix4>,
): THREE.Vector3 {
  const block = /vec4 bloomWorldPosition = vec4\(transformed, 1\.0\);[\s\S]*?vBloomWorldPos = \(modelMatrix \* bloomWorldPosition\)\.xyz;/.exec(shader.vertexShader);
  expect(block).not.toBeNull();
  const active = activeIfdefs(block![0], defines);
  const result = new THREE.Vector4(transformed.x, transformed.y, transformed.z, 1);
  for (const step of active.matchAll(/bloomWorldPosition = (\w+) \* bloomWorldPosition;/g)) {
    expect(matrices[step[1]]).toBeDefined();
    result.applyMatrix4(matrices[step[1]]);
  }
  result.applyMatrix4(matrices.modelMatrix);
  return new THREE.Vector3(result.x, result.y, result.z);
}

function revealFromShader(shader: Shader): (x: number, z: number, uniforms: ColorBloomUniforms) => number {
  const fragment = shader.fragmentShader;
  expect(fragment).toContain('min(length(vBloomWorldPos.xz - uPlayerPos.xz), length(vBloomWorldPos.xz - uCompanionPos.xz))');
  expect(fragment).toContain('float bloomFootprint = 1.0 - smoothstep(');
  expect(fragment).toContain('float bloomReveal = max(bloomTrail, bloomFootprint);');
  const trail = /smoothstep\(([-\d.]+), ([-\d.]+), vBloomWorldPos.z - uRevealedZ\)/.exec(fragment);
  const edge = /sin\(vBloomWorldPos.x \* ([\d.]+) \+ vBloomWorldPos.z \* ([\d.]+) \+ uBloomTime \* ([\d.]+)\) \* ([\d.]+) \* \(1.0 - bloomTrail\)/.exec(fragment);
  const footprint = /smoothstep\(([\d.]+), ([\d.]+), bloomDistance \+ bloomEdge\)/.exec(fragment);
  expect(trail).not.toBeNull(); expect(edge).not.toBeNull(); expect(footprint).not.toBeNull();
  const [trailMin, trailMax] = trail!.slice(1).map(Number);
  const [fx, fz, ft, amplitude] = edge!.slice(1).map(Number);
  const [inner, outer] = footprint!.slice(1).map(Number);
  const smoothstep = (low: number, high: number, value: number): number => {
    const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
    return t * t * (3 - 2 * t);
  };
  return (x, z, uniforms) => {
    const p = uniforms.uPlayerPos.value, c = uniforms.uCompanionPos.value;
    const d = Math.min(Math.sqrt((x - p.x) ** 2 + (z - p.z) ** 2), Math.sqrt((x - c.x) ** 2 + (z - c.z) ** 2));
    const persistent = smoothstep(trailMin, trailMax, z - uniforms.uRevealedZ.value);
    const ripple = Math.sin(x * fx + z * fz + uniforms.uBloomTime.value * ft) * amplitude * (1 - persistent);
    return Math.max(persistent, 1 - smoothstep(inner, outer, d + ripple));
  };
}

const branches = [
  ['普通', []],
  ['实例', ['USE_INSTANCING']],
  ['批次', ['USE_BATCHING']],
  ['批次与实例', ['USE_BATCHING', 'USE_INSTANCING']],
] as const;

describe('水彩漫染共享状态', () => {
  it('初始值准确，每次创建的容器、Uniform 与两人向量全部独立', () => {
    const a = createColorBloomUniforms(), b = createColorBloomUniforms();
    expect(a).not.toBe(b);
    expect(a.uPlayerPos.value.toArray()).toEqual([0.2, 0, 1.2]);
    expect(a.uCompanionPos.value.toArray()).toEqual([1.3, 0, -1]);
    expect(a.uRevealedZ.value).toBe(-1); expect(a.uBloomTime.value).toBe(0);
    expect(a.uPlayerPos.value).not.toBe(a.uCompanionPos.value);
    for (const key of Object.keys(a) as (keyof ColorBloomUniforms)[]) expect(a[key]).not.toBe(b[key]);
    expect(a.uPlayerPos.value).not.toBe(b.uPlayerPos.value);
    expect(a.uCompanionPos.value).not.toBe(b.uCompanionPos.value);
    a.uPlayerPos.value.set(9, 8, -30); a.uCompanionPos.value.set(7, 6, -32);
    a.uRevealedZ.value = -32; a.uBloomTime.value = 10;
    expect(b).toEqual(createColorBloomUniforms());
  });

  it('逐帧更新保留全部 Uniform 和向量身份，只复制外部坐标', () => {
    const uniforms = createColorBloomUniforms(), wrappers = { ...uniforms };
    const playerRef = uniforms.uPlayerPos.value, companionRef = uniforms.uCompanionPos.value;
    const player = new THREE.Vector3(2, 3, -12), companion = new THREE.Vector3(4, 5, -15);
    expect(advanceColorBloom(uniforms, player, companion, 0.25)).toBeCloseTo(14 / 43);
    for (const key of Object.keys(uniforms) as (keyof ColorBloomUniforms)[]) expect(uniforms[key]).toBe(wrappers[key]);
    expect(uniforms.uPlayerPos.value).toBe(playerRef); expect(uniforms.uCompanionPos.value).toBe(companionRef);
    expect(playerRef).toEqual(player); expect(companionRef).toEqual(companion);
    expect(playerRef).not.toBe(player); expect(companionRef).not.toBe(companion);
    player.set(20, 30, 40); companion.set(50, 60, 70);
    expect(playerRef.toArray()).toEqual([2, 3, -12]); expect(companionRef.toArray()).toEqual([4, 5, -15]);
    expect(uniforms.uBloomTime.value).toBe(0.25);
  });

  it('输入引用交叉指向现有向量时仍复制原坐标，不分配替代向量', () => {
    const uniforms = createColorBloomUniforms();
    const player = uniforms.uPlayerPos.value.set(1, 2, -5), companion = uniforms.uCompanionPos.value.set(3, 4, -9);
    advanceColorBloom(uniforms, companion, player, 0);
    expect(uniforms.uPlayerPos.value).toBe(player); expect(uniforms.uCompanionPos.value).toBe(companion);
    expect(player.toArray()).toEqual([3, 4, -9]); expect(companion.toArray()).toEqual([1, 2, -5]);
    expect(uniforms.uRevealedZ.value).toBe(-9);
  });

  it('边界取旧值与两人最小 Z，前进、停留和回头均单调，时间按 dt 累加', () => {
    const uniforms = createColorBloomUniforms();
    const player = new THREE.Vector3(), companion = new THREE.Vector3();
    const steps = [[4, 2, -1], [-6, -4, -6], [-3, -10, -10], [-2, -4, -10], [-10, -10, -10], [-22.5, -18, -22.5], [-44, -40, -44], [-80, -50, -80]];
    let boundary = -1, progress = 0;
    steps.forEach(([pz, cz, expected], i) => {
      player.z = pz; companion.z = cz;
      const next = advanceColorBloom(uniforms, player, companion, 0.125);
      expect(uniforms.uRevealedZ.value).toBe(expected);
      expect(uniforms.uRevealedZ.value).toBeLessThanOrEqual(boundary);
      expect(next).toBeGreaterThanOrEqual(progress); expect(next).toBeGreaterThanOrEqual(0); expect(next).toBeLessThanOrEqual(1);
      expect(uniforms.uBloomTime.value).toBe((i + 1) * 0.125);
      boundary = expected; progress = next;
    });
  });

  it.each([[8, 0], [-1, 0], [-22.5, 0.5], [-44, 1], [-1000, 1]])('Z=%s 的进度为 %s', (z, expected) => {
    const uniforms = createColorBloomUniforms();
    const position = new THREE.Vector3(0, 0, z);
    expect(advanceColorBloom(uniforms, position, position, 0)).toBe(expected);
  });

  it('进度下限也显式钳制，时间精确加上传入 dt', () => {
    const uniforms = createColorBloomUniforms();
    uniforms.uRevealedZ.value = 10; uniforms.uBloomTime.value = 2;
    expect(advanceColorBloom(uniforms, new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, 8), -0.5)).toBe(0);
    expect(uniforms.uRevealedZ.value).toBe(5); expect(uniforms.uBloomTime.value).toBe(1.5);
  });

  it('同场景多材质即时读取共享值，更新不污染另一场景', () => {
    const a = createColorBloomUniforms(), b = createColorBloomUniforms();
    const materials = [applyColorBloomShader(new THREE.MeshStandardMaterial(), a), applyColorBloomShader(new THREE.MeshLambertMaterial(), a), applyColorBloomShader(new THREE.MeshStandardMaterial(), b)];
    const shaders = materials.map((material) => compile(material));
    advanceColorBloom(a, new THREE.Vector3(2, 0, -16), new THREE.Vector3(3, 0, -17), 0.5);
    shaders.forEach((shader, index) => {
      const uniforms = index === 2 ? b : a;
      for (const key of Object.keys(uniforms) as (keyof ColorBloomUniforms)[]) expect(shader.uniforms[key]).toBe(uniforms[key]);
      expect(materials[index].userData.colorBloomUniforms).toBe(uniforms);
    });
    expect(shaders[0].uniforms.uRevealedZ.value).toBe(-17); expect(shaders[1].uniforms.uBloomTime.value).toBe(0.5);
    expect(b).toEqual(createColorBloomUniforms());
    materials.forEach((material) => material.dispose());
  });
});

describe('水彩漫染权重', () => {
  it('分别接近主角或林夏都恢复色彩，只比较水平距离', () => {
    const uniforms = createColorBloomUniforms();
    uniforms.uPlayerPos.value.set(-15, 50, -12); uniforms.uCompanionPos.value.set(15, -50, -12);
    for (const x of [-15, 15]) {
      expect(sampleColorBloomReveal(x, -12, uniforms)).toBe(1);
      expect(sampleColorBloomReveal(x + 1.7, -12, uniforms)).toBe(1);
    }
    expect(sampleColorBloomReveal(0, -12, uniforms)).toBe(0);
    uniforms.uPlayerPos.value.y = -1000; uniforms.uCompanionPos.value.y = 1000;
    expect(sampleColorBloomReveal(-15, -12, uniforms)).toBe(1); expect(sampleColorBloomReveal(15, -12, uniforms)).toBe(1);
    const before = sampleColorBloomReveal(-12.4, -12, uniforms);
    advanceColorBloom(uniforms, uniforms.uCompanionPos.value, uniforms.uPlayerPos.value, 0);
    uniforms.uRevealedZ.value = -1;
    expect(sampleColorBloomReveal(-12.4, -12, uniforms)).toBe(before);
  });

  it('脚下约三米柔和过渡，远处前方始终冷灰', () => {
    const uniforms = createColorBloomUniforms();
    uniforms.uPlayerPos.value.set(0, 0, -10); uniforms.uCompanionPos.value.set(-20, 0, -10);
    for (const time of [0, 4, 40, 400]) {
      uniforms.uBloomTime.value = time;
      expect(sampleColorBloomReveal(1.8, -10, uniforms)).toBe(1);
      const edge = sampleColorBloomReveal(2.6, -10, uniforms);
      expect(edge).toBeGreaterThan(0); expect(edge).toBeLessThan(1);
      expect(sampleColorBloomReveal(3.5, -10, uniforms)).toBe(0);
      for (const x of [-100, 0, 100]) expect(sampleColorBloomReveal(x, -80, uniforms)).toBe(0);
    }
  });

  it('历史边界前侧柔化，边界本身及道路两侧完整揭示', () => {
    const uniforms = createColorBloomUniforms();
    uniforms.uRevealedZ.value = -10;
    for (const x of [-40, 40]) {
      expect(sampleColorBloomReveal(x, -10.8, uniforms)).toBe(0);
      expect(sampleColorBloomReveal(x, -10.4, uniforms)).toBeCloseTo(0.5);
      expect(sampleColorBloomReveal(x, -10, uniforms)).toBe(1);
      expect(sampleColorBloomReveal(x, 5, uniforms)).toBe(1);
      expect(sampleColorBloomReveal(x, -10 - 0.000001, uniforms)).toBeCloseTo(1, 10);
    }
  });

  it('水彩边缘微动，但走过的边界和树冠绝不随时间或回头变灰', () => {
    const uniforms = createColorBloomUniforms();
    uniforms.uPlayerPos.value.set(0, 0, -10); uniforms.uCompanionPos.value.set(-20, 0, -10);
    const before = sampleColorBloomReveal(2.6, -10, uniforms);
    uniforms.uBloomTime.value = 4;
    expect(Math.abs(sampleColorBloomReveal(2.6, -10, uniforms) - before)).toBeGreaterThan(0.01);
    advanceColorBloom(uniforms, new THREE.Vector3(0, 0, -14), new THREE.Vector3(1, 0, -12), 0);
    for (const time of [0, 4, 50, 5000]) {
      advanceColorBloom(uniforms, new THREE.Vector3(0, 0, 8), new THREE.Vector3(1, 0, 9), time);
      for (const x of [-40, -8, 0, 8, 40]) for (const z of [-14, -12, -1, 8]) {
        expect(sampleColorBloomReveal(x, z, uniforms)).toBe(1);
      }
      expect(uniforms.uRevealedZ.value).toBe(-14);
      expect(sampleColorBloomReveal(40, -14.4, uniforms)).toBeCloseTo(0.5);
    }
  });

  it('采样为纯函数，不改动冻结的输入与任何 Uniform', () => {
    const uniforms = createColorBloomUniforms();
    Object.freeze(uniforms.uPlayerPos.value); Object.freeze(uniforms.uCompanionPos.value);
    Object.values(uniforms).forEach((uniform) => Object.freeze(uniform)); Object.freeze(uniforms);
    for (const x of [-10, 0.2, 1.3, 10]) for (const z of [-40, -1, 2]) {
      const reveal = sampleColorBloomReveal(x, z, uniforms);
      expect(reveal).toBeGreaterThanOrEqual(0); expect(reveal).toBeLessThanOrEqual(1);
    }
    expect(uniforms).toEqual(createColorBloomUniforms());
  });
});

describe.each(['standard', 'lambert'] as const)('%s 材质漫染注入', (kind) => {
  it('原地返回，保留材质参数与旧注入，旧回调先执行且只调用一次并绑定正确 this', () => {
    const material = makeMaterial(kind), uniforms = createColorBloomUniforms();
    const renderer = {} as THREE.WebGLRenderer, legacyUniform = { value: 7 };
    const color = material.color, userData = material.userData;
    material.userData.keep = true; material.alphaTest = 0.3;
    const version = material.version;
    const oldCompile = vi.fn(function (this: BloomMaterial, shader: Shader, passedRenderer: THREE.WebGLRenderer) {
      expect(this).toBe(material); expect(passedRenderer).toBe(renderer);
      expect(shader.uniforms.uPlayerPos).toBeUndefined(); expect(shader.vertexShader).not.toContain('vBloomWorldPos');
      shader.uniforms.legacy = legacyUniform;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vec3(0.9);');
    });
    const oldKey = vi.fn(function (this: BloomMaterial) {
      expect(this).toBe(material); expect(this.onBeforeCompile).toBe(oldCompile);
      return 'legacy:gradient:stable';
    });
    material.onBeforeCompile = oldCompile; material.customProgramCacheKey = oldKey;
    expect(applyColorBloomShader(material, uniforms)).toBe(material);
    expect(material.version).toBe(version + 1); expect(material.color).toBe(color); expect(material.userData).toBe(userData);
    expect(material.userData.keep).toBe(true); expect(material.userData.colorBloomUniforms).toBe(uniforms); expect(material.alphaTest).toBe(0.3);
    expect(material.customProgramCacheKey()).toBe('legacy:gradient:stable:color-bloom-v1');
    expect(oldKey).toHaveBeenCalledOnce(); expect(oldCompile).not.toHaveBeenCalled();
    const shader = makeShader(material);
    compile(material, shader, renderer);
    expect(oldCompile).toHaveBeenCalledOnce(); expect(oldCompile.mock.contexts[0]).toBe(material);
    expect(oldCompile.mock.calls[0]).toEqual([shader, renderer]); expect(shader.uniforms.legacy).toBe(legacyUniform);
    expect(shader.fragmentShader.indexOf('diffuseColor.rgb *= vec3(0.9);')).toBeLessThan(shader.fragmentShader.indexOf('float bloomDistance'));
    for (const key of Object.keys(uniforms) as (keyof ColorBloomUniforms)[]) expect(shader.uniforms[key]).toBe(uniforms[key]);
    material.dispose();
  });

  it('保留默认键前缀，颜色在 alpha test 前低开销冷灰转暖，不影响透明度和原 chunk', () => {
    const material = makeMaterial(kind), prefix = material.customProgramCacheKey();
    applyColorBloomShader(material, createColorBloomUniforms());
    const shader = compile(material), fragment = shader.fragmentShader;
    expect(material.customProgramCacheKey()).toBe(`${prefix}:color-bloom-v1`);
    expect(shader.vertexShader.match(/varying vec3 vBloomWorldPos;/g)).toHaveLength(1);
    expect(fragment.match(/varying vec3 vBloomWorldPos;/g)).toHaveLength(1);
    for (const declaration of ['uniform vec3 uPlayerPos;', 'uniform vec3 uCompanionPos;', 'uniform float uRevealedZ;', 'uniform float uBloomTime;']) {
      expect(fragment).toContain(declaration);
    }
    expect(fragment).toContain('mix(vec3(bloomLuma), bloomSource, 0.22) * vec3(0.94, 0.98, 1.06)');
    expect(fragment).toContain('bloomSource * vec3(1.08, 1.04, 1.0) + vec3(0.018, 0.012, 0.004)');
    expect(fragment).toContain('diffuseColor.rgb = mix(bloomCold, bloomWarm, bloomReveal);');
    const block = fragment.slice(fragment.indexOf('float bloomDistance'), fragment.indexOf('#include <alphatest_fragment>'));
    expect(block.trim().split('\n')).toHaveLength(10); expect(block).not.toMatch(/texture|sampler|diffuseColor\.a\b/);
    expect(fragment.indexOf('#include <color_fragment>')).toBeLessThan(fragment.indexOf('float bloomDistance'));
    expect(fragment.indexOf('#include <alphamap_fragment>')).toBeLessThan(fragment.indexOf('float bloomDistance'));
    expect(fragment.indexOf('diffuseColor.rgb = mix(bloomCold')).toBeLessThan(fragment.indexOf('#include <alphatest_fragment>'));
    expect(fragment).toContain('#include <map_fragment>'); expect(fragment).toContain('#include <fog_fragment>');
    const expanded = shader.vertexShader.replace('#include <project_vertex>', THREE.ShaderChunk.project_vertex).replace('#include <worldpos_vertex>', THREE.ShaderChunk.worldpos_vertex);
    expect(expanded.match(/\bvec4\s+worldPosition\s*=/g)).toHaveLength(1);
    expect(expanded.match(/vBloomWorldPos\s*=/g)).toHaveLength(1);
    expect(shader.vertexShader.indexOf('vBloomWorldPos =')).toBeLessThan(shader.vertexShader.indexOf('#include <worldpos_vertex>'));
    material.dispose();
  });

  it.each(branches)('%s 分支按 batching、instancing、model 顺序获得世界坐标，不依赖 worldpos chunk', (_name, flags) => {
    const material = applyColorBloomShader(makeMaterial(kind), createColorBloomUniforms());
    const shader = makeShader(material);
    shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', '');
    compile(material, shader);
    const defines = new Set<string>(flags), transformed = new THREE.Vector3(0.6, 1.2, -2.3);
    const matrices = {
      batchingMatrix: new THREE.Matrix4().makeRotationX(0.4).scale(new THREE.Vector3(1.1, 0.8, 1.5)).setPosition(-4, 2, 6),
      instanceMatrix: new THREE.Matrix4().makeRotationZ(-0.7).scale(new THREE.Vector3(0.6, 1.8, 1.2)).setPosition(3, -2, -5),
      modelMatrix: new THREE.Matrix4().makeRotationY(0.9).scale(new THREE.Vector3(1.3, 0.7, 0.9)).setPosition(12, 4, -20),
    };
    const expected = transformed.clone();
    if (defines.has('USE_BATCHING')) expected.applyMatrix4(matrices.batchingMatrix);
    if (defines.has('USE_INSTANCING')) expected.applyMatrix4(matrices.instanceMatrix);
    expected.applyMatrix4(matrices.modelMatrix);
    const actual = bloomWorldFromShader(shader, defines, transformed, matrices);
    expect(actual.distanceTo(expected)).toBeLessThan(1e-12);
    expect(shader.vertexShader).not.toMatch(/\bvec4\s+worldPosition\s*=/);
    expect(shader.vertexShader).not.toContain('foliageWorldPosition'); expect(shader.vertexShader).toContain('#include <project_vertex>');
    material.dispose();
  });

  it('CPU 采样与注入 GLSL 的公式一致，跨时间、边界和足迹全部处于 0..1', () => {
    const material = applyColorBloomShader(makeMaterial(kind), createColorBloomUniforms());
    const shaderSample = revealFromShader(compile(material)), uniforms = createColorBloomUniforms();
    uniforms.uPlayerPos.value.set(0.2, 9, -10); uniforms.uCompanionPos.value.set(15, -4, -12);
    for (const time of [0, 0.016, 8, 125]) for (const boundary of [-1, -10, -44]) {
      uniforms.uBloomTime.value = time; uniforms.uRevealedZ.value = boundary;
      for (const x of [-30, -3, -1.8, 0.2, 1.3, 2.8, 15, 17.6, 30]) for (const z of [-60, -44, -12, -11, -10.8, -10.4, -10, -3.4, -1.8, -1, 5]) {
        const sample = sampleColorBloomReveal(x, z, uniforms);
        expect(sample).toBeGreaterThanOrEqual(0); expect(sample).toBeLessThanOrEqual(1);
        expect(sample).toBeCloseTo(shaderSample(x, z, uniforms), 12);
      }
    }
    material.dispose();
  });
});

describe('漫染与植被风场兼容', () => {
  it.each(['plain', 'gradient'] as const)('保留 %s 风材质的回调、Uniform、缓存前缀与扰动后世界坐标', (mode) => {
    const source = new THREE.MeshStandardMaterial(), time = { value: 2.5 };
    const material = createFoliageWindMaterial(source, time, mode === 'gradient' ? { bottom: 0x235b4b, top: 0xb3c967 } : {});
    const baseline = compile(material), prefix = material.customProgramCacheKey(), windCompile = material.onBeforeCompile;
    const oldCompile = vi.fn(function (this: BloomMaterial, shader: Shader, renderer: THREE.WebGLRenderer) {
      expect(this).toBe(material); expect(shader.vertexShader).not.toContain('vBloomWorldPos');
      windCompile.call(this, shader, renderer);
    });
    material.onBeforeCompile = oldCompile;
    const uniforms = createColorBloomUniforms();
    applyColorBloomShader(material, uniforms);
    const shader = compile(material);
    expect(oldCompile).toHaveBeenCalledOnce(); expect(oldCompile.mock.contexts[0]).toBe(material);
    expect(material.customProgramCacheKey()).toBe(`${prefix}:color-bloom-v1`);
    expect(shader.uniforms.uTime).toBe(time); expect(material.userData.windTime).toBe(time);
    expect(shader.uniforms.uPlayerPos).toBe(uniforms.uPlayerPos);
    const endProjection = 'gl_Position = projectionMatrix * mvPosition;';
    const windBody = baseline.vertexShader.slice(baseline.vertexShader.indexOf('vec4 mvPosition'), baseline.vertexShader.indexOf(endProjection) + endProjection.length);
    expect(shader.vertexShader).toContain(windBody);
    expect(shader.vertexShader).toContain(`${endProjection}\nvBloomWorldPos = foliageWorldPosition.xyz;`);
    expect(shader.vertexShader.indexOf('foliageWorldPosition.z += breeze * 0.35;')).toBeLessThan(shader.vertexShader.indexOf('vBloomWorldPos ='));
    expect(shader.vertexShader.indexOf('vBloomWorldPos =')).toBeLessThan(shader.vertexShader.indexOf('#include <logdepthbuf_vertex>'));
    expect(shader.vertexShader).not.toContain('bloomWorldPosition'); expect(shader.vertexShader).not.toContain('#include <worldpos_vertex>');
    expect(shader.vertexShader.match(/\bvec4\s+worldPosition\s*=/g)).toHaveLength(1);
    expect(shader.vertexShader.match(/\bvec4\s+foliageWorldPosition\s*=/g)).toHaveLength(1);
    if (mode === 'gradient') {
      expect(shader.fragmentShader).toContain('diffuseColor.rgb *= mix(uMeadowBottom, uMeadowTop, smoothstep(0.0, 1.0, vMeadowHeight));');
      expect(shader.fragmentShader.indexOf('diffuseColor.rgb *= mix(uMeadowBottom')).toBeLessThan(shader.fragmentShader.indexOf('float bloomDistance'));
      expect(shader.uniforms.uMeadowBottom.value).toEqual(baseline.uniforms.uMeadowBottom.value);
      expect(shader.uniforms.uMeadowTop.value).toEqual(baseline.uniforms.uMeadowTop.value);
    }
    source.dispose(); material.dispose();
  });

  it.each(branches)('风材质%s 分支仍使用唯一的扰动后坐标，没有 worldpos chunk 也执行', (_name, flags) => {
    const source = new THREE.MeshStandardMaterial();
    const material = applyColorBloomShader(createFoliageWindMaterial(source, { value: 1 }), createColorBloomUniforms());
    const shader = makeShader(material);
    shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', '');
    compile(material, shader);
    const start = shader.vertexShader.indexOf('vec4 mvPosition');
    const end = shader.vertexShader.indexOf('vBloomWorldPos = foliageWorldPosition.xyz;');
    expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start);
    const defines = new Set<string>(flags), active = activeIfdefs(shader.vertexShader.slice(start, end), defines);
    expect(active.includes('batchingMatrix * mvPosition')).toBe(defines.has('USE_BATCHING'));
    expect(active.includes('instanceMatrix * mvPosition')).toBe(defines.has('USE_INSTANCING'));
    const matrices = [...active.matchAll(/mvPosition = (batchingMatrix|instanceMatrix) \* mvPosition;/g)].map((match) => match[1]);
    expect(matrices).toEqual([...(defines.has('USE_BATCHING') ? ['batchingMatrix'] : []), ...(defines.has('USE_INSTANCING') ? ['instanceMatrix'] : [])]);
    expect(active).toContain('vec4 foliageWorldPosition = modelMatrix * mvPosition;');
    expect(active).toContain('foliageWorldPosition.x += breeze;'); expect(active).toContain('foliageWorldPosition.z += breeze * 0.35;');
    expect(shader.vertexShader.match(/vBloomWorldPos\s*=/g)).toHaveLength(1);
    expect(shader.vertexShader).not.toMatch(/\bvec4\s+worldPosition\s*=/);
    source.dispose(); material.dispose();
  });

  it('实际实例草花保留根尖渐变、顶点色与风 Uniform，漫染在颜色之后及 alpha test 之前', () => {
    const time = { value: 0 }, uniforms = createColorBloomUniforms();
    const meadow = createCampusMeadow(new THREE.Group(), 'bloom-test', [{ x: 3, z: -4, width: 1, depth: 1, y: 0, density: 3, flowers: 2 }], time);
    for (const mesh of [meadow.grass, meadow.flowers]) {
      const material = mesh.material as THREE.MeshLambertMaterial, prefix = material.customProgramCacheKey();
      applyColorBloomShader(material, uniforms);
      const shader = compile(material), fragment = shader.fragmentShader;
      expect(material.customProgramCacheKey()).toBe(`${prefix}:color-bloom-v1`);
      expect(shader.uniforms.uTime).toBe(time); expect(shader.uniforms.uCompanionPos).toBe(uniforms.uCompanionPos);
      expect(fragment.indexOf('#include <color_fragment>')).toBeLessThan(fragment.indexOf('float bloomDistance'));
      expect(fragment.indexOf('diffuseColor.rgb = mix(bloomCold')).toBeLessThan(fragment.indexOf('#include <alphatest_fragment>'));
      if (mesh === meadow.grass) {
        expect(fragment).toContain('mix(uMeadowBottom, uMeadowTop');
        expect(fragment.indexOf('mix(uMeadowBottom, uMeadowTop')).toBeLessThan(fragment.indexOf('float bloomDistance'));
        expect(material.vertexColors).toBe(false);
      } else {
        expect(material.vertexColors).toBe(true); expect(mesh.geometry.getAttribute('color')).toBeDefined();
      }
      expect(shader.vertexShader).toContain('vBloomWorldPos = foliageWorldPosition.xyz;');
      mesh.geometry.dispose(); material.dispose();
    }
  });
});

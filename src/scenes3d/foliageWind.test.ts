import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SHARED_RESOURCE_FLAG } from '../world/resources';
import { createCampusMeadow, createFoliageWindMaterial } from './foliageWind';

function compile(material: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial) {
  const template = material instanceof THREE.MeshLambertMaterial ? THREE.ShaderLib.lambert : THREE.ShaderLib.standard;
  const shader = {
    uniforms: {}, vertexShader: template.vertexShader,
    fragmentShader: template.fragmentShader,
  } as Parameters<THREE.Material['onBeforeCompile']>[0];
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

describe('实例植被顶点风场', () => {
  it('实例与模型变换之后按世界坐标施风，投影与接收阴影使用同一偏移', () => {
    const source = new THREE.MeshStandardMaterial();
    const time = { value: 0 };
    const material = createFoliageWindMaterial(source, time, { bottom: 0x235b4b, top: 0xb3c967 });
    const shader = compile(material);
    expect(shader.vertexShader.indexOf('instanceMatrix * mvPosition')).toBeLessThan(shader.vertexShader.indexOf('float breeze'));
    expect(shader.vertexShader).toContain('modelMatrix * mvPosition');
    expect(shader.vertexShader).toContain('sin(uTime * 2.0 + foliageWorldPosition.x * 0.7 + foliageWorldPosition.z * 0.5) * heightFactor * uWindAmplitude');
    expect(shader.vertexShader).toContain('worldPosition = foliageWorldPosition');
    expect(shader.vertexShader).toContain('viewMatrix * foliageWorldPosition');
    expect(shader.uniforms.uWindAmplitude.value).toBe(0.08);
    expect(shader.fragmentShader).toContain('mix(uMeadowBottom, uMeadowTop');
    expect(shader.uniforms.uMeadowBottom.value.equals(new THREE.Color(0x235b4b))).toBe(true);
    time.value = 2.5;
    expect(shader.uniforms.uTime.value).toBe(2.5);
    source.dispose();
    material.dispose();
  });

  it('克隆风材质不改写或释放共享源和贴图，树冠与渐变草使用不同缓存键', () => {
    const texture = new THREE.Texture();
    texture.userData[SHARED_RESOURCE_FLAG] = true;
    const source = new THREE.MeshStandardMaterial({ map: texture });
    source.userData[SHARED_RESOURCE_FLAG] = true;
    const original = source.onBeforeCompile;
    const disposeTexture = vi.spyOn(texture, 'dispose');
    const canopy = createFoliageWindMaterial(source, { value: 0 }, { base: -1, height: 2, amplitude: 0.035 });
    const grass = createFoliageWindMaterial(source, { value: 0 }, { bottom: 0x235b4b, top: 0xb3c967 });
    expect(source.onBeforeCompile).toBe(original);
    expect(source.userData[SHARED_RESOURCE_FLAG]).toBe(true);
    expect(canopy.userData[SHARED_RESOURCE_FLAG]).toBeUndefined();
    expect(canopy.map).toBe(texture);
    expect(canopy.customProgramCacheKey()).not.toBe(grass.customProgramCacheKey());
    const shader = compile(canopy);
    expect(shader.uniforms.uWindBase.value).toBe(-1);
    expect(shader.uniforms.uWindHeight.value).toBe(2);
    expect(shader.uniforms.uWindAmplitude.value).toBe(0.035);
    expect(shader.fragmentShader).not.toContain('uMeadowBottom');
    canopy.dispose();
    grass.dispose();
    expect(disposeTexture).not.toHaveBeenCalled();
    source.dispose();
    texture.dispose();
  });

  it('千簇草花只生成两个无透明无投影的实例批次，更新时钟不重传实例缓冲', () => {
    const root = new THREE.Group();
    const time = { value: 0 };
    const meadow = createCampusMeadow(root, 'test', [
      { x: -7, z: -10, width: 4, depth: 10, y: 0.42, density: 30, flowers: 24 },
      { x: 7, z: -10, width: 4, depth: 10, y: 0.42, density: 30, flowers: 24 },
    ], time);
    expect(root.children).toHaveLength(2);
    expect(meadow.grass.count).toBe(2400);
    expect(meadow.flowers.count).toBe(48);
    for (const mesh of Object.values(meadow)) {
      const material = mesh.material as THREE.MeshLambertMaterial;
      expect(material).toBeInstanceOf(THREE.MeshLambertMaterial);
      const shader = compile(material);
      expect(shader.fragmentShader).toContain('#include <lights_lambert_pars_fragment>');
      if (mesh === meadow.grass) expect(shader.fragmentShader).toContain('mix(uMeadowBottom, uMeadowTop');
      expect(material.transparent).toBe(false);
      expect(material.side).toBe(THREE.DoubleSide);
      expect(mesh.geometry.groups).toHaveLength(0);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(true);
      expect(mesh.userData.campusDetail).toBe(true);
      const version = mesh.instanceMatrix.version;
      const positions = mesh.geometry.getAttribute('position').array.slice();
      time.value += 0.016;
      expect(mesh.instanceMatrix.version).toBe(version);
      expect(mesh.geometry.getAttribute('position').array).toEqual(positions);
      const disposeMesh = vi.spyOn(mesh, 'dispose');
      mesh.geometry.dispose();
      expect(disposeMesh).toHaveBeenCalledOnce();
      material.dispose();
    }
  });

  it('固定种子生成同一分布，草花边缘与摆幅保留中央通廊', () => {
    const bed = { x: 3, z: -4, width: 2, depth: 3, y: 0, density: 24, flowers: 8 };
    const a = createCampusMeadow(new THREE.Group(), 'a', [bed], { value: 0 });
    const b = createCampusMeadow(new THREE.Group(), 'b', [bed], { value: 0 });
    const matrix = new THREE.Matrix4();
    for (const key of ['grass', 'flowers'] as const) {
      expect(a[key].instanceMatrix.array).toEqual(b[key].instanceMatrix.array);
      const mesh = a[key];
      mesh.geometry.computeBoundingBox();
      for (let i = 0; i < mesh.count; i += 1) {
        mesh.getMatrixAt(i, matrix);
        const bounds = mesh.geometry.boundingBox!.clone().applyMatrix4(matrix).expandByScalar(0.09);
        expect(bounds.min.x).toBeGreaterThan(1.2);
        expect(bounds.min.y).toBeGreaterThanOrEqual(-0.09);
      }
      for (const mesh of [a[key], b[key]]) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    }
  });
});

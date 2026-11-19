// UV 读取回归：非零三顶点、正/负归一化整数必须使用解码后的实际值。
import { Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { countUvTears, UV_TEAR_HARD, UV_TEAR_SOFT } from './uvCheck.mjs';

function triangle(uvs: Float32Array | Uint16Array | Int16Array, normalized = false) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const uv = doc.createAccessor().setType('VEC2').setArray(uvs).setNormalized(normalized).setBuffer(buffer);
  const indices = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2])).setBuffer(buffer);
  doc.createMesh().addPrimitive(doc.createPrimitive().setIndices(indices).setAttribute('TEXCOORD_0', uv));
  return doc;
}

describe('UV 撕裂真实读数', () => {
  it('固定原有硬/软阈值', () => {
    expect(UV_TEAR_HARD).toBe(0.25);
    expect(UV_TEAR_SOFT).toBe(0.1);
  });

  it.each([
    [0, 0, 0.3, 0, 0, 0],
    [0, 0, 0, 0, 0.3, 0],
    [0.3, 0, 0, 0, 0, 0],
    [0, 0, -0.3, 0, 0, 0],
    [0, 0, 0, 0.3, 0, 0],
  ])('读取三个顶点的实际 FLOAT UV：%j', (...values) => {
    expect(countUvTears(triangle(new Float32Array(values)))).toEqual({ overHard: 1, overSoft: 0, triCount: 1, uvless: 0 });
  });

  it.each([
    { name: '正值 UNSIGNED_SHORT', values: new Uint16Array([0, 0, 32768, 0, 0, 0]) },
    { name: '负值 SHORT', values: new Int16Array([0, 0, -16384, 0, 0, 0]) },
  ])('$name 归一化反例不再误报零', ({ values }) => {
    expect(countUvTears(triangle(values, true)).overHard).toBe(1);
  });

  it.each([
    new Uint16Array([0, 0, 3277, 0, 0, 0]),
    new Int16Array([0, 0, -1638, 0, 0, 0]),
  ])('归一化后短边不因整数原始值被误报', (values) => {
    expect(countUvTears(triangle(values, true))).toEqual({ overHard: 0, overSoft: 0, triCount: 1, uvless: 0 });
  });

  it('软阈值仍独立于硬阈值计数', () => {
    expect(countUvTears(triangle(new Float32Array([0, 0, 0.15, 0, 0, 0])))).toEqual({ overHard: 0, overSoft: 1, triCount: 1, uvless: 0 });
  });

  it('无 UV 三角形计入 uvless 而不是伪装成有效 UV', () => {
    const doc = triangle(new Float32Array(6));
    doc.getRoot().listMeshes()[0].listPrimitives()[0].setAttribute('TEXCOORD_0', null);
    expect(countUvTears(doc)).toEqual({ overHard: 0, overSoft: 0, triCount: 1, uvless: 1 });
  });
});

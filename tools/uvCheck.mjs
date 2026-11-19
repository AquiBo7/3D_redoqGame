// tools/uvCheck.mjs —— UV 撕裂硬校验（压缩脚本与单元测试共用）
// 遍历 glTF 文档每个三角形，用 TEXCOORD_0 归一化解码读数（getElement）计算三条边的 UV 欧氏距离，
// 统计任一边超过硬阈值（0.25）/ 软阈值（0.10）的三角形数量。硬阈值数量必须为 0。

/** UV 撕裂硬阈值：边 UV 距离超过该值即判定为撕裂 */
export const UV_TEAR_HARD = 0.25;
/** UV 撕裂软阈值：边 UV 距离超过该值需报告（应尽量接近 0） */
export const UV_TEAR_SOFT = 0.1;

/** 统计文档内所有三角形的 UV 撕裂：返回 { overHard, overSoft, triCount, uvless } */
export function countUvTears(doc) {
  let overHard = 0;
  let overSoft = 0;
  let triCount = 0;
  let uvless = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      if (!indices) continue;
      const uvAccessor = prim.getAttribute('TEXCOORD_0');
      const triCountLocal = indices.getCount() / 3;
      triCount += triCountLocal;
      if (!uvAccessor) {
        uvless += triCountLocal;
        continue;
      }
      const uvTemp = [0, 0, 0, 0, 0, 0];
      const indexArray = indices.getArray();
      for (let t = 0; t < triCountLocal; t += 1) {
        const i0 = indexArray[t * 3];
        const i1 = indexArray[t * 3 + 1];
        const i2 = indexArray[t * 3 + 2];
        uvAccessor.getElement(i0, [uvTemp[0], uvTemp[1]]);
        uvAccessor.getElement(i1, [uvTemp[2], uvTemp[3]]);
        uvAccessor.getElement(i2, [uvTemp[4], uvTemp[5]]);
        const d01 = Math.hypot(uvTemp[2] - uvTemp[0], uvTemp[3] - uvTemp[1]);
        const d12 = Math.hypot(uvTemp[4] - uvTemp[2], uvTemp[5] - uvTemp[3]);
        const d20 = Math.hypot(uvTemp[0] - uvTemp[4], uvTemp[1] - uvTemp[5]);
        const worst = Math.max(d01, d12, d20);
        if (worst > UV_TEAR_HARD) overHard += 1;
        else if (worst > UV_TEAR_SOFT) overSoft += 1;
      }
    }
  }
  return { overHard, overSoft, triCount, uvless };
}

/** 统计文档三角面数 */
export function countTris(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      if (indices) tris += indices.getCount() / 3;
    }
  }
  return tris;
}

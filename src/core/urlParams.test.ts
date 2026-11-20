import { describe, expect, it } from 'vitest';
import { parseUrlParams } from './urlParams';

describe('parseUrlParams', () => {
  it('无参数时返回默认值', () => {
    expect(parseUrlParams('')).toEqual({
      debug: false,
      lite: false,
      modelViewer: false,
      phonePreview: false,
      role: 'bystander',
      scene: null,
    });
  });

  it('识别 ?phonePreview=1 且支持关闭值', () => {
    expect(parseUrlParams('?phonePreview=1').phonePreview).toBe(true);
    expect(parseUrlParams('?phonePreview').phonePreview).toBe(true);
    expect(parseUrlParams('?phonePreview=0').phonePreview).toBe(false);
    expect(parseUrlParams('?phonePreview=false&lite=1')).toMatchObject({
      phonePreview: false,
      lite: true,
    });
  });

  it('识别 ?debug=1、?lite=1 与 ?modelViewer=1', () => {
    const params = parseUrlParams('?debug=1&lite=1&modelViewer=1');
    expect(params.debug).toBe(true);
    expect(params.lite).toBe(true);
    expect(params.modelViewer).toBe(true);
  });

  it('旧的 viewer 参数不再生效', () => {
    const params = parseUrlParams('?viewer=1');
    expect(params).not.toHaveProperty('viewer');
    expect(params.modelViewer).toBe(false);
  });

  it('识别并校验 role', () => {
    expect(parseUrlParams('?role=victim').role).toBe('victim');
    expect(parseUrlParams('?role=PERPETRATOR').role).toBe('perpetrator');
    expect(parseUrlParams('?role=bystander').role).toBe('bystander');
    expect(parseUrlParams('?role=hacker').role).toBe('bystander');
  });

  it('场景编号大小写归一，非法场景为 null', () => {
    expect(parseUrlParams('?scene=s7').scene).toBe('S7');
    expect(parseUrlParams('?scene=S9').scene).toBe('S9');
    expect(parseUrlParams('?scene=S10').scene).toBe('S10');
    expect(parseUrlParams('?scene=c6').scene).toBe('C6');
    expect(parseUrlParams('?scene=D6').scene).toBe('D6');
    expect(parseUrlParams('?scene=E1').scene).toBe('E1');
    expect(parseUrlParams('?scene=S15').scene).toBeNull();
    expect(parseUrlParams('?scene=foo').scene).toBeNull();
  });

  it('关闭标记 0 / false / off 均视为关闭', () => {
    expect(parseUrlParams('?debug=0').debug).toBe(false);
    expect(parseUrlParams('?lite=false').lite).toBe(false);
    expect(parseUrlParams('?modelViewer=off').modelViewer).toBe(false);
  });

  it('非关闭值均视为开启', () => {
    expect(parseUrlParams('?debug=true').debug).toBe(true);
    expect(parseUrlParams('?debug=yes').debug).toBe(true);
    expect(parseUrlParams('?debug').debug).toBe(true);
  });
});
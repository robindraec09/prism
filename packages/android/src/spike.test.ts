import { describe, expect, it } from 'vitest';
import { parsePoint } from './spike.js';

describe('parsePoint', () => {
  it('parses x,y in DIP', () => {
    expect(parsePoint('180, 524.5')).toEqual({ x: 180, y: 524.5 });
  });

  it('rejects anything else', () => {
    expect(() => parsePoint('180')).toThrow(/x,y/);
    expect(() => parsePoint('a,b')).toThrow(/x,y/);
    expect(() => parsePoint('1,2,3')).toThrow(/x,y/);
  });
});

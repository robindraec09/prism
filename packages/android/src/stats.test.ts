import { describe, expect, it } from 'vitest';
import { percentile, summarize } from './stats.js';

describe('summarize', () => {
  it('computes median, p95 and mean', () => {
    expect(summarize([30, 10, 20])).toEqual({
      n: 3,
      min: 10,
      median: 20,
      p95: 30,
      max: 30,
      mean: 20,
    });
    expect(summarize([4, 1, 3, 2]).median).toBe(2.5);
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(summarize(hundred).p95).toBe(95);
  });

  it('handles empty input', () => {
    expect(summarize([]).n).toBe(0);
    expect(Number.isNaN(summarize([]).median)).toBe(true);
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';

import { formatDuration } from './index.js';

describe('formatDuration', () => {
  it('formats durations under one second as whole milliseconds', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(250)).toBe('250ms');
    expect(formatDuration(12.4)).toBe('12ms');
  });

  it('rounds to whole milliseconds before choosing the unit', () => {
    expect(formatDuration(999.4)).toBe('999ms');
    expect(formatDuration(999.6)).toBe('1.0s');
  });

  it('formats durations from one second to under a minute as seconds with one decimal', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(1599)).toBe('1.5s');
    expect(formatDuration(59_999)).toBe('59.9s');
  });

  it('formats durations of a minute or more as minutes and whole seconds', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatDuration(3_600_000)).toBe('60m 0s');
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws a RangeError that explains the problem for %s',
    (value) => {
      expect(() => formatDuration(value)).toThrow(RangeError);
      expect(() => formatDuration(value)).toThrow(
        /expected a finite number of milliseconds >= 0, but got .*end - start/,
      );
    },
  );
});

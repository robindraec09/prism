/** Summary of a sample of measurements (ms or bytes). */
export interface Summary {
  n: number;
  min: number;
  median: number;
  p95: number;
  max: number;
  mean: number;
}

/**
 * Nearest-rank percentile of an ascending-sorted array.
 *
 * @example
 * ```ts
 * percentile([1, 2, 3, 4], 50); // 2
 * ```
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? NaN;
}

/**
 * Summarises samples. The median of an even-sized sample is the mean of the two middle values.
 *
 * @example
 * ```ts
 * summarize([30, 10, 20]); // { n: 3, min: 10, median: 20, p95: 30, max: 30, mean: 20 }
 * ```
 */
export function summarize(values: readonly number[]): Summary {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return { n: 0, min: NaN, median: NaN, p95: NaN, max: NaN, mean: NaN };
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? (s[mid] ?? NaN) : ((s[mid - 1] ?? NaN) + (s[mid] ?? NaN)) / 2;
  const round = (x: number): number => Math.round(x * 100) / 100;
  return {
    n,
    min: round(s[0] ?? NaN),
    median: round(median),
    p95: round(percentile(s, 95)),
    max: round(s[n - 1] ?? NaN),
    mean: round(s.reduce((a, b) => a + b, 0) / n),
  };
}

/**
 * Formats a duration in milliseconds as a short human-readable string, the
 * way Prism prints timings in logs and reports.
 *
 * - Below one second (after rounding to whole milliseconds): whole milliseconds, for example `"250ms"`.
 * - From one second to under a minute: seconds with one decimal, for example `"1.5s"`.
 * - From one minute: minutes and whole seconds, for example `"2m 5s"`.
 *
 * @param ms - Duration in milliseconds. Must be a finite number, zero or greater.
 * @returns The formatted duration.
 * @throws {RangeError} If `ms` is negative, `NaN` or infinite.
 *
 * @example
 * ```ts
 * import { formatDuration } from '@prismtest/core';
 *
 * formatDuration(250);    // "250ms"
 * formatDuration(1500);   // "1.5s"
 * formatDuration(125000); // "2m 5s"
 * ```
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError(
      `formatDuration() expected a finite number of milliseconds >= 0, but got ${String(ms)}. ` +
        'Pass the difference between two timestamps, for example `end - start`.',
    );
  }

  // Round to whole milliseconds first so 999.6 ms becomes "1.0s", not "1000ms".
  const whole = Math.round(ms);

  if (whole < 1000) {
    return `${whole}ms`;
  }

  if (whole < 60_000) {
    // Floor to one decimal so 59_999 ms never prints as "60.0s".
    return `${(Math.floor(whole / 100) / 10).toFixed(1)}s`;
  }

  const totalSeconds = Math.floor(whole / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

import type { CallOptions } from './actions.js';
import type { Rect, Rotation } from './geometry.js';
import type { OpenString } from './open-string.js';

/**
 * Image formats defined by protocol 1.0.
 *
 * @example
 * ```ts
 * import type { KnownImageFormat } from '@prismtest/core';
 *
 * const f: KnownImageFormat = 'png';
 * ```
 */
export type KnownImageFormat = 'png' | 'jpeg';

/**
 * The format of a received image. Open string.
 *
 * @example
 * ```ts
 * import type { ImageFormat } from '@prismtest/core';
 *
 * const f: ImageFormat = 'jpeg';
 * ```
 */
export type ImageFormat = OpenString<KnownImageFormat>;

/**
 * Options for a screenshot.
 *
 * @example
 * ```ts
 * import type { ScreenshotOptions } from '@prismtest/core';
 *
 * const forTrace: ScreenshotOptions = { format: 'jpeg', quality: 70 };
 * const header: ScreenshotOptions = { region: { x: 0, y: 0, width: 360, height: 80 } };
 * ```
 */
export interface ScreenshotOptions extends CallOptions {
  /** Default `png` (lossless; required for visual baselines). */
  readonly format?: KnownImageFormat;
  /** JPEG quality, 1–100. */
  readonly quality?: number;
  /** Capture only this DIP rectangle. Default: the full screen, system bars included. */
  readonly region?: Rect;
}

/**
 * A captured image (protocol.md §10.2). Unlike the wire form, `data` holds the
 * decoded bytes: drivers decode base64 or download the artifact before
 * returning.
 *
 * @example
 * ```ts
 * import { writeFile } from 'node:fs/promises';
 * import type { Screenshot } from '@prismtest/core';
 *
 * async function save(shot: Screenshot): Promise<void> {
 *   await writeFile(`failure.${shot.format}`, shot.data);
 * }
 * ```
 */
export interface Screenshot {
  readonly format: ImageFormat;
  /** Width in device pixels. */
  readonly width: number;
  /** Height in device pixels. */
  readonly height: number;
  /** Device pixels per DIP; multiply DIP masks by it. */
  readonly scale: number;
  readonly rotation: Rotation;
  /** DIP rectangle actually captured; absent for full-screen captures. */
  readonly region?: Rect;
  /** ISO 8601 UTC. */
  readonly capturedAt: string;
  /** Encoded image bytes (PNG or JPEG). */
  readonly data: Uint8Array;
}

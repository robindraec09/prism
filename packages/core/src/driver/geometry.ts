import type { OpenString } from './open-string.js';

/**
 * A point in device-independent pixels (DIP): CSS pixels on web, points on
 * iOS, `px / density` on Android. Origin is the top-left of the screen as the
 * UI is currently drawn (protocol.md §2.6).
 *
 * @example
 * ```ts
 * import type { Point } from '@prismtest/core';
 *
 * const centre: Point = { x: 180, y: 400 };
 * ```
 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A rectangle in device-independent pixels (DIP). Fractions are allowed;
 * `width` and `height` are never negative.
 *
 * @example
 * ```ts
 * import type { Rect } from '@prismtest/core';
 *
 * const signIn: Rect = { x: 16, y: 500, width: 328, height: 48 };
 * ```
 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Screen areas covered by system UI (status bar, cut-out, navigation bar,
 * home indicator), in DIP. Visual testing uses these to mask system bars.
 *
 * @example
 * ```ts
 * import type { Insets } from '@prismtest/core';
 *
 * const pixel: Insets = { top: 24, right: 0, bottom: 48, left: 0 };
 * ```
 */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * Degrees the UI content is rotated clockwise from the device's natural
 * orientation. Drivers report the *interface* rotation (where the UI is
 * drawn), not the physical device rotation (protocol.md §2.1). This is a
 * closed set on the wire.
 *
 * @example
 * ```ts
 * import type { Rotation } from '@prismtest/core';
 *
 * const landscape: Rotation = 90;
 * ```
 */
export type Rotation = 0 | 90 | 180 | 270;

/**
 * Orientation values defined by protocol 1.0.
 *
 * @example
 * ```ts
 * import type { KnownOrientation } from '@prismtest/core';
 *
 * const o: KnownOrientation = 'portrait';
 * ```
 */
export type KnownOrientation = 'portrait' | 'landscape';

/**
 * Screen orientation, derived from width vs height; for readability only.
 * Use {@link Rotation} for coordinate maths. Open string (protocol.md §5.2).
 *
 * @example
 * ```ts
 * import type { Orientation } from '@prismtest/core';
 *
 * const o: Orientation = 'landscape';
 * ```
 */
export type Orientation = OpenString<KnownOrientation>;

/**
 * The screen a snapshot or screenshot was taken on (protocol.md §2.1, wire
 * type `Screen`).
 *
 * @example
 * ```ts
 * import type { ScreenInfo } from '@prismtest/core';
 *
 * const emulator: ScreenInfo = {
 *   width: 360,
 *   height: 800,
 *   scale: 3,
 *   rotation: 0,
 *   orientation: 'portrait',
 *   insets: { top: 24, right: 0, bottom: 48, left: 0 },
 * };
 * ```
 */
export interface ScreenInfo {
  /** Width in DIP. */
  readonly width: number;
  /** Height in DIP. */
  readonly height: number;
  /** Device pixels per DIP (Android `density`, iOS `UIScreen.scale`, web `devicePixelRatio`). */
  readonly scale: number;
  readonly rotation: Rotation;
  readonly orientation: Orientation;
  readonly insets?: Insets;
}

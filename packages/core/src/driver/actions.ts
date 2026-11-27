import type { Point } from './geometry.js';
import type { ResolvedLocator } from './locator.js';
import type { OpenString } from './open-string.js';
import type { Idle, NodeMatch, NodeRef, Role, Settle } from './tree.js';

/**
 * Options every driver call accepts.
 *
 * @example
 * ```ts
 * import type { CallOptions } from '@prismtest/core';
 *
 * const controller = new AbortController();
 * const opts: CallOptions = { timeoutMs: 5_000, signal: controller.signal };
 * ```
 */
export interface CallOptions {
  /**
   * Budget for this one call in milliseconds; the driver rejects with a
   * `timeout` {@link PrismError} when it runs out. Defaults per command are in
   * protocol.md §9.5. This is not the auto-wait timeout, which core owns.
   */
  readonly timeoutMs?: number;
  /** Aborts the call; the driver rejects with a `cancelled` {@link PrismError}. */
  readonly signal?: AbortSignal;
}

/**
 * Acts on a node from a snapshot or find result. The driver revalidates it and
 * rejects with `stale-node` if it changed (protocol.md §7.2).
 *
 * @example
 * ```ts
 * import type { NodeTarget } from '@prismtest/core';
 *
 * const t: NodeTarget = { node: { snapshotId: 'k7q2xm4p.s-4', nodeId: 'n5' } };
 * ```
 */
export interface NodeTarget {
  readonly node: NodeRef;
  readonly locator?: never;
  readonly point?: never;
}

/**
 * Lets the driver resolve the locator and act in one call. Exactly one match
 * is required (`ambiguous` otherwise). Agent drivers support this only with
 * capability `find.agent`.
 *
 * @example
 * ```ts
 * import type { LocatorTarget } from '@prismtest/core';
 *
 * const t: LocatorTarget = { locator: { kind: 'testId', value: 'sign_in' } };
 * ```
 */
export interface LocatorTarget {
  readonly locator: ResolvedLocator;
  readonly node?: never;
  readonly point?: never;
}

/**
 * Raw coordinates in DIP. Element checks do not apply, except
 * `checks.within` and `checks.unobscured` (protocol.md §4.5).
 *
 * @example
 * ```ts
 * import type { PointTarget } from '@prismtest/core';
 *
 * const t: PointTarget = { point: { x: 180, y: 524 } };
 * ```
 */
export interface PointTarget {
  readonly point: Point;
  readonly node?: never;
  readonly locator?: never;
}

/**
 * What an action acts on: exactly one of a node, a locator or a point
 * (wire type `Target`).
 *
 * @example
 * ```ts
 * import type { Target } from '@prismtest/core';
 *
 * const targets: Target[] = [
 *   { node: { snapshotId: 'k7q2xm4p.s-4', nodeId: 'n5' } },
 *   { locator: { kind: 'role', role: 'button', name: { text: 'Sign in' } } },
 *   { point: { x: 10, y: 10 } },
 * ];
 * ```
 */
export type Target = NodeTarget | LocatorTarget | PointTarget;

/**
 * Tells whether a target is a node reference.
 *
 * @param target - Any action target.
 * @returns `true` for `{ node }` targets.
 *
 * @example
 * ```ts
 * import { isNodeTarget } from '@prismtest/core';
 *
 * isNodeTarget({ node: { snapshotId: 'k7q2xm4p.s-1', nodeId: 'n1' } }); // true
 * ```
 */
export function isNodeTarget(target: Target): target is NodeTarget {
  return target.node !== undefined;
}

/**
 * Tells whether a target is a locator.
 *
 * @param target - Any action target.
 * @returns `true` for `{ locator }` targets.
 *
 * @example
 * ```ts
 * import { isLocatorTarget } from '@prismtest/core';
 *
 * isLocatorTarget({ locator: { kind: 'text', text: 'OK' } }); // true
 * ```
 */
export function isLocatorTarget(target: Target): target is LocatorTarget {
  return target.locator !== undefined;
}

/**
 * Tells whether a target is a raw point.
 *
 * @param target - Any action target.
 * @returns `true` for `{ point }` targets.
 *
 * @example
 * ```ts
 * import { isPointTarget } from '@prismtest/core';
 *
 * isPointTarget({ point: { x: 1, y: 2 } }); // true
 * ```
 */
export function isPointTarget(target: Target): target is PointTarget {
  return target.point !== undefined;
}

/**
 * One-shot actionability checks the driver runs just before injecting
 * (protocol.md §9.2). A failing check rejects with `not-interactable` and a
 * `reason`; the driver never retries (core's auto-wait does, P0-05).
 *
 * @example
 * ```ts
 * import type { Checks } from '@prismtest/core';
 *
 * const full: Checks = { visible: true, enabled: true, onScreen: true, unobscured: true, stableMs: 50 };
 * ```
 */
export interface Checks {
  readonly visible?: boolean;
  /** The node and every ancestor are enabled. */
  readonly enabled?: boolean;
  readonly onScreen?: boolean;
  /** Nothing covers the action point. */
  readonly unobscured?: boolean;
  /** Bounds unchanged over this many ms. Satisfied without sampling when `settle` reached idle. */
  readonly stableMs?: number;
  /** With a point target: the point must lie inside this node (hybrid web actions). */
  readonly within?: NodeRef;
}

/**
 * Options for element actions (tap, double tap, long press, clear, set value).
 *
 * @example
 * ```ts
 * import type { ActionOptions } from '@prismtest/core';
 *
 * const opts: ActionOptions = {
 *   settle: { maxWaitMs: 200, quietMs: 50 },
 *   checks: { visible: true, enabled: true, onScreen: true, unobscured: true, stableMs: 50 },
 * };
 * ```
 */
export interface ActionOptions extends CallOptions {
  /** Action point relative to the node's top-left, in DIP. Default: centre of its on-screen part. */
  readonly offset?: Point;
  readonly checks?: Checks;
  /** Wait for idle before running checks; the result then carries `idle`. */
  readonly settle?: Settle;
}

/**
 * The actionable ancestor an action was retargeted to (protocol.md §9.2).
 *
 * @example
 * ```ts
 * import type { ActedOn } from '@prismtest/core';
 *
 * const a: ActedOn = { nodeId: 'n3', role: 'button', nativeType: 'XCUIElementTypeButton', path: [0, 1] };
 * ```
 */
export interface ActedOn {
  readonly nodeId: string;
  readonly role: Role;
  readonly nativeType: string;
  readonly path: readonly number[];
}

/**
 * Result of an action, returned after the gesture finished (touch-up), not
 * after the app reacted (wire type `ActionResult`).
 *
 * @example
 * ```ts
 * import type { ActionResult } from '@prismtest/core';
 *
 * const r: ActionResult = { at: { x: 180, y: 524 }, durationMs: 58 };
 * ```
 */
export interface ActionResult {
  /** Where the gesture was injected, in DIP. */
  readonly at: Point;
  readonly durationMs: number;
  /** The node a locator target matched (feeds healing fingerprints, HEAL-1). */
  readonly match?: NodeMatch;
  /** The retargeted ancestor, when retargeting applied. */
  readonly actedOn?: ActedOn;
  readonly idle?: Idle;
}

/**
 * How typed text combines with the field's current value. Sent by core, so
 * closed.
 *
 * @example
 * ```ts
 * import type { TypeMode } from '@prismtest/core';
 *
 * const mode: TypeMode = 'replace';
 * ```
 */
export type TypeMode = 'append' | 'replace';

/**
 * Input methods defined by protocol 1.0 (protocol.md §7.4).
 *
 * @example
 * ```ts
 * import type { KnownTypeMethod } from '@prismtest/core';
 *
 * const m: KnownTypeMethod = 'setText';
 * ```
 */
export type KnownTypeMethod = 'keys' | 'setText' | 'typeText';

/**
 * How a driver entered text. Reports show it, because `setText` skips per-key
 * listeners. Open string.
 *
 * @example
 * ```ts
 * import type { TypeMethod } from '@prismtest/core';
 *
 * const m: TypeMethod = 'keys';
 * ```
 */
export type TypeMethod = OpenString<KnownTypeMethod>;

/**
 * Options for typing.
 *
 * @example
 * ```ts
 * import type { TypeOptions } from '@prismtest/core';
 *
 * const opts: TypeOptions = { mode: 'replace', secret: true };
 * ```
 */
export interface TypeOptions extends Omit<ActionOptions, 'offset'> {
  /** Default `append`. */
  readonly mode?: TypeMode;
  /** Mask the text (`***`) in logs, traces and reports. Password nodes are always masked. */
  readonly secret?: boolean;
}

/**
 * Result of typing.
 *
 * @example
 * ```ts
 * import type { TypeResult } from '@prismtest/core';
 *
 * const r: TypeResult = { at: { x: 180, y: 328 }, durationMs: 140, method: 'keys' };
 * ```
 */
export interface TypeResult extends ActionResult {
  readonly method?: TypeMethod;
}

/**
 * Options for a long press.
 *
 * @example
 * ```ts
 * import type { LongPressOptions } from '@prismtest/core';
 *
 * const opts: LongPressOptions = { durationMs: 1200 };
 * ```
 */
export interface LongPressOptions extends ActionOptions {
  /** Default 800. */
  readonly durationMs?: number;
}

/**
 * A swipe or scroll direction. Sent by core, so closed. Protocol 1.0 does not
 * yet say whether it names the finger's or the content's movement; see
 * `docs/design/driver-interface.md` (open points).
 *
 * @example
 * ```ts
 * import type { Direction } from '@prismtest/core';
 *
 * const d: Direction = 'up';
 * ```
 */
export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * Options for a swipe.
 *
 * @example
 * ```ts
 * import type { SwipeOptions } from '@prismtest/core';
 *
 * const opts: SwipeOptions = { direction: 'left', distance: 0.8, durationMs: 300 };
 * ```
 */
export interface SwipeOptions extends CallOptions {
  readonly direction: Direction;
  /** DIP, or 0..1 as a fraction of the target's size. */
  readonly distance?: number;
  readonly durationMs?: number;
}

/**
 * Options for scrolling a container.
 *
 * @example
 * ```ts
 * import type { ScrollOptions } from '@prismtest/core';
 *
 * const opts: ScrollOptions = { direction: 'down', until: { kind: 'text', text: 'Order #1041' } };
 * ```
 */
export interface ScrollOptions extends CallOptions {
  readonly direction: Direction;
  readonly distance?: number;
  /** Stop once this locator matches an on-screen node. */
  readonly until?: ResolvedLocator;
  /** Default 20. */
  readonly maxSwipes?: number;
}

/**
 * Result of scrolling.
 *
 * @example
 * ```ts
 * import type { ScrollResult } from '@prismtest/core';
 *
 * const r: ScrollResult = { found: true, swipes: 3, reachedEnd: false };
 * ```
 */
export interface ScrollResult {
  readonly found: boolean;
  readonly swipes: number;
  readonly reachedEnd: boolean;
}

/**
 * Options for scrolling an element into view.
 *
 * @example
 * ```ts
 * import type { ScrollIntoViewOptions } from '@prismtest/core';
 *
 * const opts: ScrollIntoViewOptions = { maxSwipes: 5 };
 * ```
 */
export interface ScrollIntoViewOptions extends CallOptions {
  readonly maxSwipes?: number;
}

/**
 * Result of scrolling an element into view.
 *
 * @example
 * ```ts
 * import type { ScrollIntoViewResult } from '@prismtest/core';
 *
 * const r: ScrollIntoViewResult = { scrolled: true, direction: 'down', onScreen: true };
 * ```
 */
export interface ScrollIntoViewResult {
  readonly scrolled: boolean;
  readonly direction?: OpenString<Direction>;
  readonly onScreen: boolean;
}

/**
 * Options for a drag.
 *
 * @example
 * ```ts
 * import type { DragOptions } from '@prismtest/core';
 *
 * const opts: DragOptions = { holdMs: 500, durationMs: 400 };
 * ```
 */
export interface DragOptions extends CallOptions {
  readonly holdMs?: number;
  readonly durationMs?: number;
}

/**
 * Options for a pinch.
 *
 * @example
 * ```ts
 * import type { PinchOptions } from '@prismtest/core';
 *
 * const zoomIn: PinchOptions = { scale: 2 };
 * ```
 */
export interface PinchOptions extends CallOptions {
  /** Below 1 zooms out, above 1 zooms in. */
  readonly scale: number;
  readonly durationMs?: number;
}

/**
 * Named keys defined by protocol 1.0.
 *
 * @example
 * ```ts
 * import type { NamedKey } from '@prismtest/core';
 *
 * const k: NamedKey = 'enter';
 * ```
 */
export type NamedKey =
  | 'enter'
  | 'backspace'
  | 'delete'
  | 'tab'
  | 'escape'
  | 'search'
  | 'volumeUp'
  | 'volumeDown'
  | 'power';

/**
 * A key to press: a named key, or a raw Android key code.
 *
 * @example
 * ```ts
 * import type { Key } from '@prismtest/core';
 *
 * const enter: Key = 'enter';
 * const camera: Key = { androidKeyCode: 27 };
 * ```
 */
export type Key = NamedKey | { readonly androidKeyCode: number };

/**
 * Result of a hit test: the topmost node at a point (protocol.md §9.2).
 *
 * @example
 * ```ts
 * import type { HitTestResult } from '@prismtest/core';
 *
 * const coveredBy = (r: HitTestResult) => r.match.node.name;
 * ```
 */
export interface HitTestResult {
  readonly snapshotId: string;
  readonly match: NodeMatch;
}

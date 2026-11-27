import type { Rect, ScreenInfo } from './geometry.js';
import type { OpenString } from './open-string.js';

/**
 * Roles defined by protocol 1.0 (protocol.md §2.3), in the order of the spec's
 * role table. Kept in sync with `KnownRole` in `docs/design/protocol.schema.json`
 * by a unit test.
 *
 * @example
 * ```ts
 * import { KNOWN_ROLES } from '@prismtest/core';
 *
 * KNOWN_ROLES.includes('button'); // true
 * ```
 */
export const KNOWN_ROLES = [
  'screen',
  'application',
  'window',
  'document',
  'webview',
  'dialog',
  'alert',
  'keyboard',
  'generic',
  'group',
  'toolbar',
  'list',
  'listitem',
  'grid',
  'row',
  'cell',
  'tablist',
  'tab',
  'menu',
  'menuitem',
  'listbox',
  'option',
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'spinbutton',
  'combobox',
  'progressbar',
  'text',
  'heading',
  'image',
] as const;

/**
 * A role defined by protocol 1.0.
 *
 * @example
 * ```ts
 * import type { KnownRole } from '@prismtest/core';
 *
 * const role: KnownRole = 'textbox';
 * ```
 */
export type KnownRole = (typeof KNOWN_ROLES)[number];

/**
 * A node role as received from a driver. Open string: a newer peer may send a
 * role this version does not know, which consumers treat as `generic`
 * (see {@link normaliseRole}).
 *
 * @example
 * ```ts
 * import type { Role } from '@prismtest/core';
 *
 * const role: Role = 'button';
 * ```
 */
export type Role = OpenString<KnownRole>;

const knownRoles: ReadonlySet<string> = new Set(KNOWN_ROLES);

/**
 * Tells whether `role` is defined by protocol 1.0.
 *
 * @param role - Any role string, for example from a node.
 * @returns `true` if `role` is one of {@link KNOWN_ROLES}.
 *
 * @example
 * ```ts
 * import { isKnownRole } from '@prismtest/core';
 *
 * isKnownRole('switch'); // true
 * isKnownRole('treeitem'); // false
 * ```
 */
export function isKnownRole(role: string): role is KnownRole {
  return knownRoles.has(role);
}

/**
 * Maps a received role to a protocol 1.0 role: known roles are returned
 * unchanged and unknown roles become `generic` (protocol.md §2.3 rule 2).
 * The locator engine uses this so `by.role` behaves the same whatever version
 * the driver speaks.
 *
 * @param role - Any role string.
 * @returns `role` if known, else `'generic'`.
 *
 * @example
 * ```ts
 * import { normaliseRole } from '@prismtest/core';
 *
 * normaliseRole('button'); // 'button'
 * normaliseRole('carousel'); // 'generic'
 * ```
 */
export function normaliseRole(role: string): KnownRole {
  return isKnownRole(role) ? role : 'generic';
}

/**
 * Platforms defined by protocol 1.0.
 *
 * @example
 * ```ts
 * import { KNOWN_PLATFORMS } from '@prismtest/core';
 *
 * KNOWN_PLATFORMS; // ['android', 'ios', 'web']
 * ```
 */
export const KNOWN_PLATFORMS = ['android', 'ios', 'web'] as const;

/**
 * A platform defined by protocol 1.0.
 *
 * @example
 * ```ts
 * import type { KnownPlatform } from '@prismtest/core';
 *
 * const p: KnownPlatform = 'ios';
 * ```
 */
export type KnownPlatform = (typeof KNOWN_PLATFORMS)[number];

/**
 * The platform of a session, snapshot or device. Open string.
 *
 * @example
 * ```ts
 * import type { Platform } from '@prismtest/core';
 *
 * const p: Platform = 'android';
 * ```
 */
export type Platform = OpenString<KnownPlatform>;

/**
 * Where a node lives (protocol.md §2.8): `native` for the app's native UI, or
 * `web:<target>` / `web:<target>/<frameId>` for a browser page, WebView or
 * iframe. Web context IDs are assigned by the host.
 *
 * @example
 * ```ts
 * import type { ContextId } from '@prismtest/core';
 *
 * const native: ContextId = 'native';
 * const frame: ContextId = 'web:9A3F/frame-2';
 * ```
 */
export type ContextId = 'native' | `web:${string}`;

/**
 * Tells whether a context ID names web content (a page, WebView or frame).
 *
 * @param context - A context ID from a node or a context list.
 * @returns `true` for `web:*` contexts.
 *
 * @example
 * ```ts
 * import { isWebContext } from '@prismtest/core';
 *
 * isWebContext('web:9A3F'); // true
 * isWebContext('native'); // false
 * ```
 */
export function isWebContext(context: string): context is `web:${string}` {
  return context.startsWith('web:') && context.length > 'web:'.length;
}

/**
 * The checked state of a node: `true`, `false`, `'mixed'` (indeterminate), or
 * `null` when the node is not checkable.
 *
 * @example
 * ```ts
 * import type { Checked } from '@prismtest/core';
 *
 * const partly: Checked = 'mixed';
 * ```
 */
export type Checked = boolean | 'mixed' | null;

/**
 * Every field of a normalised UI node except `children` (protocol.md §2.2,
 * wire type `NodeBase`). Booleans are always present.
 *
 * Invariant: when `password` is `true`, `text` and `value` are `null` and
 * `raw` carries no `text` or `value` key (protocol.md §2.9, §11). Drivers MUST
 * uphold it; reporters may rely on it.
 *
 * @example
 * ```ts
 * import type { UiNodeBase } from '@prismtest/core';
 *
 * function describe(node: UiNodeBase): string {
 *   return `${node.role} "${node.name ?? node.text ?? ''}"`;
 * }
 * ```
 */
export interface UiNodeBase {
  /** Unique within its snapshot; only meaningful together with the snapshot ID. */
  readonly id: string;
  readonly role: Role;
  /** Accessible name (what a screen reader announces as the label). */
  readonly name: string | null;
  /** Text the node renders, normalised (protocol.md §2.5, §3.4). */
  readonly text: string | null;
  /** Current value of editables, sliders and pickers. `null` for password nodes. */
  readonly value: string | null;
  /** Placeholder, hint or tooltip. */
  readonly hint?: string | null;
  /** `resource-id` (Android), `accessibilityIdentifier` (iOS), `data-testid` (web). Never `''`. */
  readonly testId: string | null;
  /** Android class name, `XCUIElementType…` name, or lower-case HTML tag. */
  readonly nativeType: string;
  /** Bounds in DIP. */
  readonly bounds: Rect;
  readonly visible: boolean;
  /** `visible` and intersects the screen (native) or the context's viewport (web). */
  readonly onScreen: boolean;
  /** The node itself accepts input; ancestors are not considered. */
  readonly enabled: boolean;
  /** Reliable only when the session has capability `state.focused`. */
  readonly focused: boolean;
  readonly selected: boolean;
  readonly checked: Checked;
  /** `null` when not expandable. */
  readonly expanded?: boolean | null;
  readonly scrollable: boolean;
  readonly password: boolean;
  /** Web content exposed through the native accessibility tree under a `webview` node. */
  readonly webContent: boolean;
  /** Heading level (web only in v1). */
  readonly level?: number;
  readonly context: ContextId;
  /** Number of children; present when `children` is omitted (find matches). */
  readonly childCount?: number;
  /** Platform attributes for debugging, healing and native predicates. Never required. */
  readonly raw?: Readonly<Record<string, unknown>>;
}

/**
 * A node of a snapshot, with its children back to front in z-order, then
 * reading order (wire type `Node`).
 *
 * @example
 * ```ts
 * import type { UiNode } from '@prismtest/core';
 *
 * function* walk(node: UiNode): Generator<UiNode> {
 *   yield node;
 *   for (const child of node.children) yield* walk(child);
 * }
 * ```
 */
export interface UiNode extends UiNodeBase {
  readonly children: readonly UiNode[];
}

/**
 * A node as returned in a find match: no `children`, but always `childCount`.
 *
 * @example
 * ```ts
 * import type { MatchedNode } from '@prismtest/core';
 *
 * const isLeaf = (node: MatchedNode) => node.childCount === 0;
 * ```
 */
export type MatchedNode = Omit<UiNodeBase, 'childCount'> & { readonly childCount: number };

/**
 * Idle signal: whether the UI was quiet when the driver captured or acted
 * (protocol.md §9.1). Not settled is not an error.
 *
 * @example
 * ```ts
 * import type { Idle } from '@prismtest/core';
 *
 * const idle: Idle = { settled: true, waitedMs: 50 };
 * ```
 */
export interface Idle {
  readonly settled: boolean;
  readonly waitedMs: number;
  readonly animating?: boolean;
}

/**
 * Asks the driver to wait for the UI to be quiet for `quietMs`, up to
 * `maxWaitMs`, before capturing, matching or running action checks.
 *
 * @example
 * ```ts
 * import type { Settle } from '@prismtest/core';
 *
 * const settle: Settle = { maxWaitMs: 200, quietMs: 50 };
 * ```
 */
export interface Settle {
  readonly maxWaitMs: number;
  readonly quietMs?: number;
}

/**
 * One capture of the UI at one moment (protocol.md §2.1, wire type `Snapshot`).
 *
 * @example
 * ```ts
 * import type { UiSnapshot } from '@prismtest/core';
 *
 * function summary(s: UiSnapshot): string {
 *   return `${s.platform} ${s.screen.width}x${s.screen.height}, ${s.nodeCount} nodes`;
 * }
 * ```
 */
export interface UiSnapshot {
  /** `<instanceId>.<local id>`, for example `k7q2xm4p.s-3`. */
  readonly snapshotId: string;
  /** ISO 8601 UTC with milliseconds. */
  readonly capturedAt: string;
  readonly platform: Platform;
  readonly screen: ScreenInfo;
  readonly idle?: Idle;
  /** Synthetic `screen` node on native; `document` on web. */
  readonly root: UiNode;
  readonly nodeCount: number;
  /** `true` if `maxDepth` or `maxNodes` cut the tree. */
  readonly truncated: boolean;
}

/**
 * Points at one node of one snapshot (wire type `NodeRef`).
 *
 * @example
 * ```ts
 * import type { NodeRef } from '@prismtest/core';
 *
 * const ref: NodeRef = { snapshotId: 'k7q2xm4p.s-4', nodeId: 'n5' };
 * ```
 */
export interface NodeRef {
  readonly snapshotId: string;
  readonly nodeId: string;
}

/**
 * The fields a driver compares to decide whether a node reference is stale
 * (protocol.md §7.2). Sent as `details.expected` / `details.actual` with
 * `stale-node` errors.
 *
 * @example
 * ```ts
 * import type { NodeFingerprint } from '@prismtest/core';
 *
 * const fp: NodeFingerprint = {
 *   role: 'listitem', testId: 'order_row', nativeType: 'android.widget.LinearLayout',
 *   text: null, name: 'Order #1041',
 * };
 * ```
 */
export interface NodeFingerprint {
  readonly role: Role;
  readonly testId: string | null;
  readonly nativeType: string;
  readonly text: string | null;
  readonly name: string | null;
}

/**
 * One ancestor of a matched node, root first (wire type `Ancestor`).
 *
 * @example
 * ```ts
 * import type { Ancestor } from '@prismtest/core';
 *
 * const a: Ancestor = { role: 'window', nativeType: 'prism.Window', testId: null, name: 'Shop', index: 0 };
 * ```
 */
export interface Ancestor {
  readonly role: Role;
  readonly nativeType: string;
  readonly testId?: string | null;
  readonly name?: string | null;
  /** Index of this ancestor among its parent's children. */
  readonly index: number;
}

/**
 * A node matched by a locator, with its position for healing fingerprints
 * (protocol.md §10.1, wire type `Match`).
 *
 * @example
 * ```ts
 * import type { NodeMatch } from '@prismtest/core';
 *
 * const where = (m: NodeMatch) => m.path.join('/');
 * ```
 */
export interface NodeMatch {
  readonly node: MatchedNode;
  /** Child-index path from the root, for example `[0, 0, 3, 1]`. */
  readonly path: readonly number[];
  /** Children of the parent, including this node. */
  readonly siblingCount: number;
  /** Root-to-parent chain; present when requested and on action matches. */
  readonly ancestors?: readonly Ancestor[];
}

/**
 * Result of a find (wire result of `element.find`).
 *
 * @example
 * ```ts
 * import type { FindResult } from '@prismtest/core';
 *
 * const only = (r: FindResult) => (r.total === 1 ? r.matches[0] : undefined);
 * ```
 */
export interface FindResult {
  /** The snapshot the matches' node IDs belong to. */
  readonly snapshotId: string;
  /** At most `max` matches, in document order. */
  readonly matches: readonly NodeMatch[];
  /** All matches, including those beyond `max`. */
  readonly total: number;
  /** `true` if the searched tree was truncated. */
  readonly truncated: boolean;
  /** Number of nodes searched. */
  readonly searched: number;
  readonly idle?: Idle;
}

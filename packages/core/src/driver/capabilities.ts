import type { OpenString } from './open-string.js';

/**
 * Capabilities named by protocol 1.0. A session advertises the ones it
 * supports; core uses them to pick a fast path or a fallback.
 *
 * | Capability | Meaning |
 * | --- | --- |
 * | `find.agent` | The driver resolves locators itself (`find`, locator targets) |
 * | `find.regex` | Regex text matches in the portable subset are resolved by the driver |
 * | `scroll.until` | `scroll({ until })` runs in the driver; otherwise core loops |
 * | `action.pinch` | `pinch` is available |
 * | `locator.native.uiautomator`, `locator.native.nspredicate`, `locator.native.classchain` | That `native` locator engine is available |
 * | `alerts.system` | System alerts (permission prompts) are visible in the tree and to alert commands |
 * | `idle.signal` | `settle` and `waitForIdle` report a real idle signal |
 * | `idle.noImplicit` | The platform's implicit waits are switched off (protocol.md §9.1) |
 * | `state.focused` | `focused` on nodes is reliable |
 * | `tree.persistentIds` | Node IDs are stable across snapshots |
 * | `tree.diff` | Snapshots can be returned as diffs (phase 3; host drivers apply them) |
 *
 * @example
 * ```ts
 * import { KNOWN_CAPABILITIES } from '@prismtest/core';
 *
 * KNOWN_CAPABILITIES.includes('find.agent'); // true
 * ```
 */
export const KNOWN_CAPABILITIES = [
  'find.agent',
  'find.regex',
  'scroll.until',
  'action.pinch',
  'locator.native.uiautomator',
  'locator.native.nspredicate',
  'locator.native.classchain',
  'alerts.system',
  'idle.signal',
  'idle.noImplicit',
  'state.focused',
  'tree.persistentIds',
  'tree.diff',
] as const;

/**
 * A capability named by protocol 1.0.
 *
 * @example
 * ```ts
 * import type { KnownCapability } from '@prismtest/core';
 *
 * const cap: KnownCapability = 'state.focused';
 * ```
 */
export type KnownCapability = (typeof KNOWN_CAPABILITIES)[number];

/**
 * A capability string. Open: newer drivers may advertise more.
 *
 * @example
 * ```ts
 * import type { Capability } from '@prismtest/core';
 *
 * const caps: ReadonlySet<Capability> = new Set(['find.agent', 'idle.signal']);
 * caps.has('find.agent'); // true
 * ```
 */
export type Capability = OpenString<KnownCapability>;

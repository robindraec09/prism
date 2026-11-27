import type { OpenString } from './open-string.js';
import type { Role } from './tree.js';

/**
 * A regular expression in wire form. Only flag `i` is portable
 * (protocol.md §3.4).
 *
 * @example
 * ```ts
 * import type { RegexSpec } from '@prismtest/core';
 *
 * const orderId: RegexSpec = { source: '^Order #\\d+$', flags: 'i' };
 * ```
 */
export interface RegexSpec {
  readonly source: string;
  readonly flags?: '' | 'i';
}

/**
 * Matches node text by substring or exact string.
 *
 * @example
 * ```ts
 * import type { PlainTextMatch } from '@prismtest/core';
 *
 * const m: PlainTextMatch = { text: 'Sign in', exact: true };
 * ```
 */
export interface PlainTextMatch {
  readonly text: string;
  /** `true`: whole string, case-sensitive. Default: case-insensitive substring after normalisation. */
  readonly exact?: boolean;
  readonly regex?: never;
}

/**
 * Matches node text with a regular expression.
 *
 * @example
 * ```ts
 * import type { RegexTextMatch } from '@prismtest/core';
 *
 * const m: RegexTextMatch = { regex: { source: '^Order #\\d+$' } };
 * ```
 */
export interface RegexTextMatch {
  readonly regex: RegexSpec;
  readonly text?: never;
  readonly exact?: never;
}

/**
 * How a locator compares strings (wire type `TextMatch`): either plain text or
 * a regex, never both.
 *
 * @example
 * ```ts
 * import type { TextMatch } from '@prismtest/core';
 *
 * const loose: TextMatch = { text: 'sign in' };
 * const pattern: TextMatch = { regex: { source: 'sign (in|up)', flags: 'i' } };
 * ```
 */
export type TextMatch = PlainTextMatch | RegexTextMatch;

/**
 * Tells whether a text match is a regex match.
 *
 * @param match - A text match.
 * @returns `true` for `{ regex }` matches.
 *
 * @example
 * ```ts
 * import { isRegexTextMatch } from '@prismtest/core';
 *
 * isRegexTextMatch({ regex: { source: 'a+' } }); // true
 * isRegexTextMatch({ text: 'a' }); // false
 * ```
 */
export function isRegexTextMatch(match: TextMatch): match is RegexTextMatch {
  return match.regex !== undefined;
}

/**
 * Drops matches that fail these node state tests (protocol.md §3.3 step 3).
 *
 * @example
 * ```ts
 * import type { LocatorFilter } from '@prismtest/core';
 *
 * const shown: LocatorFilter = { visible: true, onScreen: true };
 * ```
 */
export interface LocatorFilter {
  readonly visible?: boolean;
  readonly enabled?: boolean;
  readonly onScreen?: boolean;
}

/**
 * Fields every locator kind may carry (wire type `LocatorCommon`).
 *
 * @example
 * ```ts
 * import type { LocatorOptions } from '@prismtest/core';
 *
 * const lastVisible: LocatorOptions = { nth: -1, filter: { visible: true } };
 * ```
 */
export interface LocatorOptions {
  /** Picks one match, 0-based; negative counts from the end. */
  readonly nth?: number;
  /** Also match `webContent` nodes in the native tree (protocol.md §2.8). */
  readonly includeWebContent?: boolean;
  readonly filter?: LocatorFilter;
}

/**
 * Matches by role and, optionally, accessible name (`by.role`).
 *
 * @example
 * ```ts
 * import type { RoleLocator } from '@prismtest/core';
 *
 * const signIn: RoleLocator = { kind: 'role', role: 'button', name: { text: 'Sign in' } };
 * ```
 */
export interface RoleLocator extends LocatorOptions {
  readonly kind: 'role';
  readonly role: Role;
  readonly name?: TextMatch;
}

/**
 * Matches node text, falling back to the accessible name (`by.text`).
 * Innermost rule applies (protocol.md §3.3).
 *
 * @example
 * ```ts
 * import type { TextLocator } from '@prismtest/core';
 *
 * const orders: TextLocator = { kind: 'text', text: 'My orders' };
 * ```
 */
export type TextLocator = LocatorOptions & { readonly kind: 'text' } & TextMatch;

/**
 * Matches the accessible name (`by.label`). Innermost rule applies.
 *
 * @example
 * ```ts
 * import type { LabelLocator } from '@prismtest/core';
 *
 * const email: LabelLocator = { kind: 'label', text: 'Email', exact: true };
 * ```
 */
export type LabelLocator = LocatorOptions & { readonly kind: 'label' } & TextMatch;

/**
 * Matches the test ID (`by.testId`). On Android it also matches the part of
 * `resource-id` after `:id/`.
 *
 * @example
 * ```ts
 * import type { TestIdLocator } from '@prismtest/core';
 *
 * const signIn: TestIdLocator = { kind: 'testId', value: 'sign_in' };
 * ```
 */
export interface TestIdLocator extends LocatorOptions {
  readonly kind: 'testId';
  readonly value: string;
}

/**
 * A CSS selector, evaluated by the browser. Web contexts only.
 *
 * @example
 * ```ts
 * import type { CssLocator } from '@prismtest/core';
 *
 * const submit: CssLocator = { kind: 'css', selector: 'form button[type=submit]' };
 * ```
 */
export interface CssLocator extends LocatorOptions {
  readonly kind: 'css';
  readonly selector: string;
}

/**
 * An XPath 1.0 expression: evaluated by the browser on web, and host-side on
 * the XML projection of native trees (protocol.md §3.5).
 *
 * @example
 * ```ts
 * import type { XPathLocator } from '@prismtest/core';
 *
 * const button: XPathLocator = { kind: 'xpath', expr: '//android.widget.Button[@text="OK"]' };
 * ```
 */
export interface XPathLocator extends LocatorOptions {
  readonly kind: 'xpath';
  readonly expr: string;
}

/**
 * Native query engines defined by protocol 1.0.
 *
 * @example
 * ```ts
 * import type { KnownNativeEngine } from '@prismtest/core';
 *
 * const engine: KnownNativeEngine = 'nspredicate';
 * ```
 */
export type KnownNativeEngine = 'uiautomator' | 'nspredicate' | 'classchain';

/**
 * A native query engine name. Open string.
 *
 * @example
 * ```ts
 * import type { NativeEngine } from '@prismtest/core';
 *
 * const engine: NativeEngine = 'uiautomator';
 * ```
 */
export type NativeEngine = OpenString<KnownNativeEngine>;

/**
 * A platform-native query, resolved only by the on-device agent.
 *
 * @example
 * ```ts
 * import type { NativeLocator } from '@prismtest/core';
 *
 * const ok: NativeLocator = { kind: 'native', engine: 'nspredicate', query: "label == 'OK'" };
 * ```
 */
export interface NativeLocator extends LocatorOptions {
  readonly kind: 'native';
  readonly engine: NativeEngine;
  readonly query: string;
}

/**
 * Nodes matched by every locator in `of`.
 *
 * @typeParam L - Locator type of the operands.
 *
 * @example
 * ```ts
 * import type { AndLocator, ResolvedLocator } from '@prismtest/core';
 *
 * const enabledSave: AndLocator<ResolvedLocator> = {
 *   kind: 'and',
 *   of: [{ kind: 'role', role: 'button' }, { kind: 'text', text: 'Save' }],
 * };
 * ```
 */
export interface AndLocator<L> extends LocatorOptions {
  readonly kind: 'and';
  readonly of: readonly [L, ...L[]];
}

/**
 * Nodes matched by any locator in `of`.
 *
 * @typeParam L - Locator type of the operands.
 *
 * @example
 * ```ts
 * import type { OrLocator, ResolvedLocator } from '@prismtest/core';
 *
 * const confirm: OrLocator<ResolvedLocator> = {
 *   kind: 'or',
 *   of: [{ kind: 'text', text: 'OK' }, { kind: 'text', text: 'Continue' }],
 * };
 * ```
 */
export interface OrLocator<L> extends LocatorOptions {
  readonly kind: 'or';
  readonly of: readonly [L, ...L[]];
}

/**
 * `target` matches that are descendants of any `scope` match.
 *
 * @typeParam L - Locator type of `scope` and `target`.
 *
 * @example
 * ```ts
 * import type { ResolvedLocator, WithinLocator } from '@prismtest/core';
 *
 * const dialogOk: WithinLocator<ResolvedLocator> = {
 *   kind: 'within',
 *   scope: { kind: 'role', role: 'dialog' },
 *   target: { kind: 'role', role: 'button', name: { text: 'OK' } },
 * };
 * ```
 */
export interface WithinLocator<L> extends LocatorOptions {
  readonly kind: 'within';
  readonly scope: L;
  readonly target: L;
}

/**
 * Fields shared by every shape of {@link PlatformLocator}: all four branches,
 * each optional.
 *
 * @example
 * ```ts
 * import type { PlatformLocatorBranches } from '@prismtest/core';
 *
 * const branchNames = (p: PlatformLocatorBranches) =>
 *   (['web', 'android', 'ios', 'default'] as const).filter((k) => p[k] !== undefined);
 * ```
 */
export interface PlatformLocatorBranches extends LocatorOptions {
  readonly kind: 'platform';
  /** Used in `web:*` contexts. */
  readonly web?: Locator;
  /** Used in the native context on Android. */
  readonly android?: Locator;
  /** Used in the native context on iOS. */
  readonly ios?: Locator;
  /** Used when the context's own branch is absent. */
  readonly default?: Locator;
}

// One shape per required branch; their union makes "at least one branch" a
// type error instead of a runtime surprise (schema: anyOf required).
interface PlatformLocatorWithWeb extends PlatformLocatorBranches {
  readonly web: Locator;
}
interface PlatformLocatorWithAndroid extends PlatformLocatorBranches {
  readonly android: Locator;
}
interface PlatformLocatorWithIos extends PlatformLocatorBranches {
  readonly ios: Locator;
}
interface PlatformLocatorWithDefault extends PlatformLocatorBranches {
  readonly default: Locator;
}

/**
 * Per-platform locator overrides in one definition (CORE-3); at least one
 * branch is required. Resolved by the host for the context being searched (`web`, `android` or `ios`, else
 * `default`); never sent to a driver or agent.
 *
 * @example
 * ```ts
 * import type { PlatformLocator } from '@prismtest/core';
 *
 * const back: PlatformLocator = {
 *   kind: 'platform',
 *   web: { kind: 'css', selector: 'a.back' },
 *   default: { kind: 'role', role: 'button', name: { text: 'Back' } },
 * };
 * ```
 */
export type PlatformLocator =
  | PlatformLocatorWithWeb
  | PlatformLocatorWithAndroid
  | PlatformLocatorWithIos
  | PlatformLocatorWithDefault;

/**
 * A locator with no `platform` kind anywhere in it: what drivers receive
 * after core has picked the platform branch (protocol.md §3.2). This is the
 * locator AST sent to agents.
 *
 * @example
 * ```ts
 * import type { ResolvedLocator } from '@prismtest/core';
 *
 * const loc: ResolvedLocator = {
 *   kind: 'within',
 *   scope: { kind: 'testId', value: 'cart' },
 *   target: { kind: 'text', text: 'Remove', nth: 0 },
 * };
 * ```
 */
export type ResolvedLocator =
  | RoleLocator
  | TextLocator
  | LabelLocator
  | TestIdLocator
  | CssLocator
  | XPathLocator
  | NativeLocator
  | AndLocator<ResolvedLocator>
  | OrLocator<ResolvedLocator>
  | WithinLocator<ResolvedLocator>;

/**
 * Any locator as written by a test: the full locator AST of protocol.md §3.1,
 * including `platform` overrides at any depth. `by.*` (P0-04) builds these.
 *
 * @example
 * ```ts
 * import type { Locator } from '@prismtest/core';
 *
 * const signIn: Locator = {
 *   kind: 'platform',
 *   android: { kind: 'testId', value: 'sign_in' },
 *   ios: { kind: 'testId', value: 'signInButton' },
 *   web: { kind: 'role', role: 'button', name: { text: 'Sign in' } },
 * };
 * ```
 */
export type Locator =
  | RoleLocator
  | TextLocator
  | LabelLocator
  | TestIdLocator
  | CssLocator
  | XPathLocator
  | NativeLocator
  | AndLocator<Locator>
  | OrLocator<Locator>
  | WithinLocator<Locator>
  | PlatformLocator;

/**
 * Every locator `kind` of protocol 1.0.
 *
 * @example
 * ```ts
 * import type { LocatorKind } from '@prismtest/core';
 *
 * const kind: LocatorKind = 'testId';
 * ```
 */
export type LocatorKind = Locator['kind'];

/**
 * Tells whether a locator is a per-platform override (top level only).
 *
 * @param locator - Any locator.
 * @returns `true` if `locator.kind` is `'platform'`.
 *
 * @example
 * ```ts
 * import { isPlatformLocator } from '@prismtest/core';
 *
 * isPlatformLocator({ kind: 'platform', default: { kind: 'text', text: 'OK' } }); // true
 * ```
 */
export function isPlatformLocator(locator: Locator): locator is PlatformLocator {
  return locator.kind === 'platform';
}

/**
 * Tells whether a locator contains no `platform` kind at any depth, so it can
 * be passed to a driver as a {@link ResolvedLocator}.
 *
 * @param locator - Any locator.
 * @returns `true` if no `platform` node appears in the locator tree.
 *
 * @example
 * ```ts
 * import { isResolvedLocator } from '@prismtest/core';
 *
 * isResolvedLocator({ kind: 'text', text: 'OK' }); // true
 * isResolvedLocator({
 *   kind: 'within',
 *   scope: { kind: 'platform', default: { kind: 'role', role: 'dialog' } },
 *   target: { kind: 'text', text: 'OK' },
 * }); // false
 * ```
 */
export function isResolvedLocator(locator: Locator): locator is ResolvedLocator {
  switch (locator.kind) {
    case 'platform':
      return false;
    case 'and':
    case 'or':
      return locator.of.every(isResolvedLocator);
    case 'within':
      return isResolvedLocator(locator.scope) && isResolvedLocator(locator.target);
    default:
      return true;
  }
}

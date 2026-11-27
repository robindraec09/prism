import type { OpenString } from './open-string.js';

/**
 * Error codes defined by protocol 1.0 (protocol.md §6.3). Kept in sync with
 * `KnownErrorCode` in `docs/design/protocol.schema.json` by a unit test.
 *
 * @example
 * ```ts
 * import { KNOWN_ERROR_CODES } from '@prismtest/core';
 *
 * KNOWN_ERROR_CODES.includes('stale-node'); // true
 * ```
 */
export const KNOWN_ERROR_CODES = [
  'invalid-request',
  'unknown-command',
  'unsupported',
  'unauthorized',
  'version-mismatch',
  'session-not-found',
  'session-active',
  'busy',
  'cancelled',
  'element-not-found',
  'ambiguous',
  'stale-node',
  'stale-snapshot',
  'not-interactable',
  'context-not-found',
  'timeout',
  'app-not-running',
  'app-crashed',
  'agent-crashed',
  'internal',
] as const;

/**
 * An error code defined by protocol 1.0.
 *
 * @example
 * ```ts
 * import type { KnownErrorCode } from '@prismtest/core';
 *
 * const code: KnownErrorCode = 'element-not-found';
 * ```
 */
export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

/**
 * An error code. Open string: for an unknown code, rely on the error's
 * `retryable` flag (protocol.md §5.2).
 *
 * @example
 * ```ts
 * import type { ErrorCode } from '@prismtest/core';
 *
 * const code: ErrorCode = 'busy';
 * ```
 */
export type ErrorCode = OpenString<KnownErrorCode>;

/**
 * Reasons for `not-interactable`, in the precedence order drivers use when
 * several checks fail (protocol.md §9.2), followed by `keyboard-unavailable`,
 * which only typing produces.
 *
 * @example
 * ```ts
 * import { NOT_INTERACTABLE_REASONS } from '@prismtest/core';
 *
 * NOT_INTERACTABLE_REASONS[0]; // 'off-screen': reported first
 * ```
 */
export const NOT_INTERACTABLE_REASONS = [
  'off-screen',
  'not-visible',
  'zero-size',
  'disabled',
  'keyboard-covering',
  'system-alert',
  'obscured',
  'unstable',
  'keyboard-unavailable',
] as const;

/**
 * A `not-interactable` reason defined by protocol 1.0.
 *
 * @example
 * ```ts
 * import type { KnownNotInteractableReason } from '@prismtest/core';
 *
 * const r: KnownNotInteractableReason = 'obscured';
 * ```
 */
export type KnownNotInteractableReason = (typeof NOT_INTERACTABLE_REASONS)[number];

/**
 * A `not-interactable` reason. Open string.
 *
 * @example
 * ```ts
 * import type { NotInteractableReason } from '@prismtest/core';
 *
 * const r: NotInteractableReason = 'disabled';
 * ```
 */
export type NotInteractableReason = OpenString<KnownNotInteractableReason>;

const knownErrorCodes: ReadonlySet<string> = new Set(KNOWN_ERROR_CODES);

/**
 * Tells whether `code` is defined by protocol 1.0.
 *
 * @param code - Any error code.
 * @returns `true` if `code` is one of {@link KNOWN_ERROR_CODES}.
 *
 * @example
 * ```ts
 * import { isKnownErrorCode } from '@prismtest/core';
 *
 * isKnownErrorCode('timeout'); // true
 * isKnownErrorCode('quota-exceeded'); // false
 * ```
 */
export function isKnownErrorCode(code: string): code is KnownErrorCode {
  return knownErrorCodes.has(code);
}

const retryableByDefault: ReadonlySet<string> = new Set<KnownErrorCode>([
  'busy',
  'element-not-found',
  'stale-node',
  'stale-snapshot',
  'not-interactable',
  'context-not-found',
  'agent-crashed',
]);

/**
 * The `retryable` value protocol.md §6.3 prescribes for an error that a host
 * driver raises itself (agents send their own flag). `timeout` depends on the
 * command and returns `false` here: pass `retryable: true` explicitly for
 * commands that change no state. Unknown codes return `false`.
 *
 * @param code - The error code.
 * @param reason - The `not-interactable` reason, if any.
 * @returns Whether the host may retry.
 *
 * @example
 * ```ts
 * import { defaultRetryable } from '@prismtest/core';
 *
 * defaultRetryable('element-not-found'); // true
 * defaultRetryable('not-interactable', 'keyboard-unavailable'); // false
 * defaultRetryable('ambiguous'); // false
 * ```
 */
export function defaultRetryable(code: ErrorCode, reason?: NotInteractableReason): boolean {
  if (code === 'not-interactable' && reason === 'keyboard-unavailable') {
    return false;
  }
  return retryableByDefault.has(code);
}

/**
 * An error object as it travels on the wire (protocol.md §6.2).
 *
 * @example
 * ```ts
 * import type { WireError } from '@prismtest/core';
 *
 * const e: WireError = {
 *   code: 'not-interactable',
 *   message: 'Button "Sign in" is covered by the keyboard. Hide the keyboard first.',
 *   retryable: true,
 *   details: { reason: 'keyboard-covering' },
 * };
 * ```
 */
export interface WireError {
  readonly code: ErrorCode;
  /** One sentence: what was tried, what was found, what to do next. */
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Options for constructing a {@link PrismError}.
 *
 * @example
 * ```ts
 * import type { PrismErrorOptions } from '@prismtest/core';
 *
 * const opts: PrismErrorOptions = {
 *   code: 'unsupported',
 *   message: 'by.css() works in web contexts only; this is the native context. Use by.testId() instead.',
 * };
 * ```
 */
export interface PrismErrorOptions {
  readonly code: ErrorCode;
  /**
   * What was tried, what was found and what to do next (PRD principle 4).
   */
  readonly message: string;
  /** Default: {@link defaultRetryable} for `code` and `reason`. */
  readonly retryable?: boolean;
  /** For `not-interactable`. Default: `details.reason` when it is a string. */
  readonly reason?: NotInteractableReason;
  /** Structured context, for example `locator`, `nearest`, `expected`/`actual`. */
  readonly details?: Readonly<Record<string, unknown>>;
  /** The underlying error, if any. */
  readonly cause?: unknown;
}

/**
 * The error every driver rejects with. It carries the protocol error code, so
 * core's auto-wait (P0-05) can decide what to retry, and reporters can show
 * structured details.
 *
 * Drivers that talk to an agent convert wire errors with
 * {@link PrismError.fromWire}; drivers that talk to a browser directly raise
 * the same codes (protocol.md §4.5).
 *
 * @example
 * ```ts
 * import { PrismError } from '@prismtest/core';
 *
 * throw new PrismError({
 *   code: 'not-interactable',
 *   reason: 'disabled',
 *   message: 'Button "Pay" is disabled. Wait for the form to be valid, or check the test data.',
 * });
 * ```
 */
export class PrismError extends Error {
  override readonly name = 'PrismError';
  /** Protocol error code (protocol.md §6.3). */
  readonly code: ErrorCode;
  /** Whether the host may retry the failed call. */
  readonly retryable: boolean;
  /** The `not-interactable` reason, when there is one. */
  readonly reason: NotInteractableReason | undefined;
  /** Structured details; empty object when none were given. */
  readonly details: Readonly<Record<string, unknown>>;

  /**
   * @param options - Code, message and optional details.
   *
   * @example
   * ```ts
   * import { PrismError } from '@prismtest/core';
   *
   * const err = new PrismError({ code: 'ambiguous', message: '2 buttons match "OK". Add nth or a scope.' });
   * err.retryable; // false
   * ```
   */
  constructor(options: PrismErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = options.code;
    this.details = options.details ?? {};
    const detailReason = this.details['reason'];
    this.reason = options.reason ?? (typeof detailReason === 'string' ? detailReason : undefined);
    this.retryable = options.retryable ?? defaultRetryable(this.code, this.reason);
  }

  /**
   * Builds a `PrismError` from a wire error, keeping the agent's `retryable`
   * flag and lifting `details.reason`.
   *
   * @param error - The `error` object of a failed response.
   * @returns The equivalent `PrismError`.
   *
   * @example
   * ```ts
   * import { PrismError } from '@prismtest/core';
   *
   * const err = PrismError.fromWire({
   *   code: 'not-interactable',
   *   message: 'Button "Sign in" is covered by the keyboard. Hide the keyboard first.',
   *   retryable: true,
   *   details: { reason: 'keyboard-covering' },
   * });
   * err.reason; // 'keyboard-covering'
   * ```
   */
  static fromWire(error: WireError): PrismError {
    return new PrismError({
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.details === undefined ? {} : { details: error.details }),
    });
  }

  /**
   * Converts the error back to its wire shape, for traces and reports.
   *
   * @returns The wire error.
   *
   * @example
   * ```ts
   * import { PrismError } from '@prismtest/core';
   *
   * JSON.stringify(new PrismError({ code: 'busy', message: 'Agent busy with r-12 for 4 s. Retrying when it is free.' }));
   * // {"code":"busy","message":"…","retryable":true,"details":{}}
   * ```
   */
  toJSON(): WireError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

/**
 * Tells whether `value` is a {@link PrismError}, optionally with a given code.
 * Also recognises errors from another copy of `@prismtest/core` (for example
 * an ESM and a CommonJS copy in one process), where `instanceof` fails.
 *
 * @param value - Anything caught.
 * @param code - If given, the error must also have this code.
 * @returns `true` if `value` is a matching `PrismError`.
 *
 * @example
 * ```ts
 * import { isPrismError } from '@prismtest/core';
 *
 * try {
 *   await session.tap({ locator: { kind: 'text', text: 'OK' } });
 * } catch (err) {
 *   if (isPrismError(err, 'element-not-found')) {
 *     // retry later
 *   } else {
 *     throw err;
 *   }
 * }
 * ```
 */
export function isPrismError(value: unknown, code?: ErrorCode): value is PrismError {
  const isOne =
    value instanceof PrismError ||
    (value instanceof Error &&
      value.name === 'PrismError' &&
      typeof (value as Partial<PrismError>).code === 'string' &&
      typeof (value as Partial<PrismError>).retryable === 'boolean');
  return isOne && (code === undefined || (value as PrismError).code === code);
}

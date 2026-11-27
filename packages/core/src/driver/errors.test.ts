import { describe, expect, it } from 'vitest';

import {
  KNOWN_ERROR_CODES,
  PrismError,
  defaultRetryable,
  isKnownErrorCode,
  isPrismError,
  type KnownErrorCode,
} from '../index.js';

const message =
  'No node matched role=button name~"Log in" in the native context (6 nodes searched). Check the label, or use by.testId().';

describe('defaultRetryable', () => {
  // protocol.md §6.3, "Retryable" column, for errors the host raises itself.
  const retryable: readonly KnownErrorCode[] = [
    'busy',
    'element-not-found',
    'stale-node',
    'stale-snapshot',
    'not-interactable',
    'context-not-found',
    'agent-crashed',
  ];

  it.each([...KNOWN_ERROR_CODES])('follows protocol.md §6.3 for %s', (code) => {
    expect(defaultRetryable(code)).toBe(retryable.includes(code));
  });

  it('treats keyboard-unavailable as final', () => {
    expect(defaultRetryable('not-interactable', 'keyboard-unavailable')).toBe(false);
    expect(defaultRetryable('not-interactable', 'obscured')).toBe(true);
  });

  it('does not retry unknown codes or timeouts by default', () => {
    expect(defaultRetryable('quota-exceeded')).toBe(false);
    expect(defaultRetryable('timeout')).toBe(false);
  });
});

describe('isKnownErrorCode', () => {
  it('accepts protocol codes and rejects others', () => {
    expect(isKnownErrorCode('ambiguous')).toBe(true);
    expect(isKnownErrorCode('quota-exceeded')).toBe(false);
  });
});

describe('PrismError', () => {
  it('carries code, message and default retryable', () => {
    const err = new PrismError({ code: 'element-not-found', message });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PrismError');
    expect(err.message).toBe(message);
    expect(err.code).toBe('element-not-found');
    expect(err.retryable).toBe(true);
    expect(err.reason).toBeUndefined();
    expect(err.details).toEqual({});
  });

  it('lets an explicit retryable override the default', () => {
    expect(new PrismError({ code: 'timeout', message, retryable: true }).retryable).toBe(true);
    expect(new PrismError({ code: 'busy', message, retryable: false }).retryable).toBe(false);
  });

  it('takes the reason from options, else from details', () => {
    const explicit = new PrismError({ code: 'not-interactable', message, reason: 'disabled' });
    expect(explicit.reason).toBe('disabled');

    const fromDetails = new PrismError({
      code: 'not-interactable',
      message,
      details: { reason: 'keyboard-unavailable' },
    });
    expect(fromDetails.reason).toBe('keyboard-unavailable');
    expect(fromDetails.retryable).toBe(false);

    const nonString = new PrismError({ code: 'internal', message, details: { reason: 42 } });
    expect(nonString.reason).toBeUndefined();
  });

  it('keeps the cause', () => {
    const cause = new Error('ECONNREFUSED');
    expect(new PrismError({ code: 'agent-crashed', message, cause }).cause).toBe(cause);
    expect('cause' in new PrismError({ code: 'agent-crashed', message })).toBe(false);
  });

  it('converts from a wire error, keeping the agent’s retryable flag', () => {
    const err = PrismError.fromWire({
      code: 'timeout',
      message: 'tree.get took longer than 10000 ms. The app may be busy; retrying once.',
      retryable: true,
    });
    expect(err.code).toBe('timeout');
    expect(err.retryable).toBe(true);
    expect(err.details).toEqual({});

    const withReason = PrismError.fromWire({
      code: 'not-interactable',
      message: 'Button "Sign in" is covered by the keyboard. Hide the keyboard first.',
      retryable: true,
      details: { reason: 'keyboard-covering', locator: { kind: 'text', text: 'Sign in' } },
    });
    expect(withReason.reason).toBe('keyboard-covering');
    expect(withReason.details['locator']).toEqual({ kind: 'text', text: 'Sign in' });
  });

  it('accepts codes from newer protocol versions', () => {
    const err = PrismError.fromWire({ code: 'quota-exceeded', message, retryable: true });
    expect(err.code).toBe('quota-exceeded');
    expect(err.retryable).toBe(true);
  });

  it('serialises to its wire shape', () => {
    const err = new PrismError({
      code: 'ambiguous',
      message,
      details: { found: 2 },
    });
    expect(JSON.parse(JSON.stringify(err))).toEqual({
      code: 'ambiguous',
      message,
      retryable: false,
      details: { found: 2 },
    });
  });
});

describe('isPrismError', () => {
  const err = new PrismError({ code: 'stale-node', message });

  it('recognises PrismErrors, optionally by code', () => {
    expect(isPrismError(err)).toBe(true);
    expect(isPrismError(err, 'stale-node')).toBe(true);
    expect(isPrismError(err, 'stale-snapshot')).toBe(false);
  });

  it('recognises a PrismError from another copy of the package', () => {
    const foreign = Object.assign(new Error(message), {
      name: 'PrismError',
      code: 'busy',
      retryable: true,
    });
    expect(isPrismError(foreign)).toBe(true);
    expect(isPrismError(foreign, 'busy')).toBe(true);
  });

  it.each<[string, unknown]>([
    ['a plain Error', new Error(message)],
    ['a look-alike without code', Object.assign(new Error(message), { name: 'PrismError' })],
    ['a plain object', { name: 'PrismError', code: 'busy', retryable: true }],
    ['undefined', undefined],
  ])('rejects %s', (_name, value) => {
    expect(isPrismError(value)).toBe(false);
  });
});

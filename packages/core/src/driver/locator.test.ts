import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  isPlatformLocator,
  isRegexTextMatch,
  isResolvedLocator,
  type Locator,
  type LocatorKind,
  type PlatformLocator,
  type ResolvedLocator,
  type TextMatch,
} from '../index.js';

const platform: PlatformLocator = {
  kind: 'platform',
  android: { kind: 'testId', value: 'sign_in' },
  default: { kind: 'role', role: 'button', name: { text: 'Sign in' } },
};

describe('isRegexTextMatch', () => {
  it('tells regex matches from plain text matches', () => {
    expect(isRegexTextMatch({ regex: { source: '^a+$', flags: 'i' } })).toBe(true);
    expect(isRegexTextMatch({ text: 'a', exact: true })).toBe(false);
  });
});

describe('isPlatformLocator', () => {
  it('checks the top level only', () => {
    expect(isPlatformLocator(platform)).toBe(true);
    expect(isPlatformLocator({ kind: 'within', scope: platform, target: platform })).toBe(false);
  });
});

describe('isResolvedLocator', () => {
  it.each<[string, Locator]>([
    ['role', { kind: 'role', role: 'button' }],
    ['text', { kind: 'text', text: 'OK', nth: -1 }],
    ['label', { kind: 'label', regex: { source: 'e-?mail', flags: 'i' } }],
    ['testId', { kind: 'testId', value: 'sign_in' }],
    ['css', { kind: 'css', selector: 'button' }],
    ['xpath', { kind: 'xpath', expr: '//button' }],
    ['native', { kind: 'native', engine: 'uiautomator', query: 'new UiSelector().text("OK")' }],
    [
      'nested and/or/within',
      {
        kind: 'within',
        scope: { kind: 'role', role: 'dialog' },
        target: {
          kind: 'or',
          of: [
            { kind: 'text', text: 'OK' },
            {
              kind: 'and',
              of: [
                { kind: 'role', role: 'button' },
                { kind: 'text', text: 'Yes' },
              ],
            },
          ],
        },
      },
    ],
  ])('accepts %s', (_name, locator) => {
    expect(isResolvedLocator(locator)).toBe(true);
  });

  it.each<[string, Locator]>([
    ['platform at the top', platform],
    ['platform in and', { kind: 'and', of: [{ kind: 'role', role: 'button' }, platform] }],
    ['platform in or', { kind: 'or', of: [platform] }],
    ['platform as scope', { kind: 'within', scope: platform, target: { kind: 'text', text: 'x' } }],
    [
      'platform as target',
      { kind: 'within', scope: { kind: 'text', text: 'x' }, target: platform },
    ],
  ])('rejects %s', (_name, locator) => {
    expect(isResolvedLocator(locator)).toBe(false);
  });

  it('narrows to ResolvedLocator', () => {
    const locator: Locator = { kind: 'text', text: 'OK' };
    if (isResolvedLocator(locator)) {
      expectTypeOf(locator).toMatchTypeOf<ResolvedLocator>();
    }
  });
});

describe('locator types', () => {
  it('covers every kind of protocol.md §3.1', () => {
    expectTypeOf<LocatorKind>().toEqualTypeOf<
      | 'role'
      | 'text'
      | 'label'
      | 'testId'
      | 'css'
      | 'xpath'
      | 'native'
      | 'and'
      | 'or'
      | 'within'
      | 'platform'
    >();
    expectTypeOf<ResolvedLocator['kind']>().toEqualTypeOf<Exclude<LocatorKind, 'platform'>>();
  });

  it('rejects text matches that are both plain and regex', () => {
    // @ts-expect-error -- text and regex are mutually exclusive (schema TextMatch oneOf)
    const both: TextMatch = { text: 'a', regex: { source: 'a' } };
    expect(both).toBeDefined();
  });

  it('only allows portable regex flags', () => {
    // @ts-expect-error -- only '' and 'i' are portable (protocol.md §3.4)
    const global: TextMatch = { regex: { source: 'a', flags: 'g' } };
    expect(global).toBeDefined();
  });

  it('requires at least one platform branch', () => {
    // @ts-expect-error -- a platform locator needs web, android, ios or default
    const empty: PlatformLocator = { kind: 'platform' };
    expect(empty).toBeDefined();
  });

  it('requires at least one operand in and/or', () => {
    // @ts-expect-error -- `of` has minItems 1 in the schema
    const none: Locator = { kind: 'and', of: [] };
    expect(none).toBeDefined();
  });

  it('keeps platform overrides out of driver-bound locators', () => {
    // @ts-expect-error -- drivers never receive the platform kind
    const forDriver: ResolvedLocator = platform;
    expect(forDriver).toBeDefined();
  });
});

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  KNOWN_ROLES,
  isKnownRole,
  isWebContext,
  normaliseRole,
  type ContextId,
  type KnownRole,
  type MatchedNode,
  type Role,
  type UiNode,
} from '../index.js';

describe('isKnownRole', () => {
  it.each([...KNOWN_ROLES])('accepts the protocol 1.0 role %s', (role) => {
    expect(isKnownRole(role)).toBe(true);
  });

  it.each(['treeitem', 'Button', '', 'menuitemcheckbox'])('rejects %j', (role) => {
    expect(isKnownRole(role)).toBe(false);
  });
});

describe('normaliseRole', () => {
  it('keeps known roles', () => {
    expect(normaliseRole('switch')).toBe('switch');
  });

  it('maps unknown roles to generic (protocol.md §2.3 rule 2)', () => {
    expect(normaliseRole('carousel')).toBe('generic');
    expect(normaliseRole('')).toBe('generic');
  });

  it('narrows to KnownRole', () => {
    expectTypeOf(normaliseRole('x')).toEqualTypeOf<KnownRole>();
  });
});

describe('isWebContext', () => {
  it('recognises page and frame contexts', () => {
    expect(isWebContext('web:9A3F')).toBe(true);
    expect(isWebContext('web:9A3F/frame-2')).toBe(true);
  });

  it('rejects native and malformed contexts', () => {
    expect(isWebContext('native')).toBe(false);
    expect(isWebContext('web:')).toBe(false);
    expect(isWebContext('webview')).toBe(false);
  });
});

describe('tree types', () => {
  it('keeps roles open but autocompletes known ones', () => {
    const known: Role = 'button';
    const future: Role = 'treeitem';
    expect([known, future]).toHaveLength(2);
    expectTypeOf<KnownRole>().toMatchTypeOf<Role>();
  });

  it('restricts context IDs to native and web:*', () => {
    const ok: ContextId[] = ['native', 'web:abc', 'web:abc/f1'];
    // @ts-expect-error -- 'webview' is a role, not a context ID
    const bad: ContextId = 'webview';
    expect([ok, bad]).toHaveLength(2);
  });

  it('gives find matches childCount instead of children', () => {
    expectTypeOf<MatchedNode['childCount']>().toEqualTypeOf<number>();
    expectTypeOf<UiNode['children']>().toEqualTypeOf<readonly UiNode[]>();
    const node = {} as MatchedNode;
    // @ts-expect-error -- matches carry no children
    expect(node.children).toBeUndefined();
  });
});

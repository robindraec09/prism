import { describe, expect, it } from 'vitest';

import { isLocatorTarget, isNodeTarget, isPointTarget, type Target } from '../index.js';

const node: Target = { node: { snapshotId: 'k7q2xm4p.s-4', nodeId: 'n5' } };
const locator: Target = { locator: { kind: 'testId', value: 'sign_in' } };
const point: Target = { point: { x: 180, y: 524 } };

describe('target guards', () => {
  it('identify exactly one shape per target', () => {
    expect([isNodeTarget(node), isLocatorTarget(node), isPointTarget(node)]).toEqual([
      true,
      false,
      false,
    ]);
    expect([isNodeTarget(locator), isLocatorTarget(locator), isPointTarget(locator)]).toEqual([
      false,
      true,
      false,
    ]);
    expect([isNodeTarget(point), isLocatorTarget(point), isPointTarget(point)]).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('narrow the target type', () => {
    if (isNodeTarget(node)) {
      expect(node.node.nodeId).toBe('n5');
    }
    if (isPointTarget(point)) {
      expect(point.point.x).toBe(180);
    }
  });
});

describe('target types', () => {
  const ref = { snapshotId: 'k7q2xm4p.s-4', nodeId: 'n5' };
  const at = { x: 1, y: 1 };
  const byPlatform = { kind: 'platform', default: { kind: 'text', text: 'OK' } } as const;

  it('reject targets with more than one shape', () => {
    // @ts-expect-error -- a target takes exactly one of node, locator or point
    const both: Target = { point: at, node: ref };
    expect(both).toBeDefined();
  });

  it('reject platform locators, which core resolves before calling a driver', () => {
    // @ts-expect-error -- drivers receive ResolvedLocator only
    const unresolved: Target = { locator: byPlatform };
    expect(unresolved).toBeDefined();
  });
});

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  PrismError,
  isPrismError,
  type ActionResult,
  type Capability,
  type Driver,
  type DriverLaunchOptions,
  type DriverSession,
  type FindResult,
  type Locator,
  type ResolvedLocator,
  type Screenshot,
  type Target,
  type UiSnapshot,
} from '../index.js';

/**
 * A minimal in-memory driver: proves the interface can be implemented with
 * only the required members, and shows how core is expected to treat optional
 * ones.
 */
const snapshot: UiSnapshot = {
  snapshotId: 'fake0001.s-1',
  capturedAt: '2026-11-27T10:00:00.000Z',
  platform: 'web',
  screen: { width: 800, height: 600, scale: 1, rotation: 0, orientation: 'landscape' },
  nodeCount: 1,
  truncated: false,
  root: {
    id: 'n0',
    role: 'document',
    name: 'Fake page',
    text: null,
    value: null,
    testId: null,
    nativeType: '#document',
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    visible: true,
    onScreen: true,
    enabled: true,
    focused: false,
    selected: false,
    checked: null,
    scrollable: false,
    password: false,
    webContent: false,
    context: 'web:fake',
    children: [],
  },
};

interface FakeOptions {
  failTap?: boolean;
}

function createFakeDriver(): Driver<FakeOptions> {
  return {
    name: '@prismtest/fake',
    platforms: ['web'],
    async launch(options) {
      let closed = false;
      const session: DriverSession = {
        info: {
          id: 'fake0001.sess-1',
          platform: 'web',
          device: {
            platform: 'web',
            osVersion: 'n/a',
            model: 'fake',
            emulator: options?.headless ?? false,
            screen: snapshot.screen,
          },
        },
        capabilities: new Set<Capability>(['idle.signal']),
        async tree() {
          return snapshot;
        },
        async tap(target: Target): Promise<ActionResult> {
          if (closed) {
            throw new PrismError({
              code: 'session-not-found',
              message: 'The fake session is closed. Launch a new session.',
            });
          }
          if (options?.failTap === true) {
            throw new PrismError({
              code: 'not-interactable',
              reason: 'obscured',
              message: 'The point is covered by a fake overlay. Close it first.',
            });
          }
          const at = target.point ?? { x: 400, y: 300 };
          return { at, durationMs: 1 };
        },
        async screenshot(): Promise<Screenshot> {
          return {
            format: 'png',
            width: 800,
            height: 600,
            scale: 1,
            rotation: 0,
            capturedAt: '2026-11-27T10:00:01.000Z',
            data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          };
        },
        async close() {
          closed = true;
        },
      };
      return session;
    },
  };
}

describe('Driver / DriverSession contract', () => {
  it('can be implemented with only the required members', async () => {
    const session = await createFakeDriver().launch({ headless: true });
    expect(session.info.device.emulator).toBe(true);
    expect(session.capabilities.has('idle.signal')).toBe(true);
    expect((await session.tree()).root.role).toBe('document');
    expect(await session.tap({ point: { x: 5, y: 6 } })).toEqual({
      at: { x: 5, y: 6 },
      durationMs: 1,
    });
    expect((await session.screenshot()).data[0]).toBe(0x89);
    expect(session.find).toBeUndefined();
    await session.close();
    await session.close();
  });

  it('rejects with PrismError carrying a protocol code', async () => {
    const session = await createFakeDriver().launch({ failTap: true });
    const failure: unknown = await session.tap({ point: { x: 1, y: 1 } }).catch((e: unknown) => e);
    expect(isPrismError(failure, 'not-interactable')).toBe(true);
    expect((failure as PrismError).reason).toBe('obscured');
    expect((failure as PrismError).retryable).toBe(true);

    await session.close();
    const closed: unknown = await session.tap({ point: { x: 1, y: 1 } }).catch((e: unknown) => e);
    expect(isPrismError(closed, 'session-not-found')).toBe(true);
  });

  it('lets core fall back when an optional method is missing', async () => {
    const session = await createFakeDriver().launch();
    const locator: ResolvedLocator = { kind: 'role', role: 'document' };
    // Core (P0-04) does this: use the driver's find if present, else match on a snapshot.
    const result: FindResult | undefined = await session.find?.(locator);
    const fallback = result ?? (await session.tree());
    expect('root' in fallback).toBe(true);
  });

  it('types launch options as the platform-neutral set plus driver options', () => {
    type LaunchArg = Parameters<Driver<FakeOptions>['launch']>[0];
    expectTypeOf<LaunchArg>().toEqualTypeOf<(DriverLaunchOptions & FakeOptions) | undefined>();
  });

  it('only accepts resolved locators in find', () => {
    type FindArg = Parameters<NonNullable<DriverSession['find']>>[0];
    expectTypeOf<FindArg>().toEqualTypeOf<ResolvedLocator>();
    expectTypeOf<ResolvedLocator>().toMatchTypeOf<Locator>();
  });
});

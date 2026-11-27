import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  KNOWN_ERROR_CODES,
  KNOWN_PLATFORMS,
  KNOWN_ROLES,
  NOT_INTERACTABLE_REASONS,
  PROTOCOL_VERSION,
  PrismError,
  type FindResult,
  type UiSnapshot,
  type WireFailure,
  type WireSuccess,
} from '../index.js';

/**
 * These tests keep the TypeScript constants in step with the machine-readable
 * protocol schema, and type-check the worked examples of protocol.md §12
 * against the host-side types.
 */

interface SchemaEnum {
  enum: unknown[];
}
interface ProtocolSchema {
  $id: string;
  $defs: Record<string, unknown>;
}

const schemaUrl = new URL('../../../../docs/design/protocol.schema.json', import.meta.url);
const schema = JSON.parse(readFileSync(schemaUrl, 'utf8')) as ProtocolSchema;

function knownValues(name: string): unknown[] {
  const def = schema.$defs[name] as SchemaEnum | undefined;
  if (def === undefined) {
    throw new Error(`protocol.schema.json has no $defs.${name}; update this test with the schema.`);
  }
  return def.enum;
}

describe('protocol schema sync', () => {
  it('implements the schema version', () => {
    expect(schema.$id).toBe(`urn:prismtest:protocol:${PROTOCOL_VERSION}`);
  });

  it('lists the same roles as KnownRole, in the same order', () => {
    expect([...KNOWN_ROLES]).toEqual(knownValues('KnownRole'));
  });

  it('lists the same error codes as KnownErrorCode', () => {
    expect([...KNOWN_ERROR_CODES]).toEqual(knownValues('KnownErrorCode'));
  });

  it('lists the same not-interactable reasons as KnownNotInteractableReason', () => {
    // Order differs on purpose: ours is the precedence order of protocol.md §9.2.
    expect([...NOT_INTERACTABLE_REASONS].sort()).toEqual(
      [...knownValues('KnownNotInteractableReason')].sort(),
    );
  });

  it('lists the same platforms as KnownPlatform', () => {
    expect([...KNOWN_PLATFORMS]).toEqual(knownValues('KnownPlatform'));
  });
});

describe('protocol.md worked examples', () => {
  it('§12.3: an iOS snapshot fits UiSnapshot', () => {
    const snapshot: UiSnapshot = {
      snapshotId: 'p3m7tz2a.s-9',
      capturedAt: '2026-11-27T10:20:11.090Z',
      platform: 'ios',
      screen: {
        width: 393,
        height: 852,
        scale: 3,
        rotation: 0,
        orientation: 'portrait',
        insets: { top: 59, right: 0, bottom: 34, left: 0 },
      },
      nodeCount: 3,
      truncated: false,
      root: {
        id: 'n0',
        role: 'screen',
        name: null,
        text: null,
        value: null,
        testId: null,
        nativeType: 'prism.Screen',
        bounds: { x: 0, y: 0, width: 393, height: 852 },
        visible: true,
        onScreen: true,
        enabled: true,
        focused: false,
        selected: false,
        checked: null,
        scrollable: false,
        password: false,
        webContent: false,
        context: 'native',
        children: [
          {
            id: 'n3',
            role: 'button',
            name: 'Sign in',
            text: 'Sign in',
            value: null,
            testId: 'signInButton',
            nativeType: 'XCUIElementTypeButton',
            bounds: { x: 24, y: 500, width: 345, height: 50 },
            visible: true,
            onScreen: true,
            enabled: true,
            focused: false,
            selected: false,
            checked: null,
            scrollable: false,
            password: false,
            webContent: false,
            context: 'native',
            raw: { elementType: 9, identifier: 'signInButton', label: 'Sign in' },
            children: [
              {
                id: 'n4',
                role: 'text',
                name: 'Sign in',
                text: 'Sign in',
                value: null,
                testId: null,
                nativeType: 'XCUIElementTypeStaticText',
                bounds: { x: 160, y: 514, width: 73, height: 22 },
                visible: true,
                onScreen: true,
                enabled: true,
                focused: false,
                selected: false,
                checked: null,
                scrollable: false,
                password: false,
                webContent: false,
                context: 'native',
                raw: { elementType: 48, label: 'Sign in' },
                children: [],
              },
            ],
          },
        ],
      },
    };
    expect(snapshot.root.children[0]?.children[0]?.role).toBe('text');
  });

  it('§12.4: an element.find response fits WireSuccess<FindResult>', () => {
    const response: WireSuccess<FindResult> = {
      v: '1.0',
      id: 'r-12',
      ok: true,
      result: {
        snapshotId: 'k7q2xm4p.s-4',
        total: 1,
        truncated: false,
        searched: 6,
        idle: { settled: true, waitedMs: 50 },
        matches: [
          {
            node: {
              id: 'n5',
              role: 'button',
              name: 'Sign in',
              text: 'Sign in',
              value: null,
              testId: 'com.example.shop:id/sign_in',
              nativeType: 'android.widget.Button',
              bounds: { x: 16, y: 500, width: 328, height: 48 },
              visible: true,
              onScreen: true,
              enabled: true,
              focused: false,
              selected: false,
              checked: null,
              scrollable: false,
              password: false,
              webContent: false,
              context: 'native',
              childCount: 0,
            },
            path: [0, 0, 2],
            siblingCount: 3,
            ancestors: [
              { role: 'screen', nativeType: 'prism.Screen', testId: null, name: null, index: 0 },
              { role: 'window', nativeType: 'prism.Window', testId: null, name: 'Shop', index: 0 },
              {
                role: 'generic',
                nativeType: 'android.widget.FrameLayout',
                testId: null,
                name: null,
                index: 0,
              },
            ],
          },
        ],
      },
      timing: { startedAt: '2026-11-27T10:15:05.010Z', durationMs: 93, implicitWaitMs: 0 },
    };
    expect(response.result.matches[0]?.node.childCount).toBe(0);
  });

  it('§12.5: a stale-node failure converts to a PrismError that keeps its details', () => {
    const response: WireFailure = {
      v: '1.0',
      id: 'r-30',
      ok: false,
      error: {
        code: 'stale-node',
        message:
          'Node n17 from snapshot k7q2xm4p.s-6 now shows different content (text "Order #1041" became "Order #1057"), probably a recycled list row. Re-find the element.',
        retryable: true,
        details: {
          expected: { role: 'listitem', name: 'Order #1041' },
          actual: { role: 'listitem', name: 'Order #1057' },
        },
      },
      timing: { startedAt: '2026-11-27T10:15:12.020Z', durationMs: 9 },
    };
    const error = PrismError.fromWire(response.error);
    expect(error.code).toBe('stale-node');
    expect(error.retryable).toBe(true);
    expect(error.details['actual']).toEqual({ role: 'listitem', name: 'Order #1057' });
  });
});

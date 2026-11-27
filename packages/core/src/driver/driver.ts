import type {
  ActionOptions,
  ActionResult,
  CallOptions,
  DragOptions,
  HitTestResult,
  Key,
  LongPressOptions,
  PinchOptions,
  ScrollIntoViewOptions,
  ScrollIntoViewResult,
  ScrollOptions,
  ScrollResult,
  SwipeOptions,
  Target,
  TypeOptions,
  TypeResult,
} from './actions.js';
import type { Capability } from './capabilities.js';
import type { Point, ScreenInfo } from './geometry.js';
import type { ResolvedLocator } from './locator.js';
import type { Screenshot, ScreenshotOptions } from './screenshot.js';
import type { FindResult, Idle, NodeRef, Platform, Settle, UiSnapshot } from './tree.js';
import type { AgentInfo, ProtocolVersion } from './wire.js';

/**
 * The device a session runs on (wire result of `device.info`).
 *
 * @example
 * ```ts
 * import type { DeviceInfo } from '@prismtest/core';
 *
 * const emulator: DeviceInfo = {
 *   platform: 'android', osVersion: '14', apiLevel: 34, model: 'sdk_gphone64_x86_64',
 *   emulator: true, serial: 'emulator-5554',
 *   screen: { width: 360, height: 800, scale: 3, rotation: 0, orientation: 'portrait' },
 * };
 * ```
 */
export interface DeviceInfo {
  readonly platform: Platform;
  readonly osVersion: string;
  /** Android API level. */
  readonly apiLevel?: number;
  readonly model: string;
  /** adb serial; filled by the host driver, never by the agent. */
  readonly serial?: string;
  /** iOS UDID; filled by the host driver. */
  readonly udid?: string;
  /** `true` for emulators, simulators and headless browsers on the host. */
  readonly emulator: boolean;
  readonly screen: ScreenInfo;
  /** BCP 47 locale, for example `en-GB`. */
  readonly locale?: string;
  /** IANA time zone, for example `Europe/London`. */
  readonly timeZone?: string;
}

/**
 * What a started session is attached to.
 *
 * @example
 * ```ts
 * import type { SessionInfo } from '@prismtest/core';
 *
 * const label = (s: SessionInfo) => `${s.platform} ${s.device.model} (${s.id})`;
 * ```
 */
export interface SessionInfo {
  /** Session ID; for agent drivers `<instanceId>.sess-<n>`. */
  readonly id: string;
  readonly platform: Platform;
  readonly device: DeviceInfo;
  /** Negotiated protocol version; agent-based drivers only. */
  readonly protocol?: ProtocolVersion;
  /** The on-device agent; agent-based drivers only. */
  readonly agent?: AgentInfo;
}

/**
 * The app a native session starts (protocol `session.start` `app`).
 *
 * @example
 * ```ts
 * import type { AppSpec } from '@prismtest/core';
 *
 * const shop: AppSpec = { id: 'com.example.shop', activity: '.MainActivity', args: ['--demo'] };
 * ```
 */
export interface AppSpec {
  /** Android package name or iOS bundle ID. */
  readonly id: string;
  /** Android only: activity to start. */
  readonly activity?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Platform-neutral options for {@link Driver.launch}. Each driver adds its own
 * options through the `TOptions` type parameter of {@link Driver}.
 *
 * @example
 * ```ts
 * import type { DriverLaunchOptions } from '@prismtest/core';
 *
 * const android: DriverLaunchOptions = { device: 'emulator-5554', app: { id: 'com.example.shop' } };
 * const chrome: DriverLaunchOptions = { headless: true, timeoutMs: 2_000 };
 * ```
 */
export interface DriverLaunchOptions extends CallOptions {
  /** App to start (native and hybrid). */
  readonly app?: AppSpec;
  /** Device to use: adb serial, simulator UDID, or a driver-specific name. Default: driver's choice. */
  readonly device?: string;
  /** Run without a visible window, where the platform allows it. */
  readonly headless?: boolean;
}

/**
 * Options for capturing the UI tree (protocol `tree.get`).
 *
 * @example
 * ```ts
 * import type { TreeOptions } from '@prismtest/core';
 *
 * const forFailureDump: TreeOptions = { webContent: 'include', include: { raw: true } };
 * const quick: TreeOptions = { filter: { visibleOnly: true }, settle: { maxWaitMs: 200, quietMs: 50 } };
 * ```
 */
export interface TreeOptions extends CallOptions {
  readonly maxDepth?: number;
  /** Default 5000. */
  readonly maxNodes?: number;
  /** Capture only this subtree. */
  readonly root?: NodeRef;
  readonly filter?: { readonly visibleOnly?: boolean };
  /** Include the `raw` platform attributes. */
  readonly include?: { readonly raw?: boolean };
  /** Native `webContent` nodes under `webview` nodes. Default `prune`. */
  readonly webContent?: 'prune' | 'include';
  readonly settle?: Settle;
}

/**
 * Options for finding elements (protocol `element.find`).
 *
 * @example
 * ```ts
 * import type { FindOptions } from '@prismtest/core';
 *
 * const opts: FindOptions = { max: 5, ancestors: true, settle: { maxWaitMs: 300, quietMs: 50 } };
 * ```
 */
export interface FindOptions extends CallOptions {
  /** Search only below this node. */
  readonly scope?: NodeRef;
  /** Maximum matches returned. Default 20. */
  readonly max?: number;
  /** Include each match's ancestor chain. */
  readonly ancestors?: boolean;
  readonly settle?: Settle;
}

/**
 * Options for waiting until the UI is idle.
 *
 * @example
 * ```ts
 * import type { WaitForIdleOptions } from '@prismtest/core';
 *
 * const opts: WaitForIdleOptions = { maxWaitMs: 1_000, quietMs: 100 };
 * ```
 */
export interface WaitForIdleOptions extends CallOptions {
  readonly maxWaitMs: number;
  readonly quietMs?: number;
}

/**
 * A live connection to one browser page, app or device, implemented by every
 * UI driver (web, Android, iOS, cloud). Core builds the unified API (locators,
 * auto-wait, `expect`) on top of it; tests do not call it directly.
 *
 * **Contract**
 *
 * - All coordinates are DIP; all trees are normalised (protocol.md §2).
 * - Every method rejects with a {@link PrismError} carrying a protocol error
 *   code (protocol.md §6.3), never with a bare `Error`.
 * - Drivers run checks once and never retry or wait beyond `settle`; retry
 *   policy (auto-wait) belongs to core.
 * - Required members are what phase 0 needs. Optional members are features a
 *   driver may not offer yet or at all; when one is missing, core falls back
 *   (for example `find` → `tree` + host-side matching) or fails with
 *   `unsupported` naming the feature. A present method may still reject with
 *   `unsupported` for particular inputs (for example a `css` locator on a
 *   native context).
 *
 * @example
 * ```ts
 * import type { DriverSession } from '@prismtest/core';
 *
 * async function tapSignIn(session: DriverSession): Promise<void> {
 *   const snapshot = await session.tree();
 *   const button = snapshot.root.children[0]; // the locator engine (P0-04) does this properly
 *   if (button === undefined) return;
 *   await session.tap(
 *     { node: { snapshotId: snapshot.snapshotId, nodeId: button.id } },
 *     { checks: { visible: true, enabled: true, onScreen: true, unobscured: true, stableMs: 50 } },
 *   );
 * }
 * ```
 */
export interface DriverSession {
  /** Session, device and (for agent drivers) protocol details. */
  readonly info: SessionInfo;
  /** Capabilities this session supports (see {@link KNOWN_CAPABILITIES}). */
  readonly capabilities: ReadonlySet<Capability>;

  /**
   * Captures the normalised UI tree.
   *
   * @example
   * ```ts
   * const snapshot = await session.tree({ settle: { maxWaitMs: 200, quietMs: 50 } });
   * ```
   */
  tree(options?: TreeOptions): Promise<UiSnapshot>;

  /**
   * Taps (clicks on web) a target, after the requested one-shot checks.
   *
   * @example
   * ```ts
   * await session.tap({ node: ref }, { checks: { visible: true, enabled: true } });
   * ```
   */
  tap(target: Target, options?: ActionOptions): Promise<ActionResult>;

  /**
   * Captures the screen (native) or viewport (web).
   *
   * @example
   * ```ts
   * const shot = await session.screenshot({ format: 'png' });
   * ```
   */
  screenshot(options?: ScreenshotOptions): Promise<Screenshot>;

  /**
   * Ends the session and releases the device or browser. Safe to call twice.
   *
   * @example
   * ```ts
   * await session.close();
   * ```
   */
  close(options?: CallOptions): Promise<void>;

  /**
   * Resolves a locator in the driver (agent-side on native, browser-side for
   * `css`/`xpath` on web). Missing, or rejecting with `unsupported`, means
   * core resolves on a {@link DriverSession.tree} snapshot instead.
   *
   * @example
   * ```ts
   * const result = await session.find?.({ kind: 'testId', value: 'sign_in' }, { ancestors: true });
   * ```
   */
  find?(locator: ResolvedLocator, options?: FindOptions): Promise<FindResult>;

  /**
   * Types text into the target, or into the focused element when `target` is
   * `undefined`.
   *
   * @example
   * ```ts
   * await session.type?.({ node: emailRef }, 'ada@example.com', { mode: 'replace' });
   * ```
   */
  type?(target: Target | undefined, text: string, options?: TypeOptions): Promise<TypeResult>;

  /**
   * Opens a URL in the current page (web sessions).
   *
   * @example
   * ```ts
   * await session.navigate?.('https://example.com/login');
   * ```
   */
  navigate?(url: string, options?: CallOptions): Promise<void>;

  /**
   * Double-taps a target.
   *
   * @example
   * ```ts
   * await session.doubleTap?.({ node: imageRef });
   * ```
   */
  doubleTap?(target: Target, options?: ActionOptions): Promise<ActionResult>;

  /**
   * Presses and holds a target.
   *
   * @example
   * ```ts
   * await session.longPress?.({ node: rowRef }, { durationMs: 1_000 });
   * ```
   */
  longPress?(target: Target, options?: LongPressOptions): Promise<ActionResult>;

  /**
   * Clears an editable target.
   *
   * @example
   * ```ts
   * await session.clear?.({ node: searchRef });
   * ```
   */
  clear?(target: Target, options?: ActionOptions): Promise<ActionResult>;

  /**
   * Sets a slider, spin button or picker wheel: a number for ranges, a string
   * for picker values.
   *
   * @example
   * ```ts
   * await session.setValue?.({ node: volumeRef }, 0.5);
   * ```
   */
  setValue?(target: Target, value: number | string, options?: ActionOptions): Promise<ActionResult>;

  /**
   * Swipes on a target, from a point target, or across the screen when
   * `target` is `undefined`.
   *
   * @example
   * ```ts
   * await session.swipe?.({ node: carouselRef }, { direction: 'left' });
   * ```
   */
  swipe?(target: Target | undefined, options: SwipeOptions): Promise<ActionResult>;

  /**
   * Scrolls a container, optionally until a locator matches an on-screen node.
   *
   * @example
   * ```ts
   * await session.scroll?.({ node: listRef }, { direction: 'down', until: { kind: 'text', text: 'Order #1041' } });
   * ```
   */
  scroll?(target: Target, options: ScrollOptions): Promise<ScrollResult>;

  /**
   * Scrolls the nearest scrollable ancestor until the target is on screen.
   *
   * @example
   * ```ts
   * await session.scrollIntoView?.({ node: ref });
   * ```
   */
  scrollIntoView?(target: Target, options?: ScrollIntoViewOptions): Promise<ScrollIntoViewResult>;

  /**
   * Drags from one target to another.
   *
   * @example
   * ```ts
   * await session.drag?.({ node: cardRef }, { point: { x: 300, y: 100 } });
   * ```
   */
  drag?(from: Target, to: Target, options?: DragOptions): Promise<ActionResult>;

  /**
   * Pinches on a target, or on the screen centre when `target` is `undefined`.
   *
   * @example
   * ```ts
   * await session.pinch?.({ node: mapRef }, { scale: 2 });
   * ```
   */
  pinch?(target: Target | undefined, options: PinchOptions): Promise<ActionResult>;

  /**
   * Presses a key.
   *
   * @example
   * ```ts
   * await session.pressKey?.('enter');
   * ```
   */
  pressKey?(key: Key, options?: CallOptions): Promise<void>;

  /**
   * Presses the system back button (Android) or goes back in history (web).
   *
   * @example
   * ```ts
   * await session.back?.();
   * ```
   */
  back?(options?: CallOptions): Promise<void>;

  /**
   * Goes to the home screen (native).
   *
   * @example
   * ```ts
   * await session.home?.();
   * ```
   */
  home?(options?: CallOptions): Promise<void>;

  /**
   * Returns the topmost node at a point, for "obscured by …" diagnostics.
   *
   * @example
   * ```ts
   * const top = await session.hitTest?.({ x: 180, y: 524 });
   * ```
   */
  hitTest?(point: Point, options?: CallOptions): Promise<HitTestResult>;

  /**
   * Waits until the UI is quiet, up to `maxWaitMs`. Not settled is not an error.
   *
   * @example
   * ```ts
   * const idle = await session.waitForIdle?.({ maxWaitMs: 1_000, quietMs: 100 });
   * ```
   */
  waitForIdle?(options: WaitForIdleOptions): Promise<Idle>;
}

/**
 * A UI driver: a factory for {@link DriverSession}s on one or more platforms.
 * Web, Android, iOS and cloud drivers each export one; core's `launch()`
 * (CORE-1) picks a driver from the config and calls {@link Driver.launch}.
 *
 * @typeParam TOptions - Driver-specific launch options, merged with
 * {@link DriverLaunchOptions}.
 *
 * @example
 * ```ts
 * import type { Driver, DriverSession } from '@prismtest/core';
 *
 * interface ChromiumOptions {
 *   executablePath?: string;
 * }
 *
 * declare const chromium: Driver<ChromiumOptions>;
 *
 * const session: DriverSession = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium' });
 * await session.navigate?.('https://example.com');
 * await session.close();
 * ```
 */
export interface Driver<TOptions extends object = Record<never, never>> {
  /** Package-style name, for example `@prismtest/web`. Shown in reports and errors. */
  readonly name: string;
  /** Platforms this driver can start sessions on. */
  readonly platforms: readonly Platform[];
  /**
   * Starts a session. Rejects with a {@link PrismError}, for example
   * `version-mismatch`, `app-not-running` or `timeout`, whose message says how
   * to fix the setup.
   *
   * @example
   * ```ts
   * const session = await driver.launch({ app: { id: 'com.example.shop' } });
   * ```
   */
  launch(options?: DriverLaunchOptions & TOptions): Promise<DriverSession>;
}

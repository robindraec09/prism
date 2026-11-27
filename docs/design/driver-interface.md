# Design note: driver interface in `@prismtest/core`

| | |
| --- | --- |
| Task | P0-03 |
| Requirements | CORE-1 (types for CORE-2, CORE-3, CORE-4, CORE-5, CORE-9 used by later tasks) |
| Protocol version | 1.0.0 ([`protocol.md`](./protocol.md), [`protocol.schema.json`](./protocol.schema.json)) |
| Status | Draft, for review |
| Code | `packages/core/src/driver/*.ts`, exported from `packages/core/src/index.ts` |

## 1. What this is

The TypeScript contract every UI driver implements: web (CDP, BiDi), Android, iOS and cloud. Core builds the user-facing API (`by.*`, auto-wait, `expect`, `launch()`) on top of it. Tests never call it directly.

```ts
import type { Driver, DriverSession } from '@prismtest/core';

declare const driver: Driver<{ executablePath?: string }>;

const session: DriverSession = await driver.launch({ headless: true });
const snapshot = await session.tree({ settle: { maxWaitMs: 200, quietMs: 50 } });
await session.tap(
  { node: { snapshotId: snapshot.snapshotId, nodeId: 'n5' } },
  { checks: { visible: true, enabled: true, onScreen: true, unobscured: true, stableMs: 0 } },
);
const shot = await session.screenshot();
await session.close();
```

| File | Holds |
| --- | --- |
| `open-string.ts` | `OpenString<Known>` |
| `geometry.ts` | `Point`, `Rect`, `Insets`, `Rotation`, `Orientation`, `ScreenInfo` |
| `tree.ts` | Roles, platforms, context IDs, `UiNode`/`UiNodeBase`/`MatchedNode`, `UiSnapshot`, `Idle`, `Settle`, `NodeRef`, `NodeFingerprint`, `NodeMatch`, `Ancestor`, `FindResult` |
| `locator.ts` | Locator AST (`Locator`, `ResolvedLocator`, one type per kind), `TextMatch`, `LocatorFilter` |
| `actions.ts` | `CallOptions`, `Target`, `Checks`, `ActionOptions`, `ActionResult`, `ActedOn`, typing, swipe, scroll, drag, pinch, keys, hit test |
| `screenshot.ts` | `ScreenshotOptions`, `Screenshot` |
| `errors.ts` | Error codes, `not-interactable` reasons, `PrismError`, `WireError`, `defaultRetryable` |
| `capabilities.ts` | Capability names |
| `driver.ts` | `Driver`, `DriverSession`, `DriverLaunchOptions`, `SessionInfo`, `DeviceInfo`, `AppSpec`, `TreeOptions`, `FindOptions`, `WaitForIdleOptions` |
| `wire.ts` | `PROTOCOL_VERSION`, envelope types (`WireRequest`, `WireResponse`, `WireEvent`, frames), `hello`/`/version`/`/v1/health` bodies, `WireScreenshot` |

## 2. Rules the types follow

1. **Same names as the wire.** Node, snapshot, locator, target, checks, result and error fields have the protocol's names and meanings, so the Android and iOS host drivers can pass agent JSON through with no mapping, and the web driver produces the same shapes (protocol.md §4.5). Type names get a prefix only where the wire name would clash or be vague: `UiNode` (not `Node`, which clashes with the DOM), `UiSnapshot`, `ScreenInfo`, `NodeMatch`, `WireError`.
2. **Open strings for what core receives, closed unions for what core sends.** Roles, platforms, orientation, image format, native engine, error codes, reasons, capabilities, type method and event source are `OpenString<Known…>`: autocompletion for the 1.0 values, but any string compiles, so code must handle values from newer peers (protocol.md §5.2 rule 3). Parameters core sends (`TypeMode`, `Direction`, `NamedKey`, `webContent`, screenshot `format`, regex `flags`) are closed, so a typo fails to compile; sending unknown values gives `invalid-request` anyway (§5.2 rule 2). `Rotation` is a closed numeric set in the schema and stays closed.
3. **Known values are runtime constants.** `KNOWN_ROLES`, `KNOWN_PLATFORMS`, `KNOWN_ERROR_CODES`, `NOT_INTERACTABLE_REASONS` (in §9.2 precedence order) and `KNOWN_CAPABILITIES` are `as const` arrays; the `Known…` types derive from them. A unit test compares them with the `Known…` enums in `protocol.schema.json` and checks the schema `$id` against `PROTOCOL_VERSION`, so the TypeScript and the schema cannot drift silently.
4. **Readonly data.** Every field is `readonly` and every array `readonly T[]`. Snapshots and results are values; nothing in core mutates them.
5. **Exclusive shapes are types, not comments.** `Target` is node | locator | point with `?: never` on the others; `TextMatch` is text | regex; `PlatformLocator` needs at least one branch; `and`/`or` need at least one operand. These mirror the schema's `oneOf`/`anyOf`/`minItems`.
6. **Locators are data.** `Locator` is the full AST of protocol.md §3.1, including `platform` overrides at any depth. `ResolvedLocator` is the same AST with no `platform` node anywhere; it is the only locator type a driver receives, because core picks the branch by context (§3.2). `isResolvedLocator()` checks this at runtime.
7. **Errors carry codes.** Every driver method rejects with `PrismError`: `code` (open), `message` (what was tried, what was found, what to do next), `retryable`, `reason` (lifted from `details.reason` for `not-interactable`), `details`, optional `cause`. `PrismError.fromWire()` keeps the agent's `retryable` flag; `defaultRetryable()` encodes the §6.3 table for errors a host driver raises itself (`timeout` returns `false`: the caller passes `true` for commands that change no state). `isPrismError()` also accepts a `PrismError` from a second copy of the package (ESM + CommonJS, P0-16), where `instanceof` fails.

## 3. Mapping to the wire protocol

| Host side (`DriverSession`) | Wire (agent drivers) | Differences |
| --- | --- | --- |
| `Driver.launch(options)` | `GET /version`, `hello`, `session.start`, `device.info` | One call. Agent start, port forwarding, token and version negotiation are the driver's job. `options.app` is `session.start.app`. Driver-specific options come through `Driver<TOptions>` |
| `session.info: SessionInfo` | `hello` result + `session.start` result + `device.info` | `device.serial` / `udid` filled by the host (§7.1); `protocol` is the selected `MAJOR.MINOR` |
| `session.capabilities: ReadonlySet<Capability>` | `hello.capabilities[]` | A set, for `has()`. Web drivers advertise the capabilities that apply to them |
| `tree(options)` → `UiSnapshot` | `tree.get` → `Snapshot` | `delivery` and `since` are not exposed: the driver may fetch large trees as artifacts and apply diffs (phase 3), but always returns a full snapshot |
| `find?(locator, options)` → `FindResult` | `element.find` | Optional; see §4 |
| `tap(target, options)` → `ActionResult` | `action.tap` | `options.offset`, `checks`, `settle` are the wire params |
| `type?(target \| undefined, text, options)` → `TypeResult` | `action.type` | `undefined` target = focused element; `method` reported |
| `doubleTap?`, `longPress?`, `clear?`, `setValue?` | `action.doubleTap`, `action.longPress`, `action.clear`, `action.setValue` | Same params |
| `swipe?(target \| undefined, options)` | `action.swipe` | A point target is the wire `from` |
| `scroll?`, `scrollIntoView?`, `drag?`, `pinch?`, `pressKey?`, `back?`, `home?`, `hitTest?` | `action.scroll`, `element.scrollIntoView`, `action.drag`, `action.pinch`, `action.pressKey`, `action.back`, `action.home`, `element.hitTest` | Same params. `back?` on web goes back in history |
| `waitForIdle?(options)` → `Idle` | `idle.wait` | |
| `screenshot(options)` → `Screenshot` | `screen.screenshot` → `Screenshot` (wire) | `data` is decoded bytes (`Uint8Array`), never base64 or an artifact ID; `WireScreenshot` is the wire form |
| `navigate?(url)` | — | Web only (CDP `Page.navigate`, BiDi `browsingContext.navigate`); no agent command |
| `close()` | `session.stop`, then agent shutdown / forward removal | Idempotent |
| Rejection `PrismError` | Response `error` | `PrismError.fromWire(error)`; transport failures become host-synthesised codes (`agent-crashed`, `timeout`) |
| `CallOptions.timeoutMs` | Envelope `timeoutMs` | Per-call budget, not the auto-wait timeout |
| `CallOptions.signal` | — | Aborting rejects with `cancelled` |

Envelope fields (`v`, `id`, `session`, `timing`) never reach core: they stay inside the host driver. `timing.implicitWaitMs` should surface as a warning in the report (principle 5); how drivers report warnings is part of the runner/reporter work (P0-07). `wire.ts` exports the envelope types so the Android and iOS host drivers share one definition instead of two.

## 4. Required and optional members

Required members are what phase 0 needs from every driver: `info`, `capabilities`, `tree`, `tap`, `screenshot`, `close`. That matches the protocol's phase-0 commands (`hello`, `session.*`, `device.info`, `tree.get`, `action.tap` with `checks` and `settle`, `screen.screenshot`).

Everything else is optional, because agents add it in phase 1 or a platform cannot do it (`back` on iOS, `pinch` without `action.pinch`). Core's rule:

- **Missing method:** fall back if a fallback exists (`find` → `tree` + host-side matching, §3.2; `scroll { until }` → host loop), else fail with `unsupported` naming the feature and the driver.
- **Present but `unsupported` for this input:** same fallback (for example an agent's `find` for a regex outside the portable subset, or `css` in a native context).

Optional methods (not one `execute(cmd, params)` entry point) keep each call typed and let a driver declare exactly what it implements.

## 5. Deliberately not in this task

| Not here | Where |
| --- | --- |
| Locator engine: `by.*` builders, platform branch selection, matching on a snapshot, text normalisation, innermost rule, XPath projection | P0-04 |
| Auto-wait and retrying `expect`: retry loop, back-off, `stableMs` choice, `scrollIntoView` on `off-screen`, timeouts per action | P0-05 |
| User-facing `launch()` (CORE-1): config schema, choosing a driver for `browser` / `android` / `ios` / `cloud`, driver registration | Not yet a roadmap task; proposed as a follow-up (it needs P0-04/P0-05 to be useful and the plugin API for driver registration, RUN-6) |
| Hybrid contexts: `context.list`, WebView attach, `webview(name)`, automatic context switching (HYB-1..3) | Phase 1. `FindOptions` has no `context` option yet on purpose |
| App lifecycle (CORE-8), device controls (CORE-7), screen recording (CORE-9), `select` composite, alerts, keyboard state | Phase 1, as optional members in a minor change to this interface |
| Events (`app.crashed`, `alert.appeared`, …) | Phase 1 |
| Wire transport (HTTP client, auth token, gzip, artifact download, `busy` polling) | Android and iOS host drivers; a shared transport may move into core later if both need the same code |

## 6. Open points for review

1. **Swipe/scroll direction.** protocol.md §7.1 does not say whether `direction: "up"` means the finger moves up or the content scrolls up. `Direction` documents the gap; it should be settled in the protocol before phase-1 drivers implement swipes (candidate for P0-02a).
2. **Capability list.** The protocol names capabilities in several places but has no normative list. `KNOWN_CAPABILITIES` collects them; `locator.native.nspredicate` and `locator.native.classchain` follow the pattern of `locator.native.uiautomator`. Adding a list (and these names) to protocol.md and the schema would let the sync test cover capabilities too.
3. **`password` invariant** (`text`/`value` null) is documented, not enforced by the type, because drivers build nodes from a computed boolean and a discriminated union would force branching everywhere. Conformance fixtures (§14 Q13) should check it.

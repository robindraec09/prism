# Design note: Android agent spike (P0-09)

| | |
| --- | --- |
| Task | P0-09 Spike: Android agent |
| Requirements | AND-1, AND-2 (also touches AND-3, HYB-1 groundwork, PERF-9 groundwork, PRD "UI speed") |
| Protocol | Implements a subset of protocol 1.0 (`docs/design/protocol.md`); no protocol changes |
| Status | **Code complete for the spike scope, not yet built or run on a device.** The environment it was written in had no Android SDK, emulator or network. See §6 for exactly what was and was not verified, and §7 for what a human must run |
| Packages | `packages/android-agent` (Kotlin, Gradle), `packages/android` (TypeScript host side) |

## 1. What was built

### 1.1 Agent APK (`packages/android-agent`)

A Gradle (Kotlin DSL) Android project with one module, `agent`:

- **App APK** `io.prismtest.agent` (minSdk 29, targetSdk 35): no activities, only the `INTERNET` permission (needed to open the loopback socket). It holds all agent code and has no third-party runtime dependencies (Kotlin stdlib only).
- **Instrumentation APK** `io.prismtest.agent.test`, run by `androidx.test.runner.AndroidJUnitRunner` exactly as protocol §4.3 specifies. Its single JUnit "test", `PrismAgentEntry.serve()`:
  1. reads `prismToken` (required, ≥ 32 characters), `prismPort` (default 7100) and `prismIdleTimeoutMs` (default 30 min) from the instrumentation arguments (Decision D4);
  2. sets the UiAutomator `Configurator` timeouts to 0 (§9.1). The agent does not use `UiDevice` today, but later commands that do will inherit zero waits;
  3. gets `UiAutomation` with `FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES` and adds `FLAG_RETRIEVE_INTERACTIVE_WINDOWS` (required for `getWindows()`, §2.7), `FLAG_REPORT_VIEW_IDS` (fills `testId`) and `FLAG_INCLUDE_NOT_IMPORTANT_VIEWS` (keeps layout nodes, as uncompressed `uiautomator dump` does);
  4. binds `127.0.0.1:<port>` and prints `PRISM_AGENT_READY port=<n> instance=<id> protocol=1.0.0` through `Instrumentation.sendStatus` (stream result). It also writes it to logcat (tag `PrismAgent`). The token is never printed or logged;
  5. serves until the idle timeout or until the process is killed (`am force-stop io.prismtest.agent`).

Code structure. Everything above the `DeviceBackend` interface is plain Kotlin with no `android.*` imports, so it runs in JVM unit tests:

| File | Role |
| --- | --- |
| `AgentServer.kt` | HTTP/1.1 server on `java.net.ServerSocket`: keep-alive, gzip responses, 1 MiB body limit, at most 8 connections, idle shutdown. Applies the §11 checks before routing |
| `Http.kt` | Request parser and response writer; `Security.hostAllowed` (Host hostname must be `127.0.0.1`, `localhost` or `[::1]`, any port) and `Security.tokenMatches` (constant time, `MessageDigest.isEqual`) |
| `Json.kt` | Minimal JSON reader/writer. Always writes `null` explicitly; depth limit 64 |
| `Protocol.kt` | Version parsing and negotiation (§5.1), `ProtocolError`, instance IDs (8 lower-case base32 characters), timestamps, typed parameter access that answers `invalid-request` naming the parameter (§5.2) |
| `Dispatcher.kt` | Envelope validation, the single-command executor with `busy` and `timeout` handling (§4.2, §6.3), sessions, and the commands |
| `TreeBuilder.kt`, `RoleMapper.kt` | Windows and nodes to the normalised tree (§2): synthetic `screen` and per-window nodes, role mapping (§2.3, §2.4), field sources (§2.5), DIP bounds (§2.6), `visible` and `onScreen` (§2.6.1), `webContent` pruning (§2.8), `raw` (§2.9), password masking, §3.4 text normalisation |
| `UiAutomationDevice.kt` | The Android boundary: `getWindows()` (default display, sorted by layer), lazy `AccessibilityNodeInfo` adapters, display metrics and rotation, `waitForIdle`, and taps through `injectInputEvent` with its own `MotionEvent`s (§9.1) |

### 1.2 Protocol coverage

| Item | Status |
| --- | --- |
| `GET /version`, `GET /v1/health` | Implemented; answered on server threads, never blocked by the executor |
| `POST /v1/command` envelope | Implemented: `v`/`id`/`cmd`/`params` validation, `timeoutMs` (default 10 s), `timing { startedAt, durationMs }`, HTTP 200 for all protocol errors; 401/403/404/405/413 for transport errors |
| §11 security | Token on every request (401 with an empty body on mismatch); 403 for any `Origin` header and for non-loopback `Host` hostnames; binds 127.0.0.1 only; password values never sent; idle shutdown; no outbound connections |
| `hello` | Implemented: negotiation, `version-mismatch` with both ranges, capabilities `idle.signal`, `idle.noImplicit`, `state.focused`, `device` |
| `device.info` | Implemented (the host fills `serial`) |
| `session.start` / `session.stop` | Implemented without `app` (`app` answers `unsupported`; the host starts the app with adb in the spike). `session.stop` runs on the server thread but cannot cancel a running command |
| `tree.get` | Implemented: `maxDepth`, `maxNodes`, `filter.visibleOnly`, `include.raw` (default true), `webContent` (`prune` default / `include`), `settle`, consistent-snapshot retry (§9.1 guarantee 1). `root`, `since` and `delivery: "artifact"` answer `unsupported` |
| `action.tap` | **Point targets only**, with optional `settle`. `node` and `locator` targets and `checks.within` answer `unsupported`. Element checks do not apply to point targets (§7.1), so the other `checks` are accepted and ignored. Points outside the screen answer `invalid-request` |
| Other 1.0 commands | Answer `unsupported` (known in 1.0 but not implemented); names outside 1.0 answer `unknown-command` |
| `/v1/events`, `/v1/artifacts` | Not implemented (404) |

### 1.3 Host side (`packages/android`)

- `Adb`: `child_process`-based wrapper (no dependencies) with `devices`, `install -r -t`, `forward tcp:0 tcp:<port>` (adb picks the host port), `forward --remove`, `shell`, `force-stop` and `spawn`. Errors mask registered secrets.
- `buildInstrumentArgs` builds the §4.3 command. It refuses tokens outside the base64url alphabet, because `adb shell` joins arguments into one device shell line.
- `launchAgent`: generates the token (32 random bytes, base64url), installs the APKs (optional), force-stops an old agent, starts `am instrument -w`, waits for the ready line (30 s default; handles plain and `-r` output; all output is masked), forwards the port, runs `hello`, checks that the `instanceId` matches the ready line, and fills `device.serial`. `stop()` stops the session, removes the forward and force-stops the agent.
- `AgentClient`: `node:http` with keep-alive and `Accept-Encoding: gzip`, sends `Authorization` and never `Origin`. Transport failures and timeouts (`timeoutMs` + 2 s grace) become `agent-crashed` (§6.3). It records round-trip time, wire bytes, JSON bytes and agent `timing` for each call.
- `spike.ts`: the measurement harness (§5).

The driver interface (P0-03) and the locator engine (P0-04) do not exist yet, so the host side is a launcher plus a client. `tree.ts` has a spike-only `findByTestId` for the find + tap measurement.

## 2. Choices made in the spike

1. **Own HTTP server and JSON code, no NanoHTTPD or Ktor.** The protocol needs a small HTTP/1.1 subset (Content-Length bodies, keep-alive, gzip). About 300 lines cover it, with no licence questions, no extra method-count or start-up cost, and full control of the §11 checks. The WebSocket upgrade for `/v1/events` (phase 1) will add roughly 150 lines (handshake plus text frames). Revisit if that grows.
2. **A `DeviceBackend` seam.** The protocol layer is tested on the JVM with fakes: password masking, roles, IDs, the `busy`/`timeout` rules and the §11 checks, over real sockets. Only `UiAutomationDevice.kt` needs a device.
3. **Read nodes lazily.** Each `A11yNode` getter reads one `AccessibilityNodeInfo` field when the mapper asks for it. The only IPC is `getChild()` (and `getLabeledBy()` when a label link is set) when the node is not in the prefetch cache.
4. **Children sorted by `getDrawingOrder()` (stable).** This follows §2.2 "back to front, then reading order". Equal orders keep the accessibility order.
5. **Fallback roles for unknown classes.** An editable node of an unknown class becomes `textbox`; a checkable plain `View` becomes `switch` (§2.4 row for Compose `Role.Switch`). Classes are matched by simple name, so AndroidX and Material variants map like the platform class.
6. **`expanded`** comes from the node's actions (`collapse` → true, `expand` → false); otherwise the field is omitted (it is optional).
7. **Window classification** (§2.7): `TYPE_INPUT_METHOD` → `keyboard`; application windows of `com.android.systemui`, the permission controller or the package installer → `window` with `raw.windowType: "system"`; an application window that does not cover the screen and sits above another application window → `dialog`; system, split-screen divider and magnification windows → `window` / `system`; accessibility overlays → `window` / `accessibilityOverlay`.
8. **Tap gesture**: down, 50 ms, up, both injected synchronously (`injectInputEvent(ev, true)`), matching the ~50 ms in the §9.4 budget. The response comes after touch-up (§9.1 guarantee 3).

## 3. Points for protocol follow-up (no change made)

These do not break 1.0 (consumers ignore unknown `raw` keys, §2.9), but they should be decided and written into `protocol.md`:

| # | Point | Proposal |
| --- | --- | --- |
| F1 | The agent adds two `raw` keys not listed in §2.9: `layer` on window nodes and `webContentPruned: true` on `webview` nodes whose children were pruned | Add both to the §2.9 Android row (patch) |
| F2 | §2.2 says `text` is "normalised as in §3.4". The agent normalises `text` only; `name`, `value` and `hint` are sent as the platform reports them (blank strings become `null`, except an empty editable `value`, which stays `""`) | Confirm that only `text` is normalised on the wire and that matching normalises everything (patch) |
| F3 | `AndroidJUnitRunner` brings `junit:junit` (EPL 1.0) and the androidx.test runner (Apache 2.0) into the instrumentation APK that Prism would ship. EPL 1.0 is not on the CLAUDE.md list (MIT, BSD, Apache 2.0, ISC) | Either a human accepts EPL 1.0 for this test-only binary, or a design note proposes a plain `android.app.Instrumentation` subclass (`io.prismtest.agent.test/io.prismtest.agent.PrismInstrumentation`). That needs no JUnit, starts faster, and changes only the §4.3 start command |
| F4 | `session.stop` cannot cancel a running command on Android in the spike; the result is dropped when it finishes | Fine for phase 0; phase 1 adds interruption where the platform call allows it |

## 4. Known gaps (spike scope)

- No snapshot cache, so no `node` targets, `stale-node` or `stale-snapshot` yet (§7.2). This is the next step for P0-05 (auto-wait needs `action.tap { target: { node }, checks }`).
- No `checks` evaluation (needs node targets and the cache), no `screen.screenshot`, no `element.find`, no events.
- `screen.insets` is not reported (it is optional).
- `AccessibilityNodeInfo` objects are not recycled. `recycle()` is a no-op from API 33, and on 29–32 the GC reclaims them. Measure memory over a long run (§7, step 9).
- One display only (§14 Q6).

## 5. Measurements

**None were taken**: there was no emulator. P0-09 MUST report numbers against §9.4. `node packages/android/dist/spike.js` collects all of them except the Chromium cost, which needs the manual procedure below. Run on a quiet screen, 30 iterations after one warm-up.

| Measurement | How | Report |
| --- | --- | --- |
| Agent start | `launchMs`: from `am instrument` to `hello` answered, APKs already installed (second run) | Value; target < 30 s (§9.5), expect 1–3 s |
| `tree.get` size | `treeGet.*.nodeCount`, `jsonBytes`, `wireBytes` (gzip) for: default, `include.raw: false`, `webContent: "include"` | Median per variant on (a) Settings home, (b) a long `RecyclerView` (Settings → Apps → See all apps), (c) a WebView page, (d) a Compose screen if available |
| `tree.get` time | `agentMs` (agent `timing.durationMs`) and `roundTripMs` (host) | Median and p95. Compare with the full-traversal budget F = 150 ms for ≤ 1,000 nodes (§9.4) |
| Settle cost | `treeGet.settle50` minus `treeGet.default` on a quiet screen | Median; budget S = 50 ms |
| Tap latency | `--tap x,y` → `tap.agentMs` (includes the 50 ms gesture) and `tap.roundTripMs` | Median, p95; budget A = 120 ms (without re-resolve and checks, so it should come in well below) |
| Transport | `roundTripMs − agentMs` on `tap` | Median; budget T = 5 ms |
| Phase 0 find + tap | `--find-tap <testId>`: `tree.get` with settle, host-side match, tap the centre | Median and p95 of `findTap.totalMs` against the PRD target (median < 300 ms). Phase 0 has no formal budget (§9.4), but this is the number that tells whether the phase 1 one-round-trip path is needed early |
| Chromium accessibility cost (§2.8) | Manual, below | Frame-time and script-time deltas |

**Chromium accessibility cost.** Chromium builds its renderer accessibility tree while an accessibility client is active. The question is how much the agent's `UiAutomation` connection slows WebView pages.

1. Use a WebView app that loads a heavy page and calls `WebView.setWebContentsDebuggingEnabled(true)`, for example a minimal app that loads a long, script-heavy page.
2. **Is accessibility on at all?** With the agent running, `tree.get { webContent: "include" }` must show nodes under the `webview` node with `webContent: true`. If it shows none, the renderer tree is off and the cost is near zero; record that. Also run `adb shell dumpsys accessibility` with and without the agent.
3. **Frame time.** For each condition (A) agent stopped, (B) agent running and idle (`spike.js --hold-seconds 120`), (C) agent running with `tree.get { webContent: "include" }` every second (`--hold-seconds 120 --hold-tree-every-ms 1000`): run `adb shell dumpsys gfxinfo <pkg> reset`, scroll the page 20 times with `adb shell input swipe 500 1500 500 500 300`, then record the janky-frame percentage and the 50th/90th/99th frame-time percentiles from `adb shell dumpsys gfxinfo <pkg>`.
4. **Script time.** Attach DevTools (`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`, find the target at `http://127.0.0.1:9222/json`). Time a DOM benchmark that inserts and then removes 10,000 nodes with `performance.now()`, 5 runs per condition A/B/C.
5. Report the deltas B−A and C−A. If B−A is above 10%, open a follow-up to study mitigations, for example connecting `UiAutomation` only while a command runs. That is not possible with an instrumentation-held connection today, so it would need a design change.

## 6. What was verified, and how

| Check | Result | Method |
| --- | --- | --- |
| Pure Kotlin agent code compiles | Yes | Kotlin 2.0.21 compiler embedded in the local Gradle 8.14.3 distribution (same Kotlin version as the build), JVM target 17 |
| Agent JVM unit tests (40) | All pass | Compiled with the same compiler and run by a minimal JUnit-compatible runner written for this check (real JUnit could not be downloaded). Gradle must re-run them with real JUnit: `./gradlew :agent:testDebugUnitTest` |
| Android-facing Kotlin (`UiAutomationDevice.kt`, `PrismAgentEntry.kt`) compiles | Yes, **against hand-written stubs** of the Android and androidx.test classes it uses, written from the documented API. This catches Kotlin errors and inconsistencies, **not** wrong signatures or API levels. The real `android.jar`, AGP and Android Lint have not seen this code |
| Agent output matches the protocol schema | Yes | `hello`, `session.start`, `tree.get` (login screen; and a screen with a WebView, a list, a slider and a keyboard window), `action.tap`, an error response, `/version` and `/v1/health` produced by the real `Dispatcher` validated against `protocol.schema.json` (Draft 2020-12, Python `jsonschema`) |
| TypeScript typecheck | Clean | `tsc` 7.0 (the project pins ^5.6; no TS 7-only features used) with the repo's strict base config |
| TypeScript tests (32) | All pass | Run through a minimal Vitest-compatible shim (Vitest could not be installed). CI runs them with real Vitest |
| Prettier | Clean | `prettier --check .` (3.8) |
| ESLint | **Not run** | `typescript-eslint` is not installed in this environment; CI runs it |
| Gradle build, Android Lint, APK install, on-device behaviour, all timings | **Not verified** | No Android SDK, emulator or network |

The TypeScript fixtures in `packages/android/src/fixtures` are real `Dispatcher` output from the JVM run above, not device recordings.

## 7. What the human run must confirm

Steps (details and commands in `packages/android/README.md`):

1. `cd packages/android-agent && ./gradlew :agent:testDebugUnitTest :agent:lintDebug :agent:assembleDebug :agent:assembleDebugAndroidTest`. Expect: the build succeeds, the 40 unit tests pass and Lint reports no `NewApi` errors. Fix any compile errors in `UiAutomationDevice.kt` or `PrismAgentEntry.kt` from API signatures the stubs got wrong.
2. Boot an emulator with API 34 (main) and one with API 29 (minimum, AND-3).
3. Run `packages/android/scripts/run-spike.sh --iterations 30` with Settings open. Expect: the ready line appears, `hello` returns `apiLevel` and `emulator: true`, and `tree.json` shows `screen` → windows (status bar and navigation bar as `system`, Settings as `application`) → views with sensible roles and `testId`s.
4. Open a password field (for example Settings → Network → add Wi-Fi network → password). Run `tree.get` and confirm `value` and `text` are `null` and the typed characters appear nowhere in the JSON.
5. Show the keyboard (focus a text field). Confirm a `keyboard` window node.
6. Rotate the emulator to landscape. Confirm `screen.rotation` is 90 or 270, `width > height`, and a `--tap` at the centre of a visible button hits it. This checks the rotation sign in §2.1 and the DIP-to-pixel conversion in rotated mode.
7. Security: `curl` without the token gets 401; with `-H 'Origin: http://x'` gets 403; with `-H 'Host: evil.com'` gets 403. From the device, `adb shell netstat -tln` (or `ss -tln`) shows `127.0.0.1:7100`, not `0.0.0.0`.
8. Copy the measurements from `p0-09-results.json` into §5 of this note (or a results table in the PR), plus `--find-tap` on a static element and the Chromium procedure.
9. Leave the agent running for 30 minutes with `tree.get` every 2 s (`--hold-seconds 1800 --hold-tree-every-ms 2000`) and record the agent process memory (`adb shell dumpsys meminfo io.prismtest.agent`) at the start and end. Separately, start the agent by hand (README) with `-e prismIdleTimeoutMs 60000`, send one request, and confirm the instrumentation exits about a minute later.
10. Decide F3 (EPL 1.0 in the instrumentation APK).

## 8. Open questions and unknowns

- **Prefetch cost.** On API 29–32 each cache miss in `getChild()` prefetches up to about 50 descendants per IPC. Large trees (2,000+ nodes) may miss the §9.4 traversal budget. API 33+ offers `getRoot(FLAG_PREFETCH_DESCENDANTS_HYBRID)` with larger batches. Try it if the API 34 numbers are over budget.
- **`FLAG_INCLUDE_NOT_IMPORTANT_VIEWS`** roughly doubles node counts on view-based screens, but locators and healing need the layout nodes. Compare node counts and time with and without it in step 3, and decide in phase 1.
- **Consistent-snapshot retry**: any content-change event during traversal triggers one retry. A screen with a constant animation (a spinner) will always retry once and report `idle.settled: false`, doubling `tree.get` time. Measure on such a screen. If it is costly, ignore events from nodes outside the captured windows or limit the retry to structural changes.
- **Whether `UiAutomation` turns on Chromium's accessibility tree at all**: §5, step 2.

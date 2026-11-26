# Design note: normalised UI tree and host↔agent protocol

| | |
| --- | --- |
| Task | P0-02 |
| Requirements | CORE-2, CORE-3, CORE-5, CORE-9, AND-2, IOS-1, IOS-4, HYB-1, HEAL-1, VIS-1..3, PERF-9 |
| Protocol version | **1.0.0** (draft until a human approves this note) |
| Status | Proposed |
| Machine-readable schema | [`protocol.schema.json`](./protocol.schema.json) (JSON Schema 2020-12) |
| Consumers | `@prismtest/core`, `web`, `android`, `android-agent`, `ios`, `ios-runner`, `heal`, `visual`, `perf` |

The key words MUST, SHOULD and MAY are used as in RFC 2119.

## 1. Goals and non-goals

**Goals**

1. One element model. Every UI driver (web, Android, iOS, hybrid WebViews) produces the same **normalised UI tree**, so locators, auto-wait, healing, visual masks and reports are written once in `core`.
2. One wire protocol between host drivers (Node.js) and on-device agents (Kotlin APK, Swift XCTest runner), versioned so host and agent can be upgraded independently within a major version.
3. **Language-neutral.** Plain JSON over HTTP and WebSocket, specified by this note and a JSON Schema. Nothing depends on TypeScript, so Python/Java bindings (v1.x, PRD non-goals) can drive an agent directly.
4. Fast enough for the PRD target: native find + tap median < 300 ms on an emulator/simulator.
5. Failures that explain themselves (PRD principle 4): every error carries what was tried, what was found, and what to do next.

**Non-goals (v1)**

- Agents do not run test logic, retries or auto-wait loops. They are fast, dumb executors; policy lives in the host.
- The web driver does not use the agent transport (see §4.4).
- No remote exposure of agents over a network by default (see §11).
- No binary framing (Protobuf, CBOR). JSON only; large payloads go through the artifact endpoint.
- Desktop and TV platforms (PRD non-goals).

## 2. Normalised UI tree

### 2.1 Snapshot

A `getTree` call returns one **snapshot**: a consistent capture of the UI at one moment.

| Field | Type | Req | Meaning |
| --- | --- | --- | --- |
| `snapshotId` | string | yes | Opaque, unique per agent process (for example `s-42`). Node IDs are only meaningful together with it. |
| `capturedAt` | string | yes | ISO 8601 UTC timestamp with milliseconds. |
| `platform` | `"android"` \| `"ios"` \| `"web"` | yes | Source platform. |
| `screen` | object | yes | `{ width, height }` in DIP, `scale` (device pixels per DIP), `orientation` (`portrait` \| `landscape` \| `portraitUpsideDown` \| `landscapeRight`), optional `insets { top, right, bottom, left }` (status bar, notch, navigation bar) in DIP. |
| `idle` | object | no | Idle signal at capture time, see §9.1. |
| `root` | Node | yes | Root node (role `application` on native, `document` on web). |
| `nodeCount` | integer | yes | Number of nodes in `root` after filters. |
| `truncated` | boolean | no | `true` if `maxDepth` or `maxNodes` cut the tree. |

### 2.2 Node fields

| Field | Type | Req | Meaning |
| --- | --- | --- | --- |
| `id` | string | yes | Unique within the snapshot. MUST NOT be assumed stable across snapshots unless the agent advertises `tree.persistentIds`. |
| `role` | Role | yes | One value from the fixed vocabulary (§2.3). |
| `name` | string \| null | yes | Accessible name (what a screen reader announces as the label). |
| `text` | string \| null | yes | Text the node itself renders (rules per platform in §2.5). Whitespace-normalised. |
| `value` | string \| null | yes | Current value: editable text, slider position, picker value. Always `null` when `password` is true. |
| `hint` | string \| null | no | Placeholder / hint / tooltip. |
| `testId` | string \| null | yes | `resource-id` (Android), `accessibilityIdentifier` (iOS), configured test attribute (web, default `data-testid`). |
| `nativeType` | string | yes | Android class name, `XCUIElementType…` name, or lower-case HTML tag. |
| `bounds` | Rect | yes | `{ x, y, width, height }` in DIP, origin top-left of the screen in the current orientation (§2.6). Fractions allowed. |
| `visible` | boolean | yes | Rendered with non-zero size and not hidden (alpha > 0, not `display:none`/`visibility:hidden`/`isHidden`). Says nothing about the viewport. |
| `onScreen` | boolean | yes | `visible` and intersects the screen (native) or the context viewport (web). |
| `enabled` | boolean | yes | Accepts input. |
| `focused` | boolean | yes | Has input focus. |
| `selected` | boolean | yes | Selected (tab, list row, segmented item). |
| `checked` | `true` \| `false` \| `"mixed"` \| null | yes | `null` when the node is not checkable. |
| `expanded` | boolean \| null | no | `null` when not expandable. |
| `scrollable` | boolean | yes | Can scroll its content. |
| `password` | boolean | yes | Secure text entry. Agents MUST NOT send the value. |
| `level` | integer | no | Heading level (web `h1..h6`, `aria-level`). |
| `context` | string | yes | Context the node belongs to: `"native"` or a web context ID (§2.7). |
| `children` | Node[] | yes | In z-order from back to front, then reading order. Empty array for leaves. |
| `raw` | object | no | Platform attributes, keys in §2.8. Omitted when `include.raw` is false. |

Booleans are always present (no "absent means false"), so consumers in any language can deserialise without defaults.

### 2.3 Role vocabulary (v1.0)

Roles use ARIA spelling where an ARIA role exists. Adding a role is a minor version change; consumers MUST treat unknown roles as `generic`.

| Group | Roles |
| --- | --- |
| Structure | `application`, `window`, `document`, `webview`, `dialog`, `alert`, `keyboard`, `generic`, `group`, `toolbar` |
| Collections | `list`, `listitem`, `grid`, `row`, `cell`, `tablist`, `tab`, `menu`, `menuitem`, `listbox`, `option` |
| Controls | `button`, `link`, `textbox`, `searchbox`, `checkbox`, `radio`, `switch`, `slider`, `spinbutton`, `combobox`, `progressbar` |
| Content | `text`, `heading`, `image` |

Mapping precedence (all platforms): explicit semantics first (ARIA role, Compose semantics role, heading flag, window type), then the class/type table below, then context rules (a direct child of `list` with role `generic` becomes `listitem`; a button inside `tablist` becomes `tab`; a button inside `keyboard` stays `button`), else `generic`.

### 2.4 Role mapping per platform

**Android** (UiAutomator `AccessibilityNodeInfo.className`; Jetpack Compose reports these class names from its semantics roles, so the same table applies)

| Android class (and common subclasses) | Role |
| --- | --- |
| `android.widget.Button`, `ImageButton`, Material `MaterialButton`, `FloatingActionButton` | `button` |
| `android.widget.ToggleButton` | `button` (with `checked`) |
| `android.widget.TextView`, `AppCompatTextView`, `MaterialTextView` | `text` |
| `android.widget.EditText`, `AppCompatEditText`, `TextInputEditText` | `textbox` |
| `android.widget.AutoCompleteTextView`, `android.widget.Spinner` | `combobox` |
| `SearchView$SearchAutoComplete` | `searchbox` |
| `android.widget.CheckBox`, `CheckedTextView` (when checkable) | `checkbox` |
| `android.widget.RadioButton` / `RadioGroup` | `radio` / `group` |
| `android.widget.Switch`, `SwitchCompat`, `SwitchMaterial` | `switch` |
| `android.widget.SeekBar`, `RatingBar` | `slider` |
| `android.widget.ProgressBar` | `progressbar` |
| `android.widget.NumberPicker` | `spinbutton` |
| `android.widget.ImageView` | `image` |
| `android.widget.ListView`, `ExpandableListView`, `androidx.recyclerview.widget.RecyclerView` | `list` |
| `android.widget.GridView` | `grid` |
| `TabLayout`, `TabWidget` / `TabLayout$TabView` | `tablist` / `tab` |
| `android.widget.Toolbar`, `androidx.appcompat.widget.Toolbar` | `toolbar` |
| `android.webkit.WebView` | `webview` |
| `ScrollView`, `HorizontalScrollView`, `NestedScrollView`, `ViewPager`, layouts, `View`, `ViewGroup` | `generic` |
| `isHeading()` true (API 28+) | `heading` (overrides class) |
| One `AccessibilityWindowInfo` | `window`; `TYPE_INPUT_METHOD` → `keyboard`; application window smaller than the screen and above another app window → `dialog` (best effort) |

**iOS** (`XCUIElement.elementType`)

| `XCUIElementType…` | Role |
| --- | --- |
| `Application` / `Window` | `application` / `window` |
| `Button` | `button` (`tab` inside `TabBar`/`SegmentedControl`) |
| `Link` | `link` |
| `StaticText` | `text` |
| `TextField`, `TextView`, `SecureTextField` | `textbox` (`SecureTextField` sets `password`) |
| `SearchField` | `searchbox` |
| `Switch`, `Toggle` | `switch` |
| `CheckBox` / `RadioButton` | `checkbox` / `radio` |
| `Slider` | `slider` |
| `Stepper`, `PickerWheel` | `spinbutton` |
| `Picker`, `DatePicker` | `group` |
| `ProgressIndicator`, `ActivityIndicator` | `progressbar` |
| `Image`, `Icon` | `image` |
| `Table`, `CollectionView`, `Outline` / `Cell` | `list` / `listitem` |
| `TabBar`, `SegmentedControl` | `tablist` |
| `NavigationBar`, `Toolbar` | `toolbar` |
| `Alert` / `Sheet` | `alert` / `dialog` |
| `Menu` / `MenuItem` | `menu` / `menuitem` |
| `Keyboard` (`Key` → `button`) | `keyboard` |
| `WebView` | `webview` |
| `ScrollView`, `Other`, `Group`, `StatusBar`, anything else | `generic` |

**Web** (Chromium `Accessibility.getFullAXTree` / BiDi equivalent joined to DOM nodes)

| Computed AX role | Role |
| --- | --- |
| `RootWebArea` | `document` |
| `button`, `link`, `textbox`, `searchbox`, `checkbox`, `radio`, `switch`, `slider`, `spinbutton`, `combobox`, `listbox`, `option`, `progressbar`, `list`, `listitem`, `row`, `tab`, `tablist`, `toolbar`, `menu`, `heading`, `dialog`, `alert`, `group` | same name |
| `menuitem`, `menuitemcheckbox`, `menuitemradio` | `menuitem` (`checked` set for the last two) |
| `grid`, `table`, `treegrid` / `cell`, `gridcell`, `columnheader`, `rowheader` | `grid` / `cell` |
| `alertdialog` | `dialog` |
| `img`, `image`, `figure` | `image` |
| `StaticText` | `text` |
| `iframe` element | `generic`, children carry the frame's context ID |
| `generic`, `none`, `presentation`, anything else | `generic` |

### 2.5 Field sources per platform

| Field | Android (`AccessibilityNodeInfo`) | iOS (`XCUIElement` snapshot) | Web (DOM + AX) |
| --- | --- | --- | --- |
| `name` | `contentDescription`, else `labeledBy` text, else `text` (non-editable); for editables `hintText`, then `labeledBy`, then `contentDescription` | `label` | AX name (accname algorithm) |
| `text` | `text` for non-editable nodes | `label` for `StaticText`, `Button`, `Link`, `MenuItem`, `Cell` text; else `null` | text from direct text-node children; full `innerText` for `button`/`link`/`option`/`heading` |
| `value` | `text` for editables; `RangeInfo.current` for sliders/progress | `value` (stringified; switches report via `checked` instead) | AX value / `input.value` |
| `hint` | `hintText`, `tooltipText` | `placeholderValue` | `placeholder`, `title` |
| `testId` | `viewIdResourceName` (full, e.g. `com.shop:id/sign_in`) | `identifier` | configured attribute, default `data-testid` |
| `nativeType` | `className` | `XCUIElementType` name | tag name |
| `enabled` | `isEnabled` | `isEnabled` | not `disabled` / `aria-disabled` |
| `focused` | `isFocused` | `hasKeyboardFocus` (best effort) | `document.activeElement` |
| `selected` | `isSelected` | `isSelected` | AX `selected` |
| `checked` | `isCheckable ? isChecked : null` | switch `value` `"1"`/`"0"`, else `null` | AX `checked` (`mixed` supported) |
| `scrollable` | `isScrollable` | type is `ScrollView`/`Table`/`CollectionView`/`TextView` | computed overflow + scroll size |
| `visible` | `isVisibleToUser` or non-empty bounds | non-empty `frame`, not hidden | non-empty box, not hidden, opacity > 0 |
| `password` | `isPassword` | type `SecureTextField` | `input[type=password]` |

### 2.6 Coordinates and scale

- All `bounds` and all coordinates in commands are **device-independent pixels (DIP)**: Android `px / displayMetrics.density`; iOS points; web CSS pixels.
- `screen.scale` converts DIP to device pixels: Android `density`, iOS `UIScreen.scale`, web `devicePixelRatio`. Screenshots are in device pixels (§10.2).
- Origin is the top-left of the screen as currently rotated. Agents convert to their native injection space.
- Web context nodes in a standalone browser are relative to the top-level viewport. When the host grafts WebView nodes into a native tree (§2.7), it converts them to screen DIP using the WebView node's `bounds` and the page zoom.

### 2.7 Contexts (native, WebViews, frames)

| Context ID | Meaning | Who assigns |
| --- | --- | --- |
| `native` | Native UI of the app/device | Fixed |
| `web:<target>` | One web page: browser tab, or a WebView found in an app (`<target>` is the CDP target ID or WebKit page ID) | Host |
| `web:<target>/<frameId>` | An iframe inside that page | Host |

Agents only ever emit `native`. The host attaches to WebViews itself (CDP over ADB for Android, WebKit remote inspector for iOS) and MAY produce a **merged tree** where each native `webview` node's `children` are the web document nodes, with their own `context` and bounds converted to screen DIP. The `context` field on every node is what makes per-platform locator overrides and HYB-2 automatic context switching work.

### 2.8 `raw` conventions

Keys are camelCase. Consumers MUST NOT require any `raw` key; `raw` is for debugging, healing and native predicates only.

| Platform | Keys (when available) |
| --- | --- |
| Android | `className`, `resourceId`, `package`, `clickable`, `longClickable`, `focusable`, `checkable`, `editable`, `windowId`, `windowType`, `drawingOrder`, `actions` (string array), `boundsPx` `[l,t,r,b]`, `roleDescription` |
| iOS | `elementType` (integer), `identifier`, `label`, `value`, `placeholderValue`, `frame` (points), `hittable` (only when cheap) |
| Web | `tag`, `domId`, `classList`, `name`, `type`, `href`, `backendNodeId`, `frameId`, `axRole`, `shadowHost` (boolean) |

## 3. Locator resolution

### 3.1 Locator wire format

`by.*` calls compile to a JSON **locator AST**, shared by host and agents.

| `kind` | Fields | Matches |
| --- | --- | --- |
| `role` | `role`, optional `name` (TextMatch) | `role` equal, and `name` matches if given |
| `text` | TextMatch | `text` matches; if no node matches, `name` (so a button labelled by `contentDescription` is found) |
| `testId` | `value` | `testId` equal; on Android also equal to the part after `:id/` |
| `label` | TextMatch | `name` matches (`by.label`) |
| `css` | `selector` | Web contexts only, evaluated by the browser |
| `xpath` | `expr` | Web: by the browser on the DOM. Native: host-side on the XML projection (§3.3) |
| `native` | `engine` (`uiautomator` \| `nspredicate` \| `classchain`), `query` | Agent-side only |
| `and` / `or` | `of: Locator[]` | All / any |
| `within` | `scope: Locator`, `target: Locator` | `target` among descendants of the first `scope` match |
| `platform` | `web?`, `android?`, `ios?`, `default?` | Per-platform override (CORE-3); resolved by the host, never sent to an agent |

Every locator MAY carry `nth` (0-based, negative from end) and `filter: { visible?, enabled?, onScreen? }`.

**TextMatch** is `{ "text": string, "exact"?: boolean }` or `{ "regex": { "source": string, "flags"?: string } }`. Default (`exact` false): case-insensitive substring after whitespace normalisation (trim, collapse runs to one space). `exact: true`: whole string, case-sensitive, after normalisation. Regex is ECMAScript syntax; agents that cannot evaluate a pattern return `unsupported` and the host falls back to a snapshot (§3.2).

### 3.2 Where resolution runs

| Locator | Phase 0 | Phase 1+ | Notes |
| --- | --- | --- | --- |
| `role`, `text`, `testId`, `label`, `and`, `or`, `within` | Host, on a snapshot | Agent (`element.find`) when it advertises `find.agent`; host otherwise | One canonical implementation in `core` (P0-04); agents MUST match it, checked by shared conformance fixtures |
| `xpath` (native) | Host | Host | Avoids three XPath engines with different quirks |
| `xpath`, `css` (web) | Browser | Browser | Shadow DOM piercing is the web driver's job |
| `native` | — | Agent only | `uiautomator` = `UiSelector`/`By` syntax; `nspredicate` and `classchain` = XCTest query syntax |
| `platform` | Host | Host | Picks a branch, then resolves that branch as above |

Fallback rule: if an agent answers `element.find` with `unsupported`, the host calls `tree.get` and matches locally. Results MUST be identical either way, so tests never depend on where resolution ran.

**Override selection (CORE-3).** The host picks the branch by the context being searched: a `web:*` context uses `web`; the `native` context uses `android` or `ios` by device platform; if that key is absent, `default`; if neither, the error `unsupported` names the missing key. In a hybrid app with automatic context switching, the host tries the native context first, then each web context, unless the locator is web-only (`css`) or native-only (`native`).

### 3.3 XPath projection for native trees

Host-side XPath runs on an XML view of the normalised tree: element name = `nativeType` (so `//android.widget.Button` and `//XCUIElementTypeButton` work as people expect), attributes = all scalar node fields plus `raw` scalars (`@text`, `@testId`, `@resource-id` alias, `@name`, `@label` alias, `@enabled`, `@x`, `@y`, `@width`, `@height`). XPath 1.0 only.

## 4. Transport

### 4.1 Endpoints

All agents expose the same HTTP/1.1 server. Bodies are UTF-8 JSON (`Content-Type: application/json`). The path carries the **major** version.

| Method + path | Purpose |
| --- | --- |
| `POST /v1/command` | Every command, including `hello` (§6) |
| `GET /v1/health` | Liveness: `{ "ok": true, "uptimeMs": n, "session": "s-1" \| null }`. Cheap, never blocked by a running command |
| `GET /v1/events` | WebSocket upgrade for events (§8) |
| `GET /v1/artifacts/{artifactId}` | Binary download (screenshots on request, recordings). `DELETE` frees it |

Commands within one session are executed **serially**. A second command sent while one is running gets `busy`, except `health` and `session.stop`, which are always accepted (`session.stop` cancels the running command, which then answers `cancelled`).

### 4.2 Android

1. Host installs the agent APK and its test APK (once per agent version), then starts it: `am instrument -w -e prismPort <devicePort> -e prismToken <token> io.prismtest.agent.test/androidx.test.runner.AndroidJUnitRunner`.
2. Agent binds **127.0.0.1:`<devicePort>`** on the device (default 7100) and logs `PRISM_AGENT_READY port=<n> protocol=1.0.0` to the instrumentation output.
3. Host runs `adb forward tcp:0 tcp:<devicePort>` (adb chooses a free host port) and talks to `http://127.0.0.1:<hostPort>`. The same path works for USB and Wi-Fi ADB (AND-4).
4. The host removes the forward on session end. If the instrumentation process exits, the host reports `agent-crashed`.

### 4.3 iOS

- **Simulator:** the runner is launched with `xcodebuild test-without-building` (or `simctl` + XCTest bundle) with environment `PRISM_PORT` and `PRISM_TOKEN`. Simulators share the Mac's network stack, so the runner binds `127.0.0.1:<port>` and the host connects directly. Each simulator gets its own port (EMU-4).
- **Real device (IOS-3, P1):** the host tunnels through usbmux (the usbmuxd socket on macOS) to the runner's port, in the way `iproxy` does. No Wi-Fi exposure.
- WKWebViews are reached by the host through the WebKit remote inspector (simulator: the `webinspectord` socket), not through the runner.

### 4.4 Web driver

The web driver speaks CDP (Chromium) and WebDriver BiDi (Firefox) directly and **does not use this transport, envelope or handshake**. It MUST still produce the same snapshot and node types (§2), accept the same locator AST (§3.1), raise the same error codes (§6.3), and emit the same events where they apply. In hybrid apps the host uses the web driver's code for WebView contexts, reached over ADB-forwarded CDP sockets or the WebKit inspector.

## 5. Versioning

- **Protocol version** is semantic, `MAJOR.MINOR.PATCH`, independent of npm package versions. The current version is `1.0.0`.
- **Major** is in the URL (`/v1/`). A host never sends a request to a major it does not implement.
- **Minor** is negotiated in `hello`. Both sides declare `{ min, max }`; the selected version is the highest `MAJOR.MINOR` both support. No overlap → `version-mismatch` error carrying both ranges.
- **Patch** changes are clarifications and bug fixes with no wire change; ignored in negotiation.
- **Capabilities** (string list in `hello`) gate optional features that some agents cannot implement on some platforms (for example `action.pinch`, `tree.diff`). Capabilities are not a substitute for versions: a capability can be added in a minor version, never removed without a major.

| Change | Version bump |
| --- | --- |
| Remove or rename a command, field, role, error code or event | Major |
| Change a field's type, unit, coordinate space or meaning | Major |
| Make an optional parameter required, or change a default so behaviour changes | Major |
| Add a command, optional parameter, result field, role, error code, event or capability | Minor |
| Clarify wording, fix examples | Patch |

Compatibility rules that make independent upgrades safe:

1. **Must-ignore:** receivers ignore unknown fields in requests, results and events.
2. Unknown command → `unknown-command`. Unknown role → treat as `generic`. Unknown error code → use its `retryable` flag; otherwise non-retryable.
3. A sender only uses commands, parameters and capabilities that exist in the **selected** version.
4. Each Prism host release bundles agent binaries for its own protocol version. On `version-mismatch` the host reinstalls its bundled agent (Android automatically; iOS simulator by rebuilding/installing the runner) and retries `hello` once; otherwise it fails with both versions and the fix in the message.
5. Every request and response carries `v` (the selected `MAJOR.MINOR`), which makes traces self-describing.

## 6. Message envelope

### 6.1 Request

| Field | Type | Req | Meaning |
| --- | --- | --- | --- |
| `v` | string | yes | Selected `MAJOR.MINOR` (`hello` uses the host's max) |
| `id` | string | yes | Request ID chosen by the host, unique per connection; echoed in the response and in logs |
| `cmd` | string | yes | Command name (§7) |
| `session` | string | no | Session ID; required for every command except `hello`, `session.start`, `device.info` |
| `params` | object | yes | Command parameters (`{}` if none) |
| `timeoutMs` | integer | no | Budget for this command. Agent MUST answer before it expires (with `timeout` if needed). Default per command in §9.3 |

### 6.2 Response

| Field | Type | Req | Meaning |
| --- | --- | --- | --- |
| `v`, `id` | string | yes | Echoed |
| `ok` | boolean | yes | Discriminator |
| `result` | object | if `ok` | Command result |
| `error` | Error | if not `ok` | See below |
| `timing` | object | yes | `{ "startedAt": ISO8601, "durationMs": number }` measured by the agent; lets the host separate agent time from transport time |

HTTP status is `200` for every protocol-level response, including errors; non-200 means transport or auth trouble (`401` unauthorized, `404` wrong major, `413` body too large, `500` agent bug with no JSON).

**Error object:** `code` (string, §6.3), `message` (one human sentence covering what was tried, what was found, and what to do next), `retryable` (boolean), optional `details` (object: `locator`, `found` count, `nearest` candidates with score, `reason`, `expected`/`actual` versions, native exception class and message).

### 6.3 Error codes

| Code | Meaning | Retryable | Host guidance |
| --- | --- | --- | --- |
| `invalid-request` | Malformed envelope or params | no | Bug in host; report |
| `unknown-command` | Command not in the selected version | no | Fall back or fail with `unsupported` |
| `unsupported` | Command/locator/option not available on this platform or agent | no | Use host fallback if one exists (§3.2), else fail naming the feature |
| `unauthorized` | Missing or wrong token (HTTP 401, no details) | no | Restart agent with a new token |
| `version-mismatch` | No common protocol version | no | Reinstall bundled agent once (§5) |
| `session-not-found` | Unknown or ended session | no | Start a new session; usually means the agent restarted |
| `busy` | Another command is running in this session | yes | Bug in host serialisation; wait and retry once |
| `cancelled` | Stopped by `session.stop` | no | Expected during teardown |
| `element-not-found` | Locator matched nothing | yes | Auto-wait retries until the action timeout; then fail with `details.nearest` |
| `ambiguous` | Action locator matched more than one node | no | Strictness error; fail listing matches |
| `stale-node` | Node from a snapshot no longer exists | yes | Re-resolve the locator, then retry |
| `stale-snapshot` | Snapshot evicted from the agent cache | yes | Take a new snapshot / re-find |
| `not-interactable` | Found but cannot act: `details.reason` = `disabled` \| `obscured` \| `off-screen` \| `zero-size` \| `keyboard-covering` | yes | Auto-wait retries; `off-screen` → scroll into view first |
| `context-not-found` | Web context missing or gone | yes | WebViews appear late; retry until timeout |
| `timeout` | Command exceeded `timeoutMs` | yes, once | Retry once if the command is idempotent (reads); never blindly re-send `type` |
| `app-not-running` | Target app not in foreground or not launched | no | Fail; suggest `app.launch` |
| `app-crashed` | App process died during the command | no | Fail the test; attach crash log from `details` |
| `agent-crashed` | **Host-synthesised**: agent process gone, connection refused, or no answer by `timeoutMs` + 2 s grace | yes, once | Restart agent and session once per test; then fail with agent logs |
| `internal` | Unexpected agent exception | no | Fail; include native stack in `details`; report a bug |

## 7. Command set v1

Commands are namespaced `area.verb`. "Phase" is when the command must work: **0** = needed by the spikes P0-09/P0-10 and the driver interface (P0-03); **1** = Android alpha; **2** = iOS beta; **3** = v1.0. Some driver operations run through platform tools on the host (adb, `simctl`, `devicectl`) and are **not** protocol commands; they are listed so the driver interface stays complete.

| Command | Key params → result | Executed by | Phase |
| --- | --- | --- | --- |
| `hello` | `client`, `protocol {min,max}`, `want[]` → selected version, agent info, `capabilities[]`, `device` | Agent | 0 |
| `session.start` | `app? { id, activity?, args?, env? }`, `settings? { snapshotRetain, idleQuietMs }` → `{ session }` | Agent | 0 |
| `session.stop` | → `{}` | Agent | 0 |
| `device.info` | → platform, `osVersion`, `apiLevel?`, `model`, `serial`/`udid`, `emulator`, `screen`, `locale`, `timeZone` | Agent | 0 |
| `tree.get` | `maxDepth?`, `maxNodes?` (default 5000), `root? {snapshotId,nodeId}`, `filter? {visibleOnly}`, `include? {raw}`, `since?` (diff), `settle? {maxWaitMs, quietMs}` → Snapshot or Diff | Agent | 0 (diff: 3) |
| `action.tap` | `target`, `offset?` → `{ at, durationMs }` | Agent | 0 |
| `screen.screenshot` | `format? png\|jpeg`, `quality?`, `region?` (DIP rect), `delivery? inline\|artifact` → Screenshot (§10.2) | Agent | 0 |
| `element.find` | `locator`, `scope? {snapshotId,nodeId}`, `max?` (default 20), `ancestors?` → `{ snapshotId, matches[], total, truncated }` | Agent | 1 |
| `element.hitTest` | `point` → `{ snapshotId, match }` (topmost node at the point) | Agent | 1 |
| `action.doubleTap` | `target`, `offset?` | Agent | 1 |
| `action.longPress` | `target`, `durationMs?` (default 800) | Agent | 1 |
| `action.type` | `target?`, `text`, `secret?` → focuses `target` first if given; appends | Agent | 1 |
| `action.clear` | `target` | Agent | 1 |
| `action.swipe` | `target?` or `from` point, `direction`, `distance?` (DIP, or 0..1 of target size), `durationMs?` | Agent | 1 |
| `action.scroll` | `target` (scroll container), `direction`, `distance?`, `until? Locator`, `maxSwipes?` → `{ found? }` | Agent (`until` needs `scroll.until`; else host loops) | 1 |
| `action.drag` | `from`, `to` (target or point), `holdMs?`, `durationMs?` | Agent | 1 |
| `action.pinch` | `target?`, `scale` (<1 in, >1 out), `durationMs?` | Agent | 1 |
| `action.pressKey` | `key`: `enter`, `backspace`, `delete`, `tab`, `escape`, `search`, `volumeUp`, `volumeDown`, `power`, or `{ androidKeyCode }` | Agent | 1 |
| `action.back` | — (Android; iOS returns `unsupported`, core may tap the nav-bar back button) | Agent | 1 |
| `action.home` | — | Agent | 1 |
| `idle.wait` | `quietMs?`, `maxWaitMs` → idle object (§9.1) | Agent | 1 |
| `app.launch` | `id`, `activity?`, `args?`, `env?`, `deepLink?`, `coldStart?` → `{ pid?, launchMs? }` | Agent | 1 |
| `app.terminate` | `id` | Agent | 1 |
| `app.state` | `id` → `notInstalled` \| `notRunning` \| `background` \| `foreground` | Agent | 1 |
| `app.install` / `app.uninstall` / `app.reset` (clear data) | — | Host tool (`adb install`, `pm clear`; `simctl install`/`uninstall`) | 1 |
| `context.list` | → native WebView descriptors `{ nodeId, bounds, pid?, packageOrBundle, debuggable? }`; host joins them with CDP/WebKit targets into contexts | Agent + host | 1 |
| `alert.get` | → `{ present, alert? { title, message, buttons[], source: app\|system } }` | Agent (iOS via springboard, IOS-4) | 1 |
| `alert.accept` / `alert.dismiss` | `button?` (label) | Agent | 1 |
| `screen.startRecording` | `maxDurationS?`, `bitRate?` → `{ recordingId }` | Agent (Android `screenrecord` via shell; iOS sim host-side `simctl io recordVideo`) | 1 |
| `screen.stopRecording` | `recordingId` → `{ artifactId, durationMs, format: "mp4" }` | Agent / host | 1 |
| `metrics.start` | `appId`, `metrics[]` (`cpu`, `memory`, `fps`, `jank`), `intervalMs?` (default 1000) → `{ metricsId }`; samples stream as events | Agent | 3 |
| `metrics.stop` | `metricsId` → summary (min/avg/max/p95 per metric, jank count) | Agent | 3 |

**Targets.** Every action takes exactly one target:

| Shape | Meaning |
| --- | --- |
| `{ "node": { "snapshotId": "s-7", "nodeId": "n12" } }` | A node from a snapshot or `find` result. The agent re-reads the element's **current** bounds before acting; gone → `stale-node` |
| `{ "locator": Locator }` | Agent resolves; exactly one match required (`ambiguous` otherwise). Needs `find.agent` |
| `{ "point": { "x": 180, "y": 524 } }` | Raw DIP coordinates; no element checks |

`offset` is a DIP point relative to the node's top-left; default is the centre of the visible part of the node.

**Agent snapshot cache.** The agent keeps a native element reference for every node of the last `snapshotRetain` snapshots (default 4; `find` results count as snapshots). Older IDs return `stale-snapshot`.

**Diffs (phase 3, capability `tree.diff`, requires `tree.persistentIds`).** `tree.get { since: "s-41" }` returns `{ base, snapshotId, ops[] }` with ops `{op:"add", parentId, index, node}`, `{op:"remove", nodeId}`, `{op:"update", nodeId, set:{…}}`. Android can provide persistent IDs from accessibility node IDs; iOS likely cannot, so it returns full snapshots.

## 8. Events

The host opens `GET /v1/events` (WebSocket, same `Authorization` header) after `session.start`. Each text frame is one event:

| Field | Type | Meaning |
| --- | --- | --- |
| `v` | string | Selected version |
| `event` | string | Event name |
| `session` | string | Session ID |
| `seq` | integer | Monotonic per session, starting at 1 |
| `time` | string | ISO 8601 |
| `source` | `"agent"` \| `"host"` | `host` when the host driver synthesised the event (for example from logcat) |
| `data` | object | Payload |

| Event | `data` | Phase |
| --- | --- | --- |
| `app.crashed` | `appId`, `pid?`, `kind: crash\|anr\|killed`, `message?`, `log?` (last 200 lines, secrets masked) | 1 |
| `app.stateChanged` | `appId`, `state` | 1 |
| `alert.appeared` / `alert.dismissed` | `alert` (as in `alert.get`) | 1 |
| `webview.created` / `webview.destroyed` | WebView descriptor as in `context.list` | 1 |
| `metrics.sample` | `metricsId`, `t` (ms since start), `cpuPct?`, `memoryMb?`, `fps?`, `jankFrames?` | 3 |
| `agent.warning` | `message`, `code?` (for example slow traversal) | 1 |

The agent keeps the last 256 events. After a reconnect the host sends `{ "type": "resume", "afterSeq": n }` and the agent replays newer events; if they are gone it sends `{ "type": "gap", "fromSeq": a, "toSeq": b }`. Events are hints: the host never relies on an event alone for correctness (for example it still calls `alert.get` before acting).

## 9. Timing and auto-wait

### 9.1 What the agent guarantees

1. **Consistent snapshot:** `tree.get` captures in one traversal. If the UI changed during traversal (Android: window content change events arrived), the agent retries once and otherwise sets `idle.settled: false`.
2. **Idle signal:** with `settle { maxWaitMs, quietMs }` or `idle.wait`, the agent waits until the UI is quiet, up to `maxWaitMs`, and returns `idle: { settled, waitedMs, animating? }`. Android: `UiAutomation.waitForIdle(quietMs, maxWaitMs)` (no accessibility events for `quietMs`). iOS: XCTest quiescence (main run loop idle and no running animations); `animating` is reported when known. Not settled is **not** an error.
3. **Actions complete before answering:** the response comes after gesture injection finishes (after touch-up), not after the app reacts. No implicit settling unless asked.
4. **No hidden waits or retries:** `element.find` returns immediately with whatever matches now; an empty result is `element-not-found`.
5. **Deadline:** the agent answers before `timeoutMs`; long gestures add their `durationMs` to the budget automatically.

### 9.2 What the host does (CORE-5)

Auto-wait is implemented once in `core` (P0-05), identically for all drivers. Before every action, until the action timeout:

1. Resolve the locator (`element.find`, or `tree.get` + local match). `element-not-found`, `stale-*`, `context-not-found` → retry.
2. **Visible and enabled** from node fields. Not `onScreen` → scroll into view (`action.scroll { until }` or host loop), then continue.
3. **Stable:** bounds unchanged across two resolutions at least 50 ms apart, or one resolution returned with `idle.settled: true`.
4. **Unobscured:** `element.hitTest` at the action point returns the node or a descendant (web: the same check through the browser). Otherwise → retry with `not-interactable/obscured`.
5. Dispatch the action with a `node` target. `stale-node` → back to step 1.

Retries back off 0, 50, 100, 250, 500 ms, then every 500 ms. Every skipped or shortened wait is reported (principle 5). On timeout the error lists the last failed check, the locator, and `nearest` candidates.

### 9.3 Timeouts

| Timeout | Default | Set by |
| --- | --- | --- |
| Agent start (until `PRISM_AGENT_READY` / `hello` answers) | Android 30 s, iOS simulator 120 s (includes runner launch) | Host config |
| `hello`, `session.*`, `device.info` | 10 s | `timeoutMs` |
| `tree.get`, `element.*`, `alert.*`, `context.list` | 10 s | `timeoutMs` |
| `action.*` | 10 s + gesture `durationMs` | `timeoutMs` |
| `app.launch` | 60 s | `timeoutMs` |
| Host transport timeout | `timeoutMs` + 2 s grace, then `agent-crashed` check via `/v1/health` | Fixed |
| Host auto-wait per action / per assertion | Defined by P0-05 (configurable globally, per test and per call) | Test config |

## 10. Healing and visual hooks

### 10.1 Fingerprint data (HEAL-1)

The host records a fingerprint on every successful find. The tree therefore MUST carry, for each match: `role`, `name`, `text`, `testId`, `nativeType`, `bounds`, `context`, stable `raw` keys (`resourceId`, `identifier`, `domId`, `classList`, `name`), plus its **path and ancestors**. Because `element.find` returns matches without the whole tree, each match includes:

| Field | Meaning |
| --- | --- |
| `node` | The matched node without `children` |
| `path` | Child-index path from the root, e.g. `[0, 0, 3, 1]` |
| `ancestors` | Root-to-parent list of `{ role, nativeType, testId, name, index }` (when `ancestors: true`) |
| `siblingCount` | Number of siblings, for positional scoring |

Healing itself (candidate ranking, HEAL-2) runs host-side on a `tree.get` snapshot. Nothing in the protocol sends data off the machine.

### 10.2 Screenshots (VIS-*)

| Field | Meaning |
| --- | --- |
| `format` | `png` (default, lossless; required for visual baselines) or `jpeg` (traces, `quality` 1–100) |
| `width`, `height` | Device pixels |
| `scale` | Device pixels per DIP; masks given in DIP are multiplied by it |
| `orientation` | As in `screen` |
| `region` | DIP rect actually captured (full screen when not set) |
| `data` / `artifactId` | Base64 image (`delivery: inline`) or artifact to fetch (`delivery: artifact`) |
| `capturedAt` | ISO 8601 |

Full-screen captures include system bars; `screen.insets` lets `visual` mask them. Disabling animations and the caret (VIS-3) is done before capture by the host: Android via `settings put global *_animation_scale 0` over ADB and status-bar demo mode; iOS is best effort (open question). The web driver captures through CDP/BiDi with the same result shape.

## 11. Security

1. Agents bind to **127.0.0.1 only**, never `0.0.0.0`. Remote access exists only through ADB forwarding or usbmux tunnelling, which require physical/ADB trust.
2. The host generates a **per-agent-launch token** (32 random bytes, base64url) and passes it at launch (§4.2, §4.3). Every HTTP and WebSocket request MUST send `Authorization: Bearer <token>`; agents compare in constant time and answer `401` with no details on mismatch.
3. Agents reject requests that carry an `Origin` header or a `Host` other than `127.0.0.1:<port>` / `localhost:<port>`. This blocks a browser on the device (or a DNS-rebinding page) from driving the agent.
4. Agents never send values of `password` nodes; `action.type` with `secret: true` is logged as `***`. Tokens never appear in logs, traces or reports.
5. Agents shut down after 30 minutes without a request (configurable) and when the instrumentation/XCTest run ends.
6. No telemetry. Agents make no outbound connections.
7. Cloud farms that cannot use tunnelling need explicit opt-in remote binding; its design (TLS, token scope) is deferred to `cloud-farms.md` (P0-11).

## 12. Worked examples

### 12.1 `hello` handshake

```http
POST /v1/command HTTP/1.1
Host: 127.0.0.1:52817
Authorization: Bearer 3q2-7w...redacted
Content-Type: application/json
```

```json
{
  "v": "1.0",
  "id": "r-1",
  "cmd": "hello",
  "params": {
    "client": { "name": "@prismtest/android", "version": "0.1.0" },
    "protocol": { "min": "1.0", "max": "1.0" },
    "want": ["find.agent", "scroll.until", "tree.diff"]
  }
}
```

```json
{
  "v": "1.0",
  "id": "r-1",
  "ok": true,
  "result": {
    "protocol": { "selected": "1.0", "min": "1.0", "max": "1.0" },
    "agent": { "name": "prism-android-agent", "version": "0.1.0", "platform": "android" },
    "capabilities": ["find.agent", "find.regex", "scroll.until", "action.pinch", "locator.native.uiautomator", "alerts.system", "idle.signal"],
    "device": { "platform": "android", "osVersion": "14", "apiLevel": 34, "model": "sdk_gphone64_x86_64", "serial": "emulator-5554", "emulator": true, "screen": { "width": 360, "height": 800, "scale": 3, "orientation": "portrait" } }
  },
  "timing": { "startedAt": "2026-11-27T10:15:02.114Z", "durationMs": 3 }
}
```

`tree.diff` was wanted but is absent from `capabilities`, so the host uses full snapshots.

### 12.2 `tree.get` response, Android (trimmed)

Device: 1080 × 2400 px, density 3 → 360 × 800 DIP.

```json
{
  "v": "1.0",
  "id": "r-7",
  "ok": true,
  "result": {
    "snapshotId": "s-3",
    "capturedAt": "2026-11-27T10:15:04.502Z",
    "platform": "android",
    "screen": { "width": 360, "height": 800, "scale": 3, "orientation": "portrait", "insets": { "top": 24, "right": 0, "bottom": 48, "left": 0 } },
    "idle": { "settled": true, "waitedMs": 120 },
    "nodeCount": 4,
    "root": {
      "id": "n0", "role": "application", "name": "Shop", "text": null, "value": null, "testId": null,
      "nativeType": "android.widget.FrameLayout", "bounds": { "x": 0, "y": 0, "width": 360, "height": 800 },
      "visible": true, "onScreen": true, "enabled": true, "focused": false, "selected": false, "checked": null,
      "scrollable": false, "password": false, "context": "native",
      "raw": { "package": "com.example.shop", "windowId": 12, "windowType": "application" },
      "children": [
        {
          "id": "n1", "role": "textbox", "name": "Email", "text": null, "value": "ada@example.com", "testId": "com.example.shop:id/email",
          "nativeType": "android.widget.EditText", "bounds": { "x": 16, "y": 300, "width": 328, "height": 56 },
          "visible": true, "onScreen": true, "enabled": true, "focused": false, "selected": false, "checked": null,
          "scrollable": false, "password": false, "context": "native", "hint": "Email",
          "raw": { "resourceId": "com.example.shop:id/email", "className": "android.widget.EditText", "clickable": true, "editable": true, "boundsPx": [48, 900, 1032, 1068] },
          "children": []
        },
        {
          "id": "n2", "role": "textbox", "name": "Password", "text": null, "value": null, "testId": "com.example.shop:id/password",
          "nativeType": "android.widget.EditText", "bounds": { "x": 16, "y": 372, "width": 328, "height": 56 },
          "visible": true, "onScreen": true, "enabled": true, "focused": true, "selected": false, "checked": null,
          "scrollable": false, "password": true, "context": "native",
          "raw": { "resourceId": "com.example.shop:id/password", "className": "android.widget.EditText", "editable": true },
          "children": []
        },
        {
          "id": "n3", "role": "button", "name": "Sign in", "text": "Sign in", "value": null, "testId": "com.example.shop:id/sign_in",
          "nativeType": "android.widget.Button", "bounds": { "x": 16, "y": 500, "width": 328, "height": 48 },
          "visible": true, "onScreen": true, "enabled": true, "focused": false, "selected": false, "checked": null,
          "scrollable": false, "password": false, "context": "native",
          "raw": { "resourceId": "com.example.shop:id/sign_in", "className": "android.widget.Button", "clickable": true, "boundsPx": [48, 1500, 1032, 1644] },
          "children": []
        }
      ]
    }
  },
  "timing": { "startedAt": "2026-11-27T10:15:04.380Z", "durationMs": 122 }
}
```

### 12.3 `tree.get` result, iOS (trimmed, `result` only)

iPhone 15 simulator: 393 × 852 pt, scale 3.

```json
{
  "snapshotId": "s-9",
  "capturedAt": "2026-11-27T10:20:11.090Z",
  "platform": "ios",
  "screen": { "width": 393, "height": 852, "scale": 3, "orientation": "portrait", "insets": { "top": 59, "right": 0, "bottom": 34, "left": 0 } },
  "nodeCount": 3,
  "root": {
    "id": "n0", "role": "application", "name": "Shop", "text": null, "value": null, "testId": null,
    "nativeType": "XCUIElementTypeApplication", "bounds": { "x": 0, "y": 0, "width": 393, "height": 852 },
    "visible": true, "onScreen": true, "enabled": true, "focused": false, "selected": false, "checked": null,
    "scrollable": false, "password": false, "context": "native",
    "raw": { "elementType": 2, "identifier": "", "label": "Shop" },
    "children": [
      {
        "id": "n1", "role": "switch", "name": "Remember me", "text": null, "value": null, "testId": "rememberMe",
        "nativeType": "XCUIElementTypeSwitch", "bounds": { "x": 24, "y": 440, "width": 345, "height": 31 },
        "visible": true, "onScreen": true, "enabled": true, "focused": false, "selected": false, "checked": true,
        "scrollable": false, "password": false, "context": "native",
        "raw": { "elementType": 40, "identifier": "rememberMe", "label": "Remember me", "value": "1" },
        "children": []
      },
      {
        "id": "n2", "role": "button", "name": "Sign in", "text": "Sign in", "value": null, "testId": "signInButton",
        "nativeType": "XCUIElementTypeButton", "bounds": { "x": 24, "y": 500, "width": 345, "height": 50 },
        "visible": true, "onScreen": true, "enabled": true, "focused": false, "selected": false, "checked": null,
        "scrollable": false, "password": false, "context": "native",
        "raw": { "elementType": 9, "identifier": "signInButton", "label": "Sign in" },
        "children": []
      }
    ]
  }
}
```

### 12.4 `element.find` then `action.tap`

```json
{ "v": "1.0", "id": "r-12", "session": "s-1", "cmd": "element.find", "timeoutMs": 10000,
  "params": { "locator": { "kind": "role", "role": "button", "name": { "text": "sign in" } }, "ancestors": true } }
```

```json
{
  "v": "1.0", "id": "r-12", "ok": true,
  "result": {
    "snapshotId": "s-4", "total": 1, "truncated": false,
    "matches": [
      {
        "node": {
          "id": "n3", "role": "button", "name": "Sign in", "text": "Sign in", "value": null, "testId": "com.example.shop:id/sign_in",
          "nativeType": "android.widget.Button", "bounds": { "x": 16, "y": 500, "width": 328, "height": 48 },
          "visible": true, "onScreen": true, "enabled": true, "focused": false, "selected": false, "checked": null,
          "scrollable": false, "password": false, "context": "native", "children": []
        },
        "path": [2],
        "siblingCount": 3,
        "ancestors": [ { "role": "application", "nativeType": "android.widget.FrameLayout", "testId": null, "name": "Shop", "index": 0 } ]
      }
    ]
  },
  "timing": { "startedAt": "2026-11-27T10:15:05.010Z", "durationMs": 41 }
}
```

```json
{ "v": "1.0", "id": "r-13", "session": "s-1", "cmd": "action.tap",
  "params": { "target": { "node": { "snapshotId": "s-4", "nodeId": "n3" } } } }
```

```json
{ "v": "1.0", "id": "r-13", "ok": true, "result": { "at": { "x": 180, "y": 524 }, "durationMs": 62 },
  "timing": { "startedAt": "2026-11-27T10:15:05.071Z", "durationMs": 64 } }
```

### 12.5 Error response

```json
{
  "v": "1.0", "id": "r-21", "ok": false,
  "error": {
    "code": "element-not-found",
    "message": "No node matched role=button name~\"Log in\" in the native context (38 nodes searched). Closest: button \"Sign in\" (score 0.71). Check the label, or use by.testId('sign_in').",
    "retryable": true,
    "details": {
      "locator": { "kind": "role", "role": "button", "name": { "text": "Log in" } },
      "found": 0,
      "searched": 38,
      "nearest": [ { "snapshotId": "s-5", "nodeId": "n3", "role": "button", "name": "Sign in", "testId": "com.example.shop:id/sign_in", "score": 0.71 } ]
    }
  },
  "timing": { "startedAt": "2026-11-27T10:15:09.300Z", "durationMs": 38 }
}
```

The host keeps retrying this until the auto-wait timeout, then raises a test failure that includes this message, the screenshot and the tree.

## 13. Open questions for humans

- [ ] **Default device port and package ID.** Android agent package `io.prismtest.agent`, default device port 7100 (configurable): acceptable, or align with a namespace we own (depends on the domain decision)?
- [ ] **Token delivery on Android.** Passing the token as an instrumentation argument makes it visible to `ps` on the device for the shell user. Acceptable for test devices, or should the host push it to the agent's private storage instead?
- [ ] **usbmux and loopback on iOS devices.** Confirm in P0-10 that a usbmux tunnel reaches a runner bound to the device's loopback only. If not, which interface binding is acceptable?
- [ ] **Agent-side waiting.** v1 keeps all polling host-side (simpler, one auto-wait implementation). Should a later minor add an agent-side `element.find { waitMs }` to save round trips if the 300 ms find + tap target is missed?
- [ ] **`text` on web.** Is "direct text nodes, or full `innerText` for buttons, links, options and headings" the right rule, or should `by.text` match full `innerText` of any element (Playwright-like, more matches, more ambiguity)?
- [ ] **Merged hybrid tree by default?** Should `tree.get` from the host driver return native + WebView nodes merged (§2.7) by default, or only on request (merging costs a CDP round trip per WebView)?
- [ ] **Role vocabulary.** Is the 35-role list right? In particular `radiogroup`, `tabpanel`, `navigation` and `frame` are deliberately left out (mapped to `group`/`generic`).
- [ ] **iOS animations and caret for VIS-3.** XCTest cannot disable animations app-wide. Do we accept best effort, or require an opt-in launch argument that apps under test honour?
- [ ] **iOS metrics source (PERF-9).** XCTest metrics (`XCTCPUMetric`, `XCTMemoryMetric`) only work inside measure blocks. Use them, sample from the host (Instruments / `xctrace`), or make iOS metrics P2?
- [ ] **Cloud farm remote binding.** Farms that allow custom agents but no tunnel would need a remotely reachable agent. Allow it behind TLS + token, or require the Appium/WebDriver fallback there (P0-11 input)?
- [ ] **Conformance fixtures.** Agree that shared locator test vectors (tree JSON + locator + expected matches) live in `docs/design/protocol-fixtures/` and run in the Kotlin, Swift and TypeScript test suites.
- [ ] **Licence check for reused code.** Any code adapted from WebDriverAgent (BSD-3-Clause) for the iOS runner keeps its notice; confirm this is enough for the project's MIT distribution.

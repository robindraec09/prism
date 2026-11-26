# Design note: normalised UI tree and host↔agent protocol

| | |
| --- | --- |
| Task | P0-02 |
| Requirements | CORE-2, CORE-3, CORE-4, CORE-5, CORE-9, AND-2, IOS-1, IOS-4, HYB-1, HYB-2, HEAL-1, VIS-1..3, PERF-9 |
| Protocol version | **1.0.0** (draft: changes before human approval do not bump the version) |
| Status | Proposed, revision 2 (reviewer findings addressed) |
| Machine-readable schema | [`protocol.schema.json`](./protocol.schema.json) (JSON Schema 2020-12) |
| Consumers | `@prismtest/core`, `web`, `android`, `android-agent`, `ios`, `ios-runner`, `heal`, `visual`, `perf` |

The key words MUST, SHOULD and MAY are used as in RFC 2119. "Host" means the Node.js driver; "agent" means the on-device Android APK or the iOS XCTest runner.

## 1. Goals and non-goals

**Goals**

1. One element model. Every UI driver (web, Android, iOS, hybrid WebViews) produces the same **normalised UI tree**, so locators, auto-wait, healing, visual masks and reports are written once in `core`.
2. One wire protocol between host drivers and on-device agents, versioned so host and agent can be upgraded independently within a major version.
3. **Language-neutral.** Plain JSON over HTTP and WebSocket, specified by this note and a JSON Schema. Nothing depends on TypeScript, so Python/Java bindings (v1.x) can drive an agent directly.
4. Meet the PRD target: native find + tap median < 300 ms on an emulator/simulator (budget in §9.4).
5. Failures that explain themselves (PRD principle 4): every error carries what was tried, what was found, and what to do next.

**Non-goals (v1)**

- Agents do not run retry loops or wait policies. They execute one command, apply one-shot checks, and answer. Policy lives in the host.
- The web driver does not use the agent transport (§4.5).
- No remote exposure of agents by default (§11).
- No binary framing (Protobuf, CBOR). Large payloads go through the artifact endpoint or gzip.
- Multiple displays (Android external/virtual displays): v1 captures the default display only.
- Desktop and TV platforms (PRD non-goals).

## 2. Normalised UI tree

### 2.1 Snapshot

A `tree.get` call returns one **snapshot**: a capture of the UI at one moment.

| Field | Type | Req | Meaning |
| --- | --- | --- | --- |
| `snapshotId` | string | yes | `<instanceId>.s-<n>` (§5.3). Node IDs are only meaningful together with it. |
| `capturedAt` | string | yes | ISO 8601 UTC with milliseconds. |
| `platform` | string | yes | Known values `android`, `ios`, `web`. |
| `screen` | Screen | yes | See below. |
| `idle` | Idle | no | Idle signal at capture time (§9.1). |
| `root` | Node | yes | Synthetic `screen` node on native (§2.7); `document` on web. |
| `nodeCount` | integer | yes | Nodes in `root` after filters. |
| `truncated` | boolean | yes | `true` if `maxDepth` or `maxNodes` cut the tree. |

**Screen:** `width`, `height` in DIP; `scale` (device pixels per DIP); `rotation` (`0`, `90`, `180`, `270`: degrees the UI content is rotated clockwise from the device's natural orientation); `orientation` (`portrait` or `landscape`, derived from width vs height, for readability only); optional `insets { top, right, bottom, left }` in DIP (status bar, cut-out, navigation bar, home indicator).

Rotation in degrees avoids the iOS naming trap where `UIDeviceOrientation.landscapeLeft` equals `UIInterfaceOrientation.landscapeRight`. Agents report the **interface** rotation (where the UI is drawn), not the physical device rotation.

### 2.2 Node fields

| Field | Type | Req | Meaning |
| --- | --- | --- | --- |
| `id` | string | yes | Unique within the snapshot. Not stable across snapshots unless the agent advertises `tree.persistentIds`. |
| `role` | string | yes | From the role vocabulary of the negotiated version (§2.3). |
| `name` | string \| null | yes | Accessible name (what a screen reader announces as the label). |
| `text` | string \| null | yes | Text the node renders (rules per platform in §2.5). Normalised as in §3.4. |
| `value` | string \| null | yes | Current value: editable text, slider position, picker value. Always `null` when `password` is true. |
| `hint` | string \| null | no | Placeholder, hint or tooltip. |
| `testId` | string \| null | yes | `resource-id` (Android), `accessibilityIdentifier` (iOS), configured attribute (web, default `data-testid`). Empty strings are sent as `null`. |
| `nativeType` | string | yes | Android class name, `XCUIElementType…` name, or lower-case HTML tag. |
| `bounds` | Rect | yes | `{ x, y, width, height }` in DIP (§2.6). Fractions allowed. |
| `visible` | boolean | yes | Rendered with non-zero size. Exact meaning per platform in §2.6.1. |
| `onScreen` | boolean | yes | `visible` and intersects the screen (native) or the context's viewport (web). |
| `enabled` | boolean | yes | The node itself accepts input. Ancestors are not considered here; actionability checks are (§9.2). |
| `focused` | boolean | yes | Has input focus. Reliable only with capability `state.focused` (iOS: §2.5). |
| `selected` | boolean | yes | Selected (tab, list row, segmented item). |
| `checked` | `true` \| `false` \| `"mixed"` \| null | yes | `null` when the node is not checkable. |
| `expanded` | boolean \| null | no | `null` when not expandable. |
| `scrollable` | boolean | yes | Can scroll its content. |
| `password` | boolean | yes | Secure text entry. Agents MUST NOT send the value anywhere, including `raw` (§11). |
| `webContent` | boolean | yes | Node is web content exposed through the native accessibility tree under a `webview` node (§2.8). |
| `level` | integer | no | Heading level. Web only in v1. |
| `context` | string | yes | `native` or a web context ID (§2.8). |
| `children` | Node[] | yes in snapshots | Back to front in z-order, then reading order. Empty for leaves. Omitted in `element.find` matches, which carry `childCount` instead. |
| `childCount` | integer | no | Number of children. Present when `children` is omitted. |
| `raw` | object | no | Platform attributes (§2.9). Omitted when `include.raw` is false. |

Booleans are always present (no "absent means false"), so any language can deserialise without defaults.

### 2.3 Role vocabulary (v1.0)

Roles use ARIA spelling where an ARIA role exists.

| Group | Roles |
| --- | --- |
| Structure | `screen` (native root only), `application`, `window`, `document`, `webview`, `dialog`, `alert`, `keyboard`, `generic`, `group`, `toolbar` |
| Collections | `list`, `listitem`, `grid`, `row`, `cell`, `tablist`, `tab`, `menu`, `menuitem`, `listbox`, `option` |
| Controls | `button`, `link`, `textbox`, `searchbox`, `checkbox`, `radio`, `switch`, `slider`, `spinbutton`, `combobox`, `progressbar` |
| Content | `text`, `heading`, `image` |

**Rules for evolving roles.** On the wire `role` is an open string. Adding a role is a minor version change, but it re-labels nodes that used to be `generic` (or another role), which changes what `by.role` matches. So:

1. Producers MUST emit only roles that exist in the **negotiated** version. A 1.3 agent talking to a 1.0 host maps 1.3-only roles back to their 1.0 fallback (`generic` unless the role's definition says otherwise).
2. Consumers MUST treat an unknown role as `generic`.
3. The schema keeps roles open (`string`) and lists the known ones in `KnownRole`; conformance tests check producers against `KnownRole` for the negotiated version.

**Mapping precedence** (all platforms): explicit semantics first (ARIA role, collection info, heading flag, window type), then the class/type tables below, then context rules (a direct child of `list` whose role would be `generic` becomes `listitem`; a `button` inside `tablist` becomes `tab`), else `generic`.

### 2.4 Role mapping per platform

**Android** (`AccessibilityNodeInfo`). Collection info is used before class names because Jetpack Compose lazy lists are not `RecyclerView`s and many Compose roles arrive as plain `android.view.View`.

| Signal | Role |
| --- | --- |
| `isHeading()` (API 28+) | `heading` |
| `getCollectionInfo()` non-null: `columnCount > 1` and `rowCount > 1` → `grid`; otherwise | `list` |
| `getCollectionItemInfo()` non-null, parent is `grid` / `list` | `cell` / `listitem` |
| `android.widget.Button`, `ImageButton`, Material `MaterialButton`, `FloatingActionButton` | `button` |
| `android.widget.ToggleButton` | `button` (with `checked`) |
| `android.widget.TextView`, `AppCompatTextView`, `MaterialTextView` | `text` |
| `android.widget.EditText`, `AppCompatEditText`, `TextInputEditText` | `textbox` |
| `android.widget.AutoCompleteTextView`, `android.widget.Spinner` (also Compose `Role.DropdownList`) | `combobox` |
| `SearchView$SearchAutoComplete` | `searchbox` |
| `android.widget.CheckBox`, `CheckedTextView` (when checkable) | `checkbox` |
| `android.widget.RadioButton` / `RadioGroup` | `radio` / `group` |
| `android.widget.Switch`, `SwitchCompat`, `SwitchMaterial` | `switch` |
| `android.view.View` that is checkable but has no more specific class (Compose `Role.Switch`) | `switch` (best effort, see below) |
| `android.widget.SeekBar`, `RatingBar` | `slider` |
| `android.widget.ProgressBar` | `progressbar` |
| `android.widget.NumberPicker` | `spinbutton` |
| `android.widget.ImageView` | `image` |
| `TabLayout`, `TabWidget` / `TabLayout$TabView` | `tablist` / `tab` |
| `android.widget.Toolbar`, `androidx.appcompat.widget.Toolbar` | `toolbar` |
| `android.webkit.WebView` | `webview` |
| `ScrollView`, `HorizontalScrollView`, `NestedScrollView`, `ViewPager`, layouts, `View`, `ViewGroup` | `generic` |

Agents MUST NOT derive roles from `roleDescription`, because it is localised (Compose `Role.Switch` and `Role.Tab` only expose a translated string). It is kept in `raw.roleDescription` for debugging. Known gap: Compose tabs map to `generic` or `button`, not `tab`.

**iOS** (`XCUIElement.elementType`). XCTest exposes no accessibility traits publicly, so iOS never emits `heading` and never sets `level` in v1.

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
| `Alert` | `alert` |
| `Sheet`, `Dialog`, `Popover` | `dialog` |
| `Menu` / `MenuItem` | `menu` / `menuitem` |
| `Keyboard` (`Key` → `button`) | `keyboard` |
| `WebView` | `webview` |
| `ScrollView`, `Other`, `Group`, `StatusBar`, anything else | `generic` |

**Web** (computed AX roles: Chromium `Accessibility.getFullAXTree` per frame, BiDi/WebKit equivalents per §4.5).

| Computed AX role | Role |
| --- | --- |
| `RootWebArea` | `document` |
| `button`, `link`, `textbox`, `searchbox`, `checkbox`, `radio`, `switch`, `slider`, `spinbutton`, `combobox`, `listbox`, `option`, `progressbar`, `list`, `listitem`, `row`, `tab`, `tablist`, `toolbar`, `menu`, `heading`, `dialog`, `alert`, `group` | same name |
| `menuitem`, `menuitemcheckbox`, `menuitemradio` | `menuitem` (`checked` set for the last two) |
| `grid`, `table`, `treegrid` / `cell`, `gridcell`, `columnheader`, `rowheader` | `grid` / `cell` |
| `alertdialog` | `dialog` |
| `img`, `image` | `image` |
| `figure` | `group` (keeps its children; `image` would hide them) |
| `StaticText` | `text` |
| `iframe` element | `generic`; its children carry the frame's context ID |
| `generic`, `none`, `presentation`, anything else | `generic` |

### 2.5 Field sources per platform

| Field | Android (`AccessibilityNodeInfo`) | iOS (`XCUIElement` snapshot) | Web (DOM + AX) |
| --- | --- | --- | --- |
| `name` | `contentDescription`, else `labeledBy` text, else `text` (non-editable); editables: `hintText`, then `labeledBy`, then `contentDescription` | `label` | AX name (accname algorithm) |
| `text` | `text` of non-editable nodes | `label` for `StaticText`, `Button`, `Link`, `MenuItem`; else `null` | Decision D2 (§13): direct text-node children, or full `innerText` for name-from-content roles |
| `value` | `text` of editables; `RangeInfo.current` for range nodes | `value` (stringified); switches use `checked` instead | AX value / `input.value` |
| `hint` | `hintText`, `tooltipText` | `placeholderValue` | `placeholder`, `title` |
| `testId` | `viewIdResourceName` (full, e.g. `com.shop:id/sign_in`) | `identifier` | configured attribute, default `data-testid` |
| `nativeType` | `className` | `XCUIElementType` name | tag name |
| `enabled` | `isEnabled` | `isEnabled` | not `disabled` / `aria-disabled` |
| `focused` | `isFocused` | `hasKeyboardFocus`, which is **private** (KVC on the snapshot). Without it: `false`, and `state.focused` is not advertised | `document.activeElement` (through shadow roots) |
| `selected` | `isSelected` | `isSelected` | AX `selected` |
| `checked` | `isCheckable ? isChecked : null` | switch `value` `"1"`/`"0"`, else `null` | AX `checked` (`mixed` supported) |
| `scrollable` | `isScrollable` | type is `ScrollView`/`Table`/`CollectionView`/`TextView` | computed overflow + scroll size |
| `password` | `isPassword` | type `SecureTextField` | `input[type=password]` |

### 2.6 Coordinates and scale

- All `bounds` and all coordinates in commands are **device-independent pixels (DIP)**: Android `px / displayMetrics.density`; iOS points; web CSS pixels.
- `screen.scale` converts DIP to device pixels (Android `density`, iOS `UIScreen.scale`, web `devicePixelRatio`). Screenshots are in device pixels (§10.2).
- Origin is the top-left of the screen as the UI is currently drawn (after `rotation`). Agents convert to their native injection space. iOS landscape frames have known quirks in XCTest; P0-10 MUST verify them on a rotated simulator.
- Web nodes in a standalone browser are relative to the top-level viewport. When the host merges WebView nodes into a native tree (§2.8), it converts them to screen DIP using the WebView node's `bounds` and the page zoom.

#### 2.6.1 `visible` and `onScreen` per platform

| Platform | `visible` | `onScreen` | Not detectable |
| --- | --- | --- | --- |
| Android | `isVisibleToUser()`. This is already clipped to the screen and window, so in practice `visible` implies `onScreen` | `visible` and bounds intersect the screen | Alpha 0 views are reported visible; views with no accessibility node do not exist |
| iOS | `frame` has non-zero width and height. Hidden views are not in the accessibility tree at all | `visible` and `frame` intersects the screen | XCTest exposes neither `isHidden` nor alpha; alpha-0 views may appear visible |
| Web | Non-empty box, not `display:none`, not `visibility:hidden`. `opacity:0` counts as visible, to match native | `visible` and the box intersects the context's viewport | — |

Off-screen rows of recycled lists (`RecyclerView`, Compose lazy lists, `UITableView`) **do not exist in any tree** until scrolled in. The scroll-search rule in §9.3 covers this.

### 2.7 Native root, windows and system UI

The native root is a synthetic node `{ role: "screen", nativeType: "prism.Screen" }` whose bounds are the screen. Its children are windows, back to front:

| Platform | Children of `screen` |
| --- | --- |
| Android | One node per `AccessibilityWindowInfo` from `UiAutomation.getWindows()` on the default display, sorted by layer: application windows → `window` (or `dialog`, best effort, when smaller than the screen and above another app window), `TYPE_INPUT_METHOD` → `keyboard`, system windows (status bar, notification shade, permission controller) → `window` with `raw.windowType: "system"`. Each window's single child is its root view. |
| iOS | The app under test (`application`). When a springboard alert is present (permission prompts, IOS-4), the agent grafts springboard's alert subtree as a later sibling (`role: "alert"`, `raw.source: "springboard"`), so z-order, `element.hitTest` and the unobscured check (§9.2) see it. The keyboard is inside the app's tree (`XCUIElementTypeKeyboard`). |

`raw.displayId` is set on Android windows. Other displays (`getWindowsOnAllDisplays`, API 30) are out of scope for v1.

### 2.8 Contexts, WebViews and hybrid apps

| Context ID | Meaning | Who assigns |
| --- | --- | --- |
| `native` | Native UI of the app and device | Fixed |
| `web:<target>` | One web page: browser tab, or a WebView in an app (`<target>` is a CDP target ID or WebKit page ID) | Host |
| `web:<target>/<frameId>` | An iframe inside that page (including out-of-process iframes) | Host |

Agents only ever emit `native`. The host reaches web content through a web backend (§4.5): CDP over ADB-forwarded sockets for Android WebViews, or the WebKit Inspector Protocol for iOS WKWebViews.

**Web content inside native trees.** Android and iOS already expose WebView content as native accessibility nodes under the `webview` node. Policy:

1. Agents emit these nodes (they are the only way in when the WebView is not inspectable) with `webContent: true` and `context: "native"`.
2. Native-context locator resolution **skips** `webContent` nodes unless the locator sets `includeWebContent: true`. This avoids ambiguous matches against the real web context and stops the host from acting on web content through the native layer by accident.
3. When the host cannot attach to a WebView (not inspectable, see §4.5), it uses `includeWebContent: true` as a fallback and reports this as a warning (principle 5).
4. `tree.get` takes `webContent: "include" | "prune"` (default `include`); the host uses `prune` when it already has the web context.
5. In a merged tree (Decision D3, §13), the host **replaces** the native `webContent` nodes under each `webview` node with the web context's nodes.

### 2.9 `raw` conventions

Keys are camelCase. Consumers MUST NOT require any `raw` key; `raw` is for debugging, healing and native predicates. For `password` nodes, agents MUST omit every key that could carry the value (`text`, `value`, `label`); iOS often returns bullets in `value`, and those are omitted too.

| Platform | Keys (when available) |
| --- | --- |
| Android | `className`, `resourceId`, `package`, `clickable`, `longClickable`, `focusable`, `checkable`, `editable`, `windowId`, `windowType`, `displayId`, `drawingOrder`, `actions` (string array), `boundsPx` `[l,t,r,b]`, `roleDescription`, `collectionInfo`, `collectionItemInfo` |
| iOS | `elementType` (integer), `identifier`, `label`, `value`, `placeholderValue`, `frame` (points), `source` (`app`/`springboard`) |
| Web | `tag`, `domId`, `classList`, `name`, `type`, `href`, `backendNodeId`, `frameId`, `axRole`, `shadowHost` (boolean) |

## 3. Locator resolution

### 3.1 Locator wire format

`by.*` calls compile to a JSON **locator AST**, shared by host and agents.

| `kind` | Fields | Matches |
| --- | --- | --- |
| `role` | `role`, optional `name` (TextMatch) | `role` equal, and `name` matches if given |
| `text` | TextMatch fields | Nodes whose `text` matches; if none match, nodes whose `name` matches. Innermost rule applies (§3.3) |
| `label` | TextMatch fields | `name` matches (`by.label`). Innermost rule applies |
| `testId` | `value` | `testId` equal; on Android also equal to the part after `:id/` |
| `css` | `selector` | Web contexts only, evaluated by the browser |
| `xpath` | `expr` | Web: by the browser on the DOM. Native: host-side on the XML projection (§3.5) |
| `native` | `engine` (`uiautomator`, `nspredicate`, `classchain`), `query` | Agent-side only |
| `and` / `or` | `of: Locator[]` | Nodes matched by all / any |
| `within` | `scope: Locator`, `target: Locator` | `target` matches that are descendants of **any** `scope` match (union, no duplicates) |
| `platform` | `web?`, `android?`, `ios?`, `default?` | Per-platform override (CORE-3); resolved by the host, never sent to an agent |

Every locator MAY carry `filter: { visible?, enabled?, onScreen? }`, `nth` (0-based; negative counts from the end) and `includeWebContent` (§2.8).

**TextMatch** is either `{ "text": string, "exact"?: boolean }` or `{ "regex": { "source": string, "flags"?: "i" | "" } }`.

### 3.2 Where resolution runs

| Locator | Phase 0 | Phase 1+ | Notes |
| --- | --- | --- | --- |
| `role`, `text`, `testId`, `label`, `and`, `or`, `within` | Host, on a snapshot | Agent (`element.find`) when it advertises `find.agent`; host otherwise | One canonical implementation in `core` (P0-04); agents MUST give identical results, checked by shared conformance fixtures |
| `text`/`label` with `regex` | Host | Agent only with `find.regex` and a pattern in the portable subset (§3.4); otherwise host | |
| `xpath` (native) | Host | Host | Avoids three XPath engines with different quirks |
| `xpath`, `css` (web) | Browser | Browser | Shadow DOM piercing is the web driver's job |
| `native` | — | Agent only | `uiautomator` = `UiSelector`/`By` syntax; `nspredicate`, `classchain` = XCTest query syntax |
| `platform` | Host | Host | Picks a branch, then resolves that branch as above |

**Agent fast paths.** `element.find` MAY narrow candidates with native queries before applying canonical matching, so a full snapshot is not needed: Android `findAccessibilityNodeInfosByViewId` (testId), `findAccessibilityNodeInfosByText` (text/label; case-insensitive substring over text and content description); iOS `descendants(matching: .any).matching(identifier:)` (testId) and `NSPredicate` `label CONTAINS[c]` (text). A fast path is only a pre-filter. The agent MUST then apply §3.3 to the candidates, and to their subtrees for the innermost rule, so results equal the canonical engine.

**Fallback.** If an agent answers `element.find` with `unsupported`, the host calls `tree.get` and matches locally.

**Override selection (CORE-3).** The host picks the branch by the context being searched: a `web:*` context uses `web`; `native` uses `android` or `ios` by device platform; if that key is absent, `default`; if neither exists, `unsupported` names the missing key. With automatic context switching in hybrid apps (HYB-2), the host searches `native` first, then each web context, unless the locator is web-only (`css`) or native-only (`native`).

### 3.3 Matching order

For one context, in this order:

1. **Candidates:** every node in pre-order (document order), skipping `webContent` nodes unless `includeWebContent`.
2. **Match** by `kind`.
3. **Filter:** drop matches failing `filter`.
4. **Innermost** (`text` and `label` only): drop any match that has a matching descendant. So `by.text('Sign in')` returns the `StaticText` inside an iOS button, not both; taps land on it, and the actionability check (§9.2) treats a disabled ancestor as disabled.
5. **`nth`** picks one match from what is left; out of range means `element-not-found`.

### 3.4 Text normalisation, case folding and regex

Applied to both the node string and the locator string before comparing:

1. Unicode NFC.
2. Remove U+200B (zero-width space), U+2060 (word joiner) and U+FEFF (BOM).
3. Replace every Unicode `White_Space` character (including U+00A0 NBSP, U+2007, U+202F) with U+0020, collapse runs to one space, and trim.

Default comparison (`exact` absent or false): case-insensitive substring using **locale-independent Unicode simple case folding** (`CaseFolding.txt` status C and S; no Turkish special cases). `exact: true`: whole string, case-sensitive. Android implements folding with `android.icu.lang.UCharacter.foldCase(codePoint, true)`; Swift with a table generated from `CaseFolding.txt`. Conformance fixtures include these cases.

**Portable regex subset** (agents with `find.regex`): literals and escapes; `.`; classes `[...]`, `[^...]`; `\d \w \s \b` (ASCII meaning); anchors `^ $`; groups `( )`, `(?: )`; alternation `|`; quantifiers `* + ? {m,n}` and their lazy forms. Flag `i` only, which guarantees ASCII case-insensitivity. Not allowed: backreferences, lookaround, named groups, Unicode property escapes. The host checks the pattern against this subset before sending and resolves anything else itself.

### 3.5 XPath projection for native trees

Host-side XPath 1.0 runs on an XML view of the normalised tree: element name = `nativeType` (so `//android.widget.Button` and `//XCUIElementTypeButton` work as people expect); attributes = all scalar node fields plus scalar `raw` values (`@text`, `@testId`, `@resource-id` alias, `@name`, `@label` alias, `@enabled`, `@x`, `@y`, `@width`, `@height`). `webContent` nodes are included only with `includeWebContent`.

## 4. Transport

### 4.1 Endpoints

All agents expose the same HTTP/1.1 server. Bodies are UTF-8 JSON (`Content-Type: application/json`).

| Method + path | Purpose | Blocked by a running command? |
| --- | --- | --- |
| `GET /version` | **Unversioned**: `{ "protocol": { "min", "max" }, "agent": { "name", "version", "instanceId" } }`, so any host (including a future v2 host) can identify any agent | Never |
| `GET /v1/health` | `{ "ok": true, "instanceId", "uptimeMs", "session": string \| null, "running": { "id", "cmd", "forMs" } \| null }` | Never |
| `POST /v1/command` | Every command, including `hello` (§6) | — |
| `GET /v1/events` | WebSocket upgrade for events (§8) | Never |
| `GET /v1/artifacts/{artifactId}` | Binary download (screenshots on request, large trees, logs). `DELETE` frees it | Never |

All endpoints require the token (§11).

**Sizes and compression.** Request bodies are at most 1 MiB (`413` otherwise). Hosts MUST send `Accept-Encoding: gzip` and agents SHOULD honour it (a 2,000-node Android tree is roughly 0.5–1 MB of JSON before compression). `tree.get` with `delivery: "artifact"` returns `{ artifactId, bytes }` instead of an inline snapshot; hosts SHOULD use it for inspector and failure dumps.

### 4.2 Threading and concurrency

- The HTTP server runs on its own threads (Android: a non-main thread pool; iOS: a background GCD queue). `/version`, `/v1/health`, `/v1/events`, artifacts and `session.stop` are answered on server threads and never wait for the executor.
- Commands run one at a time per session on a single **executor**: a dedicated worker thread on Android, the main thread on iOS (XCTest requires it).
- XCTest calls cannot be pre-empted. If a command hits `timeoutMs`, the server thread answers `timeout`, but the executor stays occupied until the XCTest call returns. Until then, new commands get `busy` with `details: { runningId, runningCmd, runningForMs }`. The host waits for `/v1/health` to show `running: null` before retrying.
- **Sessions:** one active session per agent. `session.start` while a session is active fails with `session-active` (`details.session`), unless `params.replace: true`, which stops the old session first. `session.stop` marks the running command `cancelled` (its result is discarded) and returns once the executor is free or after its own `timeoutMs`, whichever comes first.

### 4.3 Android

1. The host installs the agent APK and test APK (once per agent version), then starts: `am instrument -w -e prismPort <devicePort> -e prismToken <token> io.prismtest.agent.test/androidx.test.runner.AndroidJUnitRunner`.
2. The agent binds **127.0.0.1:`<devicePort>`** on the device (default 7100) and prints `PRISM_AGENT_READY port=<n> instance=<id> protocol=1.0.0` to the instrumentation output.
3. The host runs `adb forward tcp:0 tcp:<devicePort>` (adb picks a free host port) and talks to `http://127.0.0.1:<hostPort>`. The same works for USB and Wi-Fi ADB (AND-4).
4. The host removes the forward when the session ends. If the instrumentation process exits, the host reports `agent-crashed`.

### 4.4 iOS

- **Simulator:** the host launches the runner with `xcodebuild test-without-building`. `xcodebuild` forwards only `TEST_RUNNER_`-prefixed environment variables to the runner (with the prefix stripped), so the host sets `TEST_RUNNER_PRISM_PORT` and `TEST_RUNNER_PRISM_TOKEN`, or writes them into a temporary `.xctestrun` file (mode 0600, deleted after launch). Simulators share the Mac's network stack, so the runner binds `127.0.0.1:<port>` and the host connects directly. Each simulator gets its own port (EMU-4).
- **Real device (IOS-3, P1):** the host tunnels through usbmux (the usbmuxd socket on macOS), the way `iproxy` does. It is still open whether usbmux reaches a loopback-only listener (§14).

### 4.5 Web backends (no agent transport)

The web driver talks to browsers directly and **does not use this transport, envelope or handshake**. It MUST still produce the same snapshot and node types (§2), accept the same locator AST (§3), raise the same error codes (§6.3), and emit the same events where they apply.

| Backend | Used for | Tree source | Notes |
| --- | --- | --- | --- |
| CDP | Chromium (WEB-1), Android WebViews (HYB-1) | `Accessibility.getFullAXTree` per frame, joined to DOM | `getFullAXTree` does not cross out-of-process iframes: the driver uses `Target.setAutoAttach { flatten: true }`, fetches one tree per frame target and stitches them, giving each frame its own context ID |
| WebDriver BiDi | Firefox (WEB-2) | DOM + injected accessibility script | Owned by `web-driver-engineer` |
| **WebKit Inspector Protocol (WIP)** | iOS WKWebViews (HYB-1), Safari on the iOS simulator (WEB-6) | DOM domain + injected script that computes roles and names | WIP is **not CDP** and has no full AX tree (only `DOM.getAccessibilityPropertiesForNode`, one node per call). This is a third backend, in scope for phase 2 (risk R3, §13) |

**Requirements on the app under test (hybrid):**

- Android: the app calls `WebView.setWebContentsDebuggingEnabled(true)` (a debuggable manifest alone does not enable it).
- iOS: apps built with the iOS 16.4+ SDK must set `WKWebView.isInspectable = true`. Apps built with older SDKs are inspectable only in development-signed builds.
- If neither holds, the WebView's native accessibility children (§2.8) are the only access, with reduced fidelity and no `css`/`xpath`.

## 5. Versioning and identity

### 5.1 Version numbers and negotiation

- The **protocol version** is semantic, `MAJOR.MINOR.PATCH`, independent of npm package versions. The current version is `1.0.0`.
- **Major** is in the URL (`/v1/`). A host learns an unknown agent's range from `GET /version` before using a versioned path.
- **Minor** is negotiated in `hello`. Both sides declare `{ min, max }` as `MAJOR.MINOR`; the selected version is the highest that both support. If there is no overlap, the answer is `version-mismatch` with both ranges.
- **Patch** changes are clarifications only and are ignored in negotiation.
- **Capabilities** (string list in `hello`) gate optional features that some platforms cannot implement (`action.pinch`, `tree.diff`, `state.focused`). A capability can be added in a minor version, never removed without a major.

| Change | Version bump |
| --- | --- |
| Remove or rename a command, field, role, error code or event | Major |
| Change a field's type, unit, coordinate space or meaning | Major |
| Make an optional parameter required, or change a default so behaviour changes | Major |
| Add a command, optional parameter, result field, error code, event or capability | Minor |
| Add a role (re-labels nodes; producers follow §2.3 rule 1) | Minor |
| Clarify wording, fix examples | Patch |

### 5.2 Compatibility rules

1. **Must-ignore:** receivers ignore unknown fields in requests, results, events and frames.
2. **Open enumerations:** every enumerated string on the wire (role, platform, orientation, format, source, engine, error code, event name) is an open string. Unknown command → `unknown-command`. Unknown role → `generic`. Unknown error code → use its `retryable` flag. Unknown event → ignore.
3. A sender only uses commands, parameters, roles and capabilities that exist in the **selected** version.
4. Each host release bundles agent binaries for its own protocol version. On `version-mismatch` the host reinstalls its bundled agent (automatically on Android; on the iOS simulator by reinstalling the runner) and retries `hello` once. Otherwise it fails with both versions and the fix in the message.
5. Every request, response and event carries `v` (the selected `MAJOR.MINOR`), so traces describe themselves.

### 5.3 Agent instance ID

At start-up each agent process generates an `instanceId`: 8 random characters, lower-case base32. It appears in `GET /version`, `/v1/health`, the `hello` result and the ready line. Every `snapshotId` and session ID is prefixed with it (`k7q2xm4p.s-3`, `k7q2xm4p.sess-1`). This lets the host:

- detect an agent restart (a new `instanceId` in `/v1/health`) and fail fast with `agent-crashed` instead of a confusing `stale-snapshot`;
- reject IDs from a previous agent process locally;
- know that a restart in event `seq` numbering comes with a new session ID.

## 6. Message envelope

### 6.1 Request

| Field | Type | Req | Meaning |
| --- | --- | --- | --- |
| `v` | string | yes | Selected `MAJOR.MINOR` (`hello` uses the host's max) |
| `id` | string | yes | Request ID chosen by the host, unique per connection; echoed in the response and in logs |
| `cmd` | string | yes | Command name (§7) |
| `session` | string | yes, except `hello`, `session.start`, `device.info` | Session ID |
| `params` | object | yes | Command parameters (`{}` if none) |
| `timeoutMs` | integer | no | Budget for this command. The agent MUST answer before it expires (with `timeout` if needed). Defaults in §9.5 |

### 6.2 Response

| Field | Type | Req | Meaning |
| --- | --- | --- | --- |
| `v`, `id` | string | yes | Echoed |
| `ok` | boolean | yes | Discriminator |
| `result` | object | if `ok` | Command result |
| `error` | Error | if not `ok` | See below |
| `timing` | object | yes from agents | `{ startedAt, durationMs, implicitWaitMs? }` measured by the agent. `implicitWaitMs` is time spent in waits the platform forced (§9.1). Absent only on host-synthesised `agent-crashed` |

HTTP status is `200` for every protocol-level response, including errors. Non-200 means transport or auth trouble: `401` unauthorized, `403` rejected `Origin`/`Host`, `404` unknown major, `413` body too large, `500` agent bug with no JSON.

**Error object:** `code` (string, §6.3); `message` (one human sentence covering what was tried, what was found and what to do next); `retryable` (boolean); optional `details` (object, for example: `locator`, `found`, `searched`, `truncated`, `nearest` candidates with scores, `reason`, `expected`/`actual` fingerprints or versions, `runningId`, native exception class and message).

### 6.3 Error codes

`Retryable` is the boolean the agent sends. "Host guidance" says how often and under what conditions the host retries.

| Code | Meaning | Retryable | Host guidance |
| --- | --- | --- | --- |
| `invalid-request` | Malformed envelope or params | false | Host bug; report |
| `unknown-command` | Command not in the selected version | false | Use a fallback or fail as `unsupported` |
| `unsupported` | Command, locator or option not available on this platform or agent | false | Use the host fallback if one exists (§3.2), else fail naming the feature |
| `unauthorized` | Missing or wrong token (HTTP 401, no details) | false | Restart the agent with a new token |
| `version-mismatch` | No common protocol version | false | Reinstall the bundled agent once (§5.2) |
| `session-not-found` | Unknown or ended session | false | Check `instanceId`; start a new session |
| `session-active` | `session.start` while another session is active | false | Stop it, or send `replace: true` |
| `busy` | The executor is still running another command | true | Poll `/v1/health` until `running` is null, then retry; at most for the command's timeout |
| `cancelled` | Stopped by `session.stop` | false | Expected during teardown |
| `element-not-found` | Locator matched nothing | true | Auto-wait retries until the action timeout, then fails with `details.nearest` |
| `ambiguous` | An action's locator matched more than one node | false | Strictness error; fail listing the matches |
| `stale-node` | The node no longer exists, or its fingerprint changed (§7.2) | true | Re-resolve the locator, then retry |
| `stale-snapshot` | Snapshot evicted from the agent cache, or from another `instanceId` | true | Take a new snapshot / re-find |
| `not-interactable` | Found but failed an actionability check. `details.reason`: `not-visible`, `off-screen`, `disabled`, `obscured`, `unstable`, `zero-size`, `keyboard-covering`, `keyboard-unavailable`, `system-alert` | true | Auto-wait retries; `off-screen` → scroll into view first (§9.3); `keyboard-unavailable` is permanent in practice (§7.4) |
| `context-not-found` | Web context missing or gone | true | WebViews appear late; retry until timeout |
| `timeout` | The command exceeded `timeoutMs` | true | Retry at most once, and only commands that do not change state (`tree.get`, `element.find`, `screen.screenshot`, `device.info`, `alert.get`) |
| `app-not-running` | Target app not in the foreground or not launched | false | Fail; suggest `app.launch` |
| `app-crashed` | App process died during the command | false | Fail the test; attach the crash log from `details` |
| `agent-crashed` | **Host-synthesised**: agent process gone, connection refused, a new `instanceId`, or no answer by `timeoutMs` + 2 s grace | true | Restart the agent and session at most once per test; then fail with agent logs |
| `internal` | Unexpected agent exception | false | Fail; include the native stack in `details`; report a bug |

## 7. Command set v1

Commands are namespaced `area.verb`. **Phase** is when the command must work: **0** = spikes P0-09/P0-10 and the driver interface (P0-03); **1** = Android alpha; **2** = iOS beta; **3** = v1.0. Rows marked "host tool" are driver operations done with adb, `simctl` or `devicectl`. They are **not** protocol commands and are listed only so the driver interface stays complete.

### 7.1 Commands

| Command | Key params → result | Executed by | Phase |
| --- | --- | --- | --- |
| `hello` | `client`, `protocol {min,max}`, `want[]` → `protocol {selected,min,max}`, `agent {name,version,platform,instanceId}`, `capabilities[]`, `device` | Agent | 0 |
| `session.start` | `app? { id, activity?, args?, env? }`, `settings? { snapshotRetain }`, `replace?` → `{ session }` | Agent | 0 |
| `session.stop` | → `{}` | Agent | 0 |
| `device.info` | → `platform`, `osVersion`, `apiLevel?`, `model`, `emulator`, `screen`, `locale`, `timeZone`. `serial` (adb) and `udid` are **filled by the host**: the agent cannot know them (`Build.getSerial()` is restricted from API 29) | Agent + host | 0 |
| `tree.get` | `maxDepth?`, `maxNodes?` (default 5000), `root? NodeRef`, `filter? {visibleOnly}`, `include? {raw}`, `webContent? include\|prune`, `since?` (diff), `settle? {maxWaitMs, quietMs}`, `delivery? inline\|artifact` → Snapshot, Diff or `{artifactId}` | Agent | 0 (diff: 3) |
| `action.tap` | `target`, `offset?`, `checks?` → ActionResult | Agent | 0 (`checks`: 1) |
| `screen.screenshot` | `format? png\|jpeg`, `quality?`, `region?` (DIP rect), `delivery? inline\|artifact` → Screenshot (§10.2) | Agent | 0 |
| `element.find` | `locator`, `scope? NodeRef`, `max?` (default 20), `ancestors?`, `settle? {maxWaitMs, quietMs}` → `{ snapshotId, matches[], total, truncated, searched, idle? }` | Agent | 1 |
| `element.hitTest` | `point` → `{ snapshotId, match }`: topmost node at the point, computed as in §9.2; for diagnostics ("obscured by …") | Agent | 1 |
| `action.doubleTap` | `target`, `offset?`, `checks?` | Agent | 1 |
| `action.longPress` | `target`, `durationMs?` (default 800), `checks?` | Agent | 1 |
| `action.type` | `target?`, `text`, `mode? append\|replace` (default `append`), `secret?` → ActionResult + `method: keys\|setText\|typeText` (§7.4) | Agent | 1 |
| `action.clear` | `target`, `checks?` | Agent | 1 |
| `action.setValue` | `target` (`slider`, `spinbutton`, `progressbar`-like range), `value` (number for ranges, string for picker wheels) | Agent | 1 |
| `action.swipe` | `target?` or `from` point, `direction`, `distance?` (DIP, or 0..1 of target size), `durationMs?` | Agent | 1 |
| `action.scroll` | `target` (scroll container), `direction`, `distance?`, `until? Locator`, `maxSwipes?` → `{ found, swipes, reachedEnd }` | Agent (`until` needs `scroll.until`; otherwise the host loops) | 1 |
| `action.drag` | `from`, `to` (target or point), `holdMs?`, `durationMs?` | Agent | 1 |
| `action.pinch` | `target?`, `scale` (<1 zooms out, >1 zooms in), `durationMs?` | Agent | 1 |
| `action.pressKey` | `key`: `enter`, `backspace`, `delete`, `tab`, `escape`, `search`, `volumeUp`, `volumeDown`, `power`, or `{ androidKeyCode }` | Agent | 1 |
| `action.back` | — (Android; iOS returns `unsupported`, and core may tap the navigation bar's back button) | Agent | 1 |
| `action.home` | — | Agent | 1 |
| `keyboard.state` | → `{ shown, bounds?, hardwareKeyboard? }` | Agent | 1 |
| `keyboard.hide` | → `{ hidden }`. Android: BACK, only if the IME window is present when checked just before pressing; iOS: taps the keyboard's dismiss/return key if one exists, else `unsupported` | Agent | 1 |
| `idle.wait` | `quietMs?`, `maxWaitMs` → Idle (§9.1) | Agent | 1 |
| `app.launch` | `id`, `activity?`, `args?`, `env?`, `deepLink?`, `coldStart?` → `{ pid?, launchMs? }` | Agent | 1 |
| `app.terminate` | `id` | Agent | 1 |
| `app.state` | `id` → `notInstalled` \| `notRunning` \| `background` \| `foreground` | Agent | 1 |
| `context.list` | → WebView descriptors `{ nodeId, snapshotId, bounds, pid?, appId }`; the host joins them with CDP/WIP targets into contexts | Agent + host | 1 |
| `alert.get` | → `{ present, alert? { title, message, buttons[], source: app\|springboard\|system } }` | Agent (iOS via springboard, IOS-4) | 1 |
| `alert.accept` / `alert.dismiss` | `button?` (label) | Agent | 1 |
| `metrics.start` | `appId`, `metrics[]` (`cpu`, `memory`, `fps`, `jank`), `intervalMs?` (default 1000) → `{ metricsId }`; samples arrive as events | Agent | 3 |
| `metrics.stop` | `metricsId` → summary (min/avg/max/p95 per metric, jank count) | Agent | 3 |
| install / uninstall / clear data | — | Host tool (`adb install`, `pm clear`; `simctl install`/`uninstall`) | 1 |
| screen recording | — | Host tool (Android `adb shell screenrecord`, chained past its 3-minute limit; iOS simulator `simctl io recordVideo`) | 1 |
| select an option (CORE-4) | — | Host composite on native (tap the `combobox`, find the option, tap it); browser-native on web | 1 |

**Targets.** Each action takes exactly one target:

| Shape | Meaning |
| --- | --- |
| `{ "node": { "snapshotId", "nodeId" } }` | A node from a snapshot or `find` result. Revalidated per §7.2 |
| `{ "locator": Locator }` | Agent resolves; exactly one match is required (`ambiguous` otherwise). Needs `find.agent`. The result includes `match`, so the host can record the HEAL-1 fingerprint without another round trip |
| `{ "point": { "x", "y" } }` | Raw DIP coordinates; no element checks |

`offset` is a DIP point relative to the node's top-left; the default is the centre of the node's on-screen part. **ActionResult** is `{ at: Point, durationMs, match? }`.

**Checks** (`checks` on tap, double tap, long press, clear, and on `type` when it has a target): `{ visible?, enabled?, onScreen?, unobscured?, stableMs? }`. The agent evaluates them **once** just before injecting, as defined in §9.2, and answers `not-interactable` with the failing `reason` instead of acting. It never retries.

### 7.2 Node references, the snapshot cache and staleness

The agent keeps, for every node of the last `snapshotRetain` snapshots (default 4; `find` results count as snapshots), a native reference plus a **fingerprint**: `role`, `testId`, `nativeType`, `text`, `name`. When a `node` target is used:

| Platform | Native reference | Re-resolution |
| --- | --- | --- |
| Android | The `AccessibilityNodeInfo` | `refresh()`. `false` → `stale-node`. `true` → recompute the fingerprint, because `RecyclerView` recycles views and `refresh()` succeeds on a row that now shows other data |
| iOS | `XCUIElement` is a query, not a handle. The agent stores the element type and the child-index path from the application root, plus `identifier` if it was non-empty and unique in that snapshot | Resolve by identifier query when stored, otherwise by walking the index path. Then take a snapshot of the element and recompute the fingerprint |

If the recomputed fingerprint differs from the stored one, the agent answers `stale-node` with `details: { expected, actual }`. Bounds are not part of the fingerprint: elements may move. **Residual risk:** a recycled row showing identical data passes the check. Such a row is indistinguishable to a user too, so this is acceptable.

IDs with a different `instanceId` prefix, or from evicted snapshots, give `stale-snapshot`.

**Diffs (phase 3, capability `tree.diff`, which requires `tree.persistentIds`).** `tree.get { since }` returns `{ base, snapshotId, ops[] }` with ops `{op:"add", parentId, index, node}`, `{op:"remove", nodeId}` and `{op:"update", nodeId, set:{…}}`. Android can provide persistent IDs from accessibility node IDs; iOS probably cannot, so it returns full snapshots.

### 7.3 Scrolling

`action.scroll { until }` swipes the container until the locator matches an `onScreen` node, `maxSwipes` is reached (default 20), or the end is reached. The end is detected when the container's descendants are identical before and after a swipe. The result reports `found`, `swipes` and `reachedEnd`. See §9.3 for when the host calls it.

### 7.4 Typing

| Platform | `append` | `replace` |
| --- | --- | --- |
| Android | If every character is in the virtual `KeyCharacterMap`: injected key events (`method: keys`). Otherwise: read the current value and `ACTION_SET_TEXT(current + text)` (`method: setText`). For `password` targets the current value cannot be read, so non-key-mappable text gives `unsupported` (message: use `mode: "replace"`) | `ACTION_SET_TEXT(text)` (`method: setText`) |
| iOS | `typeText` (`method: typeText`) on the focused element | Select all + delete, then `typeText` |

`setText` does not fire per-key listeners, so input validation driven by the IME may behave differently; `method` makes this visible in reports. On iOS, `typeText` fails while the simulator's hardware keyboard is connected. The host disables it before boot (simulator preference `ConnectHardwareKeyboard = false`). If typing still cannot proceed, the agent answers `not-interactable` with reason `keyboard-unavailable`.

## 8. Events

The host opens `GET /v1/events` (WebSocket, same `Authorization` header) after `session.start`. Agent→host text frames are events:

| Field | Type | Meaning |
| --- | --- | --- |
| `v` | string | Selected version |
| `event` | string | Event name |
| `session` | string | Session ID (carries the `instanceId`) |
| `seq` | integer | Monotonic per session, starting at 1 |
| `time` | string | ISO 8601 |
| `source` | string | `agent`, or `host` when the host driver synthesised the event (for example from logcat) |
| `data` | object | Payload |

| Event | `data` | Phase |
| --- | --- | --- |
| `app.crashed` | `appId`, `pid?`, `kind: crash\|anr\|killed`, `message?`, `log?` (last 200 lines, secrets masked) | 1 |
| `app.stateChanged` | `appId`, `state` | 1 |
| `alert.appeared` / `alert.dismissed` | `alert` (as in `alert.get`) | 1 |
| `webview.created` / `webview.destroyed` | WebView descriptor as in `context.list` | 1 |
| `metrics.sample` | `metricsId`, `t` (ms since start), `cpuPct?`, `memoryMb?`, `fps?`, `jankFrames?` | 3 |
| `agent.warning` | `message`, `code?` (for example `slow-traversal`, `implicit-wait`) | 1 |

**Resume.** The agent keeps the last 256 events per session. After reconnecting, the host sends `{ "type": "resume", "session": s, "afterSeq": n }`. The agent replays newer events, or sends `{ "type": "gap", "session": s, "fromSeq": a, "toSeq": b }` if they are gone. A different session ID (new `instanceId`) means the agent restarted, and `seq` starts again at 1.

Events are hints. The host never relies on an event alone for correctness; for example, it still calls `alert.get` before acting.

## 9. Timing and auto-wait

### 9.1 Platform waits and what the agent guarantees

Both platforms' automation frameworks wait implicitly unless told not to. That conflicts with host-owned auto-wait and with the latency budget, so the mechanism is **normative**:

| Platform | Agent MUST | Idle signal (only when `settle` or `idle.wait` is requested) |
| --- | --- | --- |
| Android | Set `Configurator.setWaitForIdleTimeout(0)`, `setActionAcknowledgmentTimeout(0)`, `setWaitForSelectorTimeout(0)` and `setScrollAcknowledgmentTimeout(0)`. Read trees from `UiAutomation.getWindows()` / `AccessibilityNodeInfo` directly (not `UiDevice.dumpWindowHierarchy`, which waits for idle). Inject gestures with `UiAutomation.injectInputEvent` using its own `MotionEvent`s, not `UiObject2.click()` | `UiAutomation.waitForIdle(quietMs, maxWaitMs)`: no accessibility events for `quietMs` |
| iOS | Public XCTest waits for app quiescence (idle main run loop **and** finished animations) before snapshots and synthesised events. An endless animation (a spinner) can stall every command until XCTest's own timeout. The runner MUST turn this off using the private-API technique WebDriverAgent uses (overriding `XCUIApplicationProcess` quiescence waiting; synthesising events through the XCTest daemon session). If that private API is missing (a new Xcode), the runner falls back to public API, does **not** advertise `idle.noImplicit`, and reports forced waits in `timing.implicitWaitMs` and as `agent.warning` | The same private quiescence check, called on demand, with `animating` reported |

With that in place, the agent guarantees:

1. **Consistent snapshot:** `tree.get` captures in one traversal. If the UI changed during traversal (Android: window content change events arrived), the agent retries once and otherwise sets `idle.settled: false`.
2. **Idle on request only:** with `settle { maxWaitMs, quietMs }` (on `tree.get` and `element.find`) or `idle.wait`, the agent waits until quiet, up to `maxWaitMs`, and returns `idle: { settled, waitedMs, animating? }`. Not settled is **not** an error.
3. **Actions complete before answering:** the response comes after gesture injection finishes (touch-up), not after the app reacts.
4. **No waits beyond what the platform forces:** `element.find` answers with what matches now. Any wait forced by the platform is measured in `timing.implicitWaitMs`.
5. **Deadline:** the agent answers before `timeoutMs` (subject to §4.2 on iOS); gestures add their `durationMs` to the budget automatically.

The iOS private-API dependency is risk R1 (§13) and an open question (§14).

### 9.2 Actionability checks (agent, one-shot) — Decision D1

The host owns the retry loop; the agent owns the checks, because only the agent can run them without extra round trips and full traversals.

| Check | Android | iOS |
| --- | --- | --- |
| `visible`, `onScreen` | §2.6.1 on the re-resolved node | §2.6.1 on the re-resolved element |
| `enabled` | The node **and every ancestor** are enabled | `isEnabled` on the element and its ancestors in the element snapshot |
| `stableMs` | Bounds read at t0 and at t0 + `stableMs` are equal; otherwise `unstable` | Same, with two element snapshots |
| `unobscured` | At the action point P: (a) the topmost window containing P (by layer) is the target's window, otherwise `obscured` (or `system-alert` for permission/system windows), naming the window; (b) within the window, the last-drawn (`getDrawingOrder`, API 24+) clickable or focusable node containing P is the target, its descendant or its ancestor. Views without accessibility nodes are invisible to this check (known false negative) | `isHittable` (public XCTest API: an accessibility hit test at the element's hit point), plus no springboard alert present (otherwise `system-alert`) |
| `keyboard-covering` | P falls inside the `keyboard` window's bounds | P falls inside `XCUIElementTypeKeyboard`'s frame |

The web driver applies the same checks inside the browser (hit test with `elementFromPoint` through shadow roots).

### 9.3 Host auto-wait (CORE-5) and scroll-into-view (CORE-4)

Auto-wait is implemented once in `core` (P0-05). For each action, until the action timeout:

1. **Fast path (phase 1+, `find.agent`, agent-resolvable locator):** one round trip, `action.<verb> { target: { locator }, checks: { visible, enabled, onScreen, unobscured, stableMs } }`. The agent's `match` result feeds HEAL-1.
2. **Otherwise:** resolve with `element.find` (or `tree.get` + local match in phase 0 or as a fallback), then `action.<verb> { target: { node }, checks }`.
3. `stableMs` policy: `0` when the resolving response had `idle.settled: true`, else `50`.
4. On `element-not-found`, `stale-*`, `context-not-found`, `busy` or `not-interactable` (except `keyboard-unavailable`): back off 0, 50, 100, 250, 500 ms, then every 500 ms, and go to step 1. With `off-screen`: first `action.scroll` the nearest scrollable ancestor of the node `until` the locator is `onScreen`. With `keyboard-covering`: `keyboard.hide`, then retry.
5. **Scroll-search** (the element is not in the tree at all; Decision D5): the host does **not** scroll automatically, because unrequested scrolling changes app state. It does so when the test asks: `app.scrollTo(locator, { in? })` maps to `action.scroll { until }` in the given container, or in the first `scrollable` `list`/`grid` on screen. The final `element-not-found` message suggests `scrollTo` when a scrollable container exists.

Every skipped or shortened wait is reported (principle 5). On timeout the error lists the last failed check, the locator and the `nearest` candidates.

### 9.4 Latency budget (find + tap, phase 1, Android emulator, median)

| Step | Budget |
| --- | --- |
| Host: locator compile, bookkeeping, JSON encode/decode | ≤ 10 ms |
| Transport round trip over `adb forward` | ≤ 5 ms each |
| `element.find` via fast path (§3.2) | ≤ 60 ms (full traversal fallback ≤ 150 ms for ≤ 1,000 nodes) |
| `action.tap` with checks: re-resolve, fingerprint, unobscured, inject, touch-up | ≤ 120 ms (tap gesture itself ~50 ms) |
| **Two-round-trip path total** | **≤ 200 ms** |
| **One-round-trip path** (locator target) | **≤ 150 ms** |

Phase 0 has no budget (host-side matching on full trees); spikes P0-09/P0-10 MUST report measured numbers against this table. iOS XCTest element snapshots are slower (risk R2); P0-10 measures them, and the iOS budget is set from that data.

### 9.5 Timeouts

| Timeout | Default | Set by |
| --- | --- | --- |
| Agent start (until the ready line / `hello` answers) | Android 30 s, iOS simulator 120 s (includes runner launch) | Host config |
| `hello`, `session.*`, `device.info` | 10 s | `timeoutMs` |
| `tree.get`, `element.*`, `alert.*`, `context.list`, `keyboard.*` | 10 s | `timeoutMs` |
| `action.*` | 10 s + gesture `durationMs` | `timeoutMs` |
| `app.launch` | 60 s | `timeoutMs` |
| Host transport | `timeoutMs` + 2 s grace, then check `/v1/health` → `agent-crashed` or `busy` handling | Fixed |
| Host auto-wait per action / assertion | Defined by P0-05 (configurable globally, per test, per call) | Test config |

## 10. Healing and visual hooks

### 10.1 Fingerprint data (HEAL-1)

The host records a fingerprint on every successful find. Every match therefore carries `role`, `name`, `text`, `testId`, `nativeType`, `bounds`, `context`, stable `raw` keys (`resourceId`, `identifier`, `domId`, `classList`, `name`), and its position:

| Field | Meaning |
| --- | --- |
| `node` | The matched node without `children` (with `childCount`) |
| `path` | Child-index path from the root, e.g. `[0, 0, 3, 1]` |
| `siblingCount` | Number of children of the parent, **including** the node itself |
| `ancestors` | Root-to-parent list of `{ role, nativeType, testId, name, index }` (when `ancestors: true`; always included in action `match` results) |

Healing (candidate ranking, HEAL-2) runs host-side on a `tree.get` snapshot. Nothing in the protocol sends data off the machine.

### 10.2 Screenshots (VIS-*)

| Field | Meaning |
| --- | --- |
| `format` | `png` (default; lossless, required for visual baselines) or `jpeg` (traces; `quality` 1–100) |
| `width`, `height` | Device pixels |
| `scale` | Device pixels per DIP; masks given in DIP are multiplied by it |
| `rotation` | As in `screen` |
| `region` | DIP rect actually captured (full screen when not set) |
| `data` / `artifactId` | Base64 image (`delivery: inline`) or an artifact to fetch (`delivery: artifact`) |
| `capturedAt` | ISO 8601 |

Full-screen captures include system bars; `screen.insets` lets `visual` mask them. The host disables animations and the caret (VIS-3) before capture: on Android with `settings put global *_animation_scale 0` over ADB plus status-bar demo mode; on iOS best effort (§14). The web driver captures through CDP/BiDi/WIP with the same result shape.

## 11. Security

1. **Loopback is not a trust boundary.** Any app on the device can reach the device's loopback, and any local process can reach the host's. **The token is the access control.** Binding to `127.0.0.1` only (never `0.0.0.0`) just keeps agents off the network.
2. The host generates a **per-agent-launch token** (32 random bytes, base64url). Every HTTP request and WebSocket upgrade MUST send `Authorization: Bearer <token>`. Agents compare in constant time and answer `401` with no details on mismatch.
3. Agents reject (`403`) any request that has an `Origin` header, and any request whose `Host` **hostname** is not `127.0.0.1`, `localhost` or `[::1]`. Any port is accepted, because `adb forward` and usbmux deliver requests addressed to a different host-side port. This blocks browsers on the device or host, including DNS-rebinding pages.
4. **Token delivery and masking.** Android passes the token as an instrumentation argument (Decision D4). iOS uses `TEST_RUNNER_PRISM_TOKEN` or a 0600 `.xctestrun` file deleted after launch (§4.4). The token therefore appears in adb command lines, `xcodebuild` invocations, `.xctestrun` contents and instrumentation output, so the host MUST mask it everywhere it logs or stores those (debug logs, traces, reports, `prism doctor` output).
5. Agents never send values of `password` nodes, in node fields or in `raw` (§2.9). `action.type` text is masked (`***`) in agent and host logs when `secret: true` **or** when the target node is a `password` node, even without `secret`.
6. Agents shut down after 30 minutes without a request (configurable) and when the instrumentation/XCTest run ends.
7. No telemetry. Agents make no outbound connections.
8. Cloud farms that cannot use tunnelling would need explicit opt-in remote binding; that design is deferred to `cloud-farms.md` (P0-11).

## 12. Worked examples

### 12.1 `hello` handshake

```http
POST /v1/command HTTP/1.1
Host: 127.0.0.1:52817
Authorization: Bearer ***masked***
Content-Type: application/json
Accept-Encoding: gzip
```

The device-side agent listens on port 7100; `Host` shows the forwarded host port, which is why §11 checks the hostname only.

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
    "agent": { "name": "prism-android-agent", "version": "0.1.0", "platform": "android", "instanceId": "k7q2xm4p" },
    "capabilities": ["find.agent", "find.regex", "scroll.until", "action.pinch", "locator.native.uiautomator", "alerts.system", "idle.signal", "idle.noImplicit", "state.focused"],
    "device": { "platform": "android", "osVersion": "14", "apiLevel": 34, "model": "sdk_gphone64_x86_64", "emulator": true, "screen": { "width": 360, "height": 800, "scale": 3, "rotation": 0, "orientation": "portrait" } }
  },
  "timing": { "startedAt": "2026-11-27T10:15:02.114Z", "durationMs": 3 }
}
```

`tree.diff` was wanted but is not in `capabilities`, so the host uses full snapshots. The host adds `serial: "emulator-5554"` from adb.

### 12.2 `tree.get` response, Android (trimmed)

Device: 1080 × 2400 px, density 3 → 360 × 800 DIP.

```json
{
  "v": "1.0",
  "id": "r-7",
  "ok": true,
  "result": {
    "snapshotId": "k7q2xm4p.s-3",
    "capturedAt": "2026-11-27T10:15:04.502Z",
    "platform": "android",
    "screen": { "width": 360, "height": 800, "scale": 3, "rotation": 0, "orientation": "portrait", "insets": { "top": 24, "right": 0, "bottom": 48, "left": 0 } },
    "idle": { "settled": true, "waitedMs": 120 },
    "nodeCount": 5,
    "truncated": false,
    "root": {
      "id": "n0", "role": "screen", "name": null, "text": null, "value": null, "testId": null,
      "nativeType": "prism.Screen", "bounds": { "x": 0, "y": 0, "width": 360, "height": 800 },
      "visible": true, "onScreen": true, "enabled": true, "focused": false, "selected": false, "checked": null,
      "scrollable": false, "password": false, "webContent": false, "context": "native",
      "children": [
        {
          "id": "n1", "role": "window", "name": "Shop", "text": null, "value": null, "testId": null,
          "nativeType": "android.widget.FrameLayout", "bounds": { "x": 0, "y": 0, "width": 360, "height": 800 },
          "visible": true, "onScreen": true, "enabled": true, "focused": false, "selected": false, "checked": null,
          "scrollable": false, "password": false, "webContent": false, "context": "native",
          "raw": { "package": "com.example.shop", "windowId": 12, "windowType": "application", "displayId": 0 },
          "children": [
            {
              "id": "n2", "role": "textbox", "name": "Email", "text": null, "value": "ada@example.com", "testId": "com.example.shop:id/email",
              "nativeType": "android.widget.EditText", "bounds": { "x": 16, "y": 300, "width": 328, "height": 56 },
              "visible": true, "onScreen": true, "enabled": true, "focused": false, "selected": false, "checked": null,
              "scrollable": false, "password": false, "webContent": false, "context": "native", "hint": "Email",
              "raw": { "resourceId": "com.example.shop:id/email", "className": "android.widget.EditText", "clickable": true, "editable": true, "boundsPx": [48, 900, 1032, 1068] },
              "children": []
            },
            {
              "id": "n3", "role": "textbox", "name": "Password", "text": null, "value": null, "testId": "com.example.shop:id/password",
              "nativeType": "android.widget.EditText", "bounds": { "x": 16, "y": 372, "width": 328, "height": 56 },
              "visible": true, "onScreen": true, "enabled": true, "focused": true, "selected": false, "checked": null,
              "scrollable": false, "password": true, "webContent": false, "context": "native",
              "raw": { "resourceId": "com.example.shop:id/password", "className": "android.widget.EditText", "editable": true },
              "children": []
            },
            {
              "id": "n4", "role": "button", "name": "Sign in", "text": "Sign in", "value": null, "testId": "com.example.shop:id/sign_in",
              "nativeType": "android.widget.Button", "bounds": { "x": 16, "y": 500, "width": 328, "height": 48 },
              "visible": true, "onScreen": true, "enabled": true, "focused": false, "selected": false, "checked": null,
              "scrollable": false, "password": false, "webContent": false, "context": "native",
              "raw": { "resourceId": "com.example.shop:id/sign_in", "className": "android.widget.Button", "clickable": true, "boundsPx": [48, 1500, 1032, 1644] },
              "children": []
            }
          ]
        }
      ]
    }
  },
  "timing": { "startedAt": "2026-11-27T10:15:04.380Z", "durationMs": 122 }
}
```

### 12.3 `tree.get` result, iOS (trimmed, `result` only)

iPhone 15 simulator: 393 × 852 pt, scale 3. The `StaticText` inside the button shows why the innermost rule exists (§3.3).

```json
{
  "snapshotId": "p3m7tz2a.s-9",
  "capturedAt": "2026-11-27T10:20:11.090Z",
  "platform": "ios",
  "screen": { "width": 393, "height": 852, "scale": 3, "rotation": 0, "orientation": "portrait", "insets": { "top": 59, "right": 0, "bottom": 34, "left": 0 } },
  "nodeCount": 5,
  "truncated": false,
  "root": {
    "id": "n0", "role": "screen", "name": null, "text": null, "value": null, "testId": null,
    "nativeType": "prism.Screen", "bounds": { "x": 0, "y": 0, "width": 393, "height": 852 },
    "visible": true, "onScreen": true, "enabled": true, "focused": false, "selected": false, "checked": null,
    "scrollable": false, "password": false, "webContent": false, "context": "native",
    "children": [
      {
        "id": "n1", "role": "application", "name": "Shop", "text": null, "value": null, "testId": null,
        "nativeType": "XCUIElementTypeApplication", "bounds": { "x": 0, "y": 0, "width": 393, "height": 852 },
        "visible": true, "onScreen": true, "enabled": true, "focused": false, "selected": false, "checked": null,
        "scrollable": false, "password": false, "webContent": false, "context": "native",
        "raw": { "elementType": 2, "label": "Shop", "source": "app" },
        "children": [
          {
            "id": "n2", "role": "switch", "name": "Remember me", "text": null, "value": null, "testId": "rememberMe",
            "nativeType": "XCUIElementTypeSwitch", "bounds": { "x": 24, "y": 440, "width": 345, "height": 31 },
            "visible": true, "onScreen": true, "enabled": true, "focused": false, "selected": false, "checked": true,
            "scrollable": false, "password": false, "webContent": false, "context": "native",
            "raw": { "elementType": 40, "identifier": "rememberMe", "label": "Remember me", "value": "1" },
            "children": []
          },
          {
            "id": "n3", "role": "button", "name": "Sign in", "text": "Sign in", "value": null, "testId": "signInButton",
            "nativeType": "XCUIElementTypeButton", "bounds": { "x": 24, "y": 500, "width": 345, "height": 50 },
            "visible": true, "onScreen": true, "enabled": true, "focused": false, "selected": false, "checked": null,
            "scrollable": false, "password": false, "webContent": false, "context": "native",
            "raw": { "elementType": 9, "identifier": "signInButton", "label": "Sign in" },
            "children": [
              {
                "id": "n4", "role": "text", "name": "Sign in", "text": "Sign in", "value": null, "testId": null,
                "nativeType": "XCUIElementTypeStaticText", "bounds": { "x": 160, "y": 514, "width": 73, "height": 22 },
                "visible": true, "onScreen": true, "enabled": true, "focused": false, "selected": false, "checked": null,
                "scrollable": false, "password": false, "webContent": false, "context": "native",
                "raw": { "elementType": 48, "label": "Sign in" },
                "children": []
              }
            ]
          }
        ]
      }
    ]
  }
}
```

### 12.4 Two-round-trip path: `element.find`, then `action.tap` with checks

```json
{ "v": "1.0", "id": "r-12", "session": "k7q2xm4p.sess-1", "cmd": "element.find", "timeoutMs": 10000,
  "params": { "locator": { "kind": "role", "role": "button", "name": { "text": "sign in" } }, "ancestors": true, "settle": { "maxWaitMs": 300, "quietMs": 50 } } }
```

```json
{
  "v": "1.0", "id": "r-12", "ok": true,
  "result": {
    "snapshotId": "k7q2xm4p.s-4", "total": 1, "truncated": false, "searched": 5,
    "idle": { "settled": true, "waitedMs": 50 },
    "matches": [
      {
        "node": {
          "id": "n4", "role": "button", "name": "Sign in", "text": "Sign in", "value": null, "testId": "com.example.shop:id/sign_in",
          "nativeType": "android.widget.Button", "bounds": { "x": 16, "y": 500, "width": 328, "height": 48 },
          "visible": true, "onScreen": true, "enabled": true, "focused": false, "selected": false, "checked": null,
          "scrollable": false, "password": false, "webContent": false, "context": "native", "childCount": 0
        },
        "path": [0, 2],
        "siblingCount": 3,
        "ancestors": [
          { "role": "screen", "nativeType": "prism.Screen", "testId": null, "name": null, "index": 0 },
          { "role": "window", "nativeType": "android.widget.FrameLayout", "testId": null, "name": "Shop", "index": 0 }
        ]
      }
    ]
  },
  "timing": { "startedAt": "2026-11-27T10:15:05.010Z", "durationMs": 93, "implicitWaitMs": 0 }
}
```

`idle.settled` is true, so the host sends `stableMs: 0` (§9.3).

```json
{ "v": "1.0", "id": "r-13", "session": "k7q2xm4p.sess-1", "cmd": "action.tap",
  "params": { "target": { "node": { "snapshotId": "k7q2xm4p.s-4", "nodeId": "n4" } },
              "checks": { "visible": true, "enabled": true, "onScreen": true, "unobscured": true, "stableMs": 0 } } }
```

```json
{ "v": "1.0", "id": "r-13", "ok": true, "result": { "at": { "x": 180, "y": 524 }, "durationMs": 58 },
  "timing": { "startedAt": "2026-11-27T10:15:05.110Z", "durationMs": 71 } }
```

### 12.5 Error responses

Locator matched nothing:

```json
{
  "v": "1.0", "id": "r-21", "ok": false,
  "error": {
    "code": "element-not-found",
    "message": "No node matched role=button name~\"Log in\" in the native context (5 nodes searched, tree not truncated). Closest: button \"Sign in\" (score 0.71). Check the label, or use by.testId('sign_in').",
    "retryable": true,
    "details": {
      "locator": { "kind": "role", "role": "button", "name": { "text": "Log in" } },
      "found": 0,
      "searched": 5,
      "truncated": false,
      "nearest": [ { "snapshotId": "k7q2xm4p.s-5", "nodeId": "n4", "role": "button", "name": "Sign in", "testId": "com.example.shop:id/sign_in", "score": 0.71 } ]
    }
  },
  "timing": { "startedAt": "2026-11-27T10:15:09.300Z", "durationMs": 38 }
}
```

A recycled row (§7.2):

```json
{
  "v": "1.0", "id": "r-30", "ok": false,
  "error": {
    "code": "stale-node",
    "message": "Node n17 from snapshot k7q2xm4p.s-6 now shows different content (text \"Order #1041\" became \"Order #1057\"), probably a recycled list row. Re-find the element.",
    "retryable": true,
    "details": {
      "expected": { "role": "listitem", "testId": "com.example.shop:id/order_row", "nativeType": "android.widget.LinearLayout", "text": null, "name": "Order #1041" },
      "actual": { "role": "listitem", "testId": "com.example.shop:id/order_row", "nativeType": "android.widget.LinearLayout", "text": null, "name": "Order #1057" }
    }
  },
  "timing": { "startedAt": "2026-11-27T10:15:12.020Z", "durationMs": 9 }
}
```

The host retries the first until the auto-wait timeout, then raises a test failure with this message, the screenshot and the tree. The second sends it straight back to step 1 of §9.3.

## 13. Decisions and risks

**Decisions recorded in this note** (humans may overturn them in review):

| ID | Decision | Why |
| --- | --- | --- |
| D1 | Actionability checks run **agent-side, one-shot** (`checks` on actions); the host owns the retry loop | Host-side checks need ≥ 4 round trips and extra traversals per action, and Android has no hit-test API that works from outside the app; the 300 ms target is out of reach otherwise |
| D2 | Web `text` = text of direct text-node children; for ARIA **name-from-content** roles (`button`, `link`, `tab`, `menuitem`, `option`, `heading`, `cell`, `row`, `checkbox`, `radio`, `switch`) = full normalised `innerText` | Matches what native platforms report for the same controls (a button's text is its label). Avoids copying the whole page's text into every ancestor, which would bloat snapshots. Ambiguity between a button and its inner `<span>` is settled by the innermost rule (§3.3) |
| D3 | The host's tree is **not merged** by default. Locators search native, then web contexts without merging (HYB-2). A merged tree is built for failure dumps, traces and the inspector (CORE-9, RUN-4), or on request | Merging costs one web-backend round trip per WebView on every resolution, for no benefit to matching |
| D4 | Android token via instrumentation argument | `/proc` is mounted `hidepid` on Android 7+, so other apps cannot read the argument; only `shell`/root can, and those already control the device. The host masks it in logs (§11) |
| D5 | No automatic scroll-search for elements that are not in the tree; explicit `scrollTo`. Elements in the tree but off-screen are scrolled into view automatically | Unrequested scrolling changes app state and hides real bugs; CORE-4 "scroll into view" is still met |
| D6 | One session per agent; `session.start` while active needs `replace: true` | XCTest and UiAutomation are single-user per process anyway |

**Risks**

| ID | Risk | Mitigation |
| --- | --- | --- |
| R1 | The iOS runner depends on private XCTest API to switch off quiescence waits and read `hasKeyboardFocus`. Xcode releases can break it | Public-API fallback with `timing.implicitWaitMs` reporting; CI on each Xcode beta; document supported Xcode versions; isolate private calls in one Swift file |
| R2 | XCTest element snapshots are slow, so the iOS find + tap may exceed the 300 ms budget | Measure in P0-10; identifier fast path; cache the app snapshot within one command |
| R3 | iOS hybrid needs a third web backend (WebKit Inspector Protocol + injected role/name script) | Plan it as a separate phase-2 task for `web-driver-engineer`; reuse the injected accessibility script for the BiDi backend |
| R4 | Android unobscured check misses overlays that have no accessibility node | Document; visual diffs and the `system-alert` window check cover the common cases |
| R5 | Locator semantics drift between the TypeScript, Kotlin and Swift implementations | Shared conformance fixtures (§14) run in all three test suites |

## 14. Open questions for humans

- [ ] **iOS private API (R1).** Do we accept a private XCTest API dependency in the runner (as WebDriverAgent does), with the public-API fallback described in §9.1?
- [ ] **WebKit Inspector Protocol backend (R3).** Accept a third web backend in phase 2, and require `WKWebView.isInspectable = true` (and `setWebContentsDebuggingEnabled(true)` on Android) from apps under test, documented as a prerequisite for full hybrid support?
- [ ] **Default device port and package ID.** `io.prismtest.agent` on device port 7100: acceptable, or align with a namespace we own (depends on the domain decision)?
- [ ] **usbmux and loopback on iOS devices.** Confirm in P0-10 that a usbmux tunnel reaches a runner bound to the device's loopback only. If not, which interface binding is acceptable?
- [ ] **Agent-side waiting.** v1 keeps all polling on the host. Should a later minor add `element.find { waitMs }` if measured latency misses the budget?
- [ ] **Multiple displays.** Is "default display only" acceptable for v1 (foldables, Android Auto and casting are excluded), or do we need `displayId` selection via `getWindowsOnAllDisplays` (API 30+)?
- [ ] **iOS headings.** iOS emits no `heading` role in v1 because traits are not public. Accept this, or read traits through private API (adding to R1)?
- [ ] **Compose roles.** Compose tabs (and switches without a checkable signal) cannot be identified without localised `roleDescription`. Accept the gap, or match `roleDescription` against the device locale's framework strings?
- [ ] **Role vocabulary.** Is the 36-role list right? `radiogroup`, `tabpanel`, `navigation` and `frame` are left out on purpose (mapped to `group`/`generic`).
- [ ] **iOS animations and caret for VIS-3.** XCTest cannot disable animations app-wide. Accept best effort, or require an opt-in launch argument that apps under test honour?
- [ ] **iOS metrics source (PERF-9).** XCTest metrics only work inside measure blocks. Use them, sample from the host (Instruments / `xctrace`), or make iOS metrics P2?
- [ ] **Cloud farm remote binding.** Farms that allow custom agents but no tunnel need a reachable agent. Allow it behind TLS + token, or require the Appium/WebDriver fallback there (input to P0-11)?
- [ ] **Conformance fixtures.** Agree that shared test vectors (tree JSON + locator + expected matches, including the normalisation and case-folding cases of §3.4) live in `docs/design/protocol-fixtures/` and run in the Kotlin, Swift and TypeScript suites.

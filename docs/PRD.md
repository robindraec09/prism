# PRD: Prism — open-source UI, API and performance testing

Repo copy of the living PRD at https://claude.ai/artifact/Mpg1dxeVkBrei3f6y2m33y (as of 26 Nov 2026). Humans own this file; agents propose changes in PRs or issues. Personas, competitive landscape and full code samples live in the living PRD.

## Overview

Prism is an open-source TypeScript tool that tests web, native mobile and hybrid apps through the UI, tests their APIs and measures their performance under load: one API, one runner, one report. UI automation uses drivers we own end to end rather than wrapping Playwright, Selenium or Appium.

- **Name:** Prism. npm scope `@prismtest`, main package `prismtest`, CLI command `prism`, docs at prism.dev.
- **Licence:** MIT.
- **Team:** 2 part-time maintainers, plus AI agents and community contributors.

## Goals

1. One TypeScript API for UI tests on web, native Android, native iOS and hybrid (WebView) apps.
2. API testing in the same tool: REST, GraphQL and WebSocket, with schema and contract checks.
3. Performance testing in the same tool: load, stress and soak tests built from API scenarios, plus front-end speed metrics for web and mobile.
4. Own UI drivers: a direct protocol client for browsers and our own on-device agents for Android and iOS.
5. Reliable by default: auto-waiting, retry-safe actions, deterministic waits.
6. Built-in self-healing locators, visual testing and BDD.
7. Run locally on emulators and simulators, and remotely on cloud device farms.
8. A healthy open-source project: clear docs, a plugin API, outside contributors.

## Non-goals for v1

- Language bindings other than TypeScript/JavaScript (v1 defines a versioned, language-neutral protocol so Python/Java bindings can follow in v1.x).
- Desktop apps (Windows, macOS, Electron) and smart-TV platforms.
- Distributed load generation across a cluster (v1 generates load from one machine; distributed mode in v1.x).
- A hosted SaaS dashboard.
- A record-and-playback IDE (a codegen CLI is in scope).

## Decisions

| Question | Decision |
| --- | --- |
| Language | TypeScript/JavaScript on Node.js LTS |
| Engine | Own drivers; no Playwright/Selenium/Appium dependency |
| Scope | UI, API and performance testing, all in v1 |
| Licence | MIT; reused third-party code keeps its own notice |
| Cloud farms | Own agents where a farm allows them; WebDriver/Appium compatibility adapter as fallback, farms only |
| iOS runner | Start from an open-source XCTest agent (such as WebDriverAgent) as a reference, then reshape into our own code |
| Self-healing AI | Heuristics and an optional local model by default; users may opt in with their own AI provider key |
| Test runner | Built-in runner in v1; Jest/Vitest/Mocha adapters in v1.x |
| Minimum OS | Android 10 (API 29)+, iOS 16+ |
| Flutter / React Native native UI | Through the accessibility tree only in v1 |
| Bindings | Versioned, language-neutral JSON protocol in v1; TypeScript only ships |
| Team and timeline | 2 part-time maintainers; full v1 plan, ~6 years estimated without AI-agent speed-up |

## Principles

1. **One test, many targets.** Platform-specific code is explicit and rare.
2. **Write once, reuse everywhere.** An API flow can seed a UI test or drive a load test unchanged.
3. **Reliable before fast.** Every action waits for the element to be visible, stable, enabled and unobscured.
4. **Explain every failure.** Screenshot or request/response, UI tree, locator tried, nearest matches.
5. **Magic is visible.** Heals and skipped waits are always reported.
6. **Standards where they exist.** CDP and WebDriver BiDi for web; OpenAPI and GraphQL schemas for APIs.

## Architecture

Layers, top to bottom: authoring (TypeScript tests, Gherkin, CLI/config) → test runner and reporting → core engine (unified API, auto-wait, self-healing, visual testing, API testing, performance) → **driver interface** for UI drivers and **HTTP engine** for API and load → targets.

- **Web driver:** CDP for Chromium, WebDriver BiDi for Firefox (Safari via WebDriver where available).
- **Android:** host driver in Node.js over ADB + on-device instrumentation APK (Kotlin, UiAutomator). WebViews via CDP.
- **iOS:** host driver in Node.js (macOS only) + XCTest runner app (Swift). WKWebViews via the WebKit remote inspector.
- **Cloud adapter:** allocate, upload, run, fetch artifacts; own agents or Appium/WebDriver fallback.
- **HTTP engine:** one request pipeline (auth, retries, schema checks, metrics) for API tests and load tests; load mode runs scenarios across worker threads.
- **Element model:** every driver returns the same normalised UI tree (role, name, text, ID, bounds, visibility).
- **Transport:** host↔agent JSON over HTTP/WebSocket, versioned.

## Functional requirements

P0 blocks v1.0; P1 should ship in v1.x; P2 is stretch.

### Core API
| ID | Requirement | Priority |
| --- | --- | --- |
| CORE-1 | Unified session API: `launch()` for browser, Android app, iOS app or cloud device from one config | P0 |
| CORE-2 | Cross-platform locators: role + accessible name, text, test ID (`data-testid` / `accessibilityIdentifier` / `resource-id`), CSS, XPath, native predicates | P0 |
| CORE-3 | Per-platform locator overrides in one definition (`{ web, android, ios }`) | P0 |
| CORE-4 | Actions: click/tap, double tap, long press, type, clear, select, hover (web), scroll into view, swipe, drag, pinch/zoom, keys, back/home | P0 |
| CORE-5 | Auto-wait on every action (visible, stable, enabled, unobscured), configurable timeouts | P0 |
| CORE-6 | Retrying assertions (`toBeVisible`, `toHaveText`, `toHaveValue`, count) | P0 |
| CORE-7 | Device controls: rotate, background/foreground, deep links, permissions, geolocation, network conditions, clipboard | P1 |
| CORE-8 | App lifecycle: install, uninstall, reset, clear data, launch arguments | P0 |
| CORE-9 | Screenshots, screen recording, UI tree dump on demand and on failure | P0 |

### Web driver
| ID | Requirement | Priority |
| --- | --- | --- |
| WEB-1 | Chromium (Chrome, Edge) over CDP, headed and headless | P0 |
| WEB-2 | Firefox over WebDriver BiDi | P0 |
| WEB-3 | Safari (macOS) via WebDriver, BiDi where available | P1 |
| WEB-4 | Tabs, iframes, shadow DOM, upload/download, dialogs | P0 |
| WEB-5 | Network interception and mocking, console and network logs | P1 |
| WEB-6 | Mobile web: Chrome on Android, Safari on iOS simulator | P1 |

### Android native
| ID | Requirement | Priority |
| --- | --- | --- |
| AND-1 | On-device agent (instrumentation APK) installed and started automatically | P0 |
| AND-2 | UI hierarchy capture and actions through UiAutomator | P0 |
| AND-3 | Android 10 (API 29) and later | P0 |
| AND-4 | Real devices over USB and Wi-Fi ADB | P0 |
| AND-5 | Optional Espresso backend | P2 |

### iOS native
| ID | Requirement | Priority |
| --- | --- | --- |
| IOS-1 | XCTest-based runner built, signed and launched automatically; starts from an open-source XCTest agent as reference | P0 |
| IOS-2 | Simulators on macOS; iOS 16 and later | P0 |
| IOS-3 | Real devices with guided code-signing setup | P1 |
| IOS-4 | System alerts and permission dialogs via springboard | P0 |

### Hybrid apps
| ID | Requirement | Priority |
| --- | --- | --- |
| HYB-1 | Discover WebViews in the running app (Android and iOS) | P0 |
| HYB-2 | Automatic context switching for web locators inside apps | P0 |
| HYB-3 | Manual context API (`session.webview(name)`) | P0 |
| HYB-4 | Verified on Cordova/Ionic/Capacitor, React Native WebView, Flutter WebView | P1 |

### Emulators and simulators
| ID | Requirement | Priority |
| --- | --- | --- |
| EMU-1 | List, create, boot, shut down, wipe Android emulators | P0 |
| EMU-2 | List, create, boot, shut down, erase iOS simulators | P0 |
| EMU-3 | Boot on demand from config and reuse across runs | P0 |
| EMU-4 | Parallel runs on multiple emulators/simulators | P1 |
| EMU-5 | `prism doctor`: checks SDKs, Xcode, Java, devices | P0 |

### Cloud device farms
| ID | Requirement | Priority |
| --- | --- | --- |
| CLD-1 | Provider-neutral interface (allocate, upload, run, fetch artifacts, release); own agents where allowed, otherwise WebDriver/Appium adapter | P0 |
| CLD-2 | Providers: BrowserStack, Sauce Labs, LambdaTest (set to confirm) | P1 |
| CLD-3 | Report status, video and logs to the provider dashboard | P1 |
| CLD-4 | Self-hosted device grid | P2 |

### Self-healing locators
| ID | Requirement | Priority |
| --- | --- | --- |
| HEAL-1 | Record element fingerprints on each successful find | P0 |
| HEAL-2 | Rank candidates on failure; use the best above a confidence threshold | P0 |
| HEAL-3 | Report every heal with confidence and a suggested code fix | P0 |
| HEAL-4 | Modes off / report-only / heal; strict mode fails CI on any heal | P0 |
| HEAL-5 | Offline heuristics and optional local model by default; opt-in AI provider key; no data leaves without opt-in | P1 |

### Visual testing
| ID | Requirement | Priority |
| --- | --- | --- |
| VIS-1 | `toMatchSnapshot()` with baselines per platform and device | P0 |
| VIS-2 | Pixel diff with thresholds, anti-aliasing tolerance, masks | P0 |
| VIS-3 | Mask dynamic content; disable animations/caret before capture | P0 |
| VIS-4 | HTML diff report and baseline approval command | P0 |
| VIS-5 | Perceptual or layout-aware comparison | P2 |

### BDD / Gherkin
| ID | Requirement | Priority |
| --- | --- | --- |
| BDD-1 | Run `.feature` files with typed TypeScript steps | P0 |
| BDD-2 | Tags select platforms and suites | P0 |
| BDD-3 | Optional built-in step library | P1 |
| BDD-4 | Cucumber-compatible JSON/messages output | P1 |

### API testing
| ID | Requirement | Priority |
| --- | --- | --- |
| API-1 | REST client: all methods, headers, query, JSON/form/multipart, cookies, redirects, timeouts | P0 |
| API-2 | Auth helpers: basic, bearer, API key, OAuth 2.0 client credentials and auth code with PKCE | P0 |
| API-3 | Retrying assertions on status, headers, JSON-path body, response time | P0 |
| API-4 | Schema validation: OpenAPI 3.x and JSON Schema | P0 |
| API-5 | GraphQL queries and mutations with schema validation | P0 |
| API-6 | WebSocket and server-sent events | P1 |
| API-7 | gRPC from `.proto` files | P1 |
| API-8 | Share API-created data and auth sessions with UI tests | P0 |
| API-9 | Request mocking and stubbing for UI tests | P1 |
| API-10 | Pact-compatible contract testing | P2 |
| API-11 | Import from OpenAPI, Postman, HAR | P1 |

### Performance testing
| ID | Requirement | Priority |
| --- | --- | --- |
| PERF-1 | TypeScript load scenarios reusing API test code; virtual users, think time, per-user data | P0 |
| PERF-2 | Load models: constant, ramp, arrival rate, stages; stress, spike, soak | P0 |
| PERF-3 | Metrics: throughput, p50/p90/p95/p99, error rate, per request and scenario | P0 |
| PERF-4 | Pass/fail thresholds with CI exit codes | P0 |
| PERF-5 | High-concurrency single-machine engine on worker threads | P0 |
| PERF-6 | Live console summary and HTML report with time series | P0 |
| PERF-7 | Export to Prometheus, InfluxDB, OpenTelemetry | P1 |
| PERF-8 | Web metrics during UI tests: Core Web Vitals, load timings, waterfall | P0 |
| PERF-9 | Mobile app metrics: launch time, frame rate/jank, CPU, memory | P1 |
| PERF-10 | Browser-based load alongside protocol-level load | P2 |
| PERF-11 | Baseline comparison and regression flags | P1 |
| PERF-12 | Distributed load across machines | v1.x |

### Runner, reporting, tooling
| ID | Requirement | Priority |
| --- | --- | --- |
| RUN-1 | Built-in runner: fixtures, hooks, retries, parallel workers, sharding | P0 |
| RUN-2 | Jest, Vitest, Mocha adapters | P1 |
| RUN-3 | HTML, JUnit XML, Allure; trace viewer | P0 |
| RUN-4 | Inspector with live UI tree and locator suggestions | P1 |
| RUN-5 | Codegen | P2 |
| RUN-6 | Plugin API: locators, actions, protocols, reporters, exporters, cloud providers, healing strategies | P0 |

## Non-functional requirements

| Area | Requirement |
| --- | --- |
| UI speed | Native find + tap median < 300 ms on emulator/simulator; web action < 50 ms locally |
| API speed | Prism adds < 5 ms per request |
| Load engine | ≥ 5,000 req/s and 5,000 virtual users from one 8-core machine (simple HTTP) |
| Measurement accuracy | < 1 ms overhead on reported p95; warn when the load machine saturates |
| Startup | Session < 5 s on booted emulator/simulator; < 2 s for a browser |
| Stability | < 1% flaky runs over 100 consecutive CI runs |
| Host platforms | macOS, Linux, Windows for web, Android, API, load; macOS only for iOS |
| Runtime | Node.js LTS; ESM + CommonJS; full types |
| Security | No telemetry by default; secrets masked; signed npm releases with provenance |
| Quality | ≥ 85% unit coverage on core; nightly real-device runs; load engine benchmarked each release |

## API sketch (illustrative)

```ts
import { test, expect, by } from 'prismtest';

test('order shows in the app', async ({ api, app }) => {
  const order = await api.post('/orders', { json: { sku: 'TSHIRT-M', qty: 2 } }).json();
  await app.signInWith(api.session);
  await app.tap(by.text('My orders'));
  await expect(app.find(by.text(order.id))).toBeVisible();
});
```

```ts
import { loadTest } from 'prismtest/perf';
import { createOrder } from './flows';

export default loadTest({
  scenario: async ({ api }) => { await createOrder(api); },
  stages: [{ duration: '2m', users: 1000 }, { duration: '10m', users: 1000 }, { duration: '1m', users: 0 }],
  thresholds: { 'http.p95': '< 500ms', 'http.errors': '< 1%' },
});
```

CLI: `prism test`, `prism load`, `prism doctor`, `prism devices`, `prism inspect`, `prism import`, `prism report`, `prism trace`, `prism snapshots approve`, `prism heal apply`.

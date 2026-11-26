# Prism roadmap

Living task list. The `project-manager` agent keeps it current; humans approve changes to phases and gates. Requirement IDs refer to `docs/PRD.md`.

Status values: `todo` · `in-progress` · `review` · `blocked` · `done`

## Phases

| Phase | Focus | Estimate (2 part-time maintainers) | Gate to leave the phase |
| --- | --- | --- | --- |
| 0 | Foundations: core, driver interface, Chromium, runner, spikes | ~1 year | **Go / no-go:** spikes prove the iOS runner, cloud-farm approach and load-engine throughput are feasible |
| 1 | Web, Android, API | ~1.5 years | **Alpha:** reference suite green on web, Android and API |
| 2 | iOS + smart features (healing, visual, BDD) | ~1.5 years | **Beta:** one spec passes on web, Android and iOS |
| 3 | Performance + v1.0 (load engine, metrics, cloud farms, docs) | ~2 years | **v1.0:** all P0 requirements done, success metrics met |

Estimates assume no AI-agent speed-up; re-estimate at the end of phase 0.

## Phase 0 tasks

| ID | Task | Requirements | Agent | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| P0-01 | Monorepo tooling: pnpm workspaces, TypeScript strict, ESLint, Prettier, Vitest, CI on Linux/macOS/Windows | — | core-engineer | — | review |
| P0-01a | Commit `pnpm-lock.yaml` and switch CI to `pnpm install --frozen-lockfile` with pnpm caching. **Needs a human** (package installs are blocked in the agents' environment) | — | human | P0-01 | todo |
| P0-02 | Design note: normalised UI tree and versioned host↔agent JSON protocol (`docs/design/protocol.md`) | CORE-2, AND-2, IOS-1 | core-engineer | — | review |
| P0-02a | Protocol follow-ups from final review: iOS hit test at the tap point (not `isHittable`); clickable/focusable filter in the Android `within` rule; let `checks.within` take a locator or define the refresh rule; settle before reading in-page rects | CORE-5, HYB-2 | core-engineer | P0-02 | todo |
| P0-03 | Driver interface types in `@prismtest/core` (session, find, actions, screenshot, tree) | CORE-1 | core-engineer | P0-01, P0-02 | todo |
| P0-04 | Locator engine v0: `by.role`, `by.text`, `by.testId`, `by.css`, platform overrides, on the normalised tree | CORE-2, CORE-3 | core-engineer | P0-03 | todo |
| P0-05 | Auto-wait (visible, stable, enabled, unobscured) and retrying `expect` v0. Phase 0 cannot act on `off-screen` (scrollIntoView is phase 1): retry until timeout and say so in the error | CORE-5, CORE-6 | core-engineer | P0-03 | todo |
| P0-06 | Chromium driver over CDP: launch, navigate, find, click, type, screenshot, headless | WEB-1 | web-driver-engineer | P0-03 | todo |
| P0-07 | Runner skeleton: `test()`, fixtures, hooks, retries, parallel workers; HTML + JUnit reporters | RUN-1, RUN-3 | core-engineer | P0-01 | todo |
| P0-08 | CLI skeleton: `prism test`, `prism doctor` | EMU-5 | core-engineer | P0-07 | todo |
| P0-09 | Spike: Android agent — instrumentation APK that dumps the UI tree and taps by coordinates over ADB | AND-1, AND-2 | android-engineer | P0-02 | todo |
| P0-10 | Spike: iOS runner — start from an open-source XCTest agent, run on a simulator, dump tree and tap. **Needs a human with macOS + Xcode** | IOS-1, IOS-2 | ios-engineer | P0-02 | todo |
| P0-11 | Spike: cloud farms — document which providers allow custom on-device agents and which need the Appium/WebDriver adapter (`docs/design/cloud-farms.md`) | CLD-1 | project-manager | — | todo |
| P0-12 | Spike: load-engine benchmark — Node HTTP client + worker threads against the 5,000 req/s target; write results to `docs/design/load-engine.md` | PERF-5 | perf-engineer | P0-01 | todo |
| P0-13 | HTTP engine v0: shared request pipeline (methods, headers, JSON bodies, timeouts, metrics hooks) | API-1 | api-engineer | P0-01 | todo |
| P0-14 | Docs site skeleton for prism.dev with quick-start placeholders | — | docs-writer | P0-01 | todo |
| P0-15 | Contributor guide, code of conduct, issue and PR templates polished | — | docs-writer | — | todo |
| P0-16 | CommonJS build alongside ESM for published packages (`require` export condition). Blocks the first npm publish | PRD runtime | core-engineer | P0-01 | todo |
| P0-17 | Enforce ≥ 85% unit-test coverage on `core` in CI | PRD quality | core-engineer | P0-01 | todo |

## Backlog for later phases

| ID | Task | Requirements | Agent | Phase | Status |
| --- | --- | --- | --- | --- | --- |
| B-01 | WebKit Inspector Protocol backend for iOS WKWebViews on the simulator (protocol risk R3); real-device webinspector path is separate (IOS-3) | HYB-1, HYB-2 | web-driver-engineer | 2 | proposed |

## Needs a human

- [x] Create the GitHub repository and push this starter.
- [ ] Open and merge the PRs for P0-01 and P0-02 once CI passes.
- [ ] Review the protocol design (P0-02): confirm decisions D1–D8 and answer the open questions in §14.
- [ ] P0-01a: commit `pnpm-lock.yaml` and switch CI to frozen installs.
- [ ] Claim the npm organisation `prismtest`.
- [ ] Register the domain prism.dev (or a fallback such as prismtest.dev).
- [ ] Provide a macOS machine with Xcode for iOS work (P0-10).
- [ ] Provide an Android device or emulator setup for agent testing (P0-09).

## Log

| Date | Change |
| --- | --- |
| 2026-11-26 | Roadmap created from the PRD. |
| 2026-11-27 | P0-01 and P0-02 in review (branches pushed, reviewer approved with nits). Added P0-01a, P0-02a, P0-16, P0-17 and backlog item B-01 from review follow-ups. |

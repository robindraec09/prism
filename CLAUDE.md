# Prism — instructions for AI agents

Prism is an open-source TypeScript tool for **UI testing (web, native Android, native iOS, hybrid), API testing and performance testing** with one API, one runner and one report. UI automation uses **drivers we own end to end** — never Playwright, Selenium or Appium.

## Sources of truth

| File | What it holds | Who updates it |
| --- | --- | --- |
| `docs/PRD.md` | Requirements with IDs (CORE-1, WEB-1, API-4, PERF-3, …), decisions, architecture | Humans only |
| `docs/ROADMAP.md` | Phases, gates, task list with status and owner agent | `project-manager` agent + humans |
| `docs/design/*.md` | Design notes and protocol specs written during the build | Specialist agents, reviewed by humans |

The living PRD is at https://claude.ai/artifact/Mpg1dxeVkBrei3f6y2m33y. If `docs/PRD.md` and a task disagree, the PRD wins; raise the conflict in the PR.

## Repository layout (target)

```
packages/
  prismtest/        main package, installs the `prism` CLI, re-exports the public API
  core/             unified API, locators, auto-wait, assertions, runner, plugin API, driver interface
  web/              web driver (CDP for Chromium, WebDriver BiDi for Firefox)
  android/          host-side Android driver (Node.js, talks to the agent over ADB)
  android-agent/    on-device agent APK (Kotlin, UiAutomator)
  ios/              host-side iOS driver (Node.js, macOS only)
  ios-runner/       on-device XCTest runner app (Swift)
  api/              HTTP engine + API testing (REST, GraphQL, WebSocket, schema checks)
  perf/             load engine, load models, thresholds, web/app metrics
  heal/             self-healing locators
  visual/           visual snapshot testing
  bdd/              Gherkin runner
  cloud-*/          cloud farm providers (own agents, Appium/WebDriver adapter as fallback only)
  reporter-*/       reporters (HTML, JUnit, Allure)
docs/               PRD, roadmap, design notes, docs site
```

## Tech conventions

- Node.js current LTS, TypeScript `strict`, ESM first with CommonJS builds, pnpm workspaces.
- Unit tests with Vitest next to the code (`*.test.ts`). Every PR adds or updates tests.
- ESLint + Prettier; no lint errors in a PR.
- Public APIs need TSDoc comments with an example.
- Kotlin for `android-agent`, Swift for `ios-runner`; keep their protocol in sync with `docs/design/protocol.md`.
- Host ↔ agent traffic is versioned JSON over HTTP/WebSocket. Never break the protocol without bumping its version.
- Dependencies must be MIT-compatible (MIT, BSD, Apache 2.0, ISC). Code adapted from other projects (for example WebDriverAgent) keeps its original licence notice.
- No telemetry. Mask secrets and auth tokens in logs and reports.

## How work flows

1. Pick the next `todo` task in `docs/ROADMAP.md` that matches your role (see agent table) and whose dependencies are `done`.
2. Branch as `<task-id>-short-name` (for example `P0-06-cdp-driver`).
3. Implement the smallest change that meets the task's acceptance criteria. Stay inside your packages; if you must touch another package, say why in the PR.
4. Run `pnpm lint && pnpm test && pnpm build` before opening a PR.
5. Open a PR using the template: task ID, requirement IDs, what changed, how it was tested, anything a human must do.
6. Ask the `reviewer` agent to review. Fix its findings.
7. A human merges. Then set the task to `done` in `docs/ROADMAP.md`.

If a task is too big for one PR, split it into sub-tasks (`P0-06a`, `P0-06b`) in the roadmap first.

## Agents

| Agent | Owns |
| --- | --- |
| `core-engineer` | `core`, `prismtest`, runner, CLI, plugin API, reporters, monorepo tooling |
| `web-driver-engineer` | `web` (CDP, BiDi), web hybrid attach logic |
| `android-engineer` | `android`, `android-agent`, emulator management |
| `ios-engineer` | `ios`, `ios-runner`, simulator management |
| `api-engineer` | `api` (HTTP engine, API testing) |
| `perf-engineer` | `perf` (load engine, metrics, thresholds) |
| `docs-writer` | `docs/`, README, contributor guide, docs site |
| `reviewer` | Reviews every PR against the PRD and these rules; read-only |
| `project-manager` | Roadmap, issue triage, weekly status; never writes product code |

## Things only a human does

Agents prepare these and stop; they list them under "Needs a human" in the PR or the roadmap:

- Merging to `main`, creating releases, publishing to npm.
- Creating or changing secrets, tokens, API keys, Apple/Google accounts.
- iOS code signing and provisioning; running on physical devices.
- Changing `docs/PRD.md`, the licence, or governance files.
- Spending money (cloud farm plans, domains, CI minutes beyond the free tier).

## Hard rules

- Do not add Playwright, Puppeteer, Selenium, WebdriverIO or Appium as dependencies. The only exception is the cloud fallback adapter in `cloud-*`, which may speak the WebDriver/Appium protocol to a farm.
- Do not weaken tests to make them pass. Flaky tests are bugs.
- Self-healing and visual testing run locally by default; no data leaves the machine unless the user configures an AI provider.
- Keep PRs small and focused; one task per PR.

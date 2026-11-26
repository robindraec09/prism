# Monorepo tooling (P0-01)

| Concern | Choice | Why |
| --- | --- | --- |
| Package manager | pnpm 9 workspaces, pinned by `packageManager` | Strict dependency isolation catches undeclared imports; CI reads the version from `package.json`. |
| Runtime | Node.js `>=22.12.0` (LTS); CI runs `lts/*` on all OSes plus `22.12.0` on Linux | Oldest maintained LTS line with `require(esm)`, which eases the planned CommonJS build. CI tests the `engines` floor. |
| Language | TypeScript 5, `tsconfig.base.json` extended per package and by a root `tsconfig.json` for root config files | `strict` plus `noUncheckedIndexedAccess`; `module`/`moduleResolution` `NodeNext`, target ES2023, `verbatimModuleSyntax`, declarations and source maps. Options these already imply are left out. |
| Build | `tsc -p tsconfig.build.json` per package → `dist/` | No bundler needed for libraries; tests are excluded from the build config. |
| Lint | ESLint 9 flat config + typescript-eslint `strict` and `stylistic` | `eslint-config-prettier` is applied last so ESLint never fights Prettier. Run once from the root (`pnpm lint`). |
| Format | Prettier 3 (single quotes, 100 cols, trailing commas, LF) | Markdown is ignored so human-owned docs (PRD, CLAUDE.md) and agent-edited roadmap files are never rewritten. `.gitattributes` forces LF so Windows CI agrees. |
| Tests | Vitest, one root config, `packages/*/src/**/*.test.ts` | Tests sit next to the code; mocks, env and globals are restored between tests. |

## Root scripts

`build` runs each package's script (`pnpm -r`). `typecheck` checks the root `tsconfig.json` (`vitest.config.ts`), then each package. `test`, `lint`, `format` and `format:check` run once from the root. Each package also has a `test` script that runs the root Vitest config filtered to that package (`pnpm --filter @prismtest/core test`), and declares the dev dependencies it imports (`vitest`, `@types/node`, `typescript`). CI runs install, typecheck, lint, format check, test and build on Linux, macOS and Windows.

## Follow-ups

- Commit `pnpm-lock.yaml` (needs a working registry), then use `pnpm install --frozen-lockfile` and pnpm caching in CI.
- CommonJS build alongside ESM (PRD: "ESM + CommonJS"), with a `require` condition in `exports`, before the first publish. To be tracked as a roadmap task.
- Coverage with `@vitest/coverage-v8` and the ≥ 85 % core threshold from the PRD. To be tracked as a roadmap task.
- Type-aware lint rules (`recommendedTypeChecked` with `projectService`), and typechecking `eslint.config.js`, once there is more code.

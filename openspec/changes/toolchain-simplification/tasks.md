## 1. Bun Foundation

- [x] 1.1 Delete `yarn.lock` and run `bun install` to generate `bun.lockb`
- [x] 1.2 Update root `package.json`: remove `engines.npm: "please-use-yarn"`, update `engines.node` or remove, add `bun` to engines if desired
- [x] 1.3 Delete `.nvmrc`
- [x] 1.4 Add `bun.lockb` to version control, add `yarn.lock` to `.gitignore`

## 2. Remove Orchestration

- [x] 2.1 Delete `nx.json`
- [x] 2.2 Delete `lerna.json`
- [x] 2.3 Remove `nx`, `@nrwl/cli`, `@nrwl/nx-cloud`, `lerna` from root devDependencies
- [x] 2.4 Rewrite root `package.json` scripts to use `bun run` — replace all `yarn nx run-many`, `yarn workspace`, `lerna run` commands with bun equivalents (`bun run --filter`)
- [x] 2.5 Remove `lernaBuildTask` scripts from each package's `package.json`

## 3. Build Pipeline — Rolldown

- [x] 3.1 Add `tsdown` as root devDependency (pivoted from rolldown — tsdown is a library build tool built on rolldown)
- [x] 3.2 Create shared `tsdown.config.base.ts` at root (ESM output, dts:false for now, clean, es2022 target)
- [x] 3.3 Replace `packages/core/rollup.config.js` with `tsdown.config.ts` extending shared base
- [x] 3.4 Replace `packages/theming/rollup.config.js` with `tsdown.config.ts` extending shared base
- [x] 3.5 Replace `packages/ui/rollup.config.js` with `tsdown.config.ts` extending shared base
- [x] 3.6 Update each package's build script to `tsdown`
- [x] 3.7 Remove `rollup`, `rollup-plugin-typescript2`, `@rollup/plugin-babel` from root devDependencies
- [x] 3.8 Verify `bun run build` produces `dist/index.mjs` (ES module) for core, theming, ui
- [x] 3.9 Verify full build chain passes: tsdown (JS) + tsc -p tsconfig.build.json (declarations) for all 3 packages

## 4. Test Runner — bun:test

- [x] 4.1 Delete `jest.config.js` (root)
- [x] 4.2 Delete `jest.config.base.js` (root)
- [x] 4.3 Delete `tsconfig.jest.json` (root)
- [x] 4.4 Delete `packages/core/jest.config.js`
- [x] 4.5 Delete `packages/_integration/jest.config.js`
- [x] 4.6 No test import changes needed — bun:test provides describe/it/expect as globals, same as Jest
- [x] 4.7 Integration tests: 41 pass, 9 fail (all @emotion/jest toHaveStyleRule — deferred per plan)
- [x] 4.8 Jest deps removed in root package.json rewrite (task 2.3)
- [x] 4.9 Root test script set to `bun test`
- [x] 4.10 Verified: `bun test` runs 41+41 tests across core (4 files) and _integration (2 files)

## 5. Remove Babel

- [x] 5.1 Delete `babel.config.js` (root)
- [x] 5.2 Delete `packages/core/babel.config.js`
- [x] 5.3 Delete `packages/theming/babel.config.js`
- [x] 5.4 Delete `packages/ui/babel.config.js`
- [x] 5.5 Delete `packages/_integration/babel.config.js`
- [x] 5.6 All Babel deps removed in root package.json rewrite (task 2.3)
- [x] 5.7 @emotion/babel-plugin removed in root package.json rewrite
- [x] 5.8 prettier removed in root package.json rewrite

## 6. Deactivate Docs Package

- [x] 6.1 Strip `packages/_docs/package.json` to bare minimum: name, version, private: true
- [x] 6.2 Delete `packages/_docs/next.config.js`
- [x] 6.3 Source files preserved as reference (components/, pages/, theme.ts, lib/)
- [x] 6.4 All deps removed via 6.1

## 7. CI & Deploy Cleanup

- [x] 7.1 Delete `.github/workflows/publish-alpha.yaml`
- [x] 7.2 Delete `.github/workflows/publish-beta.yaml`
- [x] 7.3 Create `.github/workflows/ci.yaml` — single workflow: setup bun, install, lint, type-check, build, test
- [x] 7.4 Delete `netlify.toml`

## 8. Final Cleanup & Verification

- [x] 8.1 Dead devDependencies removed in root package.json rewrite
- [x] 8.2 Biome jest globals can stay (bun:test also uses these names, no conflict)
- [x] 8.3 `bun install` — clean, 191 packages, no warnings
- [x] 8.4 `bun run build` — all 3 packages produce dist/index.mjs + .d.ts declarations
- [x] 8.5 `tsc` — type checking passes for core, theming, ui (docs excluded as inert)
- [x] 8.6 `bun test` — 41 core tests pass; 9 integration failures are @emotion/jest matchers (deferred)
- [x] 8.7 `biome check` — 1 pre-existing lint issue (useExhaustiveDependencies in ui), no new issues

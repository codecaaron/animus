## Why

The Animus monorepo has accumulated ~25 build/test/publish tools around 3 packages of functional code. Yarn v1, NX 15.8, Lerna 6.5, Babel 7.27 (with a fossil codecademy preset of now-native syntax transforms), Rollup with Babel+TS plugins, Jest with babel-jest, Prettier (already replaced by Biome), Next.js for a docs site that's no longer published, and two GitHub Actions publish workflows for a package that isn't actively publishing. The toolchain is heavier than the code it serves.

Bun, Rolldown, tsc, and Biome can replace all of it. The core library code (`src/` directories) requires zero changes — this is purely scaffolding surgery.

## What Changes

- **BREAKING**: Replace Yarn v1 with Bun as package manager, script runner, and test runner
- **BREAKING**: Replace Rollup 3.19 + rollup-plugin-typescript2 + @rollup/plugin-babel with Rolldown
- Remove Babel entirely (core, presets, plugins, emotion plugin, macros) — all transforms are native ES2022+ or handled by Rolldown/Bun
- Remove NX 15.8.6 + nx-cloud — Bun workspaces + `--filter` sufficient for 5-package linear dependency chain
- Remove Lerna 6.5.1 — not publishing packages currently; re-engineer when needed
- Remove Jest 30 + babel-jest + jsdom — Bun's native test runner replaces
- Remove Prettier 2.5.1 — already fully replaced by Biome 2.0
- Remove Next.js 14 from docs package — site is no longer published; keep source files as reference, strip build tooling
- Remove both GitHub Actions publish workflows (publish-alpha, publish-beta)
- Remove Netlify Next.js plugin — simplify or remove netlify.toml
- Simplify root package.json scripts from 12 to ~5
- Add single CI workflow: lint + type-check + test

## Capabilities

### New Capabilities
- `bun-workspace`: Bun as package manager with native workspace support, replacing Yarn v1 + NX + Lerna orchestration
- `rolldown-build`: Rolldown as library bundler for published packages, replacing Rollup + Babel + TypeScript plugin chain
- `bun-test`: Bun native test runner replacing Jest + babel-jest + jsdom

### Modified Capabilities
_(none — no spec-level behavior changes to builder-chain, extension-system, or prop-system)_

## Impact

- **Root config**: package.json, lockfile, all build/test config files replaced or removed
- **Per-package config**: babel.config.js, jest.config.js, rollup.config.js removed from each package; replaced with rolldown.config.ts
- **CI/CD**: Both publish workflows removed, replaced with single lint+typecheck+test workflow
- **Deployment**: Netlify config simplified or removed (no active deploy target)
- **Dependencies**: ~40+ devDependencies removed, ~3 added (bun implicit, rolldown)
- **Source code**: Zero changes to any `src/` directory
- **Published packages**: Build output format unchanged (ES modules, .d.ts declarations)

## Context

The Animus monorepo (5 packages, linear dependency chain: core → theming → ui → _integration → _docs) currently uses a layered toolchain that accumulated over years:

- **Package management**: Yarn Classic v1 with `yarn.lock`, enforced via `engines.npm: "please-use-yarn"`
- **Orchestration**: NX 15.8.6 (with nx-cloud remote caching) + Lerna 6.5.1 (independent versioning, publish)
- **Transpilation**: Babel 7.27 with babel-preset-codecademy (fossil ES2020 syntax transforms), @emotion/babel-plugin, babel-plugin-macros, @babel/preset-typescript
- **Bundling**: Rollup 3.19 with rollup-plugin-typescript2 + @rollup/plugin-babel
- **Testing**: Jest 30 + babel-jest + jsdom + @emotion/jest
- **Formatting**: Prettier 2.5 (dead — Biome replaced it) + Biome 2.0
- **Docs**: Next.js 14 with @next/mdx, deployed to Netlify (no longer published)
- **CI**: Two GitHub Actions workflows for canary + beta npm publishing (not actively publishing)

The docs site is no longer deployed. Packages are not being published to npm. The `babel-preset-codecademy` contains only transforms for language features that are now native (optional chaining, nullish coalescing, class properties, decorators). The @emotion/babel-plugin provides dev-only auto-labeling that isn't needed.

## Goals / Non-Goals

**Goals:**
- Replace entire toolchain with 4 tools: Bun (pkg/run/test), Rolldown (bundle), tsc (types), Biome (lint/fmt)
- Zero changes to library source code (`src/` directories untouched)
- Maintain identical build output for published packages (ES modules + .d.ts)
- Single CI workflow that validates the monorepo (lint + typecheck + test)
- Drastically simplified root and per-package configuration

**Non-Goals:**
- Package publishing infrastructure (re-engineer later when needed)
- Docs site rebuild (keep files as reference, recreate separately)
- Upgrading or changing Emotion runtime (stays as-is)
- Migrating @emotion/jest test assertions (owner handles separately)
- Changing TypeScript compiler options or strictness

## Decisions

### 1. Bun replaces Yarn + NX + Lerna + Jest

**Choice**: Bun as the single runtime — package manager, workspace manager, script runner, and test runner.

**Why**: Bun natively handles workspaces (compatible with `package.json` `workspaces` field), runs TypeScript/JSX without a transpiler, and includes a Jest-compatible test runner. For a 5-package monorepo with a linear dependency chain, dedicated orchestration tools (NX, Lerna) add complexity without proportional value. `bun run --filter` provides targeted package execution.

**Alternative considered**: Keep NX for build caching + affected detection. Rejected because the build graph is simple (core → theming → ui) and full builds are fast enough without caching for this repo size.

### 2. Rolldown replaces Rollup + Babel + TypeScript plugin

**Choice**: Rolldown as the library bundler.

**Why**: Rolldown is Rollup-compatible (same config API) but Rust-native, handles TypeScript and JSX natively without plugins, and eliminates the Babel dependency entirely. The current Rollup config is minimal (~15 lines) and maps directly to Rolldown. Output format stays ES modules. This also future-proofs for the Rust extraction pipeline (Rolldown is built on OXC, same parser the extraction plan uses).

**Alternative considered**: `bun build` as bundler. Rejected because Rolldown's Rollup compatibility makes the migration trivial (near-identical config), and Rolldown provides better control over output format for library publishing.

### 3. Docs package becomes inert reference

**Choice**: Keep `_docs/` source files (components, theme, pages) but strip all build tooling. Remove Next.js, MDX plugins, Babel deps, build scripts.

**Why**: The docs site is no longer published. The source files serve as real-world usage examples of the Animus API (theme.ts, component compositions). Keeping them as reference costs nothing. Rebuilding the docs site is a separate future effort, likely with Vite.

**Alternative considered**: Delete _docs entirely. Rejected because the theme file and component examples are valuable reference material for the extraction work ahead.

### 4. Remove all publishing infrastructure

**Choice**: Delete both GitHub Actions publish workflows, remove Lerna publish config, remove npm publish-related package.json fields from being actively maintained.

**Why**: Packages are not currently being published. When publishing resumes, it should be re-engineered for the new toolchain (potentially `bun publish` or a simple script) rather than maintaining stale Lerna-based workflows.

### 5. tsc stays for type checking only (no emit)

**Choice**: Keep TypeScript compiler for `--noEmit` type checking. Rolldown handles actual compilation and emit.

**Why**: Bun and Rolldown handle runtime TS transpilation but neither performs full type checking. tsc remains the authority for type correctness. This is already the pattern (`"compile": "tsc --noEmit"`) — we're just making it the ONLY role tsc plays.

## Risks / Trade-offs

**[Bun workspace compatibility]** → Yarn v1 `nohoist` for `@types` may not have a direct Bun equivalent. Mitigation: test that TypeScript resolution works correctly after migration; `@types` hoisting behavior is generally fine with Bun's module resolution.

**[Rolldown maturity]** → Rolldown is newer than Rollup. Mitigation: the Rollup compatibility layer is well-tested, and our config is minimal. If Rolldown has issues, falling back to Rollup is trivial (same config format).

**[bun:test compatibility]** → `@emotion/jest` matchers (`toHaveStyleRule`) won't work in bun:test. Mitigation: explicitly deferred — owner handles emotion test migration separately. Core unit tests (createAnimus.test.ts) use standard assertions that port directly.

**[CI runner support]** → GitHub Actions needs `oven-sh/setup-bun` action. Mitigation: this is a well-maintained official action, widely used.

**[Netlify build]** → Netlify needs Bun available in build environment. Mitigation: if no site is deployed, netlify.toml can be removed entirely. If needed later, Netlify supports Bun natively.

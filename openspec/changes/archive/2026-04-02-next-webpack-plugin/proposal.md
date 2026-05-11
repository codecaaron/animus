## Why

Next.js is the dominant React framework. Without webpack integration, Animus is limited to Vite-based projects. The extraction pipeline is already bundler-agnostic at the Rust boundary — `analyzeProject()` and `transformFile()` know nothing about Vite. The missing piece is a host that wires these functions into webpack's plugin/loader lifecycle. Turbopack has no plugin API, so webpack is the only viable integration path for Next.js today.

## What Changes

### 1. EmitterConfig — Configurable Paths in Rust

`transform_emitter.rs` hardcodes `'@animus-ui/system'` (runtime import) and `'virtual:animus/styles.css'` (CSS module ID). The Next.js plugin needs to emit a real file path (`.animus/styles.css`) instead of a Vite virtual module. Add `EmitterConfig` struct with `runtime_import` and `css_module_id` fields, threaded through `analyze_project()` and `transform_file()` via the manifest JSON. Vite plugin gets backward-compatible defaults.

### 2. Runtime-Agnostic Subprocess

The Vite plugin's `loadSystem()` uses `execSync('bun run ...')`. Next.js projects typically use npm/yarn/pnpm. Adapt the subprocess model: detect `bun` in PATH, fall back to `node` with CJS `require()`. Both the Vite plugin and Next plugin consume this logic.

### 3. `@animus-ui/next-plugin` Package (NEW)

New package providing `withAnimus(options)(nextConfig)` for Next.js App Router and Pages Router.

**Webpack plugin** — `compiler.hooks.run`/`watchRun` calls `loadSystem()` + `analyzeProject()` once per build. Analysis shared across Next's 3 compiler passes (server-nodejs, server-edge, client) via module-level promise mutex. Resolved CSS written to `.animus/styles.css` on disk (real file, not virtual module — simpler integration with Next's CSS pipeline).

**Webpack loader** — Calls `transformFile()` per source file using the cached manifest. Files with no extractable components pass through unchanged.

**Config wrapper** — `withAnimus({ system })` registers plugin + loader, composes with existing `nextConfig.webpack`, validates options.

**Dev HMR** — `watchRun` detects changed files via content hash. Component changes trigger incremental re-analysis. System file changes trigger geological reset (subprocess reload). CSS file write triggers webpack hot update.

### 4. Vite Plugin Adaptation

Vite plugin constructs `EmitterConfig` with its existing defaults (`@animus-ui/system`, `virtual:animus/styles.css`). Subprocess logic refactored to use the runtime-agnostic detection. No behavioral change.

## Capabilities

### New Capabilities
- `next-webpack-integration`: Webpack plugin + loader lifecycle for Next.js builds — file discovery, analysis orchestration, CSS delivery, source transformation
- `next-config-wrapper`: `withAnimus()` API, option validation, webpack config composition, multi-compiler awareness
- `next-dev-hmr`: Incremental re-analysis on file change, geological reset on system change, CSS file write for hot update

### Modified Capabilities
- `extraction-emitter-config`: Runtime import path and CSS module ID become configurable via `EmitterConfig` — shared prerequisite for both Vite and Next plugins
- `vite-extraction-plugin`: Subprocess model becomes runtime-agnostic (bun → node fallback), EmitterConfig wired with backward-compatible defaults
- `rust-extraction-pipeline`: `analyze_project` and `transform_file` accept emitter config fields in manifest JSON

## Impact

- **New package:** `packages/next-plugin/` — webpack plugin, loader, config wrapper, shared subprocess utilities
- **`packages/extract/src/transform_emitter.rs`**: `EmitterConfig` struct, configurable import/CSS paths
- **`packages/extract/src/lib.rs`**: `analyze_project` and `transform_file` forward emitter config through manifest
- **`packages/vite-plugin/src/index.ts`**: Subprocess refactor (bun → node fallback), EmitterConfig construction
- **Dependencies:** `webpack-virtual-modules` (or disk-write approach), `@animus-ui/extract` (existing)
- **No changes to:** system builder, theming, CSS generation, @layer cascade, type system, test infrastructure

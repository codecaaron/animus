## Why

The `@animus-ui/next-plugin` is built on Webpack plugin APIs (`compiler.hooks.run`, `compiler.hooks.watchRun`, `NormalModuleReplacementPlugin`) that Turbopack does not support. As of Next.js 16, Turbopack is the default bundler for both dev and build. Users running `next dev` with the current plugin get zero extraction — Turbopack silently ignores the `AnimusWebpackPlugin`.

Three additional architectural fragilities compound the issue:

1. **CSS injection via `ROOT_ENTRY_RE` regex** (`/^(src\/)?(?:app\/layout|pages\/_app)\.[tj]sx?$/`) — fails for route groups (`app/(marketing)/layout.tsx`), internationalized routing (`app/[locale]/layout.tsx`), parallel routes, and any non-standard layout structure.
2. **No cross-compiler mutex on `.animus/styles.css` writes** — Next.js runs 3+ Webpack compilers concurrently (client, server, edge). The Promise deduplication in `singleton.ts` prevents duplicate analysis but doesn't protect the file write itself.
3. **Coupling to compiler lifecycle** — extraction timing depends on Webpack hook ordering, making it impossible to support bundlers that don't expose equivalent hooks.

**Prereq**: `embedded-transform-eval` must land first. It eliminates all subprocess IPC, so the extraction pipeline produces fully-resolved CSS in Rust with no external orchestration needed. Without it, the prebuild phase would still require subprocess coordination.

## What Changes

- **Move extraction out of Webpack hooks into `withAnimus()` setup phase** — `analyzeProject()` runs synchronously during config resolution, before Next.js boots any bundler. Bundler-agnostic by design.
- **Replace auto-injection with user-land CSS import + resolve alias** — expose `@animus-ui/styles` as an importable path mapped to `.animus/styles.css` via both `resolve.alias` (Webpack) and `resolveAlias` (Turbopack). User adds one import to their root layout. Eliminates `ROOT_ENTRY_RE` entirely.
- **Register loader for both Webpack and Turbopack** — the per-file NAPI transform runs as a loader. `with-animus.ts` registers it in both `module.rules` (Webpack) and `turbopack.rules` (Turbopack). Loader no longer handles CSS injection — just source transformation.
- **File watch via chokidar for dev HMR** — replace `compiler.hooks.watchRun` with an independent file watcher. On source file change, re-run analysis and rewrite `.animus/styles.css`. Next.js watches the CSS file natively and triggers hot reload.
- **Remove `AnimusWebpackPlugin` class** — the plugin class, `compiler.hooks` registration, and `NormalModuleReplacementPlugin` usage are eliminated. All functionality moves to the config setup phase and the loader.
- **Add content-hash mutex for CSS writes** — atomic write with temp file + rename to prevent partial reads during concurrent compilation.

## Capabilities

### New Capabilities
- `prebuild-extraction`: Bundler-agnostic extraction pipeline that runs during config resolution, before any compiler boots
- `turbopack-loader`: Per-file source transformation compatible with Turbopack's `turbopack.rules` loader API
- `file-watch-hmr`: Independent chokidar-based file watcher for dev mode incremental extraction, decoupled from bundler lifecycle
- `manual-css-import`: User-land CSS import path (`@animus-ui/styles`) resolved via bundler-native alias mechanisms

### Modified Capabilities
- `next-webpack-integration`: Webpack plugin class eliminated, loader simplified to transform-only (no CSS injection), resolve aliases replace `NormalModuleReplacementPlugin`

## Impact

- `packages/next-plugin/src/plugin.ts` — **Deleted or gutted**. `AnimusWebpackPlugin` class removed. Pipeline logic moves to a standalone `runExtraction()` function called from `withAnimus()`.
- `packages/next-plugin/src/loader.ts` — Simplified to transform-only. `ROOT_ENTRY_RE` and CSS stripping/injection removed.
- `packages/next-plugin/src/with-animus.ts` — Major rewrite. Calls extraction at config time. Registers loader for both Webpack and Turbopack. Sets up resolve aliases for both bundlers.
- `packages/next-plugin/src/singleton.ts` — Simplified or eliminated. No more cross-compiler Promise coordination needed since extraction runs before compilers.
- `packages/next-plugin/package.json` — Add `chokidar` dependency for dev file watching.
- **Consumer-facing**: Users must add `import '@animus-ui/styles'` to their root layout. **BREAKING** for existing users who relied on auto-injection — migration guide needed.
- **No changes to**: `@animus-ui/extract` (Rust crate), `@animus-ui/system`, or the Vite plugin.

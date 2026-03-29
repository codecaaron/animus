## Why

This consolidates two archived changes — `publishing-surface` (Phase 2) and `next-plugin` — into a single arc covering the remaining work to make Animus distributable and usable in mainstream React environments.

Phase 1 of publishing-surface is done: all publishable packages have metadata, `private: true` removed, `exports`/`files` configured, and first betas are on npm. What remains is the work that enables the extraction pipeline to run outside Vite and that readies the runtime for React 19.

The `@animus-ui/runtime` package is vestigial. `createComponent` and `createClassResolver` have been absorbed into `@animus-ui/system/src/runtime` and are re-exported from the system index. The standalone runtime package exists but is not the live source; it should be cleaned up rather than renamed or published.

## What Changes

### 1. Rust: Configurable Emitter Paths (EmitterConfig)

`transform_emitter.rs` currently hardcodes two strings: `'@animus-ui/system'` (runtime import source) and `'virtual:animus/styles.css'` (CSS module ID). Both must be configurable so the Next.js plugin can inject a real file path instead of a virtual module.

- Add `EmitterConfig` struct (`runtime_import: String`, `css_module_id: String`) deserialized from the manifest JSON
- `transform_file()` reads emitter config from the manifest and passes it to `apply_replacements`
- `analyze_project()` forwards emitter config fields through to the manifest
- Vite plugin constructs the config object before calling `analyze_project` / `transform_file` (backward-compatible defaults: `@animus-ui/system`, `virtual:animus/styles.css`)

### 2. Runtime: React 19 Ref-as-Prop

`packages/system/src/runtime/` currently uses `forwardRef`, which requires `"use client"` in React Server Component trees. React 19 accepts `ref` as a plain prop, making `forwardRef` unnecessary.

- Replace `forwardRef` wrapper in `createComponent` with a plain function that destructures `ref` from props
- Pass `ref` directly to `createElement` as part of the props object
- Remove `forwardRef` import
- Verify ref forwarding behavior and bundle size remains under 1KB gzipped
- Deprecate and do not publish `packages/runtime/` — its `createComponent` copy is no longer the live source

### 3. Next.js Adapter (`@animus-ui/next-plugin`)

New package providing `withAnimus(nextConfig, options?)` for Next.js Pages Router and App Router projects. Next.js uses webpack; no Turbopack plugin API exists yet.

**Webpack plugin** — runs `analyze_project()` once per build (shared across server/client/edge compilation passes via a module-level promise mutex), writes resolved CSS to `.animus/styles.css` on disk.

**Webpack loader** — calls `transform_file()` per source file using the cached manifest; passes through files with no components unchanged.

**Config wrapper** — `withAnimus()` registers the plugin and loader, composes with any existing `nextConfig.webpack`, and throws a clear error if `system` option is missing.

**Dev HMR** — webpack `watchRun` hook detects changed files; component changes trigger incremental re-analysis; system file changes trigger geological reset (subprocess reload). CSS file write causes webpack to hot-update the stylesheet.

**RSC** — with the React 19 ref-as-prop migration, fully-extracted components are plain functions with no `"use client"` requirement. The Next plugin sets `runtimePackage` in emitter config and passes `.animus/styles.css` as the CSS module ID so the generated import resolves as a real file rather than a virtual module.

**Consumer integration:**

```tsx
// next.config.ts
import { withAnimus } from '@animus-ui/next-plugin';
export default withAnimus({ system: './src/ds.ts' })({ /* nextConfig */ });

// app/layout.tsx or pages/_app.tsx
import './.animus/styles.css';
```

### 4. Shared Utilities Extraction

Both the Vite plugin and the Next plugin need the same low-level operations. Extract these from the Vite plugin into a shared internal utility (not a public package):

- `loadSystem()` subprocess logic
- `applyUnitFallback()` post-processing
- `__TRANSFORM__` placeholder resolution
- Diagnostic printing (bail/skip/elimination warnings)

The Vite plugin is refactored to import from the shared utility — no behavioral change.

### 5. Runtime Package Cleanup

`packages/runtime/` contains a stale copy of `createComponent` and is no longer the authoritative source. Do not publish it. Options:

- Remove the directory entirely, or
- Keep it with `private: true` and a deprecation notice (safer for any internal tooling that references the path)

The live `createComponent` is in `packages/system/src/runtime/`.

## Packages That Ship

| Package | Role | Framework-specific? |
|---------|------|---------------------|
| `@animus-ui/system` | Authoring surface + runtime shim | No (React peer dep) |
| `@animus-ui/vite-plugin` | Vite build integration | No |
| `@animus-ui/next-plugin` | Next.js / webpack build integration | Next.js |
| `@animus-ui/extract` | Rust NAPI crate (build-time dep) | No |

## Packages That Do Not Ship

| Package | Reason |
|---------|--------|
| `@animus-ui/runtime` | Absorbed into system. Stale copy. |
| `@animus-ui/theming` | Re-exported through system. Internal dep only. |
| `@animus-ui/core` | Old Emotion-based builder. Not used by extraction pipeline. |

## Capabilities

### New Capabilities
- `next-webpack-integration`: Webpack plugin + loader for Next.js build lifecycle
- `next-config-wrapper`: `withAnimus()` config wrapper with system path resolution
- `next-dev-hmr`: Incremental re-analysis and CSS regeneration in Next.js dev mode
- `next-rsc-compatibility`: RSC-compatible extracted components via ref-as-prop + real CSS file

### Modified Capabilities
- `extraction-emitter-config`: `transform_emitter.rs` runtime import and CSS module ID become configurable via manifest JSON — shared requirement for both Vite and Next plugins
- `extraction-runtime-shim`: `createComponent` migrates from `forwardRef` to React 19 ref-as-prop plain function

## Impact

- **`packages/extract/src/transform_emitter.rs`**: `EmitterConfig` struct, runtime import and css_module_id read from config
- **`packages/extract/src/lib.rs`**: `transform_file` and `analyze_project` accept emitter config in manifest JSON
- **`packages/system/src/runtime/`**: `forwardRef` removed, ref-as-prop pattern
- **`packages/vite-plugin/`**: Constructs emitter config; core logic extracted to shared utilities
- **`packages/next-plugin/`**: New package — webpack plugin, loader, config wrapper
- **`packages/runtime/`**: Deprecated, not published
- **No changes to**: system builder, theming, CSS generation, @layer cascade, showcase

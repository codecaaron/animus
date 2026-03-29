## Why

Animus extraction is bundler-agnostic at the Rust crate level — `analyze_project()` and `transform_file()` take plain JSON strings and return plain strings. But the only build tool integration is the Vite plugin. Next.js is the dominant React meta-framework, and supporting it opens the realistic adoption surface for any team not on Vite. The webpack integration path works today — no need to wait for Turbopack's plugin API.

## What Changes

- New `@animus-ui/next-plugin` package providing a `withAnimus(nextConfig, options)` config wrapper
- Webpack plugin that runs `analyze_project()` once per build (shared across server/client/edge compilation passes), writes CSS to a generated file on disk
- Webpack loader that calls `transform_file()` per-file using the cached manifest — same NAPI functions as the Vite plugin
- CSS delivered as a real file (`.animus/styles.css`) imported by the user in `_app.tsx` (Pages Router) or `layout.tsx` (App Router) — no virtual modules
- Dev-mode HMR via webpack file watching: system file change → full re-analysis + CSS regeneration; component file change → incremental re-analysis + CSS update
- Runtime import path in `transform_emitter.rs` made configurable via manifest parameter (currently hardcoded to `@animus-ui/runtime`, needs to support `@animus-ui/react` per publishing-surface and allow the Next plugin to control the CSS import path)
- RSC compatibility path: update `createComponent` from `forwardRef` wrapper to React 19 ref-as-prop pattern, removing the `"use client"` requirement for fully-extracted components

## Capabilities

### New Capabilities
- `next-webpack-integration`: Webpack plugin + loader for Next.js — build lifecycle hooks, manifest caching across compilation passes, CSS file output
- `next-config-wrapper`: `withAnimus()` config wrapper — option merging, loader registration, plugin injection, system path resolution
- `next-dev-hmr`: Dev-mode HMR in Next.js — file watching, incremental re-analysis, CSS file regeneration, geological reset detection
- `next-rsc-compatibility`: React Server Component support — ref-as-prop runtime update, server/client component boundary handling, no separate entry points needed

### Modified Capabilities
- `extraction-runtime-shim`: `createComponent` switches from `forwardRef` to React 19 ref-as-prop — components become plain functions, RSC-compatible without `"use client"`
- `vite-extraction-plugin`: Runtime import path and CSS module ID become configurable parameters in the manifest rather than hardcoded in the Rust emitter — shared concern with Next plugin

## Impact

- **New package**: `packages/next-plugin/` with webpack plugin, loader, and config wrapper
- **Runtime package**: `forwardRef` → ref-as-prop migration in `createComponent`
- **Rust crate**: `transform_emitter.rs` — runtime import path and CSS module ID read from manifest config instead of hardcoded strings
- **Vite plugin**: Minor — passes import paths via manifest config instead of relying on hardcoded defaults (backward compatible)
- **Dependencies**: `webpack` as peer dependency for the next-plugin package. No new Rust dependencies.
- **No changes to**: extraction pipeline, CSS generation, @layer cascade, system builder, theming

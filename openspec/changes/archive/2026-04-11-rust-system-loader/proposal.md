## Why

System module loading (ds.ts → config) currently requires a subprocess (`execSync` + bun/node) that each plugin implements independently. This creates bundler-specific coupling, subprocess availability requirements, and bimodal latency (cold: ~30ms, warm with bun cache: ~10ms). The Rust crate already owns parsing (OXC), type-stripping (oxc_transformer), and import resolution — system loading is the last pipeline phase that escapes to a subprocess.

## What Changes

- **Replace boa_engine with rquickjs** (QuickJS Rust bindings) — single JS engine for both module execution and transform evaluation
- **New NAPI function** `loadSystemModule(systemPath, rootDir, exportName?)` that internalizes the complete load pipeline: read → OXC type-strip → resolve deps → rquickjs execute → extract config
- **New Rust module** `system_loader.rs` — full-module OXC type-stripping, package.json resolution with `exports` → `module` → `main` fallback, two-map rquickjs Resolver (base+specifier→path) + Loader (path→source), recursive dep parsing including pre-built .mjs files
- **Migrate `transform_evaluator.rs`** from boa_engine to rquickjs — same API surface, faster bytecode-compiled execution
- **Both plugins updated** to call the new NAPI function instead of `execSubprocess()`
- **execSubprocess removed** from vite-plugin and next-plugin system loading paths (kept if used elsewhere)

## Capabilities

### New Capabilities
- `rust-system-loader`: In-process system module loading via OXC + rquickjs. Covers: TS type-stripping for full modules, package.json exports map resolution for bare specifiers, rquickjs module execution with pre-loaded deps, SystemInstance/theme extraction from module exports.

### Modified Capabilities
- `vite-extraction-plugin`: loadSystem() calls NAPI instead of subprocess
- `next-webpack-integration`: system loading calls NAPI instead of subprocess
- `extract-pipeline`: New NAPI export `loadSystemModule` added to pipeline surface

## Impact

- **Rust crate**: rquickjs 0.11 replaces boa_engine 0.21. New module `system_loader.rs`, new NAPI export. Build time increase from QuickJS C compilation (~30s first build, cached after).
- **vite-plugin**: `loadSystem()` simplified — calls NAPI, removes subprocess script construction, tmpfile I/O, and `execSubprocess` import for this path.
- **next-plugin**: Same simplification in `loadSystem()` / `runFullPipeline()`.
- **Performance**: Consistent ~6-12ms system load (eliminates cold-start variance — subprocess is bimodal 10-30ms depending on bun cache). Primary win is architectural: removes runtime coupling, eliminates subprocess infra, makes system loading testable in Rust.
- **Dependencies**: rquickjs 0.11 replaces boa_engine 0.21. Net: QuickJS (C library) instead of boa (pure Rust). Binary size similar. No new JS dependencies.

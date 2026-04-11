## Why

System module loading (ds.ts → config) currently requires a subprocess (`execSync` + bun/node) that each plugin implements independently. This creates bundler-specific coupling, subprocess availability requirements, and bimodal latency (cold: ~30ms, warm with bun cache: ~10ms). The Rust crate already owns parsing (OXC), type-stripping (oxc_transformer), import resolution, and JS evaluation (boa_engine) — system loading is the last pipeline phase that escapes to a subprocess.

## What Changes

- **Add rquickjs** (QuickJS Rust bindings) to the extraction crate for full ESM module execution
- **New NAPI function** `loadSystemModule(systemPath, rootDir)` that internalizes the complete load pipeline: read → OXC type-strip → resolve deps → rquickjs execute → extract config
- **New Rust module** `system_loader.rs` — OXC type-stripping for full modules (scaling up existing `strip_typescript()`), package.json exports resolution, pre-loaded rquickjs Resolver/Loader (HashMap-backed, no filesystem access from JS)
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

- **Rust crate**: New dependency (rquickjs 0.11), new module `system_loader.rs`, new NAPI export. Build time increase from QuickJS C compilation (~30s first build, cached after).
- **vite-plugin**: `loadSystem()` simplified — calls NAPI, removes subprocess script construction, tmpfile I/O, and `execSubprocess` import for this path.
- **next-plugin**: Same simplification in `loadSystem()` / `runFullPipeline()`.
- **Performance**: Consistent ~2-5ms system load (no cold/warm variance from subprocess caching). Eliminates process spawn, tmpfile I/O, and JSON serialization boundary.
- **Dependencies**: rquickjs 0.11 adds QuickJS (C library) to the NAPI binary. Binary size increase ~200-400KB. No new JS dependencies.

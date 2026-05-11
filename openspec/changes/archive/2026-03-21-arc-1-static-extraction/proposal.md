## Why

The Animus type-state machine guarantees a finite, enumerable universe of possible styles — but today every style is computed at runtime via Emotion. At production scale (~1,789 .tsx files at Blockworks), this means shipping the full Emotion runtime, lodash, and parsing CSS-in-JS on every page load. The builder chain's strict ordering (styles → variants → states → groups → props) maps directly to CSS `@layer` declarations, enabling deterministic static CSS extraction with zero specificity conflicts. No other CSS-in-JS framework can prove cascade completeness at compile time.

Arc 1 is the foundation: single-file extraction of static literal chains. A ground-truth census of the codebase shows ~19 chains (65%) are fully extractable without `.groups()`, `.extend()`, or `.asComponent()`. These include the most complex patterns: pseudo-selectors, responsive objects, multi-variant chains, and theme scale lookups.

## What Changes

- **New Rust crate** at `packages/extract/` composing OXC (parser/traverse), Lightning CSS (CSS gen), string_wizard (source replacement), and NAPI-RS (JS bridge). Single `extract()` function exported.
- **New Vite plugin** at `packages/vite-plugin/` (~30 lines). Calls the Rust crate's `extract()` on each file during production builds. Evaluates the theme module at build start and serializes scale maps for Rust.
- **New runtime shim** at `packages/runtime/` (~500 bytes gzipped). `createComponent(tag, className, config)` — className concatenation, variant/state prop toggling, ref forwarding. Replaces Emotion+lodash for extracted components.
- **Static CSS output** using shared `@layer` declarations: `base, variants, states, system, custom`. All components inject into the same layer set.
- **Bail-to-Emotion fallback**: chains containing `.groups()`, `.extend()`, `.asComponent()`, `.props()`, template literals with expressions, or function values are left untouched. The extraction report identifies what extracted and what didn't.

## Capabilities

### New Capabilities
- `rust-extraction-pipeline`: Rust crate that parses TS/TSX via OXC, walks builder chains backwards from terminals, evaluates static style objects, resolves theme scales, generates @layer CSS, and replaces source with runtime shim imports. Exposed via single NAPI function.
- `vite-extraction-plugin`: Vite plugin that orchestrates the extraction pipeline — evaluates theme at build start, calls Rust extract on each file in transform hook, emits CSS, returns transformed JS. Production-only (`apply: 'build'`).
- `extraction-runtime-shim`: Minimal React component factory that applies extracted className + handles variant/state prop toggling at runtime. Replaces Emotion's styled() for extracted components.

### Modified Capabilities
_(none — the builder chain API, extension system, and prop system are unchanged. Extraction is additive.)_

## Impact

- **New packages**: `@animus-ui/extract` (Rust/NAPI), `@animus-ui/vite-plugin`, `@animus-ui/runtime`
- **New dependencies**: Rust toolchain (cargo, rustc), napi-rs CLI for cross-platform builds
- **CI**: GitHub Actions matrix build for platform binaries (darwin-arm64, linux-x64-gnu, win32-x64-msvc)
- **No changes** to `@animus-ui/core`, `@animus-ui/theming`, or `@animus-ui/components`
- **Dev mode unchanged**: Emotion runtime continues to work as-is. Extraction is production-only.
- **Existing tests unaffected**: Core/integration tests remain valid. One new canary integration test per arc (source file in → CSS + transformed JS out).

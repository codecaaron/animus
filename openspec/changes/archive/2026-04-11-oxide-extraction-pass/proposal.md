## Why

The Rust extraction crate leaves measurable performance on the table and fails to extract provably-static style values. Every `HashMap` uses SipHash (cryptographic, slow for string keys). Phase 1 parses files sequentially despite zero cross-file dependencies. And the style evaluator bails on ALL identifiers — meaning `const GAP = 16; styles({ gap: GAP })` skips the property even though the value is provably static. These are independent improvements that share a blast radius (Rust crate internals, no contract changes) and can ship together.

## What Changes

### Performance primitives
- Replace all `std::collections::HashMap` / `HashSet` with `FxHashMap` / `FxHashSet` from `rustc-hash`. All ~200+ instances are string-keyed — ideal for non-cryptographic hashing.
- Add `rayon` for Phase 1 parallel file parsing. Each file gets its own `oxc_allocator::Allocator` with no cross-file reads — embarrassingly parallel. Restructure the cache-lock pattern to hold the mutex only for cache hits, then `par_iter` over cache misses.
- Add Linux `[target.x86_64-unknown-linux-gnu]` linker flag (`-Wl,-z,nodelete`) to `.cargo/config.toml` to prevent NAPI worker-thread-unload segfault on Linux targets.

### Semantic const/import resolution
- Run `oxc_semantic::SemanticBuilder` per file during Phase 1 to produce a symbol table and scope tree.
- Enhance `style_evaluator` to resolve `Expression::Identifier` nodes: look up the symbol → find declaration → recursively evaluate the init expression.
- **Tier 1 — Intra-file const**: `const GAP = 16; styles({ gap: GAP })` → follow symbol to declaration → evaluate `16` → extract.
- **Tier 2 — Intra-file object reference**: `const config = { gap: 16 }; styles(config)` → follow identifier to ObjectExpression → evaluate it.
- **Tier 3 — Cross-file const/object**: Build a static export map during Phase 1 (`(file, export_name) → Value`). When evaluator hits an imported identifier, look up via existing binding resolution + export map.
- **Explicit exclusion**: Object spreads (`{ ...baseConfig }`) continue to bail gracefully. Spread semantics require full object merge which is outside scope.

## Capabilities

### New Capabilities
- `semantic-const-resolution`: Static resolution of identifier references in style evaluation via oxc_semantic symbol tables, covering intra-file const, intra-file object, and cross-file imported values.

### Modified Capabilities
- `extract-pipeline`: Performance characteristics change (FxHashMap, parallel Phase 1) but no behavioral contract changes.

## Impact

- **Crate dependencies**: Add `rustc-hash`, `rayon`. `oxc_semantic` already present (used by transform_extractor for TS stripping).
- **Binary size**: Small increase from rayon thread pool (~200KB). rustc-hash is negligible.
- **Files modified**: `Cargo.toml`, `.cargo/config.toml`, `project_analyzer.rs`, `style_evaluator.rs`, `theme_resolver.rs`, `css_generator.rs`, `lib.rs`, `jsx_scanner.rs`, `chain_walker.rs`, `import_resolver.rs`, `transform_emitter.rs`, `chain_merger.rs`, `reconciler.rs` (HashMap swap touches all files).
- **No plugin changes**: All changes contained within Rust crate. No NAPI signature changes. No manifest schema changes.
- **Test impact**: Existing tests continue to pass. New tests for semantic resolution tiers. Some existing "skipped property" tests may now succeed (properties that were previously non-static become extractable).

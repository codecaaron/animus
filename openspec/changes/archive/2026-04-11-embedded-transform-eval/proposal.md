## Why

The subprocess-elimination work removed 2 of 3 build subprocesses but introduced a bin file post-processor: Rust emits `__TRANSFORM__size__0.5__` placeholders in CSS, the plugin writes a zero-dep CJS file with extracted transform sources, and `execSync('node runner.js')` resolves placeholders via regex. This works but leaves ~15-30ms of subprocess overhead per buildStart/HMR reset, requires a `stripTs()` regex hack to remove TypeScript annotations from extracted source spans, and introduces the SPLIT_MARKER protocol to handle global + component CSS through a single bin file pass.

The root cause: transform callbacks are JavaScript functions that must be *executed* to produce CSS values, but the extraction pipeline runs in Rust. The bin file bridges this gap via IPC. An embedded JavaScript engine (boa_engine) eliminates this bridge entirely — transforms evaluate in-process during CSS generation.

Additionally, the oxc crates are pinned at 0.121.0 while 0.124.0 is available. The `oxc_transformer` crate provides proper AST-based TypeScript stripping (which `oxc_codegen` alone does NOT do — codegen faithfully round-trips TypeScript syntax). And Phase 1 of the project analyzer parses each file twice redundantly (once for chain walking, once for module info + transform extraction).

## What Changes

- Add `boa_engine` dependency to the extraction crate for in-process JavaScript evaluation
- Add `oxc_transformer`, `oxc_codegen`, and `oxc_semantic` dependencies for proper TS→JS pipeline
- Bump all existing oxc crates from 0.121.0 to 0.124.0 (`oxc_parser`, `oxc_ast`, `oxc_span`, `oxc_allocator`, `oxc_syntax`)
- Eliminate the `__TRANSFORM__` placeholder protocol in `theme_resolver.rs` — instead of emitting `__TRANSFORM__name__value__`, evaluate the transform function via boa and emit the resolved CSS value directly
- Remove bin file generation and `execSync` subprocess from `vite-plugin/src/index.ts`
- Remove bin file generation and `execSync` subprocess from `next-plugin/src/plugin.ts`
- Remove `stripTs()` regex from both plugins
- Remove the `SPLIT_MARKER` protocol from both plugins
- Remove `extracted_transforms` from the manifest JSON (transforms are consumed internally by Rust, not shipped to plugins)
- Consolidate Phase 1 parses in `project_analyzer.rs`: chain walking + module info + transform extraction from a single `Parser::new` call
- Modify `transform_extractor.rs` to emit pure JavaScript via oxc_transformer + oxc_codegen instead of raw TypeScript source spans

## Capabilities

### New Capabilities

- `embedded-js-eval`: In-process JavaScript evaluation of self-contained transform callbacks via boa_engine, replacing IPC-based transform resolution

### Modified Capabilities

- `named-transforms`: Transform source extraction emits pure JS (via oxc_transformer + oxc_codegen) and transforms are evaluated in Rust rather than shipped to plugins. The `extracted_transforms` manifest field is removed.
- `css-post-processing`: The `__TRANSFORM__` placeholder protocol and bin file post-processing step are eliminated. CSS emerges from Rust fully resolved.

## Impact

- **Rust crate** (`packages/extract`): New dependencies (boa_engine, oxc_transformer, oxc_codegen, oxc_semantic). Changes to theme_resolver.rs (inline eval instead of placeholder emission), transform_extractor.rs (TS→JS pipeline), project_analyzer.rs (boa context management, parse consolidation, removal of extracted_transforms from manifest).
- **Vite plugin** (`packages/vite-plugin`): Remove bin file generation, execSync, stripTs, SPLIT_MARKER. Simplify `runAnalysis` — CSS from Rust is final, no post-processing needed.
- **Next plugin** (`packages/next-plugin`): Same removals as vite-plugin.
- **Build**: Cargo.lock regenerates with new dependency tree. NAPI binary size increases (~4-5MB from boa_engine). Binary must be rebuilt.
- **Performance**: Eliminates ~15-30ms subprocess overhead per buildStart and HMR geological reset. Transform evaluation in boa is microseconds vs milliseconds for subprocess spawn.
- **No consumer-facing API changes**: `createTransform` API, self-contained constraint, and component authoring are all unchanged.

## 1. FxHashMap Swap

- [x] 1.1 Add `rustc-hash` dependency to `Cargo.toml`
- [x] 1.2 Create type alias imports in `theme_resolver.rs` — change `PropConfigMap`, `FlatTheme`, `VariableMap`, `ContextualVarsMap`, `SelectorAliasesMap` and any other type aliases from `HashMap` to `FxHashMap`
- [x] 1.3 Swap `HashMap`/`HashSet` imports to `FxHashMap`/`FxHashSet` across all source files: `project_analyzer.rs`, `css_generator.rs`, `jsx_scanner.rs`, `chain_walker.rs`, `import_resolver.rs`, `transform_emitter.rs`, `chain_merger.rs`, `reconciler.rs`, `lib.rs`, `style_evaluator.rs`, `transform_extractor.rs`
- [x] 1.4 Update NAPI-exported struct fields that use `HashMap` in public signatures (check `UniverseManifest`, `ExtractionResult`, etc.) — these must remain `HashMap` for serde compatibility or switch to `FxHashMap` with serde support
- [x] 1.5 Verify: `cargo build --release` compiles cleanly, `bun run test:canary` passes

## 2. Linux Linker Flag

- [x] 2.1 Add `[target.x86_64-unknown-linux-gnu]` and `[target.aarch64-unknown-linux-gnu]` sections to `.cargo/config.toml` with `rustflags = ["-C", "link-arg=-Wl,-z,nodelete"]`

## 3. Rayon Phase 1 Parallelization

- [x] 3.1 Add `rayon` dependency to `Cargo.toml`
- [x] 3.2 Define a `FileParseResult` struct to hold per-file Phase 1 output: chains, module_info, extracted_transforms
- [x] 3.3 Restructure Phase 1: extract cache-hit loop (sequential under lock) into its own block that collects cache-miss file references into a Vec
- [x] 3.4 Add parallel cache-miss processing: `cache_misses.par_iter()` with per-file `Allocator` + parse + walk_chains + parse_module_info + extract_transforms, collecting into `Vec<FileParseResult>`
- [x] 3.5 Sequential merge: iterate `Vec<FileParseResult>` and insert into `all_chains`, `file_modules`, `transforms_by_file`, `all_extracted_transforms`
- [x] 3.6 Verify: `cargo build --release` compiles, `bun run test:canary` passes, no data races

## 4. Static Value Map — Phase 1 Collection

- [x] 4.1 Create `collect_static_values` function: walks `program.body` for top-level `const` VariableDeclarations, evaluates init expressions via `eval_expression`/`eval_object_expr`, returns `FxHashMap<String, Value>`
- [x] 4.2 Create `collect_static_exports` function: given a file's `FileModuleInfo` exports and its static_values map, returns the subset of values that are exported (mapping export_name → Value)
- [x] 4.3 Wire into Phase 1 cache-miss path: after parse + walk + module_info, call `collect_static_values` on the program, call `collect_static_exports`, store both maps per-file
- [x] 4.4 Add static_values and static_exports to `FileParseResult` and to the file cache (`CachedFileResult`)
- [x] 4.5 Accumulate `static_exports_by_file: FxHashMap<String, FxHashMap<String, Value>>` across all files (cache hits + misses)

## 5. Static Value Map — Cross-File Resolution

- [x] 5.1 After Phase 2 binding resolution, build per-file `resolved_static_values` maps: for each file, start with its own `static_values`, then for each import, look up `binding_map → (source_file, export_name) → static_exports_by_file[source_file][export_name]`, insert as `local_name → Value`
- [x] 5.2 Handle re-exports: if a binding resolves through multiple files, follow the chain (existing `resolve_bindings` already handles this — just look up the final resolved file's export map)

## 6. Identifier Resolution in Style Evaluator

- [x] 6.1 Add `static_values: Option<&FxHashMap<String, Value>>` parameter to `eval_expression`
- [x] 6.2 Change the `Expression::Identifier` arm: if `static_values` is provided, look up `ident.name` in the map. On hit, return `Ok(value.clone())`. On miss, fall through to existing `Err(BailError)`
- [x] 6.3 Thread `static_values` through `eval_object_expr` → `eval_expression` call chain (all internal calls pass the map through)
- [x] 6.4 Thread `static_values` through `eval_array_element` if it evaluates expressions

## 7. Object Reference Resolution

- [x] 7.1 Update `parse_object_from_source` to accept `static_values: Option<&FxHashMap<String, Value>>` and pass through to eval calls
- [x] 7.2 Add Identifier fallback path in `parse_object_from_source`: when the parsed expression is an Identifier (not an ObjectExpression), look up in static_values. If `Value::Object`, return it. Otherwise error.
- [x] 7.3 Update `parse_variant_from_source`, `parse_compound_from_source`, and any other `parse_*_from_source` functions to accept and pass through `static_values`
- [x] 7.4 Update `process_chain` to receive and pass `static_values` to all parse helpers

## 8. Threading Through Pipeline

- [x] 8.1 Add `static_values` field to `ProcessingContext` or pass as separate parameter to `process_chain`
- [x] 8.2 Update `project_analyzer.rs` Phase 5 loop: look up the file's `resolved_static_values` and pass to `process_chain`
- [x] 8.3 Update per-file `extract()` in `lib.rs`: build static_values from the single file's AST, pass to `process_chain` (per-file mode has no cross-file resolution)
- [x] 8.4 Update `css_generator.rs` test helpers if they construct `ProcessingContext`

## 9. Tests and Verification

- [x] 9.1 Add unit test: intra-file numeric const resolution (`const GAP = 16; styles({ gap: GAP })`)
- [x] 9.2 Add unit test: intra-file string const resolution (`const COLOR = 'red'; styles({ color: COLOR })`)
- [x] 9.3 Add unit test: non-static const skips gracefully (`const val = getSpacing(); styles({ gap: val })`)
- [x] 9.4 Add unit test: `let` declaration not resolved (mutable, skips)
- [x] 9.5 Add unit test: object reference as styles argument (`const config = { gap: 16 }; styles(config)`)
- [x] 9.6 Add unit test: cross-file imported const resolution (requires multi-file test via `analyze_project`)
- [x] 9.7 Add canary test fixture exercising const/import resolution patterns
- [x] 9.8 Run `bun run verify` — all 228+ Rust tests + 455+ JS tests green
- [x] 9.9 Run `bun run verify:showcase` — showcase builds with fully resolved CSS

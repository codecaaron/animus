## 1. Dependency Setup

- [ ] 1.1 Bump all 5 existing oxc crate versions in `Cargo.toml` from `0.121.0` to `0.124.0`
- [ ] 1.2 Add `oxc_transformer = "0.124.0"`, `oxc_codegen = "0.124.0"`, `oxc_semantic = "0.124.0"` to `[dependencies]`
- [ ] 1.3 Add `boa_engine = "0.21"` to `[dependencies]`
- [ ] 1.4 Run `cargo build` to regenerate `Cargo.lock` and verify compilation

## 2. TS→JS Pipeline in Transform Extractor

- [ ] 2.1 Add oxc_transformer + oxc_codegen + oxc_semantic imports to `transform_extractor.rs`
- [ ] 2.2 Modify `extract_transforms` to accept `&Program` and `&Allocator` (needed for transformer)
- [ ] 2.3 After extracting callback span, run: SemanticBuilder → Transformer (TypeScript options) → Codegen `print_expression` on the TS-free callback node. Store the resulting JS string as `ExtractedTransform.source` instead of raw `source[span.start..span.end]`
- [ ] 2.4 Verify Rust tests pass: `cargo test`

## 3. Boa Engine Integration

- [ ] 3.1 Create `transform_evaluator.rs` module: function to create a boa `Context`, register transform functions by name, and evaluate `transform(value)` calls
- [ ] 3.2 In `project_analyzer.rs`: after collecting all `extracted_transforms`, create a boa Context and register each valid transform's JS source into it
- [ ] 3.3 Add the boa Context (or a wrapper) to `ResolveContext` so `theme_resolver` can access it
- [ ] 3.4 In `theme_resolver.rs` line ~512: replace `format!("__TRANSFORM__{}__{}__", ...)` with a call to the boa evaluator that returns the resolved CSS value directly
- [ ] 3.5 Handle evaluation errors: if boa throws, fall back to the raw value and emit a diagnostic
- [ ] 3.6 Verify Rust tests pass: `cargo test`

## 4. Manifest and Plugin Cleanup

- [ ] 4.1 Remove `extracted_transforms` field from `UniverseManifest` serialization (transforms consumed internally)
- [ ] 4.2 Remove `hasTransforms` / `extractedTransforms` handling from `vite-plugin/src/index.ts` — remove bin file generation, execSync, stripTs, SPLIT_MARKER, tmpdir imports
- [ ] 4.3 Remove same from `next-plugin/src/plugin.ts` — remove bin file generation, execSync, stripTs, SPLIT_MARKER
- [ ] 4.4 Simplify `runAnalysis` in both plugins: CSS from manifest is final, no post-processing branch needed

## 5. Parse Consolidation

- [ ] 5.1 Extract parsing from `walk_chains` into a `walk_chains_from_program(&Program, &str)` variant that accepts an already-parsed program
- [ ] 5.2 In `project_analyzer.rs` Phase 1 loop: parse once, pass `&program` to `walk_chains_from_program`, `parse_module_info`, and `extract_transforms`
- [ ] 5.3 Remove the second `Allocator::default()` + `Parser::new` at line 329-331
- [ ] 5.4 Verify Rust tests pass: `cargo test`

## 6. Verification

- [ ] 6.1 Build NAPI binary: `bun run build:extract`
- [ ] 6.2 Run canary tests: `bun run test:canary`
- [ ] 6.3 Run full verification: `bun run verify`
- [ ] 6.4 Build showcase: `bun run verify:showcase`
- [ ] 6.5 Verify dev server: transforms resolve correctly in initial load and HMR re-analysis
- [ ] 6.6 Verify no `__TRANSFORM__` placeholders appear in generated CSS
- [ ] 6.7 Verify no bin file subprocess spawns during buildStart (check for execSync calls)
- [ ] 6.8 Measure binary size delta (expect ~4-5MB increase from boa)

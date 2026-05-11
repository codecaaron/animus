# Tasks: rust-system-loader

## Phase 1: Replace boa with rquickjs

- [x] Replace `boa_engine = "0.21"` with `rquickjs = { version = "0.11", features = ["bindgen", "loader"] }` in `packages/extract/Cargo.toml`
- [x] Rewrite `transform_evaluator.rs` — same API (`register()`, `evaluate()`), backed by `rquickjs::Context` instead of `boa_engine::Context`. Use `Context::with(|ctx| ctx.eval(...))` for expression evaluation.
- [x] Verify existing transform tests pass: `register_and_eval_simple`, `register_fails_on_invalid_js`, `eval_with_string_value`, `eval_size_transform`
- [x] Remove all `boa_engine` imports from the crate

## Phase 2: Full-module OXC type stripping

- [x] Add `pub fn strip_typescript_module(source: &str, file_path: &str) -> Result<String, String>` to `system_loader.rs` — parse as full module (not expression-wrapped), run `oxc_transformer::Transformer`, codegen complete program
- [x] Unit test: strip a TS module with `import`, `export const`, `declare module`, type annotations → verify runtime semantics preserved, `declare module` blocks removed, exports intact

## Phase 3: Package.json dependency resolution

- [x] Implement `resolve_bare_specifier(specifier, root_dir) -> Result<String>` — find `node_modules/<pkg>/package.json`, follow resolution chain: `exports` map (subpath + `import` condition with nested object support) → `module` field → `main` field
- [x] Implement extension probing for relative imports: try `.ts`, `.tsx`, `.js`, `.mjs`, `/index.ts`, `/index.js`
- [x] Implement `resolve_all_deps(system_path, root_dir) -> Result<(HashMap<String, String>, HashMap<String, String>)>` — returns (specifier_map for Resolver, source_map for Loader). Recursively parses ALL resolved files (including pre-built .mjs) for their own imports, deduplicates by canonical path.
- [x] Unit test: resolve `@animus-ui/system` → correct dist path (has `exports` field)
- [x] Unit test: resolve `@animus-ui/system/groups` → correct subpath dist path
- [x] Unit test: resolve `@animus-ui/test-ds` → correct dist path (no `exports`, falls back to `module`/`main`)
- [x] Unit test: resolve with nested condition objects in exports (e.g. `{ "import": "...", "default": "..." }`)
- [x] Unit test: transitive dep — test-ds dist imports @animus-ui/system → both appear in source_map

## Phase 4: Bundled eval execution (replaced Module API approach)

- [x] Implement `rewrite_module_for_bundle()` — OXC parse, span-based import→`__require()`/export→`__exports` rewriting
- [x] Implement `collect_declaration_export_names()` / `collect_binding_names()` — handle `export const`, destructuring patterns
- [x] Implement `topological_sort()` — Kahn's algorithm on dependency graph, deps execute before dependents
- [x] Implement `build_bundle()` — stub modules + topo-sorted IIFEs + `__modules`/`__require` registry
- [x] Implement `execute_bundle()` — `ctx.eval()` + extract from `__modules` registry via `extract_system_config`
- [x] Implement export extraction: find SystemInstance (export with `.toConfig()`, or by `exportName` param), theme (`tokens`/`theme` with `.serialize()`), GlobalStyleBlock exports (`__brand === 'GlobalStyleBlock'`)
- [x] Wire complete pipeline: `load_system_module(system_path, root_dir, export_name?) -> SystemConfig` — read → strip → resolve deps → bundle → eval → extract
- [x] Integration test: load showcase ds.ts → verify SystemConfig has non-empty propConfig, scalesJson, variableCss

## Phase 5: NAPI export

- [x] Define `NapiSystemConfig` struct with `#[napi(object)]`
- [x] Add `#[napi] pub fn load_system_module(system_path: String, root_dir: String, export_name: Option<String>) -> napi::Result<NapiSystemConfig>` to `lib.rs`
- [x] Build: `napi build --platform` succeeds
- [x] Canary test: call `loadSystemModule()` from JS with showcase ds.ts → verify returned object shape matches (9066b propConfig, 10416b scalesJson, 17873b variableCss)

## Phase 6: Plugin integration — vite-plugin

- [x] Update `loadSystem()`: replace subprocess with `const { loadSystemModule } = require('@animus-ui/extract'); const config = loadSystemModule(resolvedSystemPath, rootDir);`
- [x] Map SystemConfig fields: `configJson = config.propConfig`, `themeJson = config.scalesJson`, `variableMapJson = config.variableMapJson`, `variableCss = config.variableCss`, `contextualVarsJson = config.contextualVarsJson`, `selectorAliasesJson = config.selectorAliases`, `selectorOrderJson = config.selectorOrder`, `globalStyleBlocksJson = config.globalStyleBlocks`
- [x] Remove `execSubprocess` import from system loading path (also removed `unlinkSync`, `tmpdir`)
- [x] Verify: `ANIMUS_DEBUG=1 bun run --filter './packages/showcase' build` — 9ms system-load, 194/200 extracted, 143401 bytes CSS, build in 517ms

## Phase 7: Plugin integration — next-plugin

- [x] Update system loading in next-plugin: replace subprocess with `loadSystemModule()` call
- [x] Map SystemConfig fields to existing plugin variables (with prefix support preserved)
- [x] Remove `execSubprocess`, `unlinkSync`, `tmpdir` imports
- [x] Verify next-plugin build succeeds

## Phase 8: Verification

- [x] `bun run verify` — 455 tests pass, 4 pre-existing biome lint warnings (not regressions)
- [x] `bun run verify:showcase` — showcase builds: 194/200 components, 143401 bytes CSS
- [x] Timing: `ANIMUS_DEBUG=1` shows system-load at 9ms (release build avg: 9.61ms)
- [x] No subprocess spawned for system loading (grep for execSubprocess: zero results in both plugins)
- [x] `bun run test:canary` — 192 canary tests pass
- [x] `cargo test` — 245 Rust tests pass (including load_showcase_ds integration test)

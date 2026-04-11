# Tasks: rust-system-loader

## Phase 1: Rust crate — rquickjs integration + module type stripping

- [ ] Add `rquickjs = { version = "0.11", features = ["bindgen", "loader", "classes"] }` to `packages/extract/Cargo.toml`
- [ ] Create `src/system_loader.rs` — module skeleton with `pub fn load_system_module()` signature returning `SystemConfig` struct
- [ ] Define `SystemConfig` struct with `#[napi(object)]` — fields: prop_config, group_registry, scales_json, variable_map_json, variable_css, contextual_vars_json, selector_aliases (Option), selector_order (Option), global_style_blocks (Option)
- [ ] Implement `strip_typescript_module(source, file_path)` — full-module OXC type stripping (parse → Transformer → Codegen on complete Program, not the expression-wrapping pattern from transform_extractor.rs)
- [ ] Add unit test: type-strip a TS module with imports/exports/type annotations → verify runtime semantics preserved

## Phase 2: Rust crate — dependency resolution

- [ ] Implement `resolve_package_json_export(package_dir, subpath)` — read package.json, follow `exports` map with `import` condition, return resolved file path
- [ ] Implement `resolve_system_deps(system_path, root_dir)` — read system file, OXC parse for import declarations, resolve each specifier (bare → package.json exports, relative → file path with extension probing), recurse into deps, return `HashMap<canonical_path, processed_source>`
- [ ] Handle extension probing: try `.ts`, `.tsx`, `.js`, `.mjs`, `/index.ts`, `/index.js` in order
- [ ] Add unit test: resolve bare specifier `@animus-ui/system` → correct dist file path
- [ ] Add unit test: resolve subpath `@animus-ui/system/groups` → correct dist file path
- [ ] Add unit test: resolve relative import `./utils` with extension probing

## Phase 3: Rust crate — rquickjs execution

- [ ] Implement `AnimusResolver` struct (implements rquickjs `Resolver` trait) — HashMap lookup from canonical specifier to canonical path
- [ ] Implement `AnimusLoader` struct (implements rquickjs `Loader` trait) — HashMap lookup from canonical path to pre-processed source, returns `Module::declare()`
- [ ] Implement `execute_system_module()` — create rquickjs Runtime + Context with AnimusResolver + AnimusLoader, evaluate the system module, run jobs to completion
- [ ] Implement export extraction: traverse module namespace to find SystemInstance (export with `.toConfig()`), theme (export named `tokens` or `theme` with `.serialize()`), GlobalStyleBlock exports (objects with `__brand === 'GlobalStyleBlock'`)
- [ ] Implement config extraction: call `.toConfig()` → extract propConfig/groupRegistry/selectorAliases/selectorOrder strings; call `.serialize()` → extract scalesJson/variableMapJson/variableCss/contextualVarsJson strings
- [ ] Wire `load_system_module()` as a complete pipeline: read file → strip types → resolve deps → execute → extract config → return SystemConfig
- [ ] Add integration test: load the showcase's ds.ts → verify SystemConfig has non-empty propConfig and scalesJson

## Phase 4: NAPI export

- [ ] Add `#[napi] pub fn load_system_module(system_path: String, root_dir: String) -> napi::Result<SystemConfig>` to `lib.rs`
- [ ] Build and verify: `napi build --platform` succeeds, function is callable from JS
- [ ] Add canary test: call loadSystemModule from JS with showcase ds.ts path → verify returned object shape

## Phase 5: Plugin integration — vite-plugin

- [ ] Update `loadSystem()` in vite-plugin: replace `execSubprocess` script + tmpfile I/O with `const { loadSystemModule } = require('@animus-ui/extract'); const config = loadSystemModule(resolvedSystemPath, rootDir);`
- [ ] Map SystemConfig fields to existing plugin variables: `configJson = config.propConfig`, `themeJson = config.scalesJson`, etc.
- [ ] Remove `execSubprocess` import if no longer used elsewhere in the file
- [ ] Verify: `ANIMUS_DEBUG=1 bun run --filter './packages/showcase' build` — timing waterfall shows system-load, extraction succeeds, CSS output matches baseline

## Phase 6: Plugin integration — next-plugin

- [ ] Update system loading in next-plugin: replace subprocess path with `loadSystemModule()` call
- [ ] Map SystemConfig fields to existing plugin variables
- [ ] Verify: next-plugin build succeeds with loadSystemModule

## Phase 7: Verification

- [ ] Run `bun run verify` — all tests pass, biome check clean
- [ ] Run `bun run verify:showcase` — showcase builds with correct CSS output
- [ ] Compare timing: `ANIMUS_DEBUG=1` builds show system-load consistently < 10ms with no cold/warm variance
- [ ] Verify no subprocess is spawned for system loading (grep for execSubprocess usage)

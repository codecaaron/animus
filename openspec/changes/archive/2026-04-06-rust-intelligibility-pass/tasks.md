## 1. ResolveContext struct

- [x] 1.1 Define `ResolveContext<'a>` struct in theme_resolver.rs with fields: config, theme, variable_map, contextual_vars, breakpoint_keys, selector_aliases
- [x] 1.2 Update `resolve_styles` signature to `(styles: &Value, ctx: &ResolveContext, auto_content: bool) -> ResolvedStyles`
- [x] 1.3 Update `resolve_flat_styles` internal calls to use ctx fields (called from within resolve_styles for nested/pseudo blocks)
- [x] 1.4 Add test helper function (e.g. `test_resolve_context()`) to reduce boilerplate in ~17 test call sites
- [x] 1.5 Update all test calls in theme_resolver.rs to use ResolveContext

## 2. ProcessingContext struct

- [x] 2.1 Define `ProcessingContext<'a>` struct in lib.rs with fields: resolve (ResolveContext ref), group_registry, class_prefix
- [x] 2.2 Update `process_chain` signature to `(chain, source, filename, ctx: &ProcessingContext) -> Result<...>`
- [x] 2.3 Update 5 resolve_styles calls within process_chain to use `ctx.resolve`

## 3. Entry point context construction

- [x] 3.1 Update `extract()` in lib.rs to construct ResolveContext + ProcessingContext from deserialized params, pass to process_chain
- [x] 3.2 Update `analyze()` in project_analyzer.rs to construct ResolveContext + ProcessingContext, pass to process_chain call at line ~472

## 4. css_generator.rs call site

- [x] 4.1 Update utility CSS generation function signatures to accept `&ResolveContext` instead of individual params
- [x] 4.2 Update the resolve_styles call at css_generator.rs:638 to use ctx
- [x] 4.3 Update callers in project_analyzer.rs that pass individual params to utility/custom CSS generation

## 5. Verification

- [x] 5.1 Run `cargo test` — all 196 tests pass
- [x] 5.2 Run `bun run verify` — full TS build + test suite passes (biome formatting errors are pre-existing, not from this change)
- [x] 5.3 Run `bun run verify:showcase` — extraction pipeline produces correct output end-to-end

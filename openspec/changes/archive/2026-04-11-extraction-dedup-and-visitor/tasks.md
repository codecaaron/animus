## 1. Span Extraction Macro (chain_walker.rs)

- [x] 1.1 Add `get_arg_span!` macro definition above `first_arg_span` and `second_arg_span_fn` — 12 `Argument::*` arms mapping to `.span` with a `$fallback` parameter
- [x] 1.2 Replace `first_arg_span` body with `get_arg_span!` invocation
- [x] 1.3 Replace `second_arg_span_fn` body with `get_arg_span!` invocation
- [x] 1.4 Run `cargo test -p animus-extract` — chain_walker tests must pass unchanged

## 2. Test Data Macros

- [x] 2.1 Add `map!{}` macro to jsx_scanner.rs `#[cfg(test)]` module — produces `FxHashMap<String, _>` from `key => value` pairs
- [x] 2.2 Add `set![]` macro to jsx_scanner.rs `#[cfg(test)]` module — produces `FxHashSet<String>` from string values
- [x] 2.3 Refactor jsx_scanner.rs test setup code to use `map!{}`/`set![]` where beneficial (multi-insert chains, `box_with_props` helper)
- [x] 2.4 Add `map!{}`/`set![]` macros to theme_resolver.rs `#[cfg(test)]` module and refactor test data construction
- [x] 2.5 Run `cargo test -p animus-extract` — all tests must pass unchanged

## 3. Visit Trait Migration — Dependencies

- [x] 3.1 Add `oxc_ast_visit = "0.124.0"` to Cargo.toml `[dependencies]`
- [x] 3.2 Add `use oxc_ast_visit::Visit;` import to jsx_scanner.rs — verify compilation

## 4. Visit Trait Migration — SystemPropScanner

- [x] 4.1 Define `SystemPropScanner` struct holding `component_props`, `member_expr_bindings`, `seen`, `dynamic_seen`, `results`, `dynamic_results`
- [x] 4.2 Implement `Visit<'a>` for `SystemPropScanner` — override `visit_jsx_opening_element` to call existing `collect_from_jsx_opening` logic, delegate child walking to trait default
- [x] 4.3 Update `scan_jsx()` entry point to construct `SystemPropScanner`, call `visitor.visit_program(program)`, return results from struct
- [x] 4.4 Delete manual walker functions: `collect_from_statement`, `collect_from_expression`, `collect_from_jsx_child`, `collect_from_jsx_expression`
- [x] 4.5 Run `cargo test -p animus-extract` — all jsx_scanner tests must pass unchanged

## 5. Visit Trait Migration — UsageScanner

- [x] 5.1 Define `UsageScanner` struct holding `component_props`, `component_configs`, `member_expr_bindings`, `seen`, `result`
- [x] 5.2 Implement `Visit<'a>` for `UsageScanner` — override `visit_jsx_opening_element` (usage-specific JSX logic); `visit_object_expression` override not needed (trait default walks property values automatically)
- [x] 5.3 Update `scan_jsx_usage()` entry point to construct `UsageScanner`, call `visitor.visit_program(program)`, return results from struct
- [x] 5.4 Delete manual walker functions: `collect_usage_from_statement`, `collect_usage_from_expression`, `collect_usage_from_jsx_child`, `collect_usage_from_jsx_expression`
- [x] 5.5 Run `cargo test -p animus-extract` — all usage scanner tests must pass unchanged

## 6. Full Verification

- [x] 6.1 Run `cargo test -p animus-extract` — all 236+ Rust tests green
- [x] 6.2 Run `bun run test:canary` — all 192 canary tests green
- [x] 6.3 Run `bun run verify:showcase` — showcase build succeeds with identical output

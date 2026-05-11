## Why

The Rust extraction crate has accumulated structural duplication across three areas: identical 12-arm match blocks in chain_walker.rs, verbose HashMap/HashSet construction in test modules, and ~550 lines of hand-rolled AST recursive descent in jsx_scanner.rs that duplicates what oxc_ast_visit provides as a trait. Cleaning these up reduces maintenance surface, makes the scanner logic easier to audit, and aligns with idiomatic oxc usage for forward-looking AST traversal.

## What Changes

- **`get_arg_span!` macro** in chain_walker.rs: Collapses two identical `Argument::*` → `.span` match blocks (lines 315–350) into a single declarative macro. `first_arg_span` and `second_arg_span_fn` become one-line macro invocations.
- **`map!{}`/`set!{}` test macros**: FxHashMap/FxHashSet construction macros scoped to `#[cfg(test)]` modules. Replaces multi-line `::default()` + `.insert()` chains with declarative literals in jsx_scanner.rs and theme_resolver.rs tests.
- **Visit trait migration** in jsx_scanner.rs: Replaces manual `collect_from_statement`/`collect_from_expression`/`collect_from_jsx_child`/`collect_from_jsx_expression` and their `collect_usage_from_*` counterparts with two visitor structs implementing `oxc_ast_visit::Visit`. Each struct overrides only the JSX-relevant visit methods; the trait handles all recursive descent automatically. Compose walker (`collect_compose_from_statement`) is left unchanged — it has a different structure (top-level-only scan, no JSX recursion).
- **`oxc_ast_visit = "0.124.0"`** added as a direct dependency (already present as transitive via oxc_transformer).

## Capabilities

### New Capabilities
- `oxc-visitor-scanning`: Behavioral invariant spec for the Visit trait migration — extraction output must remain identical, visitor structs must carry equivalent state to current function parameter lists.

### Modified Capabilities

_None. All changes are internal refactoring with no spec-level behavior modifications._

## Impact

- **Code**: `chain_walker.rs` (macro addition, ~30 lines saved), `jsx_scanner.rs` (major restructure, ~500 lines reduced), test modules in `jsx_scanner.rs` and `theme_resolver.rs` (macro adoption)
- **Dependencies**: `oxc_ast_visit = "0.124.0"` added to Cargo.toml (already in dependency tree as transitive)
- **Risk**: The Visit migration is the highest-risk item — incorrect visitor override could miss JSX elements in nested contexts. Mitigated by existing 192 canary tests + jsx_scanner unit tests which verify exact extraction output.
- **Non-goals**: No chain_walker.rs Visit migration (backward-walking model is incompatible with forward Visit traversal). No functional changes to extraction output.

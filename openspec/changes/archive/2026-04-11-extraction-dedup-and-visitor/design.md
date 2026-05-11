## Context

The Rust extraction crate (`packages/extract/src/`) contains three forms of structural duplication:

1. **chain_walker.rs** has two functions (`first_arg_span` at line 334, `second_arg_span_fn` at line 315) with byte-for-byte identical 12-arm match statements extracting `.span` from `Argument::*` variants.

2. **Test modules** across jsx_scanner.rs and theme_resolver.rs construct FxHashMap/FxHashSet test data via multi-line `::default()` + `.insert()` chains — verbose and hard to scan.

3. **jsx_scanner.rs** (2506 lines) contains two parallel sets of manual AST walkers:
   - Set 1: `collect_from_statement` / `collect_from_expression` / `collect_from_jsx_child` / `collect_from_jsx_expression` (~310 lines, lines 76–449)
   - Set 2: `collect_usage_from_statement` / `collect_usage_from_expression` / `collect_usage_from_jsx_child` / `collect_usage_from_jsx_expression` (~380 lines, lines 680–1058)
   
   Both sets walk the same AST node types (Statement, Expression, JSXChild, JSXExpression) with the same match arms. They differ only in: (a) the context they carry, (b) what they do when they reach a JSXOpeningElement, and (c) Set 2 adds an ObjectExpression arm in expression walking.

   `oxc_ast_visit` v0.124.0 is already in the dependency tree (transitive via `oxc_transformer`). Its `Visit` trait provides automatic recursive descent with override points at every AST node type.

## Goals / Non-Goals

**Goals:**
- Eliminate the duplicated span-extraction match blocks via declarative macro
- Provide concise test data construction via `map!{}`/`set!{}` macros
- Replace ~690 lines of manual AST walking in jsx_scanner.rs with trait-driven visitor pattern
- Maintain byte-for-byte identical extraction output (pure refactor)

**Non-Goals:**
- Migrating chain_walker.rs to Visit (backward-walking model, incompatible with forward traversal)
- Migrating compose walker to Visit (different structure: top-level declaration scan only, no JSX recursion)
- Adding new extraction capabilities or changing scanner behavior
- Changing public API surface (`scan_jsx`, `scan_jsx_usage`, `scan_compose_families` signatures unchanged)

## Decisions

### Decision 1: `get_arg_span!` as declarative macro, not a function

The 12 `Argument::*` variants each have a `.span` field but share no common trait exposing it. A function would need to take `&Argument` and return `Span` — same match block, just moved. A `macro_rules!` macro inlines the match at each call site, producing zero-overhead identical code while maintaining a single source of truth.

Alternative considered: Implement a `HasSpan` trait for `Argument` variants — rejected because these are oxc types we don't own, and blanket trait impls on foreign types is forbidden by Rust's orphan rules.

### Decision 2: Two visitor structs, not one mode-switched struct

The two scanner passes carry different state:

| | SystemPropScanner (scan_jsx) | UsageScanner (scan_jsx_usage) |
|---|---|---|
| Shared state | `component_props`, `member_expr_bindings`, `seen` | `component_props`, `member_expr_bindings`, `seen` |
| Unique state | `dynamic_seen`, `results`, `dynamic_results` | `component_configs`, `result: UsageScanResult` |
| JSX logic | Evaluate attribute → Static/Dynamic/Skip | Evaluate attribute + check variant/state configs |
| Extra walking | — | `visit_object_expression` (component maps) |

A single struct with `enum ScanMode { SystemProps, Usage }` would need runtime branching in the hot path and hold unused fields. Two small structs are clearer: each declares exactly the state it needs, implements exactly the visit methods it uses.

Alternative considered: Generic visitor with trait-based strategy pattern — rejected as over-engineering for two concrete use cases.

### Decision 3: `map!{}`/`set!{}` using FxHashMap/FxHashSet

Session 63 swapped all internal HashMaps to FxHashMap. Test macros must produce FxHashMap/FxHashSet, not std types. The macros use `FxHashMap::default()` + `.insert()` internally (not `::from()` which doesn't exist for FxHashMap).

Alternative considered: Keeping test macros as std HashMap and converting — rejected because test code should use the same types as production code to catch type mismatches at compile time.

### Decision 4: Compose walker left as-is

`collect_compose_from_statement` (line 1492) and `collect_compose_from_expression` (line 1532) are NOT duplicated — they're a single pair that scans only top-level variable declarations for `compose()` / `composeWithContext()` calls. No JSX recursion, no parallel copy. No benefit from Visit migration.

## Risks / Trade-offs

- **[Risk] Visitor override misses nested JSX in edge cases** → Mitigated by 192 canary tests + 20+ jsx_scanner unit tests. The Visit trait's default implementations walk ALL children; we only need to override leaf handlers (visit_jsx_opening_element). If anything, the visitor will walk MORE thoroughly than our manual code.

- **[Risk] `oxc_ast_visit` Visit trait signature incompatible with mutable state accumulation** → Mitigated by verification: the trait uses `&mut self`, which is exactly what we need for accumulating results into vectors and sets on the struct.

- **[Trade-off] Macro debugging vs code clarity**: `get_arg_span!` is simple enough (single match expression) that macro expansion errors would be immediately obvious. The `map!{}`/`set!{}` macros are test-only, so debuggability impact is minimal.

- **[Trade-off] oxc_ast_visit as direct dependency**: Adds a crate to Cargo.toml but it's already compiled (transitive dependency). No new compilation cost.

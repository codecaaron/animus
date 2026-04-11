# oxc-visitor-scanning Specification

## Purpose
TBD - created by archiving change extraction-dedup-and-visitor. Update Purpose after archive.
## Requirements
### Requirement: Visitor-based JSX scanning preserves extraction equivalence
The Visit trait migration SHALL produce byte-for-byte identical extraction output compared to the manual walker implementation for all scanned files.

#### Scenario: System prop scanning equivalence
- **WHEN** `scan_jsx()` is called with any program AST containing JSX elements with system props
- **THEN** the returned `CustomPropScanResult` (both `static_usages` and `dynamic_usages`) SHALL be identical to the result produced by the pre-migration manual walker

#### Scenario: Usage scanning equivalence
- **WHEN** `scan_jsx_usage()` is called with any program AST containing JSX elements with variant, state, and system props
- **THEN** the returned `UsageScanResult` SHALL be identical to the result produced by the pre-migration manual walker

#### Scenario: Nested JSX in control flow
- **WHEN** JSX elements appear inside conditional expressions, logical expressions, arrow functions, function expressions, or call expression arguments
- **THEN** the visitor SHALL reach and process those JSX elements identically to the manual walker

#### Scenario: JSX in object expression values (usage scanner only)
- **WHEN** JSX elements appear inside object expression property values (e.g., component map patterns like `{ h1: (props) => <Heading {...props} /> }`)
- **THEN** the UsageScanner SHALL walk into those values and discover JSX usages, matching the manual walker's ObjectExpression arm

### Requirement: Visitor structs carry equivalent scanner state
Each visitor struct SHALL hold all state previously passed as function parameters to the manual walker functions.

#### Scenario: SystemPropScanner state
- **WHEN** `SystemPropScanner` is constructed for a `scan_jsx()` call
- **THEN** it SHALL hold references to `component_props`, `member_expr_bindings`, and own mutable `seen`, `dynamic_seen`, `results`, and `dynamic_results` fields

#### Scenario: UsageScanner state
- **WHEN** `UsageScanner` is constructed for a `scan_jsx_usage()` call
- **THEN** it SHALL hold references to `component_props`, `component_configs`, `member_expr_bindings`, and own mutable `seen` and `result` fields

### Requirement: Compose walker independence
The compose family scanner SHALL NOT be migrated to the Visit trait.

#### Scenario: Compose walker unchanged
- **WHEN** `scan_compose_families()` is called
- **THEN** it SHALL use the existing `collect_compose_from_statement` / `collect_compose_from_expression` implementation, not a visitor struct

### Requirement: Span extraction macro
`chain_walker.rs` SHALL define a `get_arg_span!` macro that extracts the `.span` from any `Argument` variant.

#### Scenario: First argument span extraction
- **WHEN** `first_arg_span()` is called on a `CallExpression` with arguments
- **THEN** it SHALL use `get_arg_span!` to extract the span, producing identical results to the pre-migration 12-arm match

#### Scenario: Second argument span extraction
- **WHEN** `second_arg_span_fn()` is called on a `CallExpression` with two or more arguments
- **THEN** it SHALL use `get_arg_span!` to extract the span, producing identical results to the pre-migration 12-arm match

### Requirement: Test data construction macros
Test modules SHALL define `map!{}` and `set!{}` macros for declarative FxHashMap/FxHashSet construction.

#### Scenario: Map macro produces FxHashMap
- **WHEN** `map!{ "key" => "value" }` is used in a test
- **THEN** it SHALL produce a `FxHashMap<String, _>` with string keys converted via `.to_string()`

#### Scenario: Set macro produces FxHashSet
- **WHEN** `set!["a", "b", "c"]` is used in a test
- **THEN** it SHALL produce a `FxHashSet<String>` with values converted via `.to_string()`


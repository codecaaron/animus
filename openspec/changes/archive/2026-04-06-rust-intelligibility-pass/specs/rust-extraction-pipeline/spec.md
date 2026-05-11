## ADDED Requirements

### Requirement: Shared resolution context struct
The extraction pipeline SHALL group shared immutable resolution parameters (config, theme, variable_map, contextual_vars, breakpoint_keys, selector_aliases) into a `ResolveContext<'a>` struct. `resolve_styles` SHALL accept this struct by reference instead of 6 individual parameters.

#### Scenario: resolve_styles signature
- **WHEN** `resolve_styles` is called from any call site (process_chain, css_generator, tests)
- **THEN** it SHALL accept exactly 3 parameters: `(styles: &Value, ctx: &ResolveContext, auto_content: bool)`

#### Scenario: Behavioral equivalence
- **WHEN** all 196 existing Rust tests are run after the refactor
- **THEN** every test SHALL pass without logic changes to test assertions or expectations

### Requirement: Processing context struct
The extraction pipeline SHALL group shared processing parameters (ResolveContext + group_registry + class_prefix) into a `ProcessingContext<'a>` struct. `process_chain` SHALL accept this struct by reference instead of individual parameters.

#### Scenario: process_chain signature
- **WHEN** `process_chain` is called from `extract()` or `analyze()`
- **THEN** it SHALL accept exactly 4 parameters: `(chain, source, filename, &ctx)`

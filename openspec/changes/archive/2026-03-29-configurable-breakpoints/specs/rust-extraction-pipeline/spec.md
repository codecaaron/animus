## MODIFIED Requirements

### Requirement: NAPI function signature
The Rust crate SHALL export THREE NAPI functions:
1. `extract(source, filename, theme_json, variable_map_json, config_json, group_registry_json) -> ExtractionResult` — per-file extraction (preserved for backward compatibility and testing)
2. `analyze_project(file_entries_json, theme_json, variable_map_json, config_json, group_registry_json, package_resolution_json) -> String` — project-level analysis returning JSON manifest
3. `transform_file(source, filename, manifest_json) -> TransformResult` — per-file transformation using manifest

The `theme_json` parameter SHALL include `breakpoints.*` keys in the flattened theme. The extraction pipeline SHALL derive breakpoint key names from these entries rather than using any hardcoded constant.

#### Scenario: Backward-compatible extract
- **WHEN** `extract()` is called with a file containing only primary chains (no extensions)
- **THEN** it SHALL produce the same result as before — CSS, transformed code, extractable flag, errors

#### Scenario: Custom breakpoints in theme_json
- **WHEN** `theme_json` contains `{ "breakpoints.mobile": "480", "breakpoints.tablet": "768", "breakpoints.desktop": "1024" }`
- **THEN** the extraction pipeline SHALL recognize `{ mobile: value, tablet: value, desktop: value }` as responsive objects and generate `@media (min-width: 480px)`, `@media (min-width: 768px)`, `@media (min-width: 1024px)` queries

## ADDED Requirements

### Requirement: Responsive detection uses theme-derived keys
`is_responsive_value()` SHALL determine breakpoint key names from the serialized theme rather than a hardcoded constant. The function SHALL accept the set of valid breakpoint keys as a parameter (or access them from a shared context). An object value is responsive if ALL of its keys are either `_` (default) or members of the theme-derived breakpoint key set.

#### Scenario: Standard breakpoints detected
- **WHEN** theme defines breakpoints `xs, sm, md, lg, xl` and a style value is `{ _: "red", md: "blue" }`
- **THEN** `is_responsive_value()` SHALL return true

#### Scenario: Custom breakpoints detected
- **WHEN** theme defines breakpoints `mobile, tablet, desktop` and a style value is `{ mobile: "8px", desktop: "16px" }`
- **THEN** `is_responsive_value()` SHALL return true

#### Scenario: Unknown keys rejected
- **WHEN** theme defines breakpoints `sm, lg` and a style value is `{ sm: "8px", md: "16px" }`
- **THEN** `is_responsive_value()` SHALL return false (`md` is not a defined breakpoint)

#### Scenario: Empty breakpoint set
- **WHEN** theme defines no breakpoints and a style value is `{ sm: "8px" }`
- **THEN** `is_responsive_value()` SHALL return false (no keys are valid breakpoints)

### Requirement: extract_breakpoints is key-agnostic
`extract_breakpoints()` SHALL extract ALL keys matching the `breakpoints.*` prefix from the flattened theme without assuming specific key names. The resulting `BreakpointMap` SHALL contain exactly the keys present in the theme.

#### Scenario: Custom keys extracted
- **WHEN** the flattened theme contains `{ "breakpoints.mobile": "480", "breakpoints.desktop": "1024" }`
- **THEN** `extract_breakpoints()` SHALL return a `BreakpointMap` with keys `mobile` and `desktop`

#### Scenario: No breakpoints defined
- **WHEN** the flattened theme contains no `breakpoints.*` entries
- **THEN** `extract_breakpoints()` SHALL return an empty `BreakpointMap`

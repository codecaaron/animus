## 1. Chain Walker: Support .groups() and .props()

- [ ] 1.1 Remove "groups" and "props" from BAIL_METHODS in chain_walker.rs
- [ ] 1.2 Add `groups: Option<Vec<String>>` and `custom_props: Option<serde_json::Value>` fields to ChainDescriptor
- [ ] 1.3 Parse .groups() argument — evaluate the ObjectExpression to extract group names (keys where value is `true`)
- [ ] 1.4 Parse .props() argument — evaluate the ObjectExpression to extract custom prop configurations (property, scale, transform per prop)
- [ ] 1.5 Add chain walker unit tests: chain with .groups() is extractable, chain with .props() is extractable, chain with both is extractable, .extend() still bails
- [ ] 1.6 Update NAPI extract() signature to accept group_registry_json as fifth parameter

## 2. JSX Scanner (New Module)

- [ ] 2.1 Create jsx_scanner.rs module with function signature: `scan_jsx(source, filename, allocator, component_bindings) -> Vec<SystemPropUsage>`
- [ ] 2.2 Walk JSX elements in OXC AST — match element tag (Identifier) against known component bindings from chain walking
- [ ] 2.3 For matched elements, iterate JSX attributes — filter to only prop names that appear in the component's active groups (resolved via group_registry)
- [ ] 2.4 Evaluate static JSX attribute values: NumericLiteral, StringLiteral, JSX string value, ObjectExpression (for responsive), skip Identifier/CallExpression/ConditionalExpression/SpreadAttribute
- [ ] 2.5 Deduplicate collected (prop_name, value) pairs across all JSX elements in the file
- [ ] 2.6 Add JSX scanner unit tests: static values collected, dynamic values skipped, deduplication works, non-matching elements ignored

## 3. Utility CSS Generation

- [ ] 3.1 Add utility class generation function in css_generator.rs: `generate_utility_css(usages, config, theme, breakpoints) -> (String, HashMap<(String, String), String>)` returning CSS string and (prop,value)→className map
- [ ] 3.2 Resolve each (prop, value) through existing theme_resolver: config lookup → scale resolution → transform application
- [ ] 3.3 Generate deterministic class names: `animus-u-{8-char content hash of resolved CSS}`
- [ ] 3.4 Emit utility rules in `@layer system { }` block
- [ ] 3.5 Handle responsive utility values — emit @media queries within the utility class rule
- [ ] 3.6 Add .props() custom prop utility generation in `@layer custom { }` — same resolution but with inline scales
- [ ] 3.7 Add utility CSS generation unit tests: simple values, responsive values, multi-property props, transform application, custom props in @layer custom

## 4. Pipeline Orchestration

- [ ] 4.1 Wire Phase 2 in lib.rs: after chain walking, resolve active group prop names using group_registry for each chain with groups
- [ ] 4.2 Call jsx_scanner for files containing chains with active groups, passing component bindings and their active prop names
- [ ] 4.3 Call utility CSS generation with collected system prop usages
- [ ] 4.4 Append utility CSS to the component CSS output (after @layer base/variants/states blocks)
- [ ] 4.5 Generate system prop class map per component for the runtime config

## 5. Transform Emitter: System Prop Config

- [ ] 5.1 Extend ComponentReplacement to include system prop class map and system prop name list
- [ ] 5.2 Update generate_replacement() to emit systemProps and systemPropNames in createComponent() config argument
- [ ] 5.3 Generate canonical serialization key for responsive values (e.g., `"_:8|sm:16"`) matching the runtime lookup format
- [ ] 5.4 Add transform emitter unit tests: createComponent output includes systemProps map, systemPropNames array

## 6. Runtime Shim Update

- [ ] 6.1 Update createComponent config type to accept `systemProps: Record<string, Record<string, string>>` and `systemPropNames: string[]`
- [ ] 6.2 Add system prop className assembly: for each systemPropName in props, serialize value to lookup key, find class in systemProps map, append to className
- [ ] 6.3 Add system prop names to the prop filter set (filter from DOM forwarding alongside variant/state props)
- [ ] 6.4 Implement responsive value serialization in runtime: `{ _: 8, sm: 16 }` → `"_:8|sm:16"` matching extraction key format

## 7. Vite Plugin Update

- [ ] 7.1 Add group registry serialization in config-serializer.ts — extract group name → prop name arrays from the built config
- [ ] 7.2 Pass group_registry_json as fifth argument to Rust extract() in the transform hook
- [ ] 7.3 Update types for the NAPI binding to include the new parameter

## 8. Integration Tests

- [ ] 8.1 Create test fixture: Box component with .groups({ space: true, layout: true }) and JSX callsite with static system props
- [ ] 8.2 Create test fixture: Text component with .groups() + .props() and JSX callsite using both group props and custom props
- [ ] 8.3 Create test fixture: component with .groups() and JSX using responsive system props
- [ ] 8.4 Create test fixture: component with .groups() and JSX using dynamic system prop (should skip gracefully)
- [ ] 8.5 Add canary tests: utility CSS appears in @layer system, utility class names are deterministic, system prop class map in createComponent output
- [ ] 8.6 Add canary test: custom prop CSS appears in @layer custom with correct precedence
- [ ] 8.7 Add canary test: component with groups + variants + states — all layers present with correct ordering
- [ ] 8.8 Verify programmatic test config includes all group prop names via serialize-config.ts

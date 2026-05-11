## 1. Selector alias registry

- [x] 1.1 Define `BUILT_IN_SELECTORS` constant with full alias→CSS selector map (interactive, ARIA/data states, pseudo-elements, positional)
- [x] 1.2 Add `addSelectors(selectors: Record<string, string>)` method to `SystemBuilder` — merges with built-ins, later calls override
- [x] 1.3 Serialize merged selector map into system manifest (accessible to extraction pipeline)
- [x] 1.4 Export `SelectorAliasMap` type from `@animus-ui/system`

## 2. Style object alias resolution (JS runtime)

- [x] 2.1 Update style object processing to recognize `_`-prefixed keys and expand via selector map lookup
- [x] 2.2 Resolve prop shorthands (`bg`, `p`, `mt`, etc.) inside alias value objects — same resolution as top-level
- [x] 2.3 Implement `_before` / `_after` content auto-default: inject `content: ''` when not explicitly provided
- [x] 2.4 Support aliases at every chain level: `.styles()`, `.variant()`, `.compound()`, `.states()`

## 3. Callsite pseudo props (JS runtime)

- [x] 3.1 Extend `createClassResolver` to accept `_`-prefixed props and resolve them to pseudo-state/element class names
- [x] 3.2 Wire callsite alias resolution into `.system()` prop handling — emit in `@layer system`
- [x] 3.3 Wire callsite alias resolution into `.props()` prop handling — emit in `@layer custom`

## 4. Type definitions

- [x] 4.1 Define `SelectorAliasProps<Groups>` type — maps each alias key to `Partial<SystemGroupProps<Groups>>`
- [x] 4.2 Extend style object types (`StyleObject`, variant value types, state value types) with optional `_`-prefixed keys
- [x] 4.3 Extend component callsite prop types to include `SelectorAliasProps` based on registered system groups
- [x] 4.4 Support custom aliases in types — `addSelectors()` return type narrows available alias keys

## 5. Extraction pipeline (Rust)

- [x] 5.1 Load merged selector map from system manifest at pipeline init
- [x] 5.2 Update `style_evaluator.rs` to recognize `_`-prefixed keys alongside existing `&`-prefixed selector handling
- [x] 5.3 Expand alias keys to CSS selectors and process nested value objects through standard prop shorthand resolution
- [x] 5.4 Handle compound selectors (comma-separated) — emit duplicate rule blocks per selector
- [x] 5.5 Inject `content: ""` for `_before` / `_after` when not present in the value object

## 6. Verification

- [x] 6.1 Unit tests: alias resolution at each chain level (styles, variant, compound, states)
- [x] 6.2 Unit tests: compound selector expansion (`_disabled` → 4 rule blocks)
- [x] 6.3 Unit tests: `_before`/`_after` content auto-default and explicit override
- [x] 6.4 Unit tests: `addSelectors()` merge and override behavior
- [x] 6.5 Unit tests: callsite pseudo props resolve in correct layer
- [x] 6.6 Integration: showcase component using selector aliases builds and extracts correctly
- [x] 6.7 Type tests: `_hover` accepts correct prop subset based on system groups

## Why

`ThemedCSSProps` — the mapped type backing `.styles()`, `.variant()`, and `.states()` — has a three-branch conditional that resolves value types per key:

1. Key matches a system prop → `ThemedScale<Config[K]>` (themed scale values)
2. Key matches a CSS property → `PropertyTypes[K]` (standard CSS values)
3. Everything else → `unknown`

Branch 3 handles nested selectors (`'&:hover'`, `'&[data-state="open"]'`, `'&::after'`). With `unknown`, their values lose all type information — no autocomplete, no CSS property checking, no system prop awareness inside nested blocks.

Core's equivalent type (`CSSProps`) had a load-bearing third branch: `Omit<PropertyTypes, keyof System> & Omit<System, 'theme'>` — which RE-PROVISIONS the full vocabulary (CSS properties + system props) for unknown keys. This was lost when `ThemedCSSProps` was created during the Theme augmentation rework. No type assertion test existed to catch the regression.

## What Changes

- **Fix `ThemedCSSProps` fallback branch**: Replace `unknown` with `Omit<PropertyTypes, keyof Config> & { [P in keyof Config]?: ThemedScale<Config[P]> }` — the system-package equivalent of core's re-provisioning pattern
- **Add type regression tests**: Negative assertion that nested selector values are NOT `unknown`, plus positive assertions for nested selectors in `.styles()`, `.variant()`, and `.states()`

## Capabilities

### Modified Capabilities
- `system-builder`: `ThemedCSSProps` restores full type vocabulary (CSS properties + themed system props) inside nested selector blocks. Affects `.styles()`, `.variant()` (base + options), and `.states()` via `ThemedCSSPropMap`.

## Impact

- **`packages/system/src/types/config.ts`**: Single line change on the fallback branch of `ThemedCSSProps` (line 129)
- **`packages/system/__tests__/types.test-d.tsx`**: New section 6 with negative assertion (`_NestedNotUnknown`) and positive usage assertions for nested selectors across `.styles()`, `.variant()`, `.states()`
- **No runtime impact**: Pure type-level change. No JS output changes.
- **No extraction impact**: The Rust crate already handles nested selectors in CSS generation. This only restores TypeScript awareness.

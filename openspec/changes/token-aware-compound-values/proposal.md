## Why

Compound-value CSS properties (`border`, `boxShadow`, `background`, `transition`) accept token references via the `{scale.key}` syntax — the Rust extraction pipeline already resolves these to CSS variable references at build time. But the type system has no awareness of this vocabulary. These properties fall back to `string`, offering no autocomplete for token paths and no documentation that token interpolation is valid.

The infrastructure to fix this already exists:
- `LiteralPaths<T>` flattens a theme object into dot-path keys (`colors.primary`, `space.4`)
- `Theme` is augmentable via module declaration — consumer themes populate it once
- `TokenScales<Theme>` filters internal keys, leaving only valid token scale paths
- `(string & {})` preserves template literal union members in autocomplete (prevents `string` collapse)

A performance spike (TS 5.8.3) confirmed: 200 token paths in a template literal type is zero-cost. Single-slot expansion scales linearly. Named type aliases are structurally cached across all reference sites. The pre-5.1 template literal performance concerns no longer apply.

## What Changes

- **New exported type `TokenRef`**: `\`{${keyof LiteralPaths<TokenScales<Theme>>}}\`` — derived from the augmented Theme, auto-populated when consumers augment Theme. Resolves to `never` when Theme is not augmented (graceful degradation).
- **Inject `TokenRef` into PropertyTypes**: Add `| TokenRef` to the `Overrides` default or to a compound-value property overlay, so compound CSS properties offer token path autocomplete alongside standard CSS values.
- **Type regression tests**: Positive assertions (token refs accepted in compound values), negative assertions (invalid token paths rejected via `@ts-expect-error`), structural assertions (TokenRef is not `unknown`, not collapsed by `string`).

## Capabilities

### New Capabilities
- `token-ref-type`: Exported `TokenRef` type derived from augmented Theme. Provides compile-time autocomplete for `{scale.key}` token interpolation syntax in CSS property values.

### Modified Capabilities
- `system-builder`: PropertyTypes gains token ref awareness for compound-value CSS properties. Autocomplete shows token paths (e.g., `{colors.primary}`, `{space.4}`) alongside standard CSS values.

## Impact

- **`packages/system/src/types/theme.ts`**: New `TokenRef` type export derived from `Theme` + `LiteralPaths` + `TokenScales`
- **`packages/system/src/types/properties.ts`**: PropertyTypes Overrides default gains `| TokenRef` (or targeted overlay for compound properties)
- **`packages/system/src/index.ts`**: Re-export `TokenRef`
- **`packages/system/__tests__/types.test-d.tsx`**: New section with positive, negative, and structural assertions
- **No runtime impact**: Pure type-level change. No JS output changes.
- **No extraction impact**: The Rust crate already resolves `{scale.key}` syntax. This adds TypeScript awareness of the same vocabulary.
- **Performance**: +200 types at 200 token paths. Zero measurable check-time impact (confirmed by spike).

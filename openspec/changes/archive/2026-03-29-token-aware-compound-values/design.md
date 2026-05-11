## Context

The Rust extraction pipeline resolves `{scale.key}` token references in CSS string values to `var(--scale-key)` at build time. This works for any string-valued CSS property — `border: '1px solid {colors.secondary}'` becomes `border: 1px solid var(--colors-secondary)`. Alpha modifiers are also supported: `{colors.primary/10}`.

The type system currently has no awareness of this syntax. Compound-value properties like `border`, `boxShadow`, `background` accept `string` (via `(string & {})` in PropertyTypes), which means any string passes — no autocomplete for token paths, no documentation of valid syntax.

The infrastructure exists: `LiteralPaths<T>` flattens theme objects into dot-path string keys, `TokenScales<Theme>` filters internal keys, and `Theme` is augmentable. A TS 5.8.3 spike confirmed 200 token paths in a template literal is zero-cost (+202 types, 0ms check time).

## Goals / Non-Goals

**Goals:**
- Export `TokenRef` type from `@animus-ui/system`, derived from augmented Theme
- Token path autocomplete in IDE for `{scale.key}` syntax in CSS property values
- Type regression tests covering acceptance, rejection, and structural properties
- Graceful degradation when Theme is not augmented (`TokenRef` = `never`)

**Non-Goals:**
- Validating token paths at the type level (extraction pipeline already does this at build time)
- Multi-token compound values (e.g., `linear-gradient({colors.a}, {colors.b})`) — `(string & {})` handles these, type-level validation would hit combinatorial limits
- Alpha modifier typing (`{colors.primary/10}`) — extraction handles this, typing the `/number` suffix is unnecessary complexity
- Replacing csstype — we overlay, not replace
- Runtime behavior changes

## Decisions

### 1. TokenRef definition

```typescript
export type TokenRef = `{${keyof LiteralPaths<TokenScales<Theme>> & string}}`;
```

Placed in `system/src/types/theme.ts` alongside `Theme` and `TokenScales`. Uses the existing `LiteralPaths` utility from the theme module. `& string` filters out `number | symbol` from `keyof`.

**When Theme is augmented:** Resolves to `'{colors.primary}' | '{colors.secondary}' | '{space.4}' | ...`
**When Theme is NOT augmented:** `TokenScales<Theme>` = `{}`, `keyof LiteralPaths<{}>` = `never`, `TokenRef` = `never`. Falls out of all unions silently.

### 2. Injection point: PropertyTypes Overrides

The `Overrides` generic parameter on `PropertyTypes` already controls what additional types every CSS property accepts. Current default: `(string & {}) | 0`.

Change to: `(string & {}) | 0 | TokenRef`.

This means every CSS property that accepts `string` also offers token ref autocomplete. For scale-bound properties (like `color` via the system prop registry), the scale narrowing from `ThemedCSSProps` takes priority — TokenRef is only visible in the fallback branch (nested selectors, non-system CSS properties).

**Why not a targeted overlay?** TokenRef is valid in ANY string-valued CSS property — `border`, `boxShadow`, `background`, `content`, even `color` (if the consumer writes `color: '{colors.primary}'` instead of using the scale). A targeted overlay would be incomplete and harder to maintain.

### 3. Autocomplete preservation

`TokenRef` members are subtypes of `string`. In a union `string | TokenRef`, TypeScript collapses the template literal members. The existing `(string & {})` in the Overrides default prevents this — `(string & {}) | TokenRef` preserves both arbitrary strings and token ref autocomplete.

No additional work needed — the `(string & {})` pattern is already in place.

### 4. Type regression test structure

Three levels of assertion in `types.test-d.tsx`:

**Structural:** `TokenRef` is not `never` when Theme is augmented (the test fixture augments Theme)
```typescript
type _TokenRefNotNever = Assert<IsExact<TokenRef, never> extends true ? false : true>;
```

**Positive:** Token refs accepted in compound CSS property values
```typescript
ds.styles({ border: '{colors.primary}' as TokenRef });
```

**Negative (`@ts-expect-error`):** Invalid token paths rejected — proves TokenRef carries constraints, not just `string`
```typescript
// @ts-expect-error — 'colors.nonexistent' is not in the theme
const _bad: TokenRef = '{colors.nonexistent}';
```

**Collapse guard:** TokenRef members survive in the union (not collapsed by string)
```typescript
type PropWithRef = (string & {}) | TokenRef;
type _NotJustString = Assert<unknown extends PropWithRef ? false : true>;
```

## Risks / Trade-offs

**[Acceptable] TokenRef in ALL CSS properties:** Even properties where scale narrowing is primary (like `color`). The consumer can write `color: '{colors.primary}'` and it passes. This is correct — the extraction pipeline handles it. The scale-narrowed path (`color: 'primary'` via system props) is preferred but the token ref path is also valid.

**[Acceptable] No alpha modifier typing:** `{colors.primary/10}` is valid extraction syntax but TokenRef doesn't include the `/number` suffix. The `(string & {})` fallback accepts it. Adding alpha modifier types would double the union size for minimal autocomplete benefit.

**[Low risk] LiteralPaths on large themes:** A theme with 200 flattened paths produces a 200-member template literal union. Spike confirmed this is zero-cost. Themes would need 100K+ paths to hit the hard limit — impossible in practice.

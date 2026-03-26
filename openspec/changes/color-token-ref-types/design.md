## Context

Color-scale-bound properties (`bg`, `color`, `borderColor`, `fill`, `stroke`) now correctly narrow to `keyof Theme['colors']` via `ThemedScaleValue`/`ScaleValue`. This is the type system working as intended. However, colors are compositionally unique — opacity variants, inline references in compound CSS values, and decorative one-offs all need to reference the palette without bypassing narrowing entirely.

The Rust extraction pipeline already supports `{scale.path}` and `{scale.path/alpha}` token reference syntax in any string value. `resolve_token_aliases` scans for `{...}` patterns after scale lookup, resolving them to `var()` or `color-mix()`. Scale miss → raw passthrough → token alias resolution. This pipeline behavior is verified and requires no changes.

The gap is purely at the TypeScript type level: `ThemedScaleValue` and `ScaleValue` don't accept token reference strings.

## Goals / Non-Goals

**Goals:**
- Accept `{colors.X}` and `{colors.X/alpha}` token reference syntax on color-scale properties at the type level
- Preserve scale key narrowing and autocomplete for color properties
- Match the Rust pipeline's existing runtime behavior with compile-time types

**Non-Goals:**
- Token refs on non-color scales (space, shadows, fonts) — scale keys are sufficient there
- Raw CSS color function acceptance (rgb, rgba, hsl) — this would defeat narrowing
- Runtime changes — the pipeline already handles this correctly
- Narrowing token ref paths to actual theme color keys (future enhancement)

## Decisions

### Decision 1: `ColorTokenRef` as a template literal type

```ts
type ColorTokenRef = `${string}{colors.${string}}${string}`;
```

**Rationale:** This accepts `{colors.ember/40}`, `linear-gradient(..., {colors.ember})`, and `0 0 8px {colors.ember/30}` while rejecting `rgba(255,0,0,0.1)` and arbitrary strings. The `${string}` bookends allow token refs embedded in compound CSS values.

**Alternatives considered:**
- `(string & {})` — too broad, defeats all narrowing
- `CSSColorFn` (rgb/rgba/hsl/etc) — still bypasses the palette, Chakra v3 cautionary tale
- Universal `TokenRef` on all scales — `{space.4}` is pointless when you can write `4`

### Decision 2: Conditional activation via `Config['scale'] extends 'colors'`

The `ColorTokenRef` union is added ONLY when the prop's scale is `'colors'`. Detection is simple string literal comparison in the conditional type — no metadata flags or prop config changes needed.

Applied in both:
- `ThemedScaleValue<Config>` (used in `.styles()`, `.variant()`, `.states()`)
- `ScaleValue<Config, T>` (used in parser props with generic T)

### Decision 3: No Rust pipeline changes

Verified: `resolve_value` tries scale lookup first. If the value `{colors.ember/40}` doesn't match any key in the prop's scale (e.g., `shadows`), `resolved = None`, the raw string passes through, and `resolve_token_aliases` picks up the `{...}` pattern. This is correct for both color-prop usage (scale miss on `colors` → passthrough → alias resolution) and compound values on other props.

## Risks / Trade-offs

- **[Risk] Template literal is permissive within `{colors.*}`** — `{colors.typo/40}` compiles but fails at extraction time. Mitigation: Rust pipeline already emits `[alias]` diagnostics for unresolved tokens. Future enhancement: narrow to `{colors.${keyof Theme['colors']}}`.
- **[Risk] `'colors'` scale name is hardcoded** — If a consumer names their color scale differently, they don't get token refs. Mitigation: `colors` is already a reserved name via `addColors()` — the builder API enforces it.
- **[Trade-off] Only color-scale properties benefit** — `boxShadow` with `scale: 'shadows'` won't accept inline token refs. This is intentional: shadow values with token refs should be defined in the theme scale (as we did with `glow-ember`, `glow-fire` etc).

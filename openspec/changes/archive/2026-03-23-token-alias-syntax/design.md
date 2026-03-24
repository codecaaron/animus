## Context

The Animus extraction pipeline currently handles two kinds of style values:

1. **Implicit scale lookup**: Bare values on known props (`p: 8`, `color: 'primary'`) where the prop config maps to a scale and the theme resolver does `theme["scale.key"]`. This is the existing pipeline.
2. **Literal pass-through**: String values that don't match a scale (`display: 'flex'`) pass through as CSS.

There is no mechanism for referencing design tokens inside compound CSS strings like `border: '1px solid <some-token>'`. Developers must hard-code CSS variable names (`var(--colors-primary)`) or abandon extraction.

**Theme object internals (verified in code):**
- `theme._variables` contains CSS variable declarations keyed by scope (`root`, `mode`, `shadows`, etc.), e.g. `{ root: { '--colors-pink-500': '#ff80bf' } }`
- `theme._tokens` contains raw color values (pre-CSS-variable), used by the Background component for contrast computation
- `flattenScale()` (both in theming and vite-plugin) uses **hyphen** separators for nested keys and **elides `_` defaults** — so `{ text: { _: 'navy-700', shadow: 'navy-900' } }` becomes `{ text: 'navy-700', 'text-shadow': 'navy-900' }`
- The vite-plugin's flat key format is `"scaleName.hyphen-joined-path"` — e.g., `"colors.pink-600"`, `"colors.text"`, `"space.8"`
- The runtime uses lodash `_.get()` with dot paths on the nested theme object

**Current serialization to Rust**: `theme-evaluator.ts` produces a single flat `HashMap<String, String>` mapping `"scale.key"` to CSS value strings (e.g., `"colors.primary"` → `"var(--colors-primary)"`). Private keys (`_tokens`, `_variables`) are skipped.

## Goals / Non-Goals

**Goals:**
- Enable `{scale.path}` syntax in string style values for compile-time token resolution
- Enable `{scale.path/N}` alpha modifier producing CSS `color-mix()`
- Use lodash-style dot paths (matching the runtime convention) in the alias syntax
- Augment theme serialization with variable-name data from `theme._variables`
- Keep the change minimal — no runtime changes, no builder API changes

**Non-Goals:**
- Nested token references (`{colors.{mode}.primary}`) — not supported
- Runtime token resolution — this is purely compile-time
- Arbitrary expression evaluation inside `{}` — only static token paths
- Complex typed compound values (e.g., typed border templates) — future feature that builds ON token alias
- Changing the existing implicit scale lookup — `p: 8` continues to work unchanged
- Restructuring the flat theme map — we augment it, not replace it

## Decisions

### 1. Dot-path syntax matching lodash `_.get()` convention

Token aliases use dots: `{colors.pink.600}`, not hyphens.

**Why**: The runtime scale lookup already uses lodash `_.get(theme, 'colors.pink.600')` on the nested object. Developers think in dots. The alias syntax should match what they already write.

**Conversion to flat key**: First segment is the scale name, remaining segments join with hyphens. `{colors.pink.600}` → flat key `colors.pink-600`. This matches the hyphen separator in `flattenScale()`.

**Alternative considered**: Using the flat key format directly (`{colors.pink-600}`). Rejected because it forces developers to know the flattening convention, which is an internal detail.

### 2. Alpha modifier via `/N` producing `color-mix()`

`{colors.primary/50}` → `color-mix(in srgb, var(--colors-primary) 50%, transparent)`

**Why**: CSS-native `color-mix()` works with CSS variables (unlike rgba manipulation which needs raw values). This means alpha interpolation stays mode-aware — `var(--colors-primary)` changes per color mode, and the alpha just works.

**Alternative considered**: Using raw color values from `_tokens` and building `rgba()`. Rejected because it breaks color mode awareness — the extracted CSS would have the wrong color in the other mode.

### 3. Augment theme serialization with variable-name map

Pass a second JSON map to Rust alongside the existing flat values:
```json
{ "colors.primary": "--colors-primary", "shadows.lg": "--shadows-lg" }
```

Built by inverting `theme._variables`: iterate each scope's declarations, convert the CSS variable name back to a token path.

**Why**: Constructing `color-mix(in srgb, var(--name) ...)` requires knowing the variable name. Extracting it from the existing `"var(--name)"` string is fragile. A dedicated map is explicit.

**Alternative considered**: Parsing `"var(--name)"` strings to extract variable names. Rejected — brittle, assumes format consistency.

### 4. Resolution lives in `theme_resolver.rs`

Token alias resolution happens during theme resolution, not during style evaluation. When `resolve_single_prop` encounters a string value, it scans for `{...}` patterns and resolves each one before emitting the CSS declaration.

**Why**: Co-locates all theme-dependent resolution in one module. The style evaluator stays format-agnostic (it just sees string literals). The theme resolver already has access to the theme data.

### 5. String scanning only in already-evaluated string literals

The style evaluator classifies `'1px solid {colors.primary}'` as a static string literal (it contains no JS expressions). The `{` is just a character in the string, not a JS expression delimiter. Token alias scanning happens AFTER style evaluation, in the theme resolver.

**Why**: Clean separation — style evaluator determines static vs dynamic (JS semantics), theme resolver handles token resolution (design system semantics). No change to the bail/skip logic.

### 6. `_` default is implicit — not specified in alias path

`{colors.text}` resolves the `_` default of the nested `text` object (flat key: `colors.text`). Writing `{colors.text._}` is NOT supported — it would produce flat key `colors.text-_` which doesn't exist.

## Risks / Trade-offs

### Grounded Risks

**[Risk: `{` in CSS content values]** The string `{` can appear naturally in CSS `content` property values (e.g., `content: '{'`). The scanner would false-positive.
→ **Mitigation**: Only scan strings that are values of CSS properties that accept token references. `content` is a passthrough property (no scale, no transform) — token aliases in passthrough properties are likely rare but need a documented escape hatch or a decision to not scan passthrough values.

**[Risk: color-mix() browser support]** `color-mix()` requires Chrome 111+, Firefox 113+, Safari 16.2+.
→ **Mitigation**: Check if the project has a documented browser floor. If older browsers are needed, alpha interpolation could fall back to emitting the base color without opacity (degraded but functional).

### Ungrounded Assumptions (Red Team Flags)

These are assumptions made during exploration that need verification before or during implementation:

**[FLAG 1: Two flattenScale functions]** The theming package and the vite plugin each have their OWN `flattenScale`. We verified both use hyphens, but: do they produce IDENTICAL keys for the same input? The theming version has `_` elision logic. The vite plugin version does NOT appear to handle `_` specially. If the vite plugin flattens a scale that has `_` defaults, the keys may differ from what the theming package produced.
→ **Action**: Test with a real theme containing nested semantic tokens with `_` defaults. Compare the flat keys from both functions.

**[FLAG 2: _variables key format → token path mapping]** We assume we can build a reverse map from `_variables` CSS var names to token paths. The `_variables` structure is `{ scope: { '--colors-pink-500': '#ff80bf' } }`. Converting `--colors-pink-500` back to a token path `colors.pink.500` requires knowing the separator convention and the scale name prefix. This is the INVERSE of `serializeTokens` — we haven't verified that inversion is lossless.
→ **Action**: Read `serializeTokens.ts` to understand the variable naming convention. Check if any scale produces variable names that can't be unambiguously reversed to token paths.

**[FLAG 3: resolve-transforms.ts interaction]** The vite plugin has a `resolve-transforms.ts` file that we haven't read. It was added recently. If it modifies how CSS values flow through the pipeline, token alias resolution might need to coordinate with it.
→ **Action**: Read `resolve-transforms.ts` before implementation to understand the interaction surface.

**[FLAG 4: Scales with no entry in _variables]** Not all scales emit CSS variables — only those that called `createScaleVariables()`. For non-variable scales (e.g., `space`, `radii`), `{space.8}` should resolve to the literal value `"0.5rem"`. We assume the flat value map always has the literal for these. But what if some scale values are objects or arrays rather than strings after flattening?
→ **Action**: Verify that all flat theme values are strings. Check edge cases like array values in scales.

**[FLAG 5: addScale with compute function]** Scales created via `.addScale('shadows', (theme) => ({...}))` are computed from other scales. After evaluation, are these values stored as CSS var references or raw values in the flat map? The answer determines whether `{shadows.lg}` resolves to a var or a literal.
→ **Action**: Check a real theme's `shadows` scale entries in the flat map.

## Open Questions

1. **Escape hatch**: How should a developer write a literal `{` in a string value without triggering alias resolution? Options: `\\{`, `{{`, or "just don't" (document that `{` triggers scanning).

2. **Error on unresolved alias**: If `{colors.nonexistent}` doesn't match any theme key, should the compiler emit a warning (like per-property skip) or an error? Leaning toward warning + passthrough of the raw string, matching the skip-not-bail philosophy.

3. **Alpha modifier range**: Should `/N` be 0-100 (percentage) or 0-1 (decimal)? Chakra uses 0-100. CSS `color-mix()` uses percentages. Recommend 0-100 for consistency with both.

4. **Multiple aliases in one value**: `'0 4px 12px {colors.primary/20}'` has one alias. `'{space.4} {space.8}'` has two. The scanner must handle multiple `{...}` patterns in a single string. This is straightforward but should be explicitly tested.

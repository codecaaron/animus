## Context

The `prefix` option was added to the extraction pipeline to namespace CSS output — layer names, class names, and CSS custom properties all get a `{prefix}-` prepended. This enables multiple design systems (or Animus + Tailwind) to coexist without layer/variable name collisions.

The implementation correctly handles:
- **Layer names**: Rust `prefix_layer()` and TS `prefixLayerName()` both apply dash-separated prefixes at emission time.
- **Class names**: Rust `make_class_name()` uses the prefix as the class name root.
- **CSS variable declarations**: TS `applyPrefix()` transforms `--color-x:` → `--{prefix}-color-x:` and `var(--color-x)` → `var(--{prefix}-color-x)` in both variable CSS and theme JSON.

Two pathways were missed:
1. **Contextual variable resolution** — `applyPrefix()` prefixes the contextual var *names* array (`["current-bg"]` → `["ax-current-bg"]`), which breaks Rust-side matching since token aliases like `{colors.current-bg}` look up by the original name. And `resolve_contextual_var()` emits `var(--{name})` without prefix.
2. **`tokens.varRef()` runtime method** — reads from the original `variableMap` built at theme construction time (before any prefix application), so `varRef('colors.text')` returns `var(--color-text)` while the CSS declares `--ax-color-text`.

## Goals / Non-Goals

**Goals:**
- Contextual variable token aliases resolve correctly when prefix is configured
- `tokens.varRef()` returns prefixed variable references matching emitted CSS
- Showcase exercises prefix + custom layers as integration proof
- Zero behavioral change when no prefix is configured

**Non-Goals:**
- Changing the prefix delimiter (dash-separated is the established convention)
- Adding prefix support to `compose()` slot distribution (already works via class name prefix)
- Runtime prefix switching — prefix is a build-time constant

## Decisions

### 1. Fix contextual var matching at the TS boundary, not the Rust boundary

**Decision**: Remove contextual var name prefixing from `applyPrefix()`. The names are lookup keys for token path matching, not CSS output. The Rust resolver matches `{colors.current-bg}` against the names array — prefixing the array breaks the match.

**Alternative considered**: Make Rust strip the prefix before matching. Rejected because it couples the resolver to prefix format knowledge that belongs in the TS orchestration layer. The principle: extraction Rust crate receives ready-to-use data; it shouldn't need to undo TS-side transformations.

### 2. Add prefix to `ResolveContext`, thread through resolver

**Decision**: Add `pub prefix: Option<&'a str>` to `ResolveContext`. Thread it through `resolve_styles` → `resolve_flat_styles` → `resolve_single_prop` → `resolve_token_aliases` → `resolve_single_alias` → `resolve_contextual_var`. The final function emits `var(--{prefix}-{name})` when prefix is `Some`.

**Alternative considered**: Only add prefix to `resolve_contextual_var` and thread piecemeal. Rejected because `ResolveContext` is the canonical place for extraction-wide configuration — prefix affects resolution semantics the same way `variable_map` does.

Construction sites to update (5):
- `lib.rs` — per-file extraction (`prefix: None`)
- `project_analyzer.rs` — project analysis (`prefix: layer_prefix`)
- `css_generator.rs` — custom prop context (`prefix: ctx.prefix`)
- `theme_resolver.rs` tests — `TestCtxOwner::ctx()` (`prefix: None`)
- `css_generator.rs` tests — test helper `ctx()` (`prefix: None`)

### 3. Prefix awareness for `varRef` via system-level config

**Decision**: Add optional `prefix` to `createSystem()` config. The system passes it to `createTheme`, which stores it and applies it in `varRef()` — prepending `{prefix}-` to variable name lookups. The plugin reads prefix from `serialize()` output and validates/uses it, eliminating config duplication.

**Alternative considered**: Build-time static replacement of `tokens.varRef()` calls by the vite plugin. Rejected because varRef is used at runtime in dynamic contexts (e.g., syntax highlighting token maps in SyntaxBlock) where static replacement is fragile.

**Alternative considered**: Keep prefix only on the plugin and inject a `__ANIMUS_PREFIX__` runtime global. Rejected because it introduces runtime coupling to build config and doesn't work in SSR/test contexts.

**Flow**:
```
createSystem({ prefix: 'ax' })
  → createTheme stores prefix
  → varRef('colors.text') returns var(--ax-color-text)
  → serialize() includes prefix in output
  → plugin reads prefix from serialized config (single source of truth)
```

### 4. Showcase config: `prefix: 'ax'` with bookend layers

**Decision**: Use `ax` as the showcase prefix (short, Animus-derived, visually distinct). Add `reset` and `overrides` bookend layers to demonstrate interleaving.

```typescript
animusExtract({
  system: './src/ds.ts',
  prefix: 'ax',
  layers: ['reset', 'ax-global', 'ax-base', 'ax-variants', 'ax-compounds', 'ax-states', 'ax-system', 'ax-custom', 'overrides'],
})
```

## Risks / Trade-offs

- **[Prefix duplication until system-level lands]** → The Rust crate fix (tasks 1-2) and the TS `applyPrefix` fix can ship independently. The `varRef` system-level prefix (task 3) requires a design system config change. If we land tasks 1-2 first, prefix works for extraction but not `varRef`. Mitigation: showcase doesn't use `varRef` in extracted styles, so the build succeeds after tasks 1-2.
- **[ResolveContext grows]** → Adding another field to a struct threaded through dozens of functions. Mitigation: `Option<&str>` is zero-cost when `None`, and this field is genuinely resolution-scoped.
- **[System-level prefix and plugin-level prefix could conflict]** → If system says `ax` and plugin says `acme`. Mitigation: plugin validates they match and throws if not. Single source of truth is the system; plugin config becomes optional override.

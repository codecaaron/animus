## Why

When `prefix` is configured in the extraction plugin, two resolution pathways silently break: contextual variable token aliases (`{colors.current-bg}`) fail to resolve and leak raw token text into CSS, and `tokens.varRef()` emits unprefixed `var()` references that don't match the prefixed declarations. These bugs make the prefix feature unusable for any design system that uses contextual vars or runtime `varRef` lookups — which is most real-world usage.

## What Changes

- **Stop prefixing contextual var lookup keys** in `applyPrefix()` — contextual var names are used for Rust-side token path matching, not as CSS variable names. Prefixing them breaks the match.
- **Add prefix awareness to Rust resolver** — `ResolveContext` gains a `prefix` field, threaded through `resolve_contextual_var()` so it emits `var(--{prefix}-{name})` instead of `var(--{name})`.
- **Make `tokens.varRef()` prefix-aware** — the runtime variable map lookup must return prefixed var references when the system is built with a prefix, so inline `style={}` usage matches the emitted CSS declarations.
- **Showcase vite config** updated with `prefix: 'ax'` and custom `layers` to exercise the full feature as an integration proof.

## Capabilities

### New Capabilities
- `prefix-aware-resolution`: Ensures the namespace prefix flows correctly through all token resolution pathways — contextual vars in the Rust extractor and `varRef()` at runtime.

### Modified Capabilities
- `contextual-vars`: Resolution must respect prefix — match against unprefixed names, emit prefixed `var()` references.
- `theme-variable-emission`: `varRef()` must produce prefixed variable references when prefix is configured.

## Impact

- **Rust crate** (`packages/extract/src/theme_resolver.rs`): `ResolveContext` struct gains field, `resolve_contextual_var` gains prefix parameter, 5 construction sites updated.
- **TS pipeline** (`packages/extract/pipeline/prefix.ts`): Remove contextual var name prefixing from `applyPrefix()`.
- **Theme system** (`packages/system/src/theme/createTheme.ts`): `varRef()` method needs prefix-aware variable map or prefix parameter.
- **Showcase** (`packages/showcase/vite.config.ts`): Config updated with prefix + custom layers for integration testing.
- **No breaking changes** — prefix is opt-in, unprefixed behavior unchanged.

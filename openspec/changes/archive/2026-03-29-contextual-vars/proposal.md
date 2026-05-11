## Why

CSS provides `currentColor` — a value that cascades the inherited `color` to children. There is no equivalent for `backgroundColor`, `borderColor`, or any other property. Components that need to derive values from an ancestor's background (overlay transparency, scrollbar matching, focus ring contrast, seamless borders) must either prop-drill, use React context, or hardcode values.

The original `@animus-ui/core` had a `--current-bg` side-effect pattern that was not preserved in `@animus-ui/system`. Restoring it requires solving a harder problem: typed color props reject raw `var(--current-bg)` because they're constrained to `keyof TokenScales<Theme>['colors']`. The contextual variable must be a first-class member of the scale's type to be usable.

## What Changes

- **New ThemeBuilder method: `.addContextualVars()`** — Declares phantom scale members that resolve to CSS custom properties instead of token values. Uses config-object API with object-key narrowing (no `as const`).
- **Type system integration** — Contextual var names appear in `TokenScales<Theme>[Scale]` via phantom key merging in `#checkpoint`. Any prop bound to that scale accepts them.
- **Rust extractor: contextual var resolution** — When the extractor encounters a contextual var name as a style value, it resolves to `var(--{name})` instead of looking up the token manifest.
- **Prop-level auto-emission (optional)** — New `currentVar` field on `Prop` interface. When a prop is set, the Rust extractor emits a sibling CSS custom property declaration with the same resolved value. This automates the cascade.
- **Theme serialization** — Contextual var registry included in the serialized theme for Rust consumption.

## Capabilities

### New Capabilities
- `contextual-vars`: ThemeBuilder `.addContextualVars()` method, phantom type merging, serialization, and Rust resolution of contextual variables as scale members
- `auto-emission`: Prop-level `currentVar` config that triggers sibling CSS custom property declaration alongside the resolved property value

### Modified Capabilities
- `theme-variable-emission`: Serialization must include contextual var registry alongside emitted scale variables
- `prop-system`: `Prop` interface gains optional `currentVar` field; Rust `resolve_single_prop` emits sibling declarations

## Impact

- `packages/system/src/theme/createTheme.ts` — New `addContextualVars` method on ThemeBuilder, phantom type merging via `#checkpoint`
- `packages/system/src/types/config.ts` — `Prop` interface gains `currentVar?: string`
- `packages/system/src/groups/index.ts` — `bg` prop config gains `currentVar: '--current-bg'`
- `packages/extract/src/theme_resolver.rs` — Contextual var resolution path + sibling declaration emission
- `packages/system/src/SystemBuilder.ts` — Serialization of contextual var registry and `currentVar` prop metadata
- Type tests and canary tests need coverage for phantom scale members and auto-emission

## 1. TS Pipeline: Fix applyPrefix contextual var handling

- [x] 1.1 Remove contextual var name prefixing from `applyPrefix()` in `packages/extract/pipeline/prefix.ts` — pass `contextualVarsJson` through unchanged with explanatory comment

## 2. Rust Crate: Thread prefix through resolver

- [x] 2.1 Add `pub prefix: Option<&'a str>` field to `ResolveContext` in `theme_resolver.rs`
- [x] 2.2 Update all `ResolveContext` construction sites: `lib.rs` (prefix: None), `project_analyzer.rs` (prefix: layer_prefix), `css_generator.rs` custom ctx (prefix: ctx.prefix), and both test helpers (prefix: None)
- [x] 2.3 Add `prefix: Option<&str>` parameter to `resolve_contextual_var()` and emit `var(--{prefix}-{name})` when prefix is Some
- [x] 2.4 Thread prefix through the call chain: `resolve_styles` → `resolve_flat_styles` → `resolve_single_prop` → `resolve_token_aliases` → `resolve_single_alias` → `resolve_contextual_var`, and `resolve_responsive_prop` → `resolve_single_prop`
- [x] 2.5 Verify with `bun run test:canary` — existing tests pass with prefix: None

## 3. System: Prefix-aware varRef

- [x] 3.1 Add optional `prefix` to `createTheme().build({ prefix })` (adjusted from design: theme owns varRef, not system)
- [x] 3.2 Apply prefix in `varRef()` — prepends `{prefix}-` to variable names in var() references
- [x] 3.3 Include prefix in `serialize()` output so the plugin can read it as single source of truth
- [x] 3.4 Update plugin to read prefix from serialized theme config; validate against plugin-level prefix if both specified

## 4. Showcase: Integration proof

- [x] 4.1 Update `packages/showcase/vite.config.ts` with `prefix: 'ax'` and custom layers `['reset', 'ax-global', 'ax-base', ..., 'overrides']`
- [x] 4.2 Update `packages/showcase/src/ds.ts` to pass `prefix: 'ax'` to `createTheme().build({ prefix: 'ax' })`
- [x] 4.3 Verify full build with `bun run verify:showcase` — no CSS syntax errors, prefixed layer names and var names in output

## 5. Verification

- [x] 5.1 Run `bun run verify` — 434 tests pass (biome errors pre-existing, not from our changes)
- [x] 5.2 Inspect built CSS output: layer declaration uses `ax-` prefix, component rules in `@layer ax-base`, `@layer ax-variants`, etc.
- [x] 5.3 Verify contextual var references resolve to `var(--ax-current-bg)` in built CSS (not raw `colors.current-bg`)

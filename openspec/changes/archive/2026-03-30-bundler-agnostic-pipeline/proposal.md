## Why

The extraction pipeline's theme evaluation and global styles resolution are pure, bundler-agnostic functions trapped inside `vite-plugin`. `evaluateThemeObject` has zero Vite imports — it reads `theme.manifest` and JSON.stringifies. `resolveGlobalStyles` is pure prop shorthand resolution. This prevents the integration test workspace from exercising the pipeline without depending on vite-plugin, and blocks any future non-Vite bundler plugin from reusing the same logic.

The pattern already exists: `ds.serialize()` on the system returns everything the Rust crate needs about prop config. The theme should do the same: `tokens.evaluate()` returns everything the Rust crate needs about the theme.

## What Changes

- **Add `.evaluate()` method to ThemeBuilder output** — returns `{ scalesJson, variableMapJson, variableCss, contextualVarsJson }`, same shape as current `evaluateThemeObject` return. Reads directly from the already-built `.manifest`.
- **Export `resolveGlobalStyles` from system** — pure function that resolves prop shorthand in global style objects using serialized config + evaluated theme + transforms.
- **Move pure helpers** (`buildVariableCss`, `flattenModeTokens`, `flattenScale`, `camelToKebab`, `resolveValue`) from vite-plugin to system.
- **Thin out vite-plugin's theme-evaluator.ts** — replace local implementations with imports from `@animus-ui/system`. Legacy fallback path (themes without `.manifest`) stays in vite-plugin as a backwards-compat host concern.
- **Export pipeline utilities from `@animus-ui/system/pipeline`** (or similar subpath) — keeps the consumer-facing `@animus-ui/system` export clean.

## Capabilities

### New Capabilities
- `theme-evaluation`: Theme object self-evaluation via `.evaluate()` method — the theme counterpart to system's `.serialize()`. Produces the 4 JSON artifacts the extraction pipeline needs.

### Modified Capabilities
- `system-serialization`: SerializedConfig shape unchanged, but the theme evaluation that was previously external now has a canonical home alongside serialize.
- `vite-extraction-plugin`: Plugin imports pipeline functions from system instead of local implementations. Behavior identical. Legacy theme fallback remains in plugin.

## Impact

- `packages/system/src/` — ThemeBuilder gains `.evaluate()` on build output, new pipeline utilities module
- `packages/system/package.json` — may need subpath export for pipeline utilities
- `packages/vite-plugin/src/theme-evaluator.ts` — gutted to thin wrapper importing from system
- `packages/vite-plugin/src/resolve-global-styles.ts` — imports `resolveGlobalStyles` from system
- `packages/vite-plugin/package.json` — no new deps (already depends on system at build time via subprocess)
- Zero runtime behavior change — identical CSS output from vite-plugin

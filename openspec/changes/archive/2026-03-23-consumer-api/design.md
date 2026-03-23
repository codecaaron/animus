## Context

The showcase app gap discovery revealed two API gaps that block real consumers. The smoke test hid these by using test fixtures and inline plugins. A production-ready consumer API needs zero workarounds.

## Goals / Non-Goals

**Goals:**
- `animusExtract()` with zero options works for the default case
- Config serialization happens automatically from `@animus-ui/core`
- Theme evaluation happens inside the plugin during `buildStart`
- Existing options remain as escape hatches for non-standard setups

**Non-Goals:**
- Removing the `theme: string | { scales, variables }` options (kept for backward compat)
- Changing the Rust NAPI interface (it still receives JSON strings)
- Fixing the Emotion type dependency in `@animus-ui/theming`

## Decisions

### 1. Export serialized config from @animus-ui/core

**Decision:** Add a `getExtractConfig()` function to `@animus-ui/core`'s public API that returns `{ propConfig: string, groupRegistry: string }` — the pre-serialized JSON strings the Rust pipeline expects.

**Rationale:** The plugin needs this data but shouldn't know about `PropRegistry`, `GroupRegistry`, or transform function names. `getExtractConfig()` encapsulates the serialization logic (currently in `config-serializer.ts`) behind a simple function call. The plugin just calls `getExtractConfig()` and passes the result to `analyzeProject`.

**Alternative considered:** Exporting `propRegistry`/`groupRegistry` raw and letting the plugin serialize them. Rejected because serialization requires knowledge of transform function name mapping, which is core's domain.

### 2. Plugin auto-imports config at buildStart

**Decision:** In `buildStart`, if no `config`/`groupRegistry` options are provided, the plugin calls:
```ts
const { getExtractConfig } = await import('@animus-ui/core');
const { propConfig, groupRegistry } = getExtractConfig();
```

This uses dynamic `import()` so it works in both CJS and ESM contexts. `@animus-ui/core` is already a declared dependency of the plugin (fixed in GAP 1).

### 3. Theme evaluation via themePath option

**Decision:** Add `themePath?: string` to `AnimusExtractOptions`. In `buildStart`:
1. If `themePath` is provided, use it
2. If not, auto-detect by checking: `src/theme.ts`, `src/theme.js`, `theme.ts`, `theme.js` (relative to `rootDir`)
3. If found, evaluate the theme module. In build mode, use a Bun/Node dynamic `import()` with the resolved absolute path. In dev mode, use `ssrLoadModule` if available.
4. Pass the evaluated theme to `evaluateTheme`'s internal logic (extract `_variables`, flatten scales)
5. If no theme file found and no `theme` option provided, use `'{}'` (empty theme)

**Constraint:** Theme modules often import from `@animus-ui/theming`, which imports from `@animus-ui/core`, which imports from `@emotion/*`. Dynamic `import()` of the theme file will work if all deps are resolvable — which they are in a workspace. For published packages, the consumer installs these deps anyway.

### 4. Keep escape hatches

The existing options remain:
- `theme: string` — pre-serialized JSON (no variable emission)
- `theme: { scales, variables }` — pre-evaluated (bypass internal eval)
- `config: string` — pre-serialized prop config (bypass auto-import)
- `groupRegistry: string` — pre-serialized group registry

These cover non-standard setups where auto-detection doesn't work.

## Risks / Trade-offs

- **[Dynamic import() of theme module]** → Theme module side effects run during build. If the theme module has heavy side effects (font loading, network calls), this adds build-time cost. Mitigation: document that theme modules should be pure computation.
- **[Auto-detection may find wrong file]** → If `src/theme.ts` exists but isn't the Animus theme, the plugin will try to evaluate it and fail confusingly. Mitigation: validate that the evaluated module has the expected shape (`_variables`, `_tokens`), and fall back to empty theme with a warning if not.
- **[@animus-ui/core must be installed]** → The plugin dynamically imports from `@animus-ui/core` at build time. If the package isn't installed, the import fails. Mitigation: `@animus-ui/core` is already a dependency of the plugin (GAP 1 fix).

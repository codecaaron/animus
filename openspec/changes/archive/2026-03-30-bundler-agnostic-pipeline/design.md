## Context

The extraction pipeline requires 7 JSON arguments to call `analyzeProject()`. Currently, the system provides 2 via `ds.serialize()` (propConfig, groupRegistry) and the vite-plugin provides 4 via `evaluateThemeObject()` (scalesJson, variableMapJson, variableCss, contextualVarsJson). The 7th (fileEntries) is host-specific.

The theme already assembles most of the data at `.build()` time — `assembleManifest()` in `createTheme.ts` produces `tokenMap`, `variableMap`, `variableCss`, `contextualVars`, `modes`. However, `assembleManifest` currently **skips breakpoints** in `tokenMap`, and the Rust crate's `extract_breakpoints()` expects `"breakpoints.sm": "768"` entries in the theme JSON.

Additionally, the vite-plugin's `evaluateThemeObject()` manifest fast path has **never been exercised in production** — the plugin loads the theme through a subprocess (`JSON.stringify`), which strips the non-enumerable `.manifest` property. The parsed theme always falls through to the legacy evaluation path. This means `.evaluate()` is a new-and-better path, not a port of existing production behavior. It must be verified against the legacy path's output to ensure equivalence.

Global styles resolution (`resolveGlobalStyles`) is also pure — it takes serialized propConfig + flattened theme + transforms and produces CSS. No Vite dependency.

## Goals / Non-Goals

**Goals:**
- Theme self-evaluates: `tokens.evaluate()` returns pipeline-ready JSON strings
- Global styles resolution callable without vite-plugin
- Vite-plugin imports from system instead of maintaining duplicate logic
- New `@animus-ui/system/pipeline` subpath export for build tooling
- Integration test workspace (follow-up change) can depend on system + extract only

**Non-Goals:**
- Changing the NAPI function signatures (analyzeProject stays the same)
- Moving the legacy theme evaluation path (no-manifest fallback stays in vite-plugin)
- Creating a webpack/rspack plugin (just enabling one in the future)
- Changing the consumer-facing API of `@animus-ui/system`

## Decisions

### Decision 0: Fix `assembleManifest` to include breakpoints in `tokenMap`

`assembleManifest()` currently skips the `breakpoints` scale when building `tokenMap`. The Rust crate's `extract_breakpoints()` expects entries like `"breakpoints.sm": "768"` in the theme JSON. Without this fix, `.evaluate()` would produce scalesJson missing breakpoints, causing silent failure of all responsive media queries.

**Fix:** Remove the `breakpoints` skip from the assembly loop. Breakpoints become regular tokenMap entries (`"breakpoints.xs": "480"`, etc.), matching what the legacy evaluation path produces.

**Why this is safe:** The manifest `variableMap` won't include breakpoints (they're not CSS variables), and `variableCss` won't emit breakpoint variables. Only `tokenMap` gains entries. The Rust crate consumes them correctly via `extract_breakpoints()`.

### Decision 1: `.evaluate()` as non-enumerable method on theme build output

Add `.evaluate()` via `Object.defineProperty` alongside the existing `.manifest`, in the ThemeBuilder's `.build()` method. Returns `{ scalesJson, variableMapJson, variableCss, contextualVarsJson }`.

**Why over standalone function:** Mirrors `ds.serialize()` — the object knows how to prepare itself. No import needed beyond the theme object itself. The manifest data is already on the object; evaluate just stringifies it.

**Why non-enumerable:** Same as `.manifest` — consumers spreading the theme shouldn't pick up pipeline methods. These are infrastructure concerns, not consumer API.

**Note on subprocess vs direct import:** The vite-plugin's current subprocess model strips `.manifest` (non-enumerable) via JSON serialization. The plugin will continue using the legacy path through the subprocess. `.evaluate()` is available when the theme is imported directly — test harnesses, future bundler plugins that can import ESM in-process, or any host that has the live theme object. This is a strictly better path than the legacy one, not a replacement of it within the current vite-plugin subprocess architecture.

**Alternative considered:** `evaluateTheme(tokens)` as an exported function. Works, but breaks the symmetry with `ds.serialize()` (method on the instance). The method approach means any code that has the theme object can evaluate it without importing a separate function.

### Decision 2: `@animus-ui/system/pipeline` subpath export

New subpath export at `./pipeline` containing:
- `resolveGlobalStyles(globalStyles, propConfigJson, scalesJson, transforms)` — pure function
- `camelToKebab(s)` — CSS property name conversion utility
- Re-export of `EvaluatedTheme` and `SerializedConfig` types for consumers building tooling

**Why subpath over main export:** Keeps `@animus-ui/system` clean for component authors. Pipeline utilities are for build tooling authors (plugin developers, test harnesses). Follows the `./groups` pattern.

**Alternative considered:** Export from main `@animus-ui/system`. Pollutes the consumer namespace with functions they never call.

### Decision 3: Vite-plugin keeps legacy fallback, imports modern path

The vite-plugin's `evaluateThemeObject()` becomes:
1. Check for `.evaluate()` method on theme → use it (modern path, from system)
2. Fall back to local `evaluateThemeObjectLegacy()` (themes without manifest)

The legacy path and its helpers (`flattenScale`, `flattenModeTokens` for legacy, `buildVariableCss` for legacy) stay in vite-plugin. Only the modern path moves.

**Why keep legacy in plugin:** Legacy themes (pre-manifest) are a backwards-compat concern of the host (vite-plugin). The system package shouldn't carry dead code for themes that don't use its builder. If a webpack plugin needs the same fallback, it can copy the ~80 lines.

**Alternative considered:** Move everything including legacy. Creates unnecessary baggage in system for a codepath that should eventually be removed.

### Decision 4: `resolveGlobalStyles` signature change

Current signature in vite-plugin:
```typescript
resolveGlobalStyles(globalStyles, propConfigJson, flat: Record<string,string>, transforms)
```

The `flat` parameter is a parsed JSON object (the flattened theme). In the new location, accept the JSON string directly (consistent with how `evaluateTheme` returns `scalesJson`) and parse internally, OR keep the parsed form and document that callers parse `scalesJson` first.

**Decision:** Accept parsed form. The caller (vite-plugin or test harness) already has the parsed flat theme from other operations. Avoid double-parse.

## Risks / Trade-offs

- **[Risk] Breakage in vite-plugin import paths** → Mitigation: `verify:full` must pass including showcase build. The showcase IS the end-to-end proof.
- **[Risk] Subpath export not resolved by consumers' bundlers** → Mitigation: Same pattern as `./groups` which already works. tsdown handles subpath bundling.
- **[Risk] `.evaluate()` not available on theme objects created outside ThemeBuilder** → By design. Only ThemeBuilder themes get `.evaluate()`. Raw objects use the legacy path in vite-plugin.
- **[Trade-off] Legacy code stays duplicated in vite-plugin** → Acceptable. It's ~80 lines of backwards-compat that should eventually be removed. Not worth importing into system.

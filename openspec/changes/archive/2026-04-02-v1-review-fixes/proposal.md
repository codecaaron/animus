## Why

V2 review (3 independent reviewers with FAQ grounding) identified 4 concrete bugs — all silent failures or misleading errors with no design ambiguity. Each was caught independently by at least one reviewer, and none overlap with FAQ-covered topics. These are real gaps that would bite adopters.

## What Changes

- **Fix `applyPrefix` contextualVarsJson gap** — When `prefix` is configured, contextual variable CSS (`--current-bg`) stays unprefixed while all other variables are prefixed (`--acme-color-bg`). The `var()` references inside contextual var rules point to nonexistent names. Silent CSS breakage.
- **Fix `resolveTokenRefs` opacity dead code** — `return opacity ? refValue : refValue` on line 653 of `createTheme.ts` silently drops opacity modifiers on cross-scale token refs in theme definitions. Both branches return the same value.
- **Deduplicate UNITLESS_PROPERTIES** — The unitless property set is defined in both `extract/pipeline/unit-fallback.ts` and `system/src/runtime/resolveClasses.ts` with 4 legacy properties (`box-flex`, `box-flex-group`, `box-ordinal-group`, `flex-order`) present in the pipeline but missing from the runtime. Static and dynamic paths produce different CSS for the same value.
- **Fix loadSystem error message and export detection** — Error says `.serialize()` but checks `.toConfig()`. Only recognizes export names `ds`, `default`, `system` with no diagnostic naming the valid names or listing what was found.

## Capabilities

### New Capabilities

_None — all fixes to existing capabilities._

### Modified Capabilities

- `token-alias-syntax`: Fix opacity resolution in theme-level cross-scale token refs
- `unit-fallback`: Deduplicate unitless property set between pipeline and runtime
- `extract-pipeline`: Fix applyPrefix to cover contextualVarsJson
- `system-serialization`: Fix loadSystem export detection and error messaging

## Impact

- `packages/extract/pipeline/prefix.ts` — extend `applyPrefix` for contextualVarsJson
- `packages/system/src/theme/createTheme.ts` — fix `resolveTokenRefs` opacity branch
- `packages/extract/pipeline/unit-fallback.ts` — extract shared UNITLESS set
- `packages/system/src/runtime/resolveClasses.ts` — import shared UNITLESS set
- `packages/vite-plugin/src/index.ts` — fix loadSystem error message + export detection
- `packages/next-plugin/src/plugin.ts` — fix loadSystem error message + export detection
- No API changes, no breaking changes

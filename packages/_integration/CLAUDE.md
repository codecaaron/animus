# @animus-ui/integration — Pipeline Test Infrastructure

Test workspace for full extraction pipeline E2E tests. Not a publishable package — exists solely to verify that serialize → NAPI → post-process produces correct CSS.

## Convergence Axiom

Canary tests (in `extract/tests/`) and integration tests share the same fixture source: `extract/tests/test-system.ts`. This ensures both tiers use identical theme, prop config, and group registry. If they diverge, the "edges-inward" coverage model breaks.

Re-exported via `fixtures/setup.ts` → imports from `extract/tests/test-system.ts`.

## Pipeline Helper

`__tests__/run-pipeline.ts` mirrors the vite-plugin's `runAnalysis()` function:
1. `analyzeProject()` — NAPI call with serialized config
2. `resolveTransformPlaceholders()` — if CSS contains `__TRANSFORM__` markers
3. `applyUnitFallback()` — append `px` to bare numerics on length properties

Every integration test uses this helper. It IS the authoritative pipeline path minus file discovery and subprocesses.

## Token Invariant Guard

`__tests__/assert-no-unresolved-tokens.ts` — derives color token names programmatically from `tokens.serialize().variableMapJson` and asserts they don't appear as raw values in extracted CSS. Every `runPipeline()` call must include this guard.

Covers color tokens only. Scale tokens (font, space) resolve to literals not var() refs, so they're not detectable by this mechanism.

## Test Files

| File | What it tests |
|------|--------------|
| `extraction.test.ts` | Variant resolution, compound resolution, transforms, system props, responsive, multi-file |
| `serialization.test.ts` | Round-trip: serialize() → analyzeProject() → valid manifest |
| `composition.test.ts` | compose() through full pipeline, slot CSS, shared variants |
| `post-processing.test.ts` | applyUnitFallback, resolveTokenAliases (parametrized) |

## Fixtures

`fixtures/components/` contains real `.tsx` files using the builder chain API. They are parsed by OXC during extraction — not synthetic strings. Each exercises a specific extraction behavior (variants, compounds, composition, system props, transforms, layout).

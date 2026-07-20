# @animus-ui/integration — Pipeline Test Infrastructure

Test workspace for full extraction pipeline E2E tests. Not a publishable package — exists solely to verify that serialize → NAPI → post-process produces correct CSS.

## Convergence Axiom

Canary tests (in `extract/tests/`) and integration tests share the same fixture source: `extract/tests/test-system.ts`. This ensures both tiers use identical theme, prop config, and group registry. If they diverge, the "edges-inward" coverage model breaks.

Re-exported via `fixtures/setup.ts` → imports from `extract/tests/test-system.ts`.

## Pipeline Helper

`__tests__/run-pipeline.ts` drives the stateful v2 `ExtractEngine` the same way
the production plugins do (via `extract/pipeline/engine-adapter.ts`):

1. `analyzeProject()` — a positional v2-backed shim (retained v1 NAPI argument
   shape) that builds `EngineOptions`, constructs a fresh `ExtractEngine`, and
   returns its `analyze()` manifest JSON
2. `applyUnitFallback()` — append `px` to bare numerics on length properties

Extraction-semantics tests use this helper (or import its `analyzeProject` /
`clearAnalysisCache` exports for direct calls). It IS the authoritative pipeline
path minus file discovery and subprocesses. Plugin lifecycle coverage uses a
real Vite build instead.

## NAPI Loading Contract

Since retire-extract-v1, v2 is the only engine and `index-v2.js` is the package
root entry. Test files reach the engine **through `__tests__/run-pipeline.ts`**;
the one `require()` into the native binary lives there and MUST use the **direct
file path** to the v2 loader:

```ts
const native = require('../../extract/index-v2.js');
```

`require('@animus-ui/extract')` (package resolution via `createRequire`) is
forbidden in `_integration` tests.

**Why:** Bun 1.3.12 shipped a `createRequire` polyfill regression (resolved in later bun releases, but the contract holds for resilience). When invoked from `_integration`, package resolution matched the `"types"` export condition first and loaded a `.d.ts` instead of the `.js` loader. All engine exports became `undefined` — tests passed locally on bun versions without the regression and failed silently on CI (session 69 incident).

The direct-path pattern bypasses package resolution entirely, so it is immune to `createRequire` divergence between bun and Node.js.

**ES imports from `@animus-ui/extract/pipeline` are permitted** — those resolve via the ES module loader, not `createRequire`, and are not subject to the same bug. Pattern in current tests:

```ts
import { applyUnitFallback } from '@animus-ui/extract/pipeline';
import { analyzeProject } from './run-pipeline'; // v2-backed shim
```

CI enforces the contract via a grep check in the `lint` job (any `require('@animus-ui/extract')` in `packages/_integration/__tests__/` fails the build).

## Token Invariant Guard

`__tests__/assert-no-unresolved-tokens.ts` — derives color token names programmatically from `tokens.serialize().variableMapJson` and asserts they don't appear as raw values in extracted CSS. Every `runPipeline()` call must include this guard.

Covers color tokens only. Scale tokens (font, space) resolve to literals not var() refs, so they're not detectable by this mechanism.

## Test Files

| File                         | What it tests                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `extraction.test.ts`         | Variant resolution, compound resolution, transforms, system props, responsive, multi-file           |
| `serialization.test.ts`      | Round-trip: serialize() → analyzeProject() → valid manifest                                         |
| `composition.test.ts`        | compose() through full pipeline, slot CSS, shared variants                                          |
| `post-processing.test.ts`    | applyUnitFallback, resolveTokenAliases, compatibility-focused resolveTransformPlaceholders coverage |
| `plugin-self-verify.test.ts` | strict self-verification halts a real Vite build when no components are extracted                   |

## Fixtures

`fixtures/components/` contains real `.tsx` files using the builder chain API. They are parsed by OXC during extraction — not synthetic strings. Each exercises a specific extraction behavior (variants, compounds, composition, system props, transforms, layout).

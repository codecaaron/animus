## Why

The vite-plugin currently owns all pipeline orchestration: theme evaluation, global styles resolution, transform post-processing, unit fallback, and namespace prefix application. None of this is Vite-specific — it's extraction pipeline logic that any bundler host would need. A webpack or rspack plugin would have to duplicate hundreds of lines.

The `bundler-agnostic-pipeline` change attempted to fix this by moving `resolveGlobalStyles` to `system/pipeline`, but that was the wrong location — resolution is an extraction concern, not a system concern. System's job is to describe itself (`serialize`). Extract's job is to process that description into CSS.

Additionally, `tokens.evaluate()` and `ds.serialize()` do the same conceptual operation (self-serialize for the pipeline) but use different verbs.

## What Changes

- **Extract gains a JS pipeline entry point** — a single function that takes serialized system + theme data, file entries, and optional globals/transforms, and returns the complete extraction result (manifest + CSS). Wraps NAPI `analyzeProject` + global styles resolution + transform post-processing + unit fallback.
- **Vite-plugin thins to a Vite host** — subprocess loading, file discovery, package resolution, HMR, virtual modules. Pipeline operations import from extract.
- **`tokens.evaluate()` renamed to `tokens.serialize()`** — matches `ds.serialize()`. Same return shape, consistent verb.
- **`system/pipeline` subpath removed** — `resolveGlobalStyles`, `camelToKebab`, `resolveValue` move to extract. `EvaluatedTheme` type renamed to `SerializedTheme` and stays in system types.
- **Global styles resolution moves to extract** — the subprocess script's logic (token alias resolution, @keyframes handling, prop shorthand) becomes an extract JS function.
- **Transform post-processing moves to extract** — `__TRANSFORM__` placeholder resolution becomes part of extract's pipeline, not the plugin's.
- **Unit fallback moves to extract** — `applyUnitFallback()` (px suffix on bare numerics) becomes part of extract's post-processing.

## Capabilities

### New Capabilities
- `extract-pipeline`: JS pipeline entry point in extract that orchestrates NAPI analysis + global styles + transforms + unit fallback. Any bundler host calls this instead of wiring NAPI directly.

### Modified Capabilities
- `vite-extraction-plugin`: Plugin imports pipeline from extract instead of owning orchestration logic. Keeps only Vite-specific concerns.
- `system-serialization`: `tokens.evaluate()` renamed to `tokens.serialize()`. `EvaluatedTheme` renamed to `SerializedTheme`. `system/pipeline` subpath removed.

## Impact

- `packages/extract/` — gains `src/pipeline.ts` (or similar) JS module alongside existing NAPI bindings. New subpath export or re-export from main entry.
- `packages/extract/package.json` — may gain `@animus-ui/system` as devDep for types, or use inline types.
- `packages/vite-plugin/src/index.ts` — `runAnalysis()`, `applyUnitFallback()`, `applyPrefix()` replaced with calls to extract pipeline. Significant code removal.
- `packages/vite-plugin/src/resolve-global-styles.ts` — logic moves to extract. File may become a thin subprocess wrapper that imports from extract.
- `packages/vite-plugin/src/theme-evaluator.ts` — legacy path stays (backwards compat for subprocess-deserialized themes). Modern path calls `tokens.serialize()`.
- `packages/system/src/theme/createTheme.ts` — `.evaluate()` renamed to `.serialize()`.
- `packages/system/src/types/theme.ts` — `EvaluatedTheme` renamed to `SerializedTheme`.
- `packages/system/src/pipeline/` — directory removed (contents move to extract).
- `packages/system/package.json` — `./pipeline` subpath export removed.
- `packages/system/tsdown.config.ts` — pipeline entry removed.
- Root `package.json` — no changes.

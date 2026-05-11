## Context

The extraction pipeline currently works like this:

```
vite-plugin (orchestrator)
  ├── subprocess: load system → ds.serialize() + tokens
  ├── evaluateThemeObject(tokens) → 4 JSON strings
  ├── subprocess: resolve-global-styles.ts → globalCss
  ├── NAPI: analyzeProject(...) → manifest + CSS
  ├── subprocess: resolve __TRANSFORM__ placeholders
  ├── applyUnitFallback(css) → px-suffixed CSS
  ├── applyPrefix(variableMapJson, variableCss) → namespaced vars
  └── serve via virtual modules
```

Steps 2-6 are not Vite-specific. The vite-plugin should only own: subprocess spawning, file discovery, package resolution (Vite resolver), virtual modules, HMR.

The `bundler-agnostic-pipeline` change already added `tokens.evaluate()` (should be `serialize()`) and fixed the breakpoints gap in `assembleManifest`. It also moved `resolveGlobalStyles` to `system/pipeline`, which was the wrong package. That code is currently in system but belongs in extract.

## Goals / Non-Goals

**Goals:**
- Extract exposes a JS pipeline entry point: `runExtraction(opts) → ExtractionResult`
- All pipeline operations (NAPI + global styles + transforms + unit fallback + prefix) live in extract
- Vite-plugin thins to Vite host — imports pipeline from extract
- `tokens.evaluate()` → `tokens.serialize()` (naming alignment)
- `system/pipeline` subpath removed (contents move to extract)
- Integration test workspace can call extract directly

**Non-Goals:**
- Changing the Rust crate's internal structure (NAPI signatures stay the same)
- Moving Lightning CSS post-processing (autoprefixing/minification is a host formatting choice)
- Eliminating the subprocess model in vite-plugin (ESM isolation is a host concern)
- Building a webpack plugin (just enabling one)

## Decisions

### Decision 1: Extract's JS pipeline entry point

Extract gains a `runExtraction()` function exported from its JS entry point:

```typescript
interface ExtractionInput {
  fileEntries: FileEntry[];
  config: SerializedConfig;     // from ds.serialize()
  theme: SerializedTheme;       // from tokens.serialize()
  globalStyles?: Record<string, Record<string, Record<string, any>>>;
  transforms?: Record<string, (v: any) => any>;
  options?: {
    devMode?: boolean;
    prefix?: string;
  };
}

interface ExtractionResult {
  manifest: UniverseManifest;
  css: string;                  // Component CSS (transforms resolved, unit fallback applied)
  globalCss: string;            // @layer global { ... }
  sheets?: Record<string, string>; // Per-layer CSS (dev mode)
  systemPropMap: Record<string, any>;
  dynamicProps: Record<string, any>;
}

export function runExtraction(input: ExtractionInput): ExtractionResult;
```

This wraps the full pipeline: NAPI `analyzeProject` → transform resolution → unit fallback → prefix application → global styles resolution.

**Why a single function:** Consumers (vite-plugin, test harness, future webpack plugin) call one function with serialized data and get back everything they need. No multi-step orchestration required.

**Why JS, not Rust:** Global styles resolution and transform post-processing require live JS functions (transforms from the system module). These can't move into the Rust crate without a JS→Rust callback mechanism.

### Decision 2: Global styles resolution moves to extract JS

The `resolve-global-styles.ts` subprocess logic (resolveBlock, resolveTokenAliases, camelToKebab) moves to extract as an importable JS function:

```typescript
export function resolveGlobalStyles(
  globalStyles: Record<string, Record<string, Record<string, any>>>,
  propConfig: Record<string, PropConfigEntry>,
  flat: Record<string, string>,
  variableMap: Record<string, string>,
  transforms: Record<string, (v: any) => any>
): string;
```

The vite-plugin's subprocess script then imports from extract instead of maintaining its own copy. The subprocess boundary (ESM isolation) stays — the function call just changes.

**Why include variableMap as a param:** The current subprocess builds its own variableMap from the flat theme. Making it explicit is cleaner and avoids re-derivation.

### Decision 3: Transform resolution moves to extract JS

Currently, the vite-plugin builds a temporary bun script to resolve `__TRANSFORM__` placeholders in CSS. This moves to a function in extract:

```typescript
export function resolveTransformPlaceholders(
  css: string,
  transforms: Record<string, (v: any) => any>
): string;
```

Pattern: `__TRANSFORM__size__0.5__` → call `transforms.size(0.5)` → `"0.5rem"`.

### Decision 4: Unit fallback and prefix move to extract

`applyUnitFallback(css)` and `applyPrefix(prefix, variableMapJson, variableCss)` move from vite-plugin to extract. These are deterministic CSS transformations that any host needs.

### Decision 5: Naming standardization

| Before | After |
|---|---|
| `tokens.evaluate()` | `tokens.serialize()` |
| `EvaluatedTheme` type | `SerializedTheme` type |
| `@animus-ui/system/pipeline` | removed |

Both builders use `.serialize()` — same verb for the same operation (produce pipeline-ready JSON).

### Decision 6: Extract package structure

```
packages/extract/
  src/
    lib.rs                    (existing NAPI crate)
  pipeline/
    index.ts                  (runExtraction entry point)
    resolve-global-styles.ts  (moved from vite-plugin)
    resolve-transforms.ts     (extracted from vite-plugin)
    unit-fallback.ts          (moved from vite-plugin)
    prefix.ts                 (moved from vite-plugin)
    utils.ts                  (camelToKebab, etc.)
  index.d.ts                  (existing NAPI type declarations)
  index.js                    (existing NAPI bindings)
```

The `pipeline/` directory is separate from the NAPI bindings. It's pure JS that wraps the native functions. Published alongside the `.node` binary.

**Open question:** Whether this becomes a subpath export (`@animus-ui/extract/pipeline`) or is exported from the main entry. Leaning toward main entry — extract IS the pipeline.

## Risks / Trade-offs

- **[Risk] Extract gains a JS build step** — currently extract is Rust-only (NAPI build). Adding JS pipeline files requires a build step or ships as source. → Mitigation: tsdown entry point, same as system/vite-plugin.
- **[Risk] Circular dependency** — extract depends on system for types (SerializedTheme, SerializedConfig). System already depends on nothing. This is a one-way dependency, not circular.
- **[Risk] Subprocess script import resolution** — vite-plugin's subprocess runs via `bun run`. It needs to resolve `@animus-ui/extract` at runtime. → Mitigation: workspace symlink, same as current `@animus-ui/system` resolution.
- **[Trade-off] vite-plugin's resolve-global-styles.ts becomes a thin subprocess wrapper** — the subprocess still exists for ESM isolation, but it imports the actual resolution from extract instead of inlining it.
- **[Trade-off] Extract package grows** — from pure NAPI bindings to NAPI + JS pipeline. This is architecturally correct — extract IS the extraction pipeline, not just the Rust part.

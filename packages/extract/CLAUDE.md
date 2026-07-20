# @animus-ui/extract — Rust NAPI Extraction Crate

Static CSS extraction pipeline. Parses TS/TSX via OXC, walks builder chains, evaluates static styles, resolves theme scales, generates `@layer`-structured CSS, and emits source replacements. v2 is the only engine (v1 was retired — openspec: retire-extract-v1).

## Crate Structure

Two independent Rust crates (no Cargo workspace; each has its own
`rust-toolchain.toml`, both pinned to the OXC 0.139 toolchain):

```
crates/
  extract-v2/         — the extraction engine (napi cdylib `animus-extract-v2`)
    src/lib.rs        — NAPI entry points (ExtractEngine class + free functions)
    src/engine.rs     — stateful ExtractEngine (parse-once, retained facts)
    src/pipeline.rs   — multi-file universe analysis + manifest generation
    src/{chain_walk,chain_merge,cross_file,reconcile}.rs — chain/provenance/reconciliation
    src/{eval,evaluator,theme,transforms}.rs — static eval + theme/token resolution
    src/{css,analyze_css,assemble,emit}.rs   — @layer CSS generation + source emission
    src/{jsx_scan,facts,usage_facts,dynamic_meta}.rs — usage scanning + fact extraction
  system-loader/      — shared SystemInstance loader crate, linked by extract-v2
    src/lib.rs        — load/evaluate a system module (rquickjs), keyframes extraction
```

The `.cargo/config.toml` at the package root supplies the napi cdylib linker
flags for BOTH crates (cargo walks up from the invocation dir); neither crate
has its own `.cargo`. Do not delete it.

## NAPI Surface (`crates/extract-v2`, generated types at `crates/extract-v2/index.d.ts`)

Loaded via the hand-written `index-v2.js` loader (fail-loud on missing binary).
`index-v2.js` is the package root entry (the transitional `./engine-v2` alias was removed with the receipt-union cleanup).

### `class ExtractEngine`

- `new ExtractEngine(options?: EngineOptions)` — config object (all fields
  optional, absent = v1 defaults): `themeJson`, `variableMapJson`,
  `contextualVarsJson`, `configJson`, `groupRegistryJson`,
  `selectorAliasesJson`, `globalStyleBlocksJson`, `keyframesJson`,
  `packageResolutionJson`, `pathAliasesJson`, `runtimeImport`, `cssModuleId`,
  `systemPropsModuleId`, `devMode`. NAPI `Option<String>` fields reject `null`
  (coerce with `?? undefined`). No selector-order field (retired).
- `analyze(fileEntriesJson) → string` — parse-once fact extraction over the
  file set; retains facts+sources on the handle. Returns the JSON manifest
  (resolved components, merged configs, complete CSS, per-component
  `component_fragments`, `sheets`, `system_prop_map`, `report`, provenance).
- `transformFile(path) → string` — per-file `{ code, hasComponents }` JSON from
  retained source+facts.
- `clearCache()` — reset retained build state. `get parseCount(): number`.

### Free functions

- `loadSystemModule(systemPath, rootDir, exportName?) → NapiSystemConfig` —
  strips TS types via OXC, bundles + evaluates the SystemInstance with rquickjs,
  returns `{ propConfig, groupRegistry, scalesJson, variableMapJson,
variableCss, contextualVarsJson, selectorAliases?, selectorOrder?,
globalStyleBlocks?, keyframesBlocks? }` (snake_case → camelCase auto).
- `discoverChains(fileEntriesJson) → string`, `extractFacts(fileEntriesJson) → string`,
  `engineVersion() → string` — fact/probe surfaces consumed by the parity harness.

**Note:** `variableMapJson` maps `"token_path" → "css_variable_name"` for
compile-time `{scale.path}` → `var(--name)` resolution.

## Build Commands

```bash
# Production build (from repo root): v2 NAPI + TS dists
vp run build:extract          # = build:v2 && build:ts
vp run build:extract-v2       # v2 NAPI only

# From this directory
bun run build:v2              # release NAPI (cd crates/extract-v2 && napi build --release)
bun run build:v2:debug        # debug NAPI
```

## Cache & Artifacts

| Artifact          | Location                                                                | Notes                                                |
| ----------------- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| Cargo build cache | `crates/extract-v2/target/`, `crates/system-loader/target/`             | Managed by cargo. Safe to delete, rebuilds in 30-60s |
| NAPI binary       | `crates/extract-v2/*.node` (e.g. `animus-extract-v2.darwin-arm64.node`) | The native addon loaded by `index-v2.js`             |

## Pipeline Phases

`crates/extract-v2/src/pipeline.rs` orchestrates multi-file extraction:

1. **Parse + Walk** — find `.asElement()`/`.asComponent()`/`.asClass()` terminals, walk backward
2. **Resolve Bindings** — cross-file binding map (where each export originates)
3. **Resolve Provenance** — match `.extend()` chains to parent components across files
4. **Evaluate Chains** — static eval + theme resolution per chain, chain merge for extensions
5. **Scan + Reconcile** — JSX usage scan, prune unused variants/states
6. **Generate** — `@layer`-structured CSS + `createComponent()` replacements

## Key Design Decisions

- **Per-property skip model:** a non-static value (identifier, call, ternary) skips THAT PROPERTY only and continues; skipped props become dynamic prop candidates. Graceful degradation, not all-or-nothing bail.
- **Stable class names:** from `filename::binding` hash, NOT from style values — editing a style value doesn't change the class name (critical for HMR).
- **Two AST passes per file:** one for chain walking, one for JSX scanning (different traversals).
- **Parse-once engine:** `ExtractEngine.analyze()` parses each file once and retains facts+sources on the handle; `clearCache()` resets.

## Known Failure Modes

- **Stale `.node` binary after signature change:** adding/removing/reordering NAPI parameters silently accepts wrong arity or crashes. Fix: `rm crates/extract-v2/*.node && vp run build:extract-v2`.
- **OXC version:** consumed via the `oxc` umbrella crate (pinned `0.139`), not individual `oxc_*` crates.
- **Per-property bail diagnostics:** check `[skip]` markers in extraction errors for what was skipped.

## Debugging Quick-Ref

| Symptom                              | Fix                                                   |
| ------------------------------------ | ----------------------------------------------------- |
| Styles not updating in dev           | Restart dev server                                    |
| Transforms seem stale                | `vp run clean:light`                                  |
| NAPI function errors / wrong arity   | `vp run build:extract-v2`                             |
| `verify:canary` "NAPI stale" error   | `vp run build:extract-v2`                             |
| `verify:*` "dist missing" error      | `vp run build:ts` (or `vp run build:all`)             |
| Showcase builds but styles missing   | Check `virtual:animus/styles.css` in browser devtools |
| CSS has `__TRANSFORM__` placeholders | Transform subprocess failed — check terminal warnings |

## Verification

For verification commands, see the root `AGENTS.md` § Verification Interface. The relevant atomic tiers for changes here are `verify:unit:rust`, `verify:canary`, and `verify:integration` — consult the root Change-Type Map for the minimum set per edit surface.

# @animus-ui/extract — Rust NAPI Extraction Crate

Static CSS extraction pipeline. Parses TS/TSX via OXC, walks builder chains, evaluates static styles, resolves theme scales, generates `@layer`-structured CSS, and emits source replacements.

## Crate Structure

```
src/
  lib.rs              — NAPI entry points (3 exported functions)
  chain_walker.rs     — Find .asElement()/.asComponent() terminals, walk chain backwards
  style_evaluator.rs  — ObjectExpression AST → serde_json::Value (static eval)
  theme_resolver.rs   — Scale lookup, token alias resolution ({scale.path} → var())
  css_generator.rs    — Style values → @layer CSS (base, variants, states, system, custom)
  jsx_scanner.rs      — Scan JSX for system prop / custom prop usage
  transform_emitter.rs — Generate createComponent() replacement + CSS import
  project_analyzer.rs — Multi-file universe analysis, manifest generation
  chain_merger.rs     — Merge extension chains with parent configs
  import_resolver.rs  — Cross-file import resolution
  reconciler.rs       — Reconcile chain configs across files
```

## NAPI Functions

### `extract(source, filename, theme_json, variable_map_json, config_json, group_registry_json) → ExtractionResult`
Per-file extraction. Returns `{ css, code, source_map, extractable, errors }`.

### `analyze_project(file_entries_json, theme_json, variable_map_json, contextual_vars_json?, config_json, group_registry_json, package_resolution_json, dev_mode?, prefix?, selector_aliases_json?, selector_order_json?, global_style_blocks_json?) → String`
Project-level analysis. Accepts all source files, returns JSON manifest with resolved components, merged configs, complete CSS, per-component CSS fragments, and reverse provenance. `dev_mode` splits CSS into per-layer sheets. Manifest includes `component_fragments` (per-component CSS keyed by component_id) and `reverse_provenance` (parent → children for extension chain invalidation).

### `load_system_module(system_path, root_dir, export_name?) → NapiSystemConfig`
Load and evaluate a SystemInstance module. Reads the file from disk, strips TS types via OXC, resolves workspace package dependencies, bundles all modules, evaluates with rquickjs, calls `.toConfig()` and `.serialize()`. Returns `{ propConfig, groupRegistry, scalesJson, variableMapJson, variableCss, contextualVarsJson, selectorAliases?, selectorOrder?, globalStyleBlocks? }`. NAPI-rs auto-converts snake_case to camelCase.

### `transform_file(source, filename, manifest_json) → TransformResult`
Per-file source transformation using pre-computed manifest. Returns `{ code, hasComponents }`.

**Note:** `variable_map_json` was added in the token alias arc. It maps `"token_path" → "css_variable_name"` for compile-time `{scale.path}` → `var(--name)` resolution.

## Build Commands

```bash
# Production build (from repo root)
vp run build:extract

# Debug build (from this directory)
napi build --platform

# Production build (from this directory)
napi build --platform --release
```

## Cache & Artifacts

| Artifact | Location | Notes |
|----------|----------|-------|
| Cargo build cache | `target/` | Managed by cargo. Safe to delete, rebuilds in 30-60s |
| NAPI binary | `*.node` (e.g., `animus-extract.darwin-arm64.node`) | The actual native addon loaded by Node.js |

## Project Analyzer: 6-Phase Pipeline

`project_analyzer.rs` orchestrates multi-file extraction in phases:

1. **Parse + Walk** — chain_walker finds all `.asElement()`/`.asComponent()`/`.asClass()` terminals, walks backward
2. **Resolve Bindings** — import_resolver builds cross-file binding map (tracks where each export originates)
3. **Resolve Provenance** — match `.extend()` chains to parent components across files
4. **Evaluate Chains** — style_evaluator + theme_resolver per chain, chain_merger for extensions
5. **Scan + Reconcile** — jsx_scanner detects component usage in JSX, reconciler prunes unused variants/states
6. **Generate** — css_generator emits `@layer`-structured CSS, transform_emitter builds `createComponent()` replacements

## Key Design Decisions

- **Per-property skip model:** When style_evaluator hits a non-static value (identifier, function call, ternary), it skips THAT PROPERTY only and continues evaluating the rest of the object. Skipped properties become dynamic prop candidates. This is graceful degradation, not all-or-nothing bail.
- **Stable class names:** Generated from `filename::binding` hash, NOT from style values. Editing a style value doesn't change the class name — critical for HMR (CSS and JS updates reference the same class).
- **Two AST parses per file:** One for chain walking (finding builder chains), one for JSX scanning (finding component usage). Separate passes because chain walking needs different AST traversal than JSX element scanning.
- **Cache by content hash:** `project_analyzer` caches per-file results keyed by MD5 hash. On cache hit, full re-parse is skipped. Cache is unbounded (cleared only by `clear_analysis_cache()`).

## Known Failure Modes

- **Stale `.node` binary after signature change:** If you add/remove/reorder NAPI function parameters, the old binary silently accepts wrong arity or crashes at runtime. Fix: `rm *.node && napi build --platform --release`
- **OXC version mismatch:** All `oxc_*` crates must be the same version. Cargo.toml pins them together at `0.121.0`.
- **Per-property bail diagnostics:** The style evaluator skips non-static properties individually (not entire objects). Check `[skip]` markers in extraction errors for what was skipped.

## Debugging Quick-Ref

Symptom-to-fix table for failure modes that route through extraction or its consumers:

| Symptom | Fix |
|---|---|
| Styles not updating in dev | Restart dev server |
| Transforms seem stale | `bun run clean:light` |
| NAPI function errors / wrong arity | `bun run rebuild` |
| `verify:canary` "NAPI stale" error | `vp run build:extract` |
| `verify:*` "dist missing" error | `vp run build:ts` (or `vp run build:all`) |
| Showcase builds but styles missing | Check `virtual:animus/styles.css` in browser devtools |
| CSS has `__TRANSFORM__` placeholders | Transform subprocess failed — check terminal warnings |
| "Nothing works" | `bun run rebuild` (nuclear option) |

## Verification

For verification commands, see the root `CLAUDE.md` § Verification Tiers. The relevant atomic tiers for changes here are `verify:unit:rust`, `verify:canary`, and `verify:integration` — consult the root Change-Type Map for the minimum set per edit surface.

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

### `analyze_project(file_entries_json, theme_json, variable_map_json, config_json, group_registry_json, package_resolution_json) → String`
Project-level analysis. Accepts all source files, returns JSON manifest with resolved components, merged configs, and complete CSS.

### `transform_file(source, filename, manifest_json) → TransformResult`
Per-file source transformation using pre-computed manifest. Returns `{ code, hasComponents }`.

**Note:** `variable_map_json` was added in the token alias arc. It maps `"token_path" → "css_variable_name"` for compile-time `{scale.path}` → `var(--name)` resolution.

## Build Commands

```bash
# Production build (from repo root)
bun run build:extract

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

## Known Failure Modes

- **Stale `.node` binary after signature change:** If you add/remove/reorder NAPI function parameters, the old binary silently accepts wrong arity or crashes at runtime. Fix: `rm *.node && napi build --platform --release`
- **OXC version mismatch:** All `oxc_*` crates must be the same version. Cargo.toml pins them together at `0.121.0`.
- **Per-property bail diagnostics:** The style evaluator skips non-static properties individually (not entire objects). Check `[skip]` markers in extraction errors for what was skipped.

## Verification

```bash
# Run canary tests (from repo root)
bun run test:canary

# Run all tests
bun test
```

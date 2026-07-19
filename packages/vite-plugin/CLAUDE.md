# @animus-ui/vite-plugin — Extraction Plugin

Vite plugin that bridges the Rust extraction crate with the build pipeline. Runs in both dev and production. Loads the design system via NAPI, runs project analysis, serves extracted CSS via virtual module, and transforms source files.

## Plugin Lifecycle

### `buildStart` (runs once on server start / build start)

1. **Load system** — NAPI `loadSystemModule()` reads the system file, strips TS types via OXC, resolves workspace package deps, evaluates with rquickjs, returns propConfig + groupRegistry + tokens + selectorAliases + globalStyles
2. **Discover files** — recursive directory walk for .ts/.tsx/.js/.jsx
3. **Resolve packages** — reads system file imports, resolves external DS packages
4. **Run analysis** — calls `analyzeProject()` from the Rust crate, produces manifest + CSS + per-component fragments

### `resolveId` / `load` (virtual stylesheet)

- Virtual module: `virtual:animus/styles.css` → `\0virtual:animus/styles.css`
- Serves: `[variableCss] + [globalCss] + [resolvedComponentCss]`
- Variable CSS = `:root { --color-*: ... }` + color mode selectors
- Global CSS = `@layer global { reset + global styles }`
- Component CSS = `@layer base/variants/states/system/custom { ... }`

### `transform` (per-file source replacement)

- Replaces builder chains with `createComponent()` calls
- Adds `import 'virtual:animus/styles.css'`
- Uses manifest from `analyzeProject()` for class names and configs

### `handleHotUpdate` (dev HMR)

- Content-hash check skips unchanged files
- **Geological reset:** system file change → full reload via subprocess
- CSS module invalidated alongside changed JS modules

## NAPI Integration

All heavy lifting is done in the Rust NAPI crate — no subprocesses needed.

| NAPI Function          | Purpose                                                     | When                             |
| ---------------------- | ----------------------------------------------------------- | -------------------------------- |
| `loadSystemModule()`   | Read system file, OXC strip, rquickjs eval, return config   | buildStart, HMR geological reset |
| `analyzeProject()`     | Multi-file extraction, CSS generation, transform eval (boa) | buildStart, HMR re-analysis      |
| `transformFile()`      | Per-file builder chain → createComponent() replacement      | transform hook                   |
| `clearAnalysisCache()` | Reset per-file content-hash cache                           | buildStart, geological reset     |

## Vite Cache

**Location:** `node_modules/.vite/`

This cache stores pre-transformed module results. It persists across Vite dev server restarts. When the extraction pipeline changes (new NAPI signatures, new prop config, etc.), the cache may serve stale transforms.

**Fix:** `rm -rf node_modules/.vite/` or `bun run clean:light`

## Known Failure Modes

- **Dev server not reflecting changes:** The dev server holds `buildStart` results in memory. If you change the plugin source, restart the dev server. System file (ds.ts) changes trigger automatic geological reset via HMR.
- **Vite resolve aliases break transforms:** Adding resolve aliases (e.g., for React) can cause Vite to discard transform hook results. The bundler treats aliased modules differently. Never add resolve aliases for packages used by extracted components.
- **Stale `.vite` cache:** After changing NAPI function signatures or plugin behavior, delete `node_modules/.vite/`. Symptoms: transforms appear correct in plugin logs but bundled output uses old code.
- **NAPI errors:** If `loadSystemModule()` or `analyzeProject()` fails, the plugin catches and warns (or throws in strict mode). Check terminal output for `[animus-extract]` warnings.

## Verbose Mode / Debug Logging

Enable with `ANIMUS_DEBUG=1` env var or `verbose: true` plugin option. All output prefixed with `[animus]` for grep filtering.

Two tiers: reconciliation elimination warnings (`⚠ ComponentName eliminated`) are always-on. Phase timing, file counts, per-file transform logs, HMR decisions require verbose mode.

The plugin runs from `dist/index.mjs` — after editing source, rebuild: `bun run --filter './packages/vite-plugin' build`.

## Configuration

```typescript
animusExtract({
  system: './src/ds.ts', // SystemInstance module (required)
  strict: true, // Throw on extraction failures (CI)
  verbose: true, // Enable phase checkpoints + timing (or use ANIMUS_DEBUG=1)
  verify: true, // Run structural self-check at end of buildStart
});
```

### `verify` option

When `verify: true`, the plugin runs a structural self-check at the end of `buildStart` (after project analysis completes):

- Component CSS non-empty (at least one component extracted)
- Assembled CSS has `@layer anm-base` preceding `@layer anm-variants`
- Variable CSS contains a `:root` block
- No `__TRANSFORM__` placeholders in any CSS output

Output is prefixed with `[animus:verify]`. Behavior on failure follows the `strict` option:

- `strict: true` + verify failure → plugin throws, halting the build
- `strict: false` (default) + verify failure → plugin warns via the Vite logger (or `console.warn`) and continues

Success is silent unless `verbose: true`, at which point a single `[animus:verify] structural self-check passed` line is emitted.

Use a complete package-owned claim such as `vp run @animus-ui/vite-app#verify` (or the Next/showcase owner claim) for full-pipeline structural assertions against built output.

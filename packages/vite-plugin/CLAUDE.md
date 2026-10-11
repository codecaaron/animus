# @animus-ui/vite-plugin — Extraction Plugin

Vite plugin that bridges the Rust extraction crate with the build pipeline. Runs in both dev and production. Loads the design system via NAPI, runs project analysis, serves extracted CSS via virtual module, and transforms source files.

## Plugin Lifecycle

### `buildStart` (runs once on server start / build start)

The context owns one `ExtractionSession` (created at `configResolved`, kept in
memory: `persistArtifacts = false`). `buildStart` runs
`session.runFullPipeline()` — system load, discovery, package collection and
analysis — and the context adopts each publication as the Session makes it
(`onOutcome` → `adoptPublication`). Vite keeps its own asset pass
(`hostSubstitutesAssets`), the elimination report and the self-verify. A dev
server starts through an aborted parse with a warning; a build fails on it.

### `resolveId` / `load` (virtual stylesheet)

- Virtual module: `virtual:animus/styles.css` → `\0virtual:animus/styles.css`
- Serves: `[variableCss] + [globalCss] + [resolvedComponentCss]`
- Variable CSS = `:root { --color-*: ... }` + color mode selectors
- Global CSS = `@layer global { reset + global styles }`
- Component CSS = `@layer base/variants/states/system/custom { ... }`

### `transform` (per-file source replacement)

- Replaces builder chains with `createComponent()` calls
- Adds `import 'virtual:animus/styles.css'`
- Uses the Session's published manifest for class names and configs

### `hotUpdate` (dev HMR)

- Handles every dev file event: `update`, `create` and `delete`
- The dispatch that claims an event submits it to the Session
  (`ctx.submitChanges` → `session.handleWatchUpdate`), which reads, hashes,
  analyzes and publishes; Vite acts on the outcomes it collects
- **Unchanged:** a submission that publishes nothing suppresses the update
- **System reload:** a system dependency event reloads through the Session; a
  failure warns and keeps the last good system (the overlay too under `strict`)
- **Hold:** an aborted parse holds publication; its bytes go to Vite's own
  parser (`abortedParseHashes`), and the repair re-delivers what changed
- **Create:** the Session ingests it like an edit; transform-time detection
  submits a file the Session does not hold, as the backstop for creations the
  watcher never reports
- CSS module invalidated alongside changed JS modules
- **Extensions:** a published, non-presentation-only edit also re-delivers every
  module defining a transitive extension of its components (`extendingFiles`),
  since an extension reads inherited callbacks from its parent when it runs
- Vite calls the hook once per environment; the submission runs for one dispatch
  (client first), module invalidation runs against each environment's graph

## NAPI Integration

All heavy lifting is done in the Rust NAPI crate — no subprocesses needed.

| NAPI Function          | Purpose                                                     | When                          |
| ---------------------- | ----------------------------------------------------------- | ----------------------------- |
| `loadSystemModule()`   | Read system file, OXC strip, rquickjs eval, return config   | buildStart, HMR system reload |
| `analyzeProject()`     | Multi-file extraction, CSS generation, transform eval (boa) | buildStart, HMR re-analysis   |
| `transformFile()`      | Per-file builder chain → createComponent() replacement      | transform hook                |
| `clearAnalysisCache()` | Reset per-file content-hash cache                           | buildStart, system reload     |

## Vite Cache

**Location:** `node_modules/.vite/`

This cache stores pre-transformed module results. It persists across Vite dev server restarts. When the extraction pipeline changes (new NAPI signatures, new prop config, etc.), the cache may serve stale transforms.

**Fix:** `rm -rf node_modules/.vite/` or `bun run clean:light`

## Known Failure Modes

- **Dev server not reflecting changes:** The dev server holds `buildStart` results in memory. If you change the plugin source, restart the dev server. System file (ds.ts) changes trigger automatic system reload via HMR.
- **Vite resolve aliases break transforms:** Adding resolve aliases (e.g., for React) can cause Vite to discard transform hook results. The bundler treats aliased modules differently. Never add resolve aliases for packages used by extracted components.
- **Stale `.vite` cache:** After changing NAPI function signatures or plugin behavior, delete `node_modules/.vite/`. Symptoms: transforms appear correct in plugin logs but bundled output uses old code.
- **NAPI errors:** If `loadSystemModule()` or `analyzeProject()` fails, the plugin catches and warns (or throws in strict mode). Check terminal output for `[animus-extract]` warnings.

## Verbose Mode / Debug Logging

All output is prefixed with `[animus]` for grep filtering. Three tiers:

- **Always on:** component elimination warnings (`⚠ ComponentName eliminated`, and in dev `would be eliminated in production`), bail/skip diagnostics, and `info` events.
- **`verbose: true` or `ANIMUS_DEBUG=1`:** phase checkpoints, summaries (reconciliation counts, HMR updates and invalidation totals, system reloads) and timing.
- **`verbose: 'trace'` or `ANIMUS_DEBUG=trace`:** adds one line per item: pruned variant/state options, transformed files, per-file HMR events, skips and invalidations. Use `ctx.trace()` for a new per-item line and `ctx.log()` for a summary.

The plugin runs from `dist/index.mjs` — after editing source, rebuild: `bun run --filter './packages/vite-plugin' build`.

## Configuration

```typescript
animusExtract({
  system: './src/ds.ts', // SystemInstance module (required)
  strict: true, // Throw on extraction failures (CI)
  verbose: true, // Phase checkpoints, summaries + timing (ANIMUS_DEBUG=1); 'trace' adds per-item lines
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

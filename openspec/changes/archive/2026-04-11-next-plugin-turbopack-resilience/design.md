## Context

The current `@animus-ui/next-plugin` architecture was designed for Webpack-era Next.js (circa 2022). It integrates via:
- `AnimusWebpackPlugin.apply(compiler)` → `compiler.hooks.run/watchRun` for analysis timing
- `NormalModuleReplacementPlugin` for virtual module resolution
- A custom loader (`enforce: 'pre'`) for per-file source transformation + CSS injection
- `globalThis` singleton for cross-compiler state sharing

Next.js 16+ defaults to Turbopack, which ignores Webpack plugins entirely. Turbopack supports a limited loader API via `turbopack.rules` but has no equivalent to `compiler.hooks` or `NormalModuleReplacementPlugin`.

The `embedded-transform-eval` change (prereq) eliminates all subprocess IPC from the extraction pipeline. Once it lands, `analyzeProject()` is a single synchronous NAPI call that produces fully-resolved CSS. This enables moving extraction out of the bundler lifecycle entirely.

## Goals / Non-Goals

**Goals:**
- Extraction works identically under Webpack and Turbopack — zero behavioral divergence
- Source transformation works via loaders registered for both bundlers
- CSS delivery uses bundler-native alias resolution, not regex injection
- Dev mode file watching is independent of bundler hooks
- Migration path for existing users is a single import addition

**Non-Goals:**
- SWC plugin integration (rejected — loses OXC's zero-copy arena AST, Wasm overhead, different AST model)
- Turbopack-native plugin API (doesn't exist yet — architecture should survive its eventual arrival)
- Eliminating the system load subprocess (subprocess 1 — remains until a future Rust-native config loader)
- Streaming/incremental extraction (full analysis per run is sufficient at current scale)

## Decisions

### 1. Extraction runs in `withAnimus()`, not in compiler hooks

**Choice**: Call `runExtraction()` synchronously during `withAnimus()` config resolution. The returned config function has the manifest and CSS already computed.

**Rationale**: `withAnimus()` executes when `next.config.ts` is evaluated — before any bundler boots. This is the only lifecycle point shared by Webpack and Turbopack. By the time either bundler starts, `.animus/styles.css` exists on disk and the manifest is ready for the loader.

**Tradeoff**: Config resolution becomes ~200-500ms slower (extraction time). Acceptable — this runs once at startup, not per-request.

**Alternative considered**: Run extraction in a background thread and await it in the first loader call. Rejected — adds complexity and non-deterministic timing. The synchronous model is simpler and the perf cost is paid once.

### 2. User-land CSS import with dual resolve alias

**Choice**: Users add `import '@animus-ui/styles'` to their root layout. `withAnimus()` registers:
- Webpack: `resolve.alias['@animus-ui/styles'] = path.resolve('.animus/styles.css')`
- Turbopack: `turbopack.resolveAlias['@animus-ui/styles'] = path.resolve('.animus/styles.css')`

**Rationale**: Both bundlers support resolve aliases natively. The CSS file is a real file on disk, so both bundlers can watch it, chunk it, and deduplicate it using their own mechanisms. No virtual modules, no regex injection, no `NormalModuleReplacementPlugin`.

**Alternative considered**: Keep auto-injection via loader. Rejected — the regex approach (`ROOT_ENTRY_RE`) is fundamentally brittle and requires tracking every Next.js routing convention. A single explicit import is simpler, more robust, and gives the user control over where CSS loads.

**Migration**: **BREAKING** for existing users. Migration is one line: add `import '@animus-ui/styles'` to root layout. The plugin can warn if the import is missing (check during extraction or loader phase).

### 3. Loader registered for both Webpack and Turbopack

**Choice**: The loader handles only source transformation (calling `transformFile()` via NAPI). CSS injection logic is removed entirely. Registration:

```typescript
// Webpack
config.module.rules.push({ test: /\.[jt]sx?$/, enforce: 'pre', use: loaderPath });
// Turbopack  
config.turbopack = { rules: { '*.tsx': { loaders: [loaderPath] }, '*.ts': { ... } } };
```

**Rationale**: Turbopack supports a subset of Webpack loaders via `turbopack.rules`. The Animus loader is simple enough (read source → call NAPI → return transformed source) to work in both environments. The key simplification is removing all CSS-related logic from the loader.

### 4. Chokidar file watcher for dev HMR

**Choice**: In dev mode, `withAnimus()` spawns a chokidar watcher on the source directories. On file change: hash-check → if changed, re-run `analyzeProject()` → rewrite `.animus/styles.css` → Next.js detects CSS change → hot reload.

**Rationale**: `compiler.hooks.watchRun` is Webpack-only. Chokidar is already used internally by Next.js and Vite. An independent watcher works regardless of which bundler runs the compilation. The CSS file is a real file — both Webpack and Turbopack will detect changes and trigger updates.

**Cleanup**: The watcher should be stopped on process exit. Use `process.on('SIGINT', ...)` and `process.on('exit', ...)`.

### 5. Atomic CSS writes via temp file + rename

**Choice**: Write CSS to `.animus/styles.css.tmp`, then `renameSync()` to `.animus/styles.css`. Content-hash the output to skip writes when nothing changed.

**Rationale**: `rename()` is atomic on POSIX and near-atomic on Windows NTFS. Prevents partial reads when multiple compilers (or the dev server) read the CSS file concurrently. The content-hash skip prevents unnecessary file watches from triggering when extraction produces identical output.

### 6. System props module as a real file, not virtual

**Choice**: Write `.animus/system-props.js` alongside `.animus/styles.css`. Map it via resolve alias: `@animus-ui/system-props` → `.animus/system-props.js`.

**Rationale**: Eliminates `NormalModuleReplacementPlugin` and virtual module resolution entirely. Both bundlers handle real files natively. The file contains the same `systemPropMap`, `dynamicPropConfig`, and `transforms` exports currently served via the virtual module.

## Risks / Trade-offs

**[Risk] Config resolution blocking** → Extraction adds ~200-500ms to config evaluation. Mitigation: This is comparable to current `compiler.hooks.run` timing. Users don't notice because it happens once during `next dev` or `next build` startup.

**[Risk] Chokidar adds a dependency** → Chokidar is ~200KB. Mitigation: Next.js already depends on chokidar internally. The version may differ — pin to a compatible range.

**[Risk] BREAKING: manual CSS import required** → Existing users must add one import line. Mitigation: The plugin can detect missing import during the loader phase (no `@animus-ui/styles` in any processed file) and emit a clear warning with the exact line to add.

**[Risk] Turbopack loader compatibility** → Turbopack's loader support is documented as a subset of Webpack's. Mitigation: The Animus loader uses only basic loader APIs (receive source string, return transformed string). No pitch loaders, no emitFile, no async loader patterns.

**[Risk] File watcher resource usage** → Chokidar in polling mode can be expensive for large directories. Mitigation: Use native FS events (default), limit watch to the same directory patterns used by `discoverFiles()`, debounce rapid changes.

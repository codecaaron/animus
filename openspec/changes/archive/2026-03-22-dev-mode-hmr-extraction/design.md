## Context

The extraction pipeline (Arcs 1-5) and smoke test prove that `analyzeProject` + `transformFile` produce correct CSS and source transformations. The Vite plugin currently guards all extraction behind `isProd` — dev mode is a no-op. This design removes that guard and adds HMR support.

The key Vite plugin hooks for dev mode:
- `configureServer(server)` — access to the dev server, runs once at startup
- `handleHotUpdate({ file, server, modules })` — fires when a file changes, before transform
- `transform(code, id)` — fires for each module, can use manifest from closure
- `resolveId` / `load` — virtual module resolution, serves CSS from manifest

## Goals / Non-Goals

**Goals:**
- Extraction runs in dev mode (`vite dev`), not just production
- File changes trigger manifest re-analysis and CSS hot replacement
- The manifest persists in the plugin closure across HMR cycles
- The smoke test app works with `vite dev` (styles render, HMR updates them)

**Non-Goals:**
- Incremental/differential analysis (full re-analysis on each change for now)
- File watching optimization (all .ts/.tsx files re-analyzed, not just changed ones)
- Emotion removal from @animus-ui/core (that's a separate change to the core package)
- Source maps (still deferred)

## Decisions

### 1. Manifest lives in plugin closure

```typescript
function animusExtract(options) {
  // These persist across the entire dev server lifetime
  let manifest: any = null;
  let manifestJson = '';
  let manifestCss = '';
  let fileEntries: FileEntry[] = [];

  return {
    configureServer(server) { /* initial analysis */ },
    handleHotUpdate(ctx) { /* re-analysis on change */ },
    transform(code, id) { /* uses current manifest */ },
    load(id) { /* serves current manifestCss */ },
  };
}
```

The closure is the SINGLE SOURCE OF TRUTH for the manifest during the dev session. `handleHotUpdate` mutates it. `transform` and `load` read from it.

### 2. configureServer for initial analysis

```typescript
configureServer(server) {
  // Discover files, read sources, run analyzeProject
  // Store manifest in closure
  // This runs ONCE when `vite dev` starts
}
```

`configureServer` fires before any requests. The manifest is ready before the first page load. This replaces `buildStart` for dev mode (though `buildStart` still runs for production builds).

### 3. handleHotUpdate for file changes

```typescript
async handleHotUpdate({ file, server }) {
  if (!isRelevantFile(file)) return;

  // 1. Update the file entry in our stored fileEntries
  const relativePath = relative(rootDir, file);
  const idx = fileEntries.findIndex(e => e.path === relativePath);
  if (idx >= 0) {
    fileEntries[idx].source = readFileSync(file, 'utf-8');
  }

  // 2. Re-run analyzeProject with updated file entries
  manifestJson = analyzeProject(JSON.stringify(fileEntries), ...);
  manifest = JSON.parse(manifestJson);
  manifestCss = manifest.css;

  // 3. Invalidate the CSS virtual module
  const cssModule = server.moduleGraph.getModuleById(RESOLVED_CSS);
  if (cssModule) {
    server.moduleGraph.invalidateModule(cssModule);
    // Send HMR update for the CSS module
    server.ws.send({ type: 'full-reload' });
    // OR for true CSS HMR:
    // server.reloadModule(cssModule);
  }
}
```

### 4. CSS hot replacement strategy

Two options for CSS updates:

**Option A: Full page reload** — simplest. `server.ws.send({ type: 'full-reload' })`. The page reloads with new CSS. Simple but loses React state.

**Option B: CSS module invalidation** — `server.moduleGraph.invalidateModule(cssModule)` marks the CSS as stale. On next request, Vite re-serves it. For HMR, we'd need to send the updated CSS to the client. Vite's CSS HMR expects the CSS to come from a real file or a module that implements HMR accept.

**Option C: Custom HMR via ws.send** — send the CSS update directly:
```typescript
server.ws.send({
  type: 'update',
  updates: [{
    type: 'css-update',
    path: VIRTUAL_CSS,
    timestamp: Date.now(),
  }],
});
```

Start with Option A (full reload). It's correct and simple. Optimize to Option B/C later if the reload is disruptive.

### 5. Remove isProd guard

The current plugin has `if (!isProd) return;` in `buildStart` and `transform`. Remove these guards. Instead, use `configureServer` for dev-mode initialization and `buildStart` for production builds.

```typescript
// Dev mode: configureServer fires, buildStart does NOT
// Prod mode: buildStart fires, configureServer does NOT
configureServer(server) {
  // Dev analysis here
},
buildStart() {
  // Prod analysis here (existing code)
},
```

Actually — both hooks fire in both modes. `configureServer` only fires when a server exists (dev mode). `buildStart` fires in both dev and build. The cleanest approach: do analysis in `buildStart` always, and add `handleHotUpdate` for dev-specific re-analysis.

## Risks / Trade-offs

**[Risk] Full re-analysis on every file change** → For 3-file smoke test: ~3ms. For 500-file project: ~500ms. Mitigation: fast enough for small-medium projects. Incremental analysis is a future optimization with the same interface.

**[Trade-off] Full page reload vs CSS HMR** → Full reload loses React state but is simpler and guaranteed correct. CSS-only HMR preserves state but requires virtual module HMR plumbing. Start with full reload.

**[Risk] Dev/prod CSS mismatch** → If the dev and prod pipelines produce different CSS, developers see one thing in dev and another in prod. Mitigation: both modes use the exact same `analyzeProject` function — the CSS is deterministic from the same inputs.

## 1. Remove Production-Only Guard

- [ ] 1.1 Remove `if (!isProd) return;` from buildStart in the Vite plugin
- [ ] 1.2 Remove `if (!isProd || !storedManifest) return null` guard from transform hook — change to `if (!storedManifest) return null`
- [ ] 1.3 Ensure buildStart runs file discovery + analyzeProject in both dev and build modes

## 2. handleHotUpdate Implementation

- [ ] 2.1 Add `handleHotUpdate` hook to the plugin
- [ ] 2.2 Filter to only relevant file extensions (.ts, .tsx, .js, .jsx)
- [ ] 2.3 Read the changed file's new source
- [ ] 2.4 Update the stored fileEntries array with the new source for the changed path
- [ ] 2.5 Re-run analyzeProject with the updated fileEntries
- [ ] 2.6 Update manifestJson, manifestCss, and storedManifest in the closure
- [ ] 2.7 Invalidate the CSS virtual module via `server.moduleGraph.getModuleById(RESOLVED_CSS)`
- [ ] 2.8 Send update to browser — start with `server.ws.send({ type: 'full-reload' })`

## 3. Closure State Management

- [ ] 3.1 Move fileEntries to plugin closure scope (persistent across HMR cycles)
- [ ] 3.2 Store the dev server reference from configureServer or handleHotUpdate context
- [ ] 3.3 Ensure manifestJson/manifestCss/storedManifest are always in sync after re-analysis

## 4. Smoke Test Verification

- [ ] 4.1 Update smoke test vite.config.ts inline plugin to also remove isProd guard
- [ ] 4.2 Add handleHotUpdate to the inline plugin
- [ ] 4.3 Run `vite dev` on smoke test app — verify initial page renders with extracted styles
- [ ] 4.4 Edit a component's styles — verify browser updates (via full reload)
- [ ] 4.5 Add a new variant option — verify it appears in the re-extracted CSS
- [ ] 4.6 Verify no Emotion imports in the dev build output

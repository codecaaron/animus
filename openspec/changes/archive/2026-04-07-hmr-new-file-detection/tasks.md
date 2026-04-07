## 1. Dev Server Reference

- [x] 1.1 Add `let devServer: any` to plugin closure state
- [x] 1.2 Add `configureServer(server) { devServer = server }` hook to plugin return object

## 2. Transform New File Detection

- [x] 2.1 In `transform` hook, when file is not in manifest AND not in `fileCache`: add to `fileCache` with content hash, call `buildFileEntriesFromCache()` + `runAnalysis()`
- [x] 2.2 After re-analysis, re-check `storedManifest.files` — if file now has components, proceed with normal transform path
- [x] 2.3 After successful new-file extraction, invalidate `RESOLVED_COMPONENTS_ID` and `RESOLVED_SYSTEM_PROPS_ID` via stored `devServer` reference
- [x] 2.4 Trigger deferred full-reload via `devServer.hot.send({ type: 'full-reload' })` after 100ms — virtual module HMR path matching is fragile for programmatic sends, full reload is reliable and new-file creation is rare
- [x] 2.5 Add log message for new file detection (file path + component count)

## 3. Verification

- [x] 3.1 `bun run verify:showcase` passes (no regressions)
- [x] 3.2 Manual test: create new component file during `vite dev`, import it, verify styles appear without restart — confirmed via Playwright (badge renders with primary bg, mono font, inline-flex)
- [x] 3.3 Manual test: create new non-component file, verify no errors — confirmed via Playwright (formatTestLabel utility rendered correctly, no console errors)

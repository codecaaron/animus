## 1. Extract standalone pipeline function

- [ ] 1.1 Extract `runExtraction()` from `AnimusWebpackPlugin.runFullPipeline()` into a standalone function in a new `extraction.ts` module — takes options + rootDir, returns `{ manifest, manifestJson, css, systemPropsSource }`
- [ ] 1.2 Move file discovery, system loading, external package resolution, and analysis into `runExtraction()` — no Webpack-specific APIs
- [ ] 1.3 Add atomic CSS write helper: write to `.animus/styles.css.tmp` then `renameSync` to `.animus/styles.css`
- [ ] 1.4 Add `.animus/system-props.js` write alongside CSS output

## 2. Rewrite withAnimus config wrapper

- [ ] 2.1 Call `runExtraction()` synchronously in `withAnimus()` setup phase — extraction completes before config function returns
- [ ] 2.2 Register `resolve.alias` for Webpack: `@animus-ui/styles` → `.animus/styles.css`, `@animus-ui/system-props` → `.animus/system-props.js`
- [ ] 2.3 Register `turbopack.resolveAlias` for Turbopack: same mappings as Webpack
- [ ] 2.4 Register loader in `module.rules` (Webpack) with `enforce: 'pre'`
- [ ] 2.5 Register loader in `turbopack.rules` for `.ts`, `.tsx`, `.js`, `.jsx` extensions
- [ ] 2.6 Remove `AnimusWebpackPlugin` instantiation and `config.plugins.push`
- [ ] 2.7 Remove all `NormalModuleReplacementPlugin` usage

## 3. Simplify loader

- [ ] 3.1 Remove `ROOT_ENTRY_RE` regex and all CSS injection/stripping logic from `loader.ts`
- [ ] 3.2 Loader becomes transform-only: read manifest from `.animus/manifest.json` or globalThis, call `transformFile()`, return result
- [ ] 3.3 Add missing-import detection: track whether any processed file imports `@animus-ui/styles`, warn at end if none found

## 4. Dev mode file watcher

- [ ] 4.1 Add `chokidar` dependency to `packages/next-plugin/package.json`
- [ ] 4.2 In `withAnimus()`, when `dev === true`: spawn chokidar watcher on source directories after initial extraction
- [ ] 4.3 On file change: content-hash check → if changed, re-run `runExtraction()` → atomic CSS rewrite
- [ ] 4.4 On system file (`ds.ts`) change: full geological reset — reload system config, re-run extraction
- [ ] 4.5 Register `process.on('exit')` and `process.on('SIGINT')` handlers to close watcher

## 5. Cleanup and removal

- [ ] 5.1 Delete or gut `plugin.ts` — remove `AnimusWebpackPlugin` class and all `compiler.hooks` code
- [ ] 5.2 Simplify `singleton.ts` — remove `PROMISE_KEY` and analysis promise coordination (no longer needed)
- [ ] 5.3 Remove CSS import stripping regex (`CSS_IMPORT_RE`) from loader
- [ ] 5.4 Update package exports in `index.ts` if public API changed

## 6. Verification

- [ ] 6.1 Test with `next dev` (Turbopack default) — verify extraction runs, styles load, transforms work
- [ ] 6.2 Test with `next dev --webpack` — verify backwards compatibility
- [ ] 6.3 Test with `next build` — verify production build produces correct CSS
- [ ] 6.4 Test HMR: modify component file → verify CSS updates without full reload
- [ ] 6.5 Test geological reset: modify `ds.ts` → verify full re-extraction
- [ ] 6.6 Verify missing-import warning fires when `@animus-ui/styles` is not imported

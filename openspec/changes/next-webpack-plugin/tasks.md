## 1. EmitterConfig in Rust

- [x] 1.1 Add `EmitterConfig` struct to `transform_emitter.rs` with `runtime_import: String` and `css_module_id: String`, deriving Serialize/Deserialize
- [x] 1.2 Add `emitter_config_json: Option<String>` parameter to `analyze_project()` in `lib.rs`
- [x] 1.3 Thread EmitterConfig through `project_analyzer.rs` into the `UniverseManifest` JSON output
- [x] 1.4 Update `transform_file()` to read EmitterConfig from manifest and pass to `apply_replacements()`
- [x] 1.5 Update `apply_replacements()` to use EmitterConfig paths instead of hardcoded `@animus-ui/system` and `virtual:animus/styles.css`
- [x] 1.6 Default behavior when config is None: use existing hardcoded values (backward compatible)
- [x] 1.7 Add canary tests: transform_file with custom EmitterConfig produces correct import paths
- [x] 1.8 Update `packages/extract/index.d.ts` with new `emitter_config_json` parameter

## 2. Runtime-Agnostic Subprocess

- [x] 2.1 Create shared subprocess utility: `detectRuntime()` — checks PATH for bun, returns `'bun'` or `'node'`
- [x] 2.2 Create `execSubprocess(script, cwd)` that uses detected runtime to execute CJS scripts
- [x] 2.3 Ensure all subprocess scripts use CJS syntax (`require()`, `fs.writeFileSync`) compatible with both runtimes
- [x] 2.4 Refactor Vite plugin `loadSystem()` to use shared subprocess utility
- [x] 2.5 Refactor Vite plugin global styles subprocess to use shared utility
- [x] 2.6 Refactor Vite plugin transform resolution subprocess to use shared utility
- [x] 2.7 Verify `bun run verify` passes with subprocess refactor (no behavioral change)

## 3. Vite Plugin EmitterConfig Integration

- [x] 3.1 Construct EmitterConfig JSON with defaults (`@animus-ui/system`, `virtual:animus/styles.css`) in `runAnalysis()`
- [x] 3.2 Pass emitter config to `analyzeProject()` call
- [x] 3.3 Verify `bun run verify:showcase` passes (identical output, backward compatible)

## 4. Next Plugin Package Scaffold

- [x] 4.1 Create `packages/next-plugin/` directory with `package.json` (`@animus-ui/next-plugin`)
- [x] 4.2 Add `tsconfig.json` and `tsconfig.build.json` for the package
- [x] 4.3 Add `@animus-ui/extract` as dependency, `next` and `webpack` as peer dependencies
- [x] 4.4 Add package to root `workspaces` array
- [x] 4.5 Create `src/index.ts` exporting `withAnimus()` function stub

## 5. Webpack Plugin Core

- [x] 5.1 Implement `AnimusWebpackPlugin` class with `apply(compiler)` method
- [x] 5.2 Tap `compiler.hooks.run` and `compiler.hooks.watchRun` for analysis trigger
- [x] 5.3 Implement module-level promise mutex for once-only analysis across multi-compiler
- [x] 5.4 Port file discovery from Vite plugin (recursive directory walk with exclude patterns)
- [x] 5.5 Call `analyzeProject()` with EmitterConfig (`css_module_id: '.animus/styles.css'`)
- [x] 5.6 Apply post-processing: resolveTransformPlaceholders (subprocess) + applyUnitFallback
- [x] 5.7 Write resolved CSS to `.animus/styles.css` with content-hash deduplication
- [x] 5.8 Assemble variable CSS + global CSS + component CSS into single stylesheet

## 6. Webpack Loader

- [x] 6.1 Create `src/loader.ts` — webpack loader function with `enforce: 'pre'`
- [x] 6.2 Import manifest from module-scope singleton (shared with plugin)
- [x] 6.3 Call `transformFile(source, relativePath, manifestJson)` for files with components
- [x] 6.4 Pass through files not in manifest unchanged
- [x] 6.5 Handle loader errors: warn in non-strict mode, throw in strict mode

## 7. Config Wrapper

- [x] 7.1 Implement `withAnimus(options)` returning `(nextConfig) => config` curried function
- [x] 7.2 Validate required `system` option, throw descriptive error if missing
- [x] 7.3 Inject AnimusWebpackPlugin into `config.plugins`
- [x] 7.4 Inject loader rule for `.ts/.tsx/.js/.jsx` files with `exclude: /node_modules/`
- [x] 7.5 Compose with existing `nextConfig.webpack` function if present
- [x] 7.6 Ensure `.animus/` directory exists on initialization
- [x] 7.7 Log one-time warning if `.animus/` not in `.gitignore`
- [x] 7.8 Forward `strict`, `verbose`, `prefix`, `packagePatterns` options to plugin

## 8. Dev HMR

- [x] 8.1 Track content hashes per file in the plugin (Map<path, hash>)
- [x] 8.2 On `watchRun`, detect changed files by re-reading and hashing
- [x] 8.3 Re-run `analyzeProject()` with updated file entries on component file change
- [x] 8.4 Detect system file change (path matches `options.system`) → geological reset
- [x] 8.5 Geological reset: clearAnalysisCache(), re-run loadSystem(), re-analyze
- [x] 8.6 Content-hash dedup on CSS write: skip write if hash unchanged

## 9. Build & Verification

- [x] 9.1 Add `next-plugin` to root build scripts (`build:ts` should include it)
- [x] 9.2 Verify `bun run verify` passes with all changes
- [ ] 9.3 Create minimal Next.js test fixture (App Router, single extracted component) and verify build succeeds
- [ ] 9.4 Verify dev server HMR: change component → CSS updates, change system file → geological reset

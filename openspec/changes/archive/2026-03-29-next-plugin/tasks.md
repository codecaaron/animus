## 1. Rust Crate: Configurable Emitter Paths

- [ ] 1.1 Add `EmitterConfig` struct to `transform_emitter.rs` with `runtime_import` and `css_import` fields, deserialized from the manifest JSON
- [ ] 1.2 Update `transform_emitter.rs:143` to read `runtime_import` from `EmitterConfig` instead of hardcoded `@animus-ui/runtime`
- [ ] 1.3 Update CSS module ID injection to read `css_import` from `EmitterConfig` — emit no CSS import when value is empty string
- [ ] 1.4 Update `analyze_project()` to accept and forward emitter config in the manifest JSON
- [ ] 1.5 Update `transform_file()` to parse emitter config from the manifest and pass to the emitter

## 2. Vite Plugin: Pass Emitter Config

- [ ] 2.1 Add `runtimePackage` option to `AnimusExtractOptions` interface (default: `'@animus-ui/react'`)
- [ ] 2.2 Construct `config` object in manifest JSON with `runtimeImport` and `cssImport` fields before passing to `analyze_project()` and `transform_file()`
- [ ] 2.3 Verify existing Vite plugin behavior unchanged with new config passthrough (virtual module CSS import, runtime import path)

## 3. Runtime Shim: React 19 Ref-as-Prop

- [ ] 3.1 Replace `forwardRef` wrapper in `createComponent` with a plain function component that destructures `ref` from props
- [ ] 3.2 Pass `ref` directly to `createElement` call as part of the props object
- [ ] 3.3 Remove `forwardRef` import from runtime package
- [ ] 3.4 Verify ref forwarding works with React 19 ref-as-prop in a test component
- [ ] 3.5 Verify bundle size remains under 1KB gzipped

## 4. Next Plugin: Package Scaffold

- [ ] 4.1 Create `packages/next-plugin/` directory with `package.json` (`@animus-ui/next-plugin`), `tsconfig.json`, `tsconfig.build.json`
- [ ] 4.2 Add `webpack` and `next` as peer dependencies, `@animus-ui/extract` as dependency
- [ ] 4.3 Create `src/index.ts` exporting `withAnimus(nextConfig, options?)` function
- [ ] 4.4 Define `AnimusNextOptions` interface: `system` (required string), `verbose` (optional boolean), `runtimePackage` (optional string, default `'@animus-ui/react'`)
- [ ] 4.5 Add package to workspace in root `package.json`

## 5. Next Plugin: Webpack Plugin

- [ ] 5.1 Create `src/plugin.ts` with `AnimusWebpackPlugin` class implementing webpack `Compiler` plugin interface
- [ ] 5.2 Implement `compiler.hooks.beforeCompile` — run `loadSystem()` subprocess + `analyze_project()` NAPI call, cache manifest in module-level variable
- [ ] 5.3 Implement mutex for multi-compilation: first compiler runs analysis, subsequent compilers await the cached promise
- [ ] 5.4 Write resolved CSS to `.animus/styles.css` — create directory if missing, include variable CSS + global CSS + component CSS in `@layer` order
- [ ] 5.5 Apply transform post-processing (resolve `__TRANSFORM__` placeholders) and `applyUnitFallback()` to CSS before writing — extract shared functions from Vite plugin into a common utility
- [ ] 5.6 Print extraction diagnostics (bail/skip warnings) to console, matching Vite plugin format

## 6. Next Plugin: Webpack Loader

- [ ] 6.1 Create `src/loader.ts` implementing webpack loader interface: `(this: LoaderContext, source: string) => string`
- [ ] 6.2 Read cached manifest from module-level variable, call `transform_file(source, relativePath, manifestJson)`
- [ ] 6.3 Return transformed code if `has_components: true`, pass through original source if `false`
- [ ] 6.4 Add `resourceQuery` and `node_modules` exclusion in loader registration

## 7. Next Plugin: Config Wrapper

- [ ] 7.1 Implement `withAnimus()` — compose with existing `nextConfig.webpack` if present
- [ ] 7.2 Register `AnimusWebpackPlugin` in `config.plugins`
- [ ] 7.3 Register Animus loader in `config.module.rules` for `.ts`, `.tsx`, `.js`, `.jsx` files excluding `node_modules`
- [ ] 7.4 Throw clear error if `system` option is missing: `"withAnimus requires a 'system' option pointing to your design system module"`
- [ ] 7.5 Pass `runtimePackage` option through to the manifest emitter config

## 8. Next Plugin: Dev HMR

- [ ] 8.1 Detect dev mode via `compiler.options.mode === 'development'` or `nextConfig.dev`
- [ ] 8.2 In dev mode, hook `compiler.hooks.watchRun` to detect changed files and re-run analysis when component files change
- [ ] 8.3 Implement content-hash caching — skip re-analysis for files with unchanged hashes
- [ ] 8.4 Implement geological reset detection — if system file changes, reload via subprocess before re-analysis
- [ ] 8.5 Regenerate `.animus/styles.css` on re-analysis — webpack watches the file and triggers CSS hot update

## 9. Shared Utilities: Extract from Vite Plugin

- [ ] 9.1 Extract `loadSystem()` subprocess logic into a shared utility importable by both Vite plugin and Next plugin
- [ ] 9.2 Extract `applyUnitFallback()` into a shared utility
- [ ] 9.3 Extract transform placeholder resolution logic into a shared utility
- [ ] 9.4 Extract diagnostic printing logic (bail/skip/elimination warnings) into a shared utility
- [ ] 9.5 Refactor Vite plugin to import from shared utilities — verify no behavioral change

## 10. Verification

- [ ] 10.1 Create minimal Next.js Pages Router test app with Animus components, verify CSS output and component rendering
- [ ] 10.2 Create minimal Next.js App Router test app with Animus components, verify CSS output and RSC boundary behavior
- [ ] 10.3 Verify multi-compilation: `analyze_project()` called exactly once across server/client/edge passes
- [ ] 10.4 Verify dev HMR: component file change regenerates CSS, system file change triggers geological reset
- [ ] 10.5 Verify Vite plugin still passes `bun run verify` after shared utility refactor

# includes-driven-discovery

Plugin discovers external packages by tracing `.includes()` calls in the system entry file's builder chain, mapping identifiers back to their import declarations.

## Requirements

### REQ-1: `.includes()` AST tracing

The plugin reads the system entry file and finds `.includes([...])` calls. For each identifier inside the array, it traces back to the corresponding import declaration and extracts the package specifier. Only packages explicitly declared via `.includes()` are discovered.

**Scenarios:**

- WHEN the system file contains `.includes([testDs])` and `import { ds as testDs } from '@animus-ui/test-ds'`
  THEN `@animus-ui/test-ds` is in the discovered specifier set

- WHEN the system file imports `@animus-ui/system` but does NOT use it in `.includes()`
  THEN `@animus-ui/system` is NOT in the discovered set

- WHEN the system file contains `.includes([a, b])` with `import { ds as a } from '@ds-a/core'` and `import { ds as b } from '@ds-b/core'`
  THEN both `@ds-a/core` and `@ds-b/core` are in the discovered set

- WHEN the system file has no `.includes()` call
  THEN the discovered set is empty — no external packages

### REQ-2: Package resolution to source directory

For each discovered specifier, the plugin resolves it to a package root and targets `src/` for source file discovery. If `src/` does not exist (npm-installed package without source), the plugin falls back to the directory containing the package's dist entry.

**Scenarios:**

- WHEN `@animus-ui/test-ds` is discovered and the resolved package root contains `src/`
  THEN the plugin walks `src/` for `.ts/.tsx/.js/.jsx` files excluding `.test./.spec./node_modules/dist`

- WHEN `@animus-ui/test-ds` is discovered and the resolved package root does NOT contain `src/`
  THEN the plugin falls back to walking the directory of the package's main/module entry (e.g., `dist/`)

- WHEN a specifier fails to resolve via the bundler's resolver
  THEN the plugin silently skips it (no error thrown)

### REQ-3: Module resolution redirect to source

When `src/index.ts` exists for an external package, the plugin redirects the bundler's module resolution so that imports of the package specifier resolve to the source entry instead of the dist entry. This ensures the transform hook/loader processes `.ts` source files (with builder chains) rather than `.mjs` dist files.

**Scenarios:**

- WHEN `@animus-ui/test-ds` has `src/index.ts` and Vite is the bundler
  THEN the plugin's `resolveId` hook returns the absolute path to `src/index.ts` for the specifier

- WHEN `@animus-ui/test-ds` has `src/index.ts` and webpack/Next.js is the bundler
  THEN the plugin's `NormalModuleReplacementPlugin` `beforeResolve` hook redirects the specifier to `src/index.ts`

- WHEN `@animus-ui/test-ds` does NOT have `src/` (npm-installed)
  THEN no redirect occurs — the bundler resolves to the dist entry normally, and the transform/loader filter exempts external packages from extension restrictions

### REQ-4: Transform/loader exemption for external packages

External package files bypass the standard extension filter (`/\.[jt]sx?$/`) and `node_modules` exclusion. The manifest check is the gatekeeper — if a file has manifest entries, it is transformed regardless of extension or location.

**Scenarios:**

- WHEN `@animus-ui/test-ds/dist/index.mjs` is in the manifest (npm-installed, no src/)
  THEN the Vite transform hook processes it despite `.mjs` extension and `node_modules` path

- WHEN `@animus-ui/test-ds/src/components/Button.tsx` is in the manifest (workspace-linked)
  THEN the Vite transform hook and webpack loader process it normally

- WHEN a random `node_modules/lodash/index.js` file is encountered
  THEN it is NOT in any external package directory and is skipped by the standard `node_modules` guard

### REQ-5: Discovery scoped to system file only

The plugin does NOT scan all source files for import specifiers. Package discovery reads only the system entry file's `.includes()` calls.

**Scenarios:**

- WHEN a component file imports from `@animus-ui/test-ds` but ds.ts does NOT use `.includes([testDs])`
  THEN the package is NOT discovered (consumer must add `.includes()`)

### REQ-6: Plugin parity

Both vite-plugin and next-webpack-plugin use the same discovery mechanism (`extractSystemFilePackages()`), the same src/dist resolution strategy, and the same transform/loader exemption pattern.

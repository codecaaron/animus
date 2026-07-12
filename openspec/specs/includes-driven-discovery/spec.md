## Purpose

Plugin discovers external packages by tracing `.includes()` calls in the system entry file's builder chain, mapping identifiers back to their import declarations.

## Requirements

### Requirement: `.includes()` AST tracing

The plugin SHALL read the system entry file and find `.includes([...])` calls. For each identifier inside the array, it SHALL trace back to the corresponding import declaration and extract the package specifier. Only packages explicitly declared via `.includes()` are discovered.

#### Scenario: Included identifier maps to its import specifier

- **WHEN** the system file contains `.includes([testDs])` and `import { ds as testDs } from '@animus-ui/test-ds'`
- **THEN** `@animus-ui/test-ds` is in the discovered specifier set

#### Scenario: Imported but not included package is not discovered

- **WHEN** the system file imports `@animus-ui/system` but does NOT use it in `.includes()`
- **THEN** `@animus-ui/system` is NOT in the discovered set

#### Scenario: Multiple included identifiers all discovered

- **WHEN** the system file contains `.includes([a, b])` with `import { ds as a } from '@ds-a/core'` and `import { ds as b } from '@ds-b/core'`
- **THEN** both `@ds-a/core` and `@ds-b/core` are in the discovered set

#### Scenario: No includes call yields empty set

- **WHEN** the system file has no `.includes()` call
- **THEN** the discovered set is empty — no external packages

### Requirement: Package resolution to source directory

For each discovered specifier, the plugin SHALL resolve it to a package root and target `src/` for source file discovery. If `src/` does not exist (npm-installed package without source), the plugin SHALL fall back to the directory containing the package's dist entry.

#### Scenario: Package with src directory is walked for source files

- **WHEN** `@animus-ui/test-ds` is discovered and the resolved package root contains `src/`
- **THEN** the plugin walks `src/` for `.ts/.tsx/.js/.jsx` files excluding `.test./.spec./node_modules/dist`

#### Scenario: Package without src falls back to dist entry directory

- **WHEN** `@animus-ui/test-ds` is discovered and the resolved package root does NOT contain `src/`
- **THEN** the plugin falls back to walking the directory of the package's main/module entry (e.g., `dist/`)

#### Scenario: Unresolvable specifier is skipped silently

- **WHEN** a specifier fails to resolve via the bundler's resolver
- **THEN** the plugin silently skips it (no error thrown)

### Requirement: Module resolution redirect to source

When `src/index.ts` exists for an external package, the plugin SHALL redirect the bundler's module resolution so that imports of the package specifier resolve to the source entry instead of the dist entry, ensuring the transform hook/loader processes `.ts` source files (with builder chains) rather than `.mjs` dist files.

#### Scenario: Vite resolveId redirects to source entry

- **WHEN** `@animus-ui/test-ds` has `src/index.ts` and Vite is the bundler
- **THEN** the plugin's `resolveId` hook returns the absolute path to `src/index.ts` for the specifier

#### Scenario: Webpack beforeResolve redirects to source entry

- **WHEN** `@animus-ui/test-ds` has `src/index.ts` and webpack/Next.js is the bundler
- **THEN** the plugin's `NormalModuleReplacementPlugin` `beforeResolve` hook redirects the specifier to `src/index.ts`

#### Scenario: No src means no redirect

- **WHEN** `@animus-ui/test-ds` does NOT have `src/` (npm-installed)
- **THEN** no redirect occurs — the bundler resolves to the dist entry normally, and the transform/loader filter exempts external packages from extension restrictions

### Requirement: Transform/loader exemption for external packages

External package files SHALL bypass the standard extension filter (`/\.[jt]sx?$/`) and `node_modules` exclusion. The manifest check is the gatekeeper — if a file has manifest entries, it SHALL be transformed regardless of extension or location.

#### Scenario: Manifest-listed dist file is transformed despite extension and location

- **WHEN** `@animus-ui/test-ds/dist/index.mjs` is in the manifest (npm-installed, no src/)
- **THEN** the Vite transform hook processes it despite `.mjs` extension and `node_modules` path

#### Scenario: Manifest-listed workspace source file is transformed normally

- **WHEN** `@animus-ui/test-ds/src/components/Button.tsx` is in the manifest (workspace-linked)
- **THEN** the Vite transform hook and webpack loader process it normally

#### Scenario: Unrelated node_modules file stays excluded

- **WHEN** a random `node_modules/lodash/index.js` file is encountered
- **THEN** it is NOT in any external package directory and is skipped by the standard `node_modules` guard

### Requirement: Discovery scoped to system file only

The plugin SHALL NOT scan all source files for import specifiers. Package discovery SHALL read only the system entry file's `.includes()` calls.

#### Scenario: Consumer import without includes does not trigger discovery

- **WHEN** a component file imports from `@animus-ui/test-ds` but ds.ts does NOT use `.includes([testDs])`
- **THEN** the package is NOT discovered (consumer must add `.includes()`)

### Requirement: Plugin parity

Both vite-plugin and next-webpack-plugin SHALL use the same discovery mechanism (`extractSystemFilePackages()`), the same src/dist resolution strategy, and the same transform/loader exemption pattern.

#### Scenario: Discovery parity across bundlers

- **WHEN** the Vite plugin and the Next webpack plugin each discover external packages for the same system file
- **THEN** both SHALL derive the same specifier set via `extractSystemFilePackages()` and apply the same src/dist resolution and exemption behavior

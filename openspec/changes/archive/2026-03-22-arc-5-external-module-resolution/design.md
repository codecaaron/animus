## Context

The import resolver (Arc 3) traces bindings across files by parsing import/export statements and following re-export chains. It works for relative imports (`./Button`, `../elements/Box`) because the `resolve_path` callback can compute the absolute path from the importing file's directory.

For package-name imports (`@animus-ui/components`, `next/link`), the callback currently returns None — the import is treated as external and skipped. This means any component binding imported via a package specifier is invisible to the provenance resolver and the JSX scanner's rendered_components tracking.

The Vite plugin has access to `this.resolve()` — Vite's built-in module resolution that handles package.json `exports` fields, TypeScript path aliases, workspace packages, and node_modules resolution. The plugin can pre-resolve package specifiers before calling the Rust analyzer.

## Goals / Non-Goals

**Goals:**
- Package-name imports of animus components are resolved to their source file definitions
- The Vite plugin pre-resolves package specifiers using Vite's module resolution
- The import resolver traces bindings through resolved package entry files (barrel re-exports)
- The doc site Layer 5 snapshot reflects full extraction coverage (all 24 components)

**Non-Goals:**
- Resolving ALL package imports — only packages matching configurable patterns (default: `@animus-ui/*`) are resolved. External packages like `next/link`, `react`, etc. remain unresolved.
- Runtime package resolution — this is purely build-time, within the Vite plugin's `buildStart` hook
- Source maps or CSS minification — deferred to future work
- TypeScript path alias resolution outside of Vite — the plugin delegates to Vite's resolver

## Decisions

### 1. Pre-resolution in Vite plugin, not in Rust

The Vite plugin resolves package specifiers BEFORE calling `analyze_project`. It passes a resolution map (`{ "@animus-ui/components": "packages/ui/src/index.ts" }`) alongside the file entries. The Rust analyzer uses this map in the import resolver's `resolve_path` callback.

**Alternative considered:** Having the Rust NAPI function call back into JavaScript for resolution. Rejected because NAPI callbacks are complex (async boundaries, thread safety) and the resolution set is small (a handful of package patterns) — pre-resolution is simpler and faster.

### 2. Package resolution map as a separate NAPI parameter

```rust
pub fn analyze_project(
    file_entries_json: String,
    theme_json: String,
    config_json: String,
    group_registry_json: String,
    package_resolution_json: String,  // NEW: { "pkg-name": "resolved/path" }
) -> String
```

The map is `HashMap<String, String>` — package specifier → resolved entry file path (relative to project root). The import resolver checks this map when `resolve_path` receives a non-relative import source.

**Alternative considered:** Embedding the resolution map inside file_entries_json. Rejected because the resolution map has different semantics (it maps import specifiers, not file paths) and mixing them would complicate the FileEntry type.

### 3. Vite plugin discovers package imports by scanning source files

At `buildStart`, after discovering source files, the plugin scans each file's source for `import ... from 'pkg-pattern'` statements matching the configured patterns. For each unique package specifier found:

1. Call `this.resolve(specifier)` to get the absolute file path
2. Read the resolved file's source
3. Add it to the file entries (if not already present)
4. Record the mapping: `specifier → relative_path`

This is a SCAN-then-RESOLVE approach. The scan doesn't need to parse AST — a regex match on `from ['"](@animus-ui/[^'"]+)['"]` is sufficient since we're looking for import sources, not import bindings.

### 4. Recursive entry file inclusion

A package's entry file (e.g., `packages/ui/src/index.ts`) typically re-exports from internal files:
```typescript
export { Box } from './elements/Box';
export { Text } from './elements/Text';
```

The import resolver already follows re-export chains transitively (Arc 3). But the internal files (`./elements/Box.tsx`) must be in the file entries for the resolver to read their exports. The Vite plugin must include not just the entry file but also the files it re-exports from.

**Approach:** After resolving the package entry file, recursively discover all `.ts`/`.tsx` files in the same directory tree and include them in the file entries. This is the same glob approach used for the project's own source files. For a monorepo package like `packages/ui/src/`, this means including all its source files.

For node_modules packages, this could include a large number of files. The `packagePatterns` config limits which packages are resolved, and the file discovery is bounded to the package's source directory.

### 5. configurable packagePatterns

```typescript
interface AnimusExtractOptions {
  // ...existing options...
  packagePatterns?: string[];  // default: ['@animus-ui/*']
}
```

Only imports matching these patterns trigger resolution. This prevents the plugin from trying to resolve `react`, `next`, `lodash`, etc.

Pattern matching: simple prefix match. `@animus-ui/*` matches `@animus-ui/components`, `@animus-ui/core`, etc. Not a full glob — just prefix + wildcard.

## Risks / Trade-offs

**[Risk] Large package source trees** → A resolved package might have hundreds of source files. Mitigation: `packagePatterns` limits which packages are resolved. For `@animus-ui/*`, the source trees are small (~30 files). For external design system packages, the consumer can choose whether to include them.

**[Risk] Circular package dependencies** → Package A imports from Package B which imports from Package A. Mitigation: the import resolver already handles cycles via `MAX_CHAIN_DEPTH = 32` (Arc 3). Package-level cycles would be caught the same way.

**[Trade-off] Regex vs AST for import scanning** → Using regex to find package imports is fast but imprecise (could match imports in comments or strings). AST parsing is precise but slower. For the `buildStart` context (one-time, not per-file), regex is fast enough and false positives are harmless (resolving an extra package just adds files to the analysis set).

## Architectural Hooks for Future Work

This arc creates infrastructure that enables downstream work without implementing it:

### Dev-mode extraction (HMR)
The package resolution map + the file dependency graph (which files import from which packages) form the dependency DAG needed for incremental re-analysis. When a file changes:
1. Look up which components it defines (from `manifest.files`)
2. Look up which components extend from those (from `manifest.provenance`)
3. Re-extract the changed file + dependents
4. Compute CSS delta (diff old manifest CSS vs new)
5. Vite natively hot-replaces CSS (`<link>` tag or `<style>` block)

The total cost is ~1ms parse + ~1ms resolve per changed file. This is faster than Emotion's per-render style computation.

### Emotion exit path
With full extraction coverage (24/24 components), the extraction pipeline produces CSS for EVERYTHING the design system renders. Emotion's role becomes: dev-mode fallback for the bail conditions (dynamic function values, inline scales). As those are addressed (`@layer dynamic` for function values, inline scale support for .props()), Emotion's role shrinks to zero.

The `@layer` specificity trap means Emotion and extraction CANNOT coexist safely — unlayered CSS (Emotion) always beats layered CSS (@layer). Full extraction coverage is the prerequisite for removing Emotion, and package resolution is the prerequisite for full coverage.

### Layer 5 snapshot as validation signal
The Layer 5 snapshot currently captures 8 extracted components. After this arc, it should capture all 24, with significantly more CSS including responsive `@media` queries from LayoutContainer, ContentContainer, and other responsive-heavy components that are currently eliminated. The snapshot SIZE INCREASE is the primary validation signal that package resolution is working.

## Context

The Rust extraction pipeline discovers files by walking the consumer app's source tree. The vite-plugin and next-webpack-plugin both exclude `node_modules` from this walk — a correct default that prevents scanning thousands of irrelevant files. However, workspace packages and publishable DS libraries are shipped as separate packages. Components in those packages use the same Animus builder chain and reference the same token vocabulary, but the extractor never sees them.

The file discovery exclusion is the only barrier. The Rust analyzer does not care where a file comes from — it parses JSX, resolves prop references, and emits CSS identically regardless of file origin. The plugin orchestrates which files are passed to the analyzer; extending discovery is entirely a plugin-layer concern.

The consumer's `ds.ts` (system config + theme) remains the single source of truth. Library components are "more files" — their token refs (`bg: 'primary'`) resolve to CSS variables (`var(--color-primary)`) against the consumer's theme, not against any theme the library itself ships.

## Goals / Non-Goals

**Goals:**

- Add a cosmetic `.includes()` method on SystemBuilder that forces external DS imports into the system entry file.
- Use OXC's existing import declaration parsing to extract external package specifiers from the system entry file.
- Resolve each discovered package to its source directory, walk those files with the same filters as app files.
- Pass external package files through the existing `analyzeProject` / `transform_file` path without modification.
- Prove the end-to-end flow with a concrete `packages/test-ds` workspace package.
- Verify extraction in both vite-plugin (showcase) and next-webpack-plugin (next-test-app).

**Non-Goals:**

- Plugin-level `packages` config — discovery is driven from ds.ts imports, not plugin options.
- Loading or merging the library's own ds.ts / system config at consumer extraction time.
- Type-level enforcement of cross-package token compatibility — module augmentation is DX sugar, not a safety contract. Unresolved tokens produce extraction warnings.
- Supporting pre-built (dist) library files for the recursive case — source files only for v1.
- Any change to the Rust extraction crate's analysis logic.
- Theme merging or token augmentation — consumer theme is authoritative.

## Decisions

### Discovery mechanism: cosmetic `.includes()` + OXC import tracing

**Decision:** The consumer declares external DS dependencies via `.includes([externalDs])` on the SystemBuilder chain in ds.ts. `.includes()` is a no-op at runtime — it returns `this` without side effects. Its purpose is to centralize external DS imports in the one file the plugin already loads as its entry point.

At build time, the plugin (or a new OXC pass) parses ds.ts as an AST, reads import declarations, identifies which imports correspond to `.includes()` arguments, and extracts the package specifiers. The plugin resolves each specifier to a source directory and walks it.

**Rationale:** Zero configuration. The import statement IS the declaration. The consumer doesn't need to configure the plugin separately — the ds.ts file is the single topology declaration (grammar + vocabulary + external dependencies). OXC's `import_resolver` already parses import declarations; this reuses existing infrastructure.

**Alternative considered:** `packages: string[]` in plugin config. Rejected — duplicates information already present in ds.ts imports, creates a second configuration surface that can drift.

### Resolution strategy: require.resolve + `src/` heuristic

**Decision:** Resolve each package specifier via `require.resolve('<pkg>/package.json')` to get the package root, then walk the `src/` directory if it exists, otherwise fall back to the directory containing the resolved `main` entry.

**Rationale:** Workspace links make `require.resolve` reliable. Walking `src/` matches the convention used by all Animus packages and avoids compiled `dist/` files.

### `.includes()` is a type-level and syntactic convenience, not a runtime feature

**Decision:** The method accepts `SystemInstance[]` for type safety (you can't pass random objects), but does nothing with them. The runtime system doesn't merge, validate, or serialize included instances.

**Rationale:** The plugin doesn't need runtime access to included DS instances. It needs to know WHICH packages to walk — and the import specifier provides that. Keeping `.includes()` cosmetic means zero runtime overhead and no serialization complexity.

### Unresolved tokens are extraction warnings, not type errors

**Decision:** When the extractor encounters a token ref (e.g., `bg: 'accent'`) that doesn't exist in the consumer's theme, it emits a build warning attributing the gap to the source file and package. No special type-level enforcement.

**Rationale:** Module augmentation is additive — library augmentations make library tokens globally valid in the consumer's compilation, defeating the constraint. Build-time extraction warnings are more reliable. Consumers get the tools; if they misconfigure their theme, the warning tells them exactly what's missing.

### Library ships components + reference theme; system is library-dev-only

**Decision:** `test-ds` exports components and a reference theme. The library's system config is not exported and is not loaded by the consumer's plugin.

**Rationale:** The consumer's theme is the extraction authority. The reference theme gives consumers a starting point for composing their own theme (future `unpack()` work) but plays no role in extraction.

## Risks / Trade-offs

**Risk:** OXC import tracing can't handle all binding patterns (namespace imports, destructured locals, intermediate variables).
-> Mitigation: For v1, support the simple named-import case: `import { system } from '@pkg'`. Document the supported pattern. Exotic binding patterns are edge cases — the no-op method signature guides consumers toward the simple pattern.

**Risk:** Package `src/` directory convention not followed by third-party libraries.
-> Mitigation: `.includes()` is used with known-Animus packages. Third-party library authors who want inclusion must follow source-shipping conventions. Document this expectation.

**Risk:** Consumer theme missing tokens that library components reference.
-> Mitigation: Missing tokens produce extraction warnings with file + package attribution. No silent failures — the consumer knows exactly what's missing.

**Risk:** Recursive case (library A includes library B) doesn't work with compiled dist/ files.
-> Mitigation: v1 scope is workspace packages (source available). Published library chains are a follow-on concern. The cosmetic `.includes()` pattern still forces the import, so the specifier is always discoverable even if recursive walking requires source.

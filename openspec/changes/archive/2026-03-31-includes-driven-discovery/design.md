## Context

Both plugins discover external packages via a two-step process: (1) scan all discovered source files for import specifiers matching `packagePatterns`, (2) resolve and walk those packages. Step 1 is O(n) regex over every file — expensive and redundant now that consumers declare external DS dependencies via `.includes()` in ds.ts.

The system entry file (ds.ts) is already the single topology declaration: grammar (system props), vocabulary (theme tokens), and external dependencies (`.includes()`). The plugin loads this file via subprocess at `buildStart`. Reading its import declarations is trivial and gives the complete package list.

## Goals / Non-Goals

**Goals:**

- Replace the O(n) import scan with a single-file read of ds.ts import declarations.
- Remove the `packagePatterns` config option from both plugins.
- Preserve the existing package resolution and file-walking logic — only the discovery source changes.
- Maintain parity between vite-plugin and next-webpack-plugin.

**Non-Goals:**

- OXC-based AST parsing of ds.ts (future refinement — simple regex on one file is sufficient for v1).
- Changes to SystemBuilder, test-ds, or the Rust crate.
- Recursive `.includes()` chain traversal across packages (deferred — workspace packages have source available).

## Decisions

### Discovery source: system file imports, not all-file scan

**Decision:** Read the system entry file source (the `system` option path, e.g., `./src/ds.ts`), extract all non-relative import specifiers via regex, filter to external packages (skip relative imports, `react`, `@animus-ui/system`, stdlib), resolve each to a source directory, and walk.

**Rationale:** The system file is already known (plugin option). Reading one file is O(1) vs O(n). The `.includes()` call forces external DS imports to appear in this file. Simple regex (`/from\s+['"]([^'"]+)['"]/g`) is sufficient for static import declarations — no AST parser needed for this scope.

**Alternative considered:** OXC AST parsing of ds.ts for precise `.includes()` argument tracing. Deferred — regex on one file is cheap, reliable for the standard pattern, and doesn't require a new NAPI function.

### Filter heuristic for external packages

**Decision:** From the extracted import specifiers, include only those that:
1. Are not relative (`./`, `../`)
2. Are not the system package itself (`@animus-ui/system`, `@animus-ui/system/groups`)
3. Are not known non-DS packages (`react`, `react-dom`, `next`, `vite`, etc.)
4. Successfully resolve via the bundler's resolver

A failed resolution silently skips the specifier (same behavior as today).

**Rationale:** The system file typically imports from `@animus-ui/system`, `@animus-ui/system/groups`, and external DS packages. The filter removes known non-DS imports. Any remaining specifier that resolves to a local workspace package gets walked.

### Remove `packagePatterns` option

**Decision:** Remove `packagePatterns` from `AnimusExtractOptions` and the next-webpack-plugin config type. The option was internal/undocumented and only used with the default `['@animus-ui/*']`.

**Rationale:** With includes-driven discovery, the explicit allowlist is unnecessary — the consumer's `.includes()` imports are the allowlist. Removing the option simplifies the config surface.

## Risks / Trade-offs

**Risk:** System file has imports not related to external DS packages (e.g., utility libs).
-> Mitigation: Filter heuristic + failed resolution skips. Walking a small non-DS package is harmless — the Rust extractor finds no builder chains and produces no output.

**Risk:** Consumer forgets `.includes()` — external packages silently not discovered.
-> Mitigation: This is the designed behavior — explicit over implicit. The consumer must declare their external dependencies. If components don't appear in extracted CSS, the `.includes()` chain is the first thing to check.

**Risk:** Regex import parsing misses edge cases (dynamic imports, template literals).
-> Mitigation: Static imports are the expected pattern. `.includes()` forces a static import. Dynamic import of a DS system instance would be unusual and non-functional (the system needs to be statically available at build time).

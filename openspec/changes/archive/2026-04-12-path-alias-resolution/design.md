## Context

The Rust import resolver in `project_analyzer.rs` resolves imports via two paths: relative (`./foo`) and package map lookup. tsconfig path aliases (`@admin/*` → `./src/*`) fall through both, causing silent extraction failures for `.extend()` chains and cross-file component references.

This is a research-first change. The scope and severity depend on whether real consumers use aliased imports between Animus component files. If they don't, documentation may suffice.

## Goals / Non-Goals

**Goals:**
- Determine whether path alias resolution is a real problem (audit blockworks)
- If so, design a solution that resolves aliases in the Rust import resolver
- Ensure both vite-plugin and next-plugin benefit from the fix

**Non-Goals:**
- Supporting arbitrary module resolution (Vite plugins, custom resolvers)
- Supporting `paths` entries that map to `node_modules` (covered by packageMap)
- Handling `baseUrl`-only resolution (no `paths` key) — this is rare and complex

## Decisions

### Decision 1: Option B (auto-read tsconfig.json) as primary approach

**Choice:** The plugin reads `tsconfig.json`, extracts `compilerOptions.paths` + `compilerOptions.baseUrl`, and serializes them as a new `path_aliases_json` parameter to `analyzeProject()`.

**Why over Option A (explicit config):** Duplicating tsconfig paths in plugin options is error-prone — they drift. Auto-reading is zero-config and always correct.

**Why over Option C (dynamic Vite resolve):** NAPI boundary crossing per-resolution is expensive. The alias map is static per build — serializing it once is O(1) overhead.

**Why over Option D (document limitation):** If the audit confirms this affects real consumers, documentation is insufficient — silent degradation is the worst failure mode.

### Decision 2: Rust-side alias resolution as a pre-pass before package map

In `project_analyzer.rs`, the `resolve_path` closure (line 443) gains a third branch:

```
1. starts_with('.') → resolve_relative_path()
2. matches alias pattern → expand alias → resolve_relative_path()
3. else → package map lookup
```

Alias expansion converts `@admin/components/Button` → `./src/components/Button` (relative to project root), then falls through to the existing relative resolver.

### Decision 3: Audit before implementation

Before writing code, audit blockworks os-admin for aliased component imports. If zero Animus component files use `@admin/*` to import other components, defer implementation and document the limitation.

## Risks / Trade-offs

**[Risk] tsconfig.json may not be at project root** → Mitigation: Use `tsconfig` Vite config if set, otherwise check root. Follow TypeScript's `extends` chain if needed (most projects don't deeply nest).

**[Risk] `paths` entries can have multiple targets** → e.g., `"@admin/*": ["./src/*", "./types/*"]`. Mitigation: Try each target in order, return first match (same as TypeScript's behavior).

**[Risk] Performance overhead of alias matching** → At ~600 imports, checking 3-5 alias patterns per import is negligible. O(imports × patterns) where both are small.

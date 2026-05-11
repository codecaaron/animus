## Context

The Rust extraction pipeline's `resolve_path` closure in `project_analyzer.rs:443` has two branches:
1. Relative paths (`starts_with('.')`) → `resolve_relative_path()` with extension probing
2. Everything else → `resolve_package_path()` via package map from the plugin

tsconfig path aliases like `@admin/components/Button` are neither relative nor package specifiers — they fall through both branches and resolve to `None`. The binding is silently dropped, breaking `.extend()` provenance chains.

Meanwhile, the host bundler already knows about these aliases. In Vite, `config.resolve.alias` (available in `configResolved`) contains the merged result of `vite-tsconfig-paths`, manual `resolve.alias` config, and any other alias plugins. In Next.js/webpack, `config.resolve.alias` is similarly available in the webpack config callback.

The previous proposal (archived: `path-alias-resolution`) attempted to reimplement tsconfig resolution in Rust. Three independent reviews identified this as over-engineering — the host already solved alias resolution. We should consume, not reimplement.

## Goals / Non-Goals

**Goals:**
- Forward the host bundler's resolved aliases to the Rust pipeline
- Enable `.extend()` provenance chains to resolve across aliased imports
- Zero-config for consumers (aliases are already configured in Vite/webpack)
- Both vite-plugin and next-plugin benefit

**Non-Goals:**
- Implementing tsconfig resolution (the host handles this)
- Supporting `baseUrl`-only resolution without `paths` (rare, complex, separate concern)
- Handling `package.json` `imports` field (`#foo/*` aliases — separate concern)
- Resolving aliases that point outside the file discovery root (documented limitation)

## Decisions

### Decision 1: Consume `config.resolve.alias` from the host

**Choice:** Each plugin reads the host's resolved alias map, normalizes it, and passes it to Rust.

- **Vite plugin:** Read `config.resolve.alias` in `configResolved` hook. This map is already merged — if the user has `vite-tsconfig-paths`, its output is included. If they use manual `resolve.alias`, that's included. We get exactly what Vite uses.
- **Next plugin:** Read `config.resolve.alias` in the `webpack()` callback in `with-animus.ts`. Same pattern — Next.js has already resolved tsconfig paths into webpack aliases.

**Why not read tsconfig.json directly:** Divergence risk. If the user's `vite-tsconfig-paths` is configured with a custom `root` or `projects` option, or if tsconfig uses `extends` chains, a separate read could disagree with what Vite actually uses. Reading the host's output is always correct by definition.

**Why not use `this.resolve()` per-import:** NAPI boundary crossing per call is expensive. At ~600 imports, that's 600 async calls during `buildStart`. The alias map is static per build — serialize once, O(1) overhead.

### Decision 2: Normalized alias shape for NAPI boundary

Both plugins serialize to the same JSON shape:

```json
{
  "aliases": [
    { "pattern": "@admin/", "replacement": "src/", "type": "prefix" },
    { "pattern": "@config", "replacement": "src/config.ts", "type": "exact" }
  ]
}
```

Two types:
- `prefix`: `@admin/components/Button` → strip `@admin/`, prepend `src/` → `src/components/Button`
- `exact`: `@config` → `src/config.ts` (no wildcard, direct replacement)

Ordered array, not map — first match wins (matches TypeScript's declaration-order semantics).

### Decision 3: Third branch in resolve_path closure

```rust
let resolve_path = |current_file: &str, source: &str| -> Option<String> {
    if source.starts_with('.') {
        resolve_relative_path(current_file, source, &file_paths_set_clone)
    } else if let Some(expanded) = expand_alias(source, &aliases) {
        probe_known_files(&expanded, &file_paths_set_clone)
    } else {
        resolve_package_path(source)
    }
};
```

`expand_alias` does prefix or exact matching. `probe_known_files` does the same extension probing as `resolve_relative_path` but relative to project root (since alias expansions are root-relative).

### Decision 4: Extract extension probing into shared helper

Currently `resolve_relative_path` joins the import source relative to the importing file's directory, then probes extensions. The alias path needs the same probing but against root-relative expanded paths. Extract the extension-probing logic (`.ts`, `.tsx`, `.js`, `.jsx`, `/index.*`) into `probe_known_files(candidate, known_files)` and call it from both `resolve_relative_path` and the alias branch.

## Risks / Trade-offs

**[Risk] Alias points outside discovery root** → `@shared/*` → `../../packages/shared/src/*` resolves to a path outside the plugin's file walk. Those files won't be in the known file set, so the probe returns None. Mitigation: document as known limitation. The user can add those directories to the plugin's include paths if needed. Emit a debug-level log when an alias expands but no file matches.

**[Risk] Vite `resolve.alias` shape varies** → Vite accepts aliases as `{ find: string|RegExp, replacement: string }[]` or `Record<string, string>`. The normalization layer in the plugin must handle both shapes. This is well-documented Vite API.

**[Risk] NAPI parameter count (now 13)** → Manageable for now. A future consolidation pass could group parameters into a single config struct, but that's a separate change affecting all callers.

**[Risk] Alias ordering in webpack** → Webpack's `resolve.alias` is an object (no guaranteed order). If two aliases overlap (e.g., `@admin` and `@admin/components`), the match order is undefined. Mitigation: sort aliases by pattern length descending (longest prefix first) during normalization. This matches TypeScript's behavior.

## Why

The subprocess elimination arc (sessions 62–67) moved system loading, transform evaluation, and global styles resolution into the Rust crate. Both plugins now call NAPI functions instead of spawning bun subprocesses. But the plugin code, comments, docs, and CSS delivery model haven't caught up. There's dead code still exported, stale subprocess references in 8 source comments and 2 CLAUDE.md files, a bug where next-plugin drops selectorAliases/selectorOrder, and the CSS generation model concatenates all component CSS into monolithic per-layer strings with no per-component addressability — blocking incremental HMR and future route-level code-splitting.

## What Changes

- **Fix next-plugin selectorAliases/selectorOrder bug** — currently passes `null, null` to `analyzeProject` instead of values from `loadSystemModule`. Selector shorthand syntax (`_hover`, `_focus`, etc.) is broken in Next.js apps.
- **Remove dead subprocess code** — `extract/pipeline/subprocess.ts` (zero consumers), `vite-plugin/src/resolve-global-styles.ts` (zero consumers), stale re-exports from `extract/pipeline/index.ts`.
- **Update stale comments** — 5 subprocess references in vite-plugin, 3 in next-plugin source.
- **Update stale CLAUDE.md docs** — vite-plugin "Subprocess Model" section is fiction; extract CLAUDE.md missing `loadSystemModule` NAPI function.
- **Per-component CSS fragments in Rust** — refactor `css_generator.rs` to retain per-component CSS for the 4 splittable layers (base, variants, compounds, states). Use `Vec<(String, String)>` with `FxHashMap<String, usize>` side index for ordered storage + O(1) lookup. New `PerComponentSheets` struct serialized in manifest. `CssSheets` derived via pre-allocated concatenation.
- **Next-plugin incremental HMR** — adopt `buildFileEntriesFromCache` pattern (vite-plugin already has this) to avoid re-reading all files on every watch cycle.
- **Reverse adjacency index** — build `parent → [children]` from existing `provenance` map for transitive cache invalidation on `.extend()` chain changes.

## Capabilities

### New Capabilities
- `per-component-css-fragments`: Per-component CSS fragment storage in the Rust crate, enabling addressable CSS segments for incremental updates and future route-level splitting. Covers fragment generation, container choice, serialization, and concatenation derivation.

### Modified Capabilities
- `extract-pipeline`: Add `PerComponentSheets` to manifest output alongside existing `CssSheets`. Add reverse adjacency index for provenance.
- `vite-extraction-plugin`: Fragment-aware HMR splice path. Remove dead subprocess code and stale comments.
- `next-webpack-integration`: Fix selectorAliases/selectorOrder passthrough. Adopt incremental HMR cache pattern. Remove stale comments.
- `structured-css-sheets`: CssSheets now derived from per-component fragments rather than direct concatenation.

## Impact

- **Rust crate** (`packages/extract/src/`): `css_generator.rs` generation refactor, `project_analyzer.rs` manifest integration + reverse adjacency, `lib.rs` serialization.
- **Vite plugin** (`packages/vite-plugin/src/`): HMR splice logic, dead file removal, comment cleanup, CLAUDE.md rewrite.
- **Next plugin** (`packages/next-plugin/src/`): Bug fix (selectorAliases), incremental HMR, comment cleanup.
- **Pipeline utilities** (`packages/extract/pipeline/`): Dead export removal from `index.ts`, `subprocess.ts` deletion.
- **NAPI boundary**: Manifest JSON gains `component_fragments` field (~59 KB overhead at showcase scale, ~295 KB at 1000 components).
- **No breaking changes** to consumer API. `CssSheets` remains available. Fragments are additive.

# Tasks: host-alias-forwarding

## 1. Rust: Extract extension probing into shared helper

- [x] 1.1 Extract the extension-probing loop (`.ts`, `.tsx`, `.js`, `.jsx`, `/index.*`) from `resolve_relative_path` into a new `probe_known_files(candidate: &str, known_files: &FxHashSet<String>) -> Option<String>` function
- [x] 1.2 Refactor `resolve_relative_path` to compute the joined/normalized candidate path, then delegate to `probe_known_files`
- [x] 1.3 Verify existing tests still pass (`cargo test --lib` in `packages/extract`)

## 2. Rust: Alias expansion and resolution branch

- [x] 2.1 Add `AliasEntry` struct: `{ pattern: String, replacement: String, alias_type: AliasType }` with `AliasType` enum `{ Prefix, Exact }`
- [x] 2.2 Add `expand_alias(source: &str, aliases: &[AliasEntry]) -> Option<String>` — iterates aliases in order, returns first match expansion (prefix strips + prepends, exact returns replacement directly)
- [x] 2.3 Add third branch to `resolve_path` closure in `analyze()`: after relative check, before package map — `expand_alias` then `probe_known_files`
- [x] 2.4 Add unit tests: prefix alias expands and resolves, exact alias resolves, alias miss falls through to package map, alias expands but file not found returns None

## 3. NAPI boundary

- [x] 3.1 Add `path_aliases_json: Option<String>` parameter to `analyze_project` in `lib.rs`
- [x] 3.2 Deserialize into `Vec<AliasEntry>` and pass to `analyze()`
- [x] 3.3 Add `aliases` parameter to `analyze()` function signature (defaulting to empty vec when None)

## 4. Vite plugin: alias extraction

- [x] 4.1 In `configResolved` hook, read `config.resolve.alias` and normalize to `AliasEntry[]` shape — handle both array-of-objects (`{ find, replacement }`) and record (`{ key: value }`) formats
- [x] 4.2 Convert absolute replacement paths to project-root-relative using `rootDir`
- [x] 4.3 Sort aliases by pattern length descending (longest prefix first)
- [x] 4.4 Serialize and pass as `path_aliases_json` argument in `runAnalysis()`

## 5. Next plugin: alias extraction

- [x] 5.1 In `withAnimus` webpack callback, read `config.resolve.alias` and normalize to same `AliasEntry[]` shape
- [x] 5.2 Convert absolute paths to project-root-relative, sort by length descending
- [x] 5.3 Pass through to `analyzeProject()` call in `AnimusWebpackPlugin`

## 6. Verification

- [x] 6.1 `cargo test --lib` — all Rust tests including new alias tests
- [x] 6.2 `bun test` — JS test suite
- [x] 6.3 `bun run verify:showcase` — showcase build with extraction

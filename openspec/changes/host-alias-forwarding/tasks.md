# Tasks: host-alias-forwarding

## 1. Rust: Extract extension probing into shared helper

- [ ] 1.1 Extract the extension-probing loop (`.ts`, `.tsx`, `.js`, `.jsx`, `/index.*`) from `resolve_relative_path` into a new `probe_known_files(candidate: &str, known_files: &FxHashSet<String>) -> Option<String>` function
- [ ] 1.2 Refactor `resolve_relative_path` to compute the joined/normalized candidate path, then delegate to `probe_known_files`
- [ ] 1.3 Verify existing tests still pass (`cargo test --lib` in `packages/extract`)

## 2. Rust: Alias expansion and resolution branch

- [ ] 2.1 Add `AliasEntry` struct: `{ pattern: String, replacement: String, alias_type: AliasType }` with `AliasType` enum `{ Prefix, Exact }`
- [ ] 2.2 Add `expand_alias(source: &str, aliases: &[AliasEntry]) -> Option<String>` — iterates aliases in order, returns first match expansion (prefix strips + prepends, exact returns replacement directly)
- [ ] 2.3 Add third branch to `resolve_path` closure in `analyze()`: after relative check, before package map — `expand_alias` then `probe_known_files`
- [ ] 2.4 Add unit tests: prefix alias expands and resolves, exact alias resolves, alias miss falls through to package map, alias expands but file not found returns None

## 3. NAPI boundary

- [ ] 3.1 Add `path_aliases_json: Option<String>` parameter to `analyze_project` in `lib.rs`
- [ ] 3.2 Deserialize into `Vec<AliasEntry>` and pass to `analyze()`
- [ ] 3.3 Add `aliases` parameter to `analyze()` function signature (defaulting to empty vec when None)

## 4. Vite plugin: alias extraction

- [ ] 4.1 In `configResolved` hook, read `config.resolve.alias` and normalize to `AliasEntry[]` shape — handle both array-of-objects (`{ find, replacement }`) and record (`{ key: value }`) formats
- [ ] 4.2 Convert absolute replacement paths to project-root-relative using `rootDir`
- [ ] 4.3 Sort aliases by pattern length descending (longest prefix first)
- [ ] 4.4 Serialize and pass as `path_aliases_json` argument in `runAnalysis()`

## 5. Next plugin: alias extraction

- [ ] 5.1 In `withAnimus` webpack callback, read `config.resolve.alias` and normalize to same `AliasEntry[]` shape
- [ ] 5.2 Convert absolute paths to project-root-relative, sort by length descending
- [ ] 5.3 Pass through to `analyzeProject()` call in `AnimusWebpackPlugin`

## 6. Verification

- [ ] 6.1 `cargo test --lib` — all Rust tests including new alias tests
- [ ] 6.2 `bun test` — JS test suite
- [ ] 6.3 `bun run verify:showcase` — showcase build with extraction

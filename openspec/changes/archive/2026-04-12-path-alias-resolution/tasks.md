# Tasks: path-alias-resolution

## Research / Audit

- [ ] Audit blockworks os-admin: grep for aliased imports (`@admin/`) in files that also contain `.extend()`, `.styles()`, or `asElement`/`asComponent`
- [ ] Count component-to-component imports using aliases vs relative paths
- [ ] Check if next-plugin consumers (if any) have the same pattern
- [ ] Decision gate: if zero aliased component imports found, document limitation and close; otherwise proceed with implementation

## Plugin: tsconfig path extraction

- [ ] In vite-plugin `buildStart`, read `tsconfig.json` from project root (or Vite's `tsconfig` config)
- [ ] Extract `compilerOptions.paths` and `compilerOptions.baseUrl`
- [ ] Serialize as `path_aliases_json` parameter — shape: `{ baseUrl: string, paths: Record<string, string[]> }`
- [ ] Pass to `analyzeProject()` as new optional parameter

## Rust: alias resolution in project_analyzer

- [ ] Add `path_aliases` parameter to `analyze()` function signature (optional, defaulting to empty)
- [ ] Parse alias patterns: convert `@admin/*` → prefix `@admin/` + wildcard expansion logic
- [ ] In `resolve_path` closure, add alias branch between relative and package map: if specifier matches alias prefix, expand and delegate to `resolve_relative_path`
- [ ] Handle multiple targets per alias (try in order, first match wins)

## NAPI boundary

- [ ] Add `path_aliases_json` optional parameter to `analyze_project` NAPI function in `lib.rs`
- [ ] Deserialize and pass through to `analyze()`
- [ ] Update both vite-plugin and next-plugin callers

## Verification

- [ ] Unit test: alias expansion `@admin/components/Button` → `src/components/Button.tsx`
- [ ] Unit test: non-matching specifier falls through to package map
- [ ] Integration: extension chain resolves across aliased import in showcase or test fixture
- [ ] Run `bun test` + `bun run test:canary`

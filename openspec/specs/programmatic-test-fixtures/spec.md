## Purpose

Requirements for the `programmatic-test-fixtures` capability: Shared system+theme fixture built from real builder API; Canary test theme fixtures migrated to programmatic; File entry helper reads real fixture files.

## Requirements

### Requirement: Shared system+theme fixture built from real builder API

The test infrastructure SHALL have a SINGLE shared system+theme definition used by both the extract canary tests and the integration test workspace. The definition SHALL live in `packages/extract/tests/test-system.ts` and be importable by `packages/_integration/`. Tests MUST import pre-serialized data from this fixture rather than maintaining JSON blobs by hand or duplicate theme definitions.

#### Scenario: Fixture builds and serializes system

- **WHEN** the shared fixture module is imported
- **THEN** it exports `config` containing `propConfig` (string), `groupRegistry` (string), and `transforms` (Record of live functions) — the output of `ds.serialize()`

#### Scenario: Fixture builds and serializes theme

- **WHEN** the shared fixture module is imported
- **THEN** it exports `theme` containing `scalesJson`, `variableMapJson`, `variableCss`, and `contextualVarsJson` (all strings) — the output of `tokens.serialize()`

#### Scenario: Fixture theme covers representative scales

- **WHEN** the fixture theme is built
- **THEN** it includes at minimum: a color scale, a spacing scale, a sizing scale, and breakpoint definitions — sufficient to exercise variant, responsive, and token-resolution extraction paths

### Requirement: Canary test theme fixtures migrated to programmatic

The canary tests in `packages/extract/tests/` SHALL replace their hand-maintained theme JSON with output from `tokens.serialize()` called on a real theme built with the builder API. The config fixture (`serialize-config.ts`) pattern already uses `ds.serialize()` — extend this pattern to theme data.

#### Scenario: Canary tests use serialize() output for theme

- **WHEN** canary tests execute
- **THEN** the `themeJson` (scales), `variableMapJson`, and `contextualVarsJson` arguments passed to `extract()` and `analyzeProject()` come from `tokens.serialize()` on a real theme — not from hand-maintained string literals

#### Scenario: Canary test assertions remain valid after migration

- **WHEN** hand-maintained theme JSON is replaced with `tokens.serialize()` output
- **THEN** all existing canary test assertions continue to pass, or are updated to reflect the correct serialization output (not weakened or removed)

### Requirement: File entry helper reads real fixture files

The integration test workspace SHALL include a helper function that reads `.tsx` fixture files from disk and produces `FileEntry[]` in the format `analyzeProject()` expects: `{ path: string, source: string }`. This replaces the vite-plugin's file discovery with a test-appropriate equivalent.

#### Scenario: File entries built from fixture directory

- **WHEN** the helper reads fixture component files from `fixtures/components/`
- **THEN** it returns an array of `{ path, source }` objects where `path` is relative to the fixture root and `source` is the full file content

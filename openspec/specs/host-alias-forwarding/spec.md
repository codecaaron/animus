## ADDED Requirements

### Requirement: Host alias extraction

Each plugin SHALL extract the host bundler's resolved path aliases and normalize them into a shared serialization format for the Rust pipeline.

#### Scenario: Vite plugin extracts aliases from configResolved

- **WHEN** the Vite plugin's `configResolved` hook fires
- **THEN** the plugin SHALL read `config.resolve.alias` and normalize each entry into `{ pattern, replacement, type }` format
- **AND** pass the serialized alias array to `analyzeProject()` via the `path_aliases_json` parameter

#### Scenario: Vite alias as array of objects

- **WHEN** `config.resolve.alias` is `[{ find: '@admin', replacement: '/abs/path/to/src' }]`
- **THEN** the plugin SHALL normalize `find` as the pattern and convert `replacement` to a project-root-relative path
- **AND** classify as `prefix` type if the pattern does not point to a specific file, or `exact` if it does

#### Scenario: Vite alias as record

- **WHEN** `config.resolve.alias` is `{ '@admin': '/abs/path/to/src' }`
- **THEN** the plugin SHALL normalize each key as a pattern and each value as a replacement
- **AND** convert absolute replacement paths to project-root-relative paths

#### Scenario: Next.js plugin extracts aliases from webpack config

- **WHEN** the `withAnimus` webpack callback receives the webpack config
- **THEN** the plugin SHALL read `config.resolve.alias` and normalize entries into the same shared format
- **AND** pass the serialized alias array to `analyzeProject()`

#### Scenario: No aliases configured

- **WHEN** the host bundler has no `resolve.alias` configured (or it is empty)
- **THEN** the plugin SHALL pass an empty alias array
- **AND** behavior SHALL be identical to current (no aliases resolved)

### Requirement: Alias ordering normalization

The plugin SHALL normalize alias ordering to ensure longest-prefix-first matching regardless of the host's internal ordering.

#### Scenario: Overlapping alias patterns

- **WHEN** the host provides aliases `@admin` and `@admin/components` in any order
- **THEN** the normalized array SHALL place `@admin/components` before `@admin` (longest prefix first)
- **AND** the Rust resolver SHALL try entries in array order, returning the first match

### Requirement: NAPI boundary for alias data

The `analyzeProject` NAPI function SHALL accept an optional `path_aliases_json` parameter containing the serialized alias array.

#### Scenario: Parameter shape

- **WHEN** `path_aliases_json` is provided
- **THEN** it SHALL be a JSON string containing `{ "aliases": [{ "pattern": string, "replacement": string, "type": "prefix" | "exact" }] }`
- **AND** the Rust side SHALL deserialize and use it in the `resolve_path` closure

#### Scenario: Parameter absent or null

- **WHEN** `path_aliases_json` is `None` or not provided
- **THEN** the resolver SHALL behave identically to current (no alias branch)

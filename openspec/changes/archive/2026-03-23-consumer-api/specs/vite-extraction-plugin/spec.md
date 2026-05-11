## MODIFIED Requirements

### Requirement: Plugin factory function
The Vite plugin SHALL be exported as `animusExtract(options?) -> Plugin` from `@animus-ui/vite-plugin`. When called with NO options, the plugin SHALL auto-detect the theme file, auto-import prop config from `@animus-ui/core`, and function without any consumer-provided serialization.

#### Scenario: Zero-config usage
- **WHEN** `animusExtract()` is called with no options and `src/theme.ts` exists in the project
- **THEN** the plugin SHALL auto-detect the theme, evaluate it, serialize config from `@animus-ui/core`, and perform extraction with CSS variable emission

#### Scenario: Explicit theme path
- **WHEN** `animusExtract({ themePath: './design/theme.ts' })` is called
- **THEN** the plugin SHALL evaluate the specified theme file instead of auto-detecting

#### Scenario: Auto-config from @animus-ui/core
- **WHEN** no `config` or `groupRegistry` options are provided
- **THEN** the plugin SHALL dynamically import `@animus-ui/core` and call `getExtractConfig()` to obtain serialized prop config and group registry

#### Scenario: Legacy pre-serialized theme (backward compatible)
- **WHEN** `animusExtract({ theme: '{"colors.primary": "#6366f1"}' })` is called with a JSON string
- **THEN** the plugin SHALL use it directly with no theme evaluation or variable emission

#### Scenario: Pre-evaluated theme (backward compatible)
- **WHEN** `animusExtract({ theme: { scales: '...', variables: '...' } })` is called
- **THEN** the plugin SHALL use the provided data directly without theme evaluation

#### Scenario: Theme auto-detection priority
- **WHEN** no `themePath` or `theme` option is provided
- **THEN** the plugin SHALL check for theme files in order: `src/theme.ts`, `src/theme.js`, `theme.ts`, `theme.js` relative to the project root, and use the first one found

#### Scenario: No theme found
- **WHEN** no theme file is found and no `theme`/`themePath` option is provided
- **THEN** the plugin SHALL use an empty theme `'{}'` and emit no CSS variable definitions

## ADDED Requirements

### Requirement: Public extract config API
`@animus-ui/core` SHALL export a `getExtractConfig()` function that returns `{ propConfig: string, groupRegistry: string }` — the serialized JSON strings the extraction pipeline requires.

#### Scenario: Config matches internal registries
- **WHEN** `getExtractConfig()` is called
- **THEN** the returned `propConfig` SHALL contain the same prop→CSS property→scale→transform mappings that the runtime builder chain uses

#### Scenario: Stable across imports
- **WHEN** `getExtractConfig()` is called multiple times
- **THEN** the returned strings SHALL be identical (deterministic serialization)

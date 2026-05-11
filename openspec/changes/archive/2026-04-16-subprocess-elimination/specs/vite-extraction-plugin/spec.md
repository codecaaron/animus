## NOTE

> **The bin file approach described here was superseded by embedded-transform-eval (session 62) and rust-system-loader (session 67).** Transforms are resolved in-process via boa_engine during Rust `analyzeProject` — no bin file or subprocess. System loading uses NAPI `loadSystemModule()` — all 3 subprocesses eliminated (not just 2). The main `vite-extraction-plugin` spec reflects the final state.

## MODIFIED Requirements (as originally proposed — fully superseded)

### Requirement: Transform post-processing via bin file
After `analyzeProject` returns CSS with `__TRANSFORM__` placeholders, the plugin SHALL resolve them by generating and executing a zero-dependency CJS bin file containing extracted transform function sources. This replaces the previous subprocess that imported the system module for live transform function execution.

#### Scenario: Bin file replaces transform subprocess
- **WHEN** `analyzeProject` returns CSS containing `__TRANSFORM__` placeholders
- **THEN** the plugin writes a bin file with extracted transform sources from the manifest, executes it via `execSync`, and reads the resolved CSS

#### Scenario: No placeholders skip bin file entirely
- **WHEN** `analyzeProject` returns CSS with no `__TRANSFORM__` placeholders
- **THEN** the plugin uses the CSS directly — no bin file generated, no exec call

#### Scenario: HMR geological reset re-generates bin file
- **WHEN** system file changes trigger a geological reset
- **THEN** the plugin re-runs analysis, extracts fresh transform sources, and generates a new bin file for resolution

### Requirement: Global styles passed as raw JSON to Rust
The system load subprocess SHALL ship raw global style block objects as JSON (the `styles` property of each `GlobalStyleBlock`) to the plugin. The plugin SHALL pass these to `analyzeProject` as a new parameter. Rust resolves them using theme_resolver. The subprocess SHALL NOT resolve global styles.

#### Scenario: Subprocess outputs raw global blocks
- **WHEN** the system module exports a `globalStyles` block with `{ body: { m: 0, bg: '{colors.surface}' } }`
- **THEN** subprocess 1 outputs `{ globalStyleBlocks: { globalStyles: { body: { m: 0, bg: '{colors.surface}' } } } }` as raw JSON

#### Scenario: Plugin passes raw blocks to analyzeProject
- **WHEN** the plugin receives raw global style block JSON from subprocess 1
- **THEN** it passes the JSON string as a new parameter to `analyzeProject`

### Requirement: Plugin accepts browser target configuration
Optional `targets` and `minify` options for CSS post-processing via Lightning CSS. Auto-detects browserslist from project. No change in behavior — this requirement is restated for clarity that post-processing still applies to the combined output (global + component CSS resolved by the bin file).

#### Scenario: Post-processing applies after bin file resolution
- **WHEN** the bin file resolves `__TRANSFORM__` placeholders
- **THEN** the resolved CSS is post-processed with Lightning CSS (autoprefixing, optional minification) before serving via the virtual module

## REMOVED Requirements

### Requirement: Global styles resolution via standalone subprocess
**Reason**: Replaced by Rust resolution in `analyzeProject`. See `global-styles-system` spec.
**Migration**: `resolve-global-styles.ts` is no longer invoked. The plugin passes raw global style block JSON to `analyzeProject` instead.

### Requirement: Transform post-processing via subprocess
**Reason**: Replaced by the bin file post-processor. See `transform-bin-resolver` spec.
**Migration**: The system load subprocess no longer writes transform resolution scripts. The plugin generates a bin file from manifest-extracted transform sources instead.

## Purpose

Requirements for the `js-pipeline-timing` capability: Zero-cost timer gate; buildStart full phase timing; Aggregate per-file transform timing; and 2 more.

## Requirements

### Requirement: Zero-cost timer gate

The plugin SHALL provide `now()` and `elapsed()` timing helpers that return real `performance.now()` values when verbose mode is active and return `0` when verbose mode is inactive. This ensures zero measurement overhead in production builds.

#### Scenario: Verbose mode active

- **WHEN** `verbose: true` or `ANIMUS_DEBUG=1` is set
- **THEN** `now()` SHALL return `performance.now()` and `elapsed(start)` SHALL return the rounded millisecond difference

#### Scenario: Verbose mode inactive

- **WHEN** verbose is false and `ANIMUS_DEBUG` is not set
- **THEN** `now()` SHALL return `0` and `elapsed(start)` SHALL return `0` — no `performance.now()` calls occur

### Requirement: buildStart full phase timing

The vite-plugin SHALL measure every distinct operation in `buildStart` using the timer gate. Each phase SHALL be collected into a timing record for display and optional JSON output.

#### Scenario: All buildStart phases timed

- **WHEN** `buildStart` executes with verbose mode active
- **THEN** the following phases SHALL each have independent timing: system-load, file-discovery, file-read+hash, package-resolve, analysis (decomposed into json-serialize + rust-extract + json-parse), lightning-css, and total

#### Scenario: Analysis decomposition

- **WHEN** `runAnalysis()` executes
- **THEN** the timing SHALL separately report: duration of `JSON.stringify(fileEntries)` (json-serialize), duration of the `analyzeProject()` NAPI call (rust-extract), and duration of `JSON.parse(manifestJson)` (json-parse)

### Requirement: Aggregate per-file transform timing

The plugin SHALL collect timing for each `transformFile()` NAPI call and report aggregate statistics.

#### Scenario: Transform stats after build

- **WHEN** a production build completes and verbose mode is active
- **THEN** the plugin SHALL report total transform time, file count, minimum per-file time, maximum per-file time, and average per-file time

#### Scenario: Transform stats reset per cycle

- **WHEN** an HMR update triggers in dev mode
- **THEN** the transform aggregate stats SHALL report only the transforms executed in that HMR cycle, not cumulative across all cycles

### Requirement: Lightning CSS timing

The plugin SHALL time `postProcessCss()` calls in the load hook.

#### Scenario: CSS post-processing timed

- **WHEN** a virtual module is loaded and CSS post-processing (autoprefixing, minification) executes
- **THEN** the duration SHALL be captured and included in the buildStart waterfall as the `lightning-css` phase

### Requirement: Structured JSON timing output

When `ANIMUS_TIMING_JSON=1` is set, the plugin SHALL emit a single JSON line containing the complete timing tree after the human-readable waterfall.

#### Scenario: JSON output emitted

- **WHEN** `ANIMUS_TIMING_JSON=1` is set and verbose mode is active
- **THEN** the plugin SHALL emit a line prefixed with `[animus:timing]` containing a flat JSON object with dot-notation hierarchical keys merging JS phases and Rust `PipelineTiming` phases

#### Scenario: JSON not emitted without env var

- **WHEN** `ANIMUS_TIMING_JSON` is not set
- **THEN** no JSON timing line SHALL be emitted — only the human-readable waterfall (if verbose)

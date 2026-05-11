## NOTE

> **The bin file approach described here was superseded by embedded-transform-eval (session 62) and rust-system-loader (session 67).** Both plugins use NAPI `loadSystemModule()` for system loading and boa_engine in-process transform resolution — no subprocesses or bin files. The main `next-webpack-integration` spec reflects the final state.

## MODIFIED Requirements (as originally proposed — fully superseded)

### Requirement: Webpack plugin orchestrates extraction pipeline
The webpack plugin SHALL run the full pipeline: `loadSystem → analyzeProject → resolveTransformPlaceholders → applyUnitFallback` once per build. Transform resolution SHALL use the bin file post-processor (same as the Vite plugin) instead of the previous subprocess approach. Global styles SHALL be passed as raw JSON to `analyzeProject` for Rust resolution, not resolved in a JS subprocess.

#### Scenario: Next.js build uses bin file for transforms
- **WHEN** a Next.js production build runs the webpack plugin
- **THEN** transform placeholders are resolved via the zero-dep bin file, not a subprocess importing the system module

#### Scenario: Next.js dev watch uses bin file for transforms
- **WHEN** a Next.js dev server re-analyzes after file changes
- **THEN** the bin file is regenerated from fresh manifest data and executed for transform resolution

#### Scenario: Global styles resolved by Rust in Next.js
- **WHEN** the system module exports global style blocks
- **THEN** the webpack plugin passes raw global style block JSON to `analyzeProject` and receives resolved global CSS (with `__TRANSFORM__` placeholders resolved by the bin file)

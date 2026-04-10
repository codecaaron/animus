## Why

The Vite plugin's `buildStart` spawns 3 sequential bun subprocesses that each import the same system module and call `.toConfig()` — system serialization, global styles resolution, and transform placeholder resolution. This costs ~300-360ms in pure process spawn overhead on every build start and every HMR geological reset. Two of the three subprocesses are eliminable by enforcing that `createTransform` callbacks are self-contained (no external references), allowing Rust to extract their source spans from the AST and resolve them without live JS execution of the system module.

## What Changes

- **`createTransform` self-contained constraint**: Transform callbacks passed to `createTransform('name', fn)` must have no external references — no imports, no closure captures, no helper function calls. The callback is the complete program. This is an **API contract** enforced at extraction time via AST validation.
- **Inline built-in transform helpers**: The 4 built-in transforms (`size`, `borderShorthand`, `gridItem`, `gridItemRatio`) currently import from `./utils`. Inline those 2-3 line helpers into each callback body so they satisfy the self-contained constraint. **BREAKING** for anyone importing `percentageOrAbsolute` or `numberToTemplate` from `@animus-ui/system` (internal, not public API).
- **Rust transform source extraction**: New AST scan pass in the Rust crate. Finds `createTransform` call expressions, extracts the callback source span verbatim, validates no external references, emits (name, source) pairs as part of the manifest.
- **Transform bin file post-processor**: Plugin writes extracted transform sources into a ~15-line zero-dep CJS file. One `execSync('node runner.js input.css output.css')` resolves all `__TRANSFORM__` placeholders. Runs on node or bun — no TS, no imports.
- **Global styles resolution in Rust**: Move global style block resolution from the JS subprocess into Rust's `analyzeProject`. The theme_resolver already handles prop shorthand expansion, scale lookup, and token alias resolution. Transform values emit `__TRANSFORM__` placeholders resolved by the same bin file.
- **Subprocess 1 ships raw data**: The remaining system load subprocess discovers global style blocks but ships them as raw JSON objects instead of resolved CSS. Resolution moves to Rust.
- **Remove subprocesses 2 and 3**: Global styles subprocess and transform resolution subprocess are eliminated entirely.

## Capabilities

### New Capabilities

- `self-contained-transforms`: API contract enforcement for createTransform callbacks — no external references, AST validation at extraction time, diagnostic emission for violations
- `transform-bin-resolver`: Zero-dependency CJS post-processor that resolves __TRANSFORM__ placeholders in CSS using extracted transform source spans. Generated per-build from manifest data.

### Modified Capabilities

- `named-transforms`: Adding self-contained constraint to the callback API contract
- `vite-extraction-plugin`: Removing 2 subprocesses, adding bin file post-processing step, buildStart becomes async
- `global-styles-system`: Resolution moves from JS subprocess to Rust theme_resolver path within analyzeProject
- `system-serialization`: Subprocess 1 output changes — ships raw global style block objects instead of resolved CSS
- `next-webpack-integration`: Same subprocess elimination and bin file changes as Vite plugin

## Impact

- **Packages modified**: `system` (transforms), `extract` (Rust crate + pipeline), `vite-plugin`, `next-plugin`
- **Performance**: ~200ms+ reduction per buildStart and HMR geological reset (2 fewer subprocess spawns)
- **Runtime compatibility**: Bin file is pure CJS — removes bun requirement for transform/global-styles resolution. System load subprocess still needs bun or node with TS support.
- **API surface**: `createTransform` gains an enforced constraint. Existing user transforms that are already self-contained (the common case) are unaffected. Transforms with external references get a build-time diagnostic with actionable message.
- **Test surface**: Rust canary tests for transform extraction. Integration tests for bin file resolution. Existing transform behavior tests remain (output unchanged).

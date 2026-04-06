## Why

The Rust extraction crate's core functions have accumulated positional parameters as features were added (selector aliases, contextual vars, variable maps). `resolve_styles` takes 8 parameters where 6 are shared immutable context identical across every call in a processing chain. `process_chain` takes 11. This makes the code harder to read, harder to extend, and creates friction for the next planned change (context-free compose) which needs to thread additional data through the pipeline.

## What Changes

- Introduce `ResolveContext<'a>` struct grouping the 6 shared immutable parameters of `resolve_styles` (config, theme, variable_map, contextual_vars, breakpoint_keys, selector_aliases)
- Update `resolve_styles` signature from 8 params to 3: `(styles, &ctx, auto_content)`
- Introduce `ProcessingContext<'a>` wrapping `ResolveContext` plus `group_registry` and `class_prefix` for `process_chain`
- Update `process_chain` signature from 11 params to 4: `(chain, source, filename, &ctx)`
- Update all call sites: 6 production `resolve_styles` calls, ~17 test calls, 2 `process_chain` callers, 1 `analyze` caller
- NAPI boundary (`analyze_project`'s 12 string params) is untouched — it remains the serialization layer

Zero behavior change. 196 existing Rust tests serve as the safety net.

## Capabilities

### New Capabilities

_(none — this is a pure structural refactor with no new user-facing or pipeline behavior)_

### Modified Capabilities

_(none — no spec-level requirements change; the refactor is internal to the crate's function signatures)_

## Impact

- **packages/extract/src/theme_resolver.rs** — `resolve_styles` signature change, `ResolveContext` struct definition, all test call sites updated
- **packages/extract/src/lib.rs** — `process_chain` signature change, `ProcessingContext` struct definition, context construction in `extract()`, 5 internal `resolve_styles` calls updated
- **packages/extract/src/project_analyzer.rs** — `analyze()` constructs contexts, `process_chain` call updated
- **packages/extract/src/css_generator.rs** — utility CSS `resolve_styles` call updated, function signatures that receive shared params updated
- **No NAPI API changes** — the plugin, vite integration, and all JS consumers are unaffected
- **No behavior changes** — all 196 Rust tests must pass without modification (only signatures change)

## Context

The extraction pipeline's core resolution function `resolve_styles` (theme_resolver.rs:68) takes 8 positional parameters. Six of these — `config`, `theme`, `variable_map`, `contextual_vars`, `breakpoint_keys`, `selector_aliases` — are shared immutable context constructed once per extraction run and threaded identically through every call. The seventh (`auto_content`) is a chain-position flag (true for `.styles()`, false for variant/compound/state). The eighth (`styles`) is the per-call input.

This pattern repeats upward: `process_chain` (lib.rs:373) takes 11 params, `analyze` (project_analyzer.rs:203) takes 11. Each new feature (selector aliases, contextual vars, variable maps) has accreted as additional positional parameters across all three layers.

The next planned change (context-free compose) needs `ComposeFamilyInfo` threaded from Phase 5d scan through Phase 5e reconciler to Phase 6 CSS generation. Adding more positional params to already-bloated signatures would further degrade readability.

## Goals / Non-Goals

**Goals:**
- Group shared immutable resolution parameters into `ResolveContext<'a>` — resolve_styles goes from 8 params to 3
- Group shared processing parameters into `ProcessingContext<'a>` — process_chain goes from 11 params to 4
- Construct contexts once at the pipeline entry points (extract, analyze) and thread references
- Maintain exact behavioral equivalence — 196 Rust tests pass without logic changes
- Make the codebase ready for context-free compose's data threading needs

**Non-Goals:**
- Changing the NAPI boundary (analyze_project's 12 string params stay as-is — that's the serialization layer)
- Adding new pipeline functionality or data flow
- Refactoring css_generator.rs function signatures beyond the resolve_styles call site
- Introducing a PipelineState struct (premature — compose data can be a local in analyze())
- Performance optimization (no measurable impact expected from struct references vs positional params)

## Decisions

### Decision 1: Two-tier context structs

`ResolveContext<'a>` holds the 6 params consumed by `resolve_styles`. `ProcessingContext<'a>` embeds a `ResolveContext` plus `group_registry` and `class_prefix` consumed by `process_chain`.

```rust
pub struct ResolveContext<'a> {
    pub config: &'a PropConfigMap,
    pub theme: &'a FlatTheme,
    pub variable_map: &'a VariableMap,
    pub contextual_vars: &'a ContextualVarsMap,
    pub breakpoint_keys: &'a HashSet<String>,
    pub selector_aliases: &'a SelectorAliasesMap,
}

pub struct ProcessingContext<'a> {
    pub resolve: &'a ResolveContext<'a>,
    pub group_registry: &'a HashMap<String, Vec<String>>,
    pub class_prefix: &'a str,
}
```

**Why two, not one:** resolve_styles doesn't need group_registry or class_prefix. Matching struct boundaries to consumption boundaries prevents passing unnecessary data and keeps the resolution layer independent of pipeline concerns.

**Alternative considered:** Single `PipelineContext` containing everything. Rejected because it couples theme resolution to pipeline-level config, and css_generator.rs calls resolve_styles independently of process_chain.

### Decision 2: ResolveContext lives in theme_resolver.rs

The struct is defined where `resolve_styles` lives. This keeps the resolution module self-contained — any consumer that imports `resolve_styles` gets `ResolveContext` from the same module.

**Alternative considered:** Separate `context.rs` module. Rejected as premature — one struct doesn't warrant a new module.

### Decision 3: ProcessingContext lives in lib.rs

`process_chain` is defined in lib.rs, so `ProcessingContext` lives there too. It re-exports `ResolveContext` from theme_resolver for convenience.

### Decision 4: auto_content stays a direct parameter

`auto_content` is not shared context — it changes per call site (true for `.styles()`, false for everything else). It stays as the third parameter to `resolve_styles` rather than being placed on a `ChainPosition` struct.

**Why not ChainPosition now:** There's only one position-dependent flag today. A struct for one bool is noise. When context-free compose adds `is_composed_context` or similar, that's the natural time to introduce ChainPosition.

### Decision 5: Context construction at pipeline entry points

`extract()` (lib.rs:47) and `analyze()` (project_analyzer.rs:203) are the two entry points that deserialize JSON params. Each constructs a `ResolveContext` from the deserialized values and passes `&ctx` downward. No context construction happens mid-pipeline.

### Decision 6: Test helper for ResolveContext

The ~17 test calls in theme_resolver.rs all construct the same empty/minimal context. A test helper `test_context()` or similar reduces boilerplate without affecting production code.

## Risks / Trade-offs

**[Risk: Merge conflicts with in-flight work]** → The `next` branch has uncommitted work that was just committed. No other branches are active. Low risk.

**[Risk: Lifetime complexity]** → `ResolveContext<'a>` introduces explicit lifetimes. All references are to data that lives for the entire extraction run, so lifetime elision works naturally. The borrow checker may require minor annotation in css_generator.rs where resolve_styles is called inside a closure. → Mitigation: if lifetime annotations become complex in any call site, pass owned clones for that specific site rather than fighting the borrow checker.

**[Trade-off: Two structs vs one]** → More types to know about, but each matches its consumption boundary exactly. The alternative (one big struct) would thread unused fields into resolve_styles.

**[Trade-off: Mechanical churn]** → ~23 call sites change for zero behavior change. Justified by the readability improvement and the unblocking of context-free compose.

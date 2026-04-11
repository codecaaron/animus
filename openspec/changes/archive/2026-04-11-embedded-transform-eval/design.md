## Context

The extraction pipeline generates CSS in Rust but cannot execute JavaScript transform functions. The current solution emits `__TRANSFORM__name__value__` placeholders (theme_resolver.rs:512) that are resolved post-hoc by a Node.js subprocess. The subprocess-elimination work replaced a full Node.js import with a lightweight CJS bin file, but the IPC boundary remains: Rust serializes CSS → plugin writes bin file → execSync spawns Node → Node resolves placeholders → plugin reads result.

Transform callbacks are self-contained JavaScript functions with no external references. They are already extracted as source strings by `transform_extractor.rs` and validated by `validate_self_contained`. The callbacks use standard JS features: typeof, ternary, template literals, regex, for loops, string methods, parseFloat. All of these are supported by `boa_engine` (0.21.1), a pure-Rust JavaScript engine with >90% ECMAScript Test262 compliance.

The oxc crates are at 0.121.0. `oxc_codegen` does NOT strip TypeScript — it faithfully round-trips TS syntax. Proper TS→JS conversion requires `oxc_transformer`, which mutates the AST in-place to remove type annotations. The pipeline is: Parse → Semantic → Transform → Codegen.

Phase 1 of the project analyzer parses each file twice: once via `walk_chains` (line 326, own allocator) and once via `Parser::new` for module info + transform extraction (line 331, separate allocator). These operate on the same source and can share a single parse.

## Goals / Non-Goals

**Goals:**
- Evaluate transform callbacks in-process via boa_engine — CSS values fully resolved in Rust
- Eliminate the `__TRANSFORM__` placeholder protocol, bin file subprocess, SPLIT_MARKER, and stripTs regex
- Proper TS→JS stripping via oxc_transformer + oxc_codegen for extracted transform sources
- Bump oxc crates to 0.124.0 for currency
- Consolidate Phase 1 redundant parses into a single parse per file
- Maintain the self-contained constraint on transform callbacks

**Non-Goals:**
- Evaluating the system serialization subprocess (subprocess 1) — that remains for now
- Relaxing the self-contained constraint to allow imports in transforms (shadow entrypoint architecture)
- Adopting oxc_traverse for chain walking or JSX scanning (working code, not a pain point)
- Adopting oxc_resolver for package resolution (pre-computed by plugin, not needed in Rust)
- Source map generation via oxc_codegen (not needed for transform sources)

## Decisions

### 1. Use boa_engine, not rquickjs

**Choice:** Embed `boa_engine` (pure Rust JS engine) for transform evaluation.

**Rationale:** boa is pure Rust — no C compilation, no FFI, no unsafe code beyond what boa manages internally. For self-contained functions evaluated once per transform per build, boa's eval performance (~microseconds) is more than sufficient. The alternative, rquickjs (QuickJS C bindings), is faster but introduces C compilation into the dependency chain.

**Alternative considered:** Pure Rust AST evaluator (~500-800 lines covering typeof, regex, for loops, array destructuring, template literals, parseFloat). Rejected — "whack-a-mole" maintenance risk as user-authored transforms evolve. boa handles 100% of ES2024+ for free.

**Alternative considered:** rquickjs. Rejected — C compilation dependency is unnecessary given boa's sufficient performance for our use case.

### 2. Single boa Context per analyze_project call, not per-transform

**Choice:** Create one `boa_engine::Context` at the start of `analyze_project`, register all extracted transform functions into it, then call them during CSS generation.

**Rationale:** Context creation has overhead (~1-2ms). Creating one and reusing it across all transform evaluations amortizes this. The transforms are registered as named functions in the context's global scope. During `resolve_value` in theme_resolver, a transform call is a function invocation in an already-warm context.

### 3. oxc_transformer + oxc_codegen for TS stripping, not regex

**Choice:** Parse → SemanticBuilder → Transformer (strip TS) → Codegen (print_expression) → pure JS source string.

**Rationale:** `oxc_codegen` alone does NOT strip TypeScript — it faithfully emits TS syntax including type annotations, `as` casts, and return types. The `oxc_transformer` with TypeScript options mutates the AST in-place to remove all TS-specific nodes. Codegen then emits the cleaned AST as pure JS. This replaces the regex `stripTs()` hack which has known blind spots for complex generics and intersection types.

**Alternative considered:** Custom narrow emitter (~60-80 lines) that manually skips TS nodes during emission. Rejected — more code to maintain than using oxc's own transformer, and risks missing edge cases in TS syntax.

### 4. Transform evaluation happens in theme_resolver, replacing placeholder emission

**Choice:** At theme_resolver.rs:512, instead of `format!("__TRANSFORM__{}__{}__", ...)`, call the boa context with the transform name and input value, return the resolved CSS directly.

**Rationale:** This is the most surgical integration point. The resolve_value function already has the transform name and the input value. The boa context is passed down via ResolveContext. No other function signatures in the pipeline need to change beyond adding the context reference.

### 5. Consolidate Phase 1 parses by extracting parse from walk_chains

**Choice:** Parse the file once in project_analyzer's Phase 1 loop, pass `&Program` to both `walk_chains_from_program` (new function) and `parse_module_info` + `extract_transforms`.

**Rationale:** Currently `walk_chains` (line 326) creates its own parse internally, then a second parse (line 331) is created for module info. Both operate on the same source text. Restructuring `walk_chains` to accept `&Program` eliminates one parse per file (~2-5ms per file, ~100-250ms for 50 files).

### 6. Remove extracted_transforms from the manifest

**Choice:** Transforms are consumed internally by Rust during CSS generation. The manifest JSON no longer ships `extracted_transforms` to plugins.

**Rationale:** Plugins no longer need transform sources — there's nothing to resolve post-Rust. The bin file, SPLIT_MARKER, and transform entries in the manifest all become dead code.

## Risks / Trade-offs

**[Risk] boa_engine binary size increase (~4-5MB)** → The NAPI binary is already substantial. 4-5MB additional is acceptable for eliminating a subprocess. Monitor after integration and strip debug symbols (already configured in Cargo.toml release profile).

**[Risk] boa_engine compile time increase** → boa is a substantial crate. First compile will be slower. Incremental rebuilds unaffected since boa source doesn't change. Mitigation: boa is a leaf dependency — changes to extraction code don't trigger boa recompilation.

**[Risk] boa eval produces different results than Node.js for edge cases** → >90% Test262 compliance means some exotic JS edge cases may differ. Mitigation: transform callbacks use standard features (typeof, ternary, regex, template literals, loops, string methods) that are well-covered. Canary tests verify round-trip correctness.

**[Risk] oxc 0.121→0.124 behavioral changes** → No documented breaking API changes. Mitigation: `cargo build` catches compile-time breaks; canary + Rust tests catch behavioral changes.

**[Risk] Transform evaluation errors surface differently** → Currently, a broken transform causes a Node.js subprocess crash (opaque). With boa, evaluation errors can be caught and surfaced as structured diagnostics in the extraction result. This is an improvement, not a regression.

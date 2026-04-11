## Context

The Rust extraction crate (`packages/extract/`) is the performance-critical core of the Animus build pipeline. It parses TS/TSX via oxc, walks builder chains, evaluates style objects to static `serde_json::Value`, resolves theme scales, and generates `@layer`-structured CSS. Current state:

- **~200+ `HashMap`/`HashSet` instances** across 12 source files, all string-keyed, using `std::collections` SipHash (cryptographic, unnecessary overhead for non-adversarial data).
- **Phase 1 is sequential**: Each file gets its own `Allocator`, produces independent results (chains, module info, transforms), but the loop runs serially under a mutex lock that's only needed for cache hits.
- **`style_evaluator::eval_expression` bails on ALL identifiers** (line 230): `Expression::Identifier(_) => Err(BailError::new("variable reference (non-static)"))`. This means `const GAP = 16; styles({ gap: GAP })` skips the `gap` property even though the value is provably static.
- **`process_chain` re-parses each stage's argument span** via `parse_object_from_source` (lib.rs:667). This creates a fresh mini-AST per stage, disconnected from the file's full AST and any semantic context.

## Goals / Non-Goals

**Goals:**
- Swap all HashMap/HashSet to FxHashMap/FxHashSet for faster string hashing
- Parallelize Phase 1 file parsing with rayon
- Add Linux linker flag for NAPI worker-thread safety
- Enable static resolution of const/import identifiers in style evaluation
- Increase extraction coverage — properties currently skipped as "non-static" that ARE provably static should extract

**Non-Goals:**
- Scope-aware shadowing detection (oxc_semantic scope tree) — deferred until a real bug motivates it
- Object spread resolution (`{ ...baseConfig }`) — requires full merge semantics, continues to bail
- Moving CSS post-processing (lightningcss) into Rust — architectural change for a future session
- Replacing `import_resolver.rs` with `oxc_resolver` — different problem domains
- Dynamic expression evaluation (function calls, ternaries, template literals with expressions)

## Decisions

### Decision 1: FxHashMap via type alias swap

**Choice:** Add `rustc-hash` crate, create type aliases, find-and-replace across crate.

**Rationale:** `theme_resolver.rs` already defines type aliases (`PropConfigMap`, `FlatTheme`, `VariableMap`, etc.) that many modules consume. Changing the underlying type at the alias site propagates to all consumers. For files that use `HashMap` directly, swap imports.

**Alternative considered:** `ahash` — similar performance but `rustc-hash` is simpler (no runtime seed), widely used in the Rust compiler and Tailwind Oxide. For deterministic string-keyed maps, FxHash is ideal.

### Decision 2: Rayon Phase 1 — split cache-hit and cache-miss paths

**Choice:** Restructure Phase 1 into two passes:
1. **Cache-hit pass** (sequential, under lock): Iterate files, extract matching cache entries. Quick — just HashMap removes.
2. **Cache-miss pass** (parallel, lock-free): Collect cache-miss files into a Vec, then `par_iter()` over them. Each spawned task creates its own `Allocator`, parses, walks chains, extracts transforms. Collect results into per-file structs, then merge into the main maps sequentially.

**Rationale:** The current loop holds the mutex for the entire Phase 1 duration. Cache hits need the lock (they `remove()` from the shared cache). Cache misses don't touch the cache at all — they only produce new data. Separating them lets misses run in parallel.

**Data flow:**
```
files → partition → [cache_hits] → sequential under lock → insert into maps
                  → [cache_misses] → par_iter (each: allocator + parse + walk + extract)
                                   → collect Vec<FileResult>
                                   → sequential merge into maps
```

**Why not par_iter the whole loop:** The cache HashMap is behind a Mutex. Taking/releasing the lock per-file in parallel would cause contention and potential deadlocks with the current `remove()`-based ownership pattern.

### Decision 3: Static value map for identifier resolution

**Choice:** Build a per-file "static value map" (`HashMap<String, Value>`) during Phase 1, pass it through to `eval_expression` for identifier resolution.

**Architecture:**

```
Phase 1 (per file):
  parse → AST
  walk top-level VariableDeclarations (const only)
    → for each: try eval_object_expr / eval_expression on init
    → success: insert (binding_name → Value) into file's static_values map
    → failure: skip (non-static init, complex expression)
  also build: static_exports map (exported names → Value)

Phase 2 (after binding resolution):
  for each file:
    for each import in module_info.imports:
      resolve via binding_map → (source_file, export_name)
      look up source_file's static_exports → Value
      insert into file's static_values as local_name → Value

Phase 5 (evaluation):
  process_chain receives &static_values for the file
  parse_object_from_source receives &static_values
  eval_expression: on Identifier(name) →
    check static_values.get(name) → Some(value) → Ok(value.clone())
    None → Err(BailError) (current behavior)
```

**Why not oxc_semantic for this:** SemanticBuilder gives you a symbol table and scope tree, but to get a symbol's *value* you still need to evaluate its init expression — which is what our `eval_expression` already does. The simple AST walk over top-level `const` declarations gets the same result without the semantic analysis overhead. Semantic adds scope-awareness (detecting shadowed variables), but for top-level module-scope consts — which is 95%+ of the real-world use case — a simple walk is sufficient and faster.

**Why const only:** `let` and `var` are mutable. A `let` binding could be reassigned between declaration and usage. `const` guarantees the value at declaration site IS the value at usage site. This is the same reasoning TypeScript uses for literal type narrowing.

### Decision 4: Tier 2 — Object reference resolution

**Choice:** When `parse_object_from_source` encounters an expression that is an Identifier (not an ObjectExpression), check the static value map. If the resolved value is a `Value::Object`, use it directly.

**Current behavior:** `parse_object_from_source` expects a `(...)` wrapped source that parses to an `ObjectExpression`. If the stage argument is an identifier like `styles(config)`, it returns `"failed to parse object expression"`.

**New behavior:**
```
parse_object_from_source(source, static_values):
  parse source as expression
  if ObjectExpression → eval as before
  if Identifier → look up in static_values
    if Value::Object → return it (with empty skips/captures)
    else → error
  else → error as before
```

### Decision 5: Linux linker flag

**Choice:** Add `[target.x86_64-unknown-linux-gnu]` and `[target.aarch64-unknown-linux-gnu]` sections to `.cargo/config.toml` with `rustflags = ["-C", "link-arg=-Wl,-z,nodelete"]`.

**Rationale:** Prevents segfault when Node.js unloads worker threads while the native addon's thread-local storage is still mapped. macOS uses Mach-O (not affected). This is a known NAPI-RS production issue.

## Risks / Trade-offs

**[Risk] rayon thread pool + boa_engine interaction** → boa `Context` is created after Phase 1, not during. No interaction. The rayon pool is only used for parsing/walking, which is pure oxc (no boa).

**[Risk] Static value map adds memory pressure** → Maps are per-file, contain only successfully-evaluated consts. For a typical file with 5-10 top-level consts, this is negligible. Maps are dropped after Phase 5.

**[Risk] FxHashMap is not cryptographically secure** → Irrelevant. All data is from trusted source files during build. No adversarial input.

**[Risk] Cross-file resolution depends on Phase 1→2 ordering** → By design. Static export maps are built in Phase 1 (per-file, independent). Cross-file resolution happens after Phase 2's binding_map is complete. This matches the existing pipeline ordering.

**[Risk] Identifier resolution changes evaluation semantics** → Properties that previously skipped (becoming dynamic props) will now extract. If a user relied on the skip behavior (unlikely but possible), their component's runtime styling changes. Mitigation: extraction diagnostics will show newly-extracted properties. The existing canary tests verify the CSS output.

**[Trade-off] Simple const walk vs SemanticBuilder** → We trade scope-awareness for simplicity and speed. A `const X = 16` inside a function body would be collected by our walk but wouldn't be in scope at the module level. Mitigation: we only walk top-level statements (direct children of `program.body`), not nested scopes. This naturally limits collection to module-scope declarations.

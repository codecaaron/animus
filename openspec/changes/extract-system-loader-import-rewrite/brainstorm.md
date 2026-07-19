# Brainstorm: extract system-loader import rewriting

Existing exploration evidence: RepoWise targeted health/risk/context/why for
`packages/extract/crates/system-loader/src/lib.rs` at indexed commit
`fd168798bbc4`; live-verified symbol source for
`rewrite_module_for_bundle()`; the deterministic extraction plan
`d616f5bdcb084ef8b0158521888ad178`; active-change ownership search; colocated
tests and manifest reads; and exact target/dirty-tree hashes. The
`superpowers:brainstorming` skill was invoked earlier in this session, and this
evidence settles the bounded choice without another interactive pass.

## Decision chain

1. RepoWise's critical-method lead is real: `rewrite_module_for_bundle()` is
   208 NLOC with CCN 30, cognitive complexity 136, and nesting depth 8 in a
   91st-percentile increasing hotspot with one recent owner.
2. The complete function owns several independent compatibility policies:
   import rewriting, four export forms, reverse-span application, and trailing
   export assignment. Flattening all of them together would be a broad,
   difficult-to-revert edit.
3. The high-confidence 54-line import-specifier extraction is independently
   actionable. It has no external caller and can be pinned through direct
   exact-output characterization while leaving parser, span, export, and
   execution ownership in place.
4. Current import behavior has observable edges that a structural refactor
   must preserve: resolved versus stub require keys; bare imports; named
   same-name and aliased bindings; default-then-named output ordering;
   namespace binding; and namespace dominance when a default and namespace
   specifier coexist.
5. The shared loader is engine-neutral and consumed by both NAPI bindings.
   This is a shared-boundary refactor, not an invitation to change V1/V2 phase
   behavior or the later rquickjs evaluation seam.
6. Therefore the smallest honest increment is one private helper extraction,
   preceded by a GREEN output matrix and an honestly RED structural check.

## Queue selection observations

- `packages/extract/src/theme_resolver.rs::resolve_value` remains a valid,
  higher-risk lead, but the complete `harden-embedded-transform-integration`
  OODA increment protects both V1 and V2 theme files by exact hash. Defer until
  `ooda:embedded-transform-guardrail-released` permits a new hash owner.
- `packages/extract/crates/extract-v2/src/usage_facts.rs::filter_usage_scan`
  remains a valid lead, but `share-v1-reconciler-liveness-policy` protects that
  file by exact hash. Defer until `ooda:liveness-policy-guardrail-released`.
- No active non-archive change owns the selected system-loader file.

## Known now

- `rewrite_module_for_bundle()` is private and feeds `build_bundle()` inside
  the engine-neutral system-loader crate.
- `Statement::ImportDeclaration` first resolves a canonical require key from
  `(canonical_path, specifier)` and falls back to `__stub__/<specifier>`.
- Bare imports become one `__require('<key>')` expression whether OXC exposes
  absent or empty specifiers.
- Named imports preserve source order and render aliases as `imported: local`.
- Default imports render before named destructuring and the two statements are
  joined with `;\n`.
- A namespace import renders one namespace binding. If a default and namespace
  binding coexist, the namespace branch currently dominates and the default
  binding is omitted; this oddity is compatibility behavior for this refactor.
- Export rewriting, reverse byte-order span replacement, trailing exports,
  dependency resolution, bundle execution, and rquickjs evaluation are outside
  the extraction seam.
- The target file is clean and initially hashes to
  `e961b0b4b415e0eb4163e55644398728af59005a9ca2bc30a4d35aeaed88b169`.
- The protected tracked diff excluding the target hashes to
  `73cdd94fbb9e62a831fc9dc36ab749e72c6d24ddd7cea416416556eebd8668e8`.

## Deferred variables and resolving signals

- Split the remaining export routes — defer until
  `repowise:system-loader-export-rewrite-plan` isolates an independently
  characterizable export seam with material complexity reduction.
- Refactor `resolve_all_deps()` — defer until
  `repowise:system-loader-dependency-resolution-plan` provides its own risk,
  caller, and failure-matrix evidence.
- Deduplicate `ModuleExportName` string conversion — defer until
  `code:module-export-name-third-consumer` establishes a stable multi-caller
  boundary or co-change evidence.
- Change namespace-plus-default semantics — defer until
  `spec:system-loader-namespace-default-contract` explicitly chooses new
  compatibility behavior.
- Change parse-error handling — defer until
  `test:system-loader-malformed-module-matrix` establishes desired failure
  outcomes for parser diagnostics.
- Change rquickjs evaluation or security boundaries — defer until
  `security:system-loader-eval-threat-model` defines trusted inputs and an
  approved replacement boundary.
- Split the file into modules — defer until
  `repowise:system-loader-file-split-cohesion` identifies stable ownership and
  dependency seams after the local complexity reductions land.

## Candidate North Star

- NS1: Every current import form produces byte-for-byte identical rewritten
  output for canonical and stub require keys.
- NS2: Import-specifier policy has one private named owner and the main module
  walker retains only require-key lookup, rewrite-op spans, and dispatch.
- NS3: Export rewriting, reverse-span application, trailing exports,
  dependency resolution, bundle execution, and public loader APIs remain
  unchanged.
- NS4: Strict Clippy, Rust dependency hygiene, Rust units, NAPI canary, parity,
  and integration remain the downstream oracle.
- NS5: Namespace dominance remains byte-stable — provisional; revisit only on
  `spec:system-loader-namespace-default-contract`.

## Candidate guardrails

- G1: SHALL NOT alter a public system-loader signature. Check the zero-context
  target diff for added/removed public declarations.
- G2: SHALL add exactly one private import-specifier helper, call it exactly
  once from `rewrite_module_for_bundle()`, and remove the old inline import
  state from that function. Check anchored definition/reference counts and a
  target-function-scoped old-state search.
- G3: SHALL preserve exact output for bare, named, aliased, default-plus-named,
  namespace, default-plus-namespace, resolved-key, and stub-key imports. Run
  one focused colocated Rust test before and after production editing.
- G4: SHALL NOT edit export, trailing-export, reverse-span, execution, or eval
  routes. Search changed production lines for their named tokens and inspect
  the target-only diff.
- G5: SHALL NOT move pre-existing dirty work. Hash the tracked diff excluding
  `packages/extract/crates/system-loader/src/lib.rs`.
- G6: SHALL NOT regress the exact system-loader change-map chain. Run strict
  Clippy, Rust dependency hygiene, Rust units, NAPI canary, parity, and
  integration in root-map order, following only printed fail-loud remediation.

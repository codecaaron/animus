# Brainstorm: extract V1 static-resolution phase

Exploration evidence captured 2026-07-19 from the current checkout, using the
already-invoked Superpowers brainstorming stance plus RepoWise
`get_context`/`get_risk`/`get_why`/`get_health`, live source, callers, tests,
canonical specs, archived decisions, and read-only Git history. This is the
existing-evidence path from the OODA brainstorm instructions; no additional
approval gate is needed under the user's standing authorization.

## What the queue lead actually means

- RepoWise correctly identifies `packages/extract/src/project_analyzer.rs` as
  the repository's worst health outlier: score 1.4, 99% hotspot, bus factor 1,
  1,198-line `analyze()`, CCN 217, and nine nesting levels.
- The queue wording "no governing decision" is a false positive against the
  repository as a whole. `packages/extract/CLAUDE.md` documents the V1 phase
  pipeline and design constraints; `semantic-const-resolution` specifies
  Phase 1/2 ordering; archived `oxide-extraction-pass`, pipeline-timing, and
  V2-spine records explain the origin and V1-oracle role; integration tests
  exercise cross-file and same-file keyframe binding substitution.
- The actionable residue is not a broad rewrite. Phase 2a/2b (keyframe binding
  registry plus per-file static-value enrichment) is a cohesive, specified
  block still embedded in `analyze()`. It can become one V1-private seam while
  preserving every observable result and timing boundary.

## Approaches considered

1. **Recommended: extract one V1-private phase helper and test it directly.**
   Add `resolve_project_static_values(...)` in `project_analyzer.rs`, move the
   existing Phase 2a/2b logic unchanged, call it after `resolve_bindings`, and
   add a Rust unit contract covering local values, aliased imported consts,
   imported keyframes, and same-file keyframe exports. This shortens the brain
   method at a natural phase seam without adding a module or public API.
2. **Move static resolution into a new module.** This produces a larger file
   split but expands the change surface, import visibility, and ownership
   questions before a second consumer exists. Reject for this increment.
3. **Documentation/tests only.** This would reinforce knowledge but leave the
   cohesive Phase 2 block inside the monolith. Reject because the current repo
   already has both governing prose and black-box tests; the missing value is
   the named code seam.

## KNOWN-NOW

- V1 is the behavioral oracle for v2, not a shared-code target. The helper
  stays private and engine-local.
- The helper must preserve the exact map construction order: start from each
  file's local statics, enrich imported static exports, then inject keyframe
  collections by resolved export name; same-file keyframe exports use their
  local binding name.
- `Phase 2` timing continues to include binding resolution and static-value
  enrichment. No new timing field or boundary is introduced.
- No NAPI signature, `UniverseManifest` field, serialization, cache behavior,
  file ordering, or error policy changes.
- TDD is possible without inventing behavior: a unit test calls the wished-for
  private helper first and fails because the seam does not yet exist; the
  minimal implementation moves the already-specified block behind that API.
- Existing keyframe-binding integration tests and the mapped V1 verification
  tiers remain the black-box oracle.

## DEFERRED

- **DEF-1 — separate `static_resolution.rs` module.** Resolve only when a
  second engine-local caller or a separately owned static-resolution phase is
  introduced (`external:second-v1-static-resolution-consumer`).
- **DEF-2 — additional `analyze()` phase extraction.** Resolve only after a
  post-change RepoWise refresh identifies the next phase seam with a non-zero
  projected health impact and a bounded executable contract
  (`repowise:next-project-analyzer-phase-plan`).
- **DEF-3 — keyframe/static export-name collision policy.** Current behavior
  assumes keyframe export names are globally unique. Resolve only when a
  failing consumer fixture demonstrates a real collision
  (`test:keyframe-export-name-collision`).
- **DEF-4 — `analyze()` parameter object.** Resolve only when a concrete new
  input would otherwise extend the current positional boundary
  (`external:next-analyze-input`).

## Candidate North Star

- **NS1:** V1 semantic-const and keyframe outputs remain byte-equivalent for
  the same inputs.
- **NS2:** `analyze()` reads as phase orchestration; Phase 2 static enrichment
  has one named implementation and one direct contract.
- **NS3:** The seam is private to V1 and does not pull v2 or shared-loader code
  into its footprint.
- **NS4:** Existing import resolution, keyframe binding substitution, NAPI,
  canary, and integration oracles stay green.
- **NS5 (provisional):** keep the helper in `project_analyzer.rs`; revisit only
  on `external:second-v1-static-resolution-consumer`.

## Candidate Guardrails

- The change SHALL NOT modify V2, shared-loader, NAPI signatures, manifest
  fields, serialization, or cache behavior. Check a scoped diff and the
  protected pre-existing patch fingerprint.
- The change SHALL NOT move the Phase 2 timing start/end around the existing
  binding-resolution plus static-enrichment work. Check source ordering and
  the pipeline-timing contract.
- The change SHALL NOT alter static-value precedence or keyframe binding
  semantics. Check the new direct unit contract plus existing
  `keyframes-binding-substitution` integration tests.
- The change SHALL NOT add a public helper or a second source module. Check
  source signatures and the declared one-file implementation footprint.
- The change SHALL NOT regress the mapped V1 verification claim. Run strict
  Clippy, Rust units, NAPI canary, and integration after any printed
  prerequisite remediation.
- The change SHALL NOT move any existing dirty increment. Hash every tracked
  diff except `packages/extract/src/project_analyzer.rs`; calibrated value is
  `95572cc99f8487ef872fa077ff8279ee7378e0995f4e5f57a7e16095ef65f514  -`.

## Decision chain

1. Start from the highest-priority Rust queue item and query RepoWise before
   reading the whole file.
2. Reject the literal "ungoverned" claim after repository docs, canonical
   specs, archived decisions, tests, and Git history prove governance.
3. Retain the independent health evidence: `analyze()` is still the dominant
   complexity concentration and a legitimate stabilization target.
4. Compare candidate seams against engine locality, existing tests, and
   change radius. Phase 2a/2b is the smallest cohesive block with a canonical
   behavioral contract and no public API consequence.
5. Prefer a private in-file helper plus direct test; defer module extraction,
   more phases, collision-policy changes, and parameter redesign to concrete
   signals.

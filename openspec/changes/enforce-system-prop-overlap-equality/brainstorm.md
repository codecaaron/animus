<!--
brainstorm.md — the STRATEGIC exploration record for the whole change.

HISTORICAL RECORD: immutable once design.md exists; design.md supersedes this
file on any conflict. An append-only exploration log is valuable; a second
live copy of the decision state is not — never sync this file after design.md
lands.
-->

## Exploration evidence

Captured from the 2026-07-19 queue audit after invoking
`superpowers:brainstorming`, `receiving-code-review`,
`systematic-debugging`, and RepoWise risk/context/why/health queries.

- RepoWise resolves the analyzer's item-9 path to
  `packages/system/__tests__/types.test-d.tsx`. The file is a 98th-percentile
  hotspot and a sole-owner type-contract suite, but its header and inline
  rationale already describe it as the living public type contract. A
  speculative split would add churn without correcting a demonstrated fault.
- `packages/system/src/SystemBuilder.ts` is a 95th-percentile, fix-heavy
  hotspot with four current dependents. RepoWise's broad “no governing
  decision” label is incomplete: archived OpenSpec change
  `flatten-system-builder` defines overlap tolerance, and the current
  `system-builder` and `system-serialization` specs govern its public shape.
- `createSystem({ includes })` is intentionally a static package-discovery
  marker. Git archaeology shows the API began as a no-op `.includes(...)`
  method, then moved to the constructor argument. The extraction tests parse
  that syntax to discover imported packages. Included registries must not be
  merged into `toConfig()` as part of this work.
- The overlap contract says a prop may appear in multiple groups only when its
  definition is identical. Both `addGroup()` and `addProps()` duplicate a
  shallow comparison that checks `property`, `scale`, `transform`, and
  `negative`, but ignores behavior-bearing fields such as `properties`,
  `currentVar`, `variable`, and `strict`.
- A live reproduction registers `x` first with
  `properties: ['marginLeft', 'marginRight']` and `currentVar: '--first'`, then
  with `properties: ['marginTop', 'marginBottom']` and
  `currentVar: '--second'`. The builder throws no error and `toConfig()`
  silently contains the second definition, changing the meaning of `x` for
  the first group.

## Known now

- The defect is at registration time: an incomplete and duplicated equality
  policy lets a conflicting definition overwrite the existing registry entry.
- The smallest durable seam is one private definition-equality helper used by
  both registration methods.
- `property`, `negative`, `strict`, `variable`, and `currentVar` are primitive
  comparisons; `transform` and non-primitive `scale` values retain their
  existing identity semantics; ordered `properties` arrays compare by value.
- Public method signatures and serialized field names remain unchanged.
- A dedicated runtime test file is the correct oracle. The existing type suite
  proves compile-time inference and should not absorb runtime-only conflict
  assertions.

## Deferred variables

- **Structural equality for inline object/array scales** is deferred. Resolving
  signal: a concrete consumer case or approved contract requiring separately
  allocated but structurally equal scales to overlap. Until then, preserve the
  current reference-equality behavior.
- **Splitting the 1,162-line type-contract suite** is deferred. Resolving
  signal: an evidence-backed decomposition change with named ownership seams,
  or measured compile/merge cost showing that a specific section should move.
- **Canonical consolidation of the historically stale `system-builder` spec**
  is deferred beyond the single overlap requirement needed here. Resolving
  signal: a dedicated spec-consolidation change that reconciles the old
  concentric-builder language with the shipped flat builder without coupling
  that documentation migration to this bug fix.

## Candidate north star

- Overlapping registrations are accepted if and only if every field that can
  affect authoring, runtime resolution, or serialization has the same meaning.
- A conflicting overlap fails before a new builder instance can expose a
  silently replaced definition.
- The equality policy has one implementation and one focused runtime contract,
  so adding a future `Prop` field has an obvious review seam.
- Provisional: preserve identity equality for `scale` and `transform`; revisit
  only when the deferred consumer/contract signal above exists.

## Candidate guardrails

- **G1 — no include-composition change.** The change SHALL NOT read or merge
  `#includesRegistry` in `build()`/`toConfig()`. Executable check: scoped diff
  inspection plus the existing package-discovery unit suite.
- **G2 — valid overlap remains valid.** The change SHALL NOT reject the same
  shared prop object used by multiple groups. Executable check: a positive
  runtime test using one shared definition and the existing type assertion.
- **G3 — conflicts fail in both entry points.** The change SHALL NOT protect
  `addGroup()` while leaving `addProps()` able to overwrite. Executable check:
  one negative runtime test per method.
- **G4 — identity semantics stay stable.** The change SHALL NOT deep-compare
  transforms or object scales. Executable check: helper implementation review
  and a regression assertion that distinct object-scale instances remain a
  conflict.
- **G5 — no unrelated queue work moves.** The change SHALL NOT modify the
  protected Rust, integration, canary, or Next-plugin increments already in the
  dirty tree. Executable check: scoped `git diff --check` and path-specific diff
  review before/after implementation.
- **G6 — repository verification map is authoritative.** Executable check:
  `vp run verify:compile`, `vp run verify:types`, and
  `vp run verify:unit:ts`, distilled through RepoWise.

## Decision chain

1. The queue labels were treated as leads and checked against live paths,
   callers, tests, history, and OpenSpec records.
2. The type-suite split was rejected because no behavioral defect or precise
   decomposition boundary was demonstrated.
3. Include-registry composition was rejected after git archaeology proved the
   value is a static discovery marker, not a serialized dependency graph.
4. The overlap reproduction isolated the root cause to incomplete duplicated
   equality checks, not serialization or extraction.
5. Inline duplicated comparisons were rejected because they preserve the drift
   mechanism. Generic deep equality was rejected because it changes scale
   semantics without a requirement.
6. One private helper plus regression-first runtime tests is therefore the
   smallest independently revertible increment.

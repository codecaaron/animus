# Verification Report(s)

## Report: root orchestrator · 2026-07-19 10:24

**Change**: `flatten-v1-object-source-routing`  
**Verified at**: `2026-07-19 10:24 EDT`  
**Verifier**: root orchestrator — independent of the delegated implementer;
Phase 1 and Phase 2 were independently reviewed by `parity-review`  
**Tree identity**: `chore/refactor-town` @ `fd16879`
(`fd168798bbc4f698e761ed43bf01d19e6eb6de10`)  
**Dirty state**: dirty — full `git status --short` inventory appears in §13.
Tracked patch fingerprint `git diff --binary | shasum -a 256` =
`73cdd94fbb9e62a831fc9dc36ab749e72c6d24ddd7cea416416556eebd8668e8  -`.
This identifies tracked diffs only; it cannot identify the untracked target
OODA corpus, including this report.

---

## 1. Structural Validation

- [x] `openspec validate flatten-v1-object-source-routing --strict --json`:
      1 passed / 0 failed, `"valid": true`.
- [x] `openspec validate --all --strict --json`: 148 passed / 0 failed (16
      changes, 132 canonical specs).

| Item | Type | Issues | Blocks this change? |
| --- | --- | --- | --- |
| `flatten-v1-object-source-routing` | change | none | no structural block |
| portfolio | 16 changes + 132 specs | none | no |

## 2. Registry Completion (`tasks.md`)

- [x] Registry lint: 0 errors / 0 warnings; 1 registry row, 0 cross-cutting.
- [x] The only row is ticked with `ticked: 2026-07-19 10:21`.
- [x] The cited closing reorientation exists at 10:21.
- [x] No `gate:ops` row exists.

```text
registry-lint: 0 error(s), 0 warning(s) — 1 registry row(s), 0 cross-cutting row(s)
```

**Incomplete / unevidenced lines:** none. The separate Decision Ledger
carry-forward gaps are in §4.

## 3. Per-Increment Completeness

| Increment | Mode | Steps done | Decisions | Requirement | Gate | Output contract | Inputs | Complete? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `01-flatten-object-source-routing` | delegate | 11/11 plan; 5/5 output; 5/5 orchestrator | D1-D4 realized; no DEF resolved | `§arch-extract-v1-object-source-routing/Flat V1 object-source routing` | G1-G6 complete | merged | n-a; none | yes |

No packet or registry checkbox is open. Both review phases and root-owned
closure are recorded.

## 4. Deferral Closure & Staleness (Decision Ledger)

The closing reorientation explicitly revised each unchanged row from 3 to 6
reorientations because the two intervening checkpoints repaired formatter
measurement rather than producing deferred-scope evidence. That disposes the
third-reorientation deadline without silently resolving a decision. All rows
are now unbreached at reorientation 3/6 and before 2026-08-19, but none has an
allowed archive carry-forward. External owner tokens and journal prose do not
replace a named lazy registry row or retrospective out-of-scope record.

| ID | Decision | Status | Carry-forward | Breached? | OK? |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | flatten `process_chain` variant-stage routing | deferred; no signal | none | no | no — EVIDENCE-GAP |
| DEF-2 | flatten `parse_variant_from_source` | deferred; no signal | none | no | no — EVIDENCE-GAP |
| DEF-3 | share parsing policy with V2 facts extraction | deferred; no signal | none | no | no — EVIDENCE-GAP |
| DEF-4 | change object-source diagnostics | deferred; no signal | none | no | no — EVIDENCE-GAP |
| DEF-5 | generalize wrapper parsing | deferred; no signal | none | no | no — EVIDENCE-GAP |

This blocks artifact completion and archive. With Overall Decision FAIL, no
retrospective is authored and archive is not attempted.

## 5. Delta Spec Sync State

| Capability | Namespace | Sync state | Notes |
| --- | --- | --- | --- |
| `arch-extract-v1-object-source-routing` | architectural | needs sync | expected pre-archive state: the ADDED delta exists only in this change and archive will create the canonical capability |

The exact requirement header appears only in this target. There are no
MODIFIED, REMOVED, or RENAMED headers, so no replacement collision exists.

## 6. Design / Specs Coherence Spot Check

| Sample | Design/spec/implementation alignment | Gap |
| --- | --- | --- |
| D1 / NS2 | two explicit outer-shape guards feed one expression match | none |
| D2 / NS1 | object-valued identifier succeeds; missing/unbound/scalar identifiers retain the exact identifier-specific error | none |
| D3 / NS1 | the direct matrix pins literal partial value, two ordered skips, exact capture source, identifier routes, and generic failure | none |
| D4 / NS5 | V2 remains independently owned and exact-hash stable | none |
| public/downstream boundaries | callers, parse count, public NAPI, canary, and integration remain stable | none |

**Drift warnings:** RepoWise remains indexed at committed `fd168798bbc4`; its
4.43 health score, 97% risk, and nesting/complexity finding are baseline
evidence, not a post-change score. Manifest-wide ambient rustfmt drift remains
outside the target ranges.

## 7. Implementation Completeness

- [x] The ticked increment has non-zero, complete progress.
- [x] The authored requirement has two scenarios.
- [x] The exact source diff contains one behavior matrix and one bounded flat
      helper rewrite; no caller, public surface, `process_chain`,
      `parse_variant_from_source`, V2, manifest, dependency, or integration
      fixture is target-owned.
- [x] Phase 1's vacuous-order finding was repaired before source mutation and
      the same reviewer returned CLEAN.
- [x] Phase 2 semantic/code-quality review returned CLEAN after inspecting both
      recorded STOP cycles.

**Contradictions / gaps:** none in implementation.

## 8. Front-Door Routing Leak Detector (WARN, non-blocking)

The six ignored files below predate the 10:00 seed. They are unrelated
pre-install leftovers and are not captured by this change.

| Files | Classification / action |
| --- | --- |
| `docs/superpowers/specs/2026-07-16-clippy-verification-design.md` | unrelated pre-install leftover; reconcile with owner |
| `docs/superpowers/specs/2026-07-19-{cascade-round-trip-matrix,repowise-distill-enablement}-design.md` | unrelated pre-install leftovers; reconcile with owners |
| `docs/superpowers/plans/2026-07-16-clippy-verification.md` | unrelated pre-install leftover; reconcile with owner |
| `docs/superpowers/plans/2026-07-19-{cascade-round-trip-matrix,repowise-distill-enablement}.md` | unrelated pre-install leftovers; reconcile with owners |

## 9. Deferred Dogfood vs Automated-Test Equivalence

`rg -n '\[~\]'` returned empty across the target corpus.

| Deferred check | Equivalent test | Coverage | Real gap? |
| --- | --- | --- | --- |
| — | n-a | no `[~]` rows | no |

## 10. Spec Taxonomy & Leakage Lint (BLOCKING)

All three required searches returned empty. The first ran against the target
`specs/` tree with the `arch-*` exclusion.

- [x] implementation-choice language outside `arch-*`: empty.
- [x] rationale language: empty.
- [x] Decision/Ledger references: empty.

| Requirement | Namespace | Admission test | Passes? |
| --- | --- | --- | --- |
| `§arch-extract-v1-object-source-routing/Flat V1 object-source routing` | architectural | scenarios name focused G3 plus executable G1/G2/G4/G6 checks | yes |

## 11. Guardrail Gate History (BLOCKING)

The packet records every STOP gate complete. The root verifier reran G1-G6 on
the final source tree.

| Guardrail | Scope valid? | Fresh final evidence | OK? |
| --- | --- | --- | --- |
| G1 · footprint | yes | public-boundary diff search empty | yes |
| G2 · footprint | yes | two guard counts and match count 1/1/1; old nested target empty | yes |
| G3 · footprint | yes | focused 1 passed / 280 filtered | yes |
| G4 · V2 footprint | yes | `7a96b7c54f5d5fe006a9b34a12692576c77981daba55423099c0cbe421bf55fc` | yes |
| G5 · all | yes | protected tracked diff `e153036189f2cf07aaf2098663b53b4496f510a69a61010eb65d2de324ce731b  -` | yes |
| G6 · change-end | yes | Clippy 0; Rust 281 + 8/1 ignored + 348; canary 200; integration 11 files / 157 tests | yes |

`git diff --check` exited 0. The 10:11 and 10:14 G2/format STOPs each have a
`guardrail-trip` and full reorientation. The final Rust 1.97 target-specific
format check has no hunk in the helper or test. The stale-canary prerequisite
failed loud and its exact `vp run build:extract` remediation succeeded before
the final 200/200 canary. G5 protects foreign tracked diffs but cannot identify
untracked files.

## 12. Journal & Delegation Coherence

- [x] The seed envelope-licenses row 01; no later spawn or mode change occurred.
- [x] Both STOP trips are journaled and followed by full three-stance
      reorientations; the closing K=1 reorientation performs a third full pass.
- [x] Falsifier, entropy-auditor, and heretic each record an objection with an
      evidence-backed disposition at every required pass.
- [x] The delegated output contract is merged; root-owned closure followed both
      independent reviews.
- [x] Phase 1's finding is explicitly accepted/closed; Phase 1 re-review and
      Phase 2 are CLEAN.
- [x] The closing reorientation explicitly disposes the original 3/3 deferral
      cadence without pretending a resolving signal appeared.

**Gaps:** only the separate DEF archive carry-forward failure in §4.

## 13. Packaging & Change Boundary

### Full dirty inventory

```text
 M AGENTS.md
 M openspec/specs/pipeline-integration-testing/spec.md
 M packages/_integration/CLAUDE.md
 M packages/_integration/__tests__/cascade-round-trip.test.ts
 M packages/_integration/__tests__/extraction.test.ts
 M packages/_integration/__tests__/run-pipeline.ts
 M packages/_integration/__tests__/selector-rules.test.ts
 M packages/_integration/fixtures/components/selector-rules/selector-rules-create-element.tsx
 M packages/_integration/fixtures/components/selector-rules/selector-rules-unresolvable-token.tsx
 M packages/_integration/fixtures/components/transforms.tsx
 M packages/extract/crates/extract-v2/src/analyze_css.rs
 M packages/extract/crates/extract-v2/src/cross_file.rs
 M packages/extract/crates/extract-v2/src/pipeline.rs
 M packages/extract/src/chain_walker.rs
 M packages/extract/src/css_generator.rs
 M packages/extract/src/jsx_scanner.rs
 M packages/extract/src/lib.rs
 M packages/extract/src/project_analyzer.rs
 M packages/extract/src/reconciler.rs
 M packages/extract/src/style_evaluator.rs
 M packages/extract/src/transform_emitter.rs
 M packages/extract/tests/canary.test.ts
 M packages/next-plugin/README.md
 M packages/next-plugin/src/with-animus.ts
 M packages/system/src/SystemBuilder.ts
?? openspec/changes/enforce-system-prop-overlap-equality/
?? openspec/changes/extract-v1-static-resolution-phase/
?? openspec/changes/fail-loud-canary-fixture-discovery/
?? openspec/changes/flatten-v1-compose-shared-key-extraction/
?? openspec/changes/flatten-v1-consumed-import-filter/
?? openspec/changes/flatten-v1-object-source-routing/
?? openspec/changes/flatten-v1-variant-argument-routing/
?? openspec/changes/harden-embedded-transform-integration/
?? openspec/changes/harden-selector-regression-oracles/
?? openspec/changes/preserve-next-plugin-options/
?? openspec/changes/share-v1-reconciler-liveness-policy/
?? openspec/changes/simplify-v1-terminal-routing/
?? openspec/changes/split-v1-layer-content-routing/
?? packages/next-plugin/tests/with-animus.test.ts
?? packages/system/__tests__/system-builder.test.ts
```

### Exhaustive untracked classification

`git ls-files --others --exclude-standard` was expanded from RepoWise ref
`59b31e5aae62`: 120 entries before this report, now 121. They comprise only
the groups below.

| Untracked group | Reachability / classification | Severity / action |
| --- | --- | --- |
| complete `flatten-v1-object-source-routing/**` corpus | self-contained target record; no tracked code/config imports it | WARN / archive postponement — land with `lib.rs`; not an untracked-reachability gap |
| twelve other named OODA corpora in status | no target runtime dependency; separately owned adjacent changes | WARN for target; preserve/split with owners |
| `packages/next-plugin/tests/with-animus.test.ts` | discovered by tracked test task; adjacent next-plugin oracle | portfolio EVIDENCE-GAP; not required by target |
| `packages/system/__tests__/system-builder.test.ts` | discovered by tracked test task; adjacent system-builder oracle | portfolio EVIDENCE-GAP; not required by target |

No generated-only or scratch file appeared. The behavior test is colocated in
tracked `lib.rs`; the implementation does not depend on an untracked runtime
or test file.

### Foreign tracked diffs

The target footprint is exactly `packages/extract/src/lib.rs`.

| Files outside footprint | Classification / disposition |
| --- | --- |
| `AGENTS.md` | ambient branch drift; preserve, G5-protected |
| canonical pipeline spec and `packages/_integration/**` | adjacent integration/oracle changes; preserve with owners |
| V2 `{analyze_css,cross_file,pipeline}.rs` | ambient branch drift; preserve, G5-protected |
| `chain_walker.rs`, `css_generator.rs`, `jsx_scanner.rs`, `project_analyzer.rs`, `reconciler.rs`, `style_evaluator.rs`, `transform_emitter.rs` | adjacent named extraction refactors; preserve with owners |
| `canary.test.ts` | adjacent fail-loud canary change; preserve with owner |
| next-plugin README/source and `SystemBuilder.ts` | adjacent named changes; preserve with owners |

No foreign tracked diff is required by this implementation; exact G5 proves
the foreign tracked patch stayed byte-stable.

### Archive conformance

The recorded SHA is the pre-change committed baseline. `git ls-files` returns
only `packages/extract/src/lib.rs` for the target source/corpus query, while the
complete target OODA corpus is self-contained and untracked and the source is a
tracked diff. This is not a §13 reachability evidence gap: no tracked code or
test config depends on the corpus. It does postpone archive until the exact
source plus corpus is landed and reverified on a clean or complete
fingerprint-conformant tree.

## 14. Review-Finding Intake

| ID | Finding | Source | Disposition | Evidence / follow-up |
| --- | --- | --- | --- | --- |
| RF-1 | one skipped property made the order assertion vacuous | Phase 1 | accepted and closed | matrix now asserts two ordered skips separated by a surviving property; same-reviewer re-review CLEAN |
| RF-2 | target OODA corpus untracked | aggregate | accepted WARN / archive postponement | self-contained corpus has no tracked runtime/config importer; land with source before archive |
| RF-3 | DEF-1 through DEF-5 lack allowed archive carry-forward | aggregate | accepted EVIDENCE-GAP | create named lazy rows at a future reorientation or actually resolve/retire the decisions, then reverify |
| RF-4 | ADDED architecture delta absent canonical specs | aggregate | intentional pre-archive state | archive sync creates the canonical capability; no open-header collision exists |
| RF-5 | committed identity is the pre-change baseline | aggregate | accepted WARN / archive postponement | dirty fingerprint records verification state; land exact unit, then reverify before archive |
| RF-6 | RepoWise health/risk/nesting evidence is pre-refactor | root friction | accepted WARN | retain narrow claim; refresh only after indexable landing |
| RF-7 | broader `process_chain` lead should be absorbed | lead intake | rejected for this increment | distinct stage policy and bounded footprint; DEF-1 retains the exact reopening signal |
| RF-8 | first G2 repair inferred formatter ownership without running rustfmt | 10:11 STOP audit | accepted and closed | 10:14 direct Rust 1.97 evidence refuted it; G2 restored and only exact target hunks applied |
| RF-9 | target ranges still had two rustfmt hunks | 10:14 STOP audit | accepted and closed | both exact hunks applied; final target-specific check has no target hunk; Phase 2 CLEAN |

No code-quality or behavior finding remains open.

## Implementation Evidence

| Command / action | Observed |
| --- | --- |
| targeted strict validation / registry | 1/1 valid; 0 errors / 0 warnings |
| repo-wide validation / taxonomy | 148/148; all three leakage searches empty |
| behavior / structural TDD | V1 baseline 280/280 (`repowise#77adbaf7dd1e`); pre-edit focused 1/1; G2 RED 0/0/0 with old branch present; final focused 1/1 and V1 281/281 (`repowise#a37e57c9b244`) |
| G1/G2/G4/G5 | boundary empty; 1/1/1 and old branch empty; exact V2/protected hashes |
| final-tree G6 | Clippy 0; Rust 281 + 8/1 ignored + 348 (`repowise#71f4bf33e0dd`); canary 200; integration 157 |
| diff/reviews | `git diff --check` clean; Phase 1 CLEAN after one repair; Phase 2 CLEAN |
| distillation | untracked inventory expanded from `repowise#59b31e5aae62`; omitted output was expanded rather than rerun |

## Verdicts

- **Artifact verdict**: FAIL — DEF-1 through DEF-5 lack an allowed
  carry-forward. The self-contained untracked corpus, dirty fingerprint, and
  ADDED delta's expected pre-archive sync state postpone archive but are not
  artifact evidence gaps.
- **Implementation verdict**: PASS — the final dirty-tree implementation
  satisfies D1-D4, NS1-NS5, G1-G6, both scenarios, exact compatibility, and
  both independent review phases.
- **Rollout verdict**: n-a — private library refactor; no `gate:ops`.
- **Archive decision**: do not archive — newest artifact decision is FAIL.
  Independently, archive remains postponed until the exact source and corpus
  land and are reverified on a conformant tree; archive will sync the ADDED
  capability.

## Overall Decision (= the Artifact verdict; the retro precheck gates on this line)

- [ ] ✅ PASS — records match reality
- [ ] ⚠️ PASS WITH WARNINGS — proceed, but note: `<explain>`
- [x] ❌ FAIL — fix the failing artifact and re-run verify

**Next step:** At a future reorientation, carry DEF-1 through DEF-5 into named
lazy registry rows or actually resolve/retire them, then rerun aggregate
verification. Retrospective-only carry-forward cannot unblock the current FAIL
because a retrospective may not be authored while the newest Overall Decision
is FAIL. After the artifact passes, land the exact `lib.rs` diff and complete
target corpus without absorbing G5-protected foreign work, reverify on a clean
or complete fingerprint-conformant tree, and let archive sync the ADDED
capability. Do not create a retrospective or run archive while the newest
Overall Decision is FAIL.

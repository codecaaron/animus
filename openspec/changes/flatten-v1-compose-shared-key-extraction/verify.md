# Verification Report(s)

## Report: root orchestrator · 2026-07-19 09:47

**Change**: `flatten-v1-compose-shared-key-extraction`  
**Verified at**: `2026-07-19 09:47 EDT`  
**Verifier**: root orchestrator — independent of the delegated implementer;
Phase 1 and Phase 2 were independently reviewed by `parity-review`  
**Tree identity**: `chore/refactor-town` @ `fd16879`
(`fd168798bbc4f698e761ed43bf01d19e6eb6de10`)  
**Dirty state**: dirty — full `git status --short` inventory appears in §13.
Tracked patch fingerprint `git diff --binary | shasum -a 256` =
`e153036189f2cf07aaf2098663b53b4496f510a69a61010eb65d2de324ce731b  -`.
This identifies tracked diffs only; it cannot identify the untracked target
OODA corpus, including this report.

---

## 1. Structural Validation

- [x] `openspec validate flatten-v1-compose-shared-key-extraction --strict
      --json`: 1 passed / 0 failed, `"valid": true`.
- [x] `openspec validate --all --strict --json`: 147 passed / 0 failed (15
      changes, 132 canonical specs).

| Item | Type | Issues | Blocks this change? |
| --- | --- | --- | --- |
| `flatten-v1-compose-shared-key-extraction` | change | none | no structural block |
| portfolio | 15 changes + 132 specs | none | no |

## 2. Registry Completion (`tasks.md`)

- [x] Registry lint: 0 errors / 0 warnings; 1 registry row, 0 cross-cutting.
- [x] The only row is ticked with `ticked: 2026-07-19 09:44`.
- [x] The cited closing reorientation exists at 09:44.
- [x] No `gate:ops` row exists.

**Incomplete / unevidenced lines:** none. The separate Decision Ledger
carry-forward gaps are in §4.

## 3. Per-Increment Completeness

| Increment | Mode | Steps done | Decisions | Requirement | Gate | Output contract | Inputs | Complete? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `01-flatten-compose-shared-keys` | delegate | 12/12 plan; 5/5 output; 5/5 orchestrator | D1-D4 realized; no DEF resolved | `§arch-extract-v1-compose-shared-keys/Flat V1 compose shared-key extraction` | G1-G6 complete | merged | n-a; none | yes |

No packet or registry checkbox is open. Both review phases and root-owned
closure are recorded.

## 4. Deferral Closure & Staleness (Decision Ledger)

All rows are unbreached at reorientation 1/3 and before 2026-08-19, but none
has an allowed archive carry-forward. External owner tokens and journal prose
do not replace a named lazy registry row or retrospective out-of-scope record.

| ID | Decision | Status | Carry-forward | Breached? | OK? |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | flatten neighboring context/name readers | deferred; no signal | none | no | no — EVIDENCE-GAP |
| DEF-2 | introduce a generic options reader | deferred; no signal | none | no | no — EVIDENCE-GAP |
| DEF-3 | apply the refactor to V2 | deferred; no signal | none | no | no — EVIDENCE-GAP |
| DEF-4 | revisit outer invalid-key abort semantics | deferred; no signal | none | no | no — EVIDENCE-GAP |

This blocks artifact completion and archive. With Overall Decision FAIL, no
retrospective is authored and archive is not attempted.

## 5. Delta Spec Sync State

| Capability | Namespace | Sync state | Notes |
| --- | --- | --- | --- |
| `arch-extract-v1-compose-shared-keys` | architectural | needs sync | canonical `openspec/specs/arch-extract-v1-compose-shared-keys/spec.md` is absent; only the ADDED delta exists |

The exact requirement header appears only in this target. There are no
MODIFIED, REMOVED, or RENAMED headers, so no replacement collision exists.

## 6. Design / Specs Coherence Spot Check

| Sample | Design/spec/implementation alignment | Gap |
| --- | --- | --- |
| D1 / NS1 | two flat outer guards preserve structural skips around the exact outer `?` abort | none |
| D2 / NS1 | one source-ordered `filter_map` skips inner spreads/unresolvable keys and retains computed literal keys | none |
| D3 / NS1 | exact two-family matrix pins count, indices, duplicate selection, abort, skip, and order | none |
| D4 / NS5 | V2 remains independent and exact-hash stable | none |
| public/downstream boundaries | caller, neighboring readers, public scanner, NAPI, canary, and integration remain stable | none |

**Drift warnings:** RepoWise remains indexed at committed `fd168798bbc4`; its
4.98 health score, 0.992 risk, and old seven-level nesting finding are baseline
evidence, not a post-change score. Ambient rustfmt drift is recorded friction.

## 7. Implementation Completeness

- [x] The ticked increment has non-zero, complete progress.
- [x] The authored requirement has two scenarios.
- [x] The exact source diff contains one behavior matrix and one bounded flat
      helper rewrite; no caller, public surface, neighboring reader, V2,
      manifest, dependency, or integration-fixture edit is target-owned.
- [x] Phase 1's wording defect was accepted and closed before source mutation;
      re-review clean.
- [x] Phase 2 code-quality review was clean.

**Contradictions / gaps:** none in implementation.

## 8. Front-Door Routing Leak Detector (WARN, non-blocking)

The six ignored files below predate the 09:23 seed. They are unrelated
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
| `§arch-extract-v1-compose-shared-keys/Flat V1 compose shared-key extraction` | architectural | scenarios name focused G3 plus executable G1/G2/G4/G6 checks | yes |

## 11. Guardrail Gate History (BLOCKING)

The packet records every STOP gate complete. The root verifier reran G1-G6 on
the final source tree.

| Guardrail | Scope valid? | Fresh final evidence | OK? |
| --- | --- | --- | --- |
| G1 · footprint | yes | public-boundary diff search empty | yes |
| G2 · footprint | yes | flat guards/filter counts 1/1/1; old nested branch empty | yes |
| G3 · footprint | yes | focused 1 passed / 279 filtered | yes |
| G4 · V2 footprint | yes | `0febdbe45470bfdcded6f21eeb8f9d005c0c106e77598d370127c92e9336fb1f` | yes |
| G5 · all | yes | protected tracked diff `4f61c873c91bcad8900bcf56e21f764ccf914865f6642d3b440f9d843417d036  -` | yes |
| G6 · change-end | yes | Clippy 0; Rust 280 + 8/1 ignored + 348; canary 200; integration 11 files / 157 tests | yes |

`git diff --check` exited 0. The pre-edit structural RED was a planned TDD
calibration, not a final STOP trip; the stale-canary prerequisite failed loud
and was remediated exactly before the final G6 run, so no guardrail-trip entry
is owed. G5 protects foreign tracked diffs but cannot identify untracked files.

## 12. Journal & Delegation Coherence

- [x] The seed envelope-licenses row 01; no later spawn or mode change occurred.
- [x] K=1 is satisfied by the closing reorientation.
- [x] Falsifier, entropy-auditor, and heretic each record an objection with an
      evidence-backed disposition.
- [x] The delegated output contract is merged; root-owned closure followed the
      independent reviews.
- [x] The Phase 1 finding is explicitly accepted/closed; re-review and Phase 2
      are clean.
- [x] Journal friction honestly records stale RepoWise evidence, ambient
      formatting, and fail-loud NAPI remediation.

**Gaps:** only the separate DEF carry-forward failure in §4.

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
`fad1ff7b8cba`: 111 entries before this report, now 112. They comprise only
the groups below.

| Untracked group | Reachability / classification | Severity / action |
| --- | --- | --- |
| complete `flatten-v1-compose-shared-key-extraction/**` corpus | no runtime import; required change/archive record; target-owned | **EVIDENCE-GAP** — land with `jsx_scanner.rs` |
| eleven other named OODA corpora in status | no target runtime dependency; separately owned adjacent changes | WARN for target; preserve/split with owners |
| `packages/next-plugin/tests/with-animus.test.ts` | discovered by tracked test task; adjacent next-plugin oracle | portfolio EVIDENCE-GAP; not required by target |
| `packages/system/__tests__/system-builder.test.ts` | discovered by tracked test task; adjacent system-builder oracle | portfolio EVIDENCE-GAP; not required by target |

No generated-only or scratch file appeared. The target behavior test lives in
tracked `jsx_scanner.rs`; the implementation does not depend on an untracked
runtime or test file.

### Foreign tracked diffs

The target footprint is exactly `packages/extract/src/jsx_scanner.rs`.

| Files outside footprint | Classification / disposition |
| --- | --- |
| `AGENTS.md` | ambient branch drift; preserve, G5-protected |
| canonical pipeline spec and `packages/_integration/**` | adjacent integration/oracle changes; preserve with owners |
| V2 `{analyze_css,cross_file,pipeline}.rs` | ambient branch drift; preserve, G5-protected |
| `chain_walker.rs`, `css_generator.rs`, `project_analyzer.rs`, `reconciler.rs`, `style_evaluator.rs`, `transform_emitter.rs` | adjacent named extraction refactors; preserve with owners |
| `canary.test.ts` | adjacent fail-loud canary change; preserve with owner |
| next-plugin README/source and `SystemBuilder.ts` | adjacent named changes; preserve with owners |

No foreign tracked diff is required by this implementation; exact G5 proves
the foreign tracked patch stayed byte-stable.

### Archive conformance

The recorded SHA is the pre-change committed baseline. `git ls-files` returns
only `packages/extract/src/jsx_scanner.rs` for the target source/corpus query,
while the target OODA corpus remains untracked and the source is a tracked
diff. Neither the committed identity nor tracked fingerprint captures the full
target unit. Archive is blocked until the exact source plus corpus is landed
and reverified on a clean or complete fingerprint-conformant tree.

## 14. Review-Finding Intake

| ID | Finding | Source | Disposition | Evidence / follow-up |
| --- | --- | --- | --- | --- |
| RF-1 | “computed keys” wording blurred unresolvable expressions and static literals | Phase 1 | accepted and closed | requirement and matrix now name both classes; clean re-review |
| RF-2 | target OODA corpus untracked | aggregate | accepted EVIDENCE-GAP | source is tracked; target corpus absent from `git ls-files` |
| RF-3 | DEF-1 through DEF-4 lack allowed carry-forward | aggregate | accepted EVIDENCE-GAP | add named lazy rows at a new reorientation |
| RF-4 | ADDED architecture delta absent canonical specs | aggregate | accepted EVIDENCE-GAP | synchronize canonical capability before archive |
| RF-5 | committed identity is pre-change baseline | aggregate | accepted EVIDENCE-GAP | land exact unit, then reverify |
| RF-6 | RepoWise score/nesting are pre-refactor | root friction / aggregate | accepted WARN | retain narrow claim; refresh only after indexable landing |
| RF-7 | file-wide duplication lead lacks sharing evidence | RepoWise lead intake | rejected for this increment | neighboring and V2 policies remain independent; DEF-1 through DEF-3 preserve reopening signals |
| RF-8 | per-increment table overcounted plan steps as 13/13 | aggregate reviewer | accepted and closed | corrected to 12/12 from the packet's 4 + 3 + 5 checked plan steps; bounded re-review CLEAN |

Phase 2 and the aggregate bounded re-review returned clean; no code-quality or
record-count finding remains open.

## Implementation Evidence

| Command / action | Observed |
| --- | --- |
| targeted strict validation / registry | 1/1 valid; 0 errors / 0 warnings |
| repo-wide validation / taxonomy | 147/147; all three leakage searches empty |
| behavior / structural TDD | baseline 54/54; pre-edit focused 1/1; G2 RED 0/0/0 with old branch present; final focused 1/1 and module 55/55 |
| G1/G2/G4/G5 | boundary empty; 1/1/1 and old branch empty; exact V2/protected hashes |
| final-tree G6 | Clippy 0; Rust 280 + 8/1 ignored + 348; canary 200; integration 157 |
| diff/reviews | `git diff --check` clean; Phase 1 clean after one fix; Phase 2 clean |
| distillation | Rust-unit output compacted at `repowise#8fae32d00a3e`; full module at `repowise#bfe2971eef99`; untracked inventory expanded from `repowise#fad1ff7b8cba` |

## Verdicts

- **Artifact verdict**: FAIL — target corpus untracked; DEF-1 through DEF-4
  lack allowed carry-forward; the ADDED architecture capability is unsynced;
  and no committed or complete fingerprint-conformant identity captures the
  source plus corpus.
- **Implementation verdict**: PASS — the final dirty-tree implementation
  satisfies D1-D4, NS1-NS5, G1-G6, both scenarios, exact compatibility, and
  both independent review phases.
- **Rollout verdict**: n-a — private library refactor; no `gate:ops`.
- **Archive decision**: do not archive — newest artifact decision is FAIL and
  archive conformance cannot identify the untracked corpus.

## Overall Decision (= the Artifact verdict; the retro precheck gates on this line)

- [ ] ✅ PASS — records match reality
- [ ] ⚠️ PASS WITH WARNINGS — proceed, but note: `<explain>`
- [x] ❌ FAIL — fix the failing artifact and re-run verify

**Next step:** At a new reorientation, carry DEF-1 through DEF-4 into named
lazy registry rows. Land the exact `jsx_scanner.rs` diff and complete target
corpus without absorbing G5-protected foreign work, and synchronize the ADDED
architecture capability into canonical specs. Then rerun aggregate verification
on a clean or complete fingerprint-conformant tree. Do not create a
retrospective or run archive while the newest Overall Decision is FAIL.

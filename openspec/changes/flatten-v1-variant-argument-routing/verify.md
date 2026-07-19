# Verification Report(s)

## Report: parity-review subagent · 2026-07-19 08:33

**Change**: `flatten-v1-variant-argument-routing`  
**Verified at**: `2026-07-19 08:33 EDT`  
**Verifier**: `parity-review` subagent — independent of the increment implementer  
**Tree identity**: `chore/refactor-town` @ `fd16879`
(`fd168798bbc4f698e761ed43bf01d19e6eb6de10`)  
**Dirty state**: dirty — full `git status --short` inventory appears in §13.
Tracked patch fingerprint `git diff --binary | shasum -a 256` =
`4353bacb030163d6724ad091f33a4bc1a60a9dc9bafb02a8a71e79cf76a8dae7  -`.
This identifies tracked diffs only; it cannot identify the untracked target
OODA corpus, including this report.

---

## 1. Structural Validation

- [x] `openspec validate flatten-v1-variant-argument-routing --strict --json`:
      1 passed / 0 failed, `"valid": true`.
- [x] `openspec validate --all --json`: 145 passed / 0 failed (13 changes,
      132 canonical specs). Long-requirement INFO notices are non-failing
      portfolio context.

| Item | Type | Issues | Blocks this change? |
| --- | --- | --- | --- |
| `flatten-v1-variant-argument-routing` | change | none | no structural block |
| repo-wide INFO notices | canonical specs | long-requirement suggestions only | no |

## 2. Registry Completion (`tasks.md`)

- [x] Registry lint: 0 errors / 0 warnings; 1 registry row, 0 cross-cutting.
- [x] The only row is ticked with `ticked: 2026-07-19 08:29`.
- [x] The cited closing reorientation exists at 08:29.
- [x] No `gate:ops` row exists.

**Incomplete / unevidenced lines:** none. The separate Decision Ledger
carry-forward gaps are in §4.

## 3. Per-Increment Completeness

| Increment | Mode | Steps done | Decisions | Requirement | Gate | Output contract | Inputs | Complete? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `01-flatten-variant-argument-routing` | delegate | 13/13 plan; 5/5 output; 5/5 orchestrator | D1-D4 realized; no DEF resolved | `§arch-extract-v1-variant-argument-routing/Flat V1 variant argument routing` | G1-G6 complete | merged | n-a; none | yes |

No packet or registry checkbox is open. Both review phases and the closing
root-owned fields are recorded.

## 4. Deferral Closure & Staleness (Decision Ledger)

All rows are unbreached at reorientation 1/3 and before 2026-08-19, but none
has an allowed archive carry-forward. External owner tokens and journal prose
do not replace a named lazy registry row or retrospective out-of-scope record.

| ID | Decision | Status | Carry-forward | Breached? | OK? |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | refactor `eval_object_expr_with_statics()` nesting | deferred; no signal | none | no | no — EVIDENCE-GAP |
| DEF-2 | resolve static identifiers in variant arguments | deferred; no signal | none | no | no — EVIDENCE-GAP |
| DEF-3 | share routing with states parsing | deferred; no signal | none | no | no — EVIDENCE-GAP |
| DEF-4 | parallel V2 source refactor | deferred; no signal | none | no | no — EVIDENCE-GAP |

This blocks artifact completion and archive. Because Overall Decision is FAIL,
a retrospective is not an available repair path now; named lazy-row
carry-forward must be recorded at a new reorientation first.

## 5. Delta Spec Sync State

| Capability | Namespace | Sync state | Notes |
| --- | --- | --- | --- |
| `arch-extract-v1-variant-argument-routing` | architectural | needs sync | canonical `openspec/specs/arch-extract-v1-variant-argument-routing/spec.md` is absent; only the ADDED delta exists |

The exact requirement header appears only in this target. There are no
MODIFIED, REMOVED, or RENAMED headers, so no replacement collision exists.

## 6. Design / Specs Coherence Spot Check

| Sample | Design/spec/implementation alignment | Gap |
| --- | --- | --- |
| D1 / NS2 | one typed `(key, value)` match preserves known-type routing and wildcard fallthrough | none |
| D2 / NS1 | one private collector mutates the shared map/vector, preserving key order, duplicate override, skip order, and allocations | none |
| D3 / NS3 | two GREEN-before-edit tests distinguish ignored config-container spreads from bailing style-object spreads | none |
| D4 / NS5 | V2 remains independent and exact-hash stable | none |
| canonical evaluator contracts | per-property skips and structural bails retain their existing results/diagnostics | none |

**Drift warnings:** RepoWise remains indexed at committed `fd168798bbc4`.
Its 4.58 score, old seven-level parser nesting, and broader evaluator leads are
pre-refactor evidence. The journal makes no live score or broad-complexity
claim. Ambient rustfmt drift and the absent referenced
`packages/extract/AGENTS.md` are recorded process friction, not implementation
failures.

## 7. Implementation Completeness

- [x] The ticked increment has non-zero, complete progress.
- [x] The one authored requirement has two scenarios.
- [x] The exact source diff contains one private collector, one flat typed
      router, and two direct characterizations; no caller, public surface, V2,
      manifest, dependency, or integration-fixture edit is target-owned.
- [x] Phase 1's two P2 oracle gaps were accepted and closed; re-review clean.
- [x] Phase 2 code-quality review was clean.

**Contradictions / gaps:** none in implementation.

## 8. Front-Door Routing Leak Detector (WARN, non-blocking)

The six ignored files below predate the 08:08 seed. `git check-ignore -v`
attributes all to `.gitignore:66:docs`; none is captured by this change.

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

All three required searches returned empty. The first ran from `specs/` so
`!arch-*/**` was relative to the search root.

- [x] implementation-choice language outside `arch-*`: empty.
- [x] rationale language: empty.
- [x] Decision/Ledger references: empty.

| Requirement | Namespace | Admission test | Passes? |
| --- | --- | --- | --- |
| `§arch-extract-v1-variant-argument-routing/Flat V1 variant argument routing` | architectural | scenarios name executable focused tests plus G1/G2/G4/G6 | yes |

## 11. Guardrail Gate History (BLOCKING)

The packet records every STOP gate complete. This verifier reran G1-G6 on the
final source tree.

| Guardrail | Scope valid? | Fresh final evidence | OK? |
| --- | --- | --- | --- |
| G1 · footprint | yes | public-boundary diff search empty | yes |
| G2 · footprint | yes | definition 1; occurrences 2; typed match 1; old nesting empty | yes |
| G3 · footprint | yes | focused 2 passed / 276 filtered | yes |
| G4 · V2 footprint | yes | `6ebaae6dfd240a0fd2e160024228dd76196bb7e00d8b6435a7bd0750023f4b97` | yes |
| G5 · all | yes | protected tracked diff `276312e597aa3be55c0edf7be881feff3780f4ab18f1b1a3bacea67bd68a2132  -` | yes |
| G6 · change-end | yes | Clippy 0; Rust units 278 + 8/1 ignored + 348; canary 200; integration 11 files / 157 tests | yes |

`git diff --check` exited 0. No STOP trip occurred, so no `guardrail-trip`
entry is owed. G5 proves foreign tracked diffs stayed byte-stable; it does not
cover untracked files.

## 12. Journal & Delegation Coherence

- [x] The seed envelope-licenses row 01; no later spawn/mode change occurred.
- [x] K=1 is satisfied by the closing reorientation.
- [x] Falsifier, entropy-auditor, and heretic each record objections and
      evidence-backed dispositions.
- [x] The delegated output contract is merged; root-owned closure followed
      the independent reviews.
- [x] Both Phase 1 P2 findings are explicitly accepted/closed; Phase 1
      re-review and Phase 2 are clean.
- [x] Journal friction honestly records stale RepoWise evidence, ambient
      formatting, and the missing package-guidance path.

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
?? openspec/changes/flatten-v1-consumed-import-filter/
?? openspec/changes/flatten-v1-variant-argument-routing/
?? openspec/changes/harden-embedded-transform-integration/
?? openspec/changes/harden-selector-regression-oracles/
?? openspec/changes/preserve-next-plugin-options/
?? openspec/changes/share-v1-reconciler-liveness-policy/
?? openspec/changes/simplify-v1-terminal-routing/
?? packages/next-plugin/tests/with-animus.test.ts
?? packages/system/__tests__/system-builder.test.ts
```

### Exhaustive untracked classification

`git ls-files --others --exclude-standard` was expanded before report
authorship. It contained only the groups below; this report is now an
additional target-corpus member.

| Untracked group | Reachability / classification | Severity / action |
| --- | --- | --- |
| complete `flatten-v1-variant-argument-routing/**` corpus | no runtime import; required change/archive record; target-owned | **EVIDENCE-GAP** — land with `style_evaluator.rs` |
| nine other named OODA corpora shown in status | no target runtime dependency; separately owned adjacent changes | WARN for target; preserve/split with owners |
| `packages/next-plugin/tests/with-animus.test.ts` | discovered by tracked test task; adjacent next-plugin oracle | portfolio EVIDENCE-GAP; not required by target |
| `packages/system/__tests__/system-builder.test.ts` | discovered by tracked test task; adjacent system-builder oracle | portfolio EVIDENCE-GAP; not required by target |

No generated-only or scratch file appeared. Target tests live in tracked
`style_evaluator.rs`; implementation does not depend on an untracked runtime or
test file.

### Foreign tracked diffs

The target footprint is exactly `packages/extract/src/style_evaluator.rs`.

| Files outside footprint | Classification / disposition |
| --- | --- |
| `AGENTS.md` | ambient branch drift; preserve, G5-protected |
| canonical pipeline spec and `packages/_integration/**` | adjacent integration/oracle changes; preserve with owners |
| V2 `{analyze_css,cross_file,pipeline}.rs` | ambient branch drift; preserve, G5-protected |
| `chain_walker.rs`, `project_analyzer.rs`, `reconciler.rs`, `transform_emitter.rs` | adjacent named extraction refactors; preserve with owners |
| `canary.test.ts` | adjacent fail-loud canary change; preserve with owner |
| next-plugin README/source and `SystemBuilder.ts` | adjacent named changes; preserve with owners |

No foreign tracked diff is required by this implementation; exact G5 proves
the foreign tracked patch stayed byte-stable.

### Archive conformance

`HEAD` and local `origin/main` both equal
`fd168798bbc4f698e761ed43bf01d19e6eb6de10`; ahead/behind is `0 0`, and
`git merge-base --is-ancestor` exits 0. This proves only the committed baseline
is on main. `git ls-files` returns empty for the target corpus while
`style_evaluator.rs` remains a tracked diff. The SHA is therefore pre-change,
and the tracked fingerprint cannot identify untracked artifacts. Archive is
blocked until the exact target source plus corpus is landed and reverified on a
clean or complete fingerprint-conformant tree.

## 14. Review-Finding Intake

| ID | Finding | Source | Disposition | Evidence / follow-up |
| --- | --- | --- | --- | --- |
| RF-1 | ordered option-key oracle missing | Phase 1 P2 | accepted and closed | ordered vector across repeated fields plus duplicate/no-movement assertion; clean re-review |
| RF-2 | structural-bail oracle missing/ambiguous spread layers | Phase 1 P2 | accepted and closed | separate base/option bail test plus explicit config-container spread naming; clean re-review |
| RF-3 | target OODA corpus untracked | aggregate | accepted EVIDENCE-GAP | empty target `git ls-files`; land corpus with source |
| RF-4 | DEF-1 through DEF-4 lack allowed carry-forward | aggregate | accepted EVIDENCE-GAP | add named lazy rows at a new reorientation |
| RF-5 | ADDED architecture delta absent canonical specs | aggregate | accepted EVIDENCE-GAP | synchronize canonical capability before archive |
| RF-6 | committed identity is pre-change baseline | aggregate | accepted EVIDENCE-GAP | land exact unit, then reverify |
| RF-7 | RepoWise score/nesting and broader leads are pre-refactor | root friction / aggregate | accepted WARN | retain narrow claim; refresh after landing if useful |

Phase 2 returned clean; no code-quality finding remains open.

## Implementation Evidence

| Command / action | Observed |
| --- | --- |
| targeted strict validation / registry | 1/1 valid; 0 errors / 0 warnings |
| repo-wide validation / taxonomy | 145/145; all three leakage searches empty |
| G1/G2/G3 | boundary empty; 1/2/1 and old nesting empty; focused 2/2 |
| G4/G5 | exact `6ebaae...4b97`; exact `276312...2132` |
| final-tree G6 | Clippy 0; Rust 278 + 8/1 ignored + 348; canary 200; integration 157 |
| diff/reviews | `git diff --check` clean; Phase 1 clean after two fixes; Phase 2 clean |

## Verdicts

- **Artifact verdict**: FAIL — target corpus untracked; DEF-1 through DEF-4
  lack allowed carry-forward; the ADDED architecture capability is unsynced;
  and no committed or complete fingerprint-conformant identity captures the
  source plus corpus.
- **Implementation verdict**: PASS — the final dirty-tree implementation
  satisfies D1-D4, NS1-NS5, G1-G6, both scenarios, canonical evaluator parity,
  and both independent review phases.
- **Rollout verdict**: n-a — private library refactor; no `gate:ops`.
- **Archive decision**: do not archive — newest artifact decision is FAIL and
  archive conformance cannot identify the untracked corpus.

## Overall Decision (= the Artifact verdict; the retro precheck gates on this line)

- [ ] ✅ PASS — records match reality
- [ ] ⚠️ PASS WITH WARNINGS — proceed, but note: `<explain>`
- [x] ❌ FAIL — fix the failing artifact and re-run verify

**Next step:** At a new reorientation, carry DEF-1 through DEF-4 into named
lazy registry rows. Land the exact `style_evaluator.rs` diff and complete target
corpus without absorbing G5-protected foreign work, and synchronize the ADDED
architecture capability into canonical specs. Then rerun aggregate verification
on a clean or complete fingerprint-conformant tree. Do not create a
retrospective or run archive while the newest Overall Decision is FAIL.

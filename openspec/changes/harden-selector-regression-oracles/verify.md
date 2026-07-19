# Verification Report(s)

## Report: `/root/parity_review` · 2026-07-19 03:45 EDT

**Change**: `harden-selector-regression-oracles`  
**Verified at**: `2026-07-19 03:45 EDT`  
**Verifier**: `/root/parity_review` — independent subagent, not the implementer  
**Tree identity**: `chore/refactor-town` @ `fd16879`  
**Dirty state**: dirty — patch fingerprint `4d3630a32a34257996b3bd066d7c97582a4859b70e01f6cca841cf9c50669426`

Repository artifacts and OpenSpec CLI results ground this report. `opx info` reported no materialized workspace identity/declaration, so no external store-state claim is made.

### Dirty inventory at verification

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
?? openspec/changes/harden-embedded-transform-integration/
?? openspec/changes/harden-selector-regression-oracles/
```

Full untracked inventory:

```text
openspec/changes/harden-embedded-transform-integration/.openspec.yaml
openspec/changes/harden-embedded-transform-integration/brainstorm.md
openspec/changes/harden-embedded-transform-integration/design.md
openspec/changes/harden-embedded-transform-integration/increments/01-prove-embedded-transform-evaluation.md
openspec/changes/harden-embedded-transform-integration/journal.md
openspec/changes/harden-embedded-transform-integration/proposal.md
openspec/changes/harden-embedded-transform-integration/retrospective.md
openspec/changes/harden-embedded-transform-integration/specs/pipeline-integration-testing/spec.md
openspec/changes/harden-embedded-transform-integration/tasks.md
openspec/changes/harden-embedded-transform-integration/verify.md
openspec/changes/harden-selector-regression-oracles/.openspec.yaml
openspec/changes/harden-selector-regression-oracles/brainstorm.md
openspec/changes/harden-selector-regression-oracles/design.md
openspec/changes/harden-selector-regression-oracles/increments/01-harden-selector-regression-oracles.md
openspec/changes/harden-selector-regression-oracles/journal.md
openspec/changes/harden-selector-regression-oracles/proposal.md
openspec/changes/harden-selector-regression-oracles/specs/pipeline-integration-testing/spec.md
openspec/changes/harden-selector-regression-oracles/tasks.md
```

Precheck passed: one increment packet exists, it contains checked progress, and the registry has one checked row. `verify.md` was absent by construction when this inventory was recorded.

---

## 1. Structural Validation

- [x] TARGETED hard gate passed: 1/1 change valid with zero issues.
- [x] Repo-wide validation passed: 137/137 items — five changes and 132 specs.

Existing INFO-level long-requirement notices do not invalidate an item or collide with this change.

---

## 2. Registry Completion (`tasks.md`)

```text
registry-lint: 0 error(s), 0 warning(s) — 1 registry row(s), 0 cross-cutting row(s)
```

- [x] Row 01 is checked, mode `delegate`, review `subagent`.
- [x] It cites `ticked: 2026-07-19 03:39`; that journal reorientation and Act entry exists.
- [x] There are no cross-cutting or `gate:ops` rows.

No incomplete line or tick-evidence gap exists.

---

## 3. Per-Increment Completeness

| Increment | Mode | Progress | Decisions | Requirements | Gate | Output contract | Inputs | Complete? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `01-harden-selector-regression-oracles` | delegate | 21/21 task steps; 37/37 total checks | D1-D4 present; no DEF promotion claimed | envelope requirement present with five scenarios | G1-G5 complete | 6/6 merged; orchestrator 5/5 | none | yes |

Delegate mode was honored. Independent review converged to APPROVED before the journal Act and registry tick.

---

## 4. Deferral Closure & Staleness

| ID | Status | Carry-forward owner / signal | Review-by breached? | Disposition |
| --- | --- | --- | --- | --- |
| DEF-1 | deferred | `external:v1-extractor-retirement` | no — 1/3 reorientations; before 2026-10-19 | retain |
| DEF-2 | deferred | `external:selector-fixture-maintenance-signal` | no — 1/3 reorientations; before 2026-10-19 | retain |
| DEF-3 | deferred | `external:repowise-openspec-indexing` | no — 1/3 reorientations; before 2026-10-19 | retain |
| DEF-4 | deferred | `external:selector-coverage-gap` | no — 1/3 reorientations; before 2026-10-19 | retain |

The 03:39 reorientation explicitly retains all four. No resolving signal occurred and neither review-by denomination is stale. The retrospective must preserve them as out-of-scope carry-forwards.

---

## 5. Delta Spec Sync State

| Capability | Namespace | Sync state | Notes |
| --- | --- | --- | --- |
| `pipeline-integration-testing` | behavioral | needs sync | Canonical requirement still has the pre-change broken-only lifecycle; archive applies this delta |

The modified-header collision search hit only this change. `harden-embedded-transform-integration` modifies the same capability file but a different requirement header. The canonical file contains item4's adjacent Purpose edit, so the mixed dirty tree is not an archive-safe sync surface.

---

## 6. Design / Specs Coherence

| Decision | Specification/implementation evidence | Gap |
| --- | --- | --- |
| D1 — reject redundant governance/refactor | Existing requirement is modified rather than duplicated; source change remains narrow | none |
| D2 — fixed regressions remain active guards | Fixed scenario requires active acceptance tests and current prose | none |
| D3 — v1-only compatibility oracle | Engine-local scenario requires raw v1 token; parity retains v2 declaration-drop diagnostic | none |
| D4 — clarify fixture lifecycle | Requirement distinguishes broken seal/skipped state from fixed active-guard state | none |

No design/spec drift warning.

---

## 7. Implementation Completeness

- [x] No ticked increment has zero progress.
- [x] The modified requirement has five scenarios.
- [x] The target source diff is exactly the three declared selector files.
- [x] No authored requirement is scenario-free.

Contradictions or gaps: none.

---

## 8. Front-Door Routing Leak Detector

Six ignored files remain under `docs/superpowers`:

```text
docs/superpowers/specs/2026-07-16-clippy-verification-design.md
docs/superpowers/specs/2026-07-19-cascade-round-trip-matrix-design.md
docs/superpowers/specs/2026-07-19-repowise-distill-enablement-design.md
docs/superpowers/plans/2026-07-16-clippy-verification.md
docs/superpowers/plans/2026-07-19-cascade-round-trip-matrix.md
docs/superpowers/plans/2026-07-19-repowise-distill-enablement.md
```

None concerns this change. Disposition: nonblocking WARN; their owning Clippy/item3/RepoWise work should migrate or remove them.

---

## 9. Deferred Dogfood vs Automated-Test Equivalence

No `[~]` step exists. Automated-equivalence mapping is N/A.

---

## 10. Spec Taxonomy & Leakage Lint

All three blocking commands returned exit 1 with empty output:

```text
SHALL implementation-choice lint: empty
rationale-language lint: empty
D<n>/Decision Ledger lint: empty
```

The behavioral sample `Unresolvable selector alias remains engine-local` is black-box verifiable: the focused pipeline test observes the v1 selector and raw `outline` declaration, while G1 observes the committed v2 declaration-drop diagnostic. No `arch-*` namespace is present.

---

## 11. Guardrail Gate History

| Gate | Scope | Fresh final result |
| --- | --- | --- |
| G1 | `all` | exact v2 diagnostic at `production.json:572` |
| G2 | `all` | focused selector suite: 13/13 passed |
| G3 | `footprint:packages/_integration/**` | exit 1, empty; no stale broken/whole-rule-drop prose |
| G4 | `footprint:packages/_integration/**` | exact v1 assertion at `selector-rules.test.ts:131` |
| G5 | `all` | exit 1, empty; parsed packet footprint has no production extractor path |

- [x] All scope tokens use the closed grammar.
- [x] There are no `change-end` gates.
- [x] Final STOP gates pass.
- [x] No guardrail trip occurred. RF-1 through RF-3 were review findings against prose/evidence quality, not unrecorded final gate failures.

---

## 12. Journal & Delegation Coherence

- [x] The 03:19 envelope seed precedes and licenses row 01.
- [x] Delegate execution and the merged output contract are recorded.
- [x] There was no mode change.
- [x] K=1 has one full reorientation covering falsifier, entropy auditor, and heretic.
- [x] Falsifier and entropy objections were accepted, repaired, and cleanly re-reviewed.
- [x] The heretic objection was rejected with evidence.
- [x] Registry tick follows same-reviewer APPROVED.
- [x] No evidence shows delegate writes to orchestrator-owned shared artifacts.

No blocking journal or delegation gap.

---

## 13. Packaging & Change Boundary

Fresh target diff names:

```text
packages/_integration/__tests__/selector-rules.test.ts
packages/_integration/fixtures/components/selector-rules/selector-rules-create-element.tsx
packages/_integration/fixtures/components/selector-rules/selector-rules-unresolvable-token.tsx
```

These exactly match row 01. The eight untracked files under this change directory are its record surface. `git grep` found no tracked source or configuration reference to the change name, so no tracked build/test path depends on an untracked implementation file. They must land with the implementation before archive.

The ten files under `harden-embedded-transform-integration` are pre-existing item4 records and are not needed here.

| Foreign tracked diff | Classification | Disposition |
| --- | --- | --- |
| `AGENTS.md` | pre-existing AGENTS drift | exclude |
| `openspec/specs/pipeline-integration-testing/spec.md` | item4 adjacent intent | preserve separately; this delta is not synced |
| `packages/_integration/CLAUDE.md` | item4 adjacent intent | split/land with item4 |
| `packages/_integration/__tests__/cascade-round-trip.test.ts` | item3 adjacent intent | split/land with item3 |
| `packages/_integration/__tests__/extraction.test.ts` | item4 adjacent intent | split/land with item4 |
| `packages/_integration/__tests__/run-pipeline.ts` | item4 adjacent intent | split/land with item4 |
| `packages/_integration/fixtures/components/transforms.tsx` | item4 adjacent intent | split/land with item4 |
| `packages/extract/crates/extract-v2/src/analyze_css.rs` | pre-existing Rust drift | exclude; not needed here |
| `packages/extract/crates/extract-v2/src/cross_file.rs` | pre-existing Rust drift | exclude; not needed here |
| `packages/extract/crates/extract-v2/src/pipeline.rs` | pre-existing Rust drift | exclude; not needed here |

No foreign diff is required by this change. The focused suite isolates target behavior; full integration corroborates the mixed worktree but is not attribution evidence for item3/item4/Rust.

- [x] Full dirty and untracked inventories are recorded.
- [x] Patch fingerprint is recorded.
- [x] No untracked implementation dependency creates an EVIDENCE-GAP.
- [x] Every foreign diff has a disposition.

---

## 14. Review-Finding Intake

| ID | Finding | Source/stance | Disposition | Evidence / follow-up |
| --- | --- | --- | --- | --- |
| RF-1 | Fixture claimed v2 drops the whole rule | falsifier | accepted | fixture distinguishes v1 preservation from v2 `outline`-only drop; G3 expanded |
| RF-2 | G5 searched syntax the packet did not use | entropy | accepted | G5 parses actual `**Footprint**` block |
| RF-3 | Packet retained obsolete no-final-diff claim | entropy re-review | accepted | Step 01.5.4 states truthful three-file boundary |
| RF-4 | Exact v1 raw CSS may fossilize malformed CSS | heretic | rejected | explicitly compatibility-only; v2 remains stricter; behavior change stays DEF-1-gated |

RF-1 through RF-3 were repaired and cleanly re-reviewed. Final review returned APPROVED. No finding remains undispositioned.

---

## Implementation Evidence

| Command/action | Fresh result |
| --- | --- |
| Focused selector suite | 1/1 file, 13/13 passed |
| `vp run verify:integration` | 11/11 files, 157/157 passed |
| Targeted `vp fmt ... --check` | three files correctly formatted |
| `git diff --check` | exit 0, empty |
| Targeted OpenSpec JSON validation | 1/1 valid, zero issues |
| Repo-wide OpenSpec JSON validation | 137/137 valid |
| Registry lint | 0 errors, 0 warnings |
| G1/G3/G4/G5 | exact v2 diagnostic / empty / exact v1 assertion / empty |
| Mutation restoration | `.998` absent; `.999` present in fixture and assertion |
| Scoped diff | exactly three declared selector files |

---

## Verdicts

- **Artifact verdict**: PASS WITH WARNINGS — records match implementation and review reality. Warnings are the mixed dirty/unmerged worktree and unrelated ignored front-door documents.
- **Implementation verdict**: PASS.
- **Rollout verdict**: n/a.
- **Archive decision**: postpone archive. The implementation and records are unmerged, the target packet is untracked, the branch is not a clean conforming default-branch state, and item3/item4/Rust/AGENTS work shares the tree.

## Overall Decision (= the Artifact verdict)

- [ ] ✅ PASS — records match reality
- [x] ⚠️ PASS WITH WARNINGS — implementation and records pass; packaging and mainline conformance postpone archive
- [ ] ❌ FAIL — fix the failing artifact and re-run verify

**Next step:** Produce the retrospective while context is hot and preserve DEF-1 through DEF-4. Land or isolate only this change's three source files and OpenSpec records; do not absorb item3, item4, Rust, AGENTS, or ignored-doc work. Re-run conformance verification on a clean default-branch state before archive.

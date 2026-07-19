# Verification Report(s)

## Report: parity-review subagent · 2026-07-19 07:35

**Change**: `share-v1-reconciler-liveness-policy`  
**Verified at**: `2026-07-19 07:35 EDT`  
**Verifier**: `parity-review` subagent — independent of the increment implementer  
**Tree identity** (read-only; consumed by archive's conformance check):
`chore/refactor-town` @ `fd16879`
(`fd168798bbc4f698e761ed43bf01d19e6eb6de10`)  
**Dirty state**: dirty — complete `git status --short` inventory and untracked
expansion are in §13. Tracked patch fingerprint
`git diff --binary | shasum -a 256` =
`4df2a79c93f5864b709eba9e615835879feb9e8ce5dc4d32f9baec4132ff4fd0  -`.
This fingerprint covers tracked diffs only; it does not identify any untracked
OODA artifact, including this report.

---

## 1. Structural Validation

- [x] Targeted hard gate:
      `openspec validate share-v1-reconciler-liveness-policy --strict --json`
      reports 1 passed / 0 failed and `"valid": true`.
- [x] Repo-wide context: `openspec validate --all --json` reports 143 passed /
      0 failed (11 changes and 132 canonical specs). Existing INFO notices on
      long requirements are non-failing portfolio context.

```text
target: 1 item, 1 passed, 0 failed, issues: []
all:    143 items, 143 passed, 0 failed
```

| Item | Type | Issues | Blocks this change? |
| --- | --- | --- | --- |
| `share-v1-reconciler-liveness-policy` | change | none | no structural block |
| repo-wide INFO notices | canonical specs | long-requirement suggestions only | no |

## 2. Registry Completion (`tasks.md`)

- [x] Registry lint clean.
- [x] The only registry row is ticked.
- [x] Its `ticked: 2026-07-19 07:32` annotation resolves to the closing
      reorientation at that timestamp.
- [x] No `gate:ops` row exists.

```text
registry-lint: 0 error(s), 0 warning(s) — 1 registry row(s), 0 cross-cutting row(s)
```

**Incomplete / unevidenced lines:** none. No packet or registry checkbox is
open. The separate Decision Ledger carry-forward failure is recorded in §4.

## 3. Per-Increment Completeness

| Increment | Mode | Steps done | Ledger / decisions | Requirements | Gate complete? | Output contract merged? | Inputs timing | Complete? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `01-share-component-liveness` | delegate | 11/11 plan steps; 5/5 output-contract rows; 5/5 orchestrator rows | D1-D4 realized; no DEF row claimed resolved | `§arch-extract-v1-reconciler-liveness/Shared private component-liveness policy` present | yes, G1-G6 all checked | yes | n-a; no inputs | yes |

The packet predates no input tick because row 01 has `inputs: —`. Its delegate
output contract is populated with exact results, proposed journal entries, and
surfaced variables. Root completed the explicitly root-owned authorship and
closure checklist after both review phases.

## 4. Deferral Closure & Staleness (Decision Ledger)

All four rows remain before both Review-by limits (reorientation 1/3 and
2026-07-19 before 2026-08-19), but none has an allowed archive carry-forward.
An `external:*` owner token and journal prose retaining a deferral do not
replace a named lazy registry row or a retrospective out-of-scope record.

| ID | Decision | Status now | Resolved by / carried to | Review-by breached? | OK? |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | split remaining reconciliation phases | deferred; no resolving signal | neither lazy row nor retrospective | no | no — EVIDENCE-GAP |
| DEF-2 | parallel V2 source refactor | deferred; no resolving signal | neither lazy row nor retrospective | no | no — EVIDENCE-GAP |
| DEF-3 | typed detail-kind enum | deferred; no resolving signal | neither lazy row nor retrospective | no | no — EVIDENCE-GAP |
| DEF-4 | shared-module predicate | deferred; no resolving signal | neither lazy row nor retrospective | no | no — EVIDENCE-GAP |

This blocks artifact completion and archive. Because this report's Overall
Decision is FAIL, a retrospective is not permitted as the repair path now;
the deferrals need named lazy-row carry-forward at a reorientation before
verification is rerun.

## 5. Delta Spec Sync State

| Capability | Namespace | Sync state | Notes |
| --- | --- | --- | --- |
| `arch-extract-v1-reconciler-liveness` | architectural | needs sync | `openspec/specs/arch-extract-v1-reconciler-liveness/spec.md` is absent; only the change-local ADDED delta exists |

The exact requirement header `Shared private component-liveness policy`
appears only in this change. There are no MODIFIED, REMOVED, or RENAMED
headers, so no portfolio replacement collision exists. The unsynced new
canonical architectural capability remains an archive blocker.

| MODIFIED/REMOVED/RENAMED header | Other open changes | Coordination |
| --- | --- | --- |
| — | none; this change contains ADDED only | n-a |

## 6. Design / Specs Coherence Spot Check

| Sampled item | Design says | Specs match | Gap |
| --- | --- | --- | --- |
| D1 / NS1 / NS2 | one private V1 liveness predicate serves actual and prospective paths | structural scenario names exact G2 checks and cross-path test | none |
| D2 | GREEN characterization before a pure refactor | packet records GREEN before and after production editing | none |
| D3 / NS3 / NS4 | preserve public/report/caller/runtime boundaries and ordering | public-boundary plus mapped verification scenarios | none |
| D4 / NS5 | V2 remains independent | G4 exact hash remains stable | none |
| canonical parity | dev prospective diagnostics identify what production would eliminate | shared predicate and three-case matrix preserve that existing contract | none |

**Drift warnings:** RepoWise health metadata is not post-change evidence.
`_meta.indexed_commit` is `fd168798bbc4`, so the 5.23 score and broad
`reconcile()` complexity lead describe the committed baseline. The journal
correctly records this at 07:32. No dirty-tree score improvement or broad
complexity resolution is claimed; only the live shared-policy seam is proven.

## 7. Implementation Completeness

- [x] The ticked increment has non-zero and complete progress.
- [x] The single authored requirement has two scenarios.
- [x] The source diff is exactly two condition replacements, one private
      helper, and one local characterization.
- [x] Phase 1 was clean after the expected root-closure sequencing was
      clarified; Phase 2 code-quality review was clean.

**Contradictions / gaps:** none in implementation. The helper is exactly the
original `!rendered && !parent` expression at both call sites. It introduces no
new ownership, lifetime, borrow, or allocation behavior. Loops, detail kinds,
reasons, counters, and component/detail order remain unchanged.

## 8. Front-Door Routing Leak Detector (WARN, non-blocking)

Both commands found the six ignored, pre-existing files below. `git
check-ignore -v` attributes every path to `.gitignore:66:docs`; every mtime
predates this change's 07:17 seed.

| File | Content captured in this change? | Suggested action |
| --- | --- | --- |
| `docs/superpowers/specs/2026-07-16-clippy-verification-design.md` | no; unrelated | reconcile with its owner |
| `docs/superpowers/specs/2026-07-19-cascade-round-trip-matrix-design.md` | no; unrelated | reconcile with its owner |
| `docs/superpowers/specs/2026-07-19-repowise-distill-enablement-design.md` | no; unrelated | reconcile with its owner |
| `docs/superpowers/plans/2026-07-16-clippy-verification.md` | no; unrelated | reconcile with its owner |
| `docs/superpowers/plans/2026-07-19-cascade-round-trip-matrix.md` | no; unrelated | reconcile with its owner |
| `docs/superpowers/plans/2026-07-19-repowise-distill-enablement.md` | no; unrelated | reconcile with its owner |

## 9. Deferred Dogfood vs Automated-Test Equivalence

`rg -n '\[~\]' openspec/changes/share-v1-reconciler-liveness-policy`
returned empty.

| Deferred check | Equivalent automated test | Coverage assessment | Real gap? |
| --- | --- | --- | --- |
| — | n-a | no `[~]` rows exist | no |

## 10. Spec Taxonomy & Leakage Lint (BLOCKING)

All three searches returned empty. The first was run from `specs/` so the
template's `!arch-*/**` exclusion is relative to the search root.

```text
$ (cd specs && rg -n 'SHALL (use|adopt|leverage|be implemented (with|using|in))' . --glob '!arch-*/**')
<empty>
$ rg -in '\b(because|as decided|we chose|per the design)\b' specs/
<empty>
$ rg -n '\bD[0-9]+\b|[Dd]ecision [Ll]edger' specs/
<empty>
```

- [x] Lint 1 empty outside `arch-*`.
- [x] Lint 2 empty.
- [x] Lint 3 empty.

| Sampled requirement | Namespace | Admission test | Passes? |
| --- | --- | --- | --- |
| `§arch-extract-v1-reconciler-liveness/Shared private component-liveness policy` | architectural | both scenarios name executable `rg`, hash, or test/verification commands | yes |
| — | behavioral | no behavioral namespace is present | n-a |

## 11. Guardrail Gate History (BLOCKING)

The packet records every STOP gate complete. The verifier independently
reran the compact G1-G5 checks; G6 is the fresh root final evidence supplied
to this aggregate run and cross-checked against packet and journal.

| Guardrail | Scope | Scope valid? | Final evidence | OK? |
| --- | --- | --- | --- | --- |
| G1 | `footprint:packages/extract/src/reconciler.rs` | yes | fresh public-boundary diff search empty; raw `rg` exit 1 as expected | yes |
| G2 | same footprint | yes | fresh definition count 1, total occurrence count 3, raw-condition search empty | yes |
| G3 | same footprint | yes | fresh focused test 1 passed / 274 filtered | yes |
| G4 | V2 footprint | yes | fresh `40e83a51d20934e23dd76c964a0f7c6240ab27e0bfec77051ba675d852a95503` | yes |
| G5 | `all` | yes | fresh protected tracked-diff hash `790381181ccb772cf595c0fb3914de5fa0e79036a6563b534f834495f5294d46  -` | yes |
| G6 | `change-end` | yes | root final: Clippy 0; Rust units 275 + 8/1 ignored + 348; canary 200; integration 11 files / 157 tests | yes |

`git diff --check` also exited 0. No STOP guard failed, so no
`guardrail-trip` entry is owed. G5's exact match proves the protected tracked
dirty increment did not move relative to the packet baseline; it does not
cover untracked paths.

## 12. Journal & Delegation Coherence

- [x] No guardrail trip, spawn, or mode change occurred; none is missing.
- [x] The seed entry envelope-licenses row 01.
- [x] Cadence K=1 is satisfied by the closing reorientation.
- [x] The full pass records falsifier, entropy-auditor, and heretic objections
      with evidence-backed dispositions.
- [x] The delegated output contract is merged in the packet; no evidence of
      delegate writes to design, tasks, journal, or specs was found.
- [x] The journal records the Phase 1 sequencing clarification and clean final
      Phase 1/Phase 2 outcomes.
- [x] The 07:32 root friction entry accurately limits RepoWise freshness and
      preserves the broader complexity lead as deferred.

**Gaps found:** none in journal/delegation mechanics. DEF carry-forward remains
the separate blocking gap in §4.

## 13. Packaging & Change Boundary

### Full dirty inventory

`git status --short` immediately before authoring this report (the target
directory remains one `??` summary line after the report is added):

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
 M packages/extract/tests/canary.test.ts
 M packages/next-plugin/README.md
 M packages/next-plugin/src/with-animus.ts
 M packages/system/src/SystemBuilder.ts
?? openspec/changes/enforce-system-prop-overlap-equality/
?? openspec/changes/extract-v1-static-resolution-phase/
?? openspec/changes/fail-loud-canary-fixture-discovery/
?? openspec/changes/harden-embedded-transform-integration/
?? openspec/changes/harden-selector-regression-oracles/
?? openspec/changes/preserve-next-plugin-options/
?? openspec/changes/share-v1-reconciler-liveness-policy/
?? openspec/changes/simplify-v1-terminal-routing/
?? packages/next-plugin/tests/with-animus.test.ts
?? packages/system/__tests__/system-builder.test.ts
```

### Full untracked expansion

```text
openspec/changes/enforce-system-prop-overlap-equality/.openspec.yaml
openspec/changes/enforce-system-prop-overlap-equality/brainstorm.md
openspec/changes/enforce-system-prop-overlap-equality/design.md
openspec/changes/enforce-system-prop-overlap-equality/increments/01-reject-conflicting-prop-overlaps.md
openspec/changes/enforce-system-prop-overlap-equality/journal.md
openspec/changes/enforce-system-prop-overlap-equality/proposal.md
openspec/changes/enforce-system-prop-overlap-equality/specs/system-builder/spec.md
openspec/changes/enforce-system-prop-overlap-equality/tasks.md
openspec/changes/enforce-system-prop-overlap-equality/verify.md
openspec/changes/extract-v1-static-resolution-phase/.openspec.yaml
openspec/changes/extract-v1-static-resolution-phase/brainstorm.md
openspec/changes/extract-v1-static-resolution-phase/design.md
openspec/changes/extract-v1-static-resolution-phase/increments/01-extract-v1-static-resolution-phase.md
openspec/changes/extract-v1-static-resolution-phase/journal.md
openspec/changes/extract-v1-static-resolution-phase/proposal.md
openspec/changes/extract-v1-static-resolution-phase/specs/arch-extract-v1-phase-seams/spec.md
openspec/changes/extract-v1-static-resolution-phase/tasks.md
openspec/changes/extract-v1-static-resolution-phase/verify.md
openspec/changes/fail-loud-canary-fixture-discovery/.openspec.yaml
openspec/changes/fail-loud-canary-fixture-discovery/brainstorm.md
openspec/changes/fail-loud-canary-fixture-discovery/design.md
openspec/changes/fail-loud-canary-fixture-discovery/increments/01-fail-loud-fixture-discovery.md
openspec/changes/fail-loud-canary-fixture-discovery/journal.md
openspec/changes/fail-loud-canary-fixture-discovery/proposal.md
openspec/changes/fail-loud-canary-fixture-discovery/retrospective.md
openspec/changes/fail-loud-canary-fixture-discovery/specs/canary-fixture-discovery/spec.md
openspec/changes/fail-loud-canary-fixture-discovery/tasks.md
openspec/changes/fail-loud-canary-fixture-discovery/verify.md
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
openspec/changes/harden-selector-regression-oracles/retrospective.md
openspec/changes/harden-selector-regression-oracles/specs/pipeline-integration-testing/spec.md
openspec/changes/harden-selector-regression-oracles/tasks.md
openspec/changes/harden-selector-regression-oracles/verify.md
openspec/changes/preserve-next-plugin-options/.openspec.yaml
openspec/changes/preserve-next-plugin-options/brainstorm.md
openspec/changes/preserve-next-plugin-options/design.md
openspec/changes/preserve-next-plugin-options/increments/01-preserve-wrapper-options.md
openspec/changes/preserve-next-plugin-options/increments/02-compose-consumer-webpack-first.md
openspec/changes/preserve-next-plugin-options/journal.md
openspec/changes/preserve-next-plugin-options/proposal.md
openspec/changes/preserve-next-plugin-options/specs/next-config-wrapper/spec.md
openspec/changes/preserve-next-plugin-options/tasks.md
openspec/changes/preserve-next-plugin-options/verify.md
openspec/changes/share-v1-reconciler-liveness-policy/.openspec.yaml
openspec/changes/share-v1-reconciler-liveness-policy/brainstorm.md
openspec/changes/share-v1-reconciler-liveness-policy/design.md
openspec/changes/share-v1-reconciler-liveness-policy/increments/01-share-component-liveness.md
openspec/changes/share-v1-reconciler-liveness-policy/journal.md
openspec/changes/share-v1-reconciler-liveness-policy/proposal.md
openspec/changes/share-v1-reconciler-liveness-policy/specs/arch-extract-v1-reconciler-liveness/spec.md
openspec/changes/share-v1-reconciler-liveness-policy/tasks.md
openspec/changes/share-v1-reconciler-liveness-policy/verify.md
openspec/changes/simplify-v1-terminal-routing/.openspec.yaml
openspec/changes/simplify-v1-terminal-routing/brainstorm.md
openspec/changes/simplify-v1-terminal-routing/design.md
openspec/changes/simplify-v1-terminal-routing/increments/01-flatten-terminal-routing.md
openspec/changes/simplify-v1-terminal-routing/journal.md
openspec/changes/simplify-v1-terminal-routing/proposal.md
openspec/changes/simplify-v1-terminal-routing/specs/arch-extract-v1-terminal-routing/spec.md
openspec/changes/simplify-v1-terminal-routing/tasks.md
openspec/changes/simplify-v1-terminal-routing/verify.md
packages/next-plugin/tests/with-animus.test.ts
packages/system/__tests__/system-builder.test.ts
```

### Untracked reachability and classification

| Untracked path(s) | Referenced by tracked code/config? | Classification | Severity / action |
| --- | --- | --- | --- |
| complete `openspec/changes/share-v1-reconciler-liveness-policy/**` corpus | no runtime import; required change/archive record | target-owned, correct locally but absent from the shipping patch | **EVIDENCE-GAP**; land the complete corpus with the source change |
| seven other named OODA corpora above | no target runtime import | adjacent-intentional, separately owned changes | WARN for this target; preserve/split with owners |
| `packages/next-plugin/tests/with-animus.test.ts` | yes; tracked test task discovers it | adjacent `preserve-next-plugin-options` oracle | portfolio **EVIDENCE-GAP**, not a dependency of this implementation |
| `packages/system/__tests__/system-builder.test.ts` | yes; tracked test task discovers it | adjacent `enforce-system-prop-overlap-equality` oracle | portfolio **EVIDENCE-GAP**, not a dependency of this implementation |

No generated-only or scratch path appears in the untracked census. The target
regression test is inside tracked `reconciler.rs`, so the implementation does
not depend on an untracked runtime/test file.

### Foreign tracked diffs outside row 01

The target footprint is exactly `packages/extract/src/reconciler.rs`.

| File(s) | Classification | Disposition |
| --- | --- | --- |
| `AGENTS.md` | ambient branch drift; also named only by an unstarted lazy row in another change | leave with its owner; G5-protected |
| `openspec/specs/pipeline-integration-testing/spec.md`, `packages/_integration/**` | adjacent `harden-embedded-transform-integration` / `harden-selector-regression-oracles` work | preserve with those owners; G5-protected |
| `packages/extract/crates/extract-v2/src/{analyze_css.rs,cross_file.rs,pipeline.rs}` | ambient branch drift; no target owner | leave untouched; G5-protected |
| `packages/extract/src/chain_walker.rs` | adjacent `simplify-v1-terminal-routing` footprint | preserve with that owner; G5-protected |
| `packages/extract/src/project_analyzer.rs` | adjacent `extract-v1-static-resolution-phase` footprint | preserve with that owner; G5-protected |
| `packages/extract/tests/canary.test.ts` | adjacent `fail-loud-canary-fixture-discovery` footprint | preserve with that owner; G5-protected |
| `packages/next-plugin/{README.md,src/with-animus.ts}` | adjacent `preserve-next-plugin-options` footprint | preserve with that owner; G5-protected |
| `packages/system/src/SystemBuilder.ts` | adjacent `enforce-system-prop-overlap-equality` footprint | preserve with that owner; G5-protected |

No foreign tracked diff is needed by this implementation. The exact G5 hash
proves all foreign tracked diffs stayed byte-stable during the increment.

### Archive conformance

`HEAD` and local `origin/main` are exactly
`fd168798bbc4f698e761ed43bf01d19e6eb6de10`; `HEAD...origin/main` is `0 0`,
and `git merge-base --is-ancestor` exits 0. That proves only the committed
baseline is on main. `git ls-files openspec/changes/share-v1-reconciler-liveness-policy`
returns empty, while `reconciler.rs` is a live tracked diff. Therefore the
recorded SHA identifies the pre-change baseline, not the verified
implementation or its OODA corpus. The tracked patch hash narrows the dirty
state but cannot establish archive conformance for untracked content. Archive
is blocked until the exact target unit is committed/landed and reverified on a
clean or fingerprint-conformant tree.

## 14. Review-Finding Intake

| ID | Finding | Source | Disposition | Evidence | Follow-up |
| --- | --- | --- | --- | --- | --- |
| RF-1 | Phase 1 initially treated open root-owned closure fields as defects | Phase 1 reviewer / root clarification | rejected as checkpoint-sequencing defects; fields were intentionally pending Phase 2 and are now complete | packet labels them orchestrator-owned; 07:32 journal closes them after Phase 2 | none |
| RF-2 | complete target OODA corpus is untracked | aggregate verifier | accepted as packaging EVIDENCE-GAP | `git ls-files` empty; full untracked census | land corpus with target source, then reverify |
| RF-3 | DEF-1 through DEF-4 lack lazy-row or retrospective carry-forward | aggregate verifier | accepted as record EVIDENCE-GAP | design ledger, sole tasks row, absent retrospective | add allowed named lazy-row carry-forward at reorientation |
| RF-4 | new architectural delta is absent from canonical specs | aggregate verifier | accepted as sync EVIDENCE-GAP | canonical path absent; exact header found only in target delta | synchronize canonical capability before archive |
| RF-5 | committed tree identity is the pre-change baseline | aggregate verifier | accepted as conformance EVIDENCE-GAP | HEAD equals origin/main; source remains dirty; corpus untracked | land exact target unit and reverify |
| RF-6 | RepoWise health still describes the pre-refactor commit and broad complexity remains open | root friction / aggregate verifier | accepted as WARN; no score or broad-resolution claim | indexed commit plus 07:32 journal entry and DEF-1 | refresh only after landing if useful; retain DEF-1 |

Phase 2 returned clean and contributed no unresolved code-quality finding.

## Implementation Evidence

| Driven action / command | Observed |
| --- | --- |
| targeted strict validation | 1 passed / 0 failed |
| registry lint | 0 errors / 0 warnings |
| three taxonomy/leakage searches | all empty |
| fresh G1 | public-boundary search empty; raw `rg` exit 1 as expected |
| fresh G2 | definition count 1; total occurrences 3; raw duplicate empty |
| fresh focused G3 | 1 passed / 274 filtered |
| fresh G4 | exact `40e83a...95503` |
| fresh G5 | exact `790381...94d46` |
| root final G6 | Clippy 0; Rust units 275 + 8/1 ignored + 348; canary 200; integration 11 files / 157 tests |
| `git diff --check` | exit 0, empty output |
| independent reviews | Phase 1 clean after sequencing clarification; Phase 2 clean |

Manifest-wide rustfmt remains red only on recorded ambient drift; no formatter
hunk begins in the changed helper or test ranges. It does not reduce the
implementation verdict.

## Verdicts

- **Artifact verdict**: FAIL — the records accurately expose an archive-incomplete
  state: the target corpus is untracked, DEF-1 through DEF-4 have no allowed
  carry-forward, the ADDED architectural capability is not canonically synced,
  and the exact implementation has no committed tree identity.
- **Implementation verdict**: PASS — on this exact dirty tree, the bounded
  shared-policy refactor and characterization satisfy D1-D4, G1-G6, canonical
  parity, mapped Rust verification, and both independent reviews.
- **Rollout verdict**: n-a — private library refactor; no deployment or
  `gate:ops` row exists.
- **Archive decision**: do not archive — the newest artifact decision is FAIL,
  and mainline/dirty-tree conformance cannot identify the untracked corpus.

## Overall Decision (= the Artifact verdict; the retro precheck gates on this line)

- [ ] ✅ PASS — records match reality
- [ ] ⚠️ PASS WITH WARNINGS — proceed, but note: `<explain>`
- [x] ❌ FAIL — fix the failing artifact and re-run verify

**Next step:** At a new reorientation, carry DEF-1 through DEF-4 forward using
named lazy registry rows. Land the exact `reconciler.rs` source/test diff and
the complete target OODA corpus as one change-owned unit without absorbing any
G5-protected foreign diff, and synchronize the ADDED architectural capability
to the canonical spec tree. Then rerun aggregate verification on the resulting
clean or exact-fingerprint-conformant tree. Only after the newest Overall
Decision is non-FAIL may a retrospective be created and archive conformance be
rechecked; do not create a retrospective or run archive now.

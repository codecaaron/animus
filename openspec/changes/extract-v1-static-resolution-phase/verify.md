# Verification Report(s)

> Produced after apply completes to compare implementation, specs, design,
> registry, increment, and journal evidence. Severity vocabulary: FAIL
> (artifact wrong), EVIDENCE-GAP (the record cannot be trusted or shipped
> as-is), and WARN (non-blocking process debt or drift).

## Report: independent OODA aggregate verifier · 2026-07-19 06:41 EDT

**Change**: `extract-v1-static-resolution-phase`  
**Verified at**: `2026-07-19 06:41 EDT`  
**Verifier**: independent OODA aggregate verifier subagent; not the implementer  
**Tree identity** (read-only; consumed by archive conformance):
`chore/refactor-town` @ `fd16879`
(`fd168798bbc4f698e761ed43bf01d19e6eb6de10`)  
**Dirty state**: dirty — full `git status --short` inventory and untracked
expansion are recorded in §13. `git diff --binary | shasum -a 256` =
`1a6e96144a0c792983de234742b2243a444b1f9da8b7c8be57f777249c17d841  -`.
This hash covers tracked diffs only; untracked evidence must land separately.

---

## 1. Structural Validation

- [x] TARGETED hard gate:
      `openspec validate extract-v1-static-resolution-phase --strict --json`
      exited 0 with `valid: true`, `1/1` passed, and no issues.
- [x] Repo-wide context: `openspec validate --all --strict --json` exited 0
      with `141/141` passed (`9` changes and `132` specs).

```text
targeted: items=1, passed=1, failed=0, valid=true, issues=[]
repo-wide: items=141, passed=141, failed=0
```

| Item | Type | Issues | Blocks this change? |
| --- | --- | --- | --- |
| `extract-v1-static-resolution-phase` | change | none | no |
| Portfolio aggregate | 9 changes + 132 specs | informational long-requirement notices only | no |

## 2. Registry Completion (`tasks.md`)

- [x] Registry lint:
      `registry-lint: 0 error(s), 0 warning(s) — 1 registry row(s), 0 cross-cutting row(s)`.
- [x] Row 01 is ticked with `ticked: 2026-07-19 06:37`.
- [x] The cited journal reorientation exists at the same timestamp.
- [x] No open cross-cutting or `gate:ops` row exists.

| Line | Incomplete / tick evidence gap | Blocks archive? |
| --- | --- | --- |
| — | none | no |

## 3. Per-Increment Completeness

The implementation-evidence precheck passes: one packet exists, with `28`
checked items in the packet and one checked registry row.

| Increment | Mode | Plan steps | Decisions / requirement | Gate complete? | Output merged? | Inputs timing | Complete? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `01-extract-v1-static-resolution-phase` | delegate / subagent review | 12/12, plus all gate/output/authorship checks | D1-D4 implemented; `§arch-extract-v1-phase-seams/Private engine-local phase seam` has two scenarios | G1-G6 all `[x]` | yes: evidence, proposed journal entries, variables, two independent clean reviews, and orchestrator checklist are merged | n-a; `inputs: —`, envelope-licensed | yes |

No packet predates an information dependency because there is no input row.
The delegate wrote only the declared source/packet footprint; shared artifact
updates are attributed to the orchestrator in the journal.

## 4. Deferral Closure & Staleness

DEF-1 through DEF-4 remain explicit and unbreached: this is reorientation
`1/3`, the date is before `2026-08-19`, and no resolving signal is present.
However, the completion protocol requires each unresolved DEF to be carried by
a named lazy row or by a retrospective. Neither exists. Because this report's
newest Overall Decision is FAIL, a retrospective MUST NOT be created yet.
These are **EVIDENCE-GAPs** to reconcile through the allowed pre-retrospective
carry-forward shape before archive.

| ID | Deferred decision | Current evidence | Review-by breached? | Disposition |
| --- | --- | --- | --- | --- |
| DEF-1 | separate static-resolution module | external second-consumer signal named; retained at 1/3 | no | EVIDENCE-GAP: no lazy-row/retrospective carry-forward |
| DEF-2 | another `analyze()` phase | external next-phase plan signal named; retained at 1/3 | no | EVIDENCE-GAP: no lazy-row/retrospective carry-forward |
| DEF-3 | keyframe/static collision policy | external collision signal named; retained at 1/3 | no | EVIDENCE-GAP: no lazy-row/retrospective carry-forward |
| DEF-4 | `analyze()` parameter object | external next-input signal named; retained at 1/3 | no | EVIDENCE-GAP: no lazy-row/retrospective carry-forward |

## 5. Delta Spec Sync State

| Capability | Namespace | Sync state | Notes |
| --- | --- | --- | --- |
| `arch-extract-v1-phase-seams` | architectural | needs sync | Canonical `openspec/specs/arch-extract-v1-phase-seams/spec.md` does not exist; the delta ADDS the capability's first requirement. |

The delta contains only `## ADDED Requirements`, so there is no mandatory
MODIFIED/REMOVED/RENAMED collision query set. An extra exact-header search hit
only this target delta. Canonical sync is therefore pending without a current
cross-change collision.

## 6. Design / Specs Coherence

| Item | Design | Spec/source evidence | Gap |
| --- | --- | --- | --- |
| D1 | complete Phase 2a/2b block behind one helper | one private helper owns registry shaping and enrichment; `analyze()` has one call | none |
| D2 | preserve insertion and timing order | local → imported static → imported keyframe → same-file logic preserved; `phase2_start → resolve_bindings → helper → import_resolution_ms` | none |
| D3 | wished-for direct seam test observes RED then GREEN | packet records isolated `E0425` RED under Rust 1.97.0 and focused GREEN; current focused test passes | none |
| D4 / NS3 / NS5 | private, in-file, V1-only seam | exactly one non-public definition; no `static_resolution.rs`, V2, or shared-loader edit | none |
| Requirement scenarios | executable private/locality and public/timing checks | exact `rg`/`test` commands plus G1/G2/G6 are named | none |

**WARN — RepoWise freshness limit:** `repowise status` reports last sync commit
`fd168798bbc4f698e761ed43bf01d19e6eb6de10`, the current HEAD, while the source
seam is an uncommitted tracked diff. Its `1.4` project-analyzer score is a valid
committed baseline but cannot quantify this dirty-tree increment. No verdict or
health-improvement claim in this report relies on that stale score.

## 7. Implementation Completeness

- [x] No ticked increment has zero progress.
- [x] The authored architectural requirement has two scenarios.
- [x] The source diff is confined to the registry footprint and implements the
      private helper, single caller, and direct unit contract.
- [x] Fresh G1-G6 checks support the exact dirty-tree implementation.

**Contradictions / gaps:** none in implementation behavior. Packaging and
record gaps are classified separately in §§4 and 13.

## 8. Front-Door Routing Leak Detector (WARN)

The detector returned six ignored, pre-existing files. `git check-ignore -v`
attributes all to `.gitignore:66:docs`; none belongs to this target change.

| File | Captured by target? | Action |
| --- | --- | --- |
| `docs/superpowers/specs/2026-07-16-clippy-verification-design.md` | no | reconcile with its owner separately |
| `docs/superpowers/specs/2026-07-19-cascade-round-trip-matrix-design.md` | no | reconcile with its owner separately |
| `docs/superpowers/specs/2026-07-19-repowise-distill-enablement-design.md` | no | reconcile with its owner separately |
| `docs/superpowers/plans/2026-07-16-clippy-verification.md` | no | reconcile with its owner separately |
| `docs/superpowers/plans/2026-07-19-cascade-round-trip-matrix.md` | no | reconcile with its owner separately |
| `docs/superpowers/plans/2026-07-19-repowise-distill-enablement.md` | no | reconcile with its owner separately |

## 9. Deferred Dogfood vs Automated-Test Equivalence

`rg -n '\[~\]' openspec/changes/extract-v1-static-resolution-phase` returned
empty. No deferred manual check requires an equivalence mapping.

| Deferred check | Equivalent automated test | Real gap? |
| --- | --- | --- |
| — | n-a; no `[~]` rows | no |

## 10. Spec Taxonomy & Leakage Lint (BLOCKING)

All three commands were run from the target change root and returned empty.

```text
$ rg -n 'SHALL (use|adopt|leverage|be implemented (with|using|in))' specs/ --glob '!arch-*/**'
<empty>
$ rg -in '\b(because|as decided|we chose|per the design)\b' specs/
<empty>
$ rg -n '\bD[0-9]+\b|[Dd]ecision [Ll]edger' specs/
<empty>
```

- [x] Lint 1 empty; no dependency disposition needed.
- [x] Lint 2 empty.
- [x] Lint 3 empty.

| Sampled requirement | Namespace | Admission test | Passes? |
| --- | --- | --- | --- |
| `§arch-extract-v1-phase-seams/Private engine-local phase seam` | architectural | both scenarios name executable `rg`, `test`, G1/G2, Clippy, unit, canary, and integration checks | yes |
| — | behavioral | no behavioral namespace is added or modified by this change | n-a |

## 11. Guardrail Gate History (BLOCKING)

Every STOP gate is ticked in the packet and was rerun against the recorded
dirty tree.

| Guardrail | Scope | Scope valid? | Fresh result |
| --- | --- | --- | --- |
| G1 | `footprint:packages/extract/src/project_analyzer.rs` | yes | PASS; public/NAPI/manifest/cache/counter diff search empty |
| G2 | `footprint:packages/extract/src/project_analyzer.rs` | yes | PASS; timing-line diff search empty |
| G3 | `footprint:packages/extract/src/project_analyzer.rs` | yes | PASS; exactly one private definition, no public match, no second file |
| G4 | `footprint:packages/extract/src/project_analyzer.rs` | yes | PASS; focused Rust 1/1 and keyframe integration 3/3 |
| G5 | `all` | yes | PASS; protected hash `95572cc99f8487ef872fa077ff8279ee7378e0995f4e5f57a7e16095ef65f514  -` |
| G6 | `change-end` | yes | PASS NOW; Clippy exit 0, Rust units 273 + 8/1 ignored + 348, canary 200, integration 11 files / 157 tests |

No STOP check failed, so no `guardrail-trip` entry is owed. G5 independently
proves every tracked foreign patch remained byte-stable from the packet's
pre-increment calibration through this final run.

**WARN — formatter baseline:** fresh manifest-wide
`cargo fmt --manifest-path packages/extract/Cargo.toml -- --check` remains red
across many pre-existing Rust regions. The packet and journal do not claim a
clean global formatter result; no formatting write occurred, and targeted
evidence reports no helper/test-range hunk. This is external process debt, not
a G1-G6 failure or a reason to mutate unrelated Rust.

## 12. Journal & Delegation Coherence

- [x] No guardrail trip or mode change occurred; none is missing.
- [x] Row 01 is licensed by the envelope seed before its packet.
- [x] K=1 is satisfied by the `06:37` reorientation.
- [x] The reorientation records all three adversarial stances with evidence:
      falsifier refuted by the complete diff/G1/G2; entropy refuted by the
      isolated toolchain-correct RED and scoped formatter evidence; heretic
      rejected by the one-consumer boundary and DEF-1 signal.
- [x] Phase 1 spec/OODA and Phase 2 code-quality review both returned clean.
- [x] The delegated output contract is merged in the packet and journal; no
      evidence shows subagent writes to shared design/tasks/journal/spec files.

**Gaps found:** none in journal/delegation coherence.

## 13. Packaging & Change Boundary

### Full dirty inventory

`git status --short` after all fresh gates and immediately before report write:

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
 M packages/extract/src/project_analyzer.rs
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
?? packages/next-plugin/tests/with-animus.test.ts
?? packages/system/__tests__/system-builder.test.ts
```

The full untracked expansion, including this verifier-created report, is:

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
packages/next-plugin/tests/with-animus.test.ts
packages/system/__tests__/system-builder.test.ts
```

### Untracked reachability

| Untracked path(s) | Tracked reachability | Classification | Severity / action |
| --- | --- | --- | --- |
| complete `openspec/changes/extract-v1-static-resolution-phase/**` corpus | not runtime-imported; required change/archive evidence | change-owned, locally present but absent from shipping patch | **EVIDENCE-GAP**; land the complete corpus together |
| five foreign OODA directories | not runtime-imported | adjacent-intentional artifacts for separately named changes, all protected as prior context | WARN for this target; split/land with their owners |
| `packages/next-plugin/tests/with-animus.test.ts` | yes: tracked `vite.config.ts` discovers `packages/next-plugin/tests` | adjacent-intentional for `preserve-next-plugin-options` | portfolio **EVIDENCE-GAP**, not a dependency of this implementation |
| `packages/system/__tests__/system-builder.test.ts` | yes: tracked `vite.config.ts` discovers `packages/system/__tests__` | adjacent-intentional for `enforce-system-prop-overlap-equality` | portfolio **EVIDENCE-GAP**, not a dependency of this implementation |

No generated-only or scratch file appears in the visible untracked census.
The target's direct Rust test is inside tracked-modified
`project_analyzer.rs`, so it is not an untracked reachability gap.

### Foreign tracked diffs

The target registry footprint is only
`packages/extract/src/project_analyzer.rs`. Every other tracked modification
has a disposition below; G5 proves all remained byte-stable.

| File | Classification | Action |
| --- | --- | --- |
| `AGENTS.md` | ambient branch drift / root-document formatting work | leave to root-document owner; protected by G5 |
| `openspec/specs/pipeline-integration-testing/spec.md` | adjacent-intentional: `harden-embedded-transform-integration` | split/land with that change |
| `packages/_integration/CLAUDE.md` | adjacent-intentional: `harden-embedded-transform-integration` | split/land with that change |
| `packages/_integration/__tests__/cascade-round-trip.test.ts` | adjacent-intentional: `harden-embedded-transform-integration` | split/land with that change |
| `packages/_integration/__tests__/extraction.test.ts` | adjacent-intentional: `harden-embedded-transform-integration` | split/land with that change |
| `packages/_integration/__tests__/run-pipeline.ts` | adjacent-intentional: `harden-embedded-transform-integration` | split/land with that change |
| `packages/_integration/__tests__/selector-rules.test.ts` | adjacent-intentional: overlapping embedded-transform and selector-oracle footprints | coordinate those changes; do not absorb here |
| `packages/_integration/fixtures/components/selector-rules/selector-rules-create-element.tsx` | adjacent-intentional: selector-oracle exact footprint plus embedded broad footprint | coordinate those changes; do not absorb here |
| `packages/_integration/fixtures/components/selector-rules/selector-rules-unresolvable-token.tsx` | adjacent-intentional: selector-oracle exact footprint plus embedded broad footprint | coordinate those changes; do not absorb here |
| `packages/_integration/fixtures/components/transforms.tsx` | adjacent-intentional: `harden-embedded-transform-integration` | split/land with that change |
| `packages/extract/crates/extract-v2/src/analyze_css.rs` | ambient branch drift; no target owner | leave untouched; protected by G5 |
| `packages/extract/crates/extract-v2/src/cross_file.rs` | ambient branch drift; no target owner | leave untouched; protected by G5 |
| `packages/extract/crates/extract-v2/src/pipeline.rs` | ambient branch drift; no target owner | leave untouched; protected by G5 |
| `packages/extract/tests/canary.test.ts` | adjacent-intentional: `fail-loud-canary-fixture-discovery` exact footprint | split/land with that change |
| `packages/next-plugin/README.md` | adjacent-intentional: `preserve-next-plugin-options` exact footprint | split/land with that change |
| `packages/next-plugin/src/with-animus.ts` | adjacent-intentional: `preserve-next-plugin-options` exact footprint | split/land with that change |
| `packages/system/src/SystemBuilder.ts` | adjacent-intentional: `enforce-system-prop-overlap-equality` exact footprint | split/land with that change |

No foreign diff is required by the target implementation. Nevertheless, the
dirty-tree rule postpones archive until this exact target patch and all target
artifacts land, or the recorded SHA/tree becomes clean and conformant.

## 14. Review-Finding Intake

| ID | Finding / challenge | Source | Disposition | Evidence | Follow-up |
| --- | --- | --- | --- | --- | --- |
| RF-1 | move might omit Phase 2 work or alter public/timing boundaries | Phase 1 falsifier | rejected | complete diff, one helper call, empty G1/G2, fresh G6 | none |
| RF-2 | RED might be only an unsupported-toolchain failure | Phase 1 entropy auditor | rejected after prerequisite correction | Rust 1.97.0 reached isolated `E0425`; current GREEN 1/1 | none |
| RF-3 | new module/shared V1-V2 helper might be stronger | Phase 1 heretic | deferred intentionally | one V1 caller and independent-oracle constraint; DEF-1 has second-consumer signal | DEF-1 |
| RF-4 | correctness/readability/edge-case hazards in extracted helper | Phase 2 code-quality review | rejected; review clean | move preserves original ownership/order; direct and black-box tests pass | none |
| RF-5 | manifest-wide Rust formatter baseline is red | implementer/aggregate verifier | accepted as external WARN | fresh check reports many pre-existing files; no format write; target ranges separately checked | separate formatting-baseline owner |
| RF-6 | root Cargo initially selected Rust 1.94.0 | implementer | accepted as toolchain-routing WARN | pinned 1.97.0 produced valid RED/GREEN; mapped vp gates now pass | verification-command owner |
| RF-7 | RepoWise health score does not include dirty seam | orchestrator/aggregate verifier | accepted and recorded limitation | `repowise status` last sync is HEAD `fd168798bbc4`; source is dirty | refresh only after landing; do not claim current score improvement |
| RF-8 | complete target OODA corpus is untracked | aggregate verifier | accepted as packaging EVIDENCE-GAP | full untracked inventory above | land corpus, then re-run verify |
| RF-9 | DEF-1 through DEF-4 lack protocol carry-forward shape | aggregate verifier | accepted as record EVIDENCE-GAP | no lazy rows and no retrospective | add allowed carry-forward before a passing verify; do not create retro while FAIL |
| RF-10 | two foreign tests are untracked but tracked config discovers their directories | aggregate verifier | accepted as portfolio EVIDENCE-GAP, unrelated to target behavior | `git ls-files --others`; tracked `vite.config.ts` unit command | split/land with their named changes |

Every surfaced finding/challenge is dispositioned; none remains ambient memory.

## Implementation Evidence

| Fresh command / observation | Result |
| --- | --- |
| focused Rust phase helper test under Rust 1.97.0 | 1 passed, 272 filtered |
| keyframe binding integration | 1 file / 3 tests passed |
| G1 public/NAPI/manifest/cache/counter search | empty |
| G2 timing search | empty |
| G3 locality checks | one private definition; no public match; no second file |
| G5 protected diff hash | exact `95572cc99f8487ef872fa077ff8279ee7378e0995f4e5f57a7e16095ef65f514` |
| `vp run verify:clippy` | exit 0 across all active extraction crates |
| `vp run verify:unit:rust` | 273 passed; 8 passed / 1 ignored; 348 passed |
| `vp run verify:canary` | 200 passed, 0 failed |
| `vp run verify:integration` | 11 files / 157 tests passed |
| `git diff --check -- packages/extract/src/project_analyzer.rs` | exit 0, empty output |

## Verdicts

- **Artifact verdict** (do the records match reality): FAIL — current records
  accurately describe a viable local implementation, but the entire target OODA
  corpus is untracked and the four deferred decisions lack the protocol's
  allowed carry-forward form.
- **Implementation verdict** (is the built thing viable/complete): PASS — all
  source-owned STOP checks and mapped V1 verification pass on the exact recorded
  dirty tree. Ambient formatter debt and stale RepoWise indexing do not change
  runtime viability and are not represented as clean-current claims.
- **Rollout verdict**: n-a — private V1 refactor with no deployment or OPS row.
- **Archive decision**: postpone archive — reason: untracked target evidence,
  unresolved DEF carry-forward, canonical sync pending, and dirty-tree mainline
  conformance. No retrospective may be created while this FAIL report is newest.

## Overall Decision (= the Artifact verdict; the retro precheck gates on this line)

- [ ] ✅ PASS — records match reality
- [ ] ⚠️ PASS WITH WARNINGS — proceed, but note: `<explain>`
- [x] ❌ FAIL — fix the failing artifact and re-run verify

**Next step:** Land `packages/extract/src/project_analyzer.rs` and the complete
`extract-v1-static-resolution-phase` OODA corpus as one change-owned unit,
without absorbing any G5-protected foreign diff. Before any retrospective,
give DEF-1 through DEF-4 the protocol's allowed pre-retrospective carry-forward
shape and re-run all fourteen checks. If the newest report is then non-FAIL,
perform canonical arch-spec sync, cross-change collision confirmation, and the
read-only mainline/patch conformance check before archive. Do not create
`retrospective.md` while this FAIL report remains newest.

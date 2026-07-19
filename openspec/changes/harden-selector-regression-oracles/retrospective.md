# Retrospective: harden-selector-regression-oracles

> Written: 2026-07-19 (after verify passed with warnings)  
> Evidence is artifact and journal state. The journal is the primary temporal source.

---

## 0. Evidence

- **Increments**: 1/1 — mode split: 0 inline / 1 delegated
- **Tasks done**: 38/38 — 37 increment checks plus one registry row
- **Capabilities touched**: 1 behavioral, 0 `arch-*`; **requirements authored**: 1 modified requirement with five scenarios
- **Guardrails**: 5 registered / 0 trips (0 STOP, 0 WARN) / 0 promoted to `specs/arch-*` at archive
- **Journal**: 8 entries — seed 1 · surprise 0 · friction 2 · signal 0 · guardrail-trip 0 · reorientation 1 · objection 4 · mode-change 0 · spawn 0
- **Deferral outcomes**: 0 resolved as predicted / 0 surprised / 0 retired stale; DEF-1 through DEF-4 remain deferred because no resolving signal appeared
- **Delegation outcomes**: 1 implementation dispatch / 1 merged clean / 0 merge-rejected; one independent reviewer converged to APPROVED after three accepted repairs
- **Files touched**: `packages/_integration/__tests__/selector-rules.test.ts`, `packages/_integration/fixtures/components/selector-rules/selector-rules-create-element.tsx`, `packages/_integration/fixtures/components/selector-rules/selector-rules-unresolvable-token.tsx`
- **New external dependencies**: none
- **OpenSpec validate state**: targeted 1/1 pass; repo-wide 137/137 pass
- **Verdicts**: artifact PASS WITH WARNINGS · implementation PASS · rollout n/a · archive postponed for dirty/unmerged/untracked conformance
- **Conformance**: verified SHA `fd16879` is an ancestor of `origin/main`; verified dirty patch fingerprint has not landed, so `unmerged-implementation` postpones archive
- **Test coverage signal**: mutation RED 12/13, restored focused GREEN 13/13, full integration 157/157
- **Active sessions / rough hours**: 1 session / approximately 0.7 hours

Increment summary:

| # | Increment | Mode | Resolved | Authored | Notes |
| --- | --- | --- | --- | --- | --- |
| 01 | harden selector regression oracles | delegate | D1-D4 implemented; no DEF resolved | envelope-owned `§pipeline-integration-testing/Selector-rule fixture matrix registered` | RF-1 through RF-3 repaired; final review APPROVED |

---

## 1. Wins

- [evidence: RepoWise audit, canonical requirement, archived `fix-selector-rule-extraction`] The queue lead was verified as a false positive instead of prompting redundant governance or an unmeasured refactor.
- [evidence: `selector-rules.test.ts`, mutation Task 01.4] The v1 raw-token claim became an exact, mutation-sensitive compatibility oracle while v2's stricter declaration-drop diagnostic remained intact.
- [evidence: journal 03:30-03:39 objections and reorientation] Independent review found three truthfulness/evidence defects before the registry tick; every accepted finding was repaired and cleanly re-reviewed.
- [evidence: verify.md] Focused, full integration, formatting, OpenSpec portfolio, registry, leakage, guardrail, and diff evidence converged with no EVIDENCE-GAP.

## 2. Misses

- 🟡 [painful | evidence: journal 03:30 friction] The packet selected direct `bunx oxfmt`, but this repository exposes formatting through `vp fmt`; the implementer had to diagnose and substitute the contributor-authorized command.
- 🟡 [painful | evidence: RF-1/RF-2] The first envelope omitted contradictory prose in the unresolved fixture and calibrated G5 against a syntax the packet did not use. Review prevented a false clean result, but required an extra repair cycle.
- 📌 [nit | evidence: RF-3] A checked pre-review statement became stale after the accepted fixture repair. The packet needed a final-state wording correction even though runtime behavior stayed green.
- 📌 [warning | evidence: verify §8] Six unrelated ignored `docs/superpowers` artifacts remain; their owning Clippy/item3/RepoWise work must dispose of them outside this change.

## 3. Plan Deviations

| Increment / row | What changed | Journal trace | Why |
| --- | --- | --- | --- |
| 01 | Final source scope gained a real unresolved-token fixture prose edit rather than temporary mutation-only access | 2026-07-19 03:30 RF-1 objection | The fixture itself contradicted both engine-local oracles |
| 01 | Added Task 01.6 and repaired G3/G5 after independent review | 2026-07-19 03:30 RF-1/RF-2 objections | The original prose boundary and guardrail parser were incomplete |
| 01 | Reworded checked final-diff evidence after repair | 2026-07-19 03:37 RF-3 objection | The earlier checkpoint no longer described final artifact state |

No increment spawn or mode change occurred.

## 4. Skill / Workflow Compliance

| Skill / workflow | Used |
| --- | --- |
| brainstorming | ✓ — existing audit evidence was captured through the OODA exploration-evidence path |
| writing-plans | ✓ — increment packet passed the cold-start test |
| executing-plans | n/a — the settled row ran in delegate mode |
| test-driven-development | ✓ — source-linked mutation RED, restoration, and GREEN |
| subagent-driven-development | ✓ — separate implementer and independent reviewer/verifier |
| receiving-code-review | ✓ — RF-1 through RF-3 were verified before repair; RF-4 received evidence-backed pushback |
| verification-before-completion | ✓ — fresh repository-owned and independent verification preceded completion claims |

### Deliberately Skipped Skills

None. `executing-plans` was not applicable because the schema selected delegate mode and the packet was executed by the implementation subagent.

## 5. Surprises (journal triage)

There are no journal `surprise` entries. Formatter behavior was logged as friction, and reviewer findings were logged as objections.

Unlogged surprises discovered now: none.

## 6. Promote Candidates → Long-Term Learning

- [ ] 🟡 **Guardrail calibration must prove a known-positive witness can match, not merely observe an expected empty result** → **Promote to** OODA schema
  > **Why**: RF-2 reproduced the prior archived `restore-spec-tree-integrity` candidate: G5 returned the expected empty output while being structurally incapable of matching the packet's real footprint syntax.
  > **How to apply**: Extend Guardrail Register instructions or registry lint with a seeded positive/sentinel check for syntax-parsing guardrails before they can become active.

- [ ] 📌 **Increment plans must select formatter and verifier commands from the repository contributor interface** → **Promote to** writing-plans skill
  > **Why**: The packet's direct formatter command targeted an LSP-only shim despite root instructions naming `vp fmt`.
  > **How to apply**: During cold-start packet authoring, require a command-source citation from the applicable `AGENTS.md` change map and verification interface.

- [ ] 🟡 **Engine-specific compatibility prose must distinguish declaration loss from rule loss** → **Promote to** one-off behavioral specification
  > **Why**: RF-1 found a fixture comment that overstated v2's declaration drop as whole-rule loss while v1 preserved both.
  > **How to apply**: Archive this change's engine-local selector scenario into `pipeline-integration-testing`; no cross-engine implementation sharing follows from the wording.

No G1-G5 row is a durable architectural constraint requiring `specs/arch-*` promotion. Their lasting behavioral content is already in the modified pipeline-integration requirement.

> Unchecked candidates carry forward. The relevant prior non-vacuity candidate from `2026-07-07-restore-spec-tree-integrity` is explicitly reinforced rather than marked stale.

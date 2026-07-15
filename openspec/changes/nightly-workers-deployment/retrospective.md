# Retrospective: nightly-workers-deployment

> Written: 2026-07-15 after independent verification passed. Repository work is
> complete; rollout remains OPS-gated.

## 0. Evidence

- **Increments**: 1/1 — one delegated implementation, one reused independent reviewer.
- **Registry**: row 01 complete; gate 2.1 open and backed by OPS-1–OPS-4.
- **Capability**: one behavioral capability with five requirements.
- **Guardrails**: G1–G4 pass; G5 remains active through cutover.
- **Deferrals**: credentials and Git-build disablement remain under gate 2.1;
  fan-out optimization and V1 deployment coverage remain externally signal-gated.
- **Dependencies**: no new package dependency.
- **Validation**: targeted valid; portfolio 140/140 valid.
- **Verification**: 38/38 focused; shell syntax and both empty guards pass;
  `verify:ci` passes 29/29.
- **Verdicts**: artifact PASS WITH WARNINGS · implementation PASS · rollout
  OPS-GATED · archive POSTPONE.
- **Conformance**: `18b7bcde8c63` is not on `main`; untracked referenced files
  require a clean landed-SHA re-verification.

| # | Increment | Mode | Resolved | Authored | Notes |
| --- | --- | --- | --- | --- | --- |
| 01 | repository-nightly-deploy | delegate | D1–D5 | envelope requirement set | clean re-review after one correction cycle |

## 1. Wins

- [evidence: `workers-config.test.ts`, 38/38] Exact command-order and
  validation-before-mutation contracts are executable without credentials.
- [evidence: implementation re-review APPROVED] The same reviewer closed all
  five findings; no independent review wall was created.
- [evidence: `verify:ci`, 29/29] The new operational path did not change release
  eligibility and coexists with the full release/consumer proof.
- [evidence: `ops-runbook.md`] Cloudflare Git Builds remain a deliberate
  fallback until a merged-main run proves the replacement.

## 2. Misses

- 🟡 [painful | review finding] The first GREEN left credentials job-scoped and
  installation non-frozen; structural tests were initially too permissive.
- 🟡 [painful | sandbox run] The first `verify:ci` packed lane hung under
  restricted network access; a normal-network rerun produced a clean composite
  receipt.
- 🔴 [blocking | verify §5] GitHub secrets and a merged-main run require external
  authority, so rollout, sync, and archive cannot complete in this tree.

## 3. Plan deviations

| Increment / row | What changed | Journal trace | Why |
| --- | --- | --- | --- |
| 01 | Added a second RED/GREEN correction cycle | `2026-07-15 14:56 EDT · inc 01 · review-closure` | Reviewer exposed five under-discriminated contracts |
| gate 2.1 | Remains open instead of being executed locally | `2026-07-15 14:56 EDT · inc 01 · reorientation` | Secrets, merged-main dispatch, and dashboard cutover are external authority |

## 4. Skill / workflow compliance

| Skill | Used |
| --- | --- |
| brainstorming | ✓ — design approved before implementation |
| writing-plans | ✓ — increment 01 cold-start packet |
| test-driven-development | ✓ — initial and corrective RED evidence |
| subagent-driven-development | ✓ — one implementer, one reused reviewer |
| verification-before-completion | ✓ — focused and full CI gates rerun by root |

No required skill was deliberately skipped.

## 5. Surprises

| Journal entry | Triage | Note |
| --- | --- | --- |
| review-closure · inc 01 | confirmed | Secret scope, frozen install, and failure-summary behavior needed stronger structural tests |
| sandbox packed stall | contextualized | Network restriction, not repository failure; normal-network `verify:ci` passes |

No unlogged product surprise was discovered during retrospective.

## 6. Promote candidates

- [x] 🔴 **Deployment credentials belong only on the mutation-capable step** →
  **Promote to** the scheduled-worker-deployment requirement/test surface.
  The focused test now rejects job-scoped Cloudflare secrets.
- [x] 🔴 **All deployable artifacts validate before the first remote mutation**
  → **Promote to** the scheduled-worker-deployment requirement/test surface.
  Failure injection covers build, assertion, and dry-run phases.
- [ ] 📌 **Consider artifact fan-out only after nightly runtime breaches a named
  budget** → carry as DEF-3; no measurement fires it today.

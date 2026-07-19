# Retrospective: extract-v1-resolve-value-scale-lookup

Written 2026-07-19.

## 0. Evidence Summary

- Increments: 1/1 complete — 0 inline, 1 delegated.
- Tasks: 33/40 complete — 32 packet tasks plus the completed registry row; seven lazy backlog rows remain intentionally open after packetless row 09 retired.
- Capabilities: 0 behavioral capabilities and 1 architecture capability touched; 1 architecture requirement added.
- Guardrails: 6 registered; 3 STOP trips, 0 WARN trips, and 0 promotions completed. One architecture requirement is queued for synchronization if the change is archived.
- Journal: 20 entries — seed 1, reorientation 10, objection 3, guardrail-trip 3, friction 1, spawn 1, surprise 1, signal 0, mode-change 0.
- Deferrals: 0 resolved as predicted, 1 later causal surprise, 1 retired. DEF1–DEF7 remain predictably represented by lazy rows 02–08; DEF8 and packetless row 09 retired after the repository-source premise was disproved.
- Delegation: 1 implementation dispatch, 1 clean merge into the shared working tree, 0 merge rejections. Independent review produced a repair cycle followed by a clean Phase 2 re-review.
- Files touched by the increment: `packages/extract/src/theme_resolver.rs` plus the increment packet completion fields. The orchestrator authored the enclosing OODA artifacts.
- New dependencies: none.
- Validation: targeted strict OpenSpec validation passed; portfolio validation passed 150/150 artifacts with advisory long-requirement notices only.
- Verification verdicts: Artifact `PASS WITH WARNINGS`; Implementation `PASS`; Rollout `n/a`; archive postponed because the checkout contains ambient dirty work and this change is not landed independently.
- Conformance: `fd16879` remains an ancestor of `origin/main`; the verified dirty-tree fingerprint is recorded in `verify.md`, but no landed commit is claimed.
- Test signal: focused Rust tests 2/2; Rust unit suites 640 passed and 1 ignored; NAPI canary 200/200; integration 157/157.
- Effort: one continuous orchestration session, approximately 1.5 hours.

| Increment | Delivery | Result | Review |
| --- | --- | --- | --- |
| 01 — Extract scale lookup | Delegated implementation with orchestrator-owned OODA envelope | D1–D4 complete; helper extracted, production caller retained, direct and `Option`-state matrices added | Phase 1 repairs applied; Phase 2 clean |

## 1. What Worked

- The implementation isolated only scale lookup while leaving negative handling, transform application, fallback, and finalization in `resolve_value`.
- Separate caller-visible and internal `Option`-state matrices prevented empty-string and null behavior from being flattened into an incomplete byte-level characterization.
- The structural call-count guardrail was corrected to inspect production code only, making the one-definition/two-production-call/zero-recursion claim meaningful.
- V1 remained the sole edit surface. No V2, shared-code, public-API, alias, global, or keyframe policy changes were introduced.
- The full mapped Rust verification path and an independent Phase 2 review both passed after the focused repairs.
- The transient NAPI materialization/freshness anomaly was initially isolated as DEF8 rather than expanding source scope; later causal proof retired it cleanly without a repository verification change.

## 2. What Could Improve

- 🟡 The initial packet overclaimed `Option`-state coverage and carried a stale G4 scenario. Independent review caught both before production editing.
- 🟡 The first G2 command counted a test-only helper call and therefore did not prove the production topology it described.
- 🟡 The initial packet did not calibrate whole-file `rustfmt` against pre-existing formatter drift in this legacy file.
- 🟡 Explicit five-field test tuple annotations tripped strict Clippy's `type_complexity` rule; inference was sufficient and clearer.
- 🟡 The outer orchestration cell was misreported as a successful nested
  `vp run build:extract` exit even though no nested result was retained. Later
  reproductions—not the original event—proved live release compilers during
  the same stale-retry pattern. That evidence retires DEF8 and makes explicit
  result handling, not repository verification code, the corrective action.
- 📌 Two K=1 reorientations initially recorded entropy without the required full three-stance pass. The journal was repaired append-only, and independent review closed the cadence finding as historical friction rather than an active evidence gap.
- The final verification report identified no unresolved evidence gaps in §9.

## 3. Deviations and Repairs

| Planned or expected path | Observed deviation | Repair and evidence |
| --- | --- | --- |
| One direct matrix would characterize the extraction | It did not prove internal `Some`/`None` state, and G4 named stale expectations | Added a dedicated helper-state matrix and corrected the spec; journal 12:18–12:21 |
| G2 would count helper topology across the file | Test calls contaminated the count | Scoped G2 to production code; journal 12:28–12:30 |
| Whole-file formatter check would be a valid gate | The committed file already had unrelated formatter drift | Preserved baseline and proved authored helper/test snippets independently formatter-clean; journal 12:35–12:38 |
| Typed case vectors would satisfy strict Clippy | Five-field tuple annotations triggered `type_complexity` | Removed redundant annotations and retained inference; journal 12:46–12:48 |
| Exact prerequisite remediation would make canary freshness immediately observable | The original outer wrapper had no retained nested result; later reproductions of the same stale-retry pattern directly proved active builds | Initially spawned DEF8 under uncertainty, then later process/result evidence retired it while retaining strict canary; journal 12:56–13:02 and 14:28 |
| DEF8 could be represented by `vite.config.ts` alone | The initially unknown owner also included verification scripts; later reproductions identified execution-wrapper result handling as causal and left no repository-source evidence | Widened the temporary candidate footprint at 13:04–13:05, then removed packetless row 09 at 14:28 |
| Every K=1 reorientation would include all three stances | Two historical entries recorded entropy only | Added an objection and full catch-up three-stance pass without rewriting history; journal 13:16–13:17 |

## 4. Skill Effectiveness

- `brainstorming`: ✓ clarified the smallest behavior-preserving extraction boundary.
- `writing-plans`: ✓ converted that boundary into a bounded packet with explicit guardrails and gates.
- `executing-plans`: n/a — `subagent-driven-development` was selected for this increment.
- `test-driven-development`: ✓ characterized caller-visible and helper-state behavior before accepting the refactor.
- `subagent-driven-development`: ✓ bounded implementation and independent review produced one repair loop and a clean re-review.
- Deliberately skipped applicable skills: none.

## 5. Surprises

One formal post-verification surprise is recorded at 14:28: later executions
proved that the alleged successful nested build exit was never observed. The
source premise behind DEF8 was false, so the deferral and packetless row 09 were
retired without a repository mutation.

## 6. Promotion Candidates

- [ ] 🟡 **Behavior characterization must separate caller-visible bytes from internal `Option` state when the distinction affects fallback semantics.** → architecture spec; already queued in this change's delta for archive-time synchronization.
- [ ] 🟡 **Structural call-count guardrails must exclude test-only references when they claim production topology.** → OODA schema or execution skill guidance.
- [ ] 🟡 **Whole-file formatter gates on dirty legacy files need baseline-versus-delta proof.** → contributor guidance or durable execution memory.
- [ ] 🟡 **Nested command completion must be surfaced explicitly; an outer
  orchestration cell completing is insufficient, so fall back to process
  termination plus artifact/input mtimes before immediate retry.** → agent
  execution guidance; DEF8 is retired because repository code was not causal.
- [ ] 📌 **Cadence K=1 requires all prescribed stances at every reorientation, including repair-only checkpoints.** → OODA schema guidance.

## 7. Post-verification correction

The 14:28 journal surprise and reorientation supersede the earlier causal
interpretation without rewriting its historical entries. The implementation,
tests, strict canary, artifact verdict, and archive postponement remain valid.
Only the backlog disposition changes: DEF8 is retired, row 09 is removed, and
future remediation protocol must distinguish outer orchestration completion
from an observed nested command exit.

# Verification Report(s)

## Report: independent aggregate verifier `/root/parity_review` · 2026-07-19 05:17 EDT

**Change**: `preserve-next-plugin-options`  
**Verifier**: `/root/parity_review`, independent reviewer; not the implementer  
**Tree identity**: `chore/refactor-town` @ `fd16879`  
**Dirty state**: dirty  
**Tracked patch fingerprint**: `4d42711d632a83258751c6373f32e3b1148a6dbf7bc2d2b949ff655e2c2db0ad`

The fingerprint covers tracked diffs only. The untracked inventory in §13 is
additionally required to identify this verified state.

### Precheck

```text
increments/01-preserve-wrapper-options.md
increments/02-compose-consumer-webpack-first.md

inc 01 checked boxes: 26
inc 02 checked boxes: 25
tasks.md checked rows: 2
```

Reviewable implementation progress exists.

## 1. Structural Validation

- Targeted: PASS — 1 item passed, 0 failed, `valid=true`.
- Repository-wide: PASS — 139/139 items passed; 132 specs and 7 changes.
- Repository-wide output contained only existing long-requirement INFO
  advisories, with no invalid item or collision affecting this change.

## 2. Registry Completion

```text
registry-lint: 0 error(s), 0 warning(s) — 2 registry row(s), 0 cross-cutting row(s)
```

| Row | State | Tick evidence | Result |
| --- | --- | --- | --- |
| 01 | `[x]` | `2026-07-19 05:00`; matching journal reorientation exists | PASS |
| 02 | `[x]` | `2026-07-19 05:11`; matching journal reorientation exists | PASS |

No open `gate:ops` or cross-cutting rows exist.

## 3. Per-Increment Completeness

| Increment | Mode | Steps | Decisions | Requirement | Gates | Delegate contract | Timing | Result |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| 01 | delegate/subagent | 26/26 | D1-D3 present | Envelope-authored modified wrapper requirement | Complete | Merged; orchestrator checklist complete | No inputs | PASS |
| 02 | delegate/subagent | 25/25 | D4-D5 present | Same envelope requirement covers diagnostic/composition | Complete | Merged; orchestrator checklist complete | `deps: 01` cleared before execution; no inputs | PASS |

No increment has zero progress, open gates, or an unmerged output contract.

## 4. Deferral Closure and Staleness

| ID | Final state | Disposition | Review-by status | Result |
| --- | --- | --- | --- | --- |
| DEF-1 | retired | Journal `2026-07-19 05:11`; external seam-audit token retained | Retired at 3/3; calendar date not breached | PASS |
| DEF-2 | retired | Same checkpoint; failure-policy token retained | Retired at 3/3; date not breached | PASS |
| DEF-3 | retired | Same checkpoint; fingerprint-review token retained | Retired at 3/3; date not breached | PASS |
| DEF-4 | retired | Same checkpoint; RepoWise refresh token retained | Retired at 3/3; date not breached | PASS |

No deferral was silently dropped or allowed to become stale.

## 5. Delta Spec Sync and Collision State

| Capability | Namespace | Sync state | Notes |
| --- | --- | --- | --- |
| `next-config-wrapper` | behavioral | Needs sync | Expected pre-archive: canonical spec still has the shorter diagnostic, narrower options scenario, and no alias requirement |

The MODIFIED-header collision query returned only this change's
`specs/next-config-wrapper/spec.md`. No archive-order coordination is needed.

## 6. Design/Spec Coherence

| Decision | Requirement/source correspondence | Result |
| --- | --- | --- |
| D1 | Complete-options scenario; source passes the original `options` object | PASS |
| D2 | Real exported wrapper and real plugin are exercised | PASS |
| D3 | Requirement and README use the curried API | PASS |
| D4 | Exact established missing-system diagnostic is specified and tested | PASS |
| D5 | Consumer hook executes first; plugin, loader, and CSS alias are added to its returned config | PASS |

No design/spec drift remains.

## 7. Implementation Completeness

- Increment 01: 26/26 checked.
- Increment 02: 25/25 checked.
- One authored requirement has four scenarios.
- No ticked zero-progress increment.
- Current source and focused tests cover the full modified requirement.

Result: PASS in the identified dirty working tree.

## 8. Front-Door Routing Leak Detector

Six ignored legacy Superpowers artifacts pre-exist under
`docs/superpowers/{specs,plans}/` for clippy verification,
cascade-round-trip, and RepoWise distillation. `git check-ignore` attributes
all six to `.gitignore:66` (`docs`). They are unrelated to this wrapper change.

Disposition: WARN; migrate or delete separately if still relevant.

## 9. Deferred Dogfood Equivalence

`rg -n '\[~\]'` returned no matches across the registry or increments.

Result: PASS; no deferred manual check requires an automated equivalent.

## 10. Spec Taxonomy and Leakage Lints

All three blocking lints returned empty:

```text
SHALL implementation-choice lint: empty
rationale-language lint: empty
Decision/Ledger reference lint: empty
```

The behavioral `withAnimus config wrapper` requirement is black-box exercised
for the diagnostic, replacement-config composition, plugin, loader, CSS alias,
returned identity, and complete options. This passes in the dirty tree; §13
records the shipping-tree packaging gap. No `arch-*` capability is authored.

## 11. Guardrail History and Fresh Change-End Run

| Guardrail | Scope | Fresh result |
| --- | --- | --- |
| G1 | `all` | PASS; `plugin.ts` has no diff |
| G2 | `footprint:packages/next-plugin/src/with-animus.ts` | PASS; whole-object constructor found, no copied-field allowlist |
| G3 | `inc:01` | PASS; obsolete two-argument README call absent |
| G4 | `all` | PASS; `f6f120b895f350f209739f1bda6b4e4ef8d65588063b600fb5ba2b26e271235e` |
| G5 | `change-end` | PASS; fresh aggregate run below |

All scope tokens belong to the closed set and `inc:01` names a real row.

```text
vp run verify:compile
All 9 package compile claims exited 0.

vp run verify:unit:ts
25 test files passed; 251 tests passed.

vp run @animus-ui/next-app#verify
Extracted 15/15 components.
1 CSS file, 16 JS files.
App and Pages routers present.
All assertions passed.
```

RepoWise omission `ac66ec3855f2` was expanded rather than rerunning. The only
owner warning was Next's existing multiple-lockfile workspace-root warning.
G2's initial false-positive trip is journaled at 04:37. Stale-dist
preparations were fail-loud prerequisite friction, not final invariant
failures.

## 12. Journal and Delegation Coherence

- G2 guardrail trip and row-02 spawn are journaled; no mode change occurred.
- Row 01 is envelope-licensed by the seed.
- Row 02 is preceded by an accepted objection, full reorientation, and spawn.
- K=1 full passes exist at 04:46 and 05:11, with all three stances and explicit
  dispositions/evidence-backed zeroes.
- The STOP-trip follow-up full pass exists.
- Both delegated output contracts and orchestrator merge checklists are
  complete, with no evidence of delegate writes to shared envelope artifacts.

WARN: row 02's qualifying event is typed as `objection`/`spawn`, not a literal
`signal` citing a DEF row. The journal explicitly disposes this as a decided
D4/D5 spawn with no DEF consumed. It is semantically licensed but a literal
§12 protocol variance.

## 13. Packaging and Change Boundary

### Dirty status

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
 M packages/extract/tests/canary.test.ts
 M packages/next-plugin/README.md
 M packages/next-plugin/src/with-animus.ts
?? openspec/changes/fail-loud-canary-fixture-discovery/
?? openspec/changes/harden-embedded-transform-integration/
?? openspec/changes/harden-selector-regression-oracles/
?? openspec/changes/preserve-next-plugin-options/
?? packages/next-plugin/tests/with-animus.test.ts
```

### Full untracked inventory

```text
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
packages/next-plugin/tests/with-animus.test.ts
```

### Reachability classification

| Untracked item | Tracked reference/config reachability | Classification | Severity/action |
| --- | --- | --- | --- |
| `packages/next-plugin/tests/with-animus.test.ts` | Yes — tracked `vite.config.ts:197` discovers `packages/next-plugin/tests` | Required regression test; correct locally but absent from shipping tree | **EVIDENCE-GAP**; land the test with implementation |
| `preserve-next-plugin-options/` | Not imported by product/test config; OpenSpec-owned target artifacts | Owned change artifacts | Must land before archive; dirty-tree postponement |
| `fail-loud-canary-fixture-discovery/` | No target dependency | Adjacent intentional separate OODA change | Split/land separately |
| `harden-embedded-transform-integration/` | No target dependency | Adjacent intentional separate OODA change | Split/land separately |
| `harden-selector-regression-oracles/` | No target dependency | Adjacent intentional separate OODA change | Split/land separately |

The test-config reachability gap is archive-blocking: this report claims a
regression test that CI cannot receive from the current shipping tree.

### Foreign tracked diffs

| Paths | Classification | Disposition |
| --- | --- | --- |
| `AGENTS.md` | Unrelated dirty / separate verification policy | Do not absorb |
| `openspec/specs/pipeline-integration-testing/spec.md`, `packages/_integration/CLAUDE.md`, integration tests/fixtures | Ambient drift owned by embedded-transform/selector work | Reconcile and split with adjacent owners |
| `packages/extract/crates/extract-v2/src/{analyze_css,cross_file,pipeline}.rs` | Protected pre-existing Rust drift | Preserve and reconcile separately |
| `packages/extract/tests/canary.test.ts` | Ambient drift owned by fail-loud change | Split |

`packages/next-plugin/README.md` and
`packages/next-plugin/src/with-animus.ts` are inside the target footprints.

## 14. Review-Finding Intake

| ID | Finding | Disposition | Evidence/follow-up |
| --- | --- | --- | --- |
| RF-1 | Initial missing-system spec string contradicted established source | Accepted | D4, amended scenario, characterization test |
| RF-2 | Initial hook-order scenario contradicted source; replacement lost plugin/rules | Accepted | D5 and increment 02 |
| RF-3 | G2 falsely matched loader-only `strict` option | Accepted | Guard narrowed; 04:37 trip |
| RF-4 | D5 named aliases while initial scenario/test omitted alias coverage | Accepted | Scenario, packet, CSS-alias assertion |
| RF-5 | Real-plugin test leaked process-global engine selection | Accepted | Before/after save/restore; clean re-review |
| RF-6 | G3 remained marked armed after row 01 | Accepted | Register updated; journal 05:07 |
| RF-7 | Whole-object forwarding exposes later caller mutation | Rejected | D1 intentionally removes shallow copy; no mutation contract |
| RF-8 | Hook-first prevents consumer inspection/removal of Animus additions | Rejected/intentional | D5 makes consumer result authoritative before required integration |
| RF-9 | New regression test is untracked but test-config reachable | Accepted — EVIDENCE-GAP | Land test and rerun conformance |
| RF-10 | Row-02 license lacks a literal DEF-backed `signal` event | Intentional, WARN | Objection/reorientation/spawn recorded; no DEF consumed |
| RF-11 | Ignored `docs/superpowers` artifacts remain | Deferred, unrelated WARN | Separate cleanup |

No review finding remains undispositioned.

## Implementation Evidence

| Command | Observation |
| --- | --- |
| Targeted and repo-wide OpenSpec validation | 1/1 and 139/139 passed |
| Registry lint | 0 errors, 0 warnings |
| Fresh G1-G4 | All passed; exact G4 hash matched |
| `vp run verify:compile` | All package compile claims passed |
| `vp run verify:unit:ts` | 25 files, 251 tests passed |
| `vp run @animus-ui/next-app#verify` | 15/15 extracted; CSS/JS/App/Pages assertions passed |

No deployment or production-observation evidence is claimed.

## Verdicts

- **Artifact verdict**: **FAIL** — archive-blocking EVIDENCE-GAP: the required
  wrapper regression test is untracked while tracked test configuration
  discovers its directory.
- **Implementation verdict**: **PASS** for the exact dirty working tree above.
- **Rollout verdict**: **n/a** — no deployment or operational rollout.
- **Archive decision**: **postpone archive**.

## Overall Decision

- [ ] PASS
- [ ] PASS WITH WARNINGS
- [x] **FAIL — reconcile the shipping-tree evidence gap and rerun verify**

Next steps:

1. Land the target source, README, regression test, and target OpenSpec
   artifacts as one coherent change.
2. Keep adjacent OODA directories and foreign tracked diffs out of that change.
3. Re-run aggregate verification on a clean tree at the landed SHA, or prove
   the recorded fingerprint plus complete untracked payload landed on the
   default branch.
4. Confirm mainline ancestry and rerun the MODIFIED-header collision check
   before archive.

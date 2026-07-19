# Retrospective: harden-embedded-transform-integration

> Written: 2026-07-19 (after verify passed with warnings)  
> Evidence is artifact and journal state. The journal is the primary temporal
> source; no commit-range claim is made.

---

## 0. Evidence

- **Increments**: 1/1 — mode split: 0 inline / 1 delegated
- **Tasks done**: 31/31 checked rows across the increment and registry
- **Capabilities touched**: 1 behavioral, 0 arch-*; **requirements authored**:
  1 modified requirement with five scenarios
- **Guardrails**: 5 registered / 0 trips (0 STOP, 0 WARN) / 0 promoted to
  specs/arch-* at archive; all five are change-specific rather than durable
  architectural constraints
- **Journal**: 5 entries — seed 1 · surprise 0 · friction 0 · signal 0 · trip
  0 · reorientation 1 · objection 3 · mode-change 0 · spawn 0
- **Deferral outcomes**: 0 resolved as predicted / 0 surprised / 0 retired
  stale; DEF-1 through DEF-4 remain explicitly carried by their external
  owner/signal tokens
- **Delegation outcomes**: 1 dispatched / 1 merged clean / 0 merge-rejected;
  the same independent reviewer converged to APPROVED after three accepted
  entropy objections
- **Files touched**: `packages/_integration/__tests__/extraction.test.ts`,
  `packages/_integration/__tests__/run-pipeline.ts`,
  `packages/_integration/fixtures/components/transforms.tsx`,
  `packages/_integration/CLAUDE.md`,
  `openspec/specs/pipeline-integration-testing/spec.md`, and this change's
  OODA artifact tree
- **New external dependencies**: none
- **OpenSpec validate state**: targeted strict pass; canonical capability
  strict pass; repository-wide 136/136 pass
- **Verdicts**: artifact PASS WITH WARNINGS · implementation PASS · rollout
  n/a · archive postponed for dirty/unmerged packaging conformance
- **Conformance**: `unmerged-implementation`; verified dirty patch fingerprint
  has not been shown to land on the default branch, so archive remains
  postponed
- **Test coverage signal**: focused RED 26/27 then GREEN 27/27; full
  integration 157/157 across 11 files
- **Active sessions / rough hours**: one orchestrated session with implementer
  and verifier/reviewer delegates; approximately 1.5 wall-clock hours

Increment summary:

| # | Increment | Mode | Resolved | Authored | Notes |
| --- | --- | --- | --- | --- | --- |
| 01 | prove embedded transform evaluation | delegate | D1-D5 | envelope §pipeline-integration-testing/Full pipeline end-to-end test | three review objections accepted; clean re-review |

---

## 1. Wins

- [evidence: increment 01 RED/GREEN] The new oracle failed exactly on the stale
  fixture (`flex-basis: 100`) and passed only after a real callback produced
  callback-specific `width: 8px`.
- [evidence: `packages/_integration/__tests__/run-pipeline.ts`] The shared
  helper now matches Vite and Next's production boundary: Rust-resolved CSS,
  then unit fallback.
- [evidence: journal objections at 02:50] Independent entropy review caught a
  contradiction strict OpenSpec validation could not: archive merges
  requirements but preserves canonical Purpose prose.
- [evidence: G5 and clean re-review] The accepted fix added a section-aware
  tripwire that survives Markdown wrapping and eliminated the final artifact
  inconsistency.
- [evidence: verify.md] Targeted, canonical, and portfolio validation, registry
  lint, formatting, integration, all STOP gates, and diff check converged.

## 2. Misses

- 🟡 [painful | evidence: RF-1 / first reviewer pass] The envelope initially
  assumed a requirement delta was sufficient even though the canonical Purpose
  was normative. Follow-up: carry the archive-merger limitation as a schema
  promotion candidate below.
- 📌 [nit | evidence: RF-2] D4's first amendment left old rationale and capsule
  wording behind. Follow-up: when a review changes ownership, search every D<n>
  mention before requesting re-review.
- 📌 [nit | evidence: RF-3] G5's first regex depended on single-line Markdown.
  Follow-up: promote section-aware prose checks to schema guidance.
- 🟡 [painful | evidence: verify §13] The mixed dirty worktree prevents archive
  even though implementation and artifacts pass. Follow-up: land or split the
  change-owned state without absorbing the pre-existing AGENTS, cascade, or
  Rust increments, then rerun conformance verification.
- 📌 [nit | evidence: verify §8] Six ignored front-door drafts remain for other
  work. This change removed its own two redundant drafts; their owners retain
  the remaining cleanup.

There is no 🔴 blocking implementation or evidence miss.

## 3. Plan Deviations

| Increment / row | What changed | Journal trace | Why |
| --- | --- | --- | --- |
| 01 | Expanded from delta-only capability correction to a direct canonical Purpose edit plus G5 | 2026-07-19 02:50 · objection and reorientation | Installed OpenSpec archive logic preserves Purpose while replacing requirement blocks |
| 01 | Tightened G5 from line-anchored to section-aware matching | 2026-07-19 02:50 · objection and reorientation | Reviewer proved Markdown wrapping could false-pass the first gate |

No spawn or mode change was needed; the same delegated row and reviewer owned
the expanded evidence work.

## 4. Skill / Workflow Compliance

| Skill / workflow | Used |
| --- | --- |
| superpowers:brainstorming | ✓ — existing audit and live-probe evidence was captured into `brainstorm.md` |
| superpowers:writing-plans (per increment) | ✓ — reapplied after compaction; cold-start packet authored under `increments/` |
| superpowers:executing-plans | N/A — delegate mode used the subagent-driven path |
| superpowers:test-driven-development | ✓ — focused RED preceded fixture GREEN |
| superpowers:subagent-driven-development | ✓ — bounded implementer plus independent reviewer/verifier |
| OpenSpec propose/apply OODA workflow | ✓ — envelope, registry, journal, increment, verify, and retrospective completed without VCS mutation |

### Deliberately Skipped Skills

None. `executing-plans` was not a skipped obligation; the registry selected the
mutually exclusive delegated execution path.

## 5. Surprises (Journal Triage)

The journal contains no `surprise` entries. The archive-merger finding arrived
as an independent review objection and is correctly triaged through three
`objection` entries rather than reclassified from memory here.

Unlogged surprises discovered now: none.

## 6. Promote Candidates → Long-Term Learning

Prior unchecked candidate dispositions relevant to this cycle:

- `restore-spec-tree-integrity`'s guardrail-calibration candidate is now
  represented in the OODA schema and was applied here; G1-G5 all had a
  registered baseline or explicit pre-fix transition. Do not carry it again.
- `simplify-verification-graph`'s taxonomy-lint timing candidate is now a
  blocking OODA verify step and was run before closure. Do not carry it again.

New candidates:

- [ ] 🟡 **A MODIFIED requirement does not update a capability's normative
  Purpose** → **Promote to** OODA schema

  > **Why**: The installed archive merger replaces requirement blocks and
  > preserves the preamble; strict validation cannot detect a semantic
  > contradiction between the two.
  > **How to apply**: In specs/verify instructions, require a Purpose-impact
  > check for MODIFIED/REMOVED requirements and an explicit canonical Purpose
  > edit when the preamble is normative and must change.

- [ ] 📌 **Executable checks over Markdown prose must isolate the semantic
  section before matching content** → **Promote to** OODA schema

  > **Why**: A line-anchored G5 passed current formatting but would silently
  > weaken after ordinary Markdown wrapping.
  > **How to apply**: Guardrail registration examples should extract bounded
  > sections (for example Purpose through Requirements) before `rg`, and
  > calibration should include a wrapped positive fixture when practical.

No G1-G5 row is a durable `specs-arch` candidate: each protects this change's
temporary footprint or sync operation, and the lasting behavioral contract is
already in `pipeline-integration-testing`.

The four deferred decisions remain owned outside this change:

- DEF-1: v2 transform diagnostics after
  `external:v2-transform-diagnostics-contract`
- DEF-2: resolver removal after `external:placeholder-zero-reachability-proof`
- DEF-3: broader fixture audit after
  `external:integration-oracle-defect-evidence`
- DEF-4: RepoWise heuristic tuning after
  `external:repowise-false-positive-measurement`

> Archive remains postponed. Before any future archive attempt, rerun verify
> against a clean conforming tree or prove the recorded change-owned patch has
> landed without the adjacent dirty increments.

---

## 2026-07-19 11:37 EDT update — downstream parity owner repaired

> This append-only update supersedes the quantitative outcome and verification
> state above. It does not rewrite row 01's then-accurate retrospective. The
> newest verification report covers completed row 02 and is the archive gate.

### Updated quantitative outcomes

- **Increments**: 2 planned / 2 completed; 2 delegated executions / 2
  independently reviewed clean after bounded repair cycles.
- **Decisions**: D1-D6; DEF-5 resolved to D6 on its exact signal. DEF-1 through
  DEF-4 remain externally owned and were explicitly retained.
- **Guardrails**: 11 registered; one honest STOP at G8; zero waived trips; all
  11 GREEN at final verification.
- **Journal**: 1 seed · 4 objections · 4 reorientations · 2 surprises · 1
  signal · 1 spawn · 1 guardrail trip · 1 friction · 0 mode changes.
- **Owner evidence**: TypeScript units 266/266; parity 48/48 in production and
  48/48 in development with seam 14/14; integration 157/157.
- **OpenSpec evidence**: targeted 1/1 and portfolio 149/149 strict-valid;
  registry 0 errors / 0 warnings.
- **Verdicts**: artifact PASS WITH WARNINGS · implementation PASS · rollout
  n/a · archive postponed for mixed dirty/unmerged conformance.

### What changed after the original retrospective

- 🟡 **Miss — owner-map omission**: row 01 changed a fixture that the parity
  corpus enumerates, but its verification stopped at the integration owner
  claim. A later unrelated mapped run exposed the committed pair at 47/48 in
  both modes. Row 02 now makes the checked intent, exact atomic pair refresh,
  parity, and integration one coherent completion claim.
- 🟢 **Win — failure attribution stayed exact**: the pre-repair diagnostic
  isolated all behavioral divergence to `integration/transforms.tsx`; the
  other 47 units, fresh-process self-check, and seam battery remained exact.
  That evidence prevented the system-loader refactor from absorbing an older
  fixture owner's responsibility.
- 🟡 **Surprise — raw code comments are stored even when parity treats them as
  AST-equivalent**: the atomic refresh also resnapshotted two independently
  reviewed selector-fixture comment corrections. G8 stopped before G9, then
  six normalized comparisons bounded the exception to those two code strings
  while protecting every non-code selector surface and every other unit.
- 🟢 **Win — no silent waiver**: the register returned to `[]`; the checked
  intent remains durable; exact source and foreign hashes stayed fixed; the
  same reviewer accepted the repaired packet labels before Phase 2.

### Updated deviations and finding intake

| Item | Disposition |
| --- | --- |
| RF-4: parity-enumerated integration fixture lacked a parity owner claim | accepted → NS5, DEF-5/D6, row 02, parity + integration GREEN |
| RF-5: original G8 overclaimed transform-only raw envelope drift | accepted after STOP → six normalized comparisons and exact selector-source attribution |
| RF-6: packet prose still described transform-only scope | accepted → four labels repaired; same-reviewer re-review clean |
| DEF-1 through DEF-4 review cadence consumed by oracle mechanics | retained with exact owners/signals; review-by extended from 3 to 6 reorientations, date unchanged |

### New promote candidates

- [ ] 🟡 **A parity-enumerated integration fixture needs both parity and
  integration owner claims** → **Promote to** root verification change map

  > **Why**: the current map names `packages/_integration/__tests__/**` but not
  > `packages/_integration/fixtures/**`; row 01 therefore followed the written
  > surface while leaving a committed downstream oracle stale.
  > **How to apply**: after a dedicated map review, add the fixture surface with
  > `verify:parity` followed by `verify:integration`, preserving fail-loud NAPI
  > prerequisites and avoiding speculative broad-suite ownership.

- [ ] 📌 **Generated parity envelopes may absorb comparator-equivalent raw
  code changes** → **Keep local until recurrence**

  > **Why**: this was the first observed comment-only resnapshot. Exact
  > normalized gates and source hashes were sufficient; a durable policy would
  > be premature without a second occurrence or a comparator/storage contract
  > decision.

### Final learning

Changing a behavioral fixture is not complete at its nearest test suite when
another committed oracle inventories that fixture's source and outputs. Trace
the fixture through corpus discovery before selecting the owner claim, and let
an exact STOP expand the evidence boundary without transferring ownership to
the increment that happened to discover the stale oracle.

The newest verification report is non-FAIL. Archive remains postponed until
the change-owned state is landed or reverified in a clean conforming tree.

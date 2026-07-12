# Retrospective — restore-spec-tree-integrity

## §0 Evidence

- **Increments**: 3 completed / 4 registry rows; modes 3 inline / 0 delegated (row 04 lazy, carried forward — never created, signal never fired). One subagent engagement: inc 02's adversarial *review* (not implementation).
- **Tasks done**: 34 ticked plan steps across 3 increment files + 3 registry rows + 1 cross-cutting row.
- **Capabilities touched**: 2 authored as deltas — `arch-spec-corpus` (arch-*, first inhabitant of the namespace, 2 requirements / 3 scenarios) and `prop-strict-mode` (behavioral, 4 requirements, verbatim backfill). Main tree: 78 spec files repaired in place (+463/−126 lines).
- **Requirements authored**: 6 into the change delta tree; 0 invented in the main tree (one disclosed restatement-scenario, see §5).
- **Guardrails**: 3 registered (G1/G2/G3) / 0 tripped / 0 promoted as Register rows at archive — the durable invariants were instead authored directly as `arch-spec-corpus` requirements during the change (see §6 determination).
- **Journal**: 3 signal, 4 surprise, 2 friction, 4 objection, 3 reorientation, 0 guardrail-trip, 0 mode-change, 0 spawn.
- **Deferral outcomes** (journal signals vs Ledger predictions): edge-case-handling resolved exactly by its named signal (inventory.json — as predicted); invalid-residue signal appeared as predicted (residual report); validate-gate signal did NOT appear (3 residue specs) — deferral carried with its artifacts, not silently dropped.
- **Delegation outcomes**: 1 review dispatched / merged clean (verdict PROCEED-WITH-FIXES; 4 objections, 4 applied). Reviewer disclosed one tool-defect-triggered side effect, restored it deterministically.
- **Files touched**: 78 main-tree specs; change-dir artifacts (design/tasks/journal/verify/3 increments/2 delta specs); tools (canonicalize.ts + tests + inventory.json + inventory.dry.json guard + residual-failures.txt + g1-before.txt); archive dir rename (`prop-strict-mode` → `2026-03-29-prop-strict-mode`, content byte-identical).
- **New external dependencies**: none.
- **Validate state**: 37/116 specs → 113/116 specs (114/118 items). Blocking taxonomy lints: empty (independently re-verified).
- **Test coverage signal**: 9 unit tests on the canonicalizer transform (red-green throughout; idempotency reviewer-verified).
- **Sessions/hours**: 1 session, ≈1 hour wall-clock including review.

## §1 Wins

- 76-spec mechanical repair with corpus-wide text preservation, verified independently: requirement-header sets identical HEAD→worktree except 4 intentional REMOVED drops; WHEN-bullet counts identical except one disclosed addition (reviewer evidence, inc 02 review).
- The classifier-vs-validator cross-check (45 "canonical" vs 37 passing) caught a real blind spot before any write ran — inc 01's dry-run-first design paid for itself (journal 04:15).
- Adversarial review earned its cost: 4 accepted objections, 2 of them load-bearing for the follow-up change (inventory clobber, incomplete loss record) — found by an agent that did NOT implement the work (journal 04:30–04:32).
- The two authored arch requirements pass their executable scenarios non-vacuously right now (verify §10 samples).
- `prop-strict-mode`: a shipped-but-unspecified capability got its contract back with zero new authorship (verbatim delta copy, inc 03).

## §2 Misses

- 🟡 G1's check command was authored into design.md in a form that matches zero files (`--glob '*/spec.md'` anchoring) — a guardrail that could never run as written. Caught during execution and independently by review, but it shipped in the envelope. Follow-up: prevention item in §6.
- 🟡 `canonicalize.ts` originally clobbered `inventory.json` on any dry-run — the preserved triage artifact for the follow-up change died on re-run. Found only when the reviewer triggered it (verify §12). Fixed (dry-runs → `inventory.dry.json`).
- 📌 Journal capture miss: the inc-02 friction entry claimed all scenario names were "synthesized from existing WHEN text"; one scenario (Plugin parity) had no source WHEN text and was authored. Corrected via objection entry + disclosure in residual-failures.txt (the journal failed its job until the reviewer diffed the claim against HEAD).
- 📌 The change-dir tool has no tsconfig, so IDE diagnostics flag `node:fs`/`import.meta` types. Harmless (bun executes it; not on any package compile surface) — left as-is for one-shot archived tooling.

## §3 Plan deviations

| Deviation | Journal trace |
|---|---|
| 4 edge-case tool rules added beyond the planned parser (Purpose-required classify, title-section hoisting, preamble-prose preservation, +4 tests) | surprise 04:15, 04:16 |
| 3 hand edits in inc 02 (prop-system inline-REMOVED, theme-composition SHALL wording, includes-driven-discovery dialect conversion) vs "tool-only" plan | surprise 04:21, friction 04:22 |
| G1 gate command corrected mid-flight (`**/spec.md`) | objection 04:30 (first) |
| Row 04 carried forward instead of executed | signal 04:23 + reorientation 04:25 Decide |
| Inc 03 executed while inc 02's review ran in background (disjoint footprints, permitted by registry rule) | reorientation 04:25 Observe/Decide |

No untraced deviations.

## §4 Skill / workflow compliance

- `superpowers:brainstorming` — ✓ invoked at envelope; adapted for an autonomous session (no user dialogue available; questions self-answered from exploration evidence and recorded in brainstorm.md). The skill's user-approval gates could not run — the proposal artifacts served as the user-review surface instead.
- `superpowers:writing-plans` — ✓ invoked; 3 increment plans with complete code, exact commands, expected outputs; self-review run.
- `superpowers:executing-plans` — partial: plans were executed inline step-by-step with red-green discipline, but the skill itself was not formally invoked (single-session inline execution; the increment files served as the plan tracker). No harm observed; see §6 prevention note.
- `superpowers:test-driven-development` — ✓ for the canonicalizer (failing tests written and observed red before implementation, twice).
- `superpowers:dispatching-parallel-agents` / `subagent-driven-development` — n/a for implementation (no delegate rows); one review subagent dispatched per the registry's review:subagent assignment.

**Deliberately Skipped Skills**: `executing-plans` formal invocation — trigger: inline mode in a single continuous session where the increment file already carries the checklist; prevention: none needed beyond this note (the schema's own checklists supplied the discipline the skill enforces). Repeat-skip with same rationale is acceptable for inline-mode increments.

## §5 Surprises (triage of journal `surprise` entries)

- 04:15 (classifier vs validator mismatch) — **confirmed**: real dialect population; became D6 rule 1.
- 04:16 (title-section + preamble dialects) — **confirmed**: became D6 rules 2–3; 4 regression tests pin the behavior.
- 04:16 (REQ-n dialect, population 1) — **confirmed**: hand-edit disposition was right; no handler written.
- 04:21 (fourth dialect: inline `### REMOVED —` markers) — **confirmed and contextualized**: found only *after* the write because the validator's parser counts it as a requirement while the tool's parser folds it into the previous body — two parsers, two grammars. The generalizable lesson is §6's "validator-grammar parity" item.
- Not journaled at the time but surfaced by review (capture miss, logged in §2): the authored Plugin parity scenario.

## §6 Promote candidates → long-term learning

- [x] 🟡 rg slash-containing globs are anchored (`--glob '*/x'` matches nothing from a root; use `**/x`) — bit the same change twice (baseline capture + authored guardrail). → **Promote to** memory. *(done this session: `rg-glob-anchoring` memory)*
  > **Why**: A guardrail whose check silently matches zero files reports success while checking nothing — worst failure mode a gate can have.
  > **How to apply**: When authoring any rg-based check that includes a `/`, use `**/` prefixes and test the command returns non-zero matches on known-positive input before recording it as a gate.
- [ ] 🟡 Guardrail checks must be executed once against known-positive input at envelope time (non-vacuity proof), not first executed at gate time. → **Promote to** schema (superpowers-ooda Guardrail Register instruction: add a "verified non-vacuous at registration" column or precheck).
  > **Why**: G1 shipped unexecutable; only the corrected form ever ran.
  > **How to apply**: At design.md authoring, run each Register check once where it MUST match (e.g. against HEAD state) and record the count.
- [ ] 📌 Tools that repair a corpus should never share an output path between dry-run and write modes. → **Promote to** one-off (fixed in this tool; generalization low-value).
  > **Why**: The preserved triage artifact died on any re-run until guarded.
  > **How to apply**: n/a — fixed; noted for future one-shot tools.
- [ ] 🟡 When two parsers read the same grammar (tool vs validator), diff their outputs per file before writing — "validator-grammar parity" — rather than trusting classification counts alone. → **Promote to** one-off boundary (relevant to the follow-up content-triage change if it grows tooling).
  > **Why**: The inline-REMOVED dialect passed the tool's parse and failed the validator's, surfacing only post-write.
  > **How to apply**: In the follow-up change, add a per-file "tool requirement count == `openspec show --json` requirement count" assertion to any spec-mutating tool.
- [ ] 🔴 Follow-up change (content-triage) is the designated owner of: 3 invalid residue specs, 76-file boilerplate-Purpose worklist, taxonomy migration of 118 impl-leak hits, carried row 04 (validate-gate wiring once green). Artifacts: tools/residual-failures.txt, tools/inventory.json. → **Promote to** the follow-up change proposal (openspec).
  > **Why**: Everything this change deliberately did not judge is enumerated there; losing that thread re-hides the rot behind valid wrappers (the heretic's warning).
  > **How to apply**: Create the follow-up change with residual-failures.txt as its exploration input; its first envelope decision is the gate-wiring location (vp task vs CI vs hygiene).

**Guardrail promotion determination (apply step 5)**: no Register row is promoted as-is — G1/G2/G3 are change-scoped procedures whose durable content (no delta headers; canonical structure) was already authored as `arch-spec-corpus` delta requirements during inc 01/02. Promoting them again would duplicate the spec tree.

**Prior-cycle carryovers**: none exist — all archived changes predate this schema (no retrospective.md in any archive dir).

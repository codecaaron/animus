# Journal: restore-spec-tree-integrity

### 2026-07-07 04:09 · envelope · signal
Exploration completed with full failure classification (37/79/116 counts, two failure shapes, provenance commit identified) → envelope artifacts authored; inc 01 creatable immediately (its enabling inventory work is its own content).

### 2026-07-07 04:15 · inc 01 · surprise
Classifier v1 counted 45 canonical vs 37 validator-passing — 8 files carry `## Requirements` without `## Purpose` → classify tightened to require both; these files now repairable.

### 2026-07-07 04:16 · inc 01 · surprise
Third authoring dialect found: ~11 files hold requirements inside a `## <Name> Specification` title section; 18 files carry h1+prose preambles the v1 tool would have dropped → hoisting + prose-preservation rules added, 4 new fixture tests.

### 2026-07-07 04:16 · inc 01 · surprise
`includes-driven-discovery` uses `### REQ-n:` + `**Scenarios:**` (population: 1) → hand edit in inc 02 (NS3 exception, journaled); `content-migration` is a prose design doc → triage residue.

### 2026-07-07 04:18 · inc 01 · signal
Inventory report exists (tools/inventory.json; 37/40/37/2 classification, sum 116) → edge-case-handling Ledger row resolved as D6; inc 02 creatable (file already authored — execution licensed).

### 2026-07-07 04:18 · inc 01 · reorientation
- Observe: 3 surprises (all inventory-driven, all absorbed as tool rules); gate G3 pass (spec-side totals unchanged, 37/79); no [~] deferrals; 9/9 unit tests green; tree untouched.
- Orient: outcome vs Ledger — edge-case row resolved exactly by its named signal, no drift. NS1 intact (pass-count unchanged in dry-run). NS2 intact (rules preserve text; the only synthesized prose is Purpose derivation, accepted by D3/D6). NS3 strengthened (hand-edit population capped at 1 file). Lazy row 04 at 0/3 staleness. Stances (full pass, review:self): falsifier — no requirements authored this increment, nothing to falsify; the arch-spec-corpus delta-header check would currently fail against the tree, which is the expected pre-inc-02 state, zero objections with that evidence. entropy auditor — leakage lints on change specs/ all empty (3× rg, zero hits); edge-case row resolved WITH signal present; row 02/03 modes still match decision density, zero objections. heretic — argued merging inc 02+03 into one increment (both are tool applications); rejected: disjoint footprints and different guardrail profiles (G1/G3 vs G2/G3) justify separate gates.
- Decide: continue — run inc 02 next, inc 03 after (order preserves the single-writer footprint discipline; no spawns needed).
- Act: D6 promoted into §Decisions; Ledger row flipped to resolved; registry row 01 ticked; no NS revisions.

### 2026-07-07 04:21 · inc 02 · surprise
Fourth dialect found post-write: inline removal markers (`### REMOVED — Requirement:` nested inside `## ADDED Requirements`), population 1 (prop-system) → hand edit dropped the block (removal applied as the delta intended); validator's 0-based indices also masked it during first diagnosis.

### 2026-07-07 04:22 · inc 02 · friction
Three NS3 hand-edit exceptions this increment, each journaled per design: prop-system (inline-REMOVED block applied+dropped), theme-composition (`Selective composition via spreading` reworded to carry SHALL — system-side obligation made explicit, consumer MAY retained), includes-driven-discovery (REQ-n + **Scenarios:** dialect converted to canonical form; present-tense contract statements strengthened to SHALL; scenario names synthesized from existing WHEN text).

### 2026-07-07 04:23 · inc 02 · signal
Post-write validate: 114 passed / 4 failed (118 items); spec-side 113/116 — residual-failures.txt exists with per-file annotations → resolving signal for the invalid-residue follow-up row (Ledger) has APPEARED; inc 04's signal ("validate --all passes clean") did NOT appear — 3 content-residue specs + 1 proposal-stage change still fail.

### 2026-07-07 04:25 · inc 03 · reorientation
- Observe: inc 03 steps 4/4 done; gates G2 (0 modified archive lines) and G3 (totals stable 114/4) pass; no [~] deferrals; no new surprises during 03 itself.
- Orient: outcome vs Ledger — decided-now work (D5), no predictions to diff. NS1 intact (114 ≥ 113). NS2 intact (delta copied verbatim). NS3 intact (cp + mv, no hand edits). Lazy row 04 staleness 1/3 (signal checked this landing: NOT fired). Stances: entropy auditor alone (off-beat) — leakage lints on change specs/ incl. new prop-strict-mode delta: all three empty; no deferral resolved without signal; row modes unchanged. Zero objections because lints verified empty and gates recorded with output.
- Decide: continue — hold row 02 untick pending subagent full-pass review merge; inc 04 signal not fired, row stays lazy; residue disposition already routed to follow-up change per design.
- Act: registry row 03 ticked; no Ledger flips (none owned); no NS revisions.

### 2026-07-07 04:30 · inc 02 · objection
Falsifier (via inc 02 reviewer subagent): G1 check as written in design.md (`--glob '*/spec.md'`) matches zero files under rg 14 — the scripted gate could never pass legitimately. Disposition: ACCEPTED → design.md Register command corrected to `**/spec.md` with a correction note; executed gates had already used the corrected form with results recorded.

### 2026-07-07 04:30 · inc 02 · objection
Falsifier (via inc 02 reviewer subagent): canonicalize.ts wrote inventory.json unconditionally, so any dry-run re-run destroys the preserved triage artifact (reviewer triggered this and restored the file; restoration verified 37/40/37/2 + anomalies intact). Disposition: ACCEPTED → dry-runs now write inventory.dry.json; only --write produces inventory.json; unit tests still 9/9.

### 2026-07-07 04:30 · inc 02 · objection
Falsifier (via inc 02 reviewer subagent): the hand-dropped prop-system removal ('Responsive array syntax') was journaled but missing from inventory.json's removed record, leaving D2's loss-recording incomplete for triage consumers. Disposition: ACCEPTED → appended to inventory.json prop-system.removed and annotated in residual-failures.txt.

### 2026-07-07 04:30 · inc 02 · objection
Entropy auditor (via inc 02 reviewer subagent): includes-driven-discovery's 'Plugin parity' scenario was AUTHORED (no WHEN text existed at HEAD), contradicting the inc-02 friction entry's claim that scenario names were synthesized from existing WHEN text — an undisclosed NS2 exception. Disposition: ACCEPTED → this entry corrects the record: the scenario is a WHEN/THEN restatement of the requirement's own sentence, authored during conversion; disclosed in residual-failures.txt; NS2's provisional-revisit condition is now formally met (shipped behavior with no written test contract was encountered and one restatement-scenario was authored rather than left invalid).

### 2026-07-07 04:32 · inc 02 · friction
Reviewer side-effect: the review itself triggered the inventory-clobber defect (dry-run overwrote inventory.json) and restored it deterministically from HEAD content via git archive to scratchpad → defect confirmed real by accident; fix (objection 2) is load-bearing for the follow-up change's worklist, not cosmetic.

### 2026-07-07 04:35 · inc 02 · reorientation
- Observe: entries since last checkpoint — 4 objections (all accepted, all fixed), 1 friction; gates G1 (corrected form: before-set ⊆ after-set, sole addition = journaled dialect conversion) and G3 (114 ≥ 38, monotone at every step) pass; no [~] deferrals; heretic's core attack (boilerplate Purpose launders rot) answered by the greppable worklist: `rg -l '^Requirements for the \`' openspec/specs/` → 76 files, recorded in residual-failures.txt.
- Orient: outcome vs Ledger — inc 02 produced exactly the promised residual report; the invalid-residue row's signal APPEARED (see 04:23 signal entry), row remains owned by the follow-up change. NS1 held (37→113 spec-side, never decreased). NS2 held with one disclosed exception (Plugin parity scenario — objection 4; the provisional revisit condition fired and is recorded). NS3 held (3 hand edits, all journaled; population-of-one dialects stayed hand-edited per D6). Lazy row 04 staleness 2/3 — signal still not fired, carry-forward already recorded. Stances: FULL PASS via reviewer subagent (review:subagent per registry row) — falsifier 3 objections, entropy auditor 1 objection + verbatim-empty lints, heretic zero-concrete-change verdict with two extracted actions (both = objections 2/3, applied). Verdict: PROCEED-WITH-FIXES; all 4 fixes applied before this tick.
- Decide: continue — tick row 02; proceed to verify artifact; content-triage follow-up change inherits: residual-failures.txt (3 invalid specs + worklist pointer + disclosures), inventory.json (now overwrite-safe), and carried row 04 (gate wiring).
- Act: registry row 02 ticked; design.md G1 command corrected; no NS revisions (NS2's exception recorded, criterion retained — the disclosure mechanism worked).

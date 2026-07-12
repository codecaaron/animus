# Verification Report(s)

> Produced after apply completes, to confirm the implementation matches
> specs / design / registry / increments / journal. Failed checks must be
> fixed in the corresponding artifact, then re-run verify. Evidence is
> artifact + journal state — this schema mutates no version control; the
> tree-identity line below is read-only evidence.
>
> This file may hold MULTIPLE reports, newest LAST, each self-contained
> under a `## Report:` header. A verifier re-running replaces their OWN
> report; a different verifier APPENDS — never overwrite another verifier's
> report. Completion = the NEWEST report's Overall Decision is not FAIL.
> Where another agent/session is available, the verifier is NOT the
> implementer; under degraded topology self-verify is allowed — note it.
>
> Severity vocabulary: FAIL (artifact wrong) · EVIDENCE-GAP (the record
> cannot be trusted as-is — blocks archive until recorded or reconciled) ·
> WARN (process debt or drift — noted, never blocks). Do not launder
> evidence gaps as warnings.

## Report: <verifier> · <YYYY-MM-DD HH:mm>

**Change**: `<change-name>`
**Verified at**: `YYYY-MM-DD HH:mm`
**Verifier**: `<who / which agent — not the implementer where possible>`
**Tree identity** (read-only; consumed by archive's conformance check):
`<branch>` @ `<git rev-parse --short HEAD>`
**Dirty state**: clean / dirty — if dirty: `git status --short` inventory
below (§13) + patch fingerprint `git diff --binary | shasum -a 256` =
`<hash or n/a>` (archive requires this exact patch to land, or a clean tree
at the recorded SHA)

---

## 1. Structural Validation

- [ ] TARGETED (hard gate): `openspec validate <change-name> --json` reports
      `"valid": true`
- [ ] Repo-wide (context): `openspec validate --all --json` run and
      reported; failures in UNRELATED open changes classified as warnings
      unless they collide with this change's specs or archive path

**Result:**

```text
<targeted output; repo-wide summary with unrelated failures classified>
```

| Item | Type | Issues | Blocks this change? |
|---|---|---|---|
| — | — | — | yes / no (unrelated open change) |

---

## 2. Registry Completion (`tasks.md`)

- [ ] Registry lint clean:
      `node <schema-dir>/scripts/registry-lint.mjs openspec/changes/<change-name>`
      (lint ERRORs = EVIDENCE-GAPs; paste output below)
- [ ] Every registry / cross-cutting line is `- [x]` (retired lazy rows —
      `(retired — journal <ts>)` with a reorientation citing the blocker —
      are valid completion, not skipped work)
- [ ] Every ticked line carries `· ticked: <ts>` and the cited journal entry
      EXISTS (missing/dangling = EVIDENCE-GAP: tick asserted, not evidenced)
- [ ] Open `gate:ops` lines (if any) have their external steps recorded as
      OPS-<n> rows in ops-runbook.md (then they do not block archive)

```text
<registry-lint output>
```

**Incomplete / unevidenced lines (if any):**

| Line | Reason incomplete / tick evidence gap | Blocks archive? |
|---|---|---|
| — | — | — |

---

## 3. Per-Increment Completeness

| Increment | Mode | Steps done | Ledger rows flipped? | Requirements in specs/? | Gate complete? | Output contract merged? (delegate) | Inputs timing OK? | Complete? |
|---|---|---|---|---|---|---|---|---|
| 01-<slug> | inline | x/y | DEF-n ✓/✗ | §cap/Req ✓/✗ | ✓/✗ | n/a | ✓/✗/n-a | ✅/❌ |
| — | — | — | — | — | — | — | — | — |

> Open steps, an unresolved claimed decision, a missing authored requirement,
> an incomplete gate, or an unmerged output contract = incomplete.
> "Inputs timing": no packet file predates the tick of any `inputs:` row on
> its registry line. Mode-changed (delegate→inline) rows must follow the
> degraded-topology shape: orchestrator-filled output contract + hygiene note
> in the packet header.

---

## 4. Deferral Closure & Staleness (Decision Ledger)

Every Ledger row (DEF-<n>) is resolved by a completed increment (promotion
recorded `→ D<m>`), or explicitly carried forward (named lazy row, or
recorded in the retrospective as out of scope). No row breached its
Review-by — either denomination: reorientation count OR calendar date —
without a reorientation disposing of it.

| ID | Decision | Status now | Resolved by / carried to | Review-by breached? | OK? |
|---|---|---|---|---|---|
| DEF-1 | — | resolved → D<m> / deferred / retired | <inc NN / follow-up> | yes/no (count or date) | ✅/❌ |

---

## 5. Delta Spec Sync State

| Capability | Namespace (behavioral / arch) | Sync state | Notes |
|---|---|---|---|
| — | — | ✓ synced / ✗ needs sync / N/A | — |

Portfolio collision re-check (warning): for each MODIFIED/REMOVED/RENAMED
header in this change, `rg -l '### Requirement: <header>' openspec/changes/*/specs/`
must hit only THIS change. A hit in another open change = collision — record
the archive-order coordination or convert the delta (specs instruction).

| Header (MODIFIED/REMOVED/RENAMED) | Other open changes touching it | Coordination |
|---|---|---|
| — | none / <change names> | — / archive-order agreed (both Ledgers) |

---

## 6. Design / Specs Coherence Spot Check

| Sampled item | design says | specs match | Gap |
|---|---|---|---|
| — | — | — | — |

**Drift warnings (non-blocking):** <list or "none">

---

## 7. Implementation Completeness

- [ ] No increment file has zero progress while its registry row is ticked
- [ ] Every authored requirement has at least one `#### Scenario:`

**Contradictions / gaps:** <list or "none">

---

## 8. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md 2>/dev/null
ls docs/superpowers/plans/*.md 2>/dev/null
```

- [ ] No files, or existing files are legitimate pre-install leftovers

| File | Content already captured in change? | Suggested action |
|---|---|---|
| — | — | — |

---

## 9. Deferred Dogfood vs Automated-Test Equivalence

For each increment step marked `[~]`, the equivalent automated test whose
assertions are a superset of the manual check's. No equivalent → real gap →
retrospective Misses with a follow-up. Blank = PASS only if no `[~]` exists
anywhere; `[~]` rows with this section empty = FAIL.

| Deferred check (increment §) | Equivalent automated test | Coverage assessment | Real gap? |
|---|---|---|---|
| — | — | — | — |

---

## 10. Spec Taxonomy & Leakage Lint (BLOCKING)

All three commands must return empty:

```bash
rg -n 'SHALL (use|adopt|leverage|be implemented (with|using|in))' specs/ --glob '!arch-*/**'
rg -in '\b(because|as decided|we chose|per the design)\b' specs/
rg -n '\bD[0-9]+\b|[Dd]ecision [Ll]edger' specs/
```

- [ ] Lint 1 (implementation-choice language outside arch-*): empty, OR
      every match dispositioned in the table below
- [ ] Lint 2 (rationale language anywhere in specs/): empty
- [ ] Lint 3 (Ledger cross-references anywhere in specs/): empty

**Lint output (if any):**

```text
<paste>
```

Lint-1 dispositions (dependency cross-check: object of use/adopt/leverage vs
declared dependency names, e.g. `jq -r '.dependencies,.devDependencies |
keys[]' package.json` — a dependency/technology object is a FAIL; a domain
object is a recorded false positive):

| Match (file:line) | Object of "use" | Cross-check result | Disposition |
|---|---|---|---|
| — | — | not a declared dependency / MATCHES `<dep>` | false positive / ❌ FAIL |

Admission-test samples (>= 1 per namespace present):

| Sampled requirement | Namespace | Test applied | Passes? |
|---|---|---|---|
| §<cap>/<Req> | behavioral | black-box: verifiable without reading source | ✅/❌ |
| §arch-<domain>/<Req> | architectural | scenario THEN names an executable check | ✅/❌ |

---

## 11. Guardrail Gate History (BLOCKING)

For each ticked registry row: its increment's gate section is complete, and
every STOP-severity check passed on its final run. Every failure has a journal
`guardrail-trip` entry. A ticked row with an unrun or failed STOP gate is a
contradiction → FAIL.

| Increment | In-scope guardrails | Final gate result | Trips journaled? | OK? |
|---|---|---|---|---|
| — | G<n>,… | pass / TRIP(G<n>) | yes/no/n-a | ✅/❌ |

Scope-token validity + change-end runs:

- [ ] Every Register row's Scope parses against the closed set (all /
      footprint:<glob> / inc:<NN,…> naming real registry rows / change-end)
- [ ] Every `change-end`-scoped check was RUN NOW; results recorded below

| Guardrail | Scope token valid? | change-end result (if applicable) |
|---|---|---|
| — | ✓/✗ | pass / TRIP + excerpt / n-a |

---

## 12. Journal & Delegation Coherence

Reconciliation (warnings unless noted):

- [ ] Every guardrail-trip / spawn / mode-change event has a journal entry
- [ ] Every increment file is either envelope-licensed (named in the
      journal's `seed` entry) or has a PRECEDING journal `signal` entry
      citing its DEF-<n> Ledger row (missing = creation asserted, not
      licensed)
- [ ] Reorientation entries exist per cadence K (from design.md §North Star)
- [ ] Every FULL adversarial pass expected by cadence K (and after any STOP
      trip or surprise) shows all three stances — falsifier / entropy
      auditor / heretic — each with >= 1 objection or an evidence-backed
      zero (missing or evidence-free = cadence declared, not demonstrated)
- [ ] Every objection entry has a disposition (accepted → Act item; rejected
      → one-line reason); no stance returned an evidence-free "zero
      objections"
- [ ] **BLOCKING**: every DELEGATED ticked row has a merged output contract
      recorded; no evidence of subagent writes to design.md / tasks.md /
      journal.md / specs/

**Gaps found:** <list or "none">

---

## 13. Packaging & Change Boundary (read-only — what ships, not what the dirty tree shows)

Commands:

```bash
git status --short
git ls-files --others --exclude-standard
```

- [ ] No untracked file is imported/referenced by tracked code or by
      package/test config (violation = EVIDENCE-GAP: CI cannot see it —
      correct-but-unshippable)
- [ ] Generated-only untracked files explicitly classified; scratch = WARN
- [ ] Every modified file OUTSIDE all registry footprints has a disposition
      below (a foreign diff the implementation NEEDS but no row owns =
      EVIDENCE-GAP)
- [ ] If tree is dirty: inventory + patch fingerprint recorded in the
      report header

Untracked reachability:

| Untracked file | Referenced by tracked code/config? | Classification | Severity |
|---|---|---|---|
| — | yes/no | needed-by-implementation / generated-only / scratch | EVIDENCE-GAP / WARN / — |

Foreign diffs (files modified outside every registry row's footprint):

| File | In a registry footprint? | Classification | Action |
|---|---|---|---|
| — | no | owned (registry gap) / adjacent-intentional / ambient-branch-drift (pre-existed this change) / unrelated-dirty | fix row / split before commit / named + excluded from guardrail diffs / hygiene WARN |

---

## 14. Review-Finding Intake

Every external/review finding gets an RF-<n> row and a disposition — "review
said X" must not survive as ambient memory. Undispositioned = EVIDENCE-GAP.

| ID | Finding | Source | Disposition | Evidence | Follow-up |
|---|---|---|---|---|---|
| RF-1 | <summary> | reviewer / panel / verifier | accepted / rejected / deferred / intentional | <command or file pointer> | <row / DEF / none> |

---

## Implementation evidence (manual QA appendix)

<!--
Optional. Manual-QA observations append HERE as command/observation pairs —
e.g. `paused=false → true → false, currentTime=50.012434` after a slider
scrub. Keep each pair one line: what was driven, what was observed.
-->

| Driven action / command | Observed |
|---|---|
| — | — |

---

## Verdicts

Three axes — a spike that learned enough to stop is completion, not failure;
implementation NO-GO with coherent records is a legitimate artifact PASS.

- **Artifact verdict** (do the records match reality): PASS / PASS WITH
  WARNINGS / FAIL
- **Implementation verdict** (is the built thing viable/complete): PASS /
  PASS WITH WARNINGS / NO-GO / BLOCKED / N-A — exploratory changes use the
  closed spike taxonomy: go / go-with-caveats / no-go-for-now /
  blocked-by-env / blocked-by-tooling / retire-question
- **Rollout verdict**: clear / ops-gated (OPS-<n> rows open) / blocked / n-a
- **Archive decision**: archive now / postpone archive / do not archive —
  reason: <mainline conformance, no-go spike, external blocker, …>

## Overall Decision (= the Artifact verdict; the retro precheck gates on this line)

- [ ] ✅ PASS — records match reality
- [ ] ⚠️ PASS WITH WARNINGS — proceed, but note: `<explain>`
- [ ] ❌ FAIL — fix the failing artifact and re-run verify

**Next step:**

<describe the next action — remember guardrail promotion to specs/arch-*,
the ops-runbook check for gate:ops rows, the read-only conformance check
(`git merge-base --is-ancestor <verified-sha> <default-branch>`, plus the
patch fingerprint if verified dirty), and the cross-change collision block
all run before `openspec archive -y` (apply step 5); EVIDENCE-GAPs block
archive until reconciled>

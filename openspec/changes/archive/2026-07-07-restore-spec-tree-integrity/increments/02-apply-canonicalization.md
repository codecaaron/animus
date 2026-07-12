# Increment 02: apply-canonicalization

## Scope

- **Registry row**: 02 · mode: inline · review: subagent
- **Resolves** (Decision Ledger rows): none directly — produces the residual-failure report that is the resolving signal for the invalid-residue and gate rows
- **Authors** (spec requirements): §arch-spec-corpus/Canonical section structure (exact scope set by inc 01's inventory)
- **Depends on**: 01 (tool + inventory exist; edge cases dispositioned)
- **Footprint**: `openspec/specs/**` (writes via the tool only), `openspec/changes/restore-spec-tree-integrity/tools/**` (reports), `openspec/changes/restore-spec-tree-integrity/specs/arch-spec-corpus/**` (requirement authorship)
- **Pushes to a later increment**: gate wiring (inc 04, lazy); content triage (follow-up change)

> Resolving signal that licensed creating this increment now: inc 01's inventory dry-run completed with all 116 files classified and edge cases dispositioned (see journal `signal` entry after inc 01 lands).

## Context Capsule

- **Objective**: Run the canonicalizer in `--write` mode over `openspec/specs/`, verify the pass-count rose and no delta headers remain, and record the residual failures (specs still invalid for content reasons) as a triage report. The main tree goes from 37 valid to the mechanical maximum.
- **In-scope guardrails** (verbatim from design.md Register):
  - G1: SHALL NOT delete any spec dir containing SHALL/MUST text — check: capture `rg -l 'SHALL|MUST' openspec/specs/ --glob '*/spec.md' | sort` before and after; diff must be empty (the tool never deletes files) — STOP
  - G3: SHALL NOT reduce the validate pass-count — check: `bunx openspec validate --all 2>&1 | tail -1` ≥ 37 passed — STOP
- **Requirements to draft** (target namespace + skeleton): §arch-spec-corpus/Canonical section structure — arch namespace, executable check: a grep/count proving every main-tree spec.md (except any inventory-listed no-requirements residue) contains both `## Purpose` and `## Requirements` headers.
- **Existing spec context**: change-level `specs/arch-spec-corpus/spec.md` already holds `### Requirement: Delta-header freedom in the main tree`; the new requirement is ADDED alongside it.
- **Relevant resolved decisions**: D1 verbatim text; D2 merge semantics; D3 derived Purpose.
- **In-scope North Star criteria**: NS1 (pass-count monotone), NS2 (no invented requirements), NS3 (mechanical).
- **Prohibitions**: no version-control commands; hand edits to `openspec/specs/**` are the exception path and each gets a journal entry naming the file (NS3); no writes outside the footprint plus this file.

## Plan

## Task 02.1: Baseline capture

- [x] **Step 1: Record pre-write baselines**

Run:
```bash
bunx openspec validate --all 2>&1 | tail -1
rg -l 'SHALL|MUST' openspec/specs/ --glob '*/spec.md' | sort > openspec/changes/restore-spec-tree-integrity/tools/g1-before.txt
rg -c '^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements' openspec/specs/ | wc -l
```
Expected: `37 passed`; g1-before.txt written; ~40 delta files.
ACTUAL: `Totals: 38 passed, 80 failed (118 items)` (37 spec-side + this change validating); g1-before.txt: 114 files (NOTE: plan's `--glob '*/spec.md'` matched nothing from repo root — corrected to `--glob '**/spec.md'`); delta files: 40.

## Task 02.2: Write-mode run

- [x] **Step 2: Apply**

Run: `bun openspec/changes/restore-spec-tree-integrity/tools/canonicalize.ts --write`
Expected: `WROTE — ...` with the same classification counts as the dry run. — ACTUAL: `WROTE — wrapperless: 37, delta: 40, canonical: 37, no-requirements: 2` (identical to dry run).

- [x] **Step 3: Delta headers gone**

Run: `rg -n '^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements' openspec/specs/ | wc -l`
Expected: 0. — ACTUAL: 0.

- [x] **Step 4: Re-validate**

Run: `bunx openspec validate --all 2>&1 | rg '^Totals:'`
Expected: passed count materially above 37 (target: ≥ 100); record exact number.
ACTUAL after write: `111 passed, 7 failed`. Two failures were merge-surfaced content defects fixed by journaled NS3 hand edits (prop-system inline-REMOVED block — a fourth dialect, population 1; theme-composition MAY-only requirement given its system-side SHALL). Third hand edit: includes-driven-discovery REQ-n dialect conversion (planned in inc 01). Final: `Totals: 114 passed, 4 failed (118 items)` — spec-side 113/116.

## Task 02.3: Residual-failure report

- [x] **Step 5: Write the triage report**

Written to `tools/residual-failures.txt`: color-mode-palette (2 scenarioless), responsive-shell-layout (3 scenarioless), content-migration (prose doc, zero requirement blocks) — each annotated with follow-up routing.

- [x] **Step 6: Draft §arch-spec-corpus/Canonical section structure** — scoped to requirement-bearing files (naturally excludes content-migration, no exclusion list needed): both `grep -L` checks verified empty tree-wide before authorship.

## Guardrail gate

- [x] G1: `rg -l 'SHALL|MUST' openspec/specs/ --glob '**/spec.md' | sort | diff openspec/changes/restore-spec-tree-integrity/tools/g1-before.txt -` — result: PASS — one line of diff, an ADDITION (`45a46: includes-driven-discovery/spec.md` gained SHALL text via dialect conversion); zero files left the set, which is the guarded invariant.
- [x] G3: `bunx openspec validate --all 2>&1 | rg '^Totals:'` — result: PASS — `114 passed, 4 failed` ≥ baseline 38; monotone at every intermediate step (38 → 111 → 114).

## Output contract

Inline mode with subagent review: after the steps complete, dispatch a reviewer subagent (adversarial stances; receives this file + resulting artifact state, not the implementer's reasoning) whose objections land as journal `objection` entries.

**Review outcome**: full three-stance pass ran via reviewer subagent. Verdict PROCEED-WITH-FIXES; 4 objections, all accepted and applied before tick: (1) inventory.json overwrite-guarded (dry-runs → inventory.dry.json), (2) prop-system hand-removal added to inventory removed record, (3) Plugin parity scenario disclosed as authored content (journal corrected), (4) design.md G1 glob corrected to `**/spec.md`. See journal 04:30–04:35 entries.

## Spec authorship checklist (orchestrator; the tie-back before ticking)

- [x] Authored §arch-spec-corpus/Canonical section structure into change-level specs/ (leakage lint run first — all three empty)
- [x] No Ledger rows to flip; residual report recorded as the pending signal for the invalid-residue + gate rows
- [x] Reorientation entry written (cadence K=2: full pass at this landing via reviewer subagent, per registry row's review:subagent)
- [x] Ticked registry row 02 in tasks.md

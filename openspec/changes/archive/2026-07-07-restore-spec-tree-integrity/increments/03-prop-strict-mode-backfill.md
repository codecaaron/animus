# Increment 03: prop-strict-mode-backfill

## Scope

- **Registry row**: 03 · mode: inline · review: self
- **Resolves** (Decision Ledger rows): none (decided-now work per D5)
- **Authors** (spec requirements): §prop-strict-mode/* — the four ADDED requirements from the archived delta, copied verbatim into this change's delta tree
- **Depends on**: 01 (tool exists, for format checking only)
- **Footprint**: `openspec/changes/restore-spec-tree-integrity/specs/prop-strict-mode/**`, `openspec/changes/archive/prop-strict-mode/**` (directory rename ONLY)
- **Pushes to a later increment**: none

> Resolving signal that licensed creating this increment now: envelope signal entry (safe-to-fix-now; all inputs verified during exploration — implementation shipped in `packages/system/src/types/config.ts`, archive commit date 2026-03-29 from `git log -1 --format=%ad --date=short fffda11`).

## Context Capsule

- **Objective**: The shipped `prop-strict-mode` capability gets a main-tree spec via this change's delta (synced at archive), and its archive directory gains the standard date prefix. Content of the archived change stays byte-identical.
- **In-scope guardrails** (verbatim from design.md Register):
  - G2: SHALL NOT modify archived change content (renames only) — check: `git status --short openspec/changes/archive/ | rg '^ ?M'` returns empty — STOP
  - G3: SHALL NOT reduce the validate pass-count — check: `bunx openspec validate --all 2>&1 | tail -1` — STOP
- **Requirements to draft**: §prop-strict-mode — behavioral namespace; source text at `openspec/changes/archive/prop-strict-mode/specs/prop-strict-mode/spec.md` is ADDED-only, black-box scenarios (type-level behavior observable by a consumer compiling against the package). Copy verbatim; do not rewrite.
- **Relevant resolved decisions**: D5 (backfill from archived delta; rename with plain `mv` to `2026-03-29-prop-strict-mode`).
- **In-scope North Star criteria**: NS2 (no invented requirements — verbatim copy).
- **Prohibitions**: no version-control commands (plain `mv`, not `git mv`); NEVER edit files under `openspec/changes/archive/`; no writes outside the footprint plus this file.

## Plan

## Task 03.1: Delta spec

- [x] **Step 1: Copy the archived delta into this change**

Run:
```bash
mkdir -p openspec/changes/restore-spec-tree-integrity/specs/prop-strict-mode
cp openspec/changes/archive/prop-strict-mode/specs/prop-strict-mode/spec.md openspec/changes/restore-spec-tree-integrity/specs/prop-strict-mode/spec.md
```

- [x] **Step 2: Verify the copy parses as a delta**

Run: `bunx openspec validate restore-spec-tree-integrity 2>&1 | tail -3`
Expected: prop-strict-mode requirements counted; no new errors attributable to this file. — ACTUAL: `Change 'restore-spec-tree-integrity' is valid`

## Task 03.2: Archive rename

- [x] **Step 3: Rename**

Run: `mv openspec/changes/archive/prop-strict-mode openspec/changes/archive/2026-03-29-prop-strict-mode` — DONE

- [x] **Step 4: Confirm rename-only**

Run: `git status --short openspec/changes/archive/ | rg '^ ?M' | wc -l`
Expected: 0 (deletes+untracked adds are the rename's git view before staging; zero content modifications). — ACTUAL: 0

## Guardrail gate

- [x] G2: `git status --short openspec/changes/archive/ | rg '^ ?M'` — result: PASS (empty)
- [x] G3: `bunx openspec validate --all 2>&1 | rg '^Totals:'` — result: PASS — `Totals: 114 passed, 4 failed (118 items)` (unchanged from post-inc-02 baseline)

## Output contract

Inline mode — collapsed into the checklists above.

## Spec authorship checklist (orchestrator; the tie-back before ticking)

- [x] Authored §prop-strict-mode/* into change-level specs/ (verbatim copy; leakage lints all empty)
- [x] No Ledger rows to flip
- [x] Reorientation entry written (off-beat: entropy auditor alone; inc 02's surprises are covered by the in-flight full-pass subagent review attached to inc 02's landing)
- [x] Ticked registry row 03 in tasks.md

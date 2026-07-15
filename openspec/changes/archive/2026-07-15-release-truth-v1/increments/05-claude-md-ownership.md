# Increment 05: claude-md-ownership

## Scope

- **Registry row**: 05 · mode: delegate · review: subagent
- **Resolves**: D5
- **Authors**: — (envelope: §verification-tier-policy/Packed Tier
  Change-Type Coverage already authored)
- **Depends on (ordering — deps:)**: 02 (the tier must exist before it is
  documented as the source of truth)
- **Inputs from (information — inputs:)**: none
- **Footprint**: `CLAUDE.md` (repo root)
- **Pushes to a later increment**: none

> Resolving signal: envelope-licensed (implements decided-now D5).

## Context Capsule

- **Objective**: Root `CLAUDE.md`'s verification tables — the single source
  of truth for verification commands — gain the `verify:packed` atomic-tier
  row, composite-membership updates, and Change-Type Map rows for the new
  surfaces, per the repo's ownership rule.
- **In-scope guardrails** (from design.md Register):
  - G5: new surfaces SHALL NOT land without their CLAUDE.md rows — check:
    `rg -c "verify:packed" CLAUDE.md` — expected: >= 2 — WARN
- **Requirements to draft**: none — envelope covers.
- **Existing spec context**: change-level
  `specs/verification-tier-policy/spec.md` → "Packed Tier Change-Type
  Coverage" and "Packed Tier Composite Membership"; main spec
  `openspec/specs/verification-tier-policy/spec.md` → "Root CLAUDE.md
  Verification Tier Table" and "Change-Type Map" (the formats to follow).
- **Relevant resolved decisions**: D5. Scope discipline: root CLAUDE.md's
  tier tables are currently stale in ways OTHER changes own (they omit
  vinext/react-router/workers tiers that already exist in `vite.config.ts`)
  — do NOT fix those here; add only the packed-lane rows this change owns.
- **In-scope North Star criteria**: NS1 (the documented contract matches
  the shipped gates).
- **Prohibitions**: no version-control commands; no writes outside root
  `CLAUDE.md` and this file; never write to design.md, tasks.md,
  journal.md, or specs/ — return drafts in the output contract.

## Plan

## Task 05.1: Atomic-tier table row

- [x] **Step 1:** In root `CLAUDE.md` § Atomic Tiers, add after the
`verify:parity` row (match the table's column set — Command / What it
covers / Upstream requires / Fails loud when / Typical runtime):

```markdown
| `vp run verify:packed`          | pack all five publishables, tarball lint (publint/attw), isolated npm install into `e2e/packed-app/.staging`, ESM/CJS + dual-engine load proof, stable-TS declaration check, Vite+Next builds, positional assertions | fresh v1+v2 NAPI + fresh `dist/` for all five publishables + fresh `_assertions/dist/`                          | any upstream artifact missing/stale          | slow            |
```

## Task 05.2: Composite table updates

- [x] **Step 1:** In § Composite Orchestrators, update the `vp run
verify:full` row's "What it covers" to append `+ packed lane`, and the
`vp run verify:ci` row to mention the packed lane mirrors its CI job.
Keep each cell to one line, matching the table's existing terseness.

## Task 05.3: Change-Type Map rows

- [x] **Step 1:** In § Change-Type Map, add three rows (respect the table's
two-column format — "You changed" / "Run"):

```markdown
| `e2e/packed-app/**`                                                    | `verify:packed`                                                                                        |
| `scripts/verify/packed.sh`                                             | `verify:packed`                                                                                        |
| `packages/*/package.json` (deps, peers, exports, files of publishables) | `verify:packed`                                                                                       |
```

- [x] **Step 2:** Run the G5 check (fenced below) and record the count.
      `rg -c "verify:packed" CLAUDE.md` → `4` (>= 2).

- [x] **Step 3:** Sanity-check the tables still render: skim
`rg -n "verify:packed" CLAUDE.md` output and confirm each hit sits inside
the intended table with balanced `|` separators. Confirmed — line 67 is the
atomic-tier row (6 `|`, 5 columns); lines 105–107 are the Change-Type Map
rows (3 `|` each, 2 columns). The two composite rows carry the "packed lane"
prose rather than the literal token, so they are correctly not counted by G5.

## Guardrail gate

- [x] G5: `rg -c "verify:packed" CLAUDE.md` — result: PASS — `4` (>= 2)

## Output contract (delegate mode)

- [x] Plan checkboxes above ticked to reflect actual completion
- [x] Drafted requirement text: none owed (`authors: —`)
- [x] Guardrail gate results recorded with command output (G5 PASS: `4` >= 2)
- [x] Proposed journal entries (surprise / friction), 1–3 lines each —
      returned in the delegate final response for orchestrator acceptance
- [x] Surfaced variables (spawn candidates): the pre-existing tier-table
      staleness (missing vinext/react-router/workers rows owned by other
      changes) is a NOTE for the journal, not work to do here

## Spec authorship checklist (orchestrator; the tie-back before ticking)

- [ ] No spec text owed (envelope covers)
- [ ] No Ledger rows to flip
- [ ] Appended accepted journal entries (attributed `via inc 05 subagent`)
- [ ] Reorientation entry written per cadence
- [ ] Ticked registry row 05 in tasks.md with `· ticked: <timestamp>`

# Design — restore-spec-tree-integrity

## Context

The main spec tree (`openspec/specs/`, 116 capability dirs) fails
`openspec validate --all` on 79 items. Exploration (see brainstorm.md)
identified two mechanical failure shapes — 40 files carrying raw delta
headers archived verbatim, 70 files missing the canonical
`## Purpose`/`## Requirements` wrapper — plus one shipped-but-unspecified
capability (`prop-strict-mode`, implemented in
`packages/system/src/types/config.ts`, archived without a date prefix, spec
never synced). The corruption is a one-time import debt from commit
`d121c6b`, not ongoing decay.

The repo has just adopted the `superpowers-ooda` schema, whose archive step
syncs change deltas into this tree and whose verify step lints spec taxonomy.
A valid main tree is the precondition for both.

Constraints: repo rule "Never use mutative git operations"; `openspec/**`
changes need no verify tier (acceptance check is `openspec validate`);
archived change content must be treated as read-only history.

## Goals / Non-Goals

**Goals:**
- `openspec validate --all` pass-count rises from 37 toward 116; every
  mechanically repairable spec repaired.
- No delta-format headers remain in the main tree.
- `prop-strict-mode` capability specified in the main tree; its archive dir
  named consistently with every other archive entry.
- The repair is script-driven, re-runnable, and auditable.

**Non-Goals:**
- Content triage: judging staleness, rewriting weak requirements, or removing
  empty capabilities (follow-up change; this change only records the triage
  inventory).
- Taxonomy migration of the 118 impl-leak hits into `arch-*` namespaces
  (needs the triage inventory first).
- Rewriting the 26 rationale-lint hits inside existing main-tree specs
  (same follow-up).
- Any change to package code, build outputs, or CI behavior beyond the
  (conditional) regression-gate increment.

## Decisions

### D1: Mechanical canonicalization before any content judgment
- **Choice**: Repair format only — wrap wrapper-less files, merge delta
  sections deterministically — with requirement text preserved verbatim.
- **Rationale**: A rewrite under no test pressure produces plausible fiction;
  format repair is auditable and reversible.
- **Alternatives considered**: Big-bang manual rewrite (risk of invented
  requirements); delete-failing-specs (destroys the only written contract for
  shipped behavior).

### D2: Delta merge semantics
- **Choice**: ADDED → requirement is current; MODIFIED → full text is
  current (OpenSpec MODIFIED sections carry complete replacement text);
  REMOVED → drop, recording the loss in the inventory; RENAMED → apply
  FROM:/TO:. Duplicate requirement names within one file: last occurrence
  wins, earlier ones recorded in the inventory.
- **Rationale**: These are the same semantics `openspec archive` applies when
  syncing a delta into the tree; the repair replays the sync that never ran.
- **Alternatives considered**: Treating MODIFIED as unresolvable without the
  base text — unnecessary, since MODIFIED is replacement-not-diff by
  OpenSpec convention.

### D3: Generated Purpose sections quote, not invent
- **Choice**: Wrapper-less files that lack `## Purpose` get a minimal Purpose
  derived from the capability name plus the file's own first requirement
  sentence.
- **Rationale**: The validator requires the section; deriving it from
  existing text keeps NS2 intact (no new normative content).
- **Alternatives considered**: Authoring bespoke Purpose prose per spec
  (79 files of new unreviewed text); empty placeholder sections (fails
  validation).

### D4: The repair tool lives inside the change directory
- **Choice**: `tools/canonicalize.ts` under this change dir, run with bun;
  dry-run (inventory) and write modes.
- **Rationale**: The tool is one-shot repair tooling, not a product surface —
  archiving it with the change preserves auditability without adding a
  maintained `scripts/` surface (which would demand a Change-Type Map row).
- **Alternatives considered**: `scripts/spec-repair/` (implies ongoing
  ownership); scratchpad (lost after the session, breaks NS3 re-runnability).

### D6: Edge-case handling rules (resolved by inc 01's inventory)
- **Choice**: (1) `canonical` classification requires BOTH `## Purpose` and
  `## Requirements`; Requirements-only files get a Purpose inserted. (2)
  Requirement-bearing title sections (`## <Name> Specification`) are hoisted
  into `## Requirements`, their intro prose becoming the Purpose candidate and
  the redundant header dropped. (3) Preamble prose (minus `# h1` title lines)
  is preserved as the Purpose. Purpose priority: existing section > preamble
  prose > hoisted prose > derived-from-requirement-names. (4) The single
  `### REQ-n:`-dialect file (`includes-driven-discovery`) is hand-converted in
  inc 02 with a journal entry; `content-migration` (prose design doc, zero
  requirement blocks) stays untouched as triage residue.
- **Rationale**: The inventory showed these shapes cover the whole tree
  (37 wrapperless / 40 delta / 37 canonical / 2 no-requirements, sum 116);
  each rule is mechanical and text-preserving, honoring NS2/NS3. A dialect
  handler for a population of one is worse than an audited hand edit.
- **Alternatives considered**: Passthrough of title sections (buries
  requirements below the Requirements header — validator still counts them,
  but the document shape stays wrong); dropping preamble prose (loses the
  only written description 18 files have).

### D5: prop-strict-mode backfill source and archive rename
- **Choice**: Backfill `openspec/specs/prop-strict-mode/spec.md` by
  canonicalizing the archived delta
  (`archive/prop-strict-mode/specs/prop-strict-mode/spec.md`); rename the
  archive dir to `2026-03-29-prop-strict-mode` (its git commit date) with
  plain `mv`.
- **Rationale**: The delta is well-formed ADDED-only; the implementation
  shipped, so the spec describes reality. `mv` respects the no-mutative-git
  rule; git tracks the rename at commit time.
- **Alternatives considered**: Leaving the archive dir undated (perpetuates
  the inconsistency); writing a fresh spec from the code (violates D1/NS2).

## North Star

**Adversarial cadence K**: 2

- **NS1**: The main tree is valid or strictly closer to valid after every
  increment — `openspec validate --all` pass-count never decreases.
- **NS2**: No invented requirements — every canonical requirement in the
  repaired tree traces to text already present in the tree or in an archived
  change delta. provisional — revisit when triage finds shipped behavior with
  no written contract anywhere (backfilling those is new authorship needing
  its own change).
- **NS3**: Prefer mechanical, re-runnable transformations over hand edits;
  a hand edit is the exception and gets a journal entry naming the file.

## Decision Ledger

| Decision | Status | Owner increment | Resolving signal | Review-by |
|---|---|---|---|---|
| Canonical target format (wrap + merge, D1-D3) | decided-now | — | — | — |
| Repair tool location (D4) | decided-now | — | — | — |
| prop-strict-mode backfill + rename (D5) | decided-now | — | — | — |
| Edge-case handling for files the classifier can't bucket (mixed canonical+delta, scenario-less requirements, empty files) | resolved (D6) | 01 | inventory report from the canonicalizer dry-run enumerates the actual edge-case population — appeared 2026-07-07 (tools/inventory.json) | — |
| Whether `validate --all` becomes a blocking gate, and where (vp task vs CI vs hygiene) | deferred — carried to follow-up change | 04 (lazy, carried) | `openspec validate --all` passes clean after inc 02/03 — checked at inc 03 reorientation: not fired (3 content-residue specs remain by design) | 3 |
| Disposition of specs that stay invalid after mechanical repair (missing scenarios, no recoverable text) | deferred | — (follow-up change) | inc 02's post-run failure report exists | 3 |
| Taxonomy migration of impl-leak/rationale hits to `arch-*` | deferred | — (follow-up change) | triage inventory produced by this change | 3 |

## Guardrail Register

| ID | Invariant | Check (executable) | Scope | On trip | Status |
|---|---|---|---|---|---|
| G1 | SHALL NOT delete any spec dir containing SHALL/MUST text | `rg -l 'SHALL\|MUST' openspec/specs/ --glob '**/spec.md' \| sort > /tmp/before.txt` before each write run; after: every path missing from the tree must appear in the increment's removal record with Reason+Migration. (Glob corrected from `*/spec.md` at inc 02 review — the single-star form matches zero files from the repo root under ripgrep 14; the executed gates used the corrected form.) | footprint:openspec/specs/** | STOP | active |
| G2 | SHALL NOT modify archived change content (renames only) | `git status --short openspec/changes/archive/ \| rg '^ ?M'` returns empty | all | STOP | active |
| G3 | SHALL NOT reduce the validate pass-count | `bunx openspec validate --all 2>&1 \| tail -1` — "passed" count >= the count recorded at the previous increment's gate | all | STOP | active |

## Risks / Trade-offs

- [Risk] The deterministic merge mishandles a file with an unanticipated
  shape → Mitigation: inc 01 is a dry-run inventory over all 116 files; no
  writes happen until every file has a classification, and unclassifiable
  files are excluded from the write run (left failing, recorded for triage).
- [Risk] Generated Purpose paragraphs read as boilerplate → acceptable:
  Purpose quality is a content concern deferred to triage; validation and
  non-invention (NS2) take priority.
- [Trade-off] Some specs stay invalid after this change (scenario-less or
  empty ones) → acceptable: going from 37 to a high-90s pass-count with zero
  invented text beats forcing 116 with fabricated scenarios; the remainder is
  enumerated, not silent.

## Migration Plan

N/A — no deployment change. The change edits `openspec/**` only (plus,
conditionally, the vp task graph for the gate increment). Rollback is
restoring the prior file contents; no consumer or build artifact depends on
spec files at runtime.

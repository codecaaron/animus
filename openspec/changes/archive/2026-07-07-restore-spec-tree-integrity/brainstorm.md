# Brainstorm — restore-spec-tree-integrity

> Raw capture. Produced during an autonomous `explore` pass on 2026-07-07; the
> "dialogue" below is the exploration evidence chain and the decision reasoning
> it forced, preserved in the order it happened.

## Background: what exploration found

Ran `openspec validate --all` against the main tree (`openspec/specs/`,
116 capability dirs):

- **37 pass, 79 fail.**
- **40 specs contain raw delta headers** (`## ADDED Requirements`,
  `## MODIFIED Requirements`, ...) — change-level delta files that landed in
  the main tree verbatim instead of being merged into canonical form
  (examples: `builder-chain`, `prop-system`, `extract-pipeline`,
  `test-strategy`).
- **70 specs lack a `## Requirements` header** entirely; the validator counts
  0 requirements for them even when they contain well-formed
  `### Requirement:` blocks (example: `as-child-rendering` — perfectly good
  requirement text, no `## Purpose`/`## Requirements` wrapper).
- The overlap: some failing specs are deltas, some are wrapper-less canonical
  text, some are both across sections.

Provenance: `git log` places the corruption at commit `d121c6b` ("Clean
slate: remove AI bloat, add canonical OpenSpec specs") and subsequent
archive-era commits — delta artifacts were copied in as if they were
canonical specs. This is not ongoing decay; it is a one-time import debt.

Adjacent finding — **`openspec/changes/archive/prop-strict-mode/`**:

- Only archive entry with no `YYYY-MM-DD-` prefix.
- All tasks unticked, yet the feature IS implemented
  (`strict?: boolean` + `StrictOrEmpty` live in
  `packages/system/src/types/config.ts`).
- Its delta spec was never synced: `openspec/specs/prop-strict-mode/` does
  not exist. The capability is real, shipped, and unspecified in the main
  tree.

Taxonomy probe (the new `superpowers-ooda` schema's blocking lints, run
against the main tree as-is):

- impl-leak lint (`SHALL use|adopt|leverage|be implemented...` outside
  `arch-*`): **118 hits**
- rationale lint (`because|as decided|we chose|per the design`): **26 hits**
- ledger-ref lint (`\bD[0-9]+\b|decision ledger`): **10 hits**
- `arch-*` namespace: **does not exist yet** (0 dirs)

## Why this matters now (not later)

The repo just adopted the `superpowers-ooda` schema (`config.yaml` now points
at it). That schema's `archive` step **syncs each change's delta specs into
this same main tree**, and its `verify` step treats spec taxonomy as a
blocking gate for change-level specs. Every future change that archives into
a corrupt tree either compounds the corruption or forces ad-hoc repair under
deadline. Separately, `openspec validate --all` can never become a CI or
hygiene gate while 79 items fail — the single cheapest regression guard for
the whole spec corpus is unusable.

## Approaches considered

**A. Big-bang manual rewrite of all 79 failing specs.**
Rejected: high effort, and the real risk is *inventing* requirement text that
was never agreed — a rewrite under no test pressure produces plausible fiction.

**B. Mechanical canonicalization first, content triage second (recommended).**
Two distinct failure shapes get two distinct mechanical fixes:
wrapper-less specs get a `## Purpose` + `## Requirements` wrapper around
their existing text (zero requirement-text changes); delta-header specs get
their ADDED/MODIFIED sections merged into a canonical body (MODIFIED already
carries full replacement text by OpenSpec convention, so the merge is
deterministic). Only after the tree validates does a *separate* triage decide
per-spec whether content is stale, empty, or worth keeping. Auditable, and
the tree improves monotonically.

**C. Delete everything that fails, keep the 37 valid specs.**
Rejected: destructive — many failing files contain the only written behavior
contract for shipped capabilities (`as-child-rendering` is load-bearing and
one wrapper away from valid).

## KNOWN-NOW vs DEFERRED

KNOWN-NOW (decidable up front):

- Target format is the validator's canonical shape: `## Purpose` +
  `## Requirements` with `### Requirement:` / `#### Scenario:` (4 hashes).
- Wrapper-less specs are fixed by wrapping, not rewriting. Requirement text
  is preserved byte-for-byte wherever possible.
- Delta-header specs are fixed by deterministic merge (ADDED → append,
  MODIFIED → replace-in-place, REMOVED → drop with the file's stated reason).
- `prop-strict-mode` gets its spec backfilled into the main tree from the
  archived delta, and the archive dir gets the standard date prefix (rename
  only — content untouched; date from its git commit).

DEFERRED (each with its resolving signal):

- **Whether the 118 impl-leak requirements migrate into a new `arch-*`
  namespace** — signal: the post-canonicalization triage inventory exists,
  classifying each hit as (a) genuine architectural constraint with an
  executable check, (b) behavioral requirement misworded, or (c) stale.
  Migrating before that inventory means guessing.
- **Whether `openspec validate --all` becomes a blocking gate (CI or
  hygiene)** — signal: the tree passes clean once. Gating before green is
  noise; gating after green is nearly free.
- **What to do with genuinely empty / 0-content specs** (some dirs may have
  no recoverable requirement text) — signal: per-spec triage verdict during
  the canonicalization pass; candidates are removed only with an explicit
  Reason+Migration record, mirroring the delta REMOVED convention.
- **Whether the 26 rationale-lint hits get rewritten or moved to design
  history** — signal: same triage inventory.

## Candidate NORTH STAR criteria

- NS1: The main tree is valid (or strictly closer to valid) after every
  increment — the pass-count from `openspec validate --all` never decreases.
- NS2: No invented requirements — every canonical requirement in the repaired
  tree traces to text that already existed in the tree or in an archived
  change delta. (Provisional — revisit if triage finds shipped behavior with
  *no* written contract anywhere; backfilling those is new authorship and
  needs its own decision.)
- NS3: Prefer mechanical, re-runnable transformations over hand edits, so the
  repair is auditable and a future regression is cheap to re-fix.

## Candidate GUARDRAILS

- G1: SHALL NOT delete any spec dir containing SHALL/MUST text without a
  recorded Reason+Migration. Check sketch:
  `rg -l 'SHALL|MUST' <dir>` must be consulted before any removal; removals
  enumerated in the increment file.
- G2: SHALL NOT modify archived change *content* — archive edits are limited
  to directory renames. Check sketch: `git status --short
  openspec/changes/archive/` shows only renames (`R`), no `M`.
- G3: SHALL NOT reduce the validate pass-count. Check sketch:
  `openspec validate --all 2>&1 | tail -1` pass-count compared before/after
  each increment.

# Increment <NN>: <slug>

<!--
One increment = one self-contained implementation plan for ONE slice of the
change — and simultaneously a DELEGATION PACKET. Whatever this row's mode is,
the file must pass the

COLD-START TEST: an agent with no access to any conversation, given only this
file (whose Context Capsule embeds or precisely references everything needed),
could execute the Plan and produce the Output contract. If it could not, the
capsule is incomplete — fix it BEFORE dispatch or before starting inline work.
Inline execution by a future session is delegation to a cold agent; the test
is the same.

Path: openspec/changes/<change-name>/increments/<NN>-<slug>.md
Plan body produced by superpowers:writing-plans.

Create increments LAZILY — only when the owning DEF-<n> Ledger rows are
resolvable (a journal `signal` entry cites them) or safe to fix now, AND every
`inputs:` row on the registry line is ticked (its output contract exists — a
packet written against a future tree arrives with holes shaped like upstream
outputs). If implementation surfaces a new variable: Ledger row (design.md) +
lazy registry row (tasks.md) + journal `spawn` entry. Do not force the
decision inline.

DEGRADED TOPOLOGY: if this row was pre-assigned delegate but ran inline (no
subagent capability), add a one-line hygiene note directly under the H1
("ran inline under degraded topology; contract filled at tick, journal <ts>")
and have the ORCHESTRATOR fill the Output contract at tick time — verify
checks that exact shape.
-->

## Scope

- **Registry row**: <NN> · mode: <inline|delegate> · review:
  <self|subagent|subagent-if-available>
- **Resolves** (Decision Ledger rows): <DEF-n, DEF-m — flipped to resolved
  (`→ D<x>`) in design.md when this increment lands; D<n> tokens for
  decided-now decisions this row implements>
- **Authors** (spec requirements): <§<capability>/<Requirement> — drafted here,
  authored into the change-level specs/<capability>/spec.md by the
  ORCHESTRATOR (single-writer rule); namespace admission tests apply — or
  "— (envelope)" when the envelope specs already cover this row>
- **Depends on (ordering — deps:)**: <increment NN / change:<name>#<row> /
  external:<kebab-slug> / none — sequencing only; does not gate authoring
  this file>
- **Inputs from (information — inputs:)**: <increment NN or
  change:<name>#<row> whose output this capsule consumes / none — this file
  must not predate their ticks (cross-change/external gates are satisfied by
  a journal `signal` entry recording the row/event landing)>
- **Footprint**: <path globs this increment may touch — the delegation write
  boundary and the parallel-dispatch disjointness key>
- **Pushes to a later increment**: <deferred variable + owning new row, or none>

> Resolving signal that licensed creating this increment now (cite DEF-<n> and
> the journal `signal` entry): <built artifact / measurement / resolved
> dependency>

## Context Capsule

<!--
Everything a cold agent needs. Embed short excerpts verbatim; reference long
ones by exact path + section header. An executing agent must not need to go
hunting, and must not need the conversation that produced this change.
Reference code by SYMBOL and structure ("locate `configSignature` via rg"),
never bare line numbers — this packet executes against a tree that may have
drifted since authoring.
-->

- **Objective** (2-4 sentences): <what done looks like, in behavior terms>
- **In-scope guardrails** (verbatim from design.md's Register — ID, invariant,
  executable check, severity; copy each command from the Register's FENCED
  BLOCK, never from a table cell, where pipes are escaped):
  - G<n>: <invariant> — check: `<command>` — <STOP|WARN>
- **Requirements to draft** (target namespace + skeleton): <§cap/Req — note
  behavioral (black-box verifiable) vs arch-\* (executable-check backed)>
- **Existing spec context**: <exact requirement headers this touches, or
  spec-context MCP query terms; include verbatim text for MODIFIED targets>
- **Relevant resolved decisions** (as constraints — one line each, no
  extended rationale; rationale stays in design.md): <D<n>: choice>
- **Upstream inputs** (for each `inputs:` row: the output-contract facts this
  plan consumes — residual lists, measurements, produced artifacts —
  embedded verbatim, not referenced by conversation): <or "none">
- **In-scope North Star criteria**: <NS<n>: criterion>
- **Prohibitions**: no version-control commands; no writes outside the
  declared footprint plus this increment file; NEVER write to design.md,
  tasks.md, journal.md, or specs/ (delegate mode — return drafts in the
  output contract instead); treat any "commit point" emitted by skills as a
  logical checkpoint only.

## Plan

<!--
superpowers:writing-plans output: 2-5 minute micro-steps with exact file
paths, code snippets, and test commands, kept as the `- [ ]` checklist.

Checkbox conventions read by verify:
- [ ]  not started
- [x]  done
- [~]  deferred manual check (smoke / live-env not run this cycle). verify §9
       requires an equivalent automated test for each [~], else it is a
       recorded gap.
-->

## Task <NN>.1: <component>

- [ ] **Step 1:** <micro-step — file path + change + test command>
- [ ] **Step 2:** <micro-step>

## Guardrail gate

<!--
Derived from the Context Capsule's in-scope guardrails. Every check must RUN
and its outcome be recorded before the registry row may be ticked. Delegate
mode: the subagent runs these and reports; the orchestrator RE-RUNS
STOP-severity checks on the merged result (trust but verify). Any trip gets a
journal `guardrail-trip` entry; STOP severity halts this increment and
escalates the next reorientation to a full adversarial pass.
-->

- [ ] G<n>: `<command>` — result: <pass / TRIP + output excerpt>

## Output contract (delegate mode; inline mode may collapse into the checklists above)

<!--
What the subagent RETURNS to the orchestrator. The subagent writes nothing to
shared artifacts. Partial or non-conforming output is rejected back to a
repaired packet, not silently patched (journal `friction`). Degraded
topology (delegate row ran inline): the ORCHESTRATOR fills this section at
tick time — an empty contract under a ticked mode-changed row is a
contradiction verify flags.
-->

- [ ] Plan checkboxes above ticked to reflect actual completion
- [ ] Drafted requirement text for every entry in **Authors** (full
      SHALL/MUST text + >= 1 `#### Scenario:` WHEN/THEN), leakage-clean:
      no rationale language, no D<n> references
- [ ] Guardrail gate results recorded above, with command output excerpts
- [ ] Proposed journal entries (surprise / friction / signal), 1-3 lines each
- [ ] Surfaced variables (spawn candidates): <decision-shaped unknowns +
      suggested resolving signal each, or "none">

## Spec authorship checklist (orchestrator; the tie-back before ticking)

- [ ] Authored §<capability>/<Requirement> into specs/<capability>/spec.md
      (correct namespace; ran the leakage lint from verify §10 before writing)
- [ ] Flipped Decision Ledger rows <DEF-n…> to resolved (`→ D<x>`) in
      design.md; promoted into §Decisions
- [ ] Appended accepted journal entries (attributed `via inc <NN> subagent`
      if delegated)
- [ ] Reorientation entry written (journal `reorientation` — Observe / Orient
      incl. adversarial stances per cadence / Decide / Act)
- [ ] Ticked this increment's registry row in tasks.md, appending
      `· ticked: <reorientation timestamp>`

## Context

<!--
Background, current state, constraints, stakeholders.
brainstorm.md records the exploration (known/deferred split + north-star and
guardrail candidates); this file transforms that into the change's DECISION,
DIRECTION, and CONSTRAINT record. Once this file exists, brainstorm.md is
immutable history and THIS file wins every conflict (over brainstorm.md and
proposal.md).

Ownership: design.md does NOT contain an increment map. Decomposition state
(what increments exist, their mode, status, deps, inputs, footprint) lives
ONLY in tasks.md (the Increment Registry). If you are about to write
decomposition here, stop and write it there.
-->

## Goals / Non-Goals

**Goals:**
<!-- What this design aims to achieve -->

**Non-Goals:**
<!-- What is explicitly out of scope -->

## Decisions

<!--
The single source of truth for all technical decisions that ARE made — and the
ONLY home for rationale. Specs never carry rationale; a rationale in a spec is
decision-ledger leakage and fails verify §10.

### D1: <decision title>
- **Choice**: <what was adopted>
- **Rationale**: <why>
- **Alternatives considered**: <rejected options + why rejected>

Deferred decisions live in the Decision Ledger below, not here. A decision is
promoted from the Ledger into this section as a real Dn when the increment
that owns it resolves it.
-->

## North Star

<!--
Directional steering criteria — invariants the change steers by, NOT
decisions. Each is checked at every reorientation's Orient phase, by number.

- A criterion may be marked `provisional — revisit when <signal>`. A north
  star with no revisit conditions anywhere is dogma; expect the heretic stance
  to attack it.
- Adversarial cadence K: full three-stance adversarial pass every K increments
  (plus after the envelope, and after any STOP guardrail-trip or surprise
  journal entry). Pick K per change scope; record it here so cadence is a
  decision, not folklore.
-->

**Adversarial cadence K**: <n>

- **NS1**: <criterion — e.g. "the molecular layer remains swappable per state owner">
- **NS2**: <criterion> — provisional — revisit when <signal>

## Decision Ledger

<!--
The deferral map — DEFERRED decisions ONLY. Decided-now decisions live solely
in §Decisions above; a decided-now row here is double-entry and gets flagged
at review.

- ID: stable token DEF-<n>, distinct from D<n> decisions and G<n> guardrails.
  Registry `resolves:` fields, lazy-row blocks, and journal `signal` entries
  cite this token — never the prose name.
- Status: deferred / resolved (record the promotion: `resolved → D<m>`) /
  retired (cite the disposing journal entry).
- Owner increment: the registry row (tasks.md) that will resolve it — may be
  a lazy row.
- Resolving signal: the CONCRETE thing that licenses deciding later — a built
  artifact, a measurement, a resolved dependency. A deferral with no signal is
  procrastination; name the signal. When the signal appears in reality, a
  journal `signal` entry records it — that entry is what licenses creating the
  lazy increment.
- Owner increments and signals may reach beyond this change with the closed
  token grammar change:<name>#<row> (a row in another open change) and
  external:<kebab-slug> (an event outside any change, e.g.
  external:web-twerker-pr-merge — slugs, not prose: the same token must grep
  across Ledger, registry, journal, verify, and runbook) — one grammar for
  cross-change and external gates; no prose improvisation.
- Review-by: dual-denominated staleness trigger —
  `<n> reorientations | <YYYY-MM-DD>`, whichever comes FIRST (external
  dependencies age in wall-clock time, not increments; default 3
  reorientations when no date fits). On breach, the next reorientation's
  Decide step MUST name a revised signal or retire the row. Zombie deferrals
  are found mid-flight, not at verify.
-->

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
|---|---|---|---|---|---|
| DEF-1 | <e.g. slot-registry shape> | deferred | 02 | 01 exercises role tokens in real components | 3 reorientations \| <YYYY-MM-DD> |

## Guardrail Register

<!--
Negative invariants actively gated at EVERY in-scope increment — the change's
tripwires. Not authored into specs/ during the change; durable rows are
PROMOTED to specs/arch-<domain>/spec.md at archive (apply step 5).

- Each row's check is an executable command runnable verbatim by an agent
  with no extra context (rg pattern, structural assertion, budget
  measurement). Commands live in FENCED BLOCKS keyed by ID below the table —
  never in table cells, where pipe-escaping (`rg "a\|b"`) silently corrupts
  copy-paste-run and defeats the register's core contract.
  CALIBRATE AT REGISTRATION: run the check when you write the row; record the
  current result and expected transition in Status. State known blind spots
  in the Invariant cell — a guardrail that overclaims is worse than a narrow
  one honestly scoped.
- Scope (closed set): all / footprint:<glob> (applies to increments whose
  footprint matches) / inc:<NN,NN> (named increments — must name real
  registry rows) / change-end (runs once at verify, not per increment).
- On trip: STOP (halts the increment until resolved; escalates next
  reorientation to a full adversarial pass) or WARN (journal + proceed).
- Status (closed set): proposed (not yet runnable) / armed(inc NN) (goes live
  when that increment lands) / active / retired(<journal ref>).
- An empty register is valid — write "none registered". Do not invent
  ceremony.
-->

| ID | Invariant | Scope | On trip | Status |
|---|---|---|---|---|
| G1 | <SHALL NOT introduce state owners beyond the sanctioned set — blind spot: identifier-typed re-exports escape the pattern> | all | STOP | active (calibrated <date>: empty) |
| G2 | <bundle delta SHALL NOT exceed budget per increment> | footprint:src/app/** | WARN | armed(inc 01) |

Checks — verbatim commands, one fenced block per row (commands live here, NOT
in table cells, where pipes must be escaped and copy-paste silently breaks):

**G1** — expected: empty output

```bash
rg -l "from ['\"](zustand|redux|valtio)" src/
```

**G2** — expected: `<= <budget>`

```bash
<size command>
```

## Risks / Trade-offs

<!--
Format: [Risk] <description> -> Mitigation: <mitigation>
        [Trade-off] <description> -> why it's acceptable
-->

## Migration Plan

<!--
Deployment order, rollback strategy, acceptance conditions.
If no deployment change: "N/A — no deployment change."
-->

<!--
There is NO "Open Questions" section. An unknown is either a Decision Ledger
row (if it has a nameable resolving signal) or a journal entry (if it is an
observation not yet decision-shaped). No third bucket.
-->

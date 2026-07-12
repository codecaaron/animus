<!--
The INCREMENT REGISTRY — the single source of truth for decomposition state:
which increments exist, their execution mode, reviewer assignment, status,
dependencies, and file footprint. design.md carries NO increment map; this
file owns decomposition entirely.

This is also the file apply tracks for the progress bar. apply parses only the
leading `- [ ]` / `- [x]`; everything after the checkbox is registry metadata —
free-form to the parser, structured for agents. CLI wording note: the
`increments` artifact reads "done" the moment >= 1 packet file exists — that
means "seeded", not "all rows planned"; THIS registry is the only completion
truth.

Row grammar:
  - [ ] <NN> [mode:<inline|delegate> ·
    review:<self|subagent|subagent-if-available>]
    increments/<NN>-<slug>.md — resolves: <D<n>|DEF-<n>|—>,… ·
    authors: §<cap>/<Req>,…|— · deps: <NN|—> · inputs: <NN|—> ·
    footprint: <path globs>

A schema-shipped lint checks row shape and token/reference integrity — run
`node <schema-dir>/scripts/registry-lint.mjs <change-dir>` at hand-offs;
verify §2 re-runs it.

Field semantics:
  - resolves: DEF-<n> Ledger rows this increment resolves; D<n> decided-now
    decisions it implements; — for purely mechanical rows.
  - authors: — means the envelope specs already cover this row (no spec text
    owed).
  - deps: ORDERING edges only (footprint overlap / sequencing preference);
    nothing upstream changes this packet's content — the packet can be
    authored anytime.
  - inputs: INFORMATION edges — the upstream increment's OUTPUT is this
    packet's INPUT; the packet file must not exist until every inputs: row is
    ticked. Test: if the Context Capsule would reference an upstream output
    contract, the edge is inputs:, not deps:.
  - deps:/inputs: may also cite another open change's row as
    change:<name>#<row>, or an event outside any change as
    external:<kebab-slug> (e.g. external:r2-listbucket-confirmed — slugs,
    not prose: the same token must grep across Ledger, registry, journal,
    verify, and runbook) — one grammar for cross-change and external
    gates; a journal `signal` entry records when the cited row/event lands.

Lazy rows (file not yet created) replace the file path with
  (lazy — blocked on: DEF-<n>)
citing the Ledger row ID (never restated signal prose) and keep every other
field. Creating the file later requires a journal `signal` entry citing the
DEF row — no signal entry, no creation — plus all inputs: rows ticked.

Mode pre-assignment (the decision-density rule):
  - delegate: the row's decisions are settled (decided-now or resolved) and
    the work is execution-dominant.
  - inline: the increment is expected to RESOLVE deferred decisions, likely to
    SPAWN increments, or renegotiates shared semantics.
  - review:subagent is MANDATORY for delegate rows where the platform supports
    subagents (implementer must not review own work); recommended for inline
    rows, with review:self (inline adversarial stances) as fallback.
    review:subagent-if-available fits exploratory inline rows: subagent when
    capability exists, self otherwise — no mode-change ceremony either way.
  - Modes are set at row creation and revised ONLY at a reorientation
    checkpoint, with a journal `mode-change` entry stating the trigger.

Ticking rules:
  - Tick a row only when ALL hold: internal steps done, guardrail gate passed,
    spec requirements authored into specs/, Ledger rows flipped, and (delegate
    mode) the output contract merged by the orchestrator.
  - Append the evidence pointer when ticking:
    `· ticked: <journal reorientation timestamp>` — verify §2 cross-checks
    that the cited entry exists.
  - Parallel dispatch is permitted only for rows with no deps:/inputs: edge
    between them AND disjoint footprints — the footprint field makes that
    check mechanical.
  - RETIRING a lazy row is valid completion — not skipped work — when a
    reorientation entry cites the blocker and records the retirement (spikes
    that learn enough to stop end this way by design). Mark it:
    `- [x] <NN> … (retired — journal <reorientation ts>)`.
  - A single-track change has exactly one row. Expected, not a smell.

Minimal valid shapes (permission to be brief — weight scales, the graph
doesn't):

  One increment, no deferrals:
    - [ ] 01 [mode:inline · review:self] increments/01-fix.md — resolves: D1 · authors: — · deps: — · inputs: — · footprint: src/x/**
  One increment plus one ops gate:
    - [ ] 01 [mode:inline · review:self] increments/01-fix.md — resolves: D1 · authors: §cap/Req · deps: — · inputs: — · footprint: src/x/**
    - [ ] 2.1 gate:ops deploy tolerant parser before consumer — ops:OPS-1
  Two increments, ordering only (both authorable now):
    - [ ] 01 … deps: — · inputs: — · footprint: src/a/**
    - [ ] 02 … deps: 01 · inputs: — · footprint: src/a/**
  Two increments, information edge (02's packet waits for 01's output):
    - [ ] 01 … deps: — · inputs: — · footprint: src/a/**
    - [ ] 02 [mode:delegate · review:subagent] (lazy — blocked on: DEF-1) — resolves: DEF-1 · authors: §cap/Req · deps: — · inputs: 01 · footprint: src/b/**
-->

## 1. Increments

- [ ] 01 [mode:inline · review:subagent] increments/01-<slug>.md — resolves: DEF-1,D2 · authors: §<cap>/<Req-A> · deps: — · inputs: — · footprint: src/<area>/**
- [ ] 02 [mode:delegate · review:subagent] (lazy — blocked on: DEF-2) — resolves: DEF-2 · authors: §<cap>/<Req-B> · deps: — · inputs: 01 · footprint: src/<other-area>/**

## 2. Cross-cutting

<!--
Work not owned by any single increment. Rows that close OUTSIDE the repo
(deploy sequencing, IAM/scope changes, one-time jobs) carry the tag
`gate:ops` and cite the OPS-<n> runbook rows they open: tick when the
in-repo work is done AND the outstanding external steps are recorded in this
change's ops-runbook.md (from the ops-runbook.md template; preserved at
archive — apply step 5; open external steps don't block archive once
runbook'd).
-->

- [ ] 2.1 <docs / migration / shared wiring not owned by any single increment>
- [ ] 2.2 gate:ops <e.g. deploy sequencing / bucket-scope change> — ops:OPS-1,OPS-2

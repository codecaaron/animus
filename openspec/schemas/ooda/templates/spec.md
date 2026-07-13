<!--
Delta spec template — the behavior/architecture contract for a change.

This is the SINGLE delta tree archive syncs into openspec/specs/. It is
shared: the `specs` artifact seeds the envelope (invariant requirements known
up front); each increment's requirements are authored here by the ORCHESTRATOR
when the increment lands (delegated subagents draft text in their output
contract; they never write here).

TWO NAMESPACES, DIFFERENT ADMISSION TESTS:

  specs/<capability>/spec.md — BEHAVIORAL. Every requirement must pass the
  black-box test: an external tester could verify every scenario without
  reading the source. State WHAT the system does at its boundary.

  specs/arch-<domain>/spec.md — ARCHITECTURAL. Every requirement must pass the
  executable-check test: at least one scenario's THEN names a concrete,
  runnable check (rg pattern, import-graph assertion, measurable budget with
  its measurement command). "SHALL use <library>" is admissible ONLY here and
  only when backed by a structural assertion, not prose. Durable guardrails
  from design.md's Register are promoted into this namespace at archive.

PROHIBITED IN BOTH (decision-ledger leakage — verify §10 blocks on these):
  - Rationale language: "because", "as decided", "we chose", "per the design".
  - Ledger cross-references: the token D<number>, or "decision ledger".
  - Decision restatements: normative text whose only verification is reading
    the source to confirm a choice was made.
  Rationale lives in design.md §Decisions. If a requirement needs a rationale
  to make sense, it is probably a decision — move it.

Self-lint before finishing (must all return empty):
  rg -n 'SHALL (use|adopt|leverage|be implemented (with|using|in))' specs/ --glob '!arch-*/**'
  rg -in '\b(because|as decided|we chose|per the design)\b' specs/
  rg -n '\bD[0-9]+\b|[Dd]ecision [Ll]edger' specs/
Lint-1 false-positive escape: a behavioral sentence that needs "use"
semantics with no library in sight ("the first frame SHALL use the new
layout", "SHALL use canonical dot-separated event names") — rephrase with
reflect / honor / present / apply when it reads well; if rephrasing degrades
the prose, keep the sentence and DISPOSITION the match in verify §10 via the
dependency cross-check (object of "use" vs declared dependency names). Only
implementation-choice smuggling fails; never contort a good sentence to
dodge a lint.

CROSS-CHANGE DELTA DISCIPLINE: MODIFIED/REMOVED/RENAMED apply at archive by
header-matched full-text replacement — concurrent open changes targeting the
same header clobber each other, last writer wins, silently. Before authoring
one, check for collision:
  rg -l '### Requirement: <header>' openspec/changes/*/specs/
A hit in another open change = collision: push the delta to increment-time
authoring, convert MODIFIED→ADDED where semantics allow, or coordinate
archive order in both changes' Ledgers (change:<name>#<row> tokens). The
envelope SHALL NOT author MODIFIED deltas to a requirement another open
change targets.

ENVELOPE vs INCREMENT authorship: author only requirements you can FULLY
specify now. NO empty placeholders for deferred behavior — a requirement with
no scenario or no SHALL/MUST fails validation. What remains to be authored is
tracked on Increment Registry rows in tasks.md (`authors:` field), never as
stubs here. The tree grows over the change's life but is VALID at every step.

Path: openspec/changes/<change-name>/specs/<capability>/spec.md

Hard format rules (OpenSpec validates; failures are often SILENT):
- The FIRST LINE of the requirement text MUST contain SHALL or MUST — the
  validator scans only the first line, and its error message ("must contain
  SHALL or MUST") does not say so. Put the normative keyword in the first
  sentence; a SHALL on line 2 fails.
- Every requirement MUST have at least one #### Scenario:
- Scenarios MUST use level-4 (####); level-3 or bullets fail silently

Use whichever delta sections apply: ADDED / MODIFIED / REMOVED / RENAMED.
-->

## ADDED Requirements

### Requirement: <!-- requirement name -->

<!-- requirement text — contains SHALL or MUST; no rationale; correct namespace -->

#### Scenario: <!-- scenario name -->

- **WHEN** <!-- condition -->
- **THEN** <!-- expected outcome — for arch-*: the executable check + expected result -->

---

## MODIFIED Requirements

<!--
Use the EXACT same normalized header as in openspec/specs/<capability>/spec.md
(case-sensitive after trimming), or the delta apply at archive fails to match.
Paste the FULL updated content — OpenSpec applies MODIFIED by full-text
replacement.
-->

### Requirement: <!-- same header as the existing spec -->

<!-- full updated requirement text — contains SHALL or MUST -->

#### Scenario: <!-- scenario name (may add or modify) -->

- **WHEN** <!-- condition -->
- **THEN** <!-- expected outcome -->

---

## REMOVED Requirements

<!-- MUST include Reason and Migration. -->

### Requirement: <!-- header to remove, exactly matching the existing spec -->

**Reason**: <!-- why it's removed -->

**Migration**: <!-- how existing callers / dependents should adjust -->

---

## RENAMED Requirements

<!--
Fixed format: FROM / TO. If name AND content both change, list the rename here
AND write the full updated content under MODIFIED using the NEW header.
Apply order at archive: RENAMED -> REMOVED -> MODIFIED -> ADDED
-->

- FROM: `### Requirement: <Old Name>`
- TO: `### Requirement: <New Name>`

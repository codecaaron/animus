# Increment 10: style-bisect

## Scope

- **Registry row**: 10 · mode: delegate · review: subagent
- **Resolves**: — (implements enveloped `specs/style-history-bisect/spec.md`)
- **Authors**: — (envelope)
- **Depends on (deps:)**: 09 (ledger — ordering only; see interface note)
- **Inputs from (inputs:)**: none
- **Footprint**: `packages/_verify/src/bisect/**`

## Context Capsule

Read first: `specs/style-history-bisect/spec.md` and
`specs/universe-snapshot-ledger/spec.md` (the comparison contract bisect
consumes); `design.md` §D6.

Interface note (dependency inversion): bisect consumes a narrow
`LedgerReader` interface defined IN THIS increment —
`get(commit): Snapshot | null` and `diff(a: Snapshot, b: Snapshot):
UniverseDiff` — whose semantics are fixed by the ledger *spec*
(content-addressed, stamped, comparable without re-analysis). Increment 09
implements the interface; this packet tests against an in-memory fake
honoring the spec, so it is authorable and testable before 09 lands. The
`deps: 09` edge is ordering for real-history integration only.

Repo facts:
- Predicate shape: a function over `SessionIndex`-style snapshot state (e.g.
  "winning `color` declaration for component X is D"), supplied by the
  caller; bisect owns only the search and the honesty rules.
- Honesty rules (spec): missing coverage narrows to a bounded range —
  never assert a single commit across a gap; cross-stamp comparisons
  (different engine identity / schema version) mark conclusions
  `conditional` (ledger spec §Cross-stamp comparison honesty).

## Plan

- [ ] 1. Failing test: over a fake ledger of 8 sequential snapshots where the predicate flips at index 5, bisect returns the index-5 commit with the diff at that commit as evidence.
- [ ] 2. Implement `bisect/bisect.ts` (binary search over the reader). PASS.
- [ ] 3. Failing test: with snapshots missing for indexes 4–6 and on-demand analysis unavailable, the result reports bounding commits 3 and 7 and the coverage gap; no single commit asserted.
- [ ] 4. Implement the degradation path. PASS.
- [ ] 5. Failing test: a range whose snapshots change engine identity mid-way yields `conditional`-marked conclusions naming the stamp difference.
- [ ] 6. Implement stamp checking. PASS.
- [ ] 7. Checkpoint: `vp run verify:compile && bunx vp test run packages/_verify/__tests__/`; expected: PASS.

## Guardrail gate

Active package guardrails run in the suite; no new rows arm here.

## Spec authorship checklist

- [x] — (envelope)

## Output contract (delegate)

Return: (a) the `LedgerReader` interface (paste — increment 09 must
implement it verbatim or journal a `friction` entry), (b) test names + PASS
tails, (c) journal candidates. Do not edit spec files.

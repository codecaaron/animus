# Increment 02: flip-defaults

## Scope

- **Registry row**: 02 · mode: inline · review: subagent
- **Resolves** (Decision Ledger rows): DEF-1 (A3 residue — decided at
  this row's review), DEF-3 (release timing — the ship-and-flip event is
  this apply; flips to resolved at this row's tick)
- **Authors** (spec requirements): §vite-extraction-plugin/v2 is the
  default extraction engine, §next-config-wrapper/v2 is the default
  extraction engine — both already authored into specs/ at propose
  (envelope); this increment implements them.
- **Depends on (ordering — deps:)**: increment 01
- **Inputs from (information — inputs:)**: increment 01 — consumes: the
  release pipeline ships both binaries; consumer build tiers
  (build-vite.sh, build-next.sh, build-showcase.sh) hard-require the v2
  binary; postpack smoke G3 green.
- **Footprint**: packages/vite-plugin/src/**, packages/next-plugin/src/**,
  e2e/**, packages/showcase/vite.config.ts,
  openspec/changes/extract-v2-default-flip/**
- **Pushes to a later increment**: Proxy retirement + archived-tool
  pointer cleanup → row 03 (blocked on DEF-1, resolved here).

> Resolving signal that licensed creating this increment now: DEF-3 —
> journal `signal` entry 2026-07-13 02:59 (external:release-window);
> inputs row 01 ticked before this packet executes.

## Context Capsule

- **Objective**: `animusExtract` (vite) and `withAnimus` (next) default
  `engine` to `'v2'`; `'v1'` stays selectable and functional. The
  vite-app and next-app fixtures follow the new default with
  `ANIMUS_ENGINE=v1` as the escape hatch (showcase already flipped).
  All three consumer proofs pass on v2-default AND on the v1 escape
  hatch (G4).
- **In-scope guardrails** (from design.md Register):
  - G1: SHALL NOT weaken verify:parity — check:
    `rg -c 'cli.ts|seam-battery' scripts/verify/parity.sh` (>=5) and
    `bash scripts/verify/parity.sh | tail -1` = `PARITY GATE: PASS` — STOP
  - G2: SHALL NOT remove v1 or its loader — check:
    `test -f packages/extract/index.js && test -f packages/extract/src/lib.rs && rg -q 'load_system_module' packages/extract/src/lib.rs` — STOP
  - G4: SHALL NOT break the `ANIMUS_ENGINE=v1` escape hatch on any
    fixture — check: `ANIMUS_ENGINE=v1 bash scripts/verify/build-vite.sh && ANIMUS_ENGINE=v1 bash scripts/verify/build-showcase.sh && ANIMUS_ENGINE=v1 bash scripts/verify/build-next.sh` — STOP
- **Requirements to draft**: none new — envelope specs cover this row.
- **Existing spec context**: change-level
  specs/vite-extraction-plugin/spec.md (default v2 + escape-hatch
  scenario), specs/next-config-wrapper/spec.md (default v2).
- **Relevant resolved decisions**: D1 (one release event — this is the
  flip half); D2 (escape hatch outlives the flip: `engine: 'v1'` and
  `ANIMUS_ENGINE=v1` stay functional).
- **Upstream inputs**: from 01 — both binaries ship; build-vite/next/
  showcase tiers hard-require the v2 binary; postpack smoke green.
- **In-scope North Star criteria**: NS1 (upgrading consumers observe
  nothing but faster dev loops; config-reversible), NS2 (differential
  harness untouched).
- **Prohibitions**: no version-control commands; no writes outside the
  footprint plus this file; design.md/tasks.md/journal.md/specs writes
  are orchestrator-only.
- **Ground truth (verified 2026-07-13)**:
  - `packages/vite-plugin/src/index.ts`: option doc at the `engine?:`
    field says "`'v1'` (default) is the production engine … @default
    'v1'". `animusExtract` computes
    `engineModuleId = options.engine === 'v2' ? '@animus-ui/extract/engine-v2' : '@animus-ui/extract'`
    and `engineApi()` short-circuits on `options.engine !== 'v2'`.
    These are the only two `options.engine` reads (locate via
    `rg -n 'options\.engine' packages/vite-plugin/src/index.ts`).
  - `packages/next-plugin/src/plugin.ts`: `setSharedEngine(options.engine ?? 'v1')`
    (locate via `rg -n "options.engine \?\? 'v1'" packages/next-plugin/src`).
  - `packages/next-plugin/src/types.ts`: `engine?:` doc mirrors the v1
    default language.
  - `e2e/vite-app/vite.config.ts` and `e2e/next-app/next.config.ts`:
    `engine: process.env.ANIMUS_ENGINE === 'v2' ? 'v2' : 'v1'` with a
    comment naming `ANIMUS_ENGINE=v2` as the opt-in.
  - `packages/showcase/vite.config.ts`: already
    `engine: process.env.ANIMUS_ENGINE === 'v1' ? 'v1' : 'v2'` — the
    target shape for the two fixtures; needs NO change.
  - A3 residue (DEF-1 context): v2 `transformFile` emits from
    ANALYZE-TIME sources; an upstream plugin transform between hooks is
    reverted; both adapters carry warn-only drift detection
    (`v2SentSources` / drift warning). Fixture dists prove no consumer
    ordering trips it today.

## Plan

## Task 02.1: vite-plugin default flip

- [x] **Step 1:** In `packages/vite-plugin/src/index.ts`, inside
  `animusExtract`, introduce a resolved engine and use it at both read
  sites:

```ts
  // Single engine choke-point: every native extraction call resolves its
  // module through here, so the `engine` option is honored uniformly.
  // Default is v2 (extract-v2-default-flip); 'v1' stays selectable until
  // v1 retires.
  const resolvedEngine: 'v1' | 'v2' = options.engine ?? 'v2';
  const engineModuleId =
    resolvedEngine === 'v2'
      ? '@animus-ui/extract/engine-v2'
      : '@animus-ui/extract';
```

  and in `engineApi`: `if (resolvedEngine !== 'v2') return requireEngine();`

- [x] **Step 2:** Update the `engine?:` option doc on
  `AnimusExtractOptions`:

```ts
  /**
   * Extraction engine selection. `'v2'` (default) is the production
   * engine — 8× fewer parses, no cache machinery. `'v1'` remains
   * selectable and functional as the escape hatch until v1 retires.
   *
   * @default 'v2'
   */
  engine?: 'v1' | 'v2';
```

- [x] **Step 3:** `rg -n 'options\.engine' packages/vite-plugin/src/` —
  expected: no remaining behavioral reads outside the `resolvedEngine`
  assignment.
- [x] **Step 4:** Check plugin tests for default-engine assumptions:
  `rg -n "engine" packages/vite-plugin/tests/` — update any test that
  asserts a v1 default; tests selecting `engine: 'v1'` explicitly stay
  valid.

## Task 02.2: next-plugin default flip

- [x] **Step 1:** In `packages/next-plugin/src/plugin.ts`, change
  `setSharedEngine(options.engine ?? 'v1');` →
  `setSharedEngine(options.engine ?? 'v2');`
- [x] **Step 2:** In `packages/next-plugin/src/types.ts`, update the
  `engine?:` doc to the same v2-default text as Task 02.1 Step 2.

## Task 02.3: fixture flips (escape-hatch polarity)

- [x] **Step 1:** `e2e/vite-app/vite.config.ts`:

```ts
      // Escape hatch: ANIMUS_ENGINE=v1 vp run verify:vite
      engine: process.env.ANIMUS_ENGINE === 'v1' ? 'v1' : 'v2',
```

- [x] **Step 2:** `e2e/next-app/next.config.ts`:

```ts
  // Escape hatch: ANIMUS_ENGINE=v1 vp run verify:next
  engine: process.env.ANIMUS_ENGINE === 'v1' ? 'v1' : 'v2',
```

- [x] **Step 3:** `packages/showcase/vite.config.ts` — verify already in
  target shape; no edit.

## Task 02.4: rebuild + proofs

- [x] **Step 1:** `vp run verify:compile` — expected: green.
- [x] **Step 2:** `vp run verify:unit:ts` — expected: green.
- [x] **Step 3:** Rebuild plugin dists so fixtures consume the flip:
  `bun run --filter './packages/vite-plugin' build && bun run --filter './packages/next-plugin' build`.
- [x] **Step 4:** Default-path proofs (v2 default):
  `vp run verify:vite && vp run verify:next && vp run verify:showcase` —
  expected: builds + positional assertions green on all three.
- [x] **Step 5:** G4 escape hatch: `ANIMUS_ENGINE=v1` builds of all three
  fixtures (command in guardrail gate) — expected: green.

## Task 02.5: DEF-1 disposition (at review)

- [x] **Step 1:** Subagent review of the flip diff, explicitly charged
  with the DEF-1 question: accept-and-document the A3 residue (v2
  emits from analyze-time sources; upstream mid-chain transforms are
  reverted with warn-only drift detection) vs demand engine-level
  transform-time-source support before the flip lands.
- [x] **Step 2 (orchestrator):** record the disposition in design.md
  (new D-row; flip DEF-1 and DEF-3 to resolved), journal the review +
  reorientation, tick row 02.

## Guardrail gate

- [x] G1: parity invocation count >=5 AND `PARITY GATE: PASS` — result: pass (count=6; `PARITY GATE: PASS`, 2026-07-13 03:19)
- [x] G2: v1 + loader present — result: pass (exit 0, 2026-07-13 03:19)
- [x] G4: `ANIMUS_ENGINE=v1` builds of vite-app, showcase, next-app — result: pass (all three green, 2026-07-13 03:17; default-path verify:vite/next/showcase also green 03:12-03:16)

## Output contract (inline mode — collapsed into the checklists above)

- [x] Plan checkboxes ticked to reflect actual completion
- [x] Guardrail gate results recorded with output excerpts
- [x] Review subagent verdict on DEF-1 recorded: APPROVE / ACCEPT-AND-DOCUMENT (journal 2026-07-13 03:20)
- [x] Proposed journal entries: review + signal + reorientation appended
- [x] Surfaced variables: delta-spec ADDED-vs-MODIFIED contradiction (fixed inline by orchestrator); drift-latch weakness (documented as D4 rider)

## Spec authorship checklist (orchestrator)

- [x] Specs: rewrote both delta specs from ADDED to MODIFIED against the
      existing `Engine selection option` requirement (review finding 1);
      `openspec validate` green
- [x] Flipped DEF-1 → D4 and DEF-3 → D5 in design.md; promoted into
      §Decisions
- [x] Journal entries appended (review verdict attributed to inc 02
      review subagent)
- [x] Reorientation entry written (full adversarial pass — stances from
      the review: falsifier / entropy auditor / heretic)
- [x] Ticked registry row 02 in tasks.md with `· ticked: 2026-07-13 03:20`

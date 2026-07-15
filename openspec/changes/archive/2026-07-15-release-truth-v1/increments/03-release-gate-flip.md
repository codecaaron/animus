# Increment 03: release-gate-flip

## Scope

- **Registry row**: 03 · mode: delegate · review: subagent
- **Resolves**: D1 (the gate-expansion half)
- **Authors**: — (envelope: §release-workflow/Release gate composition
  already authored)
- **Depends on (ordering — deps:)**: 01 (verify-next/verify-vite jobs must
  exist), 02 (the `verify:packed` tier must exist)
- **Inputs from (information — inputs:)**: none (job names and the needs
  set are fixed by D1; nothing in this packet consumes upstream outputs)
- **Footprint**: `.github/workflows/ci.yaml`
- **Pushes to a later increment**: none

> Resolving signal: envelope-licensed (implements decided-now D1).

## Context Capsule

- **Objective**: Add a `verify-packed` CI job and expand the `release`
  job's `needs` from `verify` alone to the full blocking set:
  `[lint, hygiene-rust, verify, verify-next, verify-vite, verify-packed]`.
  After this lands, no publish can occur with any blocking lane red.
- **In-scope guardrails** (from design.md Register):
  - G1: release SHALL NOT gate on fewer than the full blocking set — check:
    `rg -n "^  release:" -A 2 .github/workflows/ci.yaml` — expected: the
    `needs:` array contains all six job ids — STOP
- **Requirements to draft**: none — envelope covers.
- **Existing spec context**: change-level `specs/release-workflow/spec.md`
  → "Release gate composition".
- **Relevant resolved decisions**: D1 — full set; lanes run on every push;
  vinext/react-router/dry-run lanes stay OUTSIDE this gate.
- **Repo facts a cold agent needs**:
  - Existing job ids in `.github/workflows/ci.yaml`: `lint`, `test-rust`,
    `hygiene-rust`, `build-extract`, `verify`, `release`. Increment 01
    added `verify-next` and `verify-vite`. `verify` already `needs:
    [build-extract, test-rust]`, so `test-rust` is transitively gating.
  - The `verify-packed` job mirrors the `verify-next` skeleton (checkout,
    setup-node/bun via `.tool-versions`, download BOTH linux-x64 NAPI
    artifacts, `bun install`, `bunx vp run build:ts`) with the final step
    `bunx vp run verify:packed`. The packed lane uses npm for the staging
    install — npm ships with the setup-node runner; no extra setup step.
  - The `release` job's `if:` condition (tag push or dispatch) stays
    unchanged; only `needs:` changes.
- **In-scope North Star criteria**: NS2 (the point of the increment).
- **Prohibitions**: no version-control commands; no writes outside
  `.github/workflows/ci.yaml` and this file; never write to design.md,
  tasks.md, journal.md, or specs/ — return drafts in the output contract.

## Plan

## Task 03.1: Add the `verify-packed` job

- [x] **Step 1: Prove the tier passes locally.**

Run: `bunx vp run verify:packed`
Expected: exit 0 (increment 02 landed it). On `ERROR: X missing. Run: Y`,
run the named command and retry.

Result: PASS (exit 0). Tail: `[verify:packed] receipts written:
verify:packed:vite=v2, verify:packed:next=v2` /
`[packed-app:assert:vite] 1 CSS file(s), 1 JS file(s) validated` /
`[packed-app:assert:next] 1 CSS file(s), 14 JS file(s) validated` /
`[packed-app:assert] all assertions passed`. npm ERESOLVE did NOT
fire — the clamped peer ranges install cleanly.

- [x] **Step 2: Add the job to `.github/workflows/ci.yaml`,** directly
below the `verify-vite` job, same skeleton, job id `verify-packed`:

```yaml
  verify-packed:
    needs: [build-extract]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: .tool-versions

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .tool-versions

      - name: Download linux binary
        uses: actions/download-artifact@v4
        with:
          name: napi-x86_64-unknown-linux-gnu
          path: packages/extract/

      - name: Download v2 linux binary
        uses: actions/download-artifact@v4
        with:
          name: napi-v2-x86_64-unknown-linux-gnu
          path: packages/extract/crates/extract-v2/

      - run: bun install

      - name: Build TS
        run: bunx vp run build:ts

      - name: Packed consumer lane
        run: bunx vp run verify:packed
```

## Task 03.2: Flip the gate

- [x] **Step 1: Expand `release.needs`.** Locate via
`rg -n "^  release:" .github/workflows/ci.yaml` and change:

```yaml
  release:
    needs: verify
```

to:

```yaml
  release:
    needs: [lint, hygiene-rust, verify, verify-next, verify-vite, verify-packed]
```

- [x] **Step 2: Validate the workflow YAML parses.**

Run: `bunx yaml-lint .github/workflows/ci.yaml`
Expected: no errors.

Result: PASS — `✔ YAML Lint successful.` (exit 0).

- [x] **Step 3: Run the G1 check** (fenced below) and record the output.

Logical checkpoint: next tag push (or workflow dispatch) shows `release`
waiting on all six jobs.

## Guardrail gate

- [x] G1: `rg -n "^  release:" -A 2 .github/workflows/ci.yaml` — result:
      PASS. Output:
      ```
      320:  release:
      321-    needs: [lint, hygiene-rust, verify, verify-next, verify-vite, verify-packed]
      322-    if: startsWith(github.ref, 'refs/tags/v') || github.event_name == 'workflow_dispatch'
      ```
      `needs:` contains all six blocking job ids (lint, hygiene-rust,
      verify, verify-next, verify-vite, verify-packed). Not a TRIP.

## Output contract (delegate mode)

- [x] Plan checkboxes above ticked to reflect actual completion
- [x] Drafted requirement text: none owed (`authors: —`)
- [x] Guardrail gate results recorded with command output
- [x] Proposed journal entries (surprise / friction), 1–3 lines each — see below
- [x] Surfaced variables (spawn candidates): none

### Proposed journal entries (for orchestrator to append, attributed `via inc 03 subagent`)

1. Friction (low): the packed lane is slow (~4 min locally) because it does
   a full npm staging install plus a Next.js prod build; it is the single
   longest inner-loop verify tier. In CI it parallelizes with verify-next /
   verify-vite (all `needs: [build-extract]`), so wall-clock cost is hidden.
2. Surprise (confirming, not alarming): Step 1 doubles as the live install
   proof of the clamped peer ranges (vite >=8 <9, next >=15 <16,
   webpack >=5 <6) — npm ERESOLVE did NOT fire, so the clamps resolve
   cleanly under npm's stricter peer solver.
3. Note: `release.needs` flipped from a bare scalar (`verify`) to the full
   six-id array; `verify` transitively pulls `build-extract` + `test-rust`,
   but `lint` and `hygiene-rust` were previously ungated by release and are
   now hard blockers — this is the intended D1 semantics (NS2).

### Surfaced variables (spawn candidates)

none

## Spec authorship checklist (orchestrator; the tie-back before ticking)

- [ ] No spec text owed (envelope covers)
- [ ] No Ledger rows to flip
- [ ] Appended accepted journal entries (attributed `via inc 03 subagent`)
- [ ] Reorientation entry written — this increment closes a STOP-armed
      guardrail (G1); per cadence, K=3 lands here: run the FULL
      three-stance adversarial pass
- [ ] Ticked registry row 03 in tasks.md with `· ticked: <timestamp>`

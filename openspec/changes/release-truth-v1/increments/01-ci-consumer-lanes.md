# Increment 01: ci-consumer-lanes

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1 (the consumer-lanes-on-every-push half; the gate flip is increment 03)
- **Authors**: — (envelope: §release-workflow/Consumer lanes run on every push already authored)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `.github/workflows/ci.yaml`
- **Pushes to a later increment**: the `release.needs` expansion (increment 03)

> Resolving signal: envelope-licensed (implements decided-now D1; no DEF row).

## Context Capsule

- **Objective**: Add two CI jobs, `verify-next` and `verify-vite`, to
  `.github/workflows/ci.yaml`, running `vp run verify:next` and
  `vp run verify:vite` on every workflow trigger (push to main/next, `v*`
  tags, PRs, dispatch). They do NOT yet gate `release` — that is increment 03.
- **In-scope guardrails**: none per-increment (G1 arms at increment 03).
- **Requirements to draft**: none — envelope specs cover this row.
- **Existing spec context**: change-level
  `specs/release-workflow/spec.md` → "Consumer lanes run on every push".
- **Relevant resolved decisions**: D1 — lanes run on every push, parallel to
  `verify`, sharing `build-extract` artifacts.
- **Repo facts a cold agent needs**:
  - The task graph already defines both tiers (locate in `vite.config.ts`
    via `rg -n "'verify:next'|'verify:vite'" vite.config.ts`): each runs
    `bash scripts/verify/assert-*.sh` with a `dependsOn` on its
    `verify:build:*` task, so `vp run verify:next` performs build + assert.
  - Tier preconditions (see `scripts/verify/_preconditions.sh`): fresh v1
    NAPI binary at `packages/extract/*.node`, fresh v2 binary at
    `packages/extract/crates/extract-v2/*.node`, fresh `dist/` for the
    packages involved. In CI these are satisfied by downloading the
    `build-extract` artifacts and running `bunx vp run build:ts`.
  - Mirror the existing `verify` job's setup skeleton exactly (locate via
    `rg -n "^  verify:" -A 30 .github/workflows/ci.yaml`): checkout,
    setup-node with `node-version-file: .tool-versions`, setup-bun with
    `bun-version-file: .tool-versions`, download the two linux-x64
    artifacts (`napi-x86_64-unknown-linux-gnu` → `packages/extract/`,
    `napi-v2-x86_64-unknown-linux-gnu` →
    `packages/extract/crates/extract-v2/`), `bun install`, then build/run.
  - The new jobs need `needs: [build-extract]` only (`verify` additionally
    needs `test-rust`; the consumer lanes have no Rust-test dependency).
- **In-scope North Star criteria**: NS2 (release gate superset — this
  increment creates the lanes the gate will require).
- **Prohibitions**: no version-control commands; no writes outside
  `.github/workflows/ci.yaml` and this file; never write to design.md,
  tasks.md, journal.md, or specs/ — return drafts in the output contract.

## Plan

## Task 01.1: Add the two consumer-lane jobs

- [x] **Step 1: Prove both tiers pass locally before touching CI.**

Run: `bunx vp run verify:next && bunx vp run verify:vite`
Expected: both exit 0. If a precondition error appears
(`ERROR: X missing. Run: Y`), run the named command and retry — do not
proceed with failing lanes.

- [x] **Step 2: Add the `verify-next` job to `.github/workflows/ci.yaml`.**

Insert after the existing `verify:` job block (locate its end via
`rg -n "Showcase Build \+ Assert" .github/workflows/ci.yaml`), at the same
indentation level as other jobs:

```yaml
  verify-next:
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

      - name: Next consumer lane
        run: bunx vp run verify:next
```

- [x] **Step 3: Add the `verify-vite` job.**

Identical block directly below `verify-next`, with the job id `verify-vite`,
the final step name `Vite consumer lane`, and the final command
`bunx vp run verify:vite`.

- [x] **Step 4: Validate the workflow YAML parses.**

Run: `bun -e "const y = await Bun.file('.github/workflows/ci.yaml').text(); Bun.YAML ? Bun.YAML.parse(y) : (await import('yaml')).parse(y); console.log('yaml ok')"`
Expected: `yaml ok`. If neither parser is available, fall back to:
`bunx yaml-lint .github/workflows/ci.yaml` — expected: no errors.

- [x] **Step 5: Confirm the release gate is untouched.**

Run: `rg -n "^  release:" -A 2 .github/workflows/ci.yaml`
Expected: still `needs: verify` (the flip is increment 03; changing it here
is out of footprint).

Logical checkpoint: CI on the next push shows `verify-next` and
`verify-vite` as new jobs, green, not gating `release`.

## Guardrail gate

- [x] No per-increment guardrails in scope. Record "none in scope" in the
      output contract.

## Output contract (delegate mode)

- [x] Plan checkboxes above ticked to reflect actual completion
- [x] Drafted requirement text: none owed (`authors: —`)
- [x] Guardrail gate results recorded (expected: "none in scope")
- [x] Proposed journal entries (surprise / friction), 1–3 lines each —
      especially any local tier failure found in Step 1
- [x] Surfaced variables (spawn candidates), or "none"

## Spec authorship checklist (orchestrator; the tie-back before ticking)

- [x] No spec text owed (envelope covers) — but reviewer falsifier objection
      led to a delta-spec reword: "Consumer lanes run on every push" →
      "Consumer lanes run on every CI run" (trigger-set reality)
- [x] No Ledger rows to flip
- [x] Appended accepted journal entries (attributed `via inc 01 subagent`)
- [x] Reorientation entry written (full three-stance pass, 2026-07-14 20:29)
- [x] Ticked registry row 01 in tasks.md with `· ticked: 2026-07-14 20:29`

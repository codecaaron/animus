## Why

Releases are gated on a subset of local verification: the `release` job needs only `verify`, so lint, Rust hygiene, and the Next/Vite consumer lanes cannot block a publish — and no lane anywhere exercises the packed npm artifacts consumers actually install (every fixture uses `workspace:*`). Meanwhile peer ranges promise majors no fixture proves (`vite >=5`, `next >=14`, including Next 16 Turbopack, which is known-unsupported). With the v2 engine transplant in flight (showcase flipped 2026-07-13), an evidence-backed release gate is the cheapest way to make every support claim reproducible and to derisk the flip.

## What Changes

- Extend the CI release gate to require lint, Rust hygiene, the existing `verify` job, `verify:next`, `verify:vite`, and the new `verify:packed`.
- Add a `verify:packed` tier: pack all five publishables, run `publint` and Are the Types Wrong against the tarballs, install into an isolated non-workspace consumer, and exercise each entrypoint's supported module mode, published declarations, Vite and Next builds, and the existing output assertions.
- Prove both shipped extractor engines load from the packed install and record which engine each consumer defaults to.
- Clamp plugin peer ranges to fixture-proven majors: `vite >=8 <9`, `next >=15 <16`.
- Record engine loaded / default engine / override used / package form (workspace vs packed) in verification results while v1 and v2 coexist.
- Add Change-Type Map and tier-table rows to root `CLAUDE.md` for the new tier and consumer (ownership rule).
- Record the sequencing policy — compiler-fortress work (fuzzing, IR schemas, perf budgets, `animus doctor`) deferred behind the v2 default flip — in design.md deferrals.

## Capabilities

### New Capabilities

- `packed-consumer-verification`: packing all publishable packages, tarball lint (publint/attw), isolated non-workspace installation, supported-mode and declaration loading proof, dual-engine load proof, and packed Vite/Next build + assertion lanes.
- `peer-range-policy`: peer dependency ranges derive from fixture evidence — no major appears in a published peer range without a blocking fixture proving it.

### Modified Capabilities

- `release-workflow`: the release gate's required-job set expands from `verify` alone to the full blocking set (lint, Rust hygiene, verify, next/vite consumer lanes, packed lane).
- `verification-tier-policy`: adds the `verify:packed` atomic tier and makes `verify:next`/`verify:vite` CI-blocking lanes.
- `dual-engine-build`: engine identity (loaded / default / override) and package form become recorded compatibility dimensions in verification results.

## Impact

- `.github/workflows/ci.yaml` — new `verify:next`/`verify:vite`/`verify:packed` jobs; `release.needs` expands.
- `vite.config.ts` — `verify:packed` task added to the `run.tasks` graph.
- `packages/vite-plugin/package.json`, `packages/next-plugin/package.json` — peer range clamps (manifest-only; no runtime code changes).
- New isolated packed consumer fixture (non-workspace, e.g. `e2e/packed-app/`) reusing `@animus-ui/assertions` and the existing fixture app sources.
- Root `CLAUDE.md` — atomic-tier table, composite table if applicable, and Change-Type Map rows.
- Dev-dependency additions: `publint`, `@arethetypeswrong/cli`.
- No changes to published runtime code; no new native targets; no new hosts.

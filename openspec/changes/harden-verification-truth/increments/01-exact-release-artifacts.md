# Increment 01: Exact release artifacts

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1, D2, D3
- **Authors**: — (envelope)
- **Depends on**: none
- **Inputs from**: none
- **Footprint**: `.github/workflows/ci.yaml`, `scripts/verify/packed.sh`, `scripts/verify/postpack-smoke.sh`, `scripts/verify/packed-graph.*`, `e2e/packed-app/**`, publishable `package.json` files, `bun.lock`
- **Pushes to a later increment**: none

> Envelope-licensed: all decisions are settled in D1-D3.

## Context Capsule

- **Objective**: Make one release-materialized tarball set the input to packed
  verification and the argument to npm publication. Remove the packed
  fixture's internal overrides and make stale or substituted internal package
  edges fail with path/version evidence. Add one supported Worker consumer CI
  job and require it before release.
- **Existing implementation**:
  - In `scripts/verify/packed.sh`, locate `PKGS`, the section `1. Pack +
    workspace-specifier guard`, isolated install, version assertions, tarball
    lint, and packed receipts. The script currently always packs workspace
    directories with Bun.
  - `e2e/packed-app/package.json` declares the five tarballs in both
    `dependencies` and `overrides`; the overrides are the masking mechanism.
  - In `.github/workflows/ci.yaml`, release stamps manifests, rebuilds, downloads
    native binaries, runs only `postpack-smoke.sh`, generates platform package
    directories, then publishes directories.
  - The existing focused Worker commands are `verify:workers:contracts`,
    `verify:{showcase,vite,vinext,react-router}`, and
    `verify:dry-run:{showcase,vite,vinext,react-router}`.
- **In-scope guardrails**:
  - G1: packed verification SHALL NOT mask internal edges — `jq -e '((.overrides // {}) | keys | length) == 0' e2e/packed-app/package.json` — STOP.
  - G2: release SHALL NOT publish directories after testing other bytes — `rg -n 'npm publish .*\.tgz' .github/workflows/ci.yaml` — STOP.
- **Requirements**: envelope requirements in
  `specs/packed-consumer-verification/spec.md` and
  `specs/release-workflow/spec.md`.
- **Resolved decisions**: D1 pack once after materialization; D2 unmasked graph;
  D3 one Worker matrix job.
- **Upstream inputs**: none.
- **North Star**: NS1 exact artifact/path; NS4 smallest black-box proof; NS5
  release-local packed proof is provisional.
- **Prohibitions**: no version-control commands; no workflow/source-string
  contract tests; no writes outside the footprint or this packet; do not edit
  shared change artifacts.

## Plan

## Task 01.1: Make internal package-graph validation executable

- [ ] **Step 1 (RED):** Create `scripts/verify/packed-graph.test.ts` with a
  fixture map where `next-plugin@0.1.1` declares `extract@0.1.0` while the
  tested extract tarball is `0.1.1`; assert the validator returns a diagnostic
  containing dependent, dependency, expected, and declared versions. Add a
  second temporary-directory fixture with a nested mismatched
  `node_modules/**/@animus-ui/extract/package.json`. Run
  `bunx vp test run scripts/verify/packed-graph.test.ts`; expected: FAIL because
  `packed-graph.ts` does not exist.
- [ ] **Step 2 (GREEN):** Create `scripts/verify/packed-graph.ts` exporting
  `validateInternalManifestEdges(manifests)` and
  `validateInstalledInternalGraph(root, expectedVersions)`. Limit internal
  names to the five publishables plus extract platform packages; return
  structured diagnostics and make the CLI print them before exiting non-zero.
  Run the targeted test; expected: PASS.
- [ ] **Step 3:** Register `scripts/verify/packed-graph.test.ts` in the existing
  TypeScript unit tier without adding a second test registry. Run the targeted
  test through its owning tier.

## Task 01.2: Verify either locally packed or supplied immutable tarballs

- [ ] **Step 1 (RED):** Extend the graph tests with argument parsing cases for
  `--tarballs-dir <path>`: a complete five-file set resolves exact paths; a
  missing file identifies the package; unknown flags fail. Run the targeted
  test and observe the missing behavior.
- [ ] **Step 2 (GREEN):** Modify `scripts/verify/packed.sh` so default mode packs
  into staging once, while supplied mode copies the five provided tarballs into
  stable staging names without invoking any pack command. Ensure publint/attw,
  installation, typecheck, builds, assertions, and receipts consume those
  stable files. If publint cannot inspect `.tgz` directly, unpack each supplied
  tarball and lint that unpacked tree; never repack it.
- [ ] **Step 3:** Remove `overrides` from `e2e/packed-app/package.json`. Invoke
  the manifest-edge validator before install and the recursive installed-graph
  validator after install. Fix the current internal version source (manifest or
  lock state) so default local packing produces a coherent graph rather than
  weakening the validator.
- [ ] **Step 4:** Extend `scripts/verify/postpack-smoke.sh` with an optional
  `--tarball <path>` input that inspects the supplied extract tarball without
  repacking. Retain local default mode for developer use.
- [ ] **Step 5:** Run `bunx vp test run scripts/verify/packed-graph.test.ts`, then
  run `vp run verify:packed` when its documented fresh artifacts are available.
  Record any unavailable upstream artifact as a real blocker, not a silent
  rebuild.

## Task 01.3: Materialize, verify, and publish one release bundle

- [ ] **Step 1:** In `.github/workflows/ci.yaml`, move platform-package
  generation before the final packed proof. After manifest stamping, TS build,
  and binary download, run `npm pack --pack-destination` for the five
  publishables and each platform package into one release bundle directory.
- [ ] **Step 2:** Run `postpack-smoke.sh --tarball <exact-extract-tgz>
  --expect-full-matrix` and `packed.sh --tarballs-dir <release-bundle>` before
  any publish command.
- [ ] **Step 3:** Replace every directory publish with `npm publish
  <release-bundle/exact-file.tgz> --access public --tag "$NPM_TAG"`, preserving
  platform-first and package dependency order. Do not run a pack lifecycle
  after verification.
- [ ] **Step 4:** Add a `verify-workers` CI job that downloads both Linux
  binaries, installs/builds TS, executes the Worker contract tier and all four
  build/assert/dry-run pairs. Add only this job name to `release.needs`.
- [ ] **Step 5:** Run YAML parsing through the repository's existing workflow
  tooling if present, then run the focused local task graph
  `vp run verify:workers:contracts`. Do not add a test that searches YAML text.

## Guardrail gate

- [ ] G1: `jq -e '((.overrides // {}) | keys | length) == 0' e2e/packed-app/package.json` — result:
- [ ] G2: `rg -n 'npm publish .*\.tgz' .github/workflows/ci.yaml` — result:

## Output contract

- [ ] Plan checkboxes reflect actual completion and RED/GREEN evidence
- [ ] Guardrail outputs recorded
- [ ] Focused test and available packed/Worker commands reported with exit codes
- [ ] Proposed journal entries supplied; surfaced variables listed or `none`
- [ ] Diff stays inside the declared footprint and preserves pre-existing edits

## Spec authorship checklist

- [ ] Envelope requirements remain sufficient; no new spec text required
- [ ] No Decision Ledger row is resolved by this increment
- [ ] Orchestrator appends accepted journal entries and reorientation
- [ ] Orchestrator ticks registry row with the journal timestamp


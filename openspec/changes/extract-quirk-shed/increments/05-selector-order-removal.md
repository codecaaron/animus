# Increment 05: selector-order-removal

## Scope

- **Registry row**: 05 · mode: inline · review: self
- **Resolves**: DEF-1 (selectorOrder wire-vs-remove → REMOVE, per probe
  signal journaled 2026-07-13 03:25)
- **Authors**: — (removal; the builder-chain capability change is
  API-subtractive. Proposal note: "builder-chain: selectorOrder
  requirement is added or the surface is removed from the builder API"
  — removal path needs no ADDED requirement; orchestrator checks main
  specs for a stale selectorOrder requirement to delta-REMOVE if one
  exists.)
- **Depends on (deps:)**: none (ordering note: executed after 04 by
  blast-radius convention)
- **Inputs from (inputs:)**: none
- **Footprint**: packages/system/src/SystemBuilder.ts,
  packages/extract/crates/extract-v2/src/**,
  openspec/changes/extract-quirk-shed/** — AMENDED by orchestrator
  2026-07-13 (journal): + packages/showcase/src/content/** (docs
  advertising the removed API), + packages/system/src/** (types the
  removal touches), + packages/_parity/register.json (drop/flip the
  v1-feature-drift entry).
- **Pushes to a later increment**: none

## Context Capsule

- **Objective**: `selectorOrder` — a dead config surface (v1 parses it
  into underscore-discarded bindings at both entry points lib.rs:113
  and lib.rs:859 while SystemBuilder.ts advertises it) — is removed
  from the SystemBuilder API and its docs. NAPI signatures keep their
  optional `selector_order_json` parameters (removing NAPI params is
  out of scope — v1 is frozen; v2 ignores it already or continues to).
- **Probe result (DEF-1 signal)**: `rg -n 'selectorOrder'` over
  packages/showcase/src, e2e/*/src, packages/test-ds/src matches ONLY
  two showcase MDX doc pages — no authored config sets it → REMOVE.
- **In-scope guardrails** (STOP): G2, G3, G4 — commands as increment 01.
- **Relevant resolved decisions**: D1 (the register's extract-all
  observables `v1-feature-drift` entry for selectorOrder is resolved by
  removal — update/drop it with the shed note); D2 (API-surface sheds
  last).
- **In-scope North Star**: NS1 (a wrong advertisement — dead API — is
  made right by removal), NS2.
- **Prohibitions**: no VCS mutations; keep `loadSystemModule` NAPI
  contract intact (G2 of the flip change; system loading is v1's); do
  not change v1 Rust (`packages/extract/src/**`).

## Plan

## Task 05.1: remove the API surface

- [ ] **Step 1:** `rg -n 'selectorOrder|selector_order' packages/system/src/ packages/extract/crates/extract-v2/src/ packages/extract/dist packages/extract/src/lib.rs --glob '!**/*.node'`
  — inventory every reference.
- [ ] **Step 2:** Remove `selectorOrder` from `SystemBuilder.ts`
  (builder option, serialize output) and any system-package types that
  advertise it. Do NOT remove the optional NAPI parameters in v1
  (frozen oracle) — the serialize side simply stops emitting the field.
- [ ] **Step 3:** Update the two MDX doc pages
  (packages/showcase/src/content/reference/create-system.mdx,
  .../architecture/system-setup.mdx) to drop the selectorOrder row.
- [ ] **Step 4:** If the v2 crate reads selector_order_json, confirm it
  tolerates absence (it must — fixtures never set it); remove v2 dead
  parsing only if trivially isolated.

## Task 05.2: gates

- [ ] **Step 1:** `vp run verify:compile && vp run verify:unit:ts` — green.
- [ ] **Step 2:** Register: update the extract-all observables
  `v1-feature-drift` (selectorOrder) entry — note that the surface was
  removed from the builder API (shed 2026-07-13, inc 05); drop or keep
  per how compare consumes it (keep with updated note if dropping
  creates an unregistered divergence).
- [ ] **Step 3:** `bash scripts/verify/parity.sh | tail -1` → PASS.
- [ ] **Step 4:** Consumer proofs:
  `vp run verify:vite && vp run verify:next && vp run verify:showcase` — green.

## Guardrail gate

- [ ] G2 — result: <record>
- [ ] G3 — result: <record>
- [ ] G4 — result: <record>

## Output contract (inline — collapsed into checklists)

- [ ] Checkboxes ticked; gate results recorded
- [ ] Journal entries proposed — or none
- [ ] Surfaced variables — or none

## Spec authorship checklist (orchestrator)

- [ ] Check openspec/specs for a selectorOrder requirement
      (builder-chain or system capability) — author a REMOVED delta in
      this change's specs/ if one exists
- [ ] Flip DEF-1 → resolved (removal) in design.md; promote decision
- [ ] Journal + tick row 05 `· ticked: <ts>`

# Increment 09: manifest-consumer-determinism

## Scope

- **Registry row**: 09 · mode: inline · review: self
- **Resolves**: — (mechanical extension of the D10-sanctioned defect class
  to manifest-derived consumer bytes; found by inc-01 review RF-4)
- **Authors**: — (envelope `deterministic-extraction` covers the behavior)
- **Depends on (ordering — deps:)**: 01
- **Inputs from (information — inputs:)**: none
- **Footprint**: packages/extract/src/project_analyzer.rs,
  packages/extract/tests/**, openspec/changes/extract-v2-spine/**
- **Pushes to a later increment**: comparison-surface altitude decision
  (include virtual-module composition point or record explicit exclusion)
  stays with increment 02 (journal 2026-07-12 20:38, RF-4/RF-10)

> Spawned at the inc-01 reorientation (journal 2026-07-12 20:41); licensed
> by RF-4 evidence, not a DEF signal — mechanical row.

## Context Capsule

- **Objective**: `system_prop_map` and `dynamic_props` (including nested
  `scale_values`) serialize key-sorted in the manifest JSON, so the
  consumer-visible bytes derived from them (vite-plugin
  `JSON.stringify(manifest.system_prop_map)` → `virtual:animus/system-props`
  module source) are identical across fresh processes. v1 behavior
  otherwise unchanged; deserialization (`transform_file`) unaffected.
- **Mechanism**: `#[serde(serialize_with = ...)]` sorted-map helpers on the
  `UniverseManifest` fields and `DynamicPropMeta.scale_values` — no field
  type changes, no consumer edits (vite-plugin stringifies whatever key
  order the manifest carries).
- **In-scope guardrails**: G3 control (no new string surgery; rg count
  stays 10); Change-Type Map tiers for the touched file
  (`verify:unit:rust`, `verify:canary`, `verify:integration`); double-run
  evidence via the inc-01 runners with the surface extended to
  `system_prop_map`/`dynamic_props` JSON.
- **Prohibitions**: no version-control commands; no writes outside
  footprint + this file; never write design.md/tasks.md/journal.md/specs/.

## Plan

## Task 09.1: Sorted serialization

- [x] **Step 1:** `sorted_map` / `sorted_nested_map` serde helpers added in
      project_analyzer.rs; `system_prop_map` (nested) and `dynamic_props`
      (outer) attributed.
- [x] **Step 2:** `DynamicPropMeta.scale_values` attributed (manifest path;
      emitted-code path already sorted by inc 01).
- [x] **Step 3:** `tools/analyze-run.ts` surface extended with
      `__systemPropMap__` (9 populated keys — non-vacuous) and
      `__dynamicProps__`; rebuilt; double-run both dev modes → zero diffs at
      the exact vite-plugin composition point (parse→stringify).

## Guardrail gate

- [x] G3 control — result: 10 (unchanged; no new string surgery).
- [x] Tiers: `verify:unit:rust` 280 passed · `verify:canary` 197 passed ·
      `verify:integration` exit 0.
- [x] Double-run (extended surface, both dev modes) — result: pass
      (prod 20,927 B / dev 26,023 B compared).

## Output contract (inline mode — collapse into checklists above)

- [x] Plan ticked; gate results recorded; journal entries: surprise +
      reorientation (see journal inc 09 entries); surfaced variables:
      JS integer-like-key canonicalization at JSON.parse — assigned to
      increment 02's comparison-surface definition

## Spec authorship checklist (orchestrator)

- [ ] Off-beat reorientation (entropy auditor only — review:self row);
      tick row 09 with the entry timestamp

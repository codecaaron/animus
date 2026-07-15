# Increment 02: total-floor-emission

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development.
> Steps use checkbox (`- [ ]`) syntax for root-owned tracking. No VCS operations.

## Scope

- **Registry row**: 02 · mode: inline · review: subagent
- **Resolves**: D1 (active-system-prop totality), D3 (v2-only after flip)
- **Authors**: §dynamic-prop-fallback/Total system prop floor,
  §dynamic-prop-fallback/Custom prop lazy generation
- **Depends on**: 01
- **Inputs from**: `external:extract-v2-engine-flip` — journal signal
  `2026-07-13 20:55`
- **Footprint**: `packages/extract/crates/extract-v2/**`,
  `openspec/changes/total-dynamic-floor/**`

## Objective

Generate shared `dynamic_props` metadata and `@layer system` slot rules for the exact
union of active system props across evaluated components, even when every visible JSX
site is static or absent. Keep detected-use-gated per-component custom props unchanged.
Prove existing static class-map entries are identical, measure raw CSS byte growth on
showcase/Next/Vite, and do not touch v1.

## Context Capsule

- `analyze_css.rs` currently derives `dynamic_prop_names` only from
  `UsageScanResult.dynamic_prop_usages`, then builds metadata and slot entries from that
  set around lines 1052–1088.
- The exact total-floor universe already exists in each evaluated tuple's
  `active_props` field. It comes only from `.system(...)` plus inherited system props;
  `.props(...)` configurations are stored separately as `custom_configs`.
- Replacement payloads currently set `has_dynamic_props` by intersecting the combined
  runtime prop-name list with detected global names. Under the floor, a component must
  receive `dynamicPropConfig` whenever it has an active system prop; custom-only
  components receive it only when their own detected custom dynamic config exists.
- Custom metadata construction under `per_component_custom_dynamic` is already
  component-qualified and SHALL remain detection-gated.
- `build_variable_slot_entries`, `DynamicPropMeta`, scale resolution, and runtime lookup
  already implement the required value path. This increment changes set membership,
  not metadata shape, naming, lookup order, or value resolution.
- Before-floor v2 consumer baselines are frozen in
  `tools/floor-css-baseline.json`: Next 9,213 CSS / 674 system bytes; showcase 143,636 /
  4,687; Vite 6,322 / 293. Each captured manifest had zero shared dynamic props.

## Prohibitions

- Never modify `packages/extract/src/**` or any v1 parity baseline.
- Do not totalize custom props or add a runtime/config feature flag.
- Do not change `system_prop_map` construction, static utility inputs, class hashing,
  `DynamicPropMeta`, slot naming, breakpoint behavior, or manifest field names.
- Do not update design/tasks/journal/specs; the root agent owns artifact merges.

## Task 1: RED — floor exactness, static invariance, and custom laziness

- [x] Add `analyze_css.rs` test `total_floor_active_set` using only static JSX values.
  Two evaluated components activate overlapping system props and the input config also
  contains an inactive `gridArea`. Assert `dynamic_props.keys()` equals the sorted union
  of their active system props, every key has a base slot selector, `gridArea` is absent,
  and both replacements pass `dynamicPropConfig`.
- [x] Add `total_floor_empty_project_has_no_slots`: no evaluated component yields empty
  `dynamic_props` and no `-dyn-` selector in `sheets.system`.
- [x] Add `total_floor_static_invariance`. Introduce a private test seam that runs the
  same analyzer body with the old detected-only system-floor set. Analyze a static-only
  fixture in both modes and assert `system_prop_map` is byte/equality identical and the
  static `p=8` class is unchanged. The production `run` entry always selects total mode;
  there is no public or environment-controlled escape hatch.
- [x] Add/extend custom-prop tests proving static-only custom `size` produces no
  `customDynamicConfig`/custom slot, while a dynamic `size={value}` still produces its
  component-qualified metadata and never enters shared `dynamic_props`.
- [x] From `packages/extract/crates/extract-v2`, run
  `cargo test --lib total_floor` and a focused custom-lazy filter. Expected RED: the
  static-only active-set and replacement assertions fail because `dynamic_props` is
  empty; existing custom behavior remains green.

## Task 2: GREEN — enumerate exact active system props

- [x] Refactor the analyzer body behind a private mode enum or boolean used only by
  tests. Public `run(...)` delegates with total mode unconditionally.
- [x] Preserve `detected_dynamic_prop_names` as scanner evidence. Separately collect
  `active_system_prop_names` by unioning only each evaluated entry's `active_props`.
  In total mode, build shared metadata from the active set; in test-only legacy mode,
  use the detected set.
- [x] Keep metadata construction byte-for-byte equivalent per prop: config lookup,
  kebab name, var/slot names, property/properties, transform, and scale values.
- [x] Set each replacement's `has_dynamic_props` when either (a) the component has at
  least one active system prop in the selected floor set, or (b) that component has a
  non-empty `custom_dynamic_config`. Do not infer this from custom prop names colliding
  with global config names.
- [x] Keep `custom_dynamic_by_binding` and `per_component_custom_dynamic` unchanged.
- [x] Run `cargo test --lib total_floor`, the custom-lazy filter, then
  `cargo test --lib`. Expected: all pass.

## Task 3: RED/GREEN — deterministic CSS byte measurement

- [x] Write `tools/floor-css-measurement.test.ts` first. Given the committed baseline
  object and synthetic after manifests, assert deterministic per-consumer
  `{before, after, delta, percent}` for total CSS bytes, system-sheet bytes, and shared
  dynamic-prop count; labels and maps are key-sorted.
- [x] Run the test and confirm module-not-found RED for
  `tools/floor-css-measurement.ts`.
- [x] Implement the manifest-only tool. It may read only `css`, `sheets.system`, and
  `dynamic_props`/`dynamicProps`; byte counts use `TextEncoder`, deltas are signed
  integers, percentages are rounded to two decimals, and output is canonical JSON.
  CLI shape:

  ```bash
  bun tools/floor-css-measurement.ts --baseline tools/floor-css-baseline.json \
    --out tools/floor-css-measurement.json next=/tmp/after/next.json \
    showcase=/tmp/after/showcase.json vite=/tmp/after/vite.json
  ```

- [x] Run both tool tests; expected: all pass.

## Task 4: Real builds, measurement, and declared gates

- [x] Run `vp run build:extract`.
- [x] Capture new v2 manifests from showcase, `e2e/vite-app`, and `e2e/next-app` with
  the repository-local `prop-flow-reachability/tools/capture-manifests.cjs` preload and
  `NODE_OPTIONS=--require=...`; each build must pass and emit at least one labeled JSON.
- [x] Generate `tools/floor-css-measurement.json` against the frozen before-floor
  baseline. Record the numbers without moving the baseline or totalizing custom props.
- [x] Run the minimum v2 tier set:
  `vp run verify:hygiene:rust`, `vp run verify:unit:rust`,
  `vp run verify:canary`, `vp run verify:parity`, and
  `vp run verify:integration`.
- [x] Run consumer proof: `vp run verify:showcase`, `vp run verify:vite`, and
  `vp run verify:next`.

## Guardrail Gate

- [x] G1: `cargo test --lib total_floor_static_invariance` — static map identical.
- [x] G2: `cargo test --lib total_floor_active_set` — slot set equals active union.
- [x] G4: `git diff --name-only HEAD -- packages/extract/src/` — empty.
- [x] `git diff --check` — clean.

## Output Contract

- Shared dynamic metadata and slot rules are total over active system props only.
- Static lookup entries are identical; custom props remain detected-use lazy.
- Measurement artifact freezes before/after/delta numbers for all three consumers and
  supplies the resolving signal for DEF-1/DEF-3.
- Root runs subagent review, appends the measurement/reorientation, resolves or carries
  the lazy rows, then ticks this registry row.

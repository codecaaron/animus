# Increment 03: reachable-floor-narrowing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development.
> Steps use checkbox (`- [ ]`) syntax for root-owned tracking. No VCS operations.

## Scope

- **Registry row**: 03 · mode: inline · review: subagent
- **Resolves**: DEF-1 (keep custom props lazy), DEF-3 (narrow system floor)
- **Authors**: §dynamic-prop-fallback/Total system prop floor
- **Depends on / inputs from**: 02 measurement recorded 2026-07-13 21:19
- **Footprint**: `packages/extract/crates/extract-v2/**`, `packages/_parity/**`,
  `openspec/changes/total-dynamic-floor/**`

## Objective

Reduce the measured all-evaluated system floor to the exact conservative component
universe used by reconciliation: rendered components, extension parents, `asClass`
terminals, and compose slots. Canonicalize named-import aliases and widen to every
evaluated component if any component-like render identity remains uncertain. Feed this
same canonical set to reconciliation so floor emission and component survival cannot
diverge. Keep prop-use detection irrelevant, custom props lazy, and static lookup results
identical.

## Context Capsule

- Phase 5b already produces per-file `UsageScanResult.rendered_components`; the current
  all-active floor is computed immediately after that scan.
- Named-import alias augmentation lets a local JSX name enter the scan maps, but the
  result binding remains local. `FileFacts.imports` carries `{local, imported, source}`;
  canonicalize only when the imported binding exists among evaluated component bindings.
- Reconciliation retains ledger-rendered bindings and provenance parents. Its caller also
  inserts every `TerminalKind::AsClass` binding and every compose slot binding into the
  ledger. One identity policy must canonicalize aliases and supply this set to both the
  floor and ledger; uncertain component-like syntax widens both to all evaluated bindings.
- Binding names are not globally unique. Once a binding is reachable, union active props
  from every evaluated entry with that binding; this is a safe over-approximation.
- The legacy test seam (`total_system_floor=false`) remains detection-only and is used
  solely for G1 invariance. Production always selects the reachable total floor.
- The row-02 all-evaluated measurement is the before point for this narrowing. Rerun the
  same three captures and overwrite only the after measurement artifact with final
  candidate numbers; preserve the frozen pre-floor baseline.

## Prohibitions

- Never modify `packages/extract/src/**` or refresh parity baselines in this increment;
  prop-flow row 03 intentionally changes the same oracle next, after which root performs
  the single final refresh.
- Do not narrow by observed prop names, literal values, dynamic classifications, or CSS
  byte heuristics. Component reachability is the only narrowing axis.
- Do not change custom dynamic metadata, static utility input generation, reconciliation
  pruning rules, class naming, metadata shape, or runtime code. The canonical rendered
  set supplied to reconciliation may change to close an identity-analysis gap.
- Do not silently discard an uncanonicalizable scanned binding; widen to all evaluated
  active props.
- Do not update design/tasks/journal/specs; the root agent owns artifact merges.

## Task 1: RED — discriminate every reachability source

- [x] Add tests under the `total_floor_reachability` prefix proving: (a) an unrendered
  component's disjoint prop is absent while a rendered component's props remain; (b)
  `import { Box as Renamed }` rendering retains `Box` props; (c) extension parents,
  `asClass`, and compose slots retain their props; and (d) an intentionally uncertain
  recognized binding selects the all-evaluated fallback.
- [x] Retain the overlapping-set, empty-project, static-invariance, and custom-lazy tests.
- [x] Run `cargo test --lib total_floor_reachability`. Expected RED: dead component props
  remain because the production floor still unions all evaluated entries.

## Task 2: GREEN — derive the reconciliation-retained floor

- [x] During each file scan, canonicalize every usage-result binding against that file's
  named imports and the evaluated-binding set. Accumulate one canonical rendered set and
  an internal uncertainty flag; unresolved component-like identifiers/members widen the
  set, while native element forms do not.
- [x] Add bindings for every evaluated `asClass`, compose slot, and extension parent.
- [x] In total mode, union `active_props` only from evaluated entries whose binding is in
  the retained set. If uncertainty is true, union all evaluated entries. In legacy mode,
  preserve the detected-dynamic set exactly.
- [x] Extend the reconciliation ledger with the same canonical retained set so alias
  normalization and uncertainty cannot disagree with floor selection.
- [x] Run the focused reachability tests, `cargo test --lib total_floor`, and full v2
  `cargo test --lib`. Expected: all pass.

## Task 3: Remeasure and gates

- [x] Build extract, capture fresh Next/showcase/Vite manifests with the existing preload,
  and regenerate `tools/floor-css-measurement.json` against the frozen baseline.
- [x] Run `vp run verify:hygiene:rust`, `verify:unit:rust`, `verify:canary`,
  `verify:integration`, `verify:next`, `verify:showcase`, and `verify:vite`.
- [x] Run parity self/seam evidence. The committed oracle may remain stale only because
  prop-flow row 03 follows immediately and root performs one final registered refresh.

## Guardrail Gate

- [x] G1: `cargo test --lib total_floor_static_invariance` — static map identical.
- [x] G2: `cargo test --lib total_floor_reachability` — every source retained; dead props
  absent; uncertainty widens.
- [x] G4: `git diff --name-only HEAD -- packages/extract/src/` — empty.
- [x] `git diff --check` — clean.

## Output Contract

- Shared dynamic metadata is total over reconciliation-retained component props and
  independent of observed prop names.
- Named-import aliases are canonical across every usage field; uncertainty widens both
  floor emission and reconciliation instead of under-emitting or pruning.
- Custom props remain lazy and static maps remain identical.
- Root runs review, records final measurements, then ticks row 03.

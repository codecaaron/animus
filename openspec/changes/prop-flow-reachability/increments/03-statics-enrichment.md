# Increment 03: statics-enrichment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development.
> Steps use checkbox (`- [ ]`) syntax for root-owned tracking. No VCS operations.

## Scope

- **Registry row**: 03 · mode: inline · review: subagent
- **Resolves**: D3 (map fattening), D5 (over-approximation soundness)
- **Authors**: §jsx-system-prop-scanner/Static value evaluation,
  §shared-system-prop-map/Shared system prop map artifact
- **Depends on**: 01
- **Inputs from**: `external:extract-v2-engine-flip` journal signal 2026-07-13 20:55
- **Footprint**: `packages/extract/crates/extract-v2/**`, `packages/_parity/**`,
  `openspec/changes/prop-flow-reachability/**`

## Objective

Resolve JSX identifier/member/responsive-object expressions through the already-enriched
per-file statics map. Expand supported conditional/logical sites into observed static
values while retaining their dynamic record and slot. Feed all enriched values through
the existing utility-input stream, changing no runtime or map format.

## Context Capsule

- `ExtractEngine::analyze` Pass A collects local and complete statics and follows
  imported/re-exported static exports. Pass B receives those precomputed maps while the
  same stored AST is still alive; it must not repeat either full-program static pass.
- `AttrFact` currently freezes one `static_value` or a dynamic kind/span. Extend it with
  additive `enumerable_values`; collection can consult `statics_fx` without retaining AST
  nodes or parsing again.
- `eval::eval_expression_with_statics` already supports literals, identifiers, and
  single-hop static members. Expose it crate-locally and make nested object evaluation
  preserve the same statics context so responsive objects can resolve identifiers.
- Filtering owns map fattening. For each enumerable member, append the same
  `SystemPropUsage` shape as a literal. Keep the site's dynamic usage/residue so values
  outside the known alternatives still take the total floor.
- Conditional breadth is deliberately narrow: both ternary arms must resolve. For `??`
  and `||`, retain each arm that resolves statically (so `pad ?? 8` contributes `8`) and
  keep the site dynamic. `&&`, calls, binary expressions, and a ternary with any dynamic
  arm contribute no enumerable values.

## Prohibitions

- Never modify `packages/extract/src/**`, runtime code, manifest/map field names, class
  hashing, or the total-floor semantics.
- Do not read an AST after Pass B, retain arena references, add a parse, invoke TypeScript,
  infer function returns, follow wrappers, or expand beyond ternary/`??`/`||`.
- Resolved identifier/member sites move to static and lose their residue record. Arm-join
  sites remain dynamic and retain their original kind/span.
- Never record a ternary arm when its peer is unresolved. Never treat a partial responsive
  object as static. Deduplicate equal values by the existing `(prop,value)` key.
- Do not refresh parity baselines until total-floor row 03 and this increment have both
  passed review; root performs one final registered refresh.
- Do not update design/tasks/journal/specs; root owns artifact merges.

## Task 1: RED — local/cross-file statics and invariance

- [x] Add fact/filter tests for local `const GAP = 24; <Box p={GAP} />`, a static member
  `Tokens.lg`, and a responsive object containing resolved identifiers. Assert static
  usages and no dynamic/residue entry.
- [x] Add engine tests for an imported const and a re-export chain used in JSX. Assert the
  final `systemPropMap` contains the resolved value/class and `usageResidue` omits the site.
- [x] Add `enrichment_static_invariance`: compare complete CSS and `system_prop_map` from
  enriched vs legacy fact collection on literal-only fixtures; they must be identical.
- [x] Run focused filters. Expected RED: identifier/member sites remain dynamic and the
  expected map entries are absent.

## Task 2: RED — enumerable arm joins

- [x] Test `display={open ? 'block' : 'none'}` records both static values plus one dynamic
  conditional residue; duplicate arms dedupe.
- [x] Test `p={pad ?? 8}` and `p={pad || 4}` record their static defaults plus dynamic
  logical residue.
- [x] Test `p={cond ? unknown : 8}`, `p={a && 8}`, calls, and binary expressions record no
  enumerable static values and remain dynamic only.
- [x] Run focused filters. Expected RED: no enumerable usages exist.

## Task 3: GREEN — enrich owned usage facts

- [x] Expose the expression evaluator crate-locally and thread its statics context through
  nested object evaluation.
- [x] Add `collect_usage_facts_with_statics(program, statics)`; preserve the existing
  no-statics wrapper as the public raw-facts contract as well as for parity tests and
  direct-scanner comparisons.
- [x] During AttrFact collection, promote fully resolved identifier/member/object sites to
  `static_value`. For supported arm joins, populate deterministic deduplicated
  `enumerable_values` while preserving dynamic kind/span.
- [x] In system and custom filtering, feed each enumerable value through the existing
  static dedupe path before processing the dynamic record.
- [x] Store enriched usage in a serde-skipped analysis-only field while keeping
  `FileFacts.usage` raw, and have Engine Pass B supply the local/complete maps already
  computed in Pass A.
- [x] Run all focused tests, then full v2 `cargo test --lib`.

## Task 4: Gates and oracle preparation

- [x] Run `vp run build:extract`, `verify:hygiene:rust`, `verify:unit:rust`,
  `verify:canary`, `verify:integration`, `verify:next`, `verify:showcase`, and `verify:vite`.
- [x] Capture final consumer manifests and regenerate the residue histogram; record how
  many identifier/member/conditional/logical sites moved or remained.
- [x] Root registers the combined intentional total-floor + enrichment oracle deltas,
  refreshes production/development baselines once, and runs clean `verify:parity`.
  Exact family transitions are validated across the atomic mode pair so a production-only
  registered drift can coexist with an already-identical development candidate.

## Guardrail Gate

- [x] G1: `cargo test --lib enrichment_static_invariance` — complete CSS/map identical.
- [x] G4: `git diff --name-only HEAD -- packages/extract/src/` — empty.
- [x] `git diff --check` — clean.

## Output Contract

- Resolvable identifier/member/responsive-object sites become ordinary static usages.
- Supported arm joins fatten the existing map while retaining the dynamic floor.
- No AST reparse, runtime branch, new map shape, or v1 edit.
- Root runs spec and quality review, performs the single final parity refresh, appends the
  reorientation, then ticks row 03.

# Increment 01: residue-facts-histogram

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking. No VCS steps — logical checkpoints only.

## Scope

- **Registry row**: 01 · mode: inline · review: subagent
- **Resolves**: D1 (additive v2-native residue facts), D2 (measurement before machinery)
- **Authors**: §usage-residue-facts/Per-site dynamic usage records,
  §usage-residue-facts/Residue records are additive manifest data,
  §usage-residue-facts/Histogram derivability
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `packages/extract/crates/extract-v2/**`,
  `openspec/changes/prop-flow-reachability/tools/**`
- **Pushes to a later increment**: DEF-1, DEF-2, DEF-3, and DEF-5 remain deferred until
  the measured histogram supports or falsifies their resolving signals.

> Resolving signal that licensed creating this increment now: envelope-licensed row 01,
> recorded by the journal seed at `2026-07-13 20:27`.

## Context Capsule

- **Objective**: Preserve one record per dynamic JSX prop site, including binding, prop,
  source file, byte span, and a closed expression-kind classification. Expose those
  records as a deterministic top-level v2-native `usageResidue` manifest field without
  changing existing dynamic aggregation, CSS, transformed code, or v1. Supply a tested
  manifest-only histogram/capture tool and use it against showcase plus both e2e builds.
- **Current data flow**:
  - `jsx_scan.rs::PropValueResult` is `Static(Value) | Dynamic | Skip`; the direct scanners
    dedupe dynamic usages and therefore cannot preserve sites.
  - `usage_facts.rs::AttrFact` stores `staticValue`, `dynamic`, `skip`, and `variantClass`.
    `filter_usage_scan` has the resolved component binding and currently pushes only the
    legacy deduped `DynamicPropUsage`.
  - `facts.rs::FileFacts` already owns `path` and raw `usage` facts.
  - `analyze_css.rs` filters each file's facts into `UsageScanResult`; its `CssOutput` is
    the natural place to aggregate path-qualified residue records.
  - `engine.rs::AnalyzeResult` is the public JSON surface. V2-native fields use camelCase
    (`fileFacts`, `crossFile`, `parseCount`) and are outside parity-derived observables.
- **In-scope guardrails**:
  - G2: SHALL NOT perturb v1↔v2 parity surfaces pre-flip — check:
    `vp run verify:parity` — STOP.
  - G4: SHALL NOT modify v1 engine sources — check:
    `git diff --name-only HEAD -- packages/extract/src/` — STOP. The original
    main-relative check is contaminated on this feature branch; HEAD is the clean
    apply-session baseline because this schema and repository forbid git mutations.
- **Requirements to author**: envelope specs already contain the full behavioral text;
  implementation must satisfy all three `usage-residue-facts` requirements without
  adding rationale or decision tokens to specs.
- **Resolved decisions**: D1 — per-site kind/span is additive v2-native data with no
  classification change. D2 — measure before authoring any expensive lazy tier.
- **North Star**: NS2 additivity; NS3 every dynamic manifest site states a reason; NS4 no
  interprocedural/checker machinery before histogram evidence.
- **Prohibitions**: no version-control mutations; no writes outside the declared
  footprint plus this increment file; never write `design.md`, `tasks.md`, `journal.md`,
  or `specs/` while executing this packet. Do not alter v1 sources. Do not enrich or
  reclassify any JSX value in this increment.

## File Structure

- Modify `packages/extract/crates/extract-v2/src/jsx_scan.rs`: closed kind enum, source
  span type, dynamic payload classification, and direct-scan residue sites.
- Modify `packages/extract/crates/extract-v2/src/usage_facts.rs`: additive AttrFact
  payloads and per-site filtering while preserving legacy dedupe.
- Modify `packages/extract/crates/extract-v2/src/analyze_css.rs`: path-qualified,
  deterministically sorted residue aggregation in `CssOutput`.
- Modify `packages/extract/crates/extract-v2/src/engine.rs`: top-level camelCase
  `usageResidue` field and boundary test.
- Create `openspec/changes/prop-flow-reachability/tools/residue-histogram.ts`: parse only
  manifest JSON and produce deterministic counts by kind, prop, and binding.
- Create `openspec/changes/prop-flow-reachability/tools/residue-histogram.test.ts`: pure
  summary/CLI behavior.
- Create `openspec/changes/prop-flow-reachability/tools/capture-manifests.cjs` and
  `capture-manifests.test.ts`: preload hook that captures v2 `ExtractEngine.analyze()`
  output during real consumer builds without changing plugin sources.
- Generate `openspec/changes/prop-flow-reachability/tools/residue-histogram.json`: the
  measured, deduplicated summary from showcase, vite-app, and next-app manifests.
- Generate `openspec/changes/prop-flow-reachability/tools/residue-capture-receipt.json`:
  per-label build exit and manifest counts for capture provenance.

## Task 1: RED — per-site classification and manifest boundary

- [x] **Step 1: Add failing direct-scan tests in `jsx_scan.rs`.** Extend the existing
  dynamic-prop test block with a table covering the closed mapping:

  ```rust
  let cases = [
      ("spacing", DynamicExpressionKind::Identifier),
      ("tokens.lg", DynamicExpressionKind::Member),
      ("getSpacing()", DynamicExpressionKind::Call),
      ("ok ? 4 : 8", DynamicExpressionKind::Conditional),
      ("value ?? 8", DynamicExpressionKind::Logical),
      ("`${value}px`", DynamicExpressionKind::Template),
      ("value + 4", DynamicExpressionKind::Binary),
      ("{ _: value, sm: 8 }", DynamicExpressionKind::ResponsiveObjectDynamic),
      ("[value]", DynamicExpressionKind::Array),
      ("value as number", DynamicExpressionKind::Other),
  ];
  ```

  For each source `<Box p={EXPR} />`, assert exactly one `residue_sites` record, matching
  kind, `binding == "Box"`, `prop_name == "p"`, and a span whose source slice equals
  `EXPR`. Add a two-site test proving `dynamic_prop_usages.len() == 1` remains deduped
  while `residue_sites.len() == 2` preserves multiplicity.
- [x] **Step 2: Add a failing fact-algebra parity test in `usage_facts.rs`.** Extend
  `assert_paths_agree` to compare direct and filtered `residue_sites`; add two dynamic
  sites of the same prop and assert their kinds/spans remain distinct.
- [x] **Step 3: Add a failing `engine.rs` boundary test.** Analyze two files where an
  evaluated `Box` has active prop `p` and call sites use `p={spacing}` and
  `p={ok ? 4 : 8}`. Parse the manifest JSON and assert:

  ```rust
  let residue = manifest["usageResidue"].as_array().unwrap();
  assert_eq!(residue.len(), 2);
  assert_eq!(residue[0]["file"], "a.tsx");
  assert_eq!(residue[0]["kind"], "identifier");
  assert_eq!(residue[1]["kind"], "conditional");
  ```

  Also compare `css`, `system_prop_map`, and `dynamic_props` against an equivalent run
  with residue serialization omitted from the assertion surface; these existing fields
  remain present and unchanged.
- [x] **Step 4: Run RED.** From `packages/extract/crates/extract-v2`, run:
  `cargo test --lib residue`
  Expected: compile/test failure naming the absent `DynamicExpressionKind`,
  `residue_sites`, or `usageResidue` surface — not a parser/setup error.

## Task 2: GREEN — retain kind/span without changing classification

- [x] **Step 1: Add owned residue types in `jsx_scan.rs`.** Import
  `oxc::span::GetSpan`; add serializable/equatable types:

  ```rust
  #[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
  #[serde(rename_all = "kebab-case")]
  pub enum DynamicExpressionKind {
      Identifier, Member, Call, Conditional, Logical, Template, Binary,
      ResponsiveObjectDynamic, Array, Other,
  }

  #[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
  pub struct UsageSpan { pub start: u32, pub end: u32 }

  #[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
  pub struct UsageResidueSite {
      pub binding: String,
      pub prop_name: String,
      pub kind: DynamicExpressionKind,
      pub span: UsageSpan,
  }
  ```

  Change only the payload shape to
  `PropValueResult::Dynamic { kind: DynamicExpressionKind, span: UsageSpan }`.
- [x] **Step 2: Classify the existing dynamic branches.** In
  `eval_jsx_attribute_value`, keep every Static/Skip verdict unchanged. For a dynamic
  `JSXExpression`, use `expression.span()` and map identifier/member/call/conditional/
  logical/template/binary/array variants directly, a non-static object to
  `ResponsiveObjectDynamic`, and all remaining dynamic variants to `Other`.
  Parenthesized expressions inherit the inner kind while retaining the inner expression
  span. Do not evaluate new syntax.
- [x] **Step 3: Preserve direct-scan behavior.** Pattern-match
  `Dynamic { kind, span }`; continue to push legacy `DynamicPropUsage` only under its
  existing dedupe key, but push one `UsageResidueSite` for every dynamic attribute in
  `UsageScanner`. Add `residue_sites: Vec<UsageResidueSite>` to `UsageScanResult` only;
  `SystemPropScanner` ignores the payload after maintaining its legacy dedupe.
- [x] **Step 4: Run the focused Rust tests.** Run the Task 1 command from the v2 crate
  directory. Expected: direct
  classification tests pass; fact/manifest tests may still fail until Tasks 3–4.

## Task 3: GREEN — carry raw fact payloads through filtering

- [x] **Step 1: Extend `usage_facts.rs::AttrFact` additively.** Retain the existing
  `dynamic: bool` and `skip: bool` fields byte-for-byte. Add optional camelCase fields:

  ```rust
  pub dynamic_kind: Option<DynamicExpressionKind>,
  pub dynamic_span: Option<UsageSpan>,
  ```

  Populate them from `PropValueResult::Dynamic { kind, span }`; use `None` for Static and
  Skip. This keeps every pre-existing `fileFacts.usage.attrs[*]` field intact.
- [x] **Step 2: Extend `filter_usage_scan` per-site.** When an active prop has
  `attr.dynamic`, keep the existing deduped `dynamic_prop_usages` branch unchanged, then
  unconditionally push one `UsageResidueSite` using the resolved binding and required
  kind/span payload. Treat a missing payload on a dynamic fact as an internal invariant
  violation in tests; do not manufacture an `other/0..0` record.
- [x] **Step 3: Update all exhaustive `PropValueResult` matches and, from the v2 crate
  directory, run:** `cargo test --lib usage_facts`
  Expected: all direct-vs-fact paths agree, including residue multiplicity.

## Task 4: GREEN — deterministic top-level `usageResidue`

- [x] **Step 1: Add `UsageResidueRecord` in `usage_facts.rs`.** It contains
  `binding`, `prop`, `file`, `span`, and `kind`, derives Serialize, and uses camelCase for
  field names while the enum remains kebab-case.
- [x] **Step 2: Aggregate in `analyze_css.rs`.** Add
  `usage_residue: Vec<UsageResidueRecord>` to `CssOutput`. In the existing per-file
  Phase-5b loop, path-qualify every `usage_result.residue_sites` record before pushing
  the usage result. Sort by `(file, span.start, span.end, binding, prop)` before building
  `CssOutput`; do not feed residue into utility inputs, dynamic prop names, or the usage
  ledger.
- [x] **Step 3: Serialize in `engine.rs`.** Add
  `#[serde(rename = "usageResidue")] usage_residue: &[UsageResidueRecord]` to
  `AnalyzeResult` and pass `&css.usage_residue`. No existing field name or value changes.
- [x] **Step 4: Run GREEN.** From the v2 crate directory, run `cargo test --lib residue`,
  then `cargo test --lib`.
  Expected: all v2 tests pass with zero failures.

## Task 5: RED/GREEN — manifest-only histogram and capture harness

- [x] **Step 1: Write `residue-histogram.test.ts` first.** Feed two in-memory manifests
  with repeated and distinct `usageResidue` records. Assert duplicate build records are
  counted once by `(file, span.start, span.end, binding, prop, kind)`, and that output is:

  ```ts
  {
    totalSites: 3,
    byKind: { conditional: 1, identifier: 2 },
    byProp: { m: 1, p: 2 },
    byBinding: { Box: 3 },
  }
  ```

  Add a CLI test proving `--out <path> manifest-a.json manifest-b.json` writes the same
  canonical JSON without reading any source file.
- [x] **Step 2: Run histogram RED.** Run:
  `bun test openspec/changes/prop-flow-reachability/tools/residue-histogram.test.ts`.
  Expected: module-not-found failure for `residue-histogram.ts`.
- [x] **Step 3: Implement `residue-histogram.ts`.** Export `summarize(manifests)` and a
  Bun CLI. Validate `usageResidue` is an array, dedupe by the key above, accumulate the
  three maps, key-sort every map, and write `JSON.stringify(summary, null, 2) + '\n'` to
  `--out` via `Bun.write`. The only manifest field read is `usageResidue`.
- [x] **Step 4: Write `capture-manifests.test.ts` before the hook.** Spawn a child Bun
  process with the planned hook in `NODE_OPTIONS`, load a temporary module exporting a
  fake `ExtractEngine` whose `analyze()` returns `{"usageResidue":[]}`, invoke it once,
  and assert one captured JSON file exists under the temporary capture directory.
- [x] **Step 5: Run capture RED.** Run:
  `bun test openspec/changes/prop-flow-reachability/tools/capture-manifests.test.ts`.
  Expected: preload module-not-found failure.
- [x] **Step 6: Implement `capture-manifests.cjs`.** Wrap `Module._load`; whenever an
  exported `ExtractEngine.prototype.analyze` is first observed, replace only that method
  with a wrapper that calls the original, parses the returned manifest to prove validity,
  and writes it under `ANIMUS_RESIDUE_CAPTURE_DIR` using the sanitized
  `ANIMUS_RESIDUE_CAPTURE_LABEL`, pid, and monotonic counter. Preserve return value,
  `this`, errors, and all other exports; mark the prototype with a Symbol to prevent
  double wrapping. Do nothing when the capture-dir env var is absent.
- [x] **Step 7: Run both tool tests.** Run:
  `bun test openspec/changes/prop-flow-reachability/tools/*.test.ts`.
  Expected: all pass.

## Task 6: Real-build measurement and tier verification

- [x] **Step 1: Build the fresh v2 NAPI artifact.** Run `vp run build:extract`.
- [x] **Step 2: Capture real consumer manifests.** For each command below, use an empty
  temporary capture directory and distinct label; the preload writes manifests without
  plugin edits:

  ```bash
  env ANIMUS_RESIDUE_CAPTURE_DIR=/tmp/animus-residue ANIMUS_RESIDUE_CAPTURE_LABEL=showcase ANIMUS_RESIDUE_CAPTURE_MODULE=$PWD/packages/extract/crates/extract-v2/index.js NODE_OPTIONS=--require=$PWD/openspec/changes/prop-flow-reachability/tools/capture-manifests.cjs bun run --filter './packages/showcase' build
  env ANIMUS_RESIDUE_CAPTURE_DIR=/tmp/animus-residue ANIMUS_RESIDUE_CAPTURE_LABEL=vite ANIMUS_RESIDUE_CAPTURE_MODULE=$PWD/packages/extract/crates/extract-v2/index.js NODE_OPTIONS=--require=$PWD/openspec/changes/prop-flow-reachability/tools/capture-manifests.cjs bun run --filter './e2e/vite-app' build
  env ANIMUS_RESIDUE_CAPTURE_DIR=/tmp/animus-residue ANIMUS_RESIDUE_CAPTURE_LABEL=next ANIMUS_RESIDUE_CAPTURE_MODULE=$PWD/packages/extract/crates/extract-v2/index.js NODE_OPTIONS=--require=$PWD/openspec/changes/prop-flow-reachability/tools/capture-manifests.cjs bun run --filter './e2e/next-app' build
  ```

  Expected: all three builds pass and each label produces at least one manifest. The
  canonical consumer proof still runs through `vp run verify:showcase`, `verify:vite`,
  and `verify:next` in the verification gate; preloading is measurement-only.
- [x] **Step 3: Generate the evidence artifact.** Run:
  `bun openspec/changes/prop-flow-reachability/tools/residue-histogram.ts --out openspec/changes/prop-flow-reachability/tools/residue-histogram.json /tmp/animus-residue/*.json`.
  Inspect total and grouped counts; record whether each DEF signal is actually supported.
- [x] **Step 4: Run minimum v2 tiers.** Run:
  `vp run verify:hygiene:rust && vp run verify:unit:rust && vp run verify:canary && vp run verify:integration`.
  Expected: all exit 0.

## Guardrail gate

- [x] G2: `vp run verify:parity` — result: pass; 48/48 both modes, seam 14/14.
- [x] G4: `git diff --name-only HEAD -- packages/extract/src/` — result: pass; expected
  empty output.

## Spec authorship checklist (orchestrator)

- [x] Confirmed the envelope-authored `usage-residue-facts` requirements match the landed
  behavior; leakage lint is clean and no extra spec text is required.
- [x] Recorded histogram-supported or falsified DEF-1/2/3/5 signals in the journal and
  updated their Ledger/registry dispositions without speculative packet creation.
- [x] Reorientation entry written with the required full post-envelope adversarial pass.
- [x] Registry row ticked with the reorientation timestamp.

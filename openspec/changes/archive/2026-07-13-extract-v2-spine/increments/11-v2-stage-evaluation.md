# Increment 11: v2-stage-evaluation

## Scope

- **Registry row**: 11 · mode: inline · review: subagent
- **Resolves**: DEF-4 (allocator strategy decided against a real workload);
  ANSWERS D4's falsification criterion (see Objective — this is the
  discriminating increment; the verdict is recorded at the reorientation
  and flips D4 to confirmed or fires the shrink)
- **Authors**: — (envelope specs cover behavior; arch containment already
  authored)
- **Depends on (ordering — deps:)**: 04
- **Inputs from (information — inputs:)**: none (chain descriptors and the
  store are spec/code-defined; no upstream output contract consumed)
- **Footprint**: packages/extract/crates/extract-v2/**, packages/_parity/**
  (only if an artifact class is added — surface as deviation note if so),
  openspec/changes/extract-v2-spine/**
- **Pushes to a later increment**: theme/scale resolution + QuickJS
  evaluation (rows 07/DEF-11 territory); CSS generation + emission (row
  05/DEF-2); full-pipeline CSS parity claims arrive only when those land.

> Licensed by the DEF-4 signal entry (journal 2026-07-12 23:24) and the
> inc-04 reorientation spawn decision.

## Context Capsule

- **Objective**: v2 produces EVALUATED stage configs (serde_json facts) and
  JSX usage facts for every discovered chain, bug-compatible with v1's
  per-property skip model — and in doing so runs the D4 experiment:
  v1 re-parses stage arg spans because it lost the AST; v2 holds the AST.
  Implement **eager evaluation first**: evaluate stage arguments DURING the
  per-file pass (walk chain → locate stage ObjectExpression nodes → eval to
  owned JSON facts + skips + captured-transform SOURCE TEXT as owned
  strings), so no `program()` read happens after cross-file facts resolve.
  If eager evaluation suffices end-to-end (statics are per-file; extension
  merging consumes evaluated configs, not ASTs — verify against v1's
  process_chain/chain_merger flow), then **D4's falsification FIRES**: record
  the verdict, and a follow-up spawn shrinks the store to per-file scope.
  If a genuine post-resolution `program()` need appears (document exactly
  where), D4 is confirmed instead. Either way the criterion from the inc-04
  reorientation (journal 23:07) is answered VERBATIM.
- **What to port, bug-compatibly** (v1 sources are the spec; port their
  test modules verbatim as the contract, RF/inc-04 precedent):
  1. `packages/extract/src/style_evaluator.rs` (978 lines; production core
     ends at `mod tests` line ~522): `eval_object_expr_with_statics` —
     per-property skip (identifier/call/ternary → SkippedProperty, NOT
     object bail), structural bails (spread/computed keys/getters →
     BailError for the whole object), `CapturedTransform` for `transform`
     fields (v2 captures the fn SOURCE TEXT as an owned string via the span
     over the stored source — a fact, not a span into a dropped arena),
     `collect_static_values` (same-file const collection feeding identifier
     resolution).
  2. `packages/extract/src/jsx_scanner.rs` (production core before
     `mod tests` at ~876): the `Visit`-based usage scan — system/custom/
     variant/state prop usage per component, `createElement` callee-name
     tracking, member-expression (`<Family.Slot>`) handling via the
     name-keyed maps, `compose()` family extraction. Name-based semantics
     (D3): shadowing/alias fixtures must keep verdict `identical`.
  3. Wire per-file: chain descriptors (inc 04) + evaluated configs + usage
     facts into one owned per-file fact bundle (serde, BTreeMap-keyed,
     NS2-clean: no code strings except captured transform source, which is
     user-authored input, not generated output).
- **Oracle** (honest scope — full CSS parity is NOT claimable yet):
  (a) v1's style_evaluator + jsx_scanner test modules ported verbatim;
  (b) extend tools/chain-parity.ts (or a sibling tools script) to compare
  v2 evaluated-config facts against v1 where the manifest witnesses them
  (per-component variant option names, state names, system prop names all
  appear in manifest components/config surfaces — compare those), and JSX
  usage against manifest usage ledger entries; (c) parse-count budget must
  REMAIN files×1 (eager eval reads the ALREADY-parsed program — any new
  Parser::new is a G1 trip; the harness --parse-count and the
  Parser::new-containment rg both gate this).
- **In-scope guardrails** (design.md Register): G1 (parse budget — eager
  eval must add ZERO parses), G2 (fact-only manifest — evaluated configs
  are values; captured transform source is user input, record the
  distinction in the fact type's doc), G3 (no string surgery), G4/G7
  (structural), G6 (verify:parity stays green — v1-vs-v1 unaffected).
- **Relevant decisions (constraints)**: D3 (bug-compatible name-based
  semantics), D4 (THIS increment answers it — record verdict verbatim),
  D9 (containment: any AST-node construction still banned; walk+read only),
  D12 (downstream modules consume evaluated facts — do not port
  theme_resolver/css_generator here).
- **Reference implementations**: v1 sources above; for the eager-facts
  pattern, the brainstorm's recorded D4 alternative (partial-value IR with
  named holes — style_evaluator's skip model IS that pattern).
- **Prohibitions**: no version-control commands; no writes outside
  footprint + this file; never write design.md/tasks.md/journal.md/specs/
  (return drafts via output contract if delegated; inline mode: orchestrator
  authors directly at tick).

## Plan

## Task 11.1: Evaluator port

- [x] **Step 1:** eval.rs ported (520 core lines); v1 test module verbatim
      — 38 evaluator tests green. collect_static_exports decoupled from
      import_resolver (takes (local, exported) pairs; module graph is a
      later row).
- [x] **Step 2:** collect_static_values ported; statics resolution
      test-verified (intra-file const tests green).

## Task 11.2: Eager per-file evaluation

- [x] **Step 3:** facts.rs — span-indexed ObjectExpression lookup over the
      stored program; per-file bundle {chains, evaluated stages (+compound
      second args), skips, captured transforms with OWNED user source,
      statics}; parse-budget invariant asserted in every test (zero added
      parses). 4 facts tests green.
- [x] **Step 4:** D4 VERDICT: FALSIFICATION FIRES (journal 00:35) —
      design (b) implemented; four property tests adjudicate the
      fact-algebra filters against the verbatim-ported scanners
      (field-by-field, order-faithful); no consumer reads a stored
      program() after cross-file resolution anywhere in v2's design.

## Task 11.3: JSX usage scan port

- [x] **Step 5:** jsx_scan.rs ported (874 core lines, v1 tests verbatim);
      usage_facts.rs adds the raw-facts collector + fact-algebra filters
      (design b); FileFacts carries usage + compose + IMPORT facts (alias
      augmentation inputs — oracle finding, journal 00:55; the interim
      CallIdent fact was added then REMOVED when v1's real semantics
      proved to be unconditional asClass/slot rendering — evidence-driven,
      no speculative facts retained). extract_facts NAPI surface added.
      123 crate tests green.

## Task 11.4: Oracle + gate

- [x] **Step 6:** Oracle GREEN across all 35 units, 0 failures:
      chains/descriptors/edges + parse budgets (discoverChains AND
      extractFacts at files×1) + rendered-components cross-check with
      v1-mirrored alias augmentation (imports whose IMPORTED name matches
      a known component by NAME — no re-export following, bug-compatible)
      and v1's unconditional asClass/slot rendering (verbatim v1 comment,
      project_analyzer ~1514-1530). The two oracle-found semantic gaps
      (journal 00:55) were closed with import facts; the call-facts
      hypothesis was falsified by reading v1 and withdrawn.

## Guardrail gate

- [x] G1: parse budget — files×1 on both NAPI surfaces across 35 units;
      Parser::new containment: exactly 1 file.
- [x] G3: gate empty (0 files).
- [x] G4/G7: structural — 0 hits / single umbrella line.
- [x] G6: PARITY GATE: PASS (scripts/verify/parity.sh).
- [x] v2 `cargo test --lib`: 123/123.

## Output contract (inline mode — collapse into checklists above)

- [ ] Plan ticked; gate results with excerpts
- [ ] D4 verdict recorded VERBATIM against the inc-04 criterion, with the
      evidence (where program() is/isn't read post-resolution)
- [ ] DEF-4 resolution drafted (pool vs per-task, with the workload data)
- [ ] Proposed journal entries; spawn candidates (expected: store-shrink
      row if falsification fires; theme/QuickJS row; emission row)

## Spec authorship checklist (orchestrator; tie-back before ticking)

- [ ] Flip DEF-4 → resolved (`→ D<next>`) in design.md with the decision
- [ ] D4 status updated per the verdict (confirmed, or falsification-fired
      with the shrink spawn recorded)
- [ ] Reorientation (FULL pass — D4 verdict is heretic-stance material by
      construction); tick row 11 citing it

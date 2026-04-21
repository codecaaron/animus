## 1. Preflight — scope confirmation

- [x] 1.1 Confirm D1 (dev/build parity Position 3 — retain in dev + diagnostic) via stakeholder approval OR record a counter-decision and update the `css-reconciler` delta spec + design.md accordingly.
- [x] 1.2 Confirm D2 (expand extractor to honor `ThemedCSSProps` for pass-through CSS props in aliased blocks) via stakeholder approval OR flip to Position 2 (narrow TS) and rewrite the `selector-alias-registry` delta spec accordingly.
- [x] 1.3 Confirm OQ1 scope: Phase 2 resolves color-family pass-through props only; other families (length → space, etc.) are follow-on work.

## 2. Phase 1 — JSX scanner recognizes `createElement(...)` CallExpressions

- [x] 2.1 Locate the JSX scanner logic in the Rust crate (most likely `packages/extract/src/jsx_scanner.rs`); confirm where JSX member-expression recognition lives (memory `project_compose_member_expr_gap.md` documented the fix). The `createElement` recognition belongs in the same scanning pass.
- [x] 2.2 Extend the scanner to walk `CallExpression` nodes whose callee is identifier `createElement` or member expression `React.createElement`. For each such call, inspect the first argument:
  - Bare identifier → resolve against the active binding map (same resolution path used for JSX element tags)
  - Member expression → resolve against the active binding map (same resolution path used for JSX member-expression tags)
  - String literal → skip (native DOM element)
  - Any other expression (call expression, conditional expression, template literal, etc.) → skip (dynamic component the scanner cannot attribute)
- [x] 2.3 Wire recognized `createElement` usages into the same "rendered component" output channel as JSX-element recognition — the usage ledger and reconciler SHOULD NOT need any changes once the usages flow through.
- [x] 2.4 Delete the Bug 1 seal test `[Bug 1 seal — current broken behavior]` in `packages/_integration/__tests__/selector-rules.test.ts`.
- [x] 2.5 Unskip the Bug 1 acceptance test `[Bug 1] bare-identifier createElement is recognized as render usage` in the same file.
- [x] 2.6 Run `bun run verify:unit:rust` — confirm new JSX scanner logic passes unit tests.
- [x] 2.7 Run `bun run verify:canary` — confirm NAPI boundary snapshots for recognized patterns remain stable (only EXPECTED additions: components previously dropped now extract).
- [x] 2.8 Run `bun run verify:integration` — confirm `selector-rules.test.ts` fully passes (10 existing guards + Pattern E acceptance).

## 3. Phase 2 — Scale lookup inside selector-alias blocks for pass-through CSS props

- [x] 3.1 Locate the scale-lookup codepath in the Rust crate for inline-object-valued style evaluation. Candidates: `packages/extract/src/style_evaluator.rs` (object expression → serde_json::Value), `packages/extract/src/theme_resolver.rs` (scale lookup + token alias). Confirm where the nested selector-alias block visitor branches on propConfig membership.
- [x] 3.2 Extend the scale-lookup gate: for CSS property names in the color family (initial scope — see OQ1), apply the `colors` scale lookup regardless of propConfig registration. Scope the enumeration to: `outlineColor`, `caretColor`, `accentColor`, `textDecorationColor`, `columnRuleColor`, `borderBlockColor`, `borderInlineColor`, `borderBlockStartColor`, `borderBlockEndColor`, `borderInlineStartColor`, `borderInlineEndColor`. (Confirm list against CSS color-family canonicals before coding.)
- [x] 3.3 Preserve fallthrough behavior: unknown scale keys still emit as literals (consistent with existing top-level pass-through semantics). Only known scale keys in the theme's `colors` map are resolved.
- [x] 3.4 Ensure top-level (non-aliased) pass-through behavior is unchanged — no regression in `{ outlineColor: 'primary' }` at the root of `.styles({...})`.
- [x] 3.5 Unskip the Bug 2 acceptance test `[Bug 2] outlineColor inside _focusVisible resolves via colors scale` in `packages/_integration/__tests__/selector-rules.test.ts`.
- [x] 3.6 Run `bun run verify:unit:rust && bun run verify:canary && bun run verify:integration` — confirm Pattern C acceptance passes, no regressions elsewhere.

## 4. Phase 3 — Integration coverage closure

- [x] 4.1 Extend `packages/_integration/__tests__/run-pipeline.ts` to pass `config.selectorAliases` and `config.selectorOrder` to `analyzeProject`, matching the production vite-plugin 14-arg signature. Placeholder nulls permitted for args with no integration-test analog (`pathAliasesJson`, `keyframesBlocksJson` if applicable).
- [x] 4.2 Run `bun run verify:integration` — confirm ALL existing integration tests still pass after the extension. Any regression here indicates a second-order bug worth surfacing; investigate before continuing.
- [x] 4.3 Confirm `packages/_integration/fixtures/read-fixtures.ts` continues to skip `selector-rules/` subdirectory in the top-level `readFixtureFiles` walk. If it does not skip, add the skip (tests should still pass per Phase 3 gate, but the regression-matrix isolation is part of the `pipeline-integration-testing` spec).

## 5. Phase 4 — Dev/build reconciler parity per D1

- [x] 5.1 Locate the dev-mode-specific reconciler branch in the Rust crate. Confirm whether `dev_mode=true` skips elimination entirely or takes a different codepath. (Found: `project_analyzer.rs:1536-1545` — clean `if dev_mode { json!({}) } else { reconcile(...) }` gate. Reconciler itself is dev-mode-unaware.)
- [x] 5.2 Implement Position 3: dev mode retains unrendered components BUT populates `manifest.report.eliminated_details` with a prospective entry matching the reason build mode would emit. Entries SHALL be distinguishable from actual eliminations (suggested: add an `is_prospective: true` field, or a separate `prospective_eliminations` array). Design.md's D1 decision is silent on the exact field name — choose one that's clear at the consumer (`extraction-diagnostics`) side and document in the css-reconciler spec scenarios. (Chosen: new `kind: "prospective_component"` variant on existing `EliminatedDetail` — matches existing kind-as-discriminator pattern in struct + consumer, preserves `components_eliminated == count(kind=="component")` invariant. Documented in css-reconciler spec scenario 2.)
- [x] 5.3 Update `packages/vite-plugin/src/index.ts` (and any next-plugin analog) to consume the prospective entries and emit the same `[animus] ⚠` warning as actual eliminations, per the existing `extraction-diagnostics` requirement. (Vite branch added at index.ts:812. Next-plugin has no eliminated_details handling today — flagged as OQ3-adjacent follow-on, not scope-expanded.)
- [x] 5.4 Verify dev vs build output for Pattern E (`createElement` bare-ident): with Phase 1 fix, Pattern E extracts in both modes — so the prospective-elimination path is NOT exercised by this fixture anymore. Consider adding a new fixture that intentionally exercises the prospective-elimination path (e.g. a ds-built component defined but never rendered) and assert the manifest carries the prospective diagnostic in dev mode. (Added `selector-rules-prospective-unrendered.tsx` — PatternH defined, never rendered. Integration test asserts `kind: "prospective_component"` appears in dev mode and `kind: "component"` appears in prod mode, at parity.)
- [x] 5.5 Run `bun run verify:full` — confirm dev and build produce the same set of extracted components for the selector-rules fixture matrix. (All 8 stages green: lint, compile, types, unit:ts, unit:rust, canary, integration, build:next, build:showcase, build:vite, assert:next, assert:showcase, assert:vite. Observed in the vite-app build output: `[animus] ⚠ Alert eliminated` + `[animus] ⚠ Badge eliminated` confirming the warning path fires in production builds. The fix-selector-rule-extraction `selector-rules-prospective-unrendered.tsx` fixture exercises the dev-mode half at the integration tier.)

## 6. Phase 5 — Fresh showcase rebuild re-audit (investigation, no code)

- [x] 6.1 Run `bun run clean:full && bun run verify:build:showcase` to produce a fresh showcase dist unaffected by any stale extractor artifacts. (Done; stale-free dist at `packages/showcase/dist/assets/styles-np2ZI_63.css`.)
- [x] 6.2 Re-audit dist CSS: count `animus-CloseButton`, `animus-ModeTrigger`, `animus-TabButton`, `animus-ColorPalette`, `animus-DocsBreadcrumb`, `animus-CopyButton`, `animus-NavBar`, `animus-Heading`, `animus-SkipLink` rule occurrences in `packages/showcase/dist/assets/styles-*.css`. Document per-component rule count + `:focus-visible` selector count.

  **Audit results (2026-04-21 post-Phase-4 fresh build):**

  | Component | Pre-fix rules | Pre-fix `:fv` | Post-fix rules | Post-fix `:fv` | Status |
  |---|---|---|---|---|---|
  | CloseButton | 0 | 0 | 3 | 1 | ✓ FIXED (Phase 1) |
  | ModeTrigger | 0 | 0 | 3 | 1 | ✓ FIXED (Phase 1) |
  | TabButton | 0 | 0 | 5 | 1 | ✓ FIXED (Phase 1) |
  | ColorPalette | 0 | 0 | 7 | 1 | ✓ FIXED (Phase 1) |
  | DocsBreadcrumb | 0 | 0 | 4 | 1 | ✓ FIXED (Phase 1) |
  | CopyButton | 7 | 0 | 8 | 1 | ✓ FIXED (Phase 2) |
  | NavBar | 33 | 0 | 54 | 1 | ✓ FIXED (Phase 2) |
  | Heading | 8 | 0 | 8 | 0 | REMAINING — deferred to follow-on (see 6.3) |
  | SkipLink (control) | 2 | 1 | 2 | 1 | ✓ stable |

  8 of 9 fully restored. The CopyButton-class selective-drop hypothesis (suspected pre-fix as the deferrable class) was actually resolved by Phase 2 — the remaining regression is Heading, which uses the nested scale path `{colors.scheme.300}` inside `_focusVisible` at `packages/showcase/src/components/docs/Heading.tsx:63`.
- [x] 6.3 For any component still showing regression after Phases 1–4 landed, scope a follow-on change. Likely candidates: CopyButton-class (nested scale path / color-mode-adaptive token resolution). Do not expand this change to cover them. (Heading `_focusVisible` block at Heading.tsx:63 uses `outline: '2px solid {colors.scheme.300}'` — nested scale path through color-mode-adaptive `scheme` scale. `scheme` resolves to a contextual-var, not a flat palette entry, which is why this path differs from regular `{colors.primary}` resolution. Scoped to follow-on proposal, NOT expanded here.)
- [x] 6.4 Close OQ3 — check whether `next-plugin` passes selector aliases to `analyzeProject` in the same way vite-plugin does. If not, either (a) extend this change to include a next-plugin coverage-parity requirement, or (b) scope to a follow-on. Default: scope to follow-on to keep this change tight. (Confirmed: next-plugin `packages/next-plugin/src/plugin.ts:542` and `:841` both pass `this.selectorAliasesJson` to `analyzeProject`. Selector-alias parity holds. OQ3 resolved positively — no follow-on needed on this axis. Separate observation: next-plugin does NOT emit `eliminated_details` warnings (confirmed via grep); that's a diagnostic-emission gap distinct from OQ3, scoped to a separate follow-on if user wants production-symmetric warning emission.)

## 7. Documentation + archive

- [x] 7.1 Update the `packages/showcase/CLAUDE.md` "Common Breakage Patterns" section if the root cause of any showcase regression covered by this change is a useful future debugging breadcrumb. (Added 3 breadcrumbs: createElement scanner gap + dev-mode prospective warning, color-family pass-through in aliased blocks, nested scale path through color-mode-adaptive scale regression.)
- [x] 7.2 Run `openspec validate fix-selector-rule-extraction --strict` — must pass. (Passed — "Change 'fix-selector-rule-extraction' is valid".)
- [ ] 7.3 Archive via `/opsx:archive fix-selector-rule-extraction` once Phases 1–5 are complete and the fresh-build re-audit shows the CloseButton + PatternC class of regressions resolved. (BLOCKED 2026-04-21: `openspec archive` aborts with `jsx-system-prop-scanner MODIFIED failed for header "### Requirement: Component render tracking at JSX callsites" - not found`, despite baseline `openspec/specs/jsx-system-prop-scanner/spec.md:169` containing the exact header. Validation passes. Workaround candidates: fix delta body to match baseline body verbatim, use `--skip-specs` with manual baseline update, or file an openspec bug report. Proceeds independently of new arcs since new MDX delta is `ADDED` and does not collide with this `MODIFIED`.)
- [x] 7.4 Update session memory with the outcome: which bugs were fixed, which CopyButton-class findings were deferred to follow-on, any architectural insights worth preserving (e.g. "extractor's dev/build divergence was the bug-hiding mechanism, not the bug itself"). (Session 83 memory updates: feedback_inner_court_novel_strategies.md (session-83 addendum with trio 2), feedback_terminology_slip_guard.md (new failure class), project_mode_overridable_vs_contextual_var.md (disambiguation memory), feedback_addColors_vs_addModes.md (terminology correction), project_session_2026_04_20.md (session-83 extension).)

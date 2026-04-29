## Context

The showcase dev/build divergence audit (2026-04-20) surfaced styles that render correctly in dev but disappear in production builds. The user's initial report — "close button has no styles in dist but works in dev" — drove a systematic audit across `packages/showcase/dist/assets/styles-*.css`:

| Component | Base rules | :focus-visible | Failure mode |
|---|---|---|---|
| CloseButton (Drawer.tsx) | 0 | 0 | Total drop |
| ModeTrigger (Shell.tsx) | 0 | 0 | Total drop |
| TabButton (TabGroup.tsx) | 0 | 0 | Total drop |
| ColorPalette | 0 | 0 | Total drop |
| DocsBreadcrumb | 0 | 0 | Total drop |
| CopyButton | 7 | 0 | Selective drop |
| NavBar | 33 | 0 | Selective drop |
| Heading | 8 | 0 | Selective drop |
| SkipLink (control) | 2 | 1 | Works |

Minimized repros in `packages/_integration/fixtures/components/selector-rules/` (Patterns A–G) pin down two confirmed-on-current-code bugs and characterize adjacent behaviors:

**Bug 1 — JSX scanner gap**: `createElement(bareIdent, ...)` CallExpressions are not recognized as component render usage. The JSX-element (`<Component>`) and JSX-member-expression (`<Namespace.Member>`) paths are recognized; the sibling `createElement` patterns are not. Pattern E proves this: `components_eliminated: 1`, reason `"component not rendered and not a parent"` with `dev_mode=false`. CloseButton in `Drawer.tsx:274` is the canonical production case (rendered only via `createElement(CloseButton, ...)` inside `createPortal`).

**Bug 2 — Scale lookup gap inside selector-alias blocks for pass-through CSS props**: `_focusVisible: { outlineColor: 'primary' }` emits `outline-color: primary;` (unresolved literal) instead of `outline-color: var(--color-primary);`. Pattern C proves this. propConfig-registered props (e.g. `color`) already resolve inside aliased blocks via the existing scale-lookup path; the bug is scoped to pass-through CSS props that only typecheck via `ThemedCSSProps`.

**Dev/build divergence**: Pattern E extracts correctly under `dev_mode=true` but is eliminated under `dev_mode=false`. This silent semantic gap is what lets Bug 1 ship to production unnoticed — users see correct behavior during authoring and only discover the regression after a production build. The divergence is an authoring-feedback failure, not an extraction failure per se.

**Integration coverage gap**: `_integration/__tests__/run-pipeline.ts` calls `analyzeProject` with 9 arguments. The production vite-plugin (`packages/vite-plugin/src/index.ts:400-415`) uses 14 arguments including `selectorAliasesJson` and `selectorOrderJson`. The integration tier has never exercised selector-alias processing — which is exactly where both bugs live. This is the structural reason the regression class escaped integration detection.

**Partially diagnosed but out of scope**: CopyButton/NavBar/Heading's "selective drop" pattern (base rules present, `:focus-visible` absent) does NOT reproduce at minimum unit. Pattern G (full `.styles+_hover+_focusVisible+.variant+.states` chain with `{colors.primary}` token ref) extracts correctly. The real cause likely involves showcase-specific theme shape — nested scale paths like `{colors.scheme.300}` or color-mode-adaptive scales — and needs its own minimized repro before it becomes scoped work. Tracked as an open question; follow-on change if confirmed on fresh build.

## Goals / Non-Goals

**Goals:**
- JSX scanner recognizes `createElement(bareIdent, ...)` and `createElement(MemberExpr, ...)` CallExpressions as component render usage, parity with `<Component>` / `<Namespace.Member>`.
- Scale lookup inside `_`-prefixed selector-alias blocks applies to pass-through CSS props (at minimum the color family), not only propConfig-registered props — aligning extractor behavior with the `ThemedCSSProps` TS contract.
- Integration tier exercises selector-alias processing via the production NAPI signature.
- Dev/build reconciler parity: scanner blind spots SHALL be observable in dev output, not require a production build to surface.
- Seven selector-rule fixtures (Patterns A–G) are registered as permanent regression acceptance criteria with the seal-then-unseal test pattern.

**Non-Goals:**
- Runtime CSS changes — pure static-extractor work.
- Consumer-facing API changes — all changes are internal behavioral.
- Theme-shape changes in `test-system.ts` or showcase.
- Codemods — affected authoring patterns (`createElement(bareIdent)` and `outlineColor: 'primary'` inside aliased blocks) were implicitly broken before; no consumer source changes required.
- Expanding `ThemedCSSProps` TS surface or narrowing it — orthogonal decision captured in (D2) but implementation deferred unless chosen approach requires it.
- The CopyButton-class selective-drop root cause — deferred pending fresh-build repro.
- New `extraction-diagnostics` requirements — that spec already requires "elimination warnings always print"; honoring it is an implementation concern under that spec's existing scope, not a new requirement here.

## Decisions

### D1 — Dev/build reconciler parity strategy: retain in dev + emit dev-mode diagnostic

**Decision:** Adopt Position 3 from the proposal. `dev_mode=true` retains unrendered components (preserves HMR flows where a component is added but not yet referenced). The manifest's `report.eliminated_details` in dev mode SHALL carry a prospective entry for every component that WOULD be eliminated in build mode, so `extraction-diagnostics` can surface it as a warning at authoring time.

**Alternatives considered:**
- Position 1 (eliminate in both modes): rejected. Breaks hot-add flows common during authoring — add `const Foo = ds.styles({...}).asElement('div')`, save, then use it in JSX a moment later. Strict elimination means the CSS vanishes between saves.
- Position 2 (retain in both modes): rejected. Weakens dead-code elimination in production. No feedback to the consumer when a component is accidentally never rendered — silent bloat.
- Position 3 (compromise — chosen): preserves HMR ergonomics AND closes the authoring-feedback gap. Slight implementation complexity (manifest carries dev-mode diagnostic entries), but the alternative is users discovering scanner gaps in production CI. Aligns with the root `CLAUDE.md` "atomic tiers fail loud" ethos.

**Consequence:** `extraction-diagnostics` already requires "elimination warnings always print." In dev mode, the `eliminated_details` entries sourced from prospective elimination will drive the same warning path. No new diagnostic requirement needed — just ensure the plugin consumes prospective entries identically to actual entries.

### D2 — Scale lookup contract for pass-through CSS props: expand extractor

**Decision:** Expand the extractor's scale-lookup path to honor the `ThemedCSSProps` TS contract for pass-through CSS props inside aliased blocks. Scope the Phase 2 implementation to the color family (`outlineColor`, `caretColor`, `accentColor`, etc. resolving via the `colors` scale); a full audit of CSS-property-to-scale mapping is captured as Open Question OQ1.

**Alternatives considered:**
- Narrow the TS contract (Position 2 from proposal): rejected. `ThemedCSSProps` already offers autocomplete for every CSS color-family property via the shared color scale. Narrowing it to only propConfig-registered props would surprise consumers whose autocomplete shows a valid suggestion that then doesn't resolve. Memory `feedback_type_signature_performance` also constrains — deep TS narrowing must not explode inline generics, and adding per-prop gates is hard to do without mapped-type cost.
- Leave both sides inconsistent (status quo): rejected. Consumer experience is "I typed a valid scale key, the browser got invalid CSS." That's a contract violation.

**Consequence:** The Rust side needs to know which CSS properties resolve via which scales independently of propConfig membership. Fortunately the existing propConfig entries already encode this mapping for registered props — the expansion reuses the same scale-lookup code with a broader gate condition.

### D3 — Seal-then-unseal test pattern for bug fixes

**Decision:** Use paired test pattern for each bug:
- `test('[Bug N seal — current broken behavior]', ...)` — passes today by asserting the broken behavior (e.g. `components_eliminated === 1`).
- `test.skip('[Bug N] ... acceptance', ...)` — skipped today; when fix lands, delete seal and unskip acceptance in the same commit.

**Alternatives considered:**
- Only skipped acceptance tests: rejected. Silent drift — if the broken behavior silently changes (e.g. an unrelated fix accidentally addresses it), no test fails and no alarm bell rings. The skip stays skipped indefinitely.
- Only seal tests: rejected. No forward-looking acceptance criteria visible in the suite.
- Paired seal + acceptance (chosen): fixing the bug FORCES a coordinated edit. Surfaces silent drift as a test failure. Makes the acceptance criteria legible.

**Consequence:** Each bug fix tasks involves deleting the seal test and unskipping the acceptance test as explicit steps. Tasks.md must list these edits so they aren't forgotten.

### D4 — Integration coverage closure scope: extend existing `runPipeline`

**Decision:** Modify the existing `runPipeline` helper to always pass `selectorAliases` and `selectorOrder`. Do not introduce a separate `runPipelineWithSelectorAliases` helper.

**Alternatives considered:**
- Separate helper for selector-alias-aware tests: rejected. Two helpers mean two code paths diverging over time. The goal is to close the gap, not to create a parallel one.
- Extend signature additively with optional params at the end: rejected. The existing 9 args already map 1:1 to production call; we're not extending the signature, we're filling in the existing trailing optionals.

**Consequence:** Phase 3 re-runs the full `verify:integration` tier after extension. If any existing test fails, investigate — a pre-existing test that relied on selector-alias-less behavior is itself a bug worth surfacing.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Extending `runPipeline` breaks an existing integration test that silently relied on selector-alias-less behavior | Run full `verify:integration` after Phase 3; investigate any failure as potentially a second-order bug. If a test legitimately should not use selector aliases (edge case), consider per-test opt-out, but first assume the failure is a real issue. |
| Bug 2 fix resolves `outlineColor: 'primary'` inside aliased blocks that previously emitted literal unresolved. A consumer hypothetically relied on the literal emission (extremely unlikely — it's invalid CSS). | Cross-reference the active codebase via Grep for any `outlineColor: '[bareScaleKey]'` inside `_aliased` blocks before landing Phase 2. Document the behavior change in the change's archive note. |
| Bug 1 fix causes components previously silently eliminated to start extracting in builds, potentially bloating CSS size for components rendered via `createElement(bareIdent)` that were deliberately dead-code | Acceptable: dead-code-elimination should be driven by not-actually-used, not by scanner blind spots. Bloat is strictly lower-priority than correctness. |
| Dev-mode diagnostic for prospective eliminations floods noise if projects have many intentionally-unrendered components | Dev-mode diagnostic goes through existing `extraction-diagnostics` `logger.warn()` path, filterable by the `[animus] ⚠` prefix. Unusual cases (library packages with many components-for-consumer-use) can set `strict: false` to suppress escalation. |
| Reconciler "keep unrendered in dev + warn" implementation touches dev-mode-only code paths; risk of divergence breeding between modes over time | Codify parity as a spec requirement (`css-reconciler` delta) so new changes touching reconciler logic MUST uphold it. |

## Migration Plan

Behavioral-only change, no consumer migration needed. Deploy flow:

1. **Phase 1** — Bug 1 JSX scanner fix. Land; `verify:canary && verify:integration && verify:build:showcase`. If CSS bundle size grows in showcase, confirm the new components are legitimately rendered via `createElement(bareIdent)` (audit: Grep for `createElement\(` in showcase src).
2. **Phase 2** — Bug 2 scale lookup. Land; `verify:canary && verify:integration && verify:build:showcase`. Pattern C acceptance test unskips.
3. **Phase 3** — Integration coverage closure. Land; `verify:integration`. Re-confirm all existing integration tests pass.
4. **Phase 4** — Dev/build reconciler parity per D1. Land; `verify:full`.
5. **Phase 5** — Fresh showcase rebuild re-audit (investigation, no code). If the audit surfaces CopyButton-class causes, scope a follow-on change.
6. **Rollback**: each phase is an isolated commit on the branch; revert individually if post-land issues surface.

## Open Questions

**OQ1 — Which CSS properties map to which scales for pass-through resolution (Bug 2 scope)?**
Phase 2 scopes to color-family properties (`outlineColor`, `caretColor`, `accentColor`, `textDecorationColor`, `columnRuleColor`, `borderBlockColor`, etc.). A complete audit of CSS-property-to-scale mapping (length → space, etc.) is deferred — if the color-family fix lands cleanly, follow-on proposals can expand. Proposed follow-up: enumerate the propConfig entries and derive a canonical "CSS property family → scale" map shared between TS (`ThemedCSSProps`) and Rust (scale-lookup gate).

**OQ2 — CopyButton-class selective-drop root cause.**
Pattern G proves chain richness isn't the trigger. Likely candidates:
- Nested scale paths (`{colors.scheme.300}` with the dotted subscript) failing resolution when the token is a color-mode-adaptive variable rather than a flat palette entry.
- Color-mode-contextual vars interacting badly with aliased-block emission.
- Stale dist — showcase `dist/` may predate recent extractor fixes. A fresh `bun run clean:full && bun run verify:build:showcase` would invalidate this hypothesis or narrow it.

Scope: deferred to Phase 5 investigation; any confirmed bug becomes a follow-on change.

**OQ3 — Does `next-plugin` mirror the production signature?**
Proposal-level claim ("production call is 14 args") was verified in `packages/vite-plugin/src/index.ts`. The `next-plugin` uses the same NAPI interface but may have its own `runAnalysis`-equivalent. Phase 3 should verify Next's call matches Vite's — if Next also omits selector aliases, that's a parallel coverage gap to close, possibly out of scope for this change and worth a follow-on if substantial.

**OQ4 — Should the `extraction-diagnostics` "always warn" requirement be tightened to differ in strict mode?**
Existing requirement prints warnings unconditionally. If strict-mode CI should fail on reconciler eliminations, that's a strictness change in `extraction-diagnostics`, not in this change. Deferred.

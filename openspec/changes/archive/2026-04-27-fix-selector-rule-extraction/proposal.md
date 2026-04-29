## Why

Showcase dev/build divergence audit (2026-04-20) surfaced two bugs in the Rust extractor where production builds drop styles that dev correctly emits. The user's original report — "close button has no styles in dist but works in dev" — is exactly this class. Both bugs are reproducible on current code via minimized integration fixtures. The integration test tier has a coverage gap that allowed both bugs to ship: `runPipeline` invokes `analyzeProject` with 9 args while the production vite-plugin passes 14 (including `selectorAliasesJson`/`selectorOrderJson`), so selector-alias processing was never integration-covered.

A silent dev/build semantic divergence in the reconciler compounds the problem: dev mode keeps components that build mode eliminates, so scanner gaps are only visible in production artifacts.

## What Changes

- Fix JSX scanner: recognize `createElement(bareIdent, ...)` CallExpressions as component render usage. Today only `<Component>` and `<Namespace.Member>` are recognized; components rendered exclusively via `createElement(BareIdent, ...)` (e.g. `CloseButton` in `packages/showcase/src/components/layout/Drawer.tsx:274` under `createPortal`) are eliminated by the reconciler in build mode with reason `"component not rendered and not a parent"`.
- Fix scale resolution inside selector-alias nested blocks: theme-scale-typed string values on pass-through CSS props (e.g. `_focusVisible: { outlineColor: 'primary' }`) SHALL resolve via the `colors` scale to `var(--color-primary)`, not emit as literal `outline-color: primary;`. Registered propConfig props (e.g. `color`) already resolve correctly inside aliased blocks; the bug is scoped to pass-through CSS props that only typecheck via `ThemedCSSProps`.
- Close integration coverage gap: `packages/_integration/__tests__/run-pipeline.ts` SHALL invoke `analyzeProject` with the production 14-arg signature including `selectorAliases` and `selectorOrder`. All existing integration tests SHALL continue to pass after the extension.
- Codify dev/build reconciler parity for unrendered components: reconciler elimination decisions SHALL NOT silently diverge between `dev_mode=true` and `dev_mode=false`. Either both modes eliminate, both keep, or dev emits an authoring-time warning matching what build would eliminate — decision captured in design.md, mechanics captured in the reconciler spec.
- Register a permanent regression-test fixture matrix for selector-rule authoring in `packages/_integration/fixtures/components/selector-rules/`. Seven fixtures already written (Patterns A–G) cover raw `&:selector` + alias mixes, token refs in shorthand values, compound aliases (`_selected`), createElement bare-ident usage, unresolvable-token characterization, and full-chain (`.styles+_hover+_focusVisible+.variant+.states`).

Note: `extraction-diagnostics` already requires "reconciler elimination warnings always print via Vite's logger" (existing scenario `Component eliminated as not rendered`). This change assumes that requirement is honored but does NOT introduce a new diagnostic requirement. If audit finds the warning isn't firing in practice, that's an implementation bug tracked under that spec, not a scope expansion here.

## Capabilities

### New Capabilities
(none — this change fixes two bugs and hardens two existing capabilities)

### Modified Capabilities
- `jsx-system-prop-scanner`: scanner SHALL recognize `createElement(bareIdent, ...)` and `createElement(Namespace.Member, ...)` CallExpressions as component render usage, joining existing JSX-element and JSX-member-expression recognition paths.
- `selector-alias-registry`: inside `_`-prefixed selector-alias blocks nested within `.styles({...})`, theme-scale-typed string values SHALL resolve via the theme scales regardless of whether the CSS property is registered in propConfig. Today the resolution path only covers propConfig-registered props; pass-through CSS props (e.g. `outlineColor`) emit the scale key literally.
- `pipeline-integration-testing`: the shared `runPipeline` helper SHALL invoke `analyzeProject` with the production signature including `selectorAliasesJson` and `selectorOrderJson`. Fixture discovery SHALL support subdirectories under `fixtures/components/` so grouped regression fixtures (e.g. `selector-rules/`) can live without colliding with the top-level multi-file walk.
- `css-reconciler`: component-elimination decisions SHALL be consistent between `dev_mode=true` and `dev_mode=false`, or any intentional divergence SHALL surface as an authoring-time diagnostic in dev mode. The specific resolution (always-align / dev-warn-only / keep-divergence-with-notice) is an ADR captured in design.md.

## Impact

**Code affected:**
- `packages/extract/src/jsx_scanner.rs` (or equivalent walker) — CallExpression recognition for `createElement(...)` form
- `packages/extract/src/style_evaluator.rs` / `theme_resolver.rs` — scale lookup in nested selector-alias visitor
- `packages/extract/src/project_analyzer.rs` or reconciler module — dev/build parity
- `packages/_integration/__tests__/run-pipeline.ts` — signature extension
- `packages/_integration/fixtures/read-fixtures.ts` — subdirectory support (if chosen over flat-only)

**APIs affected:** none (internal behavioral changes; external NAPI signature unchanged).

**Consumers affected:**
- Any consumer rendering a ds-built component exclusively via `createElement(BareIdent, ...)` in production — previously dropped, now extracted. Behavior change is unambiguously a fix.
- Any consumer authoring `_aliased` blocks with pass-through CSS props using bare scale keys (e.g. `outlineColor: 'primary'`) — previously emitted literal `outline-color: primary;` (invalid CSS), now resolves to `var(--color-primary)`. Behavior change is unambiguously a fix; unlikely anyone was depending on the broken literal emission.
- Dev-mode authoring feedback tightens depending on chosen dev/build parity Position.

**Dependencies:** no new external dependencies.

**Out of scope (explicit):**
- Runtime CSS changes — pure static-extractor work.
- Theme-shape changes in `test-system.ts` or showcase.
- Codemods for authoring patterns.
- The "CopyButton-class selective-drop" investigation — showcase dist shows CopyButton extracting base rules but dropping `:focus-visible`. Pattern G minimum repro (full `.styles+_hover+_focusVisible+.variant+.states` chain with token ref) works correctly, so the cause is likely theme-shape-specific (nested scale paths like `{colors.scheme.300}`, color-mode-adaptive scales). Scope to a follow-on change once reproduced on fresh build.
- Fresh showcase rebuild re-audit — investigation task scoped to this change, but any additional bug classes surfaced will be follow-on proposals, not expanded scope here.
- `extraction-diagnostics` already specifies "elimination warnings always print." If that's not honored today, it's an implementation bug under that spec's existing requirement — not a new requirement this change introduces.

## 1. Phase 0 — Investigation gate

- [ ] 1.1 Author the 4-fixture matrix under `packages/_integration/fixtures/components/mode-aliased/`:
  - `mode-nested-aliased.tsx` (reproduces Heading bug — `_focusVisible: { outline: '2px solid {colors.scheme.300}' }`)
  - `mode-simple-aliased.tsx` (`_focusVisible: { color: '{colors.scheme.300}' }`)
  - `flat-nested-aliased.tsx` (`_focusVisible: { outline: '2px solid {colors.fire.500}' }` — regression guard)
  - `mode-nested-toplevel.tsx` (top-level `outline: '2px solid {colors.scheme.300}'` — regression guard)
- [ ] 1.2 Add paired seal/acceptance tests in `packages/_integration/__tests__/mode-aliased.test.ts` per the `fix-selector-rule-extraction` D3 pattern. For the two buggy shapes (1 and 2) write `test('[Bug N seal]')` asserting current broken behavior and `test.skip('[Bug N acceptance]')`. For the regression-guard shapes (3 and 4) write plain acceptance tests.
- [ ] 1.3 Run `bun run verify:integration` — confirm the seals pass and the skipped acceptances would fail against current behavior.
- [ ] 1.4 Grep + read the `addModes(...)` emitter path in `packages/system/src/` to identify where mode-overridable values get written into the flat theme (and into `variableMapJson` / `contextualVarsJson` — confirm which container carries the mode-overridable entries vs. what carries true contextual-vars).
- [ ] 1.5 Read both the top-level style resolution branch AND the aliased-block branch in `packages/extract/src/theme_resolver.rs`. Confirm which dispatcher function(s) each branch calls when encountering a `{scale.path}` syntax in a value. Document in design.md (append to OQ2 with the resolved answer).
- [ ] 1.6 Run the fixture matrix through the NAPI pipeline with `ANIMUS_DEBUG=1` OR targeted `println!`/`tracing::debug!` logging in the three candidate modules (`style_evaluator.rs`, `theme_resolver.rs`, `css_generator.rs`) to localize where the aliased-block rule is being dropped for shapes 1 and 2.
- [ ] 1.7 Document the localized failure point in design.md as the FINAL paragraph of OQ1 resolution — include file:line references and a one-paragraph explanation of WHY that path drops. Fail-fast checkpoint: if localization fails, pause and re-scope before Phase 1.
- [ ] 1.8 Append an explicit ADR-style decision to design.md's Decisions section stating which module owns the fix (e.g. "D5: Fix lives in `theme_resolver.rs::resolve_flat_styles` aliased-block branch — the existing top-level path dispatches X and the aliased-block path dispatches Y").

## 2. Phase 1 — Fix

- [ ] 2.1 Implement the fix in the module localized by Phase 0. Scope: minimal diff that makes shapes 1 and 2 emit correctly without changing behavior for shapes 3 and 4.
- [ ] 2.2 Delete the Bug 1 seal test; unskip the Bug 1 acceptance test in `mode-aliased.test.ts`.
- [ ] 2.3 Delete the Bug 2 seal test; unskip the Bug 2 acceptance test in `mode-aliased.test.ts`.
- [ ] 2.4 Run `bun run verify:unit:rust` — all existing tests + any new Rust-side unit tests added as part of the fix SHALL pass.
- [ ] 2.5 Run `bun run verify:canary` — confirm NAPI boundary snapshots remain stable (or update them if the fix legitimately changes the snapshot; review the diff and confirm it matches expectation).
- [ ] 2.6 Run `bun run verify:integration` — confirm all 4 fixture shapes pass their acceptance tests AND no pre-existing integration tests regress.
- [ ] 2.7 Confirm dev/build parity for the new fixtures: run each fixture under both `runPipeline([entry])` and `runPipeline([entry], { devMode: true })` and assert the set of `:focus-visible` / `:pseudo` rules in the extracted CSS is equivalent between dev and prod. The prior arc's Position 3 dev/build parity contract (per `css-reconciler`) is orthogonal to THIS bug's resolution logic, but the parity test serves as a canary for accidental divergence.

## 3. Phase 2 — Showcase regression close

- [ ] 3.1 Run `bun run clean:full && bun run verify:build:showcase` to produce a fresh showcase dist unaffected by any stale extractor artifacts.
- [ ] 3.2 Audit `packages/showcase/dist/assets/styles-*.css` for Heading: count `animus-Heading*-*` rule occurrences AND `:focus-visible` selector occurrences. Expected: `:focus-visible` count ≥ 1 (today it is 0).
- [ ] 3.3 Audit adjacent components for the pattern: `grep -rn "_[A-Z][a-zA-Z]*:.*{colors\.scheme" packages/showcase/src` — any OTHER components using `{colors.scheme.N}` inside an aliased block must also now extract their aliased-block rules. If additional regressions surface and resolve with this fix, note them in the archive update (task 4.4).
- [ ] 3.4 Run `bun run verify:full` — confirm the whole pipeline is green post-fix.

## 4. Phase 3 — Documentation + archive

- [ ] 4.1 Update `packages/showcase/CLAUDE.md` "Common Breakage Patterns" — if this fix resolves the "nested scale × mode-overridable" breadcrumb added during `fix-selector-rule-extraction` Phase 6, mark it as resolved (reword from known-regression to historical-context) or remove it per discretion.
- [ ] 4.2 Run `openspec validate fix-contextual-scale-aliased-resolution --strict` — must pass.
- [ ] 4.3 Archive via `/opsx:archive fix-contextual-scale-aliased-resolution` once Phases 1–2 are complete and Heading's `:focus-visible` rule is confirmed present in fresh dist.
- [ ] 4.4 Update session memory: which module held the fix, which dispatcher function was missing the mode-overridable path, whether the fix surfaced additional regressions that closed as a side-effect, and whether the terminology correction (`contextual-var` vs. `mode-overridable`) changed how future investigations should frame similar paths.

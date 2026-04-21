## Why

The `fix-selector-rule-extraction` arc (2026-04-20 → 2026-04-21) closed two scanner/resolution gaps and restored 8 of 9 regressed showcase components. One regression remains: `Heading` in `packages/showcase/src/components/docs/Heading.tsx:63` writes `_focusVisible: { outline: '2px solid {colors.scheme.300}', ... }` and the dist CSS emits 8 base rules but zero `:focus-visible` selectors for it. Base rules extract correctly; only the aliased block drops.

The distinguishing property of this path is `{colors.scheme.300}` — a nested scale path where `scheme` is a **mode-overridable** sub-scale of `colors` (values switch per `[data-color-mode]` selector; registered via `addModes(...)` on the theme builder), not a flat palette entry and NOT a contextual-var in the strict sense (contextual-vars are property-bound runtime bindings like `currentBg` that track values assigned to specific props — a separate mechanism from mode-overridable scales). This is the same "nested scale path / mode-adaptive token" class that was hypothesized for the CopyButton regression in the prior arc and explicitly deferred — see `project_session_2026_04_20.md` and `fix-selector-rule-extraction/design.md` OQ2.

The bug is confirmed-on-current-code at post-Phase-4 HEAD (this session): fresh `bun run clean:full && bun run verify:build:showcase` reproduces the drop.

## What Changes

- Fix nested scale-path resolution inside selector-alias (`_`-prefixed) and raw (`&:pseudo`) blocks WHEN the path dereferences into a mode-overridable sub-scale (e.g. `{colors.scheme.300}` where `colors.scheme` is registered via `addModes(...)` so values switch per `[data-color-mode]`). Today the base rules emit correctly but the aliased-block rule containing the path is elided from the dist CSS entirely.
- Preserve existing behavior for nested paths through flat palette scales (e.g. `{colors.fire.500}`) — those MUST continue to resolve as they do today.
- Preserve existing top-level behavior — `{colors.scheme.300}` at the root of `.styles({...})` MUST continue to resolve as it does today. The gap is aliased-block-specific.
- Add a permanent integration regression fixture capturing each of the three cross-section shapes (flat nested inside aliased, contextual-var nested inside aliased, simple contextual-var ref inside aliased) as paired seal/acceptance tests per the `fix-selector-rule-extraction` D3 pattern.
- Verify the fresh showcase dist contains Heading's `:focus-visible` rule after the fix.

## Capabilities

### New Capabilities
(none — this change closes an existing gap in aliased-block resolution)

### Modified Capabilities
- `selector-alias-registry`: inside `_`-prefixed selector-alias blocks AND raw `&:pseudo` blocks nested within `.styles({...})`, nested scale-path references (e.g. `{colors.scheme.300}`) that dereference into mode-overridable sub-scales SHALL emit the resolved token alias into the CSS output, consistent with behavior at top-level. Today such paths cause the containing rule to be elided.
- `token-alias-syntax`: the `{scale.path}` syntax's resolution contract SHALL be consistent regardless of authoring position (top-level `.styles({...})` vs `_aliased` block vs raw `&:pseudo` block) and regardless of whether the resolved path terminates in a flat palette entry or a mode-overridable sub-scale entry. Today the consistency breaks on the aliased × mode-overridable intersection.

## Impact

**Code affected (investigation-dependent — exact module TBD via design.md):**
- `packages/extract/src/style_evaluator.rs` — if the nested path string isn't making it through static JSON extraction inside aliased-block visitor paths
- `packages/extract/src/theme_resolver.rs` — if the scale-lookup path in `resolve_single_prop` / aliased-block branch fails to dispatch through the contextual-var resolution codepath for nested paths
- `packages/extract/src/css_generator.rs` — if the block is registered but elided during emission (unlikely given base rules emit)

**APIs affected:** none (internal behavioral fix; external NAPI signature unchanged).

**Consumers affected:**
- Any consumer authoring `_aliased` or raw `&:pseudo` blocks with nested scale paths into mode-overridable sub-scales. Previously the block was silently dropped; now it emits correctly. Pure bug-fix behavior change — no one was relying on the drop.

**Dependencies:** no new external dependencies.

**Out of scope (explicit):**
- Scales other than `colors` with mode-overridable sub-scales (if any) — scoped to `colors`-family paths only for initial closure, matching the color-family-only scope of the prior arc's Phase 2.
- Non-mode-overridable nested paths that work today (e.g. `{colors.fire.500}` where `fire` is a flat palette sub-map) — regression protection only, not expansion.
- True contextual-vars (property-bound bindings like `currentBg` that track prop assignments via `contextual-vars` spec) — orthogonal mechanism, different codepath, not this change.
- Runtime CSS changes — pure static-extractor work.
- Theme-shape changes in `test-system.ts` or showcase.
- Other components exhibiting similar drops (if any surface during investigation) — each scopes to its own follow-on unless the root cause unifies them under this change's scope.
- Broader `extract-pipeline` refactor to localize all "aliased-block resolution divergence" risks under a single code path — worthy follow-on after this bug-level closure, NOT part of this change.

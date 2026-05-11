## Context

`rc-channel-graduation` §3B shipped the `keyframes()` collection factory and extraction-time binding substitution for `animationName: animations.X`. End-to-end proof lives only in `packages/_integration/__tests__/keyframes-binding-substitution.test.ts`, which runs through the direct `runPipeline` harness — it exercises the Rust extractor and the `_integration` glue, but neither the Vite plugin adapter (rollup) nor the Next plugin adapter (webpack). Both plugins have their own `__brand === 'Keyframes'` discovery path on top of the shared Rust `system_loader`. A regression in either plugin's discovery layer would silently break production consumers while leaving the harness green.

Empirical grounding this session:
- `packages/showcase/dist/assets/styles-DrhVMMEb.css` contains `@keyframes animus-kf-<hash>` block declarations AND `animation-name:animus-kf-<hash>` references directly in the emitted CSS file (confirmed via grep). This establishes that, at least for the Vite adapter, binding substitution lands CSS-side — not JS-side.
- `e2e/next-app/.next/static/css/*.css` contains zero `animation-name` references because no fixture currently uses keyframes. The Next plugin's keyframes path is presently unexercised.

The latent `applyUnitFallback` bug caught during §3B (hash-suffix `1w7pb41` was mangled to `animus-kf-1w7pb41px` because `animation-name` was missing from `UNITLESS_PROPERTIES`) was fixed by source edit but is not regression-guarded anywhere. It would re-occur if `animation-name` were removed or renamed.

## Goals / Non-Goals

**Goals:**
- Prove `keyframes()` collection discovery works through BOTH the Vite plugin (rollup) and Next plugin (webpack) adapters — not just through the shared Rust extractor.
- Prove extraction-time binding substitution for `animationName: collection.X` produces a static `animation-name: animus-kf-<hash>` CSS declaration that matches an emitted `@keyframes animus-kf-<hash>` block in the same output.
- Regression-proof the unit-fallback `px` mangling guard on identifier-valued `animation-name` declarations at the post-build layer (so any future removal of `animation-name` from `UNITLESS_PROPERTIES` fails the build, not a visual audit).
- Enforce the cascade-contract invariant that keyframe blocks land inside `@layer anm-global`.

**Non-Goals:**
- Changes to the keyframes feature itself (`packages/system/src/keyframes.ts`, `packages/extract/src/system_loader.rs`, `packages/extract/src/theme_resolver.rs` are all untouched).
- Multi-collection or cross-package keyframes scenarios; a single `animations` export per fixture is sufficient to prove the discovery + substitution path.
- Changes to `packages/_integration/__tests__/keyframes-binding-substitution.test.ts` — it continues as harness-level authoritative proof for mechanics.
- Production-grade assertion of specific authored keyframe names (would require importing from the fixture app into `_assertions`, violating the one-way dependency rule — see question (e)).

## Decisions

### D1: Helper lives in `@animus-ui/assertions`, CSS-only

**Decision:** Add `assertKeyframesExtracted(css: string, config?: KeyframesAssertionConfig): void` to `packages/_assertions/src/assert-css.ts`. Pure function over a CSS string, no I/O, no JS-side helper.

**Rationale:** The showcase CSS audit this session confirmed that both the Vite adapter and (by the shared Rust path) the Next adapter land `animation-name` references in emitted CSS, not in JS bundle scope. The extractor substitutes the identifier at Rust evaluation time, before CSS serialization — there's no runtime hook on the JS side that would later splice a keyframe name into JSX. A JS-side helper would be dead code until a future feature required it.

**Alternatives considered:**
- `assertKeyframesInJs(jsContent: string)` shipped alongside, covering the case where webpack splits `animation-name` into a JS module scope. Rejected on grounding evidence. If a future pipeline change (e.g., CSS-in-JS interop shim) reintroduces JS-side references, add the helper then.

### D2: Helper signature has four configurable knobs

**Decision:** `KeyframesAssertionConfig = { minBlocks?: number; minReferences?: number; namePrefix?: string; insideLayer?: string }` with defaults `{ minBlocks: 1, minReferences: 1, namePrefix: 'animus-kf-', insideLayer: undefined }`.

**Rationale:** Count-based thresholds (`min*`) survive fixture edits — adding a new keyframe doesn't break the assertion, removing all keyframes does. `namePrefix` is configurable for future prefix-scheme migrations without helper churn. `insideLayer` is opt-in because not every call site needs cascade-placement proof (unit tests for the helper itself don't, but build assertions do).

### D3: Six invariants in one helper, not six helpers

**Decision:** One helper checks all six invariants (block count, reference count, dangling refs, px-mangling, cascade placement, prefix conformance) and throws `AssertionError` on the first failure.

**Rationale:** A single helper is the correct abstraction boundary because the invariants are coupled — you cannot meaningfully check "no dangling references" without also collecting the block names. Splitting into six helpers would force every call site to make the same six calls in the same order, creating repetition and a vector for drift.

**Alternatives considered:**
- Six tiny helpers with one-invariant each. Rejected for repetition and drift risk.
- One helper + one extended helper (`assertKeyframesExtractedStrict` that also verifies cascade placement). Rejected — the `insideLayer` opt-in config achieves the same thing with less surface.

### D4: Fixture component is per-app (not via test-ds)

**Decision:** Each e2e app gets its own new component file (e.g., `components/Pulse.tsx`) that defines a `ds.styles({ animationName: animations.X, ... }).asElement(...)` component locally. `@animus-ui/test-ds` is NOT modified.

**Rationale:** `test-ds` is currently styling-only and deliberately scoped to prove the cross-package `includes()` discovery path, not to house every shared primitive. Adding animation to it would broaden its role and couple the change to multiple consumers. Per-app fixtures localize scope to the two e2e surfaces that actually need proof — and duplicating a five-line component across two apps is cheaper than evolving a shared dependency.

**Alternatives considered:**
- Shared animated component in `@animus-ui/test-ds`. Rejected on scope grounds.
- One shared component in `packages/_integration/fixtures/`. Rejected because `_integration` is harness-only; consuming it from `e2e/*` would invert the workspace topology (packages should not import from e2e, but `_integration` is structured around the harness, not as a reusable fixture library).

### D5: Showcase assertion is included

**Decision:** `scripts/assert-showcase-build.ts` gets the `assertKeyframesExtracted` call. In scope for this change.

**Rationale:** The showcase already exports `animations` from §3B — the fixture cost is zero. Adding the assertion costs a single `await assertKeyframesExtracted(css, { insideLayer: 'anm-global' })` line. Failing to include it leaves a tier of the verification pyramid (Vite adapter + showcase build + real-world complexity of MDX content) without a keyframes-specific positional guard, even though the output already demonstrates the invariants hold. This is the textbook case for "free coverage".

**Alternatives considered:**
- Leave showcase out of scope, narrow the change to exactly the two e2e apps. Defensible on scope-purity grounds (the proposal's title says "e2e"), but wasteful. If the user wants the narrowed shape, drop §4 of tasks.md and remove the `showcase-output-assertions` delta; the change is otherwise unaffected.

### D6: Helper naming — `assertKeyframesExtracted`

**Decision:** `assertKeyframesExtracted(css, config?)`.

**Rationale:** Sibling helpers follow `assert<VerbObject>` form (`assertLayerOrder`, `assertNoPlaceholders`, `assertClassNameFormat`, `assertNoUnresolvedTokens`, `assertNoEmotionImports`). "Extracted" is the verb because the full invariant set proves static extraction landed the declarations correctly — it's not just that they're emitted (which "Emitted" would suggest), nor that they're specifically static (which "Static" would suggest and already implies extracted). "Extracted" covers the full lift: discovered → substituted → emitted → cascaded correctly.

**Alternatives considered:**
- `assertKeyframesEmitted` — weaker semantic; emission alone doesn't imply substitution succeeded.
- `assertStaticKeyframes` — ambiguous adjective; "static" could mean the helper itself is stateless.

### D7: Count-based thresholds only, no `expectedNames` mode

**Decision:** The helper does not accept an `expectedNames: string[]` parameter that cross-references emitted names against an authored list.

**Rationale:** Authored-names mode would require the assertion call site (in `e2e/*/scripts/assert-build.ts`) to import the actual `animations` collection from the fixture's `src/ds.ts`. This is legal for the call site (the script is part of the e2e app itself) but would make the helper's fail-modes depend on a separate import that must be kept in sync. More seriously, if we wanted to unit-test the authored-names mode, the test fixtures would need keyframe collections too, pulling `_assertions` transitively close to the system package. Count-based thresholds survive fixture edits cleanly and still produce meaningful failure messages ("expected ≥2 blocks, found 0" is actionable; the dangling-reference check provides structural correctness beyond counts).

**Alternatives considered:**
- `expectedNames` as optional opt-in, default off. Rejected as complexity without a current use case. If future coverage demands name-pinning, revisit then.

## Risks / Trade-offs

- **[Risk]** The Next plugin (webpack adapter) might emit `animation-name` into JS module scope (e.g., as part of a chunk manifest or style injection module) rather than into the static CSS file, leaving the CSS-only assertion toothless. → **Mitigation:** Task 2.4 explicitly runs `verify:build:next` before the assertion call and inspects the emitted `.next/static/css/*.css` files to confirm `animation-name:animus-kf-*` is present before committing the assertion logic. If it's missing from CSS, pause the apply and revisit D1.
- **[Risk]** Adding a rendered component to `app/page.tsx` (RSC) might trip an extraction edge case not yet covered in the Next fixture, given that §3B shipped without an e2e-next keyframes consumer. → **Mitigation:** The task ordering puts the Next wiring (§2) before the Vite wiring (§3) so a failure there is caught first, with the Vite path in reserve as a known-working reference to diff against.
- **[Risk]** `insideLayer: 'anm-global'` brace-counting might mis-track if Lightning CSS minification produces unusual brace patterns (e.g., CSS `content: "{"` inside a rule). → **Mitigation:** The emitted CSS for `@layer anm-global` in both adapters contains only reset rules + keyframes blocks — no `content` declarations with brace characters. If this becomes fragile in future, move to a stricter parser-based approach.
- **[Trade-off]** Count-based thresholds (D7) don't catch the case where the wrong keyframes are emitted (e.g., if a refactor renames `ember` → `flame` but leaves the count right). The dangling-reference check catches the *structural* mismatch, but not the *semantic* one. Acceptable — semantic correctness is the integration test's job.
- **[Trade-off]** Per-app components (D4) mean a future change to the keyframes API would require touching two fixture locations. Acceptable — the two locations are each ~10 lines and intentionally scoped for plugin-adapter coverage.

## Migration Plan

Additive change. No migration, no rollback concerns, no deprecations. Apply order:

1. Land the assertion helper + unit tests in isolation (passes `verify:unit:ts`).
2. Wire Next fixture and extend the next-app assertion script; verify via `verify:next`.
3. Mirror for Vite; verify via `verify:vite`.
4. Extend showcase assertion script; verify via `verify:showcase`.
5. Full-surface `verify:full` as the final gate.

If any tier fails, the previous phases remain independently useful — the helper is production-ready even if one adapter's wiring is deferred.

## Open Questions

None remain. All five design questions flagged during proposal authoring are resolved above (D1–D7). If the user wishes to reopen any, the relevant decision's "Alternatives considered" section captures the dropped path and the rationale for dropping it.

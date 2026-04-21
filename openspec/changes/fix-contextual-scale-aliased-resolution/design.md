## Context

The `fix-selector-rule-extraction` arc (archived 2026-04-21) fixed two aliased-block resolution gaps. A surviving regression — Heading.tsx:63 — proves a third, architecturally-distinct gap: nested scale paths dereferencing into **mode-overridable sub-scales** inside aliased blocks drop the containing rule entirely.

**Terminology disambiguation (set upfront so the design doesn't carry an inaccurate label):** `scheme` is a sub-scale of `colors` whose values are OVERRIDABLE per color mode — registered via `addModes(...)` on the theme builder so that the emitted value switches under `[data-color-mode="dark"]`, `[data-color-mode="light"]`, etc. It is NOT a "contextual var" in the strict sense — contextual-vars (per the `contextual-vars` spec) are property-bound runtime bindings like `currentBg` that track values assigned to specific props. The two mechanisms share the surface-level property of "value depends on context" but are implemented through different paths; conflating them gave the prior arc's hypothesis wrong terminology. This design uses "mode-overridable" when describing `scheme`.

**Confirmed state at this change's proposal time (fresh `bun run clean:full && bun run verify:build:showcase`):**

- `packages/showcase/dist/assets/styles-*.css` contains 8 `animus-Heading*-*` rules for base/variants.
- Zero `animus-Heading*-*:focus-visible` selectors in dist.
- `Heading.tsx:63`'s `_focusVisible` block reads literally:
  ```
  _focusVisible: {
    outline: '2px solid {colors.scheme.300}',
    outlineOffset: '2px',
    opacity: '0.5',
  }
  ```
- `{colors.scheme.300}` resolves through the `scheme` mode-overridable sub-scale. The flat theme key `colors.scheme-300` IS present, but its value switches under `[data-color-mode]` selectors — not a root-level literal.

**Distinguishing characteristics vs. the already-fixed gaps:**

- `{colors.primary}` (flat palette, simple ref, inside aliased block) — works (prior-arc Pattern B/D).
- `{colors.scheme.300}` (mode-overridable, nested path, inside aliased block) — DROPS the block. ← THIS BUG.
- `outlineColor: 'primary'` (bare scale key, pass-through prop, inside aliased block) — works post-Phase-2 (prior arc).

The unique intersection is **nested path × mode-overridable sub-scale × aliased-block position**. None of the three axes on its own has been shown to trigger the drop.

**What we don't yet know (investigation mandated by Phase 0):**

The prior arc's reconciler-elimination-as-bug-hiding-mechanism lesson applies here. We do not know which of three possible codepaths fails:

1. **Style evaluator** — maybe the nested path string IS extracted successfully inside aliased-block visitors but emerges malformed.
2. **Theme resolver** — maybe the aliased-block resolution branch calls a different scale-lookup function than the top-level branch, and that function doesn't know how to dispatch through the mode-overridable resolution path (whatever function today owns emitting values whose `[data-color-mode]` overrides land on the right selectors).
3. **CSS generator** — unlikely given base rules emit, but possible if aliased-block-with-unresolved-contents gets elided as a defensive pass.

Until the minimized repro matrix lands (tasks.md Phase 0), the fix location is under-determined. Phase 0 ALSO SHALL trace which Rust function handles mode-overridable resolution from the aliased-block codepath — I assumed `resolve_contextual_var` in earlier drafting but have NOT verified that's the correct dispatcher for `addModes`-registered scales. Do not carry that assumption into the fix without confirmation.

## Goals / Non-Goals

**Goals:**
- Heading's `_focusVisible` block emits in dist CSS — the specific user-reported regression closes.
- Nested scale paths into mode-overridable sub-scales inside aliased blocks resolve consistently with top-level behavior.
- Integration fixtures capture the four cross-section shapes (flat-nested-aliased, mode-simple-aliased, mode-nested-aliased, mode-nested-toplevel) as paired seal/acceptance tests.
- The fresh showcase dist's rule-count audit per prior-arc task 6.2 shows Heading at `:focus-visible` ≥ 1.

**Non-Goals:**
- Non-`colors` scales with mode-overridable sub-scales (if any exist) — scope to the color family only.
- Broader aliased-block extraction refactor to unify all resolution codepaths under one branch — worthy follow-on after this bug closes, NOT scope here.
- Scale-path normalization changes (dot-to-hyphen, etc.) — the existing `token-alias-syntax` contract stands; this change adds a new invariant about the aliased × mode-overridable intersection, not new syntax.
- Consumer codemod — no authoring-side migration needed.
- Next-plugin-side diagnostic emission for eliminated_details (separate gap observed during `fix-selector-rule-extraction` Phase 4; not this change).
- True contextual-var (property-bound, `currentBg`-style) behavior inside aliased blocks — orthogonal mechanism; if it has its own aliased-block gap that's a separate investigation.

## Decisions

### D1 — Investigation-first gate before coding

**Decision:** Phase 0 MUST build a minimized fixture matrix and localize the failure to one of {style_evaluator, theme_resolver, css_generator} BEFORE Phase 1 (the fix) begins. Write, run, and commit the matrix. Fail-fast on an unexpected shape: if the matrix doesn't reproduce the regression in isolation, the cause lives outside the three suspected modules and scope may need re-evaluation.

**Alternatives considered:**
- Skip to the most-likely module (`theme_resolver.rs` aliased-block branch) and try a fix: rejected. The prior arc's Phase 4 dev/build parity insight applies: silent divergence between codepaths that share a contract is always the first suspect. Guessing risks landing a "fix" that treats a symptom rather than the gap.
- Investigate in Rust unit tests only: rejected. The interaction we're isolating is theme-shape-dependent; integration tier against the real theme fixture is the right granularity.

**Consequence:** Phase 0 is 3-4 fixtures + Rust logging + localized runs. Not a hypothetical investigation — the output is a committed fixture set that lives as permanent regression coverage.

### D2 — Fixture matrix shape: four failure-hypothesis crosses

**Decision:** The Phase 0 matrix SHALL include at minimum:

1. `mode-nested-aliased.tsx` — `_focusVisible: { outline: '2px solid {colors.scheme.300}' }` — reproduces the Heading bug.
2. `mode-simple-aliased.tsx` — `_focusVisible: { color: '{colors.scheme.300}' }` — tests whether nesting is required for the drop or whether any mode-overridable ref inside aliased drops.
3. `flat-nested-aliased.tsx` — `_focusVisible: { outline: '2px solid {colors.fire.500}' }` — confirms flat palette + nested path + aliased works (regression guard, no bug expected).
4. `mode-nested-toplevel.tsx` — `outline: '2px solid {colors.scheme.300}'` at root of `.styles({...})` — confirms the path's resolution works OUTSIDE aliased (regression guard, no bug expected).

The 2×2×2 cross of {flat, mode-overridable} × {nested, simple} × {top-level, aliased} has 8 cells; 4 shapes localize the failure sufficiently without duplicating prior-arc coverage.

**Alternatives considered:**
- Single fixture (just Heading's shape): rejected. Doesn't distinguish whether nesting, mode-overridable sub-scale, or their interaction is the trigger.
- Full 8-cell matrix: rejected. Several cells already have prior-arc coverage — don't duplicate.

**Consequence:** Four new fixtures under `packages/_integration/fixtures/components/mode-aliased/`. Paired seal/acceptance tests per the prior arc's D3 pattern.

### D3 — Spec delta scope: `selector-alias-registry` + `token-alias-syntax` both

**Decision:** Add scenarios to BOTH `selector-alias-registry` (the aliased-block contract) and `token-alias-syntax` (the path-resolution contract). The bug lives at the intersection; pinning the invariant in only one spec would under-specify it.

**Alternatives considered:**
- Single spec delta in `selector-alias-registry` only: rejected. The resolution contract of `{scale.path}` lives in `token-alias-syntax`; a reader looking up "what happens with nested contextual-var paths?" should find the answer there without needing to cross-reference the aliased-block spec.
- Single spec delta in `token-alias-syntax` only: rejected. The aliased-block spec today enumerates which value shapes resolve; adding a scenario there makes the aliased block contract self-contained.
- New spec: rejected. No new capability — it's a gap closure.

**Consequence:** Two delta files, both ADDED (not MODIFIED) since both add new scenarios that don't exist today.

### D4 — Consistency-with-top-level as the observable invariant

**Decision:** The spec's new scenarios SHALL assert the aliased-block output's resolved CSS matches the top-level output's resolved CSS for the same value string (modulo the selector prefix). This makes the invariant testable at the integration tier without needing to describe internal resolution steps.

**Alternatives considered:**
- Describe the resolution mechanism in the spec (e.g. "the contextual-var lookup SHALL be dispatched via `resolve_contextual_var` inside aliased branches"): rejected. Spec describes observable contract; internal module names belong in design.md only.
- Assert a specific CSS output string: rejected. Exact var name or literal emission depends on theme shape — brittle.

**Consequence:** Tests take the form "top-level emits `X`, aliased-block must also emit `X`." This is a natural fit with the paired-fixture-matrix style of prior-arc tests.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Investigation surfaces a cause OUTSIDE the three suspected modules (e.g. reconciler or JSX scanner interaction not yet considered), forcing scope re-evaluation | Phase 0 task explicitly calls this out as a fail-fast signal. If matrix doesn't localize, pause and re-scope rather than thrash on a hypothesis-free fix. |
| Fix lands in theme_resolver but accidentally changes top-level resolution behavior for mode-overridable paths | Regression-guard fixture `mode-nested-toplevel.tsx` asserts no change at top level. Prior-arc Phase 2 precedent (preserve top-level behavior while expanding aliased-block behavior) directly applies. |
| Fix creates new dev/build divergence (unlikely but given prior arc's learning, watch for it) | After fix, run both `dev_mode=true` and `dev_mode=false` on all 4 fixtures and assert CSS parity on the `:focus-visible`/`:pseudo` rules (i.e. same set of selectors emitted). |
| Heading's regression has a different root cause than the generalized "nested-path × mode-overridable × aliased" hypothesis | Fixture 2 (mode-simple-aliased) differentiates: if it ALSO drops, the nesting isn't the trigger, mode-overridable-in-aliased is. Fixture 3 (flat-nested-aliased) independently differentiates: if it ALSO drops, the mode-overridable axis isn't the trigger, nested-in-aliased is. Reshape scope accordingly in design.md update before Phase 1. |
| Terminology slip — the prior-arc's informal use of "contextual" for `addModes`-registered scales pulls the investigation toward the wrong Rust dispatcher (`resolve_contextual_var` vs. whatever actually handles mode-overridable resolution) | Phase 0 includes an explicit Rust-side code-read of the `addModes` emitter + theme_resolver dispatch to NAME the correct function before any fix code is written. Watermarked in OQ2. |

## Migration Plan

Behavioral-only change, no consumer migration needed. Deploy per phase:

1. **Phase 0** — Investigation + fixture matrix landed. No runtime behavior change yet.
2. **Phase 1** — Fix in localized module (TBD per Phase 0 findings). Seal tests delete, acceptance tests unskip.
3. **Phase 2** — Verify Heading regression closed via fresh `bun run clean:full && bun run verify:build:showcase` + rule-count audit.
4. **Phase 3** — Archive.

Each phase is an isolated commit on the branch; revert individually if post-land issues surface.

## Open Questions

**OQ1 — Which module holds the fix?** Resolution in Phase 0 via fixture matrix + targeted logging. Candidate modules documented in D1 above.

**OQ2 — What is the correct Rust function for mode-overridable (`addModes`-registered) scale resolution, and does the aliased-block codepath dispatch to it?** The prior-arc's informal "contextual" terminology pulled earlier drafting toward `resolve_contextual_var` as the assumed dispatcher — that may or may not be correct. Phase 0 SHALL: (a) grep + read the `addModes` emitter path in `packages/system` and `packages/extract` to identify where mode-overridable values get written into the flat theme and how the resolver dispatches them; (b) read both the top-level and aliased-block branches of `theme_resolver.rs` to confirm which function each calls; (c) document the actual dispatcher names in design.md before writing the fix.

**OQ3 — Are there other mode-overridable sub-scales beyond `scheme`?** Check `packages/showcase/src/ds.ts` `addModes(...)` calls. Scope expansion (if any) stays color-family-restricted per D1 non-goal.

**OQ4 — Do raw `&:focus-visible` blocks (not `_focusVisible` alias) exhibit the same drop with this path?** Single additional fixture resolves. If yes → gap is aliased-block-wide (both `_*` and `&:*`). If no → gap is alias-specific, narrower scope. Impact: spec wording in `selector-alias-registry`.

**OQ5 — Does the showcase rebuild after the fix reveal OTHER components that were regressing for the same reason (pattern reuse of `{colors.scheme.N}` inside aliased blocks)?** If yes, same-commit coverage expands to include them; if each has its own quirk, scope them individually. Audit via `grep -rn "_[A-Z][a-zA-Z]*:\s*{[^}]*{colors\.scheme" packages/showcase/src`.

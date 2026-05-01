## Context

Animus has been iterating on the `0.1.0-next.X` dev-prerelease channel since March 2026. As of session 79 (2026-04-16) the API surface was validated via a 5-persona audit and a memoization bug was fixed. Zero active npm consumers exist — older consumers died off years ago, so back-compat gravity is zero.

The maintainer has declared intent to:

1. Cut a public RC channel (`1.0.0-rc.N`) for evangelism
2. Iterate remaining MVP concerns inside RC (breaking changes allowed in `rc.N → rc.N+1`)
3. Graduate to `1.0.0` stable when MVP-complete
4. Commit to patches-only "for a bit" after graduation

Three concrete artifacts in the repo forced this change to be one proposal rather than several:

- `.github/workflows/ci.yaml:180-184` hardcodes `if VERSION contains "-", TAG=next`. Publishing `1.0.0-rc.0` under the current CI would overwrite the `next` dist-tag pointer currently used by `0.1.0-next.61`.
- `SystemBuilder.includes()` at `packages/system/src/SystemBuilder.ts:140-148` is a no-op stub with no type-level composition. Shipping a no-op as part of a 1.0-RC public surface is wrong signal.
- Keyframes work via `createGlobalStyles({ "@keyframes foo": {...} })` structured selector form — functional but not idiomatic (no typed reference, can't `import { fadeIn }` and use in `animationName`).

The existing `openspec/specs/release-workflow/spec.md` already codifies bump mechanics, branch guards, tag-format regex, and a `--channel` flag. What it does not yet codify is channel-scoped CI dist-tag derivation or a pre-publish verify gate.

## Goals / Non-Goals

**Goals:**

- Enable cutting `1.0.0-rc.0` without colliding with the `next` dist-tag
- Settle two pre-RC API idiomacy questions (`includes()`, keyframes) before freeze
- Produce a single graduation runbook covering the three operational flows
- Harden `scripts/release.sh` against the pre-existing `v0.1.1-beta.*` tag drift (cannot delete per CLAUDE.md §1)
- Decide merge strategy for the 140-commit `next` → `main` gap
- Decide CHANGELOG mechanism (current file is dead 2022 lerna junk)
- Pin a stabilization-window contract post-`1.0.0` graduation

**Non-Goals:**

- Implementing multi-system composition (only decides `includes()` API location/shape)
- Shipping 1.1.0 features in this change
- Mutative git operations (tag deletion forbidden per CLAUDE.md §1)
- Rewriting existing published npm prereleases
- Fixing the `system-builder` spec's drift from current code (separate concern — spec describes `.withProperties()` which no longer exists)

## Decisions

### D1. Channel-scoped CI dist-tag derivation

**Decision:** Replace the hardcoded `if VERSION contains "-", TAG=next` check in CI with a parsed-channel derivation: the prerelease identifier segment of the semver is used directly as the `--tag` value.

**Rationale:** Only way to publish `1.0.0-rc.0` to `--tag rc` without clobbering the `next` dist-tag that dev prereleases use. Keeps channel naming self-consistent between `scripts/release.sh --channel rc` and the resulting npm dist-tag.

**Alternative considered:** Explicit mapping table (e.g., `rc → rc`, `next → next`, `beta → beta`). Rejected as redundant — the channel name _is_ the tag name by convention; adding a mapping layer invites drift.

**Consequence:** Existing spec Requirement "CI publish pipeline alignment" (L84-93) must be MODIFIED to describe channel-scoped mapping rather than the current 1:1 prerelease-to-next.

### D2. Pre-publish verify gate in release.sh

**Decision:** `scripts/release.sh` invokes `bun run verify:ci` after the branch/cleanliness guards and before version bump + tag + push.

**Rationale:** Current script delegates entirely to CI, so a local `bun release prerelease` can produce a pushed tag that CI then rejects. Adding a local gate fails-fast without burning a CI cycle. `verify:ci` is the existing "mirror of CI job order" per the root CLAUDE.md verification-tier table.

**Alternative considered:** `verify:full` instead of `verify:ci`. Rejected — `verify:full` is local-pipeline proof; `verify:ci` matches what CI will actually run and is the correct gate.

### D3. Stale-channel guard in `get_latest_tag`

**Decision:** When `get_latest_tag` resolves CURRENT and the CURRENT version's channel differs from the requested `--channel`, the script SHALL require either (a) an explicit `--channel` flag that matches CURRENT's channel, or (b) a channel-agnostic bump type (`major`, `minor`, `patch`, `graduate`). Otherwise it exits with a message naming the channel drift.

**Rationale:** The `v0.1.1-beta.0/1` tags from 2022 currently sort above `v0.1.0-next.61` under `--sort=-v:refname`. Today `bun release prerelease` would yield `0.1.1-beta.2`, silently switching channels. CLAUDE.md §1 forbids deleting the drift tags, so the script must tolerate them.

**Alternative considered:** Hardcode-exclude known-dead channels (`beta`, `alpha`) from the regex. Rejected — brittle; future legitimate betas would be caught by the exclusion.

### D4. Runbook as a single document

**Decision:** One `docs/release-runbook.md` (or equivalent location TBD in tasks) that prescribes three flows end-to-end: (a) cut `rc.0` from fresh main merge, (b) iterate `rc.N → rc.N+1`, (c) graduate `rc.N → 1.0.0`.

**Rationale:** Release work is rare and high-stakes. A runbook that walks through actual commands is higher-leverage than multiple prose docs. Referenced by the new `rc-graduation-runbook` capability spec.

**Alternative considered:** Three separate docs (one per flow). Rejected — breaks the "at a glance, what does a release look like?" mental model.

### D5. `includes()` relocation to constructor args (DECIDED)

**Decision:** Relocate `includes()` from the builder chain method to `createSystem({ includes: readonly SystemInstance[] })` constructor arg. Runtime remains a no-op (correctly) because the semantic is implemented at COMPILE TIME by the extraction pipeline.

**Correction of prior analysis:** An earlier draft of this design recommended DELETE, based on a read that treated `includes()` as a pure runtime no-op. That read was incomplete. `includes()` is a **static-analysis marker** consumed by `packages/extract/pipeline/discover-packages.ts:22` (regex `/\.includes\(\s*\[([^\]]*)\]\s*\)/gs`), which traces each identifier inside the array back to its import declaration to discover external DS packages. The entire multi-package DS consumption model (`@animus-ui/test-ds`, future third-party DS packages) hinges on this mechanism. See `openspec/specs/includes-driven-discovery/spec.md` for the full semantic. The runtime no-op is by design — the pipeline has already resolved external packages at compile time, so the call needs no runtime effect.

**Rationale for RELOCATE over KEEP:**

- Constructor-arg form cleanly expresses "these are the systems I build on top of" as an identity-creation decision, not a chain step.
- RC freeze is the right moment to pick the shape; moving it post-1.0 is a 2.0.0 break.
- The extraction-pipeline regex must update anyway to preserve the discovery semantic — this is not a cost-free preservation.

**Rationale for RELOCATE over DELETE:**

- DELETE would break `packages/showcase/src/ds.ts:647` (live call site) and the entire external-DS consumption model.
- DELETE was the wrong recommendation and has been retracted.

**Preservation contract (required by the relocation):**

- `packages/extract/pipeline/discover-packages.ts` regex updates to parse `createSystem({ includes: [...] })` form. REQ-1 of `includes-driven-discovery` spec changes accordingly (see `specs/includes-driven-discovery/spec.md` in this change).
- During an RC iteration window, the regex MAY accept both patterns to ease migration. Before graduation the regex hard-cuts to constructor-arg form only.
- Live call site at `packages/showcase/src/ds.ts:647` migrates as part of this change's apply phase.

**Consequence:** `system-builder` spec gets an ADDED requirement for the constructor-arg shape. `includes-driven-discovery` gets a MODIFIED requirement for the new AST pattern.

### D6. Keyframes — distributed factory with extraction-time binding substitution (REFINED 2026-04-17)

**Decision:** `@animus-ui/system` exports a top-level `keyframes()` factory that returns a **record of branded references** — one ref per named keyframe. Authoring is distributed (any file, any package). Static extraction is achieved via **extraction-time binding substitution** in the Rust extractor (task 3.6 is now IN SCOPE for this change), not via central registration on a builder.

**Refinement history:** An earlier iteration of D6 shipped a single-branded-block factory with deferred binding substitution and runtime content-hash naming. A 5-persona external review + user-invoked KWATZ surfaced that the single-block shape and the deferred substitution combined to make extracted components regress from static CSS to runtime-injected styles. The refinement keeps the top-level factory posture (winning against theme-side, builder-chain, and factory-from-build alternatives), upgrades the return type to a record of branded refs (typed per-key via `keyof`), and moves task 3.6 from "deferred" to "in scope" so references like `motion.ember` resolve statically in the emitted CSS.

**Usage pattern:**

```typescript
import { keyframes } from '@animus-ui/system';

// Authored anywhere — any file, any package
export const motion = keyframes({
  ember: {
    '0%, 100%': { textShadow: '{shadows.glow-text}' }, // token-ref syntax — typed via Theme aug
    '50%': { textShadow: '{shadows.glow-text-strong}' },
  },
  flow: {
    '0%': { backgroundPosition: '200% 0' },
    '100%': { backgroundPosition: '-200% 0' },
  },
  pulse: {
    '0%, 100%': { transform: 'scale(1)' },
    '50%': { transform: 'scale(1.02)' },
  },
});

// Component usage — branded refs, no template-literal-type gymnastics:
ds.styles({
  animationName: motion.ember, // typed KeyframeRef<'ember'>
});

ds.styles({
  animation: `${motion.flow} 5s linear infinite`, // template literal coerces via toString()
});
```

**Runtime object shape:**

```typescript
type KeyframeRef<Name extends string> = {
  __brand: 'KeyframeRef';
  __name: Name; // literal type preserved for static analysis
  toString(): string; // returns resolved name (runtime fallback)
  valueOf(): string;
};

type Keyframes<Map extends Record<string, KeyframeFrameMap>> = {
  readonly __brand: 'Keyframes';
  readonly __frames: Map; // raw data, used by plugin discovery + theme_resolver
} & {
  readonly [K in keyof Map & string]: KeyframeRef<K>;
};
```

**Name generation — extraction-time binding-aware substitution (task 3.6 IN SCOPE):**

Keyframes names are generated at extraction time from the factory-call binding context. When the extractor processes a component style containing `animationName: motion.ember`:

1. Trace `motion` binding to its `keyframes(...)` factory call. Binding resolution already exists in the extractor for `ds.styles()` discovery; this extends the existing mechanism.
2. Index into the factory-argument record, find `ember`, resolve to a stable generated name (e.g., `animus-kf-motion-ember-<hash>`).
3. Substitute the static name into the emitted component CSS.

For template-literal usage (`` `${motion.ember} 1s` ``): same binding trace, substitute the ref expression with the resolved name string in the emitted CSS.

Runtime fallback (dev, pre-extraction paths, explicit dynamic paths): `toString()` returns a generated name (content-hash or binding-derived) that matches the plugin-emitted `@keyframes <name>` block.

**Emission — into `@layer global` via existing theme_resolver pipeline:**

Plugin scans named exports for `__brand === 'Keyframes'` (the collection, not individual refs). On discovery, the plugin extracts `__frames`, iterates each `(name, frameMap)` pair, resolves each frame body via the existing `theme_resolver::resolve_keyframes_block`, and emits `@keyframes <resolved-name> { ... }` into the virtual stylesheet's `@layer global`. The structured `@keyframes <name>` form inside `createGlobalStyles` continues to work in parallel; the two paths share the theme_resolver.

**Frame body vocabulary — narrower than component styles:**

Frame bodies accept CSS property names (camelCase → kebab), raw CSS values, and `{scale.key}` token refs. Bare scale keys (e.g., `textShadow: 'glow-text'`) are NOT supported because the factory is not bound to a system's propConfig at type-authoring time. Users write `textShadow: '{shadows.glow-text}'` instead — consistent with `{colors.primary}` everywhere else in Animus, not a new syntax.

This narrowing is intentional. The factory is a top-level primitive, not a builder method. Prop config resolution requires system context, which is not available in a top-level factory. Token-ref syntax via `{scale.key}` is the canonical Animus mechanism for referring to theme-resolved values and works in this context via Theme module augmentation without system binding.

**Type signature — branded refs accepted on `animationName`:**

`ThemedCSSProps` widens `animationName` to accept `KeyframeRef<string> | string`. The branded type provides precise type-ahead (`motion.ember` resolves to `KeyframeRef<'ember'>`; typos fail with a clean "Property 'ember' does not exist on type `Keyframes<{flow, pulse}>`" error). String form remains supported for literal selector-form keyframes. Template-literal type gymnastics on the `animation` shorthand are explicitly NOT attempted (per TS Specialist panel review — unnecessary given branded refs).

**Why top-level factory, not builder method or factory-from-build:**

Panel review (5 external reviewers, 2026-04-17) stress-tested six options. Initial synthesis favored a pre-build finalizer (`.addKeyframes()` terminal builder phase) 3-of-5. Post-KWATZ reconsideration:

- Single-call-site central registration imposes a multi-file aggregation tax (DS Author dissent was legitimate at 15+ keyframes, especially with external packages contributing).
- Cross-package composition via distributed authoring is FREE with a top-level factory; forced pass-through otherwise.
- Module augmentation pattern (Option 4) is unworkable in a monorepo due to declaration-merging collision risk (TS Specialist veto).
- The friction we were fighting was OUR engineering debt (task 3.6), not the users' problem. Extraction-time binding substitution is the correct investment — cost moves from users to us.

**Cross-file resolution via binding trace:**

Component in `Logo.tsx` references `motion.flow` where `motion` was authored in `ds.ts` (or `animations.ts`, or an external package's index). Rust's binding resolver traces `motion` back to its import/export and to the factory call; resolves `.flow` to the specific frame; substitutes the name at emit time. Same mechanism the extractor already uses to follow import chains for `ds.styles()` discovery.

**Failure modes:**

- Static extraction cannot resolve the binding (e.g., runtime-dynamic path) → dev mode: `toString()` fallback emits a generated name matching the plugin-discovered `@keyframes` block. Prod mode: hard build error citing the binding that could not be resolved (never silent drop per Static Extraction reviewer).
- Consumer shadows the `keyframes` import (`const keyframes = something`) → static analyzer falls back to no-op with a diagnostic (same as scale-token shadowing).
- Two keyframes collections with overlapping names across packages → each resolves to its own collection-scoped generated name (name generation includes binding/package context, not just the key).
- Keyframe key collides with a theme scale name at the `{keyframes.X}` token-ref level → builder rejects collision at serialization time.

**Sub-decisions closed (2026-04-17):**

- ✓ Export location: top-level from `@animus-ui/system`
- ✓ Return shape: branded RECORD (`Keyframes<Map>`) containing branded REFS (`KeyframeRef<Name>`) per key — NOT a single branded block per factory call
- ✓ Name generation: extraction-time binding-aware (task 3.6 IS in scope for this change; previously deferred)
- ✓ Frame body vocabulary: CSS + `{scale.key}` token refs; NO bare scale keys in frame bodies
- ✓ Discovery: `__brand === 'Keyframes'` on the collection; plugin scans named exports (existing pattern)
- ✓ Theme context: frame bodies use `{scale.key}` refs (Theme module augmentation provides typing)
- ✓ Authoring distribution: any file, any package; no central registration required

### D7. Merge strategy next → main (open)

**Options:**

| Strategy         | Pros                                  | Cons                                                                             |
| ---------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| **Fast-forward** | Preserves commit history, main = next | Loses "this integration point happened" signal; main diverges in one gulp        |
| **Squash merge** | Main history stays linear and flat    | 140 commits of context collapses into one; bisect becomes useless for that range |
| **Merge commit** | Preserves history + marks integration | Creates a merge bubble on main                                                   |

**Consideration:** Whichever strategy is chosen becomes precedent for future graduation merges. If this is the only graduation of its kind, any option works. If we'll periodically cut stable from a long-lived next, merge-commit is most expressive.

### D8. CHANGELOG mechanism (open)

**Options:**

| Option                                                       | Effort | Value                                                                            |
| ------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------- |
| **Reset** — blow away 2022 junk, start fresh at `1.0.0-rc.0` | Low    | Clean baseline; loses dead history that wasn't valuable anyway                   |
| **Append** — keep 2022 entries, add new ones                 | Low    | Preserves history; dead history appears at top forever                           |
| **Auto-gen from conventional commits**                       | Medium | Authoritative; requires commit-message discipline the project may not have today |

### D9. `latest` dist-tag policy during RC (open)

**Options:**

- **Point `latest` at current RC.** `npm install @animus-ui/system` gets the RC. Frictionless evangelism. Unconventional use of `latest`.
- **Leave `latest` stale** at `0.1.0-next.1` until graduation. `npm install @animus-ui/system@rc` is required. Semver-pure.

Either way, graduation auto-reclaims `latest` for the first non-prerelease publish.

### D10. Stabilization window (open)

**Axis 1 — Strictness:**

- Strict: only bugfixes for duration X. New features queue up.
- Loose: cooling-off signal ("we just shipped 1.0; no 1.1 next week"). Features accumulate and ship when ready.

**Axis 2 — Duration:** Fixed (e.g., 3 months) or conditional (e.g., until N consumers active, or until no unresolved MVP feedback in the RC iteration log).

**Consideration:** Strict narrows the definition of "MVP concerns" during RC iteration — anything that isn't a bugfix must land before `graduate`.

## Risks / Trade-offs

- **[D5 lock-in under RELOCATE]** → Mitigation: note in the runbook that constructor-args shape is provisional; a 1.x.0 minor can replace it additively when composition is designed.
- **[CI dist-tag change regression]** → Mitigation: D1 change is gated by `verify:ci` (D2); smoke-test by publishing a `1.0.0-rc.0` to a private registry before cutting the real tag. Or: cut `rc.0` to a non-`latest`, non-`next` dist-tag first and audit before reclaiming.
- **[`get_latest_tag` guard false-positives]** → Mitigation: D3 permits channel-agnostic bumps (`major`, `minor`, `patch`, `graduate`) without the guard firing, so graduation is never blocked by the guard.
- **[Merge strategy precedent]** → Mitigation: D7 is a design decision not a policy; future graduations re-decide.
- **[`system-builder` spec drift]** → Out of scope for this change; flagged for a follow-up spec-hygiene change.
- **[No CI smoke test for CHANGELOG gen if we pick auto-gen (D8)]** → Mitigation: delay D8 auto-gen decision to post-graduation; ship RC with manual CHANGELOG.

## Migration Plan

1. **Phase 1 — Pre-RC idiomacy** (must complete before `rc.0` tag): resolve D5 (`includes()` disposition) and D6 (keyframes primitive). Apply code changes. Update affected tests and showcase content.
2. **Phase 2 — Release-workflow + CI hardening** (must complete before `rc.0` tag): resolve D7 (merge strategy) and D8 (CHANGELOG). Implement D1 (CI dist-tag) and D2 (verify gate) and D3 (stale-channel guard). Land on `main` via the chosen merge strategy.
3. **Phase 3 — Cut `rc.0`**: run `bun release premajor --channel rc` on main. Verify CI publishes to `--tag rc`. Resolve D9 (`latest` dist-tag policy) as part of publish procedure.
4. **Phase 4 — RC iteration**: any MVP concern becomes a separate openspec change; each apply cycle ends in `bun release prerelease --channel rc`. Iterate until MVP concerns are exhausted.
5. **Phase 5 — Graduate**: resolve D10 (stabilization window). Run `bun release graduate`. First non-prerelease publish auto-reclaims `latest`. Publish runbook update announcing stabilization commitment.

**Rollback:** A failed `rc.0` cut is reversible without mutative git — publish an `rc.1` that restores prior behavior, re-evaluate. Full tag/commit lineage is preserved.

## Open Questions

Closed by user review (2026-04-16):

- ✓ D5 — `includes()` disposition: RELOCATE to constructor args. DELETE was retracted after discovering the static-analysis marker semantic.
- ✓ D6 — Keyframes primitive: top-level `keyframes()` export, extraction-resolved naming with runtime hash fallback, `__brand`-based discovery, emission into `@layer global`. Structured form coexists.

Still open, pending resolution at or before apply:

- **D7 — Merge strategy `next → main`**: fast-forward vs. squash vs. merge commit. No assumed path.
- **D8 — CHANGELOG mechanism**: reset vs. append vs. auto-generate. No assumed path.
- **D9 — `latest` dist-tag during RC**: point at RC vs. leave stale. No assumed path.
- **D10a — Stabilization strictness**: strict patches-only vs. loose cooling-off. No assumed path.
- **D10b — Stabilization duration**: fixed time vs. conditional. No assumed path.

D7–D10 do not block Phase 1 (pre-RC idiomacy) tasks. They must be resolved before Phase 3 (cut `rc.0`).

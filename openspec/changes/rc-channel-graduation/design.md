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

**Alternative considered:** Explicit mapping table (e.g., `rc → rc`, `next → next`, `beta → beta`). Rejected as redundant — the channel name *is* the tag name by convention; adding a mapping layer invites drift.

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

### D6. Keyframes idiomacy — top-level primitive, extraction-resolved naming

**Decision:** Add a top-level `keyframes()` primitive exported from `@animus-ui/system`. Returns a branded reference object. Structured `@keyframes <name>` form inside `createGlobalStyles` continues to work. Additive, not replacement.

**Usage pattern:**
```typescript
import { keyframes } from '@animus-ui/system';

export const fadeIn = keyframes({
  '0%':   { opacity: 0 },
  '100%': { opacity: 1 },
});

export const pulse = keyframes({
  '0%, 100%': { transform: 'scale(1)' },
  '50%':      { transform: 'scale(1.05)' },
});

// Use in component styles:
ds.styles({
  animationName: fadeIn,          // branded reference, not a string
  animationDuration: '200ms',
})
```

**Runtime object shape:**
```typescript
type KeyframesReference = {
  __brand: 'Keyframes';
  frames: KeyframesMap;           // raw frame map, used by plugin discovery
  toString(): string;             // returns the resolved name (used via string coercion)
  valueOf?(): string;             // same as toString — makes CSS-string concatenation work
};
```

**Name generation — extraction-first with runtime fallback:**

Matching how component class names work today (`animus-<binding>-<hash>`), keyframes names SHALL be generated by the Rust extractor from the binding-name context when available, with a runtime content-hash fallback for dev-before-extraction paths.

- **Extraction path (authoritative):** When the analyzer encounters `export const fadeIn = keyframes({...})`, it generates a stable name derived from the binding (`animus-kf-fadeIn-<hash>` or similar). The emitted `@keyframes` block uses this name. Any `animationName: fadeIn` reference in extracted components is substituted to the same name.
- **Runtime path (fallback):** The `keyframes()` factory returns an object whose `toString()` yields a content-hash name (`animus-kf-<hash>`). In dev mode before extraction completes, or in any runtime-dynamic path, this name is what appears in the DOM. Because the hash is content-derived, collisions are vanishingly rare.
- **Reconciliation:** Extraction overwrites runtime names by rewriting the emitted class styles. The runtime `keyframes()` return value's identity is preserved; only the generated name string differs between pre-extraction and post-extraction resolution.

**Emission — into `@layer global` alongside structured form:**

Plugin discovery uses the existing `__brand`-based named-export scan (parallel to `GlobalStyleBlock`). On discovery, the plugin emits the resolved `@keyframes` block into `@layer global` of the virtual stylesheet. The existing resolver pipeline (scale lookup, transforms, token aliases) runs against frame values — identical semantics to the structured form.

**Type signature — `animationName` accepts `KeyframesReference | string`:**

`ThemedCSSProps` widens `animationName` (and related longhand properties: `animation` when parsing, `animationComposition`, etc.) to accept `KeyframesReference | string`. String form is preserved for backward compatibility and for raw `@keyframes` selector form. The branded type gates against passing arbitrary objects.

**Theme-context access — not required:**

Frame values resolve `{scale.path}` aliases and prop shorthand at extraction time using the same theme context the plugin already loaded for component extraction. The `keyframes()` factory does not need explicit theme access because resolution happens downstream of the factory — the factory is a data constructor, not a resolver.

**Why top-level export, not returned from `build()`:**

- Consistent with how most consumer CSS-in-JS libraries surface the primitive (Stitches, Emotion).
- Avoids coupling the primitive to the SystemBuilder lifecycle — keyframes can be defined before, alongside, or after the system.
- The extraction pipeline's discovery key is the named export + brand, not the object's lineage back to a system instance.

**Failure modes to handle during apply:**

- Frame value that references an undefined scale → same `[skip]` behavior as component extraction.
- Consumer uses `keyframes(...)` without exporting it → not discoverable by plugin; extraction cannot resolve `animationName: localKf`. Decision: require named export; surface a diagnostic if a local `keyframes()` binding is referenced from another extractable but not exported.
- Consumer shadows the import: `const keyframes = something` → static analyzer falls back to no-op (same behavior as scale-token shadowing). Not addressed by this design.

**Sub-decisions closed during design:**
- ✓ Export location: top-level from `@animus-ui/system`
- ✓ Auto-emit vs. register: auto-emit on brand-discovery (no explicit registration)
- ✓ Type-link mechanism: `KeyframesReference` branded type in `ThemedCSSProps` animationName slot
- ✓ Name generation: extraction-generated (binding-aware), runtime hash fallback
- ✓ Theme context: resolved downstream by plugin; factory is data-only

### D7. Merge strategy next → main (open)

**Options:**

| Strategy | Pros | Cons |
|---|---|---|
| **Fast-forward** | Preserves commit history, main = next | Loses "this integration point happened" signal; main diverges in one gulp |
| **Squash merge** | Main history stays linear and flat | 140 commits of context collapses into one; bisect becomes useless for that range |
| **Merge commit** | Preserves history + marks integration | Creates a merge bubble on main |

**Consideration:** Whichever strategy is chosen becomes precedent for future graduation merges. If this is the only graduation of its kind, any option works. If we'll periodically cut stable from a long-lived next, merge-commit is most expressive.

### D8. CHANGELOG mechanism (open)

**Options:**

| Option | Effort | Value |
|---|---|---|
| **Reset** — blow away 2022 junk, start fresh at `1.0.0-rc.0` | Low | Clean baseline; loses dead history that wasn't valuable anyway |
| **Append** — keep 2022 entries, add new ones | Low | Preserves history; dead history appears at top forever |
| **Auto-gen from conventional commits** | Medium | Authoritative; requires commit-message discipline the project may not have today |

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

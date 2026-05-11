## Context

**Current state (verified this session):**

- `packages/system/src/keyframes.ts`: standalone top-level factory. Accepts `Record<string, KeyframeFrameMap>` where `KeyframeFrameMap = Record<string, Record<string, unknown>>`. Returns branded collection `{ __brand: 'Keyframes', __frames, ...refs }`. Name generation is FNV-1a over serialized frame bodies (`animus-kf-<7-char-hash>`) — pure, no theme dependency at authoring time.
- `packages/system/src/SystemBuilder.ts`: `createSystem({ includes? }).build()` returns `{ system, createGlobalStyles }`. `createGlobalStyles` is a factory closure that brands its input but **does not theme-type it** (input is `Record<string, Record<string, any>>`). `includes()` already composes `propRegistry + groupRegistry + selectorRegistry` from included systems.
- `packages/test-ds/src/system.ts`: shared design system fixture. Contains no keyframes today — only system groups. This is a clean slate for proving cross-system keyframe propagation.
- `packages/extract/src/`: keyframes plumbing lives across 5 files (`project_analyzer.rs`, `system_loader.rs`, `theme_resolver.rs`, `style_evaluator.rs`, `lib.rs`). Discovery currently scans named exports for `__brand === 'Keyframes'` at module top level.
- Consumers using `keyframes({...})` as standalone: `e2e/next-app/src/ds.ts`, `e2e/vite-app/src/ds.ts`, `packages/showcase/src/ds.ts`. Each declares `animations = keyframes({...})` at module top level and exports it as a named export.

**Constraints:**

1. **Extraction compatibility (load-bearing)**: the Rust extractor's binding substitution (`animationName: animations.X` → static `animation-name: animus-kf-<hash>`) must continue to work. This requires the extractor to locate every keyframe collection and resolve its per-key refs to static names at emission time. The authoring surface can change; the brand + resolution contract cannot.
2. **RSC safety**: the `.build()` return must remain synchronous and serialize-less. No closures over user state that can't cross the server/client boundary.
3. **FNV hash stability**: names are content-addressed. Authoring-surface changes must produce identical hashes for identical frame body content.
4. **Type-signature performance** (from project feedback): theme parameterization must use mapped flatten + generic defaults as cache boundaries, not deep inline generics. `ThemedCSSProps<Theme>` already follows this pattern — any new frame body type should too.
5. **CLAUDE.md §1 (no mutative git)**: no branch rewrites, no reset, no checkouts that destroy work during apply.
6. **Sequencing with `rc-channel-graduation`**: that change (31/75 active) adds the standalone `keyframes` factory to the `system-builder` capability spec via §3B. This change modifies that still-pending requirement. Ordering must be explicit in the apply plan.

**Stakeholders:**

- Library author (sole Staff Engineer, peer to claude-of-the-moment) — ergonomic consistency + type-safety for frame bodies.
- Downstream consumers on `0.1.0-next.*` — absorb a breaking surface reshape in the pre-release window.
- The Rust extractor — one more discovery path or one more re-routing.

## Goals / Non-Goals

**Goals:**

1. Single cohesive design-system import surface: `const { system, createKeyframes, createGlobalStyles } = createSystem({...}).build()` with no standalone-factory outliers.
2. Theme-typed keyframe frame bodies: `{colors.*}`, `{space.*}`, scale tokens autocomplete and type-check inside stop bodies.
3. Cross-system keyframe propagation via `includes()`: a consuming system built with `createSystem({ includes: [libDs] })` has access to libDs's keyframes through a well-defined semantic.
4. Zero runtime-behavior change in extracted output: same `@keyframes animus-kf-<hash>` blocks in `@layer anm-global`, same `animation-name` references, same FNV hashes.
5. Preserve extraction contract: `__brand === 'Keyframes'` remains the discovery tag; binding-substitution resolution continues to work across both `vite-plugin` and `next-plugin`.

**Non-Goals:**

- Typed animation-property binding (`animationDuration`, `animationTimingFunction`, etc.) narrowed against duration/easing scales — legitimate follow-up, separate surface expansion.
- Runtime keyframe generation. Static-only remains.
- Per-package keyframe registries beyond what `includes()` supports.
- Deep Rust extractor rewrite beyond minimum discovery-path adaptation.
- FNV hash algorithm change.
- Migration codemod publication to npm for external consumers — if a codemod is the chosen strategy (question G), it lives in-repo as a one-shot internal script; external consumers migrate manually (all on pre-release anyway).

## Decisions

> **Resolution policy**: the seven decisions below are **open** by design — this is the peer-Staff-Engineer deliberation surface. Each captures options and tradeoffs; the choice is made during apply (recorded here retroactively or in a follow-up annotation). Pre-answering them in the proposal would short-circuit the co-design.

### Decision A — Naming: `ds.createKeyframes` vs `ds.keyframes`

**Options:**

- **A1 — `ds.createKeyframes({...})`** — matches sibling factory naming: `createSystem`, `createTheme`, `createComponent`, `createGlobalStyles`, `createScale`, `createTransform`, `createClassResolver`. Internal consistency argument.
- **A2 — `ds.keyframes({...})`** — matches ecosystem precedent (emotion, styled-components, vanilla-extract). External familiarity argument. Also shorter — keyframes is already a noun-verb in common CSS-in-JS vocabulary.
- **A3 — Both, same object.** Deprecate one, ship the other, freeze before 0.1.0.

**Tradeoffs:**

| Aspect | A1 (`createKeyframes`) | A2 (`keyframes`) | A3 (both) |
| --- | --- | --- | --- |
| Internal consistency | ✓ matches `create*` pattern | ✗ outlier | partial |
| External familiarity | ✗ uncommon form | ✓ matches CSS-in-JS convention | ✓ |
| Surface area | 1 method | 1 method | 2 methods (worse) |
| Migration churn (from today's standalone `keyframes`) | large — every call site renamed | small — just the import source changes | smallest |
| Signal to reader ("this factory creates a thing") | explicit | implicit | mixed |

**No recommendation in this document.** Decision driven by whose-consistency-matters-more: internal (A1) or ecosystem (A2). Peer verdict deferred to apply phase.

### Decision B — Standalone `keyframes` export: remove or retain as escape hatch

**Options:**

- **B1 — Remove top-level `keyframes` export.** Clean surface. Hard break. Consumers who imported `{ keyframes }` from `@animus-ui/system` error at next `bun install`.
- **B2 — Retain as theme-agnostic escape hatch.** Top-level `keyframes` remains exported, marked `@deprecated` with JSDoc pointing to the bound form. Useful for: code that runs before any `createSystem({...}).build()` call (library internals, test fixtures, documentation examples that don't want to set up a full system).
- **B3 — Retain unmarked but de-emphasized.** Top-level export remains, no deprecation warning, just off the primary docs path.

**Tradeoffs:**

| Aspect | B1 (remove) | B2 (deprecated) | B3 (retain) |
| --- | --- | --- | --- |
| Surface minimalism | ✓ | partial | ✗ |
| Break-radius | wide | narrow (deprecation warning, no runtime fail) | zero |
| Test-fixture / internal-use ergonomics | must set up ds | direct | direct |
| "Two ways to do the same thing" smell | none | mild (but intentional) | strong |

**No recommendation.** Depends on whether we have any in-repo call sites where a system-free keyframes factory is load-bearing. Quick audit (deferred to apply): `packages/system/__tests__/`, showcase MDX examples, any future docs primitive that needs standalone keyframe examples.

### Decision C — Cross-system propagation via `includes()`

When `const { system: appDs } = createSystem({ includes: [libDs] }).addGroup(...).build()`, how does libDs's keyframes collection appear on appDs?

**Options:**

- **C1 — Flat merge on build.** `appDs.createKeyframes({ local: {...} })` returns a collection that includes both `local.*` keys and all keys from every included system's collections. Name collisions (same key `ember` defined in libDs and locally) resolve via a chosen policy: (c1a) last-write-wins (local overrides included), (c1b) first-write-wins (includes win, local throws on collision), (c1c) throw at build time on collision (strict).
- **C2 — Namespaced access.** `appDs.animations.local.ember`, `appDs.animations.includes.libDs.flow`. Explicit, noisier, reveals provenance at the call site.
- **C3 — Pass-through only.** `includes()` does **not** touch keyframes. Cross-package keyframes flow through regular named imports (`import { animations } from 'libDs'`), locally through the bound form. Heterogeneous consumer surface: _sometimes_ you import from a sibling package, _sometimes_ you use `ds.createKeyframes`. Rust extractor already handles both patterns (it resolves any named export carrying the brand).

**Tradeoffs:**

| Aspect | C1 (flat merge) | C2 (namespaced) | C3 (pass-through) |
| --- | --- | --- | --- |
| Ergonomics (single access point) | ✓ best | medium | worst |
| Explicit provenance | ✗ | ✓ best | ✓ (via import path) |
| Name-collision handling | requires policy | impossible (namespaced) | impossible (scoped to declaration) |
| Extractor complexity | must merge at some point | must walk namespace tree | unchanged (already works) |
| Consumer mental model consistency | ✓ aligns with other `includes()` propagation (props, groups, selectors) | new namespace pattern, doesn't match other propagation | inconsistent with other propagation |
| Type-system cost (`ThemedKeyframeFrame<Theme>` merge types) | moderate (accumulator merge) | lower (no merge) | lowest (no cross-system types) |

**Collision-policy sub-matrix** (applies to C1 only):

| Policy | Safety | Ergonomics | Precedent in Animus |
| --- | --- | --- | --- |
| c1a last-write-wins | ✗ silent override | ✓ no user action | `addProp` uses this — familiar |
| c1b first-write-wins | ✗ silent override (reverse) | ✓ | no precedent |
| c1c throw on collision | ✓ explicit | ✗ requires rename | `addProp` throws on "different definition" collisions |

**No recommendation.** The symmetry argument (keyframes should propagate like props do, via C1+c1a for consistency, or C1+c1c for safety) is strong but there's a genuine tension: props are position-insensitive while keyframe names become part of the emitted CSS name (through the FNV hash) — a "collision" on the authoring-key side doesn't actually collide on the emission side (different bodies → different hashes). So maybe C3 is cleaner than it looks: there's no true conflict, only a bookkeeping question, and imports already handle bookkeeping.

### Decision D — `createGlobalStyles` theme-typing parity: same change or separate

**Options:**

- **D1 — Same change.** Extend scope to also theme-parameterize `GlobalStyleMap`. One migration event covers both typed surfaces. Slightly larger PR.
- **D2 — Separate follow-up.** This change ships keyframes binding + typing only. A follow-up change (`typed-global-styles`?) ships the globalStyles parity. Smaller blast radius, clearer history.

**Tradeoffs:**

| Aspect | D1 (same change) | D2 (separate) |
| --- | --- | --- |
| Reviewer cognitive load | 2 surfaces at once | 1 surface at a time |
| Consumer migration events | 1 | 2 |
| Pre-0.1.0 cleanup completeness | ✓ | partial (debt carried) |
| Risk of scope creep | moderate | low |
| Change-history clarity | "typed style factories bound" | "bound keyframes" + "typed global styles" — grep-cleaner |

**No recommendation.** Cognitive-load argument favors D2; completeness-before-0.1.0 argument favors D1.

### Decision E — Frame body type shape

`ThemedCSSProps<Theme>` (used by `.styles()`) carries nested selectors (`&:hover`, `@media`), responsive tuples, pseudo-states. Keyframe frame bodies are narrower: a stop (`0%`, `from`, `to`) maps to a flat map of CSS props, no selectors, no responsive values (since keyframes are inherently non-responsive at the stop level).

**Options:**

- **E1 — Reuse `ThemedCSSProps<Theme>`.** Zero new type surface. Invalid constructs (nested selectors, responsive values inside stops) are rejected at _runtime_ by the emission pipeline or silently allowed but meaningless. Type system accepts invalid input; consumer gets CSS mystery meat.
- **E2 — New narrower `ThemedKeyframeFrame<Theme>`.** Flat CSS prop map with theme-token awareness. No nested selectors, no responsive tuples, no pseudo-states. Invalid constructs are rejected at compile time.
- **E3 — Stricter still.** E2 + exclude features that don't make sense in animations (e.g., `display`, `position` changes are legal but unusual; could be opt-in).

**Tradeoffs:**

| Aspect | E1 (reuse) | E2 (narrower) | E3 (strictest) |
| --- | --- | --- | --- |
| Type-system real estate | least | medium | most |
| Correctness at compile time | ✗ accepts nonsense | ✓ | ✓✓ |
| Cognitive load for consumers (new type to learn) | none | 1 new | 1 new + surprising restrictions |
| Signature performance (TS compile) | reuses cache | new cache boundary | new + narrow filter |
| Alignment with existing Animus type philosophy (`narrow-primitive-inline`, strict keys) | ✗ | ✓ | ✓✓ |

**No recommendation.** E2 is the obvious middle and probably right, but the philosophical match argument pushes toward E3.

### Decision F — Extractor discovery path

**Options:**

- **F1 — Assignment-to-named-export convention.** Consumer writes `export const animations = ds.createKeyframes({...})` or similar. Return value still carries `__brand === 'Keyframes'`. Rust extractor's existing named-export scan finds it transparently. No extractor plumbing change needed.
- **F2 — Value-trace through ds.** Rust extractor traces ds-variable usage to find builder-method invocations whose returns carry the brand. More robust (works whether or not the collection is exported), more plumbing.

**Tradeoffs:**

| Aspect | F1 (named-export convention) | F2 (value-trace) |
| --- | --- | --- |
| Rust plumbing required | zero | non-trivial |
| Robustness to consumer style | requires discipline (but natural) | captures all patterns |
| Matches existing extractor philosophy | ✓ (the extractor already scans named exports for `__brand === 'Keyframes'` on the standalone factory's output) | requires new analyzer capability |
| Apply-phase risk | low | moderate (touches 5 Rust files) |
| Future-proofing (e.g., inlined keyframes without an export) | ✗ (requires export) | ✓ (works anywhere) |

**No recommendation.** F1 is the path of least resistance; F2 is the more thorough design. The load-bearing constraint: any collection whose keys are substituted at extraction time MUST be reachable by the extractor. If the consumer never exports it, how does the extractor find it? F1 forces the consumer to make it findable; F2 handles the case where they don't.

### Decision G — Migration strategy for in-repo consumers

Three consumers today: `e2e/next-app/src/ds.ts`, `e2e/vite-app/src/ds.ts`, `packages/showcase/src/ds.ts`.

**Options:**

- **G1 — One-shot codemod script.** In-repo `scripts/codemod-keyframes-binding.ts` that rewrites `import { keyframes } from '@animus-ui/system'` + `animations = keyframes({...})` → appropriate bound-form call sites. Run once during apply. External consumers not in scope.
- **G2 — Deprecation cycle within `0.1.0-next.*`.** Keep both forms for 2+ `next` versions, emit a console warning on standalone use, eventually remove.
- **G3 — Hard break.** Remove standalone on the same version that introduces the bound form. Three in-repo consumers migrated manually (trivial — 3 files × ~5 lines). External `0.1.0-next.*` consumers absorb.

**Tradeoffs:**

| Aspect | G1 (codemod) | G2 (deprecation) | G3 (hard break) |
| --- | --- | --- | --- |
| Effort (in-repo) | small (3 files) + codemod script | medium (dual-path code) | smallest (manual edit 3 files) |
| External consumer kindness | medium (codemod available) | high (deprecation period) | low (hard break) |
| Pre-0.1.0 context justifies hardness | ✓ | overkill | ✓ |
| Dual-path code surface | none | yes — pollutes builder during transition | none |
| Likelihood of external consumers | minimal (all on pre-release) | unknown | minimal |

**No recommendation.** Given all published versions are `0.1.0-next.*`, G3 is defensible — the pre-release marker is the deprecation signal. G1 is the "polite" choice if we care about our future selves (the codemod doubles as living documentation of the migration).

## Risks / Trade-offs

- **Risk**: `rc-channel-graduation` §3B hasn't archived, so the canonical `system-builder` spec doesn't yet contain the standalone-keyframes-factory requirement this change modifies. → **Mitigation**: tasks.md phase 0 explicitly blocks apply until either (a) rc-channel-graduation §3B archives, or (b) the keyframes-factory requirement is absorbed into this change's scope with coordination from the library author. Either path is fine; just not ambiguous.
- **Risk**: Theme-typing frame bodies adds a new generic parameter path through the builder. Generic-parameter depth is a TypeScript compile-time performance hazard (project memory: `feedback_type_signature_performance`). → **Mitigation**: use `Assign` / `Merge` mapped-type primitives already in `packages/system/src/theme/` as cache boundaries. Add a targeted type-test to `verify:types` that asserts the compile-time cost of `ds.createKeyframes({...})` doesn't regress a baseline.
- **Risk**: Cross-system `includes()` keyframe propagation (C1 flat merge) requires accumulating keyframe collections through the builder's `#includesRegistry`. The registry currently holds `IncludableSystem = { toConfig(): SerializedConfig }`. Extending it to carry keyframe collections expands the contract. → **Mitigation**: if C1 is chosen, extend `IncludableSystem` to also include `toKeyframes?: () => Record<string, KeyframeCollection>` (or equivalent), making the propagation explicit at the type level and allowing included systems that pre-date this change (or have no keyframes) to opt out cleanly.
- **Risk**: Rust extractor plumbing (F2) touches 5 files and changes a load-bearing invariant (how keyframes are discovered). Full `verify:integration` + `verify:assert:next` + `verify:assert:vite` + `verify:assert:showcase` must pass. → **Mitigation**: F1 (named-export convention) avoids Rust changes entirely — preferred path unless question F resolves to F2 for future-proofing.
- **Trade-off**: Naming decision (A1 vs A2) is irreversible at the ecosystem level once shipped. We get one naming choice for the primary keyframes surface. Decision should be made with the other Staff Engineer in the room, not auto-resolved.
- **Trade-off**: Deciding D=same-change (ship globalStyles parity together) trades breadth for depth — more churn in one change, but no "half-typed factories" intermediate state. Deciding D=separate is safer but leaves globalStyles in its untyped state until the follow-up ships.

## Open Questions

Seven open questions, listed in the Decisions section:

- **A**: Naming — `ds.createKeyframes` vs `ds.keyframes`.
- **B**: Standalone export — remove, retain-as-escape-hatch, or keep-unmarked.
- **C**: `includes()` propagation semantics — flat merge (with collision policy sub-question), namespaced access, or pass-through only.
- **D**: `createGlobalStyles` theme-typing parity — same change or separate follow-up.
- **E**: Frame body type shape — reuse `ThemedCSSProps`, narrower new type, or strictest narrow-plus.
- **F**: Extractor discovery path — named-export convention (no Rust change) or value-trace (Rust plumbing).
- **G**: Migration strategy — codemod, deprecation cycle, or hard break.

Resolution path: all questions resolved in a dedicated apply-phase design review before writing code. Specs and tasks are authored against the _structure_ of the decisions (any path) and refined in-place once answered.

## Resolution Record (2026-04-19)

Apply-phase peer resolution. Specs and tasks normalized to reflect.

- **0.1 Sequencing**: path **(a)** — `rc-channel-graduation` §3B archives first with the standalone factory requirement; this change MODIFIES/REMOVES that requirement in its own archive cycle. Path (c) redirect was considered but rejected: rc's §3B tasks ship the standalone form in code; redirecting rc's spec without also re-doing its tasks creates a code/spec/task tri-way mismatch at archive. Path (a) lets each change complete on its own timeline; spec-history cost is cosmetic since the standalone never archives as a stable release.
- **A Naming**: **A1 `createKeyframes`**. Matches 8 sibling `create*` factories (`createSystem`, `createTheme`, `createComponent`, `createGlobalStyles`, `createScale`, `createTransform`, `createClassResolver`, `createComposedFamily`) in `.build()` destructure context. Internal consistency outweighs ecosystem familiarity when the reader is already destructuring from `.build()`.
- **B Standalone retention**: **B1 remove**. No internal `packages/system/` consumers of the standalone form; all 3 in-repo consumers (next-app, vite-app, showcase) migrate in Phase 3. All published versions `0.1.0-next.*` — pre-release marker is the deprecation contract.
- **C `includes()` propagation**: **C3 pass-through**. Peer pushback (user: "confused on actual value of the thing") metabolized — cross-package keyframes already flow through regular named imports which the extractor resolves via `__brand === 'Keyframes'` scan. `includes()` is for things the builder needs in types/validation (props, groups, selectors); keyframes aren't in that set. The earlier "symmetry with addProp" argument was rationalization, not a load-bearing need.
- **D `createGlobalStyles` parity**: **D1 same change**. Scope reduction from C3 made room; both surfaces get theme-typed in one migration event rather than leaving globalStyles in its untyped state until a follow-up.
- **E Frame body type**: **E1 reuse `ThemedCSSProps<Theme>`**. Same typing engine as `.styles()`. Keyframe outer shape is `Record<StopKey, ThemedCSSProps<Theme>>` where `StopKey` is a percentage literal or `'from'`/`'to'`. `createGlobalStyles` input becomes `Record<string, ThemedCSSProps<Theme>>` (selector keys unconstrained, body values theme-typed).
- **F Extractor discovery**: **F1 named-export convention**. Existing `__brand === 'Keyframes'` named-export scan finds `export const animations = ds.createKeyframes({...})` without plumbing changes. Zero Rust code changes.
- **G Migration**: **G3 hard break**. 3 in-repo consumers migrate manually in tasks 3.1–3.3. Pre-release consumers absorb the reshape.

Scope impact: task count 40 → 20 (50% reduction). Phase 2 (cross-system propagation) deleted entirely. Phase 3 (Rust) shrinks to 2 verification tasks with no code changes expected. Phase 5 (globalStyles parity) absorbed into Phase 1 as type-layer extension. Phase 6 (verification) merged into Phase 4.

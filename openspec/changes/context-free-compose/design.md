## Context

`compose()` currently uses React context for shared variant propagation. Root wraps its rendered output in a `FamilyContext.Provider`, and each child slot wraps in a `forwardRef` that calls `useContext(FamilyContext)` to read shared values, filters them through `__variantKeys`, and spreads matching props. This adds two React tree nodes per family and runtime work on every child render.

The CSS @layer cascade provides a zero-runtime alternative. Within a single `@layer`, specificity is the tiebreaker, and at equal specificity, source order wins. By emitting two rules per shared variant at equal specificity — inheritance first, override second — we get deterministic cascade behavior without any React runtime.

The extraction pipeline already detects `compose()` calls via `scan_compose_calls` in `jsx_scanner.rs`, but only uses the information to mark slot bindings as rendered for the reconciler. The AST contains full family structure (slot names, shared keys) that goes unused.

## Goals / Non-Goals

**Goals:**
- Eliminate React context (createContext, Provider, useContext) from compose() shared variant propagation
- Enable clean interop with Ark/Radix headless primitives — no Animus context injected into third-party component trees
- Deterministic override semantics: parent inheritance → child direct prop, via CSS source order
- Props passed to composed children resolve predictably — class selection is unambiguous
- Additive extraction change — existing per-component variant CSS is unchanged; composed rules are additional output

**Non-Goals:**
- Changing the compose() API signature or SharedConfig type constraint
- Modifying the variant class naming scheme for standalone components
- Adding new builder chain methods or type-level features
- Handling dynamic shared values (e.g., shared variant driven by runtime state that isn't a static prop) — if the Root variant is class-based, the CSS model works; if it's a CSS variable, that's a separate concern
- asChild polymorphism — related but separate effort

## Decisions

### 1. Two-rule model for cascade override

For each shared variant option on each child slot, emit two CSS rules:

```css
@layer variants {
  /* Rule 1: Inheritance — parent variant cascades to child */
  .animus-Root-abc.animus-Root-abc--size-sm .animus-Child-def {
    font-size: 0.875rem;
  }

  /* Rule 2: Override — child direct prop wins via source order */
  .animus-Root-abc .animus-Child-def.animus-Child-def--size-sm {
    font-size: 0.875rem;
  }
}
```

Both rules have specificity (0, 3, 0): three class selectors each. At equal specificity within the same `@layer`, the rule emitted LATER in source wins. Rule 1 is emitted before Rule 2. When both are active (child has direct prop while parent also provides), Rule 2 wins.

**Why not sub-layers?** Sub-layers would also work (`@layer variants.composed` before `@layer variants`) but add nesting complexity for no benefit. Equal-specificity source ordering is simpler, already used for shorthand-before-longhand ordering in css_generator, and doesn't introduce new layer names.

**Why not data attributes?** Class names work for all cases. Data attributes add another selector type without benefit. The existing `--variant-option` class naming convention extends naturally to composed contexts.

**Why not `:is()` grouping?** `:is(.Root--size-sm, .Root--size-md) .Child { ... }` can only group variant options that share identical declarations. Variant options by definition have different declarations (that's the point of variants). `:is()` is inapplicable here.

**Prior art:** Tailwind `group` / `group/{name}` uses the same CSS mechanism — parent gets `class="group"`, children use `group-hover:text-white`, emits `.group:hover .group-hover\:text-white { ... }`. The descendant-selector pattern is production-proven at Tailwind scale. The differentiation is DX: Tailwind requires manual per-class annotation on every child; Animus generates all composed rules from a single `compose()` declaration.

### 2. Root scope class provides family namespacing

The Root component's identity class (`.animus-Root-abc`) appears in BOTH rules as a namespace. This prevents composed variant rules from affecting children outside the family. Two composed families on the same page with the same shared variant key (e.g., both share `size`) produce non-colliding CSS because each family's Root class is unique (content-addressed hash).

No additional "family" class or naming convention is needed. The Root's existing class IS the family identity.

### 3. Child wrappers removed for shared variant propagation

Children no longer need `forwardRef` wrappers that call `useContext`. For shared variant propagation specifically, the child renders as-is — CSS handles inheritance from the parent's variant class.

Children MAY still need wrappers for: sealing (removing `.extend()`), displayName assignment, or future non-variant shared props. But the context-specific wrapper code (useContext, knownKeys filtering, prop spreading) is removed.

### 4. Extraction pipeline: ComposeFamilyInfo struct

`scan_compose_calls` in `jsx_scanner.rs` is extended to return structured family info:

```rust
pub struct ComposeFamilyInfo {
    pub root_binding: String,
    pub slots: Vec<(String, String)>,  // (slot_name, binding_name)
    pub shared_keys: Vec<String>,
}
```

This is extracted from the compose() AST — the first argument (slots object) provides slot→binding mapping, the second argument's `shared` property provides shared keys.

### 5. Reconciler compose-family awareness

The reconciler currently prunes variant options based on direct JSX prop usage. In composed families, a child's variant options may never appear as direct JSX props (the parent holds them). The reconciler must understand: "ButtonItem's `size` variant is used because it's in a family where Root receives `size`."

The mechanism is lightweight: inject `__dynamic__` usage into the existing variant_usage ledger for each shared key on each child binding. The reconciler already handles `__dynamic__` expansion (reconciler.rs:54-62) — it expands to all known options for that variant prop. No new ledger structures needed, just pre-population at the compose-scan phase.

### 6. Composed rules use existing variant declarations

The css_generator doesn't resolve styles again for composed rules. It reuses the already-resolved variant declarations from the per-component extraction. The composed emission is purely a selector-wrapping operation: take the existing `VariantCss` for a child's variant option, wrap the declarations in the two composed selectors.

## Risks / Trade-offs

- **[Risk] CSS output grows**: Each shared variant option on each child adds two rules. A family with 3 shared variants × 3 options × 4 children = 72 additional rules. → **Mitigation**: Rules reuse existing declarations (no new resolved styles). The CSS is declarative and compresses well. The runtime savings (no context, no useContext, no prop filtering) likely offset the CSS size for real-world families.

- **[Risk] Descendant selector depth**: `.Root .Child` matches at ANY nesting depth. If composed families nest inside each other, an outer Root's variant could reach an inner family's Child. → **Mitigation**: The Root scope class (`.animus-Root-abc`) is unique per family, so `.OuterRoot.OuterRoot--size-sm .InnerChild` won't match `.InnerRoot.InnerRoot--size-sm .InnerChild` — the class names are different. Only if the SAME Root class appears at multiple nesting levels (recursive composition) does this become an issue. That's an edge case we can address later with direct-child selectors if needed.

- **[Trade-off] No dynamic shared values**: If a shared variant is driven by runtime state (e.g., `size={isCompact ? 'sm' : 'lg'}`), the Root still needs to apply the correct variant class at runtime. This works because the variant runtime already handles dynamic props → class assignment. The CSS model doesn't break — it just relies on the Root's class being correct, which is the variant runtime's job.

- **[Trade-off] Reconciler false positives**: Marking all variant options as "used" for composed children is conservative. If Root only ever receives `size="sm"` (never "md" or "lg"), we still emit composed rules for all options. → **Accept**: The reconciler already does JSX-level analysis, not runtime analysis. This is consistent with existing behavior.

### 7. Portal-mounted slots use context fallback

CSS descendant selectors do not cross portal boundaries — portaled content renders into `document.body`, physically outside the Root DOM subtree. React context DOES cross portals. For portal-using slots (Radix Dialog, Tooltip, Popover; Ark Menu), shared variant propagation falls back to a minimal React context that passes a className string. Non-portal slots use the CSS-only model.

This is acceptable because portals are inherently client-only (no RSC compatibility concern). The context fallback is scoped to portal slots only — the majority of composed families (Accordion, Tabs, RadioGroup, Toolbar) don't portal and get full CSS-only propagation.

### 8. Rust intelligibility pass as prerequisite

The extraction pipeline currently threads data through positional parameters — `resolve_styles` has 8 params, `analyze_project` has 12 NAPI params. Adding `ComposeFamilyInfo` as cross-phase state (Phase 5 scan → Phase 5e reconciler → Phase 6 generation) requires new data plumbing through `project_analyzer` internals that have no current slot for it.

A `ResolveContext` / `PipelineState` refactor (the Rust intelligibility pass) should precede this work. It would provide a clean struct for cross-phase data flow, making compose family threading natural rather than ad-hoc. Without it, compose family info becomes another positional parameter or side-channel hack.

### 9. compose() as pipeline terminal

`compose()` is structurally analogous to `.asElement()` / `.asComponent()` / `.asClass()` — it consumes builder chain outputs and produces a sealed result. The extraction pipeline should treat it as a first-class terminal concept rather than a special case in `jsx_scanner`. This means family structure extraction flows through the normal pipeline phases rather than requiring a separate scan pass.

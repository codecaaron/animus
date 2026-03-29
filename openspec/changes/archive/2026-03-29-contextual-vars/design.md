## Context

CSS provides `currentColor` as a built-in cascading reference to the inherited `color` property. No equivalent exists for `backgroundColor`, `borderColor`, or other properties. The `--current-bg` pattern manufactures this cascade by emitting a CSS custom property alongside the resolved background-color value, allowing children to reference it without prop drilling.

The system's typed scale props reject raw `var(--current-bg)` because color props are constrained to `keyof TokenScales<Theme>['colors']`. For contextual vars to be usable from typed props, they must be first-class members of their scale's type.

The ThemeBuilder already has `#checkpoint` for pure-inference type accumulation and `#emittedScales` for tracking which scales produce CSS variables. Contextual vars are a parallel concept: phantom scale members that participate in types but not in token emission.

## Goals / Non-Goals

**Goals:**
- Provide a ThemeBuilder method to declare contextual CSS variables as phantom members of a scale
- Contextual var names appear in `TokenScales<Theme>[Scale]` — accepted by any prop bound to that scale
- Object-key API for type narrowing without `as const`
- Rust extractor resolves contextual var names to `var(--name)` instead of token lookup
- Optional auto-emission: a prop can declare that it emits a sibling CSS custom property declaration
- Chainable with `#checkpoint` — multiple `addContextualVars` calls accumulate

**Non-Goals:**
- New ref syntax (`$current`, `{$...}`) — contextual vars are regular scale members, same syntax as tokens
- Responsive or mode-dependent contextual vars — they resolve to a single CSS custom property
- Runtime/React context integration — this is purely a CSS cascade mechanism
- Contextual vars for non-color scales in this iteration (mechanism is general, enablement starts with colors)
- Compose/slot-level contextual var binding — CSS cascade already flows contextual vars through slots; no explicit binding API needed
- Runtime dynamic prop emission — when `bg={dynamicVar}` falls through to inline style injection, `--current-bg` is not auto-emitted (extraction is static; dynamic values are uncommon for design-system bg)

## Decisions

### 1. Theme-level declaration, not prop-level

**Decision:** Contextual vars are declared on the theme via `.addContextualVars()`, not on prop configs.

**Why:** The type flow is unidirectional: Theme → Scale → PropConfig → ComponentProps. Declaring at the theme level means `TokenScales<Theme>['colors']` naturally includes the contextual var names. Every prop with `scale: 'colors'` inherits them. Declaring at the prop level would require types to flow backward (prop config → scale type), which is circular.

**Alternative considered:** Derive the type union from prop configs that have `currentVar` set. Rejected because it requires an augmentable interface disconnected from the source of truth, and creates a circular dependency between prop definitions and scale types.

### 2. Config-object API with object-key narrowing

**Decision:** Use `{ scale: Scale, vars: Vars }` where `Vars` is a `Record<string, string>` whose keys are the var names and values are the CSS custom property names.

```typescript
.addContextualVars({
  scale: 'colors',
  vars: {
    'current-bg': '--current-bg',
    'current-border-color': '--current-border-color',
  },
})
```

**Why:** Object keys are always narrowed to literal types — no `const` generic modifier or `as const` needed. The config-object pattern is consistent with `addScale({ name, values, emit })`. The values carry the CSS custom property name, making the mapping explicit.

**Alternative considered:** Array API with `const` generic modifier (`const Vars extends readonly string[]`). Works but requires the CSS var name to be derived by convention. Explicit mapping is clearer and allows non-obvious mappings.

### 3. Phantom type merging via `#checkpoint`

**Decision:** `addContextualVars` uses the existing `#checkpoint` pattern. The theme runtime object is unchanged — only the type widens to include phantom keys.

```typescript
type PhantomKeys = { [K in keyof Vars]: string };
type NextScale = T[Scale] & PhantomKeys;
type Next = { [K in keyof T]: K extends Scale ? NextScale : T[K] };
return this.#checkpoint<Next, Emitted>(this.#theme);
```

**Why:** Phantom keys participate in `keyof TokenScales<Theme>['colors']` but don't exist in the runtime theme object. The `#checkpoint` pattern already handles type-only mutations (same runtime data, wider type). No new mechanism needed.

### 4. Separate emission from declaration

**Decision:** Declaration (theme-level) and emission (prop-level) are independent concerns.

- **Declaration:** `.addContextualVars()` says "these names are valid scale members that resolve to CSS variables."
- **Emission:** `currentVar: '--current-bg'` on a prop config says "when this prop is set, also emit this CSS custom property."

**Why:** A contextual var might be SET by one prop (`bg`) but REFERENCED by many (`borderColor`, `color`, `fill`, `stroke`). Decoupling means the theme owns the vocabulary (what's valid) and the prop config owns the automation (what triggers emission). Users can also set contextual vars manually in `.styles()` without auto-emission.

### 5. Rust resolution path

**Decision:** The serialized theme includes a `contextualVars` registry. When the Rust extractor encounters a value that matches a contextual var name, it resolves to `var(--name)` using the registry mapping instead of looking up the token manifest.

**Why:** Contextual var names look like regular scale keys to the type system but require different resolution. The registry provides the Rust extractor with the information to distinguish them. Resolution order: token manifest first (preserves existing behavior on collision), then contextual vars registry, then raw passthrough. Token manifest precedence is the safer default — if a name collision occurs, existing token behavior is preserved and the contextual var is silently shadowed.

### 6. Auto-emission in Rust

**Decision:** `resolve_single_prop` in `theme_resolver.rs` checks if the current prop has a `currentVar` in its config. If so, it pushes an additional `CssDeclaration` with the contextual var name as the property and the same resolved value.

**Why:** This fires at the CSS generation level, so it works regardless of whether the prop was set in `.styles()`, `.variant()`, `.states()`, or as a system prop. Every `background-color` declaration gets its `--current-bg` sibling. The existing `Vec<CssDeclaration>` return type already supports multiple declarations per prop.

## Risks / Trade-offs

**[Name collision]** → Contextual var names occupy the same namespace as regular token keys. A scale with a token named `current-bg` would collide. → Mitigation: the `current-` prefix convention is unlikely to conflict with design tokens. Document the convention.

**[Phantom type confusion]** → `keyof TokenScales<Theme>['colors']` includes keys that have no runtime value in the theme object. Code that iterates theme keys at runtime won't find them. → Mitigation: contextual vars are a type-system concern. Runtime iteration already uses the manifest/variables, not raw theme keys.

**[Ordering sensitivity]** → `addContextualVars` must be called AFTER the scale it targets exists (e.g., after `addColors`). Calling it before would fail because `Scale extends keyof T` wouldn't match. → Mitigation: document ordering requirement. TypeScript will enforce it — calling with a nonexistent scale name produces a type error.

**[Auto-emission cascade correctness]** → If a component sets `bg: 'surface'` in base styles and `bg: 'coal'` in a variant, both declarations emit `--current-bg`. The variant's higher cascade layer ensures the correct one wins. → Mitigation: CSS cascade handles this naturally. No special logic needed.

**[Self-referential circularity]** → `bg: 'current-bg'` on a component with auto-emission produces `--current-bg: var(--current-bg)` — a cyclic custom property. The browser treats this as invalid and falls back to the inherited value. → Mitigation: The Rust emitter SHALL skip auto-emission when the resolved value equals the contextual var's own CSS custom property (e.g., when resolved value is `var(--current-bg)` and `currentVar` is `--current-bg`).

**[Pseudo-selector scoping]** → When `bg` is set only in a pseudo-selector (e.g., `&:hover`), `--current-bg` is emitted inside the pseudo block and only applies during that state. Children reading `var(--current-bg)` outside the pseudo context see the inherited or initial value. → Mitigation: This is correct CSS behavior — `--current-bg` tracks the CURRENT visual background, not the resting state. Document the behavior so consumers are not surprised.

**[Responsive emission]** → When `bg` has responsive values (`bg={{ _: 'surface', md: 'coal' }}`), auto-emission must fire per-breakpoint. Each breakpoint's media query block must contain its own `--current-bg` sibling declaration. → Mitigation: The Rust emitter processes responsive declarations individually — each gets its own `resolve_single_prop` call, so auto-emission fires per-breakpoint automatically.

**[Rust function signatures]** → Adding contextual var resolution requires threading a `contextual_vars` registry parameter through `resolve_value`, `resolve_flat_styles`, `resolve_single_alias`, and their callers. This is a non-trivial signature change across the theme resolver module. → Mitigation: Pass the registry as part of a resolver context struct rather than individual parameters to minimize churn.

**[addColorModes validator interaction]** → `addColorModes` validates that mode alias values exist in the color token set. Contextual var names are phantom — they are NOT in the token set. If a mode alias references a contextual var name, the validator throws. → Mitigation: `addContextualVars` should be called AFTER `addColorModes`. Contextual vars are not valid mode alias targets (they don't have concrete values per-mode). TypeScript enforces ordering; document the constraint.

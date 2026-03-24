## Context

The system builder currently registers two kinds of vocabulary: **tokens** (via `.withTokens()` — value vocabulary, what `'surface'` means) and **properties** (via `.withProperties()` — prop vocabulary, what CSS properties exist and what scales they use). Both are resolved at extraction time by the Rust crate.

Component authors currently write raw CSS attribute selectors for DOM state targeting: `'&[data-state="open"]'`, `'&[disabled]'`, `'&[aria-expanded="true"]'`. These strings are verbose, inconsistent across components, and invisible to the type system. The selector registry adds the third vocabulary axis: **targeting vocabulary** — what DOM state names mean as CSS selectors.

The cascade contract is unchanged. Selectors are not a layer. They're vocabulary consumed BY layers — the layer is determined by WHERE you write the selector shorthand (`.styles()` → `@layer base`, `.variant()` → `@layer variants`, etc.).

## Goals / Non-Goals

**Goals:**
- System-level registration of selector shorthands via `.withSelectors()`
- `'&:open'` shorthand syntax in style objects, expanding to registered attribute selectors
- Type-safe autocomplete for registered selector names in style object keys
- Extraction-time resolution — zero runtime cost
- Serialization of selector registry to extraction pipeline

**Non-Goals:**
- Compound selector expansion (`'&:open:disabled'` auto-expanding both — use nesting instead)
- CSS pseudo-class/element shadowing (registered names MUST NOT collide with CSS pseudo-classes)
- Runtime selector resolution — this is purely extraction-time
- New cascade layers — no `@layer selectors` or similar
- State prop forwarding to DOM — separate concern (see cascade-assertions proposal)

## Decisions

### 1. Selector registry is a `Record<string, string>` map

The simplest possible shape: `{ open: '[data-state="open"]', disabled: '[disabled]' }`. The key is the shorthand name, the value is the full CSS attribute selector (without the `&`). This matches the mental model of "name → what it means" that tokens already establish.

**Why not functions?** Selectors don't need runtime evaluation. They're static mappings. A `Record` is serializable, inspectable, and trivially passed to the Rust crate as JSON.

**Why not a builder pattern?** No accumulation needed. Selectors are independent — they don't have scales, transforms, or groups. A flat map is sufficient.

### 2. Shorthand syntax: `'&:name'` where `name` is a registered selector

Uses the CSS pseudo-class syntax position (`&:`) because it reads naturally in style objects: `'&:open': { maxHeight: '500px' }`. The expansion rule is simple: if the segment after `&:` exactly matches a registered selector key, replace `&:name` with `&${value}`.

**Disambiguation from CSS pseudo-classes:** The registry is a closed vocabulary. Expansion only fires when the name matches a registered key. `&:hover` passes through unchanged because `hover` is not in the registry. Constraint: consumers MUST NOT register names that collide with CSS pseudo-classes (`hover`, `focus`, `active`, `visited`, `first-child`, etc.) or pseudo-elements (`before`, `after`, `placeholder`).

**Why not a different prefix?** Alternatives considered:
- `'&[open]'` — conflicts with actual attribute selectors, loses the "this is a shorthand" signal
- `'&$open'` — unfamiliar syntax, no CSS precedent
- `'&::open'` — pseudo-element syntax, semantically wrong
- `'data:open'` — looks like a URI scheme

The `&:name` syntax has the best ergonomics and the collision risk is manageable via the closed-vocabulary constraint.

### 3. Single-segment expansion only (v1)

`'&:open'` expands. `'&:open:disabled'` does NOT auto-expand both segments — write compound selectors via nesting:

```tsx
'&:open': {
  '&:disabled': { opacity: 0.4 }
}
```

This avoids the complexity of splitting on `:` boundaries (which would need to handle `::before`, `:nth-child()`, etc.). Compound expansion can be a v2 enhancement if nesting proves too verbose in practice.

### 4. SystemBuilder gains `#selectors` field and `.withSelectors()` method

Same pattern as `.withGlobalStyles()` — stores the map, returns a new builder with the updated field. The generic parameter carries selector names for type narrowing.

```typescript
class SystemBuilder<T, PropReg, GroupReg, Selectors extends Record<string, string> = {}> {
  #selectors: Selectors;

  withSelectors<S extends Record<string, string>>(
    selectors: S
  ): SystemBuilder<T, PropReg, GroupReg, S> {
    return new SystemBuilder(
      this.#tokens, this.#propRegistry, this.#groupRegistry,
      this.#globalStyles, selectors
    );
  }
}
```

### 5. SerializedConfig gains `selectors` field

```typescript
interface SerializedConfig {
  // ...existing fields
  selectors?: Record<string, string>;
}
```

Serialized as a plain object (not JSON string) since it's already a simple `Record<string, string>`. The Vite plugin passes it to the Rust crate alongside `config_json`.

### 6. Rust crate expansion during CSS generation

The selector map is passed to the CSS generator as part of the extraction config. During CSS generation, when emitting a selector key that starts with `&:`, the generator checks if the suffix matches a registered selector. If so, it replaces the key with `&${registered_value}`.

This happens at the same stage as theme scale resolution — during CSS generation, not during AST parsing or chain walking.

### 7. Type narrowing for style object keys

Style object types gain awareness of registered selectors via a mapped type:

```typescript
type SelectorKeys<S extends Record<string, string>> =
  `&:${keyof S & string}`;
```

This feeds into `ThemedCSSProps` so that autocomplete shows `'&:open'`, `'&:disabled'` alongside arbitrary CSS selectors. Arbitrary string selectors remain valid (the type is a union with `string`, not restrictive), but registered names appear in autocomplete.

## Risks / Trade-offs

**Pseudo-class collision** → Mitigated by documentation + TypeScript constraint. Could add a build-time check that warns if a registered name matches a known CSS pseudo-class. Low priority — the closed vocabulary means this is a conscious choice, not an accident.

**Selector map not validated** → The registry accepts any string as the value. A typo in `'[data-state="opne"]'` would silently produce wrong selectors. → Mitigated by the fact that this is a system-level definition (written once, reviewed carefully). Could add Vite plugin validation that checks attribute selector syntax.

**Generic parameter proliferation** → SystemBuilder goes from 3 to 4 generic parameters. → Acceptable: the pattern is established. Users never see these generics — they're inferred by the builder chain.

**No runtime awareness** → If a component uses `'&:disabled'` shorthand but the runtime doesn't forward `disabled` to the DOM, the selector never matches. → Explicitly a non-goal for this change. State prop forwarding is a separate concern tracked in the cascade-assertions proposal.

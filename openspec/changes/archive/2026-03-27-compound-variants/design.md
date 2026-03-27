## Context

The builder chain currently enforces ordering: `styles → variant → states → groups → props → asElement`. Variants define independent axes (size, visual style) but there's no mechanism for expressing style overrides at the intersection of multiple variant values. Real design systems routinely need these — a button's ghost+xs combination needs different padding than either ghost or xs alone.

The type-state machine uses backwards inheritance: `Animus → AnimusWithBase → AnimusWithVariants → AnimusWithStates → AnimusWithSystem → AnimusWithAll`. Each class adds one generic parameter and exposes the next method in the chain. The `T` (Theme) generic was recently removed, freeing headroom. Current deepest generic signature has 7 type parameters.

The cascade contract: `@layer global, base, variants, states, system, custom`. Each builder method maps to a layer. Compounds need a new layer between variants and states.

## Goals / Non-Goals

**Goals:**
- Add `.compound()` to the builder chain between `.variant()` and `.states()`
- Zero TypeScript type depth increase — `.compound()` returns `this`, no new generic
- Full extraction support: chain walking, style evaluation, CSS generation, runtime resolution
- Cascade-correct: `@layer compounds` overrides individual variants, overridden by states/system/custom

**Non-Goals:**
- Responsive compound activation (e.g., compound active only at md breakpoint) — deferred, combinatorially complex
- Compound conditions referencing states — states aren't defined yet at compound position in the chain
- Compound conditions referencing system props or custom props — these are runtime-dynamic, not statically enumerable

## Decisions

### 1. `.compound()` returns `this` — zero type depth cost

`.compound()` is defined on `AnimusWithVariants` (and the new `AnimusWithCompounds`), and returns `this`. Compound data is stored at the value level (an array on the instance), not the type level.

```ts
compound<Props extends AbstractProps>(
  condition: { [K in keyof Variants]?: keyof Variants[K]['variants'] },
  styles: ThemedCSSProps<Props, PropRegistry>
): this
```

**Why not a new generic parameter:**
- Adding `Compounds` as a generic would push the chain to 8+ parameters at the deepest level
- Compound conditions are already fully constrained by the `Variants` generic — TypeScript validates condition keys and values against accumulated variants
- Consumers never interact with compound types directly — they use variant props, and compounds apply automatically
- The value-level array is sufficient for extraction (chain walker reads it) and runtime (config includes it)

**Why `this` return:**
- Multiple `.compound()` calls chain naturally: `.compound(c1, s1).compound(c2, s2).states({...})`
- No new class needed in the inheritance chain if AnimusWithVariants defines `.compound()` directly
- `.states()` still works after `.compound()` because it's inherited from the same class

Alternative considered: new `AnimusWithCompounds` class. Rejected because it adds a class, a constructor, and a generic slot for zero type-safety benefit. The condition is already fully constrained by `Variants`. However, if strict chain ordering is needed (prevent calling `.compound()` after `.states()`), a thin wrapper class that just returns `this` from `.compound()` and exposes `.states()` would work — same zero-cost pattern but with ordering enforcement.

### 2. New `@layer compounds` in cascade

Layer declaration becomes: `@layer global, base, variants, compounds, states, system, custom`

**Why a separate layer instead of emitting within `@layer variants`:**
- Each builder method maps to a layer — this is the cascade contract principle
- Source ordering within `@layer variants` is fragile — a later-declared individual variant could accidentally override a compound
- Explicit layer makes the cascade behavior predictable regardless of emission order
- Consistent with the existing pattern: each chain stage has its own layer

**CSS class naming:** `animus-ComponentName-hash--compound-{index}` where index is the 0-based position in the compounds array. Index-based (not condition-based) because condition serialization would produce unwieldy class names.

### 3. Runtime resolution via condition matching

The `createComponent` config gains a `compounds` array:

```js
{
  compounds: [
    { conditions: { size: "sm", variant: "ghost" }, className: "animus-Btn-hash--compound-0" },
    { conditions: { size: "lg", variant: "fill" }, className: "animus-Btn-hash--compound-1" },
  ]
}
```

Resolution: iterate the array, check if ALL condition key/value pairs match the current variant prop values, add the className for every matching compound. Multiple compounds can match simultaneously (they're independent rules).

**Why array iteration over hash map:**
- Compound conditions are multi-key — they can't be indexed by a single key
- The array is typically small (1-5 entries per component)
- Linear scan of a small array is faster than building and querying a multi-key index

### 4. Extraction: chain walker recognizes `.compound()` as a new stage type

The chain walker adds `"compound"` to `CHAIN_METHODS`. Each `.compound()` call produces a stage with two spans: the condition object and the styles object. The style evaluator processes compound styles identically to variant styles (same ThemedCSSProps resolution). The CSS generator emits compound rules into `@layer compounds`.

### 5. Extension inherits parent compounds

When B extends A and A has compounds, B inherits A's compounds. If B defines its own compounds, they're appended after A's compounds within `@layer compounds`. Source ordering within the layer means B's compounds override A's when conditions overlap — correct cascade behavior for extensions.

## Risks / Trade-offs

**[New @layer in cascade declaration is a breaking change]** → Any consumer that hardcodes the layer declaration string would break. Mitigation: no external consumers yet (greenfield). The layer declaration is generated by the plugin, not authored by consumers.

**[Compound conditions are partial matches]** → A compound `{ size: 'sm' }` (omitting variant) matches ALL visual variants when size=sm. This is intentional — partial conditions are useful for "apply to all visual variants when size is sm." But it could surprise authors who expect full-match semantics. Mitigation: document clearly. Could add a strict-match option later if needed.

**[Multiple compounds can match simultaneously]** → If compound A matches `{ size: 'sm', variant: 'ghost' }` and compound B matches `{ size: 'sm' }`, BOTH apply when size=sm and variant=ghost. B's styles apply first (lower index), A's override (higher index). This is correct but could be confusing. Mitigation: compounds are applied in definition order, so later `.compound()` calls take precedence.

**[No responsive compound activation]** → If variant selection becomes responsive in the future, compound matching would need breakpoint-awareness. Mitigation: deferred by design. Static-only compounds are a clean first step.

## Open Questions

- Should we enforce that compound conditions reference at least 2 variant axes? Single-axis conditions (`{ size: 'sm' }`) are equivalent to adding styles to the sm variant option itself — but in a higher layer. This could be useful (override without modifying the variant definition) or confusing (two places to look for size=sm styles).

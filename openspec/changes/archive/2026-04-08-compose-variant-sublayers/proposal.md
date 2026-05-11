## Why

Compose variant CSS relies on specificity engineering within `@layer variants` to order three rule categories: sidecar defaults (0,1,0), inheritance (0,2,0), and overrides (0,3,0). This is fragile — the specificity tiers create source-order dependencies within a flat layer, CSS minifiers (LightningCSS/Vite) can legally reorder selectors at equal specificity, and multi-variant components interact unpredictably when all rules compete in the same cascade scope. Two fixes were attempted in one session before reaching a dead end.

CSS `@layer` nesting (sublayers) was designed to solve exactly this class of problem — decoupling precedence from specificity by making ordering structural rather than arithmetic.

## What Changes

### Sublayers within `@layer variants` and `@layer compounds`

Introduce `@layer standalone` and `@layer composed` as sublayers within both the `variants` and `compounds` layers. The sublayer topology is identical in both:

```css
@layer variants {
  @layer standalone, composed;
  @layer standalone {
    .Child--size-sm { font-size: 0.875rem; }
    .Child--size-default { font-size: 0.875rem; }  /* sidecar */
  }
  @layer composed {
    .Root--size-sm .Child { font-size: 0.875rem; }          /* inheritance */
    .Root .Child.Child--size-sm { font-size: 0.875rem; }    /* override */
  }
}

@layer compounds {
  @layer standalone, composed;
  @layer standalone {
    .Child--size-sm.Child--intent-primary { background: red; }
  }
  @layer composed {
    /* shared 'size' condition uses parent inheritance selector */
    .Root--size-sm .Child.Child--intent-primary { background: red; }
  }
}
```

Layer ordering guarantees: `standalone` rules always lose to `composed` rules regardless of selector specificity. No specificity arithmetic needed between categories.

### Sidecar default class retained with simplified role

The `--{prop}-default` sidecar class is retained. It encodes a semantic distinction the cascade cannot infer: "this value comes from defaultVariant fallback" vs "this value was explicitly set by the consumer." The sidecar rule lives in `@layer standalone` — it naturally loses to any compose rule in `@layer composed` by layer ordering alone. No specificity tier engineering required.

### Inheritance vs override within `composed`

Within the `composed` sublayer, inheritance and override rules coexist. Their relative ordering is handled by a structural specificity invariant:

- Inheritance: `.Root--var-opt .Child` — always (0,2,0)
- Override: `.Root .Child.Child--var-opt` — always (0,3,0)

This gap is inherent to the selector shapes, not engineered. It cannot be eroded by combinatorics or disrupted by minifiers (different specificities are never reordered). This is the one place specificity still matters, and it's stable.

### Composed compound rules inferred from selectors

For compound conditions that reference shared variant props, the extractor substitutes the parent's inheritance selector pattern for the child's own variant class. The shared prop condition becomes a descendant selector check against the parent's state rather than a class check on the child. Non-shared prop conditions remain as direct class checks on the child.

### Non-shared variants unaffected

Variants not in the compose `shared` config have no compose rules. They live entirely in `@layer standalone`, preserving `.variant().variant()` chain definition order as source order within the sublayer. No behavioral change.

### Sublayers are auto-provisioned

Users never specify or configure sublayers. The extractor provisions them automatically based on whether compose families exist in the project. Projects without compose families emit no sublayers — the `variants` and `compounds` layers remain flat.

## Cascade Contract

```
@layer variants {
  standalone < composed     (layer ordering, structural)
}
  within standalone:        source order = chain definition order
  within composed:          inheritance (0,2,0) < override (0,3,0) (structural invariant)

@layer compounds {
  standalone < composed     (layer ordering, structural)
}

Cross-layer: variants < compounds < states < system < custom (unchanged)
```

## Capabilities

### New Capabilities
- `variant-sublayers`: Automatic sublayer provisioning within `@layer variants` and `@layer compounds` for compose cascade correctness.

### Modified Capabilities
- `compose-css-propagation`: Compose rules move into `composed` sublayer. Sidecar default rules move into `standalone` sublayer. Selector shapes unchanged.
- `structured-css-sheets`: CssSheets variants/compounds fields carry sublayer structure when compose families exist.

## Impact

- **Rust crate** (`css_generator.rs`): Emit sublayered structure. Variant rules route to `standalone` or `composed` based on compose family membership. Compound rules with shared-prop conditions generate composed variants.
- **Rust crate** (`project_analyzer.rs`): Compose CSS integration changes from string-surgery append to structured sublayer emission.
- **Runtime** (`resolveClasses.ts`): Sidecar `--{prop}-default` class emission retained. No runtime changes needed.
- **Browser support**: Nested `@layer` supported since Chrome 99, Firefox 97, Safari 15.4 (March 2022). 4+ years stable. All engines shipped sublayer support as part of initial `@layer` implementation — no version gap.
- **Minifiers**: `@layer` boundaries are structural. LightningCSS, esbuild, cssnano all preserve nested layers. Minifier reordering across layer boundaries is impossible. This structurally eliminates the class of bug that motivated this change.
- **DevTools**: Chrome 106+ shows layer badges with dot-separated paths (`variants.standalone`, `variants.composed`). Firefox 103+ shows `@layer variants.standalone` annotations. Net improvement over specificity arithmetic for debugging.
- **Bundle size**: ~60 bytes of layer wrapper overhead per provisioned layer. Negligible, gzips to near-zero.

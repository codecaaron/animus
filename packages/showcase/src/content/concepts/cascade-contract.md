# The Cascade Contract

Animus declares a fixed seven-layer cascade at build time. Layer order determines precedence — not selector specificity. Every selector emitted by the builder is a single class. You never need `!important`, and there are no specificity conflicts between component styles.

```css
@layer global, base, variants, compounds, states, system, custom;
```

`global` holds reset and base HTML element styles registered via `.withGlobalStyles()`. `base` holds the component defaults from `.styles()` — the lowest component-level precedence. `variants` overrides base when a variant prop matches. `compounds` overrides both base and variants when all conditions in a `.compound()` call are met. `states` always wins over variants and compounds — pass the boolean prop and the styles apply regardless of what variant is active. `system` holds the shared responsive utility classes from `.groups()`. `custom` is reserved for `.props()` slots — it beats every other Animus layer.

### Concrete example

A `Card` with a base background, a variant that overrides it, and a state that overrides both — all resolved by layer position alone, with no selector gymnastics.

```tsx
export const Card = ds
  .styles({
    // @layer base: applied unconditionally
    bg: 'coal',
    p: 24,
    borderRadius: 4,
  })
  .variant({
    prop: 'intent',
    variants: {
      base:    {},
      ember:   { bg: 'ember' },   // @layer variants: overrides base
      surface: { bg: 'surface' },
    },
  })
  .states({
    // @layer states: overrides both base AND variant — no !important
    selected: { bg: 'primary', borderColor: 'primary' },
  })
  .asElement('div');
```

```css
@layer base {
  .animus-Card-d4e5f6 {
    background: var(--color-coal);
    padding: 24px;
    border-radius: 4px;
  }
}

@layer variants {
  /* Wins over base when intent="ember" */
  .animus-Card-d4e5f6[data-intent="ember"] {
    background: var(--color-ember);
  }
  .animus-Card-d4e5f6[data-intent="surface"] {
    background: var(--color-surface);
  }
}

@layer states {
  /* Wins over base AND variant — layer position, not !important */
  .animus-Card-d4e5f6[data-selected] {
    background: var(--color-primary);
    border-color: var(--color-primary);
  }
}
```

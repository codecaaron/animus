# The Builder Chain

Every Animus component is assembled by chaining methods on your design system instance. Each method writes into a specific `@layer` of the CSS cascade. The chain is sealed by `.asElement(tag)`, which produces a fully typed React component with all variant and state props inferred from the chain.

```tsx
ds
  .styles(config)    // @layer base      — unconditional defaults
  .variant(config)   // @layer variants  — named prop options
  .compound(cond, s) // @layer compounds — multi-condition overrides
  .states(config)    // @layer states    — boolean toggles
  .system(config)    // @layer system    — responsive prop groups
  .props(config)     // @layer custom    — custom CSS property slots
  .asElement('div')  // sealed component
```

`.styles(config)` sets unconditional defaults in `@layer base`. Every selector emitted is a single class — no nesting, no specificity escalation. `.variant({ prop, variants, defaultVariant, base })` declares a named prop and maps its values to style objects in `@layer variants`. The `prop` key defaults to `'variant'` when omitted. Chain multiple `.variant()` calls to introduce multiple independent axes.

`.compound(condition, styles)` takes exactly two arguments and writes to `@layer compounds`. Condition values can be arrays to match multiple variant values at once. `.states(config)` declares boolean toggle props in `@layer states` — they sit above variants and compounds and require no qualification to win. `.system(config)` enables responsive prop groups (e.g. `{ space: true }`) whose classes are shared and de-duplicated across the system in `@layer system`. `.props(config)` registers custom CSS property slots in `@layer custom`, each with an optional scale, transform, and variable binding.

### Composition with .extend()

`.extend()` reopens a sealed component and returns a new builder that deep-merges styles, groups, and props from the parent. New layers are appended after the inherited ones. The original component is unchanged.

```tsx
// .extend() reopens a sealed component to append new layers.
// Styles, groups, and props are deep-merged with the parent.

const LargeButton = Button.extend()
  .variant({
    prop: 'size',
    variants: {
      base: { px: 16, py: 8 },
      sm:   { px: 10, py: 4, fontSize: 12 },
      lg:   { px: 24, py: 12, fontSize: 16 },
    },
  })
  .asElement('button');
```

### Full example

```tsx
import { ds } from './ds';

export const Button = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    px: 16,
    py: 8,
    fontFamily: 'mono',
    fontSize: 14,
    borderRadius: 2,
    cursor: 'pointer',
    bg: 'coal',
    color: 'text',
    border: '1px solid',
    borderColor: 'ash',
  })
  .variant({
    prop: 'intent',
    variants: {
      base:    {},
      primary: { bg: 'primary', color: 'background', borderColor: 'primary' },
      ghost:   { bg: 'transparent', borderColor: 'transparent' },
    },
  })
  .compound(
    { intent: 'primary', disabled: true },
    { opacity: '0.4', cursor: 'not-allowed' },
  )
  .states({
    disabled: { opacity: '0.5', cursor: 'not-allowed' },
  })
  .system({ space: true, arrange: true })
  .asElement('button');
```

```css
/* @layer base — .styles() */
@layer base {
  .animus-Button-a1b2c3 {
    display: inline-flex;
    align-items: center;
    padding-inline: 16px;
    padding-block: 8px;
    font-family: var(--font-mono);
    font-size: 14px;
    border-radius: 2px;
    cursor: pointer;
    background: var(--color-coal);
    color: var(--color-text);
    border: 1px solid var(--color-ash);
  }
}

/* @layer variants — .variant() */
@layer variants {
  .animus-Button-a1b2c3[data-intent="primary"] {
    background: var(--color-primary);
    color: var(--color-background);
    border-color: var(--color-primary);
  }
  .animus-Button-a1b2c3[data-intent="ghost"] {
    background: transparent;
    border-color: transparent;
  }
}

/* @layer compounds — .compound() */
@layer compounds {
  .animus-Button-a1b2c3[data-intent="primary"][data-disabled] {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

/* @layer states — .states() */
@layer states {
  .animus-Button-a1b2c3[data-disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

/* @layer system — .system() per-breakpoint utility classes */
@layer system {
  .bp-px-16 { padding-inline: 16px; }
  .bp-py-8  { padding-block: 8px; }
}
```

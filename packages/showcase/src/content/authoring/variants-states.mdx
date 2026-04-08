# Variants & States

## Named Variants

```typescript
const Button = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    px: 16,
    py: 8,
    border: 'none',
    cursor: 'pointer',
  })
  .variant({
    prop: 'size',
    variants: {
      sm: { px: 8, py: 4, fontSize: 12 },
      lg: { px: 24, py: 12, fontSize: 18 },
    },
  })
  .variant({
    prop: 'intent',
    defaultVariant: 'base',
    variants: {
      base: { bg: 'surface', color: 'text' },
      primary: { bg: 'primary', color: 'background' },
    },
  })
  .asElement('button');
```

Each `.variant()` call declares a single prop with named options. `defaultVariant` sets the value used when the prop is omitted. If a variant has no `defaultVariant` and the prop isn't passed, no variant class is applied -- the component renders with just its base styles for that dimension.

```tsx
<Button size="sm" intent="primary">Click</Button>
<Button intent="primary">No size — base padding applies.</Button>
```

## Compound Conditions

```typescript
const Button = ds
  .styles({ display: 'inline-flex', alignItems: 'center', px: 16, py: 8, border: 'none', cursor: 'pointer' })
  .variant({
    prop: 'size',
    variants: {
      sm: { px: 8, py: 4, fontSize: 12 },
      lg: { px: 24, py: 12, fontSize: 18 },
    },
  })
  .variant({
    prop: 'intent',
    defaultVariant: 'base',
    variants: {
      base: { bg: 'surface', color: 'text' },
      primary: { bg: 'primary', color: 'background' },
    },
  })
  .compound(
    { size: 'lg', intent: 'primary' },
    { fontWeight: 700 }
  )
  .asElement('button');
```

Two arguments: a condition object matching variant values, then a style object applied when all conditions are true.

```tsx
<Button size="lg" intent="primary">Bold Primary</Button>
```

## Boolean State Props

```typescript
const Button = ds
  .styles({ display: 'inline-flex', alignItems: 'center', px: 16, py: 8, border: 'none', cursor: 'pointer' })
  .variant({
    prop: 'size',
    variants: {
      sm: { px: 8, py: 4, fontSize: 12 },
      lg: { px: 24, py: 12, fontSize: 18 },
    },
  })
  .variant({
    prop: 'intent',
    defaultVariant: 'base',
    variants: {
      base: { bg: 'surface', color: 'text' },
      primary: { bg: 'primary', color: 'background' },
    },
  })
  .states({
    disabled: { opacity: '0.4', cursor: 'not-allowed' },
    loading: { opacity: '0.7', pointerEvents: 'none' },
  })
  .asElement('button');
```

States are boolean props whose styles emit at `@layer states` -- they override variants and compounds because of cascade position, not specificity. They are not CSS pseudo-classes. `:hover` and `:disabled` belong in `.styles()` as nested selectors.

```tsx
<Button disabled={isDisabled}>Save</Button>
<Button loading={isLoading}>Submit</Button>
```

States accept full CSS objects with nested selectors, just like every other method:

```typescript
.states({
  disabled: {
    opacity: '0.4',
    '&:hover': { cursor: 'not-allowed' },
  },
})
```

## Extending Components

```typescript
const PrimaryButton = Button.extend()
  .styles({ bg: 'primary', color: 'background' })
  .asElement('button');
```

`.extend()` opens a new builder chain that inherits the parent's variants, states, and system config. Add, override, or layer on top of the base component.

```tsx
<PrimaryButton size="lg" disabled={false}>Continue</PrimaryButton>
```

## What the CSS looks like

```css
@layer global, base, variants, compounds, states, system, custom;

@layer base {
  .animus-Button-a1b2c3d4 {
    display: inline-flex;
    align-items: center;
    padding-inline: 1rem;
    padding-block: 0.5rem;
    border: none;
    cursor: pointer;
  }
}

@layer variants {
  .animus-Button-a1b2c3d4--size-sm {
    padding-inline: 0.5rem;
    padding-block: 0.25rem;
    font-size: 0.75rem;
  }

  .animus-Button-a1b2c3d4--size-lg {
    padding-inline: 1.5rem;
    padding-block: 0.75rem;
    font-size: 1.125rem;
  }

  .animus-Button-a1b2c3d4--intent-base {
    background: var(--color-surface);
    color: var(--color-text);
  }

  .animus-Button-a1b2c3d4--intent-primary {
    background: var(--color-primary);
    color: var(--color-background);
  }
}

@layer compounds {
  .animus-Button-a1b2c3d4--compound-0 {
    font-weight: 700;
  }
}

@layer states {
  .animus-Button-a1b2c3d4--disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .animus-Button-a1b2c3d4--loading {
    opacity: 0.7;
    pointer-events: none;
  }
}
```

`@layer variants` < `@layer compounds` < `@layer states`. A state always beats a compound which always beats a variant. That's the only mechanism -- no `!important`, no specificity tricks.

## Before / After

CSS class toggles:

```css
.btn--sm { padding: 4px 8px; font-size: 12px; }
.btn--lg { padding: 12px 24px; font-size: 18px; }
.btn--primary { background: blue; color: white; }
.btn--disabled { opacity: 0.4; cursor: not-allowed; }
```

```tsx
<button className={`btn ${size === 'sm' ? 'btn--sm' : 'btn--lg'} ${intent === 'primary' ? 'btn--primary' : ''} ${disabled ? 'btn--disabled' : ''}`}>
  Click
</button>
```

Animus equivalent:

```tsx
<Button size="sm" intent="primary" disabled={isDisabled}>Click</Button>
```

Variant selection, compound logic, and state overrides are declared in the builder and resolved through cascade layers.

## Going Further

- [System Props](/docs/authoring/system-props) -- ad-hoc style props from your design system
- [Builder Chain Reference](/docs/reference/builder-chain) -- full method inventory and chaining rules

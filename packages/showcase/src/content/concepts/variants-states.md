# Variants & States

### Variants

`.variant({ prop, variants, defaultVariant, base })` declares a named prop and a map of style objects. The `prop` key defaults to `'variant'` when omitted. Each entry in `variants` produces a `[data-prop="value"]` rule in `@layer variants`. When `defaultVariant` is specified, that variant's styles are emitted without a data attribute so they apply by default. The `base` key in the config provides styles shared across all variants before per-variant overrides are applied.

```tsx
export const Badge = ds
  .styles({
    display: 'inline-flex',
    px: 8,
    py: 2,
    fontFamily: 'mono',
    fontSize: 11,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
  })
  .variant({
    prop: 'status',
    defaultVariant: 'base',
    variants: {
      base:    { bg: 'ash',     color: 'textMuted' },
      active:  { bg: 'primary', color: 'background' },
      success: { bg: 'success', color: 'background' },
    },
  })
  .asElement('span');

// Usage
<Badge status="active">Live</Badge>
```

```css
@layer base {
  .animus-Badge-g7h8i9 {
    display: inline-flex;
    padding-inline: 8px;
    padding-block: 2px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }
}

@layer variants {
  /* defaultVariant="base" emits without a data attribute */
  .animus-Badge-g7h8i9 {
    background: var(--color-ash);
    color: var(--color-text-muted);
  }
  .animus-Badge-g7h8i9[data-status="active"] {
    background: var(--color-primary);
    color: var(--color-background);
  }
  .animus-Badge-g7h8i9[data-status="success"] {
    background: var(--color-success);
    color: var(--color-background);
  }
}
```

### Compound variants

`.compound(condition, styles)` takes exactly two arguments. The first is a condition object mapping prop names to the values that must be active simultaneously. The second is the style object to apply when all conditions are met. A condition value can be a single string for an exact match, or an array of strings — arrays are expanded into a selector list, one rule per combination.

```tsx
export const Chip = ds
  .styles({ display: 'inline-flex', px: 12, py: 4 })
  .variant({
    prop: 'size',
    variants: {
      base: { fontSize: 13 },
      lg:   { fontSize: 16 },
    },
  })
  .variant({
    prop: 'intent',
    variants: {
      base:    { bg: 'coal' },
      primary: { bg: 'primary', color: 'background' },
    },
  })
  // Two args: condition object, then style object.
  // Single values → exact match.
  .compound(
    { size: 'lg', intent: 'primary' },
    { fontWeight: '600', letterSpacing: '0.05em' },
  )
  // Array values → expands to one selector per combination.
  .compound(
    { size: ['base', 'lg'], intent: 'primary' },
    { textTransform: 'uppercase' },
  )
  .asElement('span');
```

```css
@layer compounds {
  /* Single condition — both props must match exactly */
  .animus-Chip-j0k1l2[data-size="lg"][data-intent="primary"] {
    font-weight: 600;
    letter-spacing: 0.05em;
  }

  /* Array condition — expanded into a selector list */
  .animus-Chip-j0k1l2[data-size="base"][data-intent="primary"],
  .animus-Chip-j0k1l2[data-size="lg"][data-intent="primary"] {
    text-transform: uppercase;
  }
}
```

### States

`.states(config)` takes a `Record<string, CSS>` and declares boolean toggle props. Each key becomes a prop on the React component and a `[data-key]` attribute selector in `@layer states`. Because states occupy the highest component-owned layer, they override any active variant or compound unconditionally — no selector qualification needed.

```tsx
export const Input = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 14,
    px: 12,
    py: 8,
    bg: 'coal',
    color: 'text',
    border: '1px solid',
    borderColor: 'ash',
    outline: 'none',
  })
  .states({
    focused:  { borderColor: 'primary' },
    invalid:  { borderColor: 'error' },
    disabled: { opacity: '0.4', cursor: 'not-allowed' },
  })
  .asElement('input');

// States are boolean props. No variant logic — just on/off.
<Input focused={isFocused} invalid={hasError} />
```

```css
@layer states {
  /* Each key becomes [data-key] — sits above variants and compounds */
  .animus-Input-m3n4o5[data-focused] {
    border-color: var(--color-primary);
  }
  .animus-Input-m3n4o5[data-invalid] {
    border-color: var(--color-error);
  }
  .animus-Input-m3n4o5[data-disabled] {
    opacity: 0.4;
    cursor: not-allowed;
  }
}
```

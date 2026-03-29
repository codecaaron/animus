# Proposal: Button Combinatorial Matrix

## The Pattern: Intermediate Scale + Variant Re-aliasing

### The Indirection Layer

Define a `btn` scale in the theme — an intermediate color scale that the button component references. These CSS variables exist solely as the indirection point between "what the button looks like" and "which palette it's using."

```typescript
// In createTheme, define the intermediate scale with defaults
.addScale('btn', () => ({
  base: 'var(--color-primary)',
  hover: 'var(--color-primary-hover)',
  text: 'var(--color-bg)',          // inverse of bg for contrast
  ring: 'var(--color-primary)',
  muted: 'var(--color-primary)',    // used with alpha for ghost hover
}))
```

This generates: `--btn-base`, `--btn-hover`, `--btn-text`, `--btn-ring`, `--btn-muted`.

The defaults point at the mode's primary colors — so a button with no color variant inherits the mode's primary automatically. In dark mode that's fire, in ocean mode that's blue, etc.

### The Component

The button's base styles reference ONLY the intermediate vars:

```typescript
const Button = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontFamily: 'mono',
    fontWeight: 500,
    transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
  })
```

### Color Variant — Re-aliases the Intermediate Scale

The FIRST variant (highest in cascade after base) resets the `--btn-*` vars to a specific palette. This is where the indirection pays off:

```typescript
  .variant({
    prop: 'color',
    variants: {
      // "primary" follows the mode — no override needed, defaults work
      primary:   {},
      // Semantic intent variants re-alias to specific palettes
      secondary: {
        '--btn-base':  'var(--color-secondary)',
        '--btn-hover': 'var(--color-accent)',
        '--btn-text':  'var(--color-bg)',
      },
      success:   {
        '--btn-base':  'var(--color-forest-500)',
        '--btn-hover': 'var(--color-forest-600)',
        '--btn-text':  'var(--color-forest-50)',
        '--btn-ring':  'var(--color-forest-300)',
        '--btn-muted': 'var(--color-forest-500)',
      },
      warning:   {
        '--btn-base':  'var(--color-gold-500)',
        '--btn-hover': 'var(--color-gold-600)',
        '--btn-text':  'var(--color-gold-950)',
        '--btn-ring':  'var(--color-gold-300)',
        '--btn-muted': 'var(--color-gold-500)',
      },
      danger:    {
        '--btn-base':  'var(--color-fire-600)',
        '--btn-hover': 'var(--color-fire-700)',
        '--btn-text':  'var(--color-fire-50)',
        '--btn-ring':  'var(--color-fire-300)',
        '--btn-muted': 'var(--color-fire-600)',
      },
    },
    defaultVariant: 'primary',
  })
```

**Key**: `primary` is empty `{}` — it inherits the intermediates' defaults, which already point at `--color-primary`. The mode system handles which palette that resolves to. The other variants hardcode specific palette refs for semantic intent (success is always green, danger is always red, regardless of mode).

### Style Variant — Composes Against Intermediates

```typescript
  .variant({
    prop: 'kind',
    variants: {
      fill: {
        background: 'var(--btn-base)',
        color: 'var(--btn-text)',
        border: 'none',
        '&:hover': { background: 'var(--btn-hover)' },
      },
      outline: {
        background: 'transparent',
        border: '1px solid var(--btn-base)',
        color: 'var(--btn-base)',
        '&:hover': { background: 'color-mix(in srgb, var(--btn-muted) 10%, transparent)' },
      },
      ghost: {
        background: 'transparent',
        color: 'var(--btn-base)',
        border: 'none',
        '&:hover': { background: 'color-mix(in srgb, var(--btn-muted) 10%, transparent)' },
      },
    },
    defaultVariant: 'fill',
  })
```

These don't know or care which color is active. They only talk to `--btn-*`.

### Size Variant — Pure Dimensional

```typescript
  .variant({
    prop: 'size',
    variants: {
      sm: { px: 8,  py: 4,  fontSize: 12 },
      md: { px: 16, py: 8,  fontSize: 14 },
      lg: { px: 24, py: 12, fontSize: 16 },
    },
    defaultVariant: 'md',
  })
```

### States

```typescript
  .states({
    hover:    { background: 'var(--btn-hover)' },
    active:   { transform: 'scale(0.98)' },
    focus:    { boxShadow: '0 0 0 2px var(--btn-ring)' },
    disabled: { opacity: '0.4', pointerEvents: 'none', cursor: 'default' },
  })
  .groups({ space: true })
  .asElement('button');
```

States serve double duty: the real CSS pseudo-selectors in `.styles()` handle live interaction, the `.states()` booleans allow forced display in the matrix.

## Why This Works

```
CASCADE ORDER:
  @layer base     → bg references var(--btn-base), which defaults to var(--color-primary)
  @layer variants → color="success" resets --btn-base to var(--color-forest-500)
                    kind="outline" sets bg: transparent, border: var(--btn-base)
                    size="lg" sets px: 24, py: 12
  @layer states   → disabled sets opacity: 0.4
```

The variant layer OVERRIDES the base defaults. The button scale acts as a local scope — only the button reads from `--btn-*`, and only the color variant writes to it.

## The Matrix Display

```
             primary    secondary   success    warning    danger
fill    sm   [Button]   [Button]    [Button]   [Button]   [Button]
        md   [Button]   [Button]    [Button]   [Button]   [Button]
        lg   [Button]   [Button]    [Button]   [Button]   [Button]
outline sm   [Button]   [Button]    [Button]   [Button]   [Button]
        md   [Button]   [Button]    [Button]   [Button]   [Button]
        lg   [Button]   [Button]    [Button]   [Button]   [Button]
ghost   sm   [Button]   [Button]    [Button]   [Button]   [Button]
        md   [Button]   [Button]    [Button]   [Button]   [Button]
        lg   [Button]   [Button]    [Button]   [Button]   [Button]

States (fill/md):
        default   hover     active    focus     disabled
primary [Button]  [Button]  [Button]  [Button]  [Button]
danger  [Button]  [Button]  [Button]  [Button]  [Button]
```

5 colors × 3 styles × 3 sizes + state rows = 45+ buttons rendered, from ONE definition.

## CSS Budget

- Base styles (shared): ~180B
- 5 color variants (var resets): ~5 × 100B = ~500B
- 3 style variants (composing vars): ~3 × 120B = ~360B
- 3 size variants (dimensional): ~3 × 50B = ~150B
- 4 states: ~160B
- **Total: ~1.35 KB** for 45+ visual combinations

## Open Questions for Next Session

1. **Does Rust extraction pass through `--btn-base` custom property declarations in variant values?** The variant value `{ '--btn-base': 'var(--color-fire-500)' }` needs to emit as a CSS custom property declaration, not be processed as a prop shorthand.

2. **Can `addScale` produce `--btn-*` vars that reference other `var(--color-*)` vars as defaults?** The theme evaluation subprocess flattens token values — does it preserve `var()` references or try to resolve them?

3. **Does `&:hover` inside a variant value work?** The pseudo-selector nesting in the `kind` variant needs to compose with the button's base styles correctly.

4. **Do `.states()` boolean props work alongside real `:hover` pseudo-selectors?** We want both: pseudo-selectors for real interaction, state booleans for forced matrix display.

## Files (Next Session)

- `src/components/docs/Button.tsx` — the combinatorial button
- `src/pages/Examples.tsx` — matrix display page (lazy route at `/docs/examples`)
- `src/ds.ts` — add `btn` intermediate scale
- Update router + sidebar with new route

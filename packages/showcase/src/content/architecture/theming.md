# Theming & Tokens

## Define your palette

```typescript
import { createTheme } from '@animus-ui/system';

const tokens = createTheme()
  .addColors({
    gray: { 100: '#f0f0f0', 500: '#555555', 900: '#080808' },
    blue: { 400: '#3d94ff', 600: '#0055cc' },
    red: { 500: '#ef4444' },
    green: { 500: '#22c55e' },
  })
  .build();
```

Colors always emit CSS custom properties. When you write `bg: 'gray.100'`, the scale lookup resolves to `var(--color-gray-100)` in the output CSS.

## Breakpoints

```typescript
createTheme()
  .addBreakpoints({ sm: 640, md: 768, lg: 1024, xl: 1440 })
```

Breakpoints define named media queries for responsive values. Names and pixel thresholds are entirely yours -- there are no built-in breakpoints. Each name becomes a key you use in responsive objects (`p={{ _: 8, sm: 16 }}`) and they're type-checked through theme augmentation.

Each breakpoint produces a `@media (min-width: Npx)` query. The names flow through to the type system, so `sm` only autocompletes if your theme declares it.

## Scales

```typescript
const tokens = createTheme()
  .addBreakpoints({ sm: 640, md: 768, lg: 1024 })
  .addColors({ /* ... */ })
  .addScale({
    name: 'space',
    values: { 4: '0.25rem', 8: '0.5rem', 16: '1rem', 24: '1.5rem', 32: '2rem' },
  })
  .addScale({
    name: 'fontSizes',
    values: { 12: '0.75rem', 14: '0.875rem', 16: '1rem', 24: '1.5rem' },
  })
  .build();
```

Scales are key-value maps. When a prop is bound to a scale, its values resolve through that scale: `p: 16` looks up `16` in the `space` scale and emits `padding: 1rem`. By default, scale values are inlined at build time as literals, not CSS variables.

### The `emit` prop

If a scale's values need to change at runtime, set `emit: true`:

```typescript
.addScale({
  name: 'sizes',
  emit: true,
  values: { navHeight: '48px', sidebarWidth: '200px' },
})
```

Emitted scales produce CSS custom properties: `'{sizes.navHeight}'` becomes `var(--sizes-navHeight)`. Non-emitted scales resolve to literal values at build time.

**When to emit:** Use `emit: true` when the value must be overridable at runtime (e.g., layout dimensions that change per viewport, or shared sizing tokens). For most scales (space, font sizes, font weights), literal inlining is preferable -- it's simpler to debug and has one fewer indirection.

Colors always emit regardless of this setting, because color mode switching requires CSS custom properties.

## Token references

Most of the time you use scale values directly through shorthand props: `p: 16`, `bg: 'primary'`, `fontSize: 14`. The scale lookup handles resolution automatically.

When you need a theme value embedded inside a larger string, use the `'{scale.key}'` escape hatch:

```typescript
const Card = ds
  .styles({
    p: 16,                                     // scale lookup -> 1rem
    bg: 'surface',                             // scale lookup -> var(--color-surface)
    boxShadow: '0 0 0 2px {colors.primary}',  // token ref in composite string
    border: '1px solid {colors.border}',       // token ref in composite string
  })
  .asElement('div');
```

### Alpha modifier

Append `/{percent}` to a color token ref for transparency:

```typescript
.styles({
  bg: '{colors.primary/20}',               // -> color-mix(in srgb, var(--color-primary) 20%, transparent)
  boxShadow: '0 0 12px {colors.glow/40}', // works in composite strings too
})
```

Token references are type-checked. Invalid paths produce TypeScript errors:

```typescript
bg: '{colors.missing}',  // TS error: 'missing' not in colors
```

## Theme type augmentation

To get autocomplete and type checking for your tokens, augment the `Theme` interface:

```typescript
type MyTheme = typeof tokens;

declare module '@animus-ui/system' {
  interface Theme extends MyTheme {}
}
```

This connects your theme's scales, colors, and breakpoints to the builder chain's type system.

## Extending a base theme

`.from()` copies an existing built theme into a new builder, inheriting its scales, colors, emitted variables, and contextual vars:

```typescript
// packages/shared-tokens/src/index.ts
import { createTheme } from '@animus-ui/system';

export const baseTokens = createTheme()
  .addColors({ gray: { 100: '#f0f0f0', 900: '#080808' } })
  .addScale({ name: 'space', values: { 4: '0.25rem', 8: '0.5rem', 16: '1rem' } })
  .build();
```

```typescript
// packages/my-app/src/ds.ts
import { createTheme } from '@animus-ui/system';
import { baseTokens } from '@my-org/shared-tokens';

const tokens = createTheme()
  .from(baseTokens)
  .addColors({ brand: { 500: '#3b82f6', 600: '#2563eb' } })
  .addScale({ name: 'radii', values: { sm: '4px', md: '8px', lg: '16px' } })
  .build();
```

The consumer theme gets everything from the base plus its own additions. Color modes, emitted scales, and contextual vars from the base are all carried over. You can then override any scale with a new `.addScale()` of the same name.

## Font loading

The `fonts` scale maps token names to font stacks. Bind them through the `typography` group's `fontFamily` prop:

```typescript
createTheme()
  .addScale({
    name: 'fonts',
    values: {
      body: "'Inter', sans-serif",
      mono: "'Fira Code', monospace",
    },
  })
  .build();
```

Then reference them by key:

```typescript
const Prose = ds
  .styles({ fontFamily: 'body', lineHeight: 'relaxed' })
  .asElement('p');

const Code = ds
  .styles({ fontFamily: 'mono', fontSize: 14 })
  .asElement('code');
```

The actual font files can come from anywhere -- `@font-face` in `createGlobalStyles`, a Google Fonts `<link>`, or Next.js `next/font`:

```typescript
// Option A: @font-face in global styles
export const globalStyles = createGlobalStyles({
  '@font-face': {
    fontFamily: "'Inter'",
    src: "url('/fonts/inter.woff2') format('woff2')",
    fontDisplay: 'swap',
  },
  /* ... */
});

// Option B: next/font sets a CSS variable, reference it in the scale
// const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
// Then: fonts: { body: "var(--font-inter), sans-serif" }
```

Animus handles the reference, the loading mechanism is yours.

## What the CSS looks like

Theme tokens in `:root`:

```css
:root {
  --color-gray-100: #f0f0f0;
  --color-gray-500: #555555;
  --color-gray-900: #080808;
  --color-primary: #3d94ff;
  --color-bg: #080808;
  --color-text: #f0f0f0;
  --sizes-navHeight: 48px;
  --sizes-sidebarWidth: 200px;
}
```

Only colors and emitted scales appear as CSS custom properties. Non-emitted scale values (space, fontSizes, etc.) are resolved to literals at build time and don't appear in `:root`.

## Going further

- [Color Modes](/docs/architecture/color-modes) -- dark/light switching, scoped themes, SSR flash prevention
- [System Setup](/docs/architecture/system-setup) -- compose prop groups and wire the theme to components
- [createTheme() reference](/docs/reference/create-theme) -- full method inventory

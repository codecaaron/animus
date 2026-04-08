# System Setup

This page explains the `ds.ts` boilerplate from [Getting Started](/docs/start). If you haven't built your first component yet, start there.

## The full file

```typescript
// src/ds.ts
import { createSystem, createTheme } from '@animus-ui/system';
import { color, space, typography, flex, border } from '@animus-ui/system/groups';

const tokens = createTheme()
  .addBreakpoints({ sm: 640, md: 768, lg: 1024 })
  .addScale({
    name: 'space',
    values: { 4: '0.25rem', 8: '0.5rem', 16: '1rem', 24: '1.5rem', 32: '2rem' },
  })
  .addColors({
    primary: '#3b82f6',
    background: '#ffffff',
    surface: '#f1f5f9',
    text: '#0f172a',
    textMuted: '#64748b',
    border: '#e2e8f0',
    error: '#ef4444',
    success: '#22c55e',
  })
  .build();

type MyTheme = typeof tokens;
declare module '@animus-ui/system' {
  interface Theme extends MyTheme {}
}

export const { system: ds, createGlobalStyles } = createSystem()
  .addGroup('surface', { ...color, ...border })
  .addGroup('arrange', { ...flex })
  .addGroup('text', { ...typography })
  .addGroup('space', space)
  .build();
```

## Line by line

### Theme

```typescript
const tokens = createTheme()
```

Starts the theme builder. Chains are order-independent -- you can add breakpoints, scales, and colors in any order.

```typescript
  .addBreakpoints({ sm: 640, md: 768, lg: 1024 })
```

Defines named breakpoints for responsive values. These become `@media (min-width: Npx)` queries in the output.

```typescript
  .addScale({
    name: 'space',
    values: { 4: '0.25rem', 8: '0.5rem', 16: '1rem', 24: '1.5rem', 32: '2rem' },
  })
```

Adds a named scale. Scale values are inlined at build time: `'{space.16}'` resolves to `1rem` in the output CSS. No CSS custom property is created unless you set `emit: true`.

```typescript
  .addColors({
    primary: '#3b82f6',
    background: '#ffffff',
    /* ... */
  })
```

Adds colors to the theme. Colors always emit CSS custom properties: `'{colors.primary}'` becomes `var(--color-primary)`. This is required for color mode switching to work.

```typescript
  .build();
```

Finalizes the theme and returns the token object.

### Type augmentation

```typescript
type MyTheme = typeof tokens;
declare module '@animus-ui/system' {
  interface Theme extends MyTheme {}
}
```

Connects your theme to the type system. After this, every `.styles()` call type-checks scale values and color names against your actual theme.

### System

```typescript
export const { system: ds, createGlobalStyles } = createSystem()
```

Starts the system builder. `.build()` returns two things: `system` (the builder instance you'll use for components) and `createGlobalStyles` (for defining global CSS).

```typescript
  .addGroup('surface', { ...color, ...border })
```

Registers a prop group called `surface`. This is what makes shorthand props like `bg`, `color`, `borderColor`, and `borderRadius` available. Each prop in the group maps a short name to a CSS property and a theme scale: `bg` -> `backgroundColor` resolved through `colors`.

When a component calls `.system({ surface: true })`, these props become passthrough props on the component at the callsite. But they also work inside `.styles()` -- every prop registered in any group is available in style objects.

Groups are composed from pre-built prop collections. Spreading `...color` and `...border` merges their prop definitions into one group.

```typescript
  .addGroup('text', { ...typography })
  .addGroup('space', space)
```

More groups. `space` isn't spread because it's used as-is. Spreading is only needed when composing multiple collections into one group.

```typescript
  .build();
```

Finalizes the system. From here, `ds` is the builder you import in every component file.

## Pre-built prop groups

Available from `@animus-ui/system/groups`:

| Import | Props it contains |
|--------|-------------------|
| `space` | margin, padding shorthands (`p`, `px`, `m`, `mt`, etc.) |
| `color` | `color`, `bg`, `opacity` |
| `typography` | `fontSize`, `fontWeight`, `lineHeight`, `fontFamily`, `textAlign` |
| `flex` | `flexDirection`, `alignItems`, `justifyContent`, `gap`, `flexWrap` |
| `border` | `borderWidth`, `borderStyle`, `borderColor`, `borderRadius` |
| `layout` | `display`, `width`, `height`, `overflow`, `maxWidth` |
| `grid` | `gridTemplateColumns`, `gridTemplateRows`, `gridGap` |
| `positioning` | `position`, `top`, `right`, `bottom`, `left`, `zIndex` |
| `shadows` | `boxShadow`, `textShadow` |
| `background` | `backgroundImage`, `backgroundSize`, `backgroundPosition` |
| `transitions` | `transition`, `animation` |

## Custom props in groups

You can add custom prop definitions alongside pre-built ones:

```typescript
.addGroup('surface', {
  ...color,
  ...border,
  ring: { property: 'boxShadow', scale: 'rings' },
})
```

Each prop definition maps a prop name to a CSS property and optionally a theme scale.

## Custom scale to custom prop

The pieces above connect in a straight line: define a scale in the theme, define a prop that reads from it, register the prop in a group.

```typescript
// 1. Theme: add a z-index scale
const tokens = createTheme()
  .addScale({
    name: 'zIndices',
    values: { base: '0', dropdown: '100', modal: '200', toast: '300' },
  })
  .build();
```

```typescript
// 2. System: wire it into a group
export const { system: ds } = createSystem()
  .addGroup('positioning', {
    ...positioning,
    // positioning already has: zIndex: { property: 'zIndex', scale: 'zIndices' }
  })
  .build();
```

```typescript
// 3. Component: use it
const Overlay = ds
  .styles({ position: 'fixed', inset: 0, zIndex: 'modal' })
  .asElement('div');
```

At build time, `zIndex: 'modal'` resolves to `z-index: 200` -- a literal value from the scale. If you wanted it as a CSS variable instead, add `emit: true` on the scale.

You can also define a completely custom prop from scratch instead of using a pre-built one:

```typescript
.addGroup('layout', {
  ...layout,
  elevation: { property: 'boxShadow', scale: 'elevation' },
})
```

Now `elevation: 'glow'` is a valid prop wherever `.system({ layout: true })` is enabled, and it resolves through the `elevation` scale.

## Global styles

```typescript
export const globalStyles = createGlobalStyles({
  '*, *::before, *::after': { boxSizing: 'border-box' },
  'html, body': { margin: 0, bg: 'background', color: 'text' },
});
```

`createGlobalStyles` takes a CSS object map (selectors to style objects). Shorthand props and scale lookups work the same as in `.styles()`. Global CSS emits to `@layer global`.

### Keyframes

Define `@keyframes` inside `createGlobalStyles`:

```typescript
export const globalStyles = createGlobalStyles({
  '*, *::before, *::after': { boxSizing: 'border-box' },
  'html, body': { margin: 0, bg: 'background', color: 'text' },
  '@keyframes fade-in': {
    '0%': { opacity: '0' },
    '100%': { opacity: '1' },
  },
  '@keyframes pulse': {
    '0%, 100%': { transform: 'scale(1)' },
    '50%': { transform: 'scale(1.02)' },
  },
});
```

Then reference them by name in component styles:

```typescript
const FadeIn = ds
  .styles({ animation: 'fade-in 300ms ease' })
  .asElement('div');
```

## CSS reset

`createGlobalStyles` is where your CSS reset lives. Everything in it emits to `@layer global`, which sits below all component layers -- resets never fight with component styles.

```typescript
export const globalStyles = createGlobalStyles({
  '*, *::before, *::after': { boxSizing: 'border-box' },
  'html, body': { margin: 0, bg: 'background', color: 'text', fontFamily: 'body' },
  'h1, h2, h3, h4, h5, h6': { marginTop: 0 },
  'p': { marginTop: 0, marginBottom: '1rem' },
  img: { verticalAlign: 'middle', borderStyle: 'none' },
  'input, button, select, textarea': {
    margin: 0,
    fontFamily: 'inherit',
    fontSize: 'inherit',
  },
});
```

Prop shorthand (`bg`, `color`, `fontFamily`) resolves the same as in `.styles()`. Export the `globalStyles` binding from your `ds.ts` -- the Vite plugin discovers it automatically and includes it in the stylesheet.

## Going further

- [Composition](/docs/authoring/composition) -- compose multi-slot component families
- [createSystem() reference](/docs/reference/create-system) -- full SystemBuilder API
- [createTheme() reference](/docs/reference/create-theme) -- full ThemeBuilder API

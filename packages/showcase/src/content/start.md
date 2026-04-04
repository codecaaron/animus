# Getting Started

## Create your design system

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

Copy this file as `src/ds.ts`. We'll explain every line in the [System Setup](/docs/architecture/system-setup) guide.

## Import the stylesheet

```tsx
// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import 'virtual:animus/styles.css';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

The virtual import is generated at build time by the Vite plugin. It contains all extracted CSS for your components.

## Build your first component

```tsx
// src/components/Card.tsx
import { ds } from '../ds';

const Card = ds
  .styles({
    p: 16,
    bg: 'surface',
    color: 'text',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'border',
    borderRadius: '8px',
  })
  .asElement('div');

export function Welcome() {
  return <Card>Your first Animus component.</Card>;
}
```

Style values resolve through your theme's scales. `p: 16` looks up key `16` in the `space` scale and emits `padding: 1rem`. `bg: 'surface'` looks up `surface` in `colors` and emits `background-color: var(--color-surface)`. Shorthand props like `p`, `bg`, and `borderColor` are defined by the prop groups registered in your system.

## Add hover and focus

```tsx
const InteractiveCard = ds
  .styles({
    p: 16,
    bg: 'surface',
    color: 'text',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'border',
    borderRadius: '8px',
    transition: 'background-color 150ms ease, border-color 150ms ease',
    outline: 'none',
    '&:hover': {
      bg: 'background',
      borderColor: 'primary',
    },
    '&:focus-visible': {
      borderColor: 'primary',
      boxShadow: '0 0 0 2px {colors.primary}',
    },
  })
  .asElement('div');
```

Nested selectors go inside `.styles()` as `&`-prefixed keys -- pseudo-classes, pseudo-elements, child selectors (`& > *`), and sibling selectors all work. Nesting is one level deep: you can nest a selector inside `.styles()`, but not a selector inside a selector.

When a value is a plain scale key, use the shorthand: `bg: 'primary'`. When you need a theme value inside a larger string, use the token ref syntax: `boxShadow: '0 0 0 2px {colors.primary}'`.

## Before and after

The CSS you'd write by hand:

```css
.card {
  padding: 1rem;
  background-color: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 8px;
}

.card:hover {
  background-color: var(--color-background);
  border-color: var(--color-primary);
}
```

The Animus equivalent:

```tsx
const Card = ds
  .styles({
    p: 16,
    bg: 'surface',
    color: 'text',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'border',
    borderRadius: '8px',
    '&:hover': {
      bg: 'background',
      borderColor: 'primary',
    },
  })
  .asElement('div');
```

Same output, fewer characters. Scale keys and color names are type-checked against your theme, and the CSS is statically extracted at build time.

## What the CSS looks like

```css
@layer base {
  .animus-Card-x3k9f {
    padding: 1rem;
    background-color: var(--color-surface);
    color: var(--color-text);
    border-width: 1px;
    border-style: solid;
    border-color: var(--color-border);
    border-radius: 8px;
  }

  .animus-Card-x3k9f:hover {
    background-color: var(--color-background);
    border-color: var(--color-primary);
  }
}
```

`@layer` declarations control cascade precedence -- styles in later layers override earlier ones regardless of specificity. `p: 16` resolved to `padding: 1rem` through the space scale (literal value, no CSS variable). `bg: 'surface'` resolved to `background-color: var(--color-surface)` because colors always emit CSS custom properties for color mode switching.

## Going further

- [Base Styling](/docs/authoring/base-styling) -- `as` prop, className merging, dynamic styles, headless UI interop
- [Variants & States](/docs/authoring/variants-states) -- add prop-driven style variants and boolean state flags
- [Builder Chain reference](/docs/reference/builder-chain) -- the full API surface from `.styles()` through `.asElement()`

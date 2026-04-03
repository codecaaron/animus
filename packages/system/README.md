# @animus-ui/system

Design system builder for React. Type-driven CSS-in-JS with zero runtime — styles extract to static CSS at build time.

## Install

```bash
npm install @animus-ui/system
```

Pair with a bundler plugin for extraction:
- [`@animus-ui/vite-plugin`](https://github.com/codecaaron/animus/tree/main/packages/vite-plugin) for Vite
- [`@animus-ui/next-plugin`](https://github.com/codecaaron/animus/tree/main/packages/next-plugin) for Next.js

## Quick Start

### 1. Define tokens

```tsx
import { createTheme } from '@animus-ui/system';

const tokens = createTheme()
  .addBreakpoints({ sm: 480, md: 768, lg: 1024 })
  .addColors({
    gray: { 100: '#f0f0f0', 800: '#1a1a1a' },
    blue: { 400: '#3d94ff', 700: '#003d99' },
  })
  .addColorModes('dark', {
    dark: { primary: 'blue.400', bg: 'gray.800', text: 'gray.100' },
    light: { primary: 'blue.700', bg: 'gray.100', text: 'gray.800' },
  })
  .addScale({ name: 'space', values: { sm: '0.5rem', md: '1rem', lg: '1.5rem' } })
  .build();

declare module '@animus-ui/system' {
  interface Theme extends typeof tokens {}
}
```

### 2. Create system with prop groups

Pre-built groups ship with the package. Compose them into your own semantic groups:

```tsx
import { createSystem } from '@animus-ui/system';
import { space, color, typography, border, shadows, background, flex, layout } from '@animus-ui/system/groups';

export const { system: ds, createGlobalStyles } = createSystem()
  .addGroup('surface', { ...color, ...border, ...shadows, ...background })
  .addGroup('space', space)
  .addGroup('text', typography)
  .addGroup('arrange', { ...flex, ...layout })
  .build();
```

Each group becomes an opt-in set of props that components can enable via `.system()`:

```tsx
const Box = ds.styles({}).system({ surface: true, space: true }).asElement('div');

// Box now accepts: color, bg, border, shadow, p, m, gap, etc.
<Box bg="surface" p="md" borderBottom="1" />
```

### 3. Build components

```tsx
const Button = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    cursor: 'pointer',
    border: 'none',
    borderRadius: 4,
    fontFamily: '{fonts.body}',
  })
  .variant({
    size: {
      prop: 'size',
      variants: {
        small: { fontSize: 14, padding: '{space.sm}' },
        large: { fontSize: 18, padding: '{space.md} {space.lg}' },
      },
    },
    intent: {
      prop: 'intent',
      variants: {
        primary: { backgroundColor: '{colors.primary}', color: 'white' },
        ghost: { backgroundColor: 'transparent', color: '{colors.primary}' },
      },
    },
  })
  .states({
    disabled: { opacity: 0.5, pointerEvents: 'none' },
  })
  .system({ space: true })
  .asElement('button');

<Button size="large" intent="primary" m={8} disabled />;
```

## Builder Chain

The chain enforces cascade ordering — each method maps to a CSS `@layer`:

```
ds.styles()    → @layer base
  .variant()   → @layer variants
  .compound()  → @layer compounds
  .states()    → @layer states
  .system()    → @layer system
  .props()     → @layer custom
  .asElement() → typed React component
```

The type system prevents calling methods out of order. `.variant()` after `.states()` is a type error.

## Exports

| Path | What's in it |
|------|-------------|
| `@animus-ui/system` | Full API — builder, theme, runtime, types |
| `@animus-ui/system/groups` | Pre-built prop groups: `space`, `color`, `typography`, `layout`, `flex`, `grid`, `border`, `shadows`, `background`, `positioning`, `transitions` |

## License

MIT

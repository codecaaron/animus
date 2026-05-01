# Animus

Type-driven CSS-in-JS with static extraction. Zero runtime.

## What It Is

A design system builder where the TypeScript types ARE the product. Define components with a builder chain that enforces cascade ordering — the types guarantee that every legal component produces valid, extractable CSS at build time.

No Emotion. No styled-components. No runtime style injection. The builder chain compiles to static CSS via `@layer`, extracted by a Rust pipeline.

```tsx
import { ds } from './ds';

const Card = ds
  .styles({
    padding: '{space.md}',
    borderRadius: 8,
    backgroundColor: '{colors.surface}',
  })
  .variant({
    elevation: {
      prop: 'elevation',
      variants: {
        flat: { boxShadow: 'none' },
        raised: { boxShadow: '{shadows.sm}' },
        floating: { boxShadow: '{shadows.lg}' },
      },
    },
  })
  .states({
    disabled: { opacity: 0.5, pointerEvents: 'none' },
  })
  .system({ surface: true, space: true })
  .asElement('div');

// Fully typed — elevation, disabled, + all surface and space props
<Card elevation="raised" p={16} bg="surface.hover" disabled />;
```

## Install

```bash
# The design system builder
npm install @animus-ui/system

# Pick your bundler plugin
npm install @animus-ui/vite-plugin   # Vite
npm install @animus-ui/next-plugin   # Next.js
```

## Setup

Two files define your design system:

**`theme.ts`** — define your tokens:

```tsx
import { createTheme } from '@animus-ui/system';

export const tokens = createTheme()
  .addBreakpoints({ sm: 480, md: 768, lg: 1024 })
  .addColors({
    gray: { 50: '#fafafa', 500: '#555', 900: '#080808' },
    blue: { 400: '#3d94ff', 700: '#003d99' },
  })
  .addColorModes('dark', {
    dark: {
      primary: 'blue.400',
      bg: 'gray.900',
      text: 'gray.50',
    },
    light: {
      primary: 'blue.700',
      bg: 'gray.50',
      text: 'gray.900',
    },
  })
  .addScale({ name: 'space', values: { sm: '0.5rem', md: '1rem', lg: '1.5rem' } })
  .build();

// Type augmentation — token names autocomplete everywhere
declare module '@animus-ui/system' {
  interface Theme extends typeof tokens {}
}
```

**`ds.ts`** — configure your system:

```tsx
import { createSystem } from '@animus-ui/system';
import {
  space,
  color,
  typography,
  layout,
  flex,
  border,
  shadows,
  background,
} from '@animus-ui/system/groups';

// Pre-built groups compose into your own semantic groups
export const { system: ds, createGlobalStyles } = createSystem()
  .addGroup('surface', { ...color, ...border, ...shadows, ...background })
  .addGroup('space', space)
  .addGroup('text', typography)
  .addGroup('arrange', { ...flex, ...layout })
  .build();
```

**`vite.config.ts`**:

```tsx
import react from '@vitejs/plugin-react';
import { animusExtract } from '@animus-ui/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), animusExtract({ system: './src/ds.ts' })],
});
```

## The Builder Chain

Each method maps to a CSS `@layer`. The type system enforces the ordering.

```
ds.styles()    → @layer base       always-on styles
  .variant()   → @layer variants   prop-driven variations
  .compound()  → @layer compounds  variant combinations
  .states()    → @layer states     boolean interaction states
  .system()    → @layer system     opt into prop groups (space, color, etc.)
  .props()     → @layer custom     component-scoped dynamic props
  .asElement() →                   seal as typed React component
```

## Packages

| Package                                          | Purpose                                                  |
| ------------------------------------------------ | -------------------------------------------------------- |
| [`@animus-ui/system`](packages/system)           | Builder chain, theme, types, runtime                     |
| [`@animus-ui/vite-plugin`](packages/vite-plugin) | Static CSS extraction for Vite                           |
| [`@animus-ui/next-plugin`](packages/next-plugin) | Static CSS extraction for Next.js                        |
| [`@animus-ui/extract`](packages/extract)         | Rust/NAPI extraction engine (used internally by plugins) |
| [`@animus-ui/properties`](packages/properties)   | CSS property data (transitive dep of system)             |

## Key Ideas

- **Compiler completeness**: If the types accept it, the pipeline extracts it. No silent failures for well-typed code.
- **Token refs**: `'{colors.primary}'` resolves to `var(--color-primary)` at build time. Color modes shift the value automatically.
- **Pre-built groups**: Import `space`, `color`, `typography`, etc. from `@animus-ui/system/groups` and compose them into your own semantic groups.
- **Slot composition**: `compose()` wires components into families with shared variant propagation via React context.
- **Terminals**: `.asElement('div')` for HTML elements, `.asComponent(Existing)` for wrapping React components. Both produce typed, extractable output.

## Legacy

`@animus-ui/core` and `@animus-ui/theming` are the original Emotion-based packages. They are pinned at their last published versions and no longer actively developed.

## License

MIT

Prerequisites: React 18+, Vite 5+. `bun` is recommended as the package manager.

## Step 1 — Install

Add both packages. `@animus-ui/system` is the builder chain your components use at authoring time. `@animus-ui/vite-plugin` runs the static extraction at build time and dev startup.

```sh
 bun add @animus-ui/system @animus-ui/vite-plugin
```

## Step 2 — Configure Vite

Register the plugin and point `system` at your design system file. The plugin reads that file at build time to evaluate your token definitions and extract all component styles.

```typescript
import { animusExtract } from '@animus-ui/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), animusExtract({ system: './src/ds.ts' })],
});
```

## Step 3 — Create your design system

Create `src/ds.ts`. This file is the single source of truth: it defines your breakpoints, token scales, color modes, and the prop groups available on every component. The `declare module` augmentation makes the builder chain fully type-safe — your IDE knows every valid token at every prop.

```typescript
import { createSystem, createTheme } from '@animus-ui/system';
import { color, space, typography, flex, border } from '@animus-ui/system/groups';

export const tokens = createTheme({
  breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
})
  .addScale('space', () => ({
    0: '0',
    4: '0.25rem',
    8: '0.5rem',
    16: '1rem',
    24: '1.5rem',
    32: '2rem',
  }))
  .addScale('fontSizes', () => ({
    12: '0.75rem',
    14: '0.875rem',
    16: '1rem',
    18: '1.125rem',
    24: '1.5rem',
  }))
  .addColors({
    void: '#000000',
    coal: '#111111',
    ash: '#2a2a2a',
    smoke: '#555555',
    bone: '#E8E0D0',
    ember: '#FF2800',
    spark: '#FFB627',
  })
  .addColorModes('dark', {
    dark: {
      primary: 'ember',
      background: 'void',
      surface: 'coal',
      text: 'bone',
      textMuted: 'smoke',
      border: 'ash',
    },
    light: {
      primary: 'ember',
      background: 'bone',
      surface: 'ash',
      text: 'coal',
      textMuted: 'smoke',
      border: 'ash',
    },
  })
  .build();

export type MyTheme = typeof tokens;

declare module '@animus-ui/system' {
  interface Theme extends MyTheme {}
}

export const ds = createSystem()
  .withProperties((p) =>
    p
      .addGroup('surface', { ...color, ...border })
      .addGroup('arrange', { ...flex })
      .addGroup('text', { ...typography })
      .addGroup('space', space)
      .build()
  )
  .build();
```

## Step 4 — Import the virtual stylesheet

Add one import to `src/main.tsx`. The virtual module `virtual:animus/styles.css` is resolved by the Vite plugin and contains all CSS extracted from your component definitions. Nothing is shipped to the browser at runtime.

```typescript
import 'virtual:animus/styles.css';
```

## Step 5 — Build your first component

Call `ds.styles()` to define base styles, chain `.variant()` to add prop-driven variants, opt into prop groups with `.groups()`, then seal with `.asElement()` to produce a typed React component. The extraction pipeline reads this file statically — all style values must be string or number literals.

```typescript
import { ds } from './ds';

const Button = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    px: 16,
    py: 8,
    bg: 'primary',
    color: 'background',
    fontFamily: 'body',
    fontSize: 14,
    fontWeight: '500',
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
  .groups({ space: true, surface: true })
  .asElement('button');
```

```tsx
<Button size="sm">Click me</Button>
```

Note: `px: 16` resolves to the `16` key in your space scale (`1rem`), not 16 pixels. Numeric values that match a prop group's scale are token references.

## Step 6 — Build and verify

Run the build. The plugin extracts every component style into layered CSS at compile time. The output bundle will contain only CSS for your components — no JavaScript styling runtime.

```sh
bun run build
```

Inspect `dist/assets/*.css`. You will find base styles in `@layer base` and variant overrides in `@layer variants`. Every layer is explicit — no specificity surprises.

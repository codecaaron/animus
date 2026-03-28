# Design Tokens

Tokens are defined with `createTheme(base)` and organised into scales. Every token becomes a CSS custom property on `:root`. When you write `bg: 'primary'` in a style block, the Rust extractor resolves it to `var(--color-primary)` at build time — no runtime token lookup.

The builder chain is: `createTheme(base)` → `.addScale(key, factory)` → `.addColors(colors)` → `.addColorModes(initialMode, modes)` → `.build()`. The `initialMode` argument to `addColorModes` determines which mode resolves into `:root`. Every other mode gets a `[data-color-mode="mode"]` selector. Components that reference token values adapt automatically — no conditional rendering required.

```tsx
import { createTheme } from '@animus-ui/system';

export const tokens = createTheme({
  colors: {
    primary:    '#e05c2a',
    background: '#0d0d0d',
    text:       '#f0ece4',
    textMuted:  '#6b6660',
    ember:      '#a83216',
    ash:        '#2a2826',
    coal:       '#1a1816',
  },
})
  .addScale('space', (n: number) => `${n * 4}px`)
  .addScale('fontSizes', (n: number) => `${n}px`)
  .addColorModes('dark', {
    dark:  { background: '#0d0d0d', surface: '#181818', text: '#f0ece4' },
    light: { background: '#f5f0e8', surface: '#ece8df', text: '#1a1714' },
  })
  .build();
```

```css
/* Base tokens — always on :root */
:root {
  --color-primary:    #e05c2a;
  --color-background: #0d0d0d;
  --color-text:       #f0ece4;
  --color-text-muted: #6b6660;
  --color-ember:      #a83216;
  --color-ash:        #2a2826;
  --color-coal:       #1a1816;
}

/* initialMode="dark" → resolves into :root */
:root {
  --color-surface: #181818;
}

/* Other modes → [data-color-mode] selector */
[data-color-mode="light"] {
  --color-background: #f5f0e8;
  --color-surface:    #ece8df;
  --color-text:       #1a1714;
}
```

### Token aliasing

The `{colors.x/N}` syntax creates an alpha-modified reference to any color token. `N` is a percentage from 0 to 100. The extractor resolves this to a `color-mix(in srgb, var(--color-x) N%, transparent)` call at build time — the browser never sees the alias syntax.

```tsx
export const Overlay = ds
  .styles({
    // {colors.primary/40} → primary color at 40% opacity
    bg: '{colors.primary/40}',
    backdropFilter: 'blur(8px)',
    border: '1px solid',
    // {colors.ember/20} → ember at 20% opacity
    borderColor: '{colors.ember/20}',
  })
  .asElement('div');
```

```css
@layer base {
  .animus-Overlay-x9y0z1 {
    background: color-mix(in srgb, var(--color-primary) 40%, transparent);
    backdrop-filter: blur(8px);
    border: 1px solid;
    border-color: color-mix(in srgb, var(--color-ember) 20%, transparent);
  }
}
```

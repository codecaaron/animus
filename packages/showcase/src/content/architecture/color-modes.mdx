# Color Modes

## Defining modes

```typescript
const tokens = createTheme()
  .addColors({
    gray: { 100: '#f0f0f0', 500: '#555555', 900: '#080808' },
    blue: { 400: '#3d94ff', 600: '#0055cc' },
  })
  .addColorModes('dark', {
    dark: {
      primary: 'blue.400',
      bg: 'gray.900',
      text: 'gray.100',
    },
    light: {
      primary: 'blue.600',
      bg: 'gray.100',
      text: 'gray.900',
    },
  })
  .build();
```

The first argument to `.addColorModes()` is the initial mode. The second maps mode names to alias objects. Each alias points to a color in your palette using dot-path references.

Aliases become semantic color names you use directly in props: `bg: 'primary'`, `color: 'text'`. Their values change per mode via CSS custom properties.

Nested aliases are supported:

```typescript
.addColorModes('dark', {
  dark: {
    bg: { _: 'gray.900', muted: 'gray.800' },
    text: { _: 'gray.100', muted: 'gray.500' },
  },
  light: {
    bg: { _: 'gray.100', muted: 'gray.200' },
    text: { _: 'gray.900', muted: 'gray.500' },
  },
})
```

The `_` key is the base value. This gives you `bg: 'bg'` and `bg: 'bg.muted'` as usable color names.

## Switching modes at runtime

Color modes are toggled by setting the `data-color-mode` attribute on a root element. Animus has no built-in provider or hook -- it's a single DOM attribute:

```tsx
function ColorModeToggle() {
  const [mode, setMode] = useState('dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-color-mode', mode);
  }, [mode]);

  return (
    <button onClick={() => setMode(m => m === 'dark' ? 'light' : m)}>
      {mode}
    </button>
  );
}
```

Any element with `data-color-mode` creates a scope -- its descendants resolve color aliases against that mode's values. You can scope a mode to a subtree:

```tsx
<div data-color-mode="dark">
  {/* Dark-themed content */}
  <Card bg="surface">Always dark.</Card>
</div>
```

## Avoiding flash on SSR

In server-rendered apps, `useEffect` runs after paint -- the page renders without `data-color-mode`, then flashes when the effect fires. Prevent this with a blocking script in your HTML `<head>`:

```html
<script>
  const mode = localStorage.getItem('animus-color-mode') || 'dark';
  document.documentElement.setAttribute('data-color-mode', mode);
</script>
```

This runs before the browser paints, so the correct mode is applied from the first frame.

## What the CSS looks like

Color mode overrides:

```css
[data-color-mode="light"] {
  --color-primary: #0055cc;
  --color-bg: #f0f0f0;
  --color-text: #080808;
}
```

Each mode produces a `[data-color-mode]` selector block that overrides the `:root` color variables.

## Going further

- [Theming & Tokens](/docs/architecture/theming) -- palettes, scales, breakpoints, and token references
- [createTheme() reference](/docs/reference/create-theme) -- full ThemeBuilder API including `.addColorModes()`

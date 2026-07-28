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
import {
  space,
  color,
  typography,
  border,
  shadows,
  background,
  flex,
  layout,
} from '@animus-ui/system/groups';

export const { system: ds, createGlobalStyles } = createSystem()
  .addGroup('surface', { ...color, ...border, ...shadows, ...background })
  .addGroup('space', space)
  .addGroup('text', typography)
  .addGroup('arrange', { ...flex, ...layout })
  .build();
```

Each group becomes an opt-in set of props that components can enable via `.system()`:

```tsx
const Box = ds
  .styles({})
  .system({ surface: true, space: true })
  .asElement('div');

// Box now accepts: color, bg, border, shadow, p, m, gap, etc.
<Box bg="surface" p="md" borderBottom="1" />;
```

### 3. Build components

```tsx
export const Alert = ds
  .styles({
    display: 'flex',
    alignItems: 'flex-start',
    p: 12,
    borderRadius: '4px',
    fontSize: 14,
    lineHeight: '1.5',
  })
  .variant({
    prop: 'variant',
    variants: {
      filled: { color: 'background' },
      outline: { bg: 'transparent', borderWidth: '1px', borderStyle: 'solid' },
    },
  })
  .variant({
    prop: 'intent',
    variants: {
      info: { bg: 'primary' },
      danger: { bg: 'danger' },
      success: { bg: 'secondary' },
    },
  })
  .compound(
    { variant: 'outline', intent: 'info' },
    { borderColor: 'primary', color: 'primary' }
  )
  .compound(
    { variant: 'outline', intent: 'danger' },
    { borderColor: 'danger', color: 'danger' }
  )
  .compound(
    { variant: 'outline', intent: 'success' },
    { borderColor: 'secondary', color: 'secondary' }
  )
  .surface({ space: true })
  .asElement('div');

<Alert variant="filled" intent="success" m={8} disabled />;
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

## Color Modes

`addColorModes(initialMode, modeConfig)` emits a `[data-color-mode="…"]` block
per mode. An optional third argument opts the theme into OS participation:

```tsx
const tokens = createTheme()
  .addColors({ gray: { 100: '#f0f0f0', 800: '#1a1a1a' } })
  .addColorModes(
    'dark',
    {
      dark: { bg: 'gray.800', text: 'gray.100' },
      light: { bg: 'gray.100', text: 'gray.800' },
    },
    {
      // OS preference → declared mode name.
      systemPreference: { light: 'light', dark: 'dark' },
      // CSS `color-scheme` per mode — TOTAL across declared modes.
      browserColorScheme: { dark: 'dark', light: 'light' },
    }
  )
  .build();
```

**`systemPreference`** enables guarded fallback emission:

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-color-mode]) {
    /* the dark mode's declarations */
  }
}
```

The `:not([data-color-mode])` guard is what makes an explicit attribute win — in
CSS alone, with no script. Both values must name declared modes.

**`browserColorScheme`** adds the CSS `color-scheme` property so native
scrollbars, form controls, and UA styling track the active mode. When supplied it
must classify _every_ declared mode, otherwise a mode would silently inherit the
previous one's native scheme.

A theme that opts into neither emits exactly the bytes it emitted before.

### "System" is the absence of the attribute

There is no `data-color-mode="system"` — the OS-following state is the attribute
being **absent**, which is the only value the media guard above can fall through.
`system` is a reserved mode name and is rejected.

### The appearance record

Persisted appearance lives under one versioned key, `animus:appearance`:

```
{ "v": 1, "mode": "system" | "<mode name>", "theme": "default" }
```

The `theme` axis is reserved and currently ignored — a writer that owns only the
mode axis must preserve the fields it does not own. Writing the record is
application-owned; the package neither observes nor persists.

To restore it before first paint, generate an inline snippet from the **built**
theme:

```ts
import { createAppearanceBootstrap } from '@animus-ui/system/bootstrap';

const { code, cspHash } = createAppearanceBootstrap(tokens, {
  storageKey: 'animus:appearance', // default
});
```

`code` is a dependency-free IIFE for the document head: it reads the record,
validates `mode` against the theme's declared names, sets `data-color-mode` for a
valid explicit mode, and **removes** the attribute for `"system"`, a missing
record, or an unrecognized value — handing control back to the media query. It
never writes storage and never calls `matchMedia` (materializing the OS answer
into the attribute would freeze it against later OS changes). The pre-record
plain-string `color-mode` key is read once, only when the record is absent, and
is never written.

`cspHash` authorizes that exact script. Derive the header from the artifact at
build time and **single-quote** the value — `script-src 'sha256-…'`. Unquoted it
parses as a host source and silently blocks the script; hand-copied, it goes
stale the moment a mode is renamed.

This subpath is build tooling. It is never imported by the component or runtime
entries, so it cannot reach an extracted application bundle — generate the
artifact in your bundler config and hand it to the plugin
([`@animus-ui/vite-plugin`](https://github.com/codecaaron/animus/tree/main/packages/vite-plugin)
accepts `appearanceBootstrap`; in Next.js the application places `code` itself,
so it can control CSP nonce and ordering).

## Exports

| Path                          | What's in it                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@animus-ui/system`           | Full API — builder, theme, runtime, types                                                                                                        |
| `@animus-ui/system/groups`    | Pre-built prop groups: `space`, `color`, `typography`, `layout`, `flex`, `grid`, `border`, `shadows`, `background`, `positioning`, `transitions` |
| `@animus-ui/system/bootstrap` | `createAppearanceBootstrap` — build-time only, never imported by application code                                                                |

## License

MIT

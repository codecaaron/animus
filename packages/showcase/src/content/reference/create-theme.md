# createTheme()

Builds a theme with colors, scales, breakpoints, and color modes. Called once per application, typically in `ds.ts`. Returns a `BuiltTheme` object with a `serialize()` method used by the extraction pipeline.

## Methods

### `.addBreakpoints(config)`

```typescript
.addBreakpoints(config: Record<string, number>)
```

Defines named breakpoints for responsive values. Values are pixel widths, producing `@media (min-width: Npx)` queries.

```typescript
.addBreakpoints({ sm: 640, md: 768, lg: 1024, xl: 1440 })
```

### `.addColors(colors)`

```typescript
.addColors(colors: Record<string, string | Record<string, string>>)
```

Adds colors to the theme. Colors always emit CSS custom properties -- `'{colors.primary}'` becomes `var(--color-primary)`. Supports flat and nested structures:

```typescript
.addColors({
  primary: '#3b82f6',
  gray: { 100: '#f0f0f0', 500: '#555555', 900: '#080808' },
})
```

Nested colors flatten to dot-path token refs: `'{colors.gray.100}'` becomes `var(--color-gray-100)`.

### `.addColorModes(initialMode, config)`

```typescript
.addColorModes(initialMode: string, config: Record<string, Record<string, unknown>>)
```

Defines color modes with semantic aliases that map to palette colors. Must be called after `.addColors()`.

```typescript
.addColorModes('dark', {
  dark: {
    primary: 'blue.400',
    bg: { _: 'gray.900', muted: 'gray.800' },
    text: 'gray.100',
  },
  light: {
    primary: 'blue.600',
    bg: { _: 'gray.100', muted: 'gray.200' },
    text: 'gray.900',
  },
})
```

- The first argument is the initial (default) mode name.
- Alias values are dot-path references to colors in the palette.
- Nested aliases use `_` as the base key: `{ _: 'gray.900', muted: 'gray.800' }` creates both `bg` and `bg.muted` tokens.
- Aliases are validated -- referencing a color that doesn't exist in the palette throws at build time.

### `.addScale(config)`

```typescript
.addScale(config: {
  name: string;
  values: Record<string | number, string | number>;
  emit?: boolean;  // default: false
})
```

Adds a named scale to the theme.

```typescript
.addScale({
  name: 'space',
  values: { 4: '0.25rem', 8: '0.5rem', 16: '1rem', 24: '1.5rem', 32: '2rem' },
})
```

**`emit`**: When `true`, the scale's values are emitted as CSS custom properties (e.g., `'{sizes.navHeight}'` becomes `var(--sizes-navHeight)`). When `false` (default), values are inlined as literals at build time (e.g., `'{space.16}'` becomes `1rem`).

Colors always emit regardless of this setting.

### `.declareContextualVars(config)`

```typescript
.declareContextualVars(config: Partial<Record<keyof Theme, readonly string[]>>)
```

Declares contextual CSS variables that components can set for their subtrees.

```typescript
.declareContextualVars({
  colors: ['current-bg'],
})
```

This makes `'{colors.current-bg}'` available as a token reference. The variable isn't set globally -- components set it via inline styles, and descendants can reference it.

### `.extendScale(key, updateFn)`

```typescript
.extendScale(key: keyof Theme, updateFn: (tokens: ScaleValues) => Record<string, unknown>)
```

Extends an existing scale with additional values.

```typescript
.extendScale('space', (existing) => ({
  ...existing,
  128: '8rem',
}))
```

### `.from(builtTheme)`

```typescript
.from(builtTheme: BuiltTheme)
```

Imports an already-built theme's values into this builder. Used for extending a base theme from another package.

### `.build()`

```typescript
.build() → BuiltTheme
```

Finalizes the theme. The returned object includes:

- Scale values as properties (e.g., `tokens.space`, `tokens.colors`)
- `serialize()` method returning `{ scalesJson, variableMapJson, variableCss, contextualVarsJson }`
- `manifest` with `tokenMap`, `variableMap`, and mode data

## Type augmentation

To connect your theme to the builder chain's type system:

```typescript
type MyTheme = typeof tokens;
declare module '@animus-ui/system' {
  interface Theme extends MyTheme {}
}
```

This enables type-checked token references in `.styles()`, `.variant()`, and all other CSS object positions.

## Full example

```typescript
import { createTheme } from '@animus-ui/system';

export const tokens = createTheme()
  .addBreakpoints({ sm: 640, md: 768, lg: 1024 })
  .addColors({
    gray: { 100: '#f0f0f0', 500: '#555555', 900: '#080808' },
    blue: { 400: '#3d94ff', 600: '#0055cc' },
  })
  .addColorModes('dark', {
    dark: { primary: 'blue.400', bg: 'gray.900', text: 'gray.100' },
    light: { primary: 'blue.600', bg: 'gray.100', text: 'gray.900' },
  })
  .addScale({
    name: 'space',
    values: { 4: '0.25rem', 8: '0.5rem', 16: '1rem', 24: '1.5rem', 32: '2rem' },
  })
  .addScale({
    name: 'sizes',
    emit: true,
    values: { navHeight: '48px', sidebarWidth: '200px' },
  })
  .declareContextualVars({ colors: ['current-bg'] })
  .build();
```

## createTheme()

`createTheme<T extends AbstractTheme>(base: T): ThemeBuilder<T>`

Initializes a typed theme builder from a base object. Typically only `breakpoints` is required at the top level — all other scales are added via chain methods. Call `.build()` to seal the builder; the result attaches a `.manifest` for the plugin.

### Chain Methods

| Method | Description |
|--------|-------------|
| `.addScale(key, createScale)` | Registers a named token scale. The factory receives the current theme and returns a value map. |
| `.addColors(colors)` | Registers a color palette. Generates `--color-{key}` CSS custom properties. Validates CSS color values. |
| `.addColorModes(initialMode, modeConfig)` | Adds color-mode variants. The initial mode is emitted on `:root`; all others on `[data-color-mode]`. |
| `.createScaleVariables(key)` | Converts a registered scale to CSS custom properties. |
| `.updateScale(key, updateFn)` | Receives the current scale values and returns new ones to merge in. Non-destructive update. |
| `.build()` | Returns the finalized theme. Attaches `.manifest` for the plugin. |

### Module Augmentation

After calling `.build()`, augment the `Theme` interface so every builder chain method receives your token types automatically.

```typescript
import { createTheme } from '@animus-ui/system';

const theme = createTheme({ breakpoints: ['sm', 'md', 'lg'] })
  .addScale('space', () => ({ 0: '0px', 4: '4px', 8: '8px', 16: '16px' }))
  .addColors({ text: '#f0ede8', bg: '#141210' })
  .addColorModes('dark', {
    dark:  { text: '#f0ede8', bg: '#141210' },
    light: { text: '#1a1714', bg: '#f5f2ed' },
  })
  .build();

export type MyTheme = typeof theme;

declare module '@animus-ui/system' {
  interface Theme extends MyTheme {}
}
```

## createSystem()

`createSystem(): SystemBuilder`

Creates a design system instance. The builder is evaluated once in a subprocess at build time — zero runtime cost. Returns a `SystemInstance` containing the `Animus` builder and a `serialize()` function.

### SystemBuilder Chain

| Method | Signature | Description |
|--------|-----------|-------------|
| `.withProperties(cb)` | `(cb: (PropertyBuilder) => { propRegistry, groupRegistry })` | Registers the property groups available on every component. `cb` receives a `PropertyBuilder` and must return `{ propRegistry, groupRegistry }`. |
| `.withGlobalStyles(styles)` | `({ reset?: Record<selector, css>, global?: Record<selector, css> })` | Injects global CSS. `reset` and `global` are both selector-to-CSS maps. |
| `.build()` | — | Returns a `SystemInstance` — the `Animus` builder object plus `serialize()`. |

### PropertyBuilder

| Method | Description |
|--------|-------------|
| `.addGroup(name, config)` | Registers a named group of style props. Groups are enabled per-component via `.groups()`. |
| `.build()` | Returns `{ propRegistry, groupRegistry }` to the system. |

```typescript
import { createSystem } from '@animus-ui/system';
import { space, color, typography, flex } from '@animus-ui/system/groups';

export const ds = createSystem()
  .withProperties((props) =>
    props
      .addGroup('space', space)
      .addGroup('text', typography)
      .addGroup('arrange', { ...flex })
      .addGroup('surface', { ...color })
      .build()
  )
  .withGlobalStyles({
    reset: { '*': { boxSizing: 'border-box' } },
    global: { 'html, body': { margin: 0, padding: 0 } },
  })
  .build();
```

## Builder Chain

Every component is built by chaining methods on the `Animus` builder returned from `createSystem().build()`. Each style method maps to a CSS `@layer`, giving deterministic cascade order regardless of import sequence.

| Method | Layer | Description |
|--------|-------|-------------|
| `.styles(config)` | `@layer base` | Static base styles. Token values are accepted inline. |
| `.variant({ prop?, defaultVariant?, base?, variants })` | `@layer variants` | Maps a prop to a set of style variants. `prop` defaults to `'variant'`. Each key in `variants` becomes a valid prop value. |
| `.compound(condition, styles)` | `@layer compounds` | Two arguments. `condition` is `Record<string, value \| value[]>`. Applies styles when all conditions are simultaneously met. Condition values may be arrays to match any of several values. |
| `.states(config)` | `@layer states` | `Record<name, CSS>`. Pseudo-class and attribute states (e.g. `hover`, `focus`, `disabled`). |
| `.groups(config)` | `@layer system` | `Record<name, true>`. Opts the component into registered prop groups, exposing their props at the JSX call site. |
| `.props(config)` | `@layer custom` | `Record<name, { property, scale?, transform?, negative?, variable? }>`. Defines runtime CSS custom properties set via inline style. |
| `.asElement(tag)` | — | Seals the chain. Returns a typed React component backed by the given HTML element tag. Exposes `.extend()`. |
| `.asComponent(Component)` | — | Seals the chain. Wraps an existing React component, merging extracted styles with its own props. Does NOT activate group props. Exposes `.extend()`. |
| `.asClass()` | — | Seals the chain. Returns a `(props?) => string` class resolver instead of a React component. |
| `.build()` | — | Seals the chain. Returns a parser function with an `.extend()` method. |
| `.extend()` | — | Opens a new builder chain from a sealed component as `AnimusExtended`. Merges styles, groups, and props via `deepMerge`. |

### Example

```typescript
const Button = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    px: 16,
    py: 8,
    borderRadius: '4px',
    fontFamily: 'mono',
    cursor: 'pointer',
  })
  .variant({
    prop: 'intent',
    defaultVariant: 'primary',
    variants: {
      primary:   { bg: 'primary',   color: 'coal' },
      secondary: { bg: 'secondary', color: 'coal' },
      ghost:     { bg: 'transparent', color: 'text', border: '1px solid' },
    },
  })
  .compound({ intent: 'ghost' }, { letterSpacing: '0.05em' })
  .compound({ intent: ['primary', 'secondary'] }, { fontWeight: 'bold' })
  .states({ hover: { opacity: 0.85 }, disabled: { cursor: 'not-allowed' } })
  .groups({ space: true })
  .asElement('button');
```

## createTransform()

`createTransform(name: string, fn: TransformFn): NamedTransform`

Registers a named value transform applied during extraction. The function runs in the subprocess and the result is written as a static CSS value.

| Type | Definition |
|------|------------|
| `TransformFn` | `(value: string \| number, property?: string, props?: AbstractProps) => string \| number \| CSSObject` |

```typescript
import { createTransform } from '@animus-ui/system';

// Usage: fontSize: fluid(16) → clamp(16px, 1.5vw, 24px)
export const fluid = createTransform('fluid', (value) => {
  const min = Number(value);
  const max = Math.round(min * 1.5);
  return `clamp(${min}px, ${(min / 16).toFixed(3)}vw * 10, ${max}px)`;
});

// Register it on a prop:
// props.addGroup('text', { fontSize: { property: 'fontSize', transform: fluid } })
```

## Prop Groups

`@animus-ui/system/groups` exports 13 pre-built property group definitions. These are plain objects you compose freely inside `.addGroup()`. Each key in a group object is a prop name; its value describes the CSS property, optional token scale, and optional transform.

| Export | Props | Covers |
|--------|-------|--------|
| `color` | 12 | color, background-color, opacity, fill, stroke and variants |
| `border` | 23+ | border, border-radius, border-color, border-style, outline and shorthands |
| `flex` | 16+ | flex, flex-direction, align-items, justify-content, flex-wrap, order, gap and shorthands |
| `grid` | 21+ | grid-template-columns/rows, grid-column/row, gap, place-items and shorthands |
| `background` | 6+ | background, background-image, background-size, background-position, background-repeat |
| `positioning` | 8 | position, top, right, bottom, left, z-index, inset |
| `shadows` | 3 | box-shadow, text-shadow, drop-shadow |
| `layout` | 20+ | width, height, min/max-width, min/max-height, overflow, display, aspect-ratio and shorthands |
| `typography` | 9+ | font-family, font-size, font-weight, line-height, letter-spacing, text-transform, text-align |
| `space` | 14 | margin, padding, gap shorthand props (m, p, mx, my, px, py, etc.) |
| `transitions` | 3 | transition, transition-property, transition-duration |
| `mode` | 1 | color-scheme / color-mode switching prop |
| `vars` | 1 | Arbitrary CSS custom property passthrough |

### Composing Groups

Spread multiple raw groups to create purpose-built supergroups.

```typescript
import { color, border, shadows, background } from '@animus-ui/system/groups';

props.addGroup('surface', {
  ...color,
  ...border,
  ...shadows,
  ...background,
})
```

## Vite Plugin

`animusExtract(options: AnimusExtractOptions): Plugin`

Import from `@animus-ui/vite-plugin` and add to your Vite config. The plugin statically evaluates the system module in a subprocess, extracts all component styles, and emits a single atomic CSS bundle — no runtime style injection.

```typescript
import { animusExtract } from '@animus-ui/vite-plugin';

export default defineConfig({
  plugins: [
    react(),
    animusExtract({ system: './src/ds.ts' }),
  ],
});
```

### Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `system` | `string` | Yes | Path to the module exporting your system instance. Resolved relative to the Vite project root. |
| `include` | `string[]` | No | Glob patterns for files to include in the transform pass. Defaults to all `.tsx` and `.ts` files in the project. |
| `exclude` | `string[]` | No | Glob patterns for files to exclude from the transform pass. |
| `packagePatterns` | `string[]` | No | Additional `node_modules` package glob patterns to include in the extraction transform. Useful for component library consumers. |
| `strict` | `boolean` | No | Throws a build error if any dynamic (non-static) style value is encountered. |
| `verbose` | `boolean` | No | Logs extraction diagnostics per file during build. Useful for debugging missing styles. |
| `targets` | `string[]` | No | Browser targets passed to Lightning CSS for transpilation during minification. |
| `minify` | `boolean` | No | Runs the output CSS through Lightning CSS for minification. Defaults to `true` in production builds. |
| `prefix` | `string` | No | Class name prefix applied to all generated classes. Defaults to `animus`. |
| `layers` | `string[]` | No | Override the default ordered `@layer` declaration list emitted at the top of the CSS output. |

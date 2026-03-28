# createTheme()

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

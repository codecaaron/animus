# Animus Theming Package

## Key Files

- `src/utils/createTheme.ts` — ThemeBuilder fluent API
- `src/utils/serializeTokens.ts` — Token→CSS variable generation
- `src/utils/flattenScale.ts` — Nested object flattening with `-` separator

## Theme Flow

```
createTheme(base)
  .addColors({...})           → flat colors + CSS vars
  .addColorModes('dark', {})  → semantic aliases per mode
  .addScale('shadows', fn)    → custom scales (can reference colors)
  .createScaleVariables(key)  → convert scale to CSS vars
  .build()                    → final theme object
```

## Theme Object Structure

- **Public scales** (`theme.colors.primary`): CSS var references (`var(--color-primary)`)
- **Private variables** (`theme._variables`): CSS var definitions for DOM injection
- **Private tokens** (`theme._tokens`): Original values

## Integration with Core

Props reference scales by name: `bg: { property: 'backgroundColor', scale: 'colors' }`. At runtime, `lookupScaleValue('primary', 'colors', theme)` resolves to `var(--color-primary)`.

# Theme Extension

When a design system library ships components with a reference theme, consuming applications need to extend it -- adding colors, scales, or overriding values while preserving the library's token vocabulary.

## Full extension with `.from()`

`createTheme().from(builtTheme)` deep merges a built theme into a fresh builder, preserving colors, scales, breakpoints, color modes, and contextual vars.

```typescript
import { createTheme } from '@animus-ui/system';
import { referenceTokens } from '@acme/design-system';

const tokens = createTheme()
  .from(referenceTokens)
  .addColors({ brand: { 500: '#cc5500', 700: '#993300' } })
  .addScale({
    name: 'fontSizes',
    values: { 14: '0.875rem', 16: '1rem', 24: '1.5rem' },
  })
  .build();
```

After `.from()`, the builder is back in its normal state -- chain `.addColors()`, `.addScale()`, `.addColorModes()`, or `.addBreakpoints()` to augment. Same-name scales merge (union of keys). Consumer values win on collision.

## Selective spread

If you only want part of a library theme, spread the properties you need:

```typescript
const tokens = createTheme()
  .addBreakpoints({ sm: 640, md: 768, lg: 1024 })
  .addColors({ ...referenceTokens.colors, brand: { 500: '#cc5500' } })
  .addScale({ name: 'space', values: referenceTokens.space })
  .build();
```

Built themes are plain objects with scales as enumerable properties. Non-enumerable methods (`serialize`, `manifest`, `varRef`) don't leak into spreads. This gives you explicit control over what you adopt.

## `.from()` vs `.includes()`

These serve different purposes:

| Method | Lives on | Purpose |
|--------|----------|---------|
| `.from(builtTheme)` | `ThemeBuilder` | Extend a library's **tokens** -- colors, scales, breakpoints, color modes |
| `.includes([ds])` | `SystemBuilder` | Register a library's **system** for component extraction discovery |

A consumer app typically uses both:

```typescript
// Theme extension -- tokens
const tokens = createTheme()
  .from(referenceTokens)
  .addColors({ brand: { 500: '#cc5500' } })
  .build();

// System setup -- component discovery
const { system: ds } = createSystem()
  .addGroup('surface', { ...color, ...border })
  .addGroup('space', space)
  .includes([libraryDs])
  .build();
```

`.from()` ensures the consumer's theme is a superset of the library's token vocabulary. `.includes()` tells the extraction plugin to discover and extract the library's components alongside the consumer's own.

## The token contract

Library components reference token paths like `bg: 'surface'` or `color: 'text.muted'`. These resolve to `var(--color-surface)` and `var(--color-text-muted)` in the extracted CSS. As long as the consumer's theme provides those same token paths (via `.from()`, selective spread, or manual definition), the library's components render correctly.

The library's `referenceTokens` export documents this contract -- it's the set of token paths the library's components depend on.

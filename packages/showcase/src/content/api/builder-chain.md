# Builder Chain

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

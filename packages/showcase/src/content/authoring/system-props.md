# System Props

## Enabling prop groups

```typescript
const Box = ds
  .styles({
    display: 'block',
  })
  .system({ space: true, surface: true })
  .asElement('div');
```

`.system()` enables named prop groups on a component. Each group name corresponds to a group registered with `createSystem().addGroup()`. The `space` group above exposes props like `p`, `px`, `m`, `mt`, etc. The `surface` group exposes `bg`, `color`, `borderColor`, etc.

```tsx
<Box p={16} bg='surface'>
  Content with spacing and color from the design system.
</Box>
```

## Available groups

Which groups are available depends on how your system was built. With the Getting Started boilerplate:

```typescript
createSystem()
  .addGroup('surface', { ...color, ...border })
  .addGroup('arrange', { ...flex })
  .addGroup('text', { ...typography })
  .addGroup('space', space)
  .build();
```

This gives you four group names to use with `.system()`:

| Group | Props | Example |
|-------|-------|---------|
| `space` | `p`, `px`, `py`, `m`, `mx`, `my`, `mt`, `mr`, `mb`, `ml` | `<Box p={16} mt={8} />` |
| `surface` | `bg`, `color`, `opacity`, `borderColor`, `borderWidth`, `borderStyle`, `borderRadius` | `<Box bg='primary' />` |
| `arrange` | `display`, `flexDirection`, `alignItems`, `justifyContent`, `gap` | `<Row alignItems='center' />` |
| `text` | `fontSize`, `fontWeight`, `lineHeight`, `fontFamily`, `textAlign` | `<Label fontSize={14} />` |

## Responsive values

Any system prop accepts a breakpoint object instead of a single value:

```tsx
<Box
  p={{ _: 8, sm: 16, lg: 32 }}
  display={{ _: 'block', md: 'flex' }}
>
  Responsive layout
</Box>
```

The `_` key is the default (no media query). Named keys match the breakpoints from your theme:

```typescript
createTheme()
  .addBreakpoints({ sm: 640, md: 768, lg: 1024 })
```

## What the CSS looks like

```css
@layer system {
  .animus-u-f4e8a1b2 {
    padding: 0.5rem;
  }

  @media (min-width: 640px) {
    .animus-u-f4e8a1b2 {
      padding: 1rem;
    }
  }

  @media (min-width: 1024px) {
    .animus-u-f4e8a1b2 {
      padding: 2rem;
    }
  }
}
```

System props produce utility classes in `@layer system`. Values resolve through the theme -- `p={16}` looks up `space.16` and resolves to `1rem`. The utility class is shared across all components that use the same prop-value pair.

## Combining with variants

System props work alongside variants and states. The cascade layers determine priority:

```typescript
const Card = ds
  .styles({
    p: 16,
    bg: 'surface',
  })
  .variant({
    prop: 'size',
    variants: {
      sm: { p: 8 },
      lg: { p: 32 },
    },
  })
  .system({ space: true, surface: true })
  .asElement('div');
```

```tsx
<Card size="sm" mt={16} bg='primary'>
  Size variant + system props
</Card>
```

System props live at `@layer system`, which is later than `@layer variants`. A system prop overrides a variant value for the same CSS property.

## Custom props with `.props()`

`.system()` enables shared groups defined at the system level. `.props()` defines one-off props scoped to a single component:

```typescript
const ProgressBar = ds
  .styles({
    height: '4px',
    bg: 'surface',
    borderRadius: '2px',
    '&::after': {
      content: '""',
      display: 'block',
      height: '100%',
      bg: 'primary',
      borderRadius: '2px',
      transition: 'width 200ms ease',
    },
  })
  .props({
    fill: {
      property: 'width',
      strict: false,
    },
  })
  .asElement('div');
```

```tsx
<ProgressBar fill="60%" />
```

Custom props emit to `@layer custom`, which sits above `@layer system` in the cascade. They work like system props (extracted at build time, produce utility classes) but aren't shared across components.

The `strict: false` option allows arbitrary string values alongside scale keys. Without it, only values from the bound scale are accepted.

## Going further

- [Theming & Tokens](/docs/architecture/theming) -- define the colors, scales, and breakpoints that system props resolve against
- [System Setup](/docs/architecture/system-setup) -- compose your own prop groups with `createSystem().addGroup()`

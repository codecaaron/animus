# Animus

An opinionated CSS in JS libary for building scalable component libraries.

- Multiple prop layers including `styles`, `varaint`, `states`, and `props` with consistent execution order.
- Completely customizable themes and props, without losing compatibility.
- Typescript first builder APIs to create robust, discoverable, and low maintenance components.
- Automatically serialize design tokens as CSS Variables, with built in color mode support.

### `createTheme`

```tsx
const theme = createTheme({
  breakpoint: {
    xs: 480,
    sm: 767,
    md: 1024,
    lg: 1200,
    xl: 1440,
  },
  font: {
    body: '"Open Sans", sans serif',
    heading: '"Raleway", seirf',
  },
  fontSize: [12, 14, 32, 44, 64],
})
  .addColors({
    black: '#000000',
    white: '#ffffff',
  })
  .addColorModes('light', {
    light: {
      text: 'black',
      background: 'white',
    },
    dark: {
      text: 'white',
      background: 'black',
    },
  })
  .build();
```

### `createAnimus`

```tsx
const animus = createAnimus()
  .addGroup('space', {
    m: { property: 'margin' },
    p: { property: 'padding' },
  })
  .build();
```

### `animus`

```tsx
const Box = animus
  .styles({ width: '100px', height: '100px' })
  .variant({
    prop: 'size',
    variants: {
      big: { width: '200px', height: '200px' },
    },
  })
  .states({
    hidden: {
      visibility: 'hidden',
    },
  })
  .groups({ space: true })
  .props({
    gap: {
      property: 'gap',
      scale: {
        md: 12,
        lg: 24,
      },
    },
  });
```

# Animus

A configuration driven toolkit for creating powerful and comprehensive component APIs.

- Multiple prop layers including `styles`, `varaint`, `states`, and `props` with consistent execution order.
- Completely customizable themes and props, without losing compatibility.
- Typescript first builder APIs to create robust, discoverable, and low maintenance components.
- Automatically serialize design tokens as CSS Variables, with built in color mode support.

```tsx
const FlexBox = animus
  .styles({ display: 'flex' })
  .states({
    inline: {
      display: 'inline-flex',
    },
  })
  .groups({
    space: true,
  })
  .props({
    gap: {
      property: 'gap',
      scale: {
        md: 12,
        lg: 24,
      },
    },
  })
  .asComponent('div');

// Strongly typed API
<FlexBox p="2rem" gap="md" inline />;
```

Animus is a configuration driven toolkit for creating articulate component languages and expressive UIs.

- **Prop Cascade**: Declarative component builder with structured specification and execution order.
- **Comprehensively Typed**: Animus is the foundation for exhaustively typing your entire design system
  as you configure it. The more specific you are the smarter it gets.
- **Modes and Themes**: Animus is built with CSS variable color modes support out of the box either through `@animus-ui/theming` or your own implementation.
- **Completely Customizable**: Customize props, themes, and patterns without losing interoperability.

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

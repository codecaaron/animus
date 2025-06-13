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
  .asElement('div');

// Strongly typed API
<FlexBox p="2rem" gap="md" inline />;
```

## Philosophy: Constraining Expression, Not Capability

Animus takes a unique approach to styling that's optimized for both human developers and AI agents. Instead of limiting what you can style, it structures *how* you express styling intent.

### The Core Principle

Traditional CSS-in-JS frameworks offer infinite ways to achieve the same result, leading to:
- Decision paralysis for developers
- Inconsistent codebases
- Ambiguity for AI code generation

Animus solves this by providing **one canonical path** with clear semantic stages:

```tsx
animus
  .styles({...})      // Foundation: What it always looks like
  .variant({...})     // Variations: How it changes by design choice
  .states({...})      // Interactions: How it responds to user input
  .props({...})       // Dynamics: What can be controlled at runtime
  .asElement('div')   // Output: The final component
```

### Why This Matters

**For Human Developers:**
- Reduced cognitive load - no need to decide how to structure styles
- Self-documenting components - intent is clear from the API usage
- Consistent codebase - everyone follows the same pattern

**For AI Agents:**
- Transforms infinite CSS possibilities into a finite state machine
- Each method declares intent, not just adds styles
- Type system guides to the next valid step
- Predictable patterns enable reliable code generation

### Full Power, Guided Expression

The constraints are **guardrails, not walls**:
- Any valid CSS can be written in `.styles()`
- The `extend()` method breaks ordering constraints when needed
- All Emotion features (css prop, runtime styles) remain available
- You're guided to best practices, not limited in capability

This philosophy represents a fundamental shift: APIs in the AI age should create a **shared language for intent** that both humans and machines can speak fluently.

[Read the full philosophy →](./PHILOSOPHY.md)

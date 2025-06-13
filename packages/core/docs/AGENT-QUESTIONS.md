# Agent Questions & Learning Needs

This document tracks what AI agents need to learn to effectively use Animus. These questions emerged from deep analysis of the framework.

## High Priority Questions

### 1. Responsive Design Pattern
- How do responsive arrays work? `<Box p={[8, 16, 24, 32]} />`
- What are the default breakpoints?
- Can I use object syntax? `{ xs: 8, md: 16 }`

### 2. Theming Integration
- How do design tokens work in styles?
- Can I reference theme values? `color: 'brand.primary'`
- How are theme values typed?
- Scale integration: `padding: 'space.md'`

### 3. Complex Selectors
- Where do these belong: `:nth-child`, `::before`, `:not()`?
- In `.styles()` or `.states()`?
- How to handle nested selectors?

### 4. Animation Patterns
- Where do animations/transitions belong in the cascade?
- Best practices for performance?
- Integration with state changes?

### 5. Complete Component Example
Need to see all features together:
- Base styles
- Variants
- States
- Responsive props
- Theme integration
- Custom props

### 6. Common UI Patterns
How to implement idiomatically:
- Modal with overlay
- Dropdown menu
- Form field with error states
- Toast notifications

## Medium Priority Questions

### 7. Compound Components
- Can I create `Card.Header`, `Card.Body` patterns?
- How does this work with the builder?
- Type inference for sub-components?

### 8. Global Styles
- How to handle CSS resets?
- App-wide styles?
- Font imports?

### 9. Performance Considerations
- Patterns to avoid?
- When does runtime overhead matter?
- Best practices for large apps?

### 10. Design System Integration
- How to integrate existing tokens?
- Migration from other systems?
- Maintaining consistency?

### 11. Migration Guide
- From Emotion/Styled Components
- Transformation patterns
- Common gotchas

## Why These Matter for AI Agents

Understanding these patterns will enable:
- **Correct code generation** first time
- **Idiomatic patterns** that match framework philosophy
- **Performance-aware** implementations
- **Real-world readiness** beyond toy examples

These questions represent the gap between theoretical understanding and practical mastery.
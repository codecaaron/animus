# CLAUDE.md - Animus Core Package

This file provides detailed guidance for working with the Animus core builder implementation.

## Quick Philosophy Reminder for AI Agents

**This is optimal for us because:**
- Method order = semantic intent (styles=base, variants=choices, states=interactions, props=dynamics)
- Constraints guide us to correct patterns, not limit capabilities
- `extend()` provides full flexibility when needed
- One canonical path eliminates ambiguity

**Key Insight**: We're not limited in WHAT we can style, only guided in HOW we express styling intent. This transforms CSS from an open-ended problem to a solvable pattern-matching exercise.

## Architecture Overview

The Animus builder implements a sophisticated type-safe fluent API pattern using TypeScript's class inheritance and type narrowing. The architecture enforces a specific method call order to mirror CSS cascade principles.

## Builder Chain Architecture

### Class Hierarchy
```
AnimusConfig → Animus → AnimusWithBase → AnimusWithVariants → AnimusWithStates → AnimusWithSystem → AnimusWithAll
```

Each class progressively narrows available methods:
- **AnimusConfig**: Entry point with `addGroup()` and `build()`
- **Animus**: Adds `styles()` method
- **AnimusWithBase**: Adds `variant()` method
- **AnimusWithVariants**: Adds `states()` and `variant()` methods
- **AnimusWithStates**: Adds `groups()` method
- **AnimusWithSystem**: Adds `props()` method
- **AnimusWithAll**: Terminal class with `asElement()`, `asComponent()`, `build()`, and `extend()`

### Method Chain Enforcement

The builder enforces this cascade order:
1. `.styles()` - Base styles (foundation layer)
2. `.variant()` - Variant-based styles (can be called multiple times)
3. `.states()` - Boolean state styles
4. `.groups()` - Enable prop groups
5. `.props()` - Custom props with scales
6. `.asElement()` or `.asComponent()` - Terminal methods

This order mirrors CSS cascade specificity where later rules override earlier ones.

### Extension Pattern

The `extend()` method is special - it returns an `AnimusExtended` instance that:
- Preserves all configuration from the parent
- Allows any builder method to be called in any order
- Merges configurations using lodash `merge()` to combine nested objects
- Maintains proper style execution order despite flexible API

## Key Components

### AnimusConfig (Entry Point)
Located in `AnimusConfig.ts`:
- Manages prop registry and group definitions
- `addGroup()`: Registers named groups of props
- `build()`: Creates the initial Animus instance

### Animus Classes (Builder Chain)
Located in `Animus.ts`:
- Each class extends the previous, adding specific methods
- Uses TypeScript generics to track configuration state
- Methods return new instances of the next class in chain

### AnimusExtended (Extension Handler)
Located in `AnimusExtended.ts`:
- Handles component extension with full method access
- Merges parent and child configurations
- Preserves cascade order during style execution

### Style Processing

#### createStylist (Style Compiler)
Located in `styles/createStylist.ts`:
- Compiles all style layers into a single function
- Handles selector generation for variants and states
- Manages responsive breakpoint extraction
- Applies styles in correct cascade order:
  1. Base styles
  2. Variant styles (when active)
  3. State styles (when active)
  4. System props (from parser)
  5. Custom props

#### createParser (Prop Parser)
Located in `styles/createParser.ts`:
- Converts prop values to CSS using scale lookups
- Handles responsive prop arrays
- Manages prop-to-CSS property mapping

## Type System

The builder uses extensive TypeScript generics to track:
- **PropRegistry**: All registered props and their types
- **GroupRegistry**: Named groups and their constituent props
- **BaseParser**: Parser configuration for system props
- **BaseStyles**: Base CSS styles
- **Variants**: Variant configurations with their options
- **States**: Boolean state configurations
- **ActiveGroups**: Currently enabled prop groups
- **CustomProps**: User-defined custom props

## Style Execution Order

When a component renders, styles are applied in this order:
1. CSS variables (from `vars` prop)
2. Base styles from `.styles()`
3. Active variant styles
4. Active state styles
5. System props (parsed from component props)
6. Inline style overrides

## Prop Forwarding

The builder automatically filters props:
- System props (in PropRegistry) are consumed and not forwarded
- Valid HTML attributes are forwarded (using @emotion/is-prop-valid)
- Custom props are consumed based on configuration

## Best Practices

1. **Define base styles first** - Use `.styles()` for foundational styles
2. **Use variants for design options** - Color schemes, sizes, etc.
3. **Use states for interactive states** - Hover, focus, disabled, etc.
4. **Group related props** - Use `.groups()` to enable sets of props
5. **Extend for variations** - Use `.extend()` to create component variants

## Common Patterns

### Basic Component
```typescript
const Button = animus
  .styles({
    padding: '8px 16px',
    borderRadius: '4px'
  })
  .asElement('button');
```

### Component with Variants
```typescript
const Button = animus
  .styles({ base: '...' })
  .variant({
    prop: 'size',
    variants: {
      small: { padding: '4px 8px' },
      large: { padding: '12px 24px' }
    }
  })
  .asElement('button');
```

### Extended Component
```typescript
const PrimaryButton = Button.extend()
  .styles({
    backgroundColor: 'blue',
    color: 'white'
  })
  .asElement('button');
```

## Debugging Tips

1. **Check method order** - Ensure builder methods are called in correct sequence
2. **Inspect built styles** - Use `.build()` to see the compiled style function
3. **Verify prop filtering** - Check `shouldForwardProp` logic
4. **Trace style cascade** - Follow execution through createStylist
5. **Type errors** - Usually indicate incorrect method order or invalid configurations

## Practical Patterns & Examples

This section provides answers to common implementation questions for AI agents.

### Responsive Design
*Documentation coming soon - how arrays work, breakpoint system*
Array responsive syntax works for specificing values mobile first, from no breakpoint to the highest breakpoint configured in the theme.  Omitted sequential values in the array are ignored (only if undefined).

The object syntax is equivalent but uses named keys for the sequence.  Please see the example:

```tsx
// Object syntax
animus.styles({ width: { _: '100px', xs: '200px', md: '300px' }})
// Equivalent Array Syntax
animus.styles({ width: ['100px', '200px', , '300px' ]});
```

Responsive syntax is available definitionally in `.styles()`, `.variant()` and `.states()` for example:
```tsx
animus
  .variant({
    prop: 'size',
    variants: {
      large: { padding: ['1rem', '2rem'] } // Is this valid?
    }
  })
```

And for `groups()` and custom `props()` they are available in the final prop API as valid syntax E.G:

```tsx
const Box = animus.groups({ space: true }).asElement('div');

<Box p={['1rem', '2rem', '3rem']} />
```

### Theming Integration
*Documentation coming soon - design tokens, theme values, typing*

### Complex Selectors
*Documentation coming soon - pseudo-selectors, nested selectors placement*
Pseudo selectors and nested selectors are available for `.styles()`, `.variant()` and `.states()` as they all represent a set of CSS rules rather than indivdiual utilities.

```tsx
const HoverableItem = animus
  .styles({
    backgroundColor: 'white',
    '&:hover': {
      backgroundColor: 'grey',
    }
  })
  .variant({
     prop: 'intent',
     variants: {
      primary: {
        backgroundColor: 'blue',
        color: 'white',
         '&:hover': {
            backgroundColor: 'darkblue',
          }
      },
      danger: {
        backgroundColor: 'red',
        color: 'white',
         '&:hover': {
            backgroundColor: 'darkred',
          }
      },
     }
  })
  .states({
    disabled: {
      backgroundColor: 'grey',
      opacity: 0.8,
      '&:hover': {
        cursor: 'not-allowed',
        backgroundColor: 'grey',
      }
    }
  })
```

This also applies to complex or multiple selectors and or pseudo elements like - however may not include escaping the current context with `.parent + &`:
```tsx
const ComplexThing = animus
   .styles({
      '&:before': {
          content: '""',
          position: 'absolute',
          borderRadius: 4,
          gradient: 'flowX',
          backgroundSize: '300px 100px',
          backgroundPosition: '0px 0%',
          transition: 'bg',
          inset: 0,
          bg: 'background-current',
          zIndex: 0,
        },
        '&:after': {
          content: '""',
          inset: 2,
          borderRadius: 2,
          bg: 'background-current',
          zIndex: 0,
          position: 'absolute',
        },
        '&:hover:before': {
          backgroundPosition: '-100px 0%',
        },
        '&:active:hover:before': {
          backgroundPosition: '-400px 0%',
        },
   });
```

Chain definition order reflects the order of evaluation:
1. `styles`
2. `variant` preserving the order in which variants are registered if this is called multiple times.
3. `states`
4. `groups`
5. `props`

When extending a component using `.extend()` you can inject new styles to specific layers without effecting the prop cascade!



### Animation Patterns
*Documentation coming soon - where animations belong in the cascade*

### Compound Components
*Documentation coming soon - Card.Header, Card.Body patterns*

Compound composition is up to the user - a Compound component can befined as aliases of local components to indicate they are intended to be used together:

```tsx
const Card = animus
  .styles({
    padding: '1rem',
    backgroundColor: 'grey',
    border: 1,
  })
  .asElement('div');

const CardHeader = animus
  .styles({
    fontSize: 18,
    fontWeight: 500
  })
  .asElement('h2');

const CardBody = animus
   .styles({
      padding: '1rem',
      fontSize: 14,
   })
   .asElement('div');

Card.Header = CardHeader;
Card.Body = CardBody;

export default Card;
```

### Global Styles & Resets
*Documentation coming soon - app-wide styles approach*

### Performance Considerations
*Documentation coming soon - patterns to avoid, optimization tips*

### Complete Component Examples
*Documentation coming soon - comprehensive examples with all features*

### Common UI Patterns
*Documentation coming soon - modal, dropdown, form field implementations*

### Design System Integration
*Documentation coming soon - token integration, migration patterns*

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

## New Insights from Real-World Usage

Based on analyzing actual implementations across the codebase:

### 1. Gradient Token System
The codebase uses semantic gradient tokens like `gradient: 'flowX'` that map to complex gradient definitions. This suggests a sophisticated token system beyond simple color values.

### 2. Grid Area Shorthand
Components use `area: 'sidebar'` as shorthand for `gridArea: 'sidebar'`, indicating custom CSS property mappings in the prop system.

### 3. Layered Component Architecture
Complex components like Button separate visual layers (container vs foreground) rather than combining all styles in one component. This pattern enables:
- Independent animation of layers
- Better performance (transforms on specific layers)
- Cleaner separation of concerns

### 4. Responsive Grid Templates
The Layout component shows responsive grid template areas:
```tsx
gridTemplateAreas: {
  _: '"header header" "content content"',
  sm: '"header header" "sidebar content"',
}
```

### 5. CSS Custom Scrollbar Hiding
Components use webkit-specific scrollbar hiding:
```tsx
'::-webkit-scrollbar': {
  display: 'none',
}
```

### 6. Position-Based Responsive Patterns
Components change positioning strategy based on viewport:
```tsx
position: {
  _: 'absolute',
  sm: 'static',
}
```

### 7. Size Shorthands
The codebase uses numeric shorthands like `width: 1` (likely 100%), `size: 1`, `inset: 0`, suggesting a normalized prop value system.

## Open Questions from Analysis

1. **Gradient Token Architecture**: How are gradient tokens like 'flowX' defined and resolved? Are they CSS variables or JS objects?

2. **Numeric Value System**: What's the complete mapping for numeric values (0, 1, 0.5)? How do they translate to CSS?

3. **Custom Prop Mappings**: Beyond 'area' for 'gridArea', what other CSS property shorthands exist?

4. **Animation Integration**: How does the `import { flow } from '../animations/flow'` pattern work with Emotion keyframes?

5. **Theme Token Categories**: What are all the semantic token categories (text-shadow: 'flush', 'link-raised')?

6. **Performance of Pseudo-Elements**: Given heavy use of :before/:after for effects, are there performance benchmarks?

7. **TypeScript Compound Pattern**: Is the Layout compound component TypeScript pattern the recommended approach?

8. **Group Selection Strategy**: What determines which groups to enable for each component type?

9. **Variant vs State Decision**: When should something be a variant vs a state? The pattern isn't always clear.

10. **Build Tool Integration**: How do production builds optimize these complex styled components?

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

The Animus builder integrates seamlessly with themes provided via Emotion's ThemeProvider. When using ThemeBuilder from `@syzygos/theming`, the integration works as follows:

#### Theme Value Resolution

Props can reference theme scales using the `scale` property in prop definitions:

```typescript
animus
  .props({
    bg: {
      property: 'backgroundColor',
      scale: 'colors' // References theme.colors scale
    }
  })
  .asElement('div');

// Usage: <Box bg="primary" /> resolves to theme.colors.primary
```

#### Design Token Flow

1. **ThemeBuilder creates CSS variables**:
   ```typescript
   const theme = createTheme(baseTheme)
     .addColors({ primary: '#007bff' })
     .build();
   // Creates: theme.colors.primary = 'var(--colors-primary)'
   ```

2. **Animus resolves theme values**:
   ```typescript
   // When bg="primary" is used:
   // lookupScaleValue('primary', 'colors', theme) → 'var(--colors-primary)'
   ```

3. **CSS variables must be injected**:
   ```typescript
   import { Global } from '@emotion/react';
   
   const GlobalStyles = () => {
     const theme = useTheme();
     return (
       <Global styles={{
         ':root': theme._variables.root
       }} />
     );
   };
   ```

#### Type Safety with Themes

For proper TypeScript support, extend Emotion's theme interface:

```typescript
declare module '@emotion/react' {
  export interface Theme extends MyThemeType {}
}
```

#### Theme Scales Available

Common scales that work with Animus props:
- `colors` - Color values
- `space` - Spacing/margin/padding values
- `fontSizes` - Typography sizes
- `fonts` - Font families
- `lineHeights` - Line height values
- `letterSpacings` - Letter spacing values
- `sizes` - Width/height values
- `borders` - Border styles
- `borderWidths` - Border width values
- `borderStyles` - Border style values
- `radii` - Border radius values
- `shadows` - Box shadow values
- `zIndices` - Z-index values
- `transitions` - Transition values

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

Animations in Animus follow the same cascade principles as other styles. Here's where each type of animation belongs:

#### Base Animations (in `.styles()`)

For animations that are fundamental to the component:

```typescript
const FadeIn = animus
  .styles({
    animation: 'fadeIn 0.3s ease-in-out',
    '@keyframes fadeIn': {
      from: { opacity: 0 },
      to: { opacity: 1 }
    }
  })
  .asElement('div');
```

#### Variant-Based Animations (in `.variant()`)

For animations that change based on component variations:

```typescript
const Alert = animus
  .styles({
    padding: '1rem',
    borderRadius: '4px'
  })
  .variant({
    prop: 'type',
    variants: {
      success: {
        backgroundColor: 'green.100',
        animation: 'slideInLeft 0.3s ease-out'
      },
      error: {
        backgroundColor: 'red.100',
        animation: 'shake 0.5s ease-in-out'
      }
    }
  })
  .asElement('div');
```

#### State-Based Animations (in `.states()`)

For animations triggered by interactive states:

```typescript
const Button = animus
  .styles({
    transition: 'all 0.2s ease'
  })
  .states({
    loading: {
      position: 'relative',
      color: 'transparent',
      '&::after': {
        content: '""',
        position: 'absolute',
        width: '16px',
        height: '16px',
        top: '50%',
        left: '50%',
        margin: '-8px 0 0 -8px',
        border: '2px solid',
        borderColor: 'currentColor',
        borderRadius: '50%',
        borderTopColor: 'transparent',
        animation: 'spin 0.6s linear infinite'
      }
    }
  })
  .asElement('button');
```

#### CSS Transition Integration

For smooth property transitions, define them in base styles:

```typescript
const Card = animus
  .styles({
    backgroundColor: 'white',
    transform: 'translateY(0)',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
    '&:hover': {
      transform: 'translateY(-4px)',
      boxShadow: 'lg'
    }
  })
  .asElement('div');
```

#### Complex Animation Sequences

For multi-step animations, use keyframes in the appropriate layer:

```typescript
const LoadingDots = animus
  .styles({
    display: 'inline-flex',
    gap: '4px',
    '& span': {
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      backgroundColor: 'currentColor',
      animation: 'bounce 1.4s ease-in-out infinite both'
    },
    '& span:nth-of-type(1)': {
      animationDelay: '-0.32s'
    },
    '& span:nth-of-type(2)': {
      animationDelay: '-0.16s'
    },
    '@keyframes bounce': {
      '0%, 80%, 100%': {
        transform: 'scale(0)'
      },
      '40%': {
        transform: 'scale(1)'
      }
    }
  })
  .asElement('div');
```

#### Animation Best Practices

1. **Performance**: Use `transform` and `opacity` for best performance
2. **Accessibility**: Respect `prefers-reduced-motion`:
   ```typescript
   .styles({
     '@media (prefers-reduced-motion: reduce)': {
       animation: 'none',
       transition: 'none'
     }
   })
   ```
3. **Duration**: Keep animations short (200-400ms for micro-interactions)
4. **Easing**: Use appropriate easing functions:
   - `ease-out` for enter animations
   - `ease-in` for exit animations
   - `ease-in-out` for state changes

### Compound Components

Compound components are a powerful pattern for creating related components that work together. Here's the recommended approach based on real-world usage:

#### Basic Pattern

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

#### Advanced Pattern with TypeScript (from Layout.tsx)

```tsx
// Define individual components
const LayoutContainer = animus
  .styles({
    display: 'grid',
    gridTemplateAreas: '"header header" "sidebar content"',
  })
  .states({
    sidebar: {
      gridTemplateAreas: {
        _: '"header header" "content content"',
        sm: '"header header" "sidebar content"',
      }
    }
  })
  .asElement('div');

const HeaderContainer = animus
  .styles({ area: 'header' })
  .asElement('div');

const SidebarContainer = animus
  .styles({ area: 'sidebar' })
  .asElement('div');

// Create compound type
type LayoutContainer = typeof LayoutContainer;

export interface Layout extends LayoutContainer {
  Header: typeof HeaderContainer;
  Sidebar: typeof SidebarContainer;
}

// Export with sub-components attached
export const Layout = LayoutContainer as Layout;
Layout.Header = HeaderContainer;
Layout.Sidebar = SidebarContainer;

// Usage
<Layout sidebar>
  <Layout.Header>...</Layout.Header>
  <Layout.Sidebar>...</Layout.Sidebar>
</Layout>
```

This pattern provides:
- Type-safe compound components
- Clear parent-child relationships
- Cohesive API for related components

### Global Styles & Resets
*Documentation coming soon - app-wide styles approach*

### Performance Considerations

Based on real-world usage patterns, here are key performance optimizations:

#### 1. Avoid Excessive Pseudo-Elements

While powerful, overuse of `:before` and `:after` can impact performance:

```tsx
// ❌ Avoid: Multiple layers of pseudo-elements
.styles({
  '&:before': { /* gradient layer */ },
  '&:after': { /* shadow layer */ },
  '& > div:before': { /* more effects */ },
  '& > div:after': { /* even more */ }
})

// ✅ Better: Use actual elements when needed
const Container = animus.styles({...}).asElement('div');
const GradientLayer = animus.styles({...}).asElement('div');
const ContentLayer = animus.styles({...}).asElement('div');
```

#### 2. Optimize Gradient Animations

Gradient animations can be expensive. Use transform instead:

```tsx
// ❌ Avoid: Animating background-position continuously
.styles({
  animation: 'flow 5s linear infinite',
  '@keyframes flow': {
    '0%': { backgroundPosition: '0% 0%' },
    '100%': { backgroundPosition: '100% 0%' }
  }
})

// ✅ Better: Use transform for smoother performance
.styles({
  '&:before': {
    content: '""',
    position: 'absolute',
    inset: 0,
    background: 'gradient',
    transform: 'translateX(0)',
    transition: 'transform 0.3s ease',
  },
  '&:hover:before': {
    transform: 'translateX(-100px)',
  }
})
```

#### 3. Group-Based Code Splitting

Enable only the groups you need to reduce bundle size:

```tsx
// ❌ Avoid: Enabling all groups
.groups({
  layout: true,
  space: true,
  color: true,
  typography: true,
  borders: true,
  shadows: true,
  positioning: true,
  background: true,
  flex: true,
  grid: true
})

// ✅ Better: Enable only what's needed
.groups({
  layout: true,
  space: true,
  color: true
})
```

#### 4. Responsive Value Optimization

Use responsive values judiciously:

```tsx
// ❌ Avoid: Responsive values for every property
.styles({
  padding: { _: 8, xs: 12, sm: 16, md: 20, lg: 24, xl: 32 },
  margin: { _: 4, xs: 6, sm: 8, md: 10, lg: 12, xl: 16 },
  fontSize: { _: 14, xs: 15, sm: 16, md: 17, lg: 18, xl: 20 },
})

// ✅ Better: Use responsive values for key breakpoints
.styles({
  padding: { _: 8, sm: 16, lg: 24 },
  margin: 8,
  fontSize: { _: 14, sm: 16 }
})
```

#### 5. Component Composition vs. Complex Styles

Break complex components into simpler pieces:

```tsx
// ❌ Avoid: One component with many variants and states
const Button = animus
  .styles({ /* 50+ lines of base styles */ })
  .variant({ /* 10 variants */ })
  .states({ /* 8 states */ })
  .asElement('button');

// ✅ Better: Compose from simpler components
const BaseButton = animus.styles({...}).asElement('button');
const IconButton = BaseButton.extend().styles({...}).asElement('button');
const LoadingButton = BaseButton.extend().states({...}).asElement('button');
```

#### 6. Memoize Complex Components

For components with expensive render logic:

```tsx
import { memo } from 'react';

const ExpensiveComponent = memo(
  animus
    .styles({ /* complex styles */ })
    .asComponent(({ children, ...props }) => {
      // Complex render logic
      return <div {...props}>{children}</div>;
    })
);
```

#### 7. CSS Variable Performance

When using ThemeBuilder, minimize CSS variable lookups:

```tsx
// ❌ Avoid: Many individual variable references
.styles({
  color: 'var(--colors-text)',
  backgroundColor: 'var(--colors-background)',
  borderColor: 'var(--colors-border)',
  // ... many more
})

// ✅ Better: Use semantic tokens that group related values
.styles({
  color: 'text',
  bg: 'background',
  borderColor: 'border',
})
```

#### 8. Build-Time Optimizations

- Use production builds to eliminate development warnings
- Enable CSS extraction in your bundler when possible
- Consider using `babel-plugin-emotion` for build-time optimizations
- Tree-shake unused Animus groups and features

#### Key Metrics to Monitor

1. **Bundle Size**: Track the size of your styled components
2. **Runtime Performance**: Monitor style recalculation in DevTools
3. **Memory Usage**: Watch for memory leaks from dynamic styles
4. **Initial Load**: Measure time to first meaningful paint

### Complete Component Examples
*Documentation coming soon - comprehensive examples with all features*

### Common UI Patterns

Based on real-world usage analysis, here are common patterns for building UI components with Animus:

#### Layered Visual Effects (Button Pattern)

Create rich visual effects by separating container and content:

```tsx
// Container handles background effects
const ButtonContainer = animus
  .styles({
    position: 'relative',
    overflow: 'hidden',
  })
  .variant({
    prop: 'variant',
    variants: {
      fill: {
        '&:before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          gradient: 'flowX',
          backgroundSize: '300px 100%',
          transition: 'background-position 0.3s ease',
        },
        '&:hover:before': {
          backgroundPosition: '-100px 0%',
        }
      },
      stroke: {
        '&:before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          gradient: 'flowX',
          zIndex: 0,
        },
        '&:after': {
          content: '""',
          position: 'absolute',
          inset: 2,
          bg: 'background-current',
          zIndex: 0,
        }
      }
    }
  })
  .asElement('button');

// Foreground handles text/content
const ButtonForeground = animus
  .styles({
    position: 'relative',
    zIndex: 1,
  })
  .variant({
    prop: 'size',
    variants: {
      sm: { px: 12, py: 6, fontSize: 14 },
      md: { px: 16, py: 8, fontSize: 16 },
      lg: { px: 20, py: 10, fontSize: 18 }
    }
  })
  .asElement('span');
```

#### Grid Layout with Named Areas

Use CSS Grid with named template areas for complex layouts:

```tsx
const Layout = animus
  .styles({
    display: 'grid',
    gridTemplateAreas: '"header header" "sidebar content"',
    gridTemplateColumns: '15rem 1fr',
    gridTemplateRows: 'auto 1fr',
  })
  .states({
    collapsed: {
      gridTemplateAreas: '"header" "content"',
      gridTemplateColumns: '1fr',
    }
  })
  .asElement('div');

// Child components reference grid areas
const Sidebar = animus
  .styles({
    gridArea: 'sidebar',
    // or using Animus shorthand:
    area: 'sidebar'
  })
  .asElement('aside');
```

#### Gradient Text Effects

Create gradient text using background clip:

```tsx
const GradientText = animus
  .styles({
    gradient: 'primary',
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  })
  .asElement('span');
```

#### Responsive Sticky Positioning

Combine responsive values with position states:

```tsx
const Navigation = animus
  .styles({
    position: {
      _: 'fixed',
      sm: 'sticky'
    },
    top: 0,
    zIndex: 10,
  })
  .asElement('nav');
```

#### State-Based Component Switching

Use states for component behavior changes:

```tsx
const Modal = animus
  .styles({
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0,
    pointerEvents: 'none',
    transition: 'opacity 0.2s ease',
  })
  .states({
    open: {
      opacity: 1,
      pointerEvents: 'auto',
    }
  })
  .asElement('div');
```

#### Polymorphic Components

Use variants with 'as' prop for semantic flexibility:

```tsx
const Text = animus
  .variant({
    prop: 'as',
    variants: {
      h1: { fontSize: 32, lineHeight: 1.2, fontWeight: 700 },
      h2: { fontSize: 24, lineHeight: 1.3, fontWeight: 600 },
      p: { fontSize: 16, lineHeight: 1.5, fontWeight: 400 },
      small: { fontSize: 14, lineHeight: 1.4, fontWeight: 400 },
    }
  })
  .asElement('p');

// Usage: <Text as="h1">Heading</Text>
```

#### Minimal Wrapper Pattern

Sometimes it's better to wrap existing components than create new ones:

```tsx
export const Code = (props: ComponentProps<typeof Box>) => (
  <Box
    as="code"
    color="primary"
    fontFamily="mono"
    fontSize={14}
    {...props}
  />
);
```

### Design System Integration

#### Token Integration with ThemeBuilder

When building a design system with Animus and ThemeBuilder, follow this pattern:

1. **Define Design Tokens**:
   ```typescript
   // tokens.ts
   export const tokens = {
     colors: {
       brand: {
         primary: '#007bff',
         secondary: '#6c757d'
       },
       semantic: {
         success: '#28a745',
         danger: '#dc3545'
       }
     },
     space: {
       xs: '0.25rem',
       sm: '0.5rem',
       md: '1rem',
       lg: '2rem',
       xl: '4rem'
     }
   };
   ```

2. **Build Theme with CSS Variables**:
   ```typescript
   // theme.ts
   import { createTheme } from '@syzygos/theming';
   
   export const theme = createTheme(baseTheme)
     .addColors(tokens.colors)
     .createScaleVariables('space')
     .addColorModes('light', {
       light: {
         bg: 'white',
         text: 'brand.primary'
       },
       dark: {
         bg: 'brand.primary',
         text: 'white'
       }
     })
     .build();
   ```

3. **Create Design System Components**:
   ```typescript
   // Button.ts
   export const Button = animus
     .styles({
       cursor: 'pointer',
       fontFamily: 'body',
       transition: 'all 0.2s'
     })
     .variant({
       prop: 'variant',
       variants: {
         primary: {
           bg: 'brand.primary',
           color: 'white',
           '&:hover': {
             bg: 'brand.secondary'
           }
         },
         outline: {
           bg: 'transparent',
           borderWidth: '2px',
           borderStyle: 'solid',
           borderColor: 'brand.primary',
           color: 'brand.primary'
         }
       }
     })
     .variant({
       prop: 'size',
       variants: {
         sm: { px: 'sm', py: 'xs', fontSize: 'sm' },
         md: { px: 'md', py: 'sm', fontSize: 'base' },
         lg: { px: 'lg', py: 'md', fontSize: 'lg' }
       }
     })
     .states({
       disabled: {
         opacity: 0.6,
         cursor: 'not-allowed'
       }
     })
     .groups({ space: true })
     .asElement('button');
   ```

#### Migration Patterns

##### From CSS/SCSS to Animus

```scss
// Before (SCSS)
.button {
  padding: 8px 16px;
  border-radius: 4px;
  
  &--primary {
    background: blue;
    color: white;
  }
  
  &:disabled {
    opacity: 0.6;
  }
}
```

```typescript
// After (Animus)
const Button = animus
  .styles({
    padding: '8px 16px',
    borderRadius: '4px'
  })
  .variant({
    prop: 'variant',
    variants: {
      primary: {
        background: 'blue',
        color: 'white'
      }
    }
  })
  .states({
    disabled: {
      opacity: 0.6
    }
  })
  .asElement('button');
```

##### From Styled Components to Animus

```typescript
// Before (styled-components)
const Button = styled.button<{ variant?: 'primary' | 'secondary' }>`
  padding: ${props => props.theme.space[2]} ${props => props.theme.space[4]};
  background: ${props => props.variant === 'primary' ? props.theme.colors.primary : props.theme.colors.secondary};
`;
```

```typescript
// After (Animus)
const Button = animus
  .styles({
    px: 4, // Uses theme.space scale
    py: 2
  })
  .variant({
    prop: 'variant',
    variants: {
      primary: { bg: 'primary' },
      secondary: { bg: 'secondary' }
    }
  })
  .asElement('button');
```

#### Best Practices for Design Systems

1. **Use Semantic Token Names**: Instead of `blue-500`, use `brand.primary`
2. **Leverage Color Modes**: Define semantic aliases that change with modes
3. **Component Composition**: Build complex components from simple ones
4. **Consistent Prop APIs**: Use the same variant names across components
5. **Document Token Usage**: Create a token reference guide for designers

#### Token Reference Architecture

```typescript
// Create a centralized token reference
export const designSystem = {
   components: {
     Button,
     Card,
     Input
   },
   tokens: theme._tokens, // Original token values
   scales: {
     colors: theme.colors,
     space: theme.space,
     // ... other scales
   }
};

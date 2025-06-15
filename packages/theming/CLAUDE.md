# ThemeBuilder Architecture & Animus Integration

This document captures deep architectural insights about the ThemeBuilder system and its integration with the Animus builder from the core package.

## Table of Contents

1. [ThemeBuilder Architecture](#themebuilder-architecture)
2. [Design Token Resolution Process](#design-token-resolution-process)
3. [Animus Builder Integration](#animus-builder-integration)
4. [Critical Integration Points](#critical-integration-points)
5. [Recommendations & Improvements](#recommendations--improvements)
6. [Open Questions](#open-questions)

## ThemeBuilder Architecture

### Overview

The ThemeBuilder provides a fluent, type-safe API for building themes with design tokens, CSS variables, and color modes. It follows a Producer-Consumer pattern where ThemeBuilder produces theme configuration and Animus consumes it via Emotion's ThemeProvider.

### Core Components

#### 1. Current ThemeBuilder Implementation (`createTheme.ts`)

```typescript
export class ThemeBuilder<T extends AbstractTheme> {
  #theme = {} as T;
  
  constructor(baseTheme: T) { /* ... */ }
}
```

**Key Methods:**
- `createScaleVariables(key)` - Transforms theme scales into CSS variables
- `addColors(colors)` - Adds color tokens to the theme
- `addColorModes(initialMode, modeConfig)` - Implements color mode switching
- `addScale(key, createScale)` - Adds new scale to the theme
- `updateScale(key, updateFn)` - Updates existing scale values
- `build()` - Finalizes the theme

#### 2. Legacy ThemeBuilder (`ThemeBuilder.ts`)

Uses class inheritance hierarchy:
```
ThemeUnitialized → ThemeWithBreakpoints → ThemeWithRawColors → ThemeWithAll
```

### Theme Object Structure

The built theme contains three critical structures:

1. **Public Scales** (e.g., `theme.colors`): CSS variable references (`'var(--colors-primary)'`)
2. **Private Variables** (`theme._variables`): CSS variable definitions
3. **Private Tokens** (`theme._tokens`): Original values (currently redundant)

## Design Token Resolution Process

### 1. Token Definition Phase

```typescript
createTheme(baseTheme)
  .addColors({ primary: '#007bff' })
```

### 2. Serialization Phase

The `serializeTokens` function creates:
- **Token References**: `{ primary: 'var(--colors-primary)' }`
- **Token Variables**: `{ '--colors-primary': '#007bff' }`

### 3. Storage Phase

- `theme.colors.primary` = `'var(--colors-primary)'`
- `theme._variables.root['--colors-primary']` = `'#007bff'`
- `theme._tokens.colors.primary` = `'#007bff'`

### 4. Injection Phase (Critical Gap)

**Currently missing**: A mechanism to inject CSS variables into the DOM. Applications must implement:

```typescript
const MyGlobalStyles = () => {
  const theme = useTheme();
  return (
    <Global
      styles={css`
        :root {
          /* Inject theme._variables.root here */
        }
      `}
    />
  );
};
```

### 5. Component Usage Phase

```typescript
<MyComponent color="primary" />
```

### 6. Style Resolution Phase

1. `createPropertyStyle` invoked for `color` prop
2. Calls `lookupScaleValue('primary', 'colors', theme)`
3. Returns `'var(--colors-primary)'`
4. Emotion generates CSS: `color: var(--colors-primary);`

### 7. Browser Resolution Phase

Browser applies styles using CSS Custom Properties from injected variables.

## Animus Builder Integration

### Architecture Overview

Animus uses a class hierarchy with fluent API:
```
Animus → AnimusWithBase → AnimusWithVariants → AnimusWithStates → AnimusWithSystem → AnimusWithAll
```

### Integration Points

1. **Theme Access**: Animus components receive theme via Emotion's ThemeProvider
2. **Scale Lookup**: `lookupScaleValue` resolves theme values from scales
3. **CSS Variable Support**: Animus treats CSS variable strings as opaque values
4. **Responsive Breakpoints**: Both systems use `theme.breakpoints` for media queries

### Value Resolution Flow

```
Component Prop → createPropertyStyle → lookupScaleValue → Theme Scale → CSS Variable → Browser
```

## Critical Integration Points

### 1. Scale Value Resolution

The `lookupScaleValue` function in core/src/scales/lookupScaleValue.ts:
- Resolves values from theme scales
- Falls back to compatTheme
- **Limitation**: Doesn't support negative values (e.g., `m="-4"`)

### 2. Responsive Values

- **ThemeBuilder**: Creates breakpoint CSS variables
- **Animus**: Uses breakpoints for media query generation
- Both systems must coordinate on breakpoint definitions

### 3. Color Modes

Current implementation has complexity:
- `_variables.mode` contains initial mode values
- `_tokens.modes` structure unclear
- Application responsible for mode switching logic

## Recommendations & Improvements

### 1. Simplify Theme Contract

Remove `_tokens` from final output, keeping only:
- **Public Scales**: CSS variable references
- **Private Variables**: CSS variable definitions

### 2. Provide Global Styles Utility

```typescript
export const createGlobalStyles = (theme) => {
  const { root, modes } = theme._variables;
  
  return css`
    :root {
      ${varsToCss(root)}
    }
    
    ${Object.entries(modes).map(([mode, vars]) => `
      [data-theme='${mode}'] {
        ${varsToCss(vars)}
      }
    `).join('')}
  `;
};
```

### 3. Support Negative Values

Update `lookupScaleValue` to handle string-prefixed negatives:

```typescript
if (isString(val) && val.startsWith('-')) {
  const positiveKey = val.substring(1);
  const scaleValue = get(usedScale, positiveKey);
  
  if (isString(scaleValue) || isNumber(scaleValue)) {
    return `-${scaleValue}`;
  }
}
```

### 4. Improve Color Mode Architecture

Restructure `_variables` for clarity:
```typescript
{
  _variables: {
    root: { /* base tokens */ },
    modes: {
      light: { /* semantic aliases */ },
      dark: { /* semantic aliases */ }
    }
  }
}
```

### 5. Type Safety Enhancements

- Create comprehensive type tests for chained builder calls
- Provide `GetAnimusProps<T>` utility type
- Make `build()` method generic for better inference

## Open Questions

### Critical Architecture Questions

1. **Variable Injection Strategy**: Should we provide an official `ThemeProvider` wrapper that handles CSS variable injection automatically?
   - Current gap: Apps must manually inject `theme._variables` into DOM
   - Consideration: Auto-injection could simplify setup but reduce flexibility

2. **Migration Path**: How do we support gradual migration from literal-value themes to CSS-variable-based themes?
   - Challenge: Mixed themes with both literal values and CSS variables
   - Need: Clear documentation and tooling for incremental adoption

3. **Performance Optimization**: Is the extensive use of `lodash.merge` in builder chains a performance concern?
   - Impact: Each builder method creates new merged objects
   - Alternative: Investigate more performant merge strategies or lazy evaluation

4. **Type Complexity**: How can we simplify the generic type chains while maintaining type safety?
   - Current: Heavy generic usage can create complex error messages
   - Goal: Better developer experience with clearer type errors

### Integration Improvements

5. **Negative Value Support**: Should negative values use string prefix pattern (like Chakra UI)?
   - Current: `lookupScaleValue` doesn't support negative theme values
   - Proposed: Support `m="-4"` syntax for negative margins

6. **Color Mode Architecture**: Should we simplify the current three-source-of-truth pattern?
   - Current: `_variables`, `_tokens`, and public scales create confusion
   - Proposed: Eliminate `_tokens` from final build output

7. **Responsive Value Coordination**: How to ensure array/object responsive syntax works consistently?
   - Need: Integration tests between ThemeBuilder breakpoints and Animus responsive arrays
   - Challenge: Both systems must coordinate on breakpoint definitions

### Developer Experience

8. **Official Global Styles Utility**: Should we provide `createGlobalStyles` helper?
   - Benefit: Standardized way to inject CSS variables
   - Implementation: Could be part of @syzygos/theming package

9. **Theme Structure Validation**: Should we validate theme structure at runtime?
   - Use case: Catch missing CSS variable injections early
   - Trade-off: Runtime validation vs. bundle size

10. **Documentation Gaps**: Which patterns need more comprehensive examples?
    - Compound components with theming
    - Global styles and CSS resets
    - Performance optimization patterns
    - Common UI patterns (modals, dropdowns, forms)

### Technical Debt

11. **Legacy ThemeBuilder**: Should we deprecate the class inheritance version?
    - Current: Two implementations create confusion
    - Migration: Need clear upgrade path for existing users

12. **Theme Contract Clarity**: How to better document the theme object contract?
    - Issue: Unclear when to use `_variables` vs `_tokens` vs public scales
    - Solution: Clearer separation of concerns in documentation

### New Questions from Real-World Usage Analysis

13. **Gradient Token System**: How should gradient tokens be defined in ThemeBuilder?
    - Observed: Components use `gradient: 'flowX'` tokens
    - Need: Clear pattern for defining complex gradient tokens as CSS variables

14. **Numeric Value Normalization**: How do numeric theme values (0, 1, 0.5) map to CSS?
    - Observed: `width: 1`, `size: 1`, `left: 0.5` in components
    - Question: Is this a percentage system or theme scale reference?

15. **Semantic Token Categories**: What token categories should ThemeBuilder support?
    - Observed: text-shadow tokens ('flush', 'link-raised')
    - Observed: gradient tokens ('flowX')
    - Question: How to organize non-standard CSS tokens?

16. **WebKit-Specific Properties**: Should ThemeBuilder handle vendor prefixes?
    - Observed: `WebkitTextFillColor`, `WebkitBackgroundClip` usage
    - Challenge: CSS variables with vendor prefixes

17. **Grid Template Token Support**: Should grid templates be tokenized?
    - Observed: Complex responsive grid templates in Layout
    - Consideration: Token vs. inline definition trade-offs

18. **Animation Token Integration**: How should keyframe animations work with tokens?
    - Observed: Imported keyframes used with Animus styles
    - Question: Can animations reference theme tokens?

19. **Performance Benchmarks**: What's the performance impact of CSS variables?
    - Heavy use of pseudo-elements with gradient variables
    - Need: Benchmarks comparing literal values vs. CSS variables

20. **Custom Property Mappings**: Should ThemeBuilder know about Animus prop shorthands?
    - Observed: `area` → `gridArea`, `gradient` → complex gradient
    - Question: Where should this mapping knowledge live?

## Technical Notes

### Key Files

- `/packages/theming/src/utils/createTheme.ts` - Main builder implementation
- `/packages/theming/src/utils/serializeTokens.ts` - CSS variable generation
- `/packages/theming/src/utils/flattenScale.ts` - Object flattening utilities
- `/packages/core/src/scales/lookupScaleValue.ts` - Theme value resolution
- `/packages/core/src/Animus.ts` - Style builder integration

### Dependencies

- Emotion for CSS-in-JS and theming
- Lodash for object manipulation
- TypeScript for type safety

---

*Last Updated: January 2025*
*Analysis based on deep architectural review and integration testing*
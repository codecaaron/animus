# Animus.ts Architecture Explanation

## Core Concept

Animus is a **type-state machine** that guides you through building styled components step-by-step. It uses TypeScript's type system to enforce that you configure your components in a specific order, making it impossible to make mistakes.

## The Unique Architecture

The most interesting aspect is the **backwards inheritance chain**:

```
Animus → AnimusWithBase → AnimusWithVariants → AnimusWithStates → AnimusWithSystem → AnimusWithAll
```

Each class extends the one *after* it in the chain, which seems backwards but is actually brilliant. Here's why:

- `Animus` (the starting point) inherits from `AnimusWithBase`
- `AnimusWithBase` inherits from `AnimusWithVariants`
- And so on...

This means the first class has access to all the methods defined in later classes, but those methods only become *available* to use when you reach the right stage.

## How It Works - Step by Step

### 1. Starting Point: `Animus` (lines 331-349)
```typescript
const builder = new Animus(propRegistry, groupRegistry);
```
- Takes your prop definitions and group configurations
- Only exposes the `.styles()` method
- Creates a parser for your props automatically

### 2. After calling `.styles()`: `AnimusWithBase` (lines 287-329)
```typescript
builder.styles({ padding: '20px', color: 'blue' })
```
- Now you can call `.variant()` to add design variations
- The base styles are locked in

### 3. After calling `.variant()`: `AnimusWithVariants` (lines 226-285)
```typescript
.variant({
  prop: 'size',
  variants: {
    small: { fontSize: '14px' },
    large: { fontSize: '20px' }
  }
})
```
- Can add multiple variants
- Now `.states()` method becomes available

### 4. After calling `.states()`: `AnimusWithStates` (lines 184-224)
```typescript
.states({
  disabled: { opacity: 0.5, cursor: 'not-allowed' },
  loading: { cursor: 'wait' }
})
```
- Defines boolean states (props that are true/false)
- Unlocks `.groups()` method

### 5. After calling `.groups()`: `AnimusWithSystem` (lines 140-182)
```typescript
.groups({ spacing: true, colors: true })
```
- Enables predefined groups of props
- Now you can add custom props with `.props()`

### 6. Final Stage: `AnimusWithAll` (lines 24-138)
This is where the magic happens. You can now:

- `.asElement('button')` - Create a styled HTML element
- `.asComponent(MyComponent)` - Style an existing React component  
- `.build()` - Get the raw styling function
- `.extend()` - Create variations of your styled component

## Key Features

### Type Safety Throughout
The 8 generic parameters track everything:
- `PropRegistry` - All your prop definitions
- `GroupRegistry` - Prop groupings
- `BaseParser` - How props convert to CSS
- `BaseStyles` - Your base CSS
- `Variants` - Design variations
- `States` - Boolean state styles
- `ActiveGroups` - Which groups are enabled
- `CustomProps` - Additional custom props

### Smart Prop Forwarding (lines 76-87)
```typescript
shouldForwardProp: (prop) => 
  isPropValid(prop) && !propNames.includes(prop)
```
- System props (like `spacing`, `colors`) are consumed and turned into styles
- Valid HTML attributes are passed through
- Invalid props are filtered out

### The Build Process (lines 99-137)
When you call `.build()`, it:
1. Merges your parser config with custom props
2. Creates a stylist that combines all your configurations
3. Returns a function that generates CSS objects
4. Handles variants, states, and system props automatically

### Extension System
The `.extend()` method creates an `AnimusExtended` instance that can break the rules - you can modify any part of the configuration in any order. This provides an escape hatch when needed.

## Why This Design?

1. **Impossible to Misuse** - You can't call methods in the wrong order
2. **Perfect IntelliSense** - Your IDE knows exactly what methods are available at each step
3. **Type Safe** - All configurations are fully typed
4. **Flexible When Needed** - The extend system provides flexibility
5. **Clean API** - The forced order mirrors how we think about styling (base → variants → states → props)

## Example Usage

```typescript
const Button = animus
  .styles({ 
    padding: '10px 20px',
    borderRadius: '4px' 
  })
  .variant({
    prop: 'variant',
    variants: {
      primary: { background: 'blue', color: 'white' },
      secondary: { background: 'gray', color: 'black' }
    }
  })
  .states({
    disabled: { opacity: 0.6 }
  })
  .asElement('button');

// Usage:
<Button variant="primary" disabled>Click me</Button>
```

## The Backwards Inheritance Explained

The backwards inheritance pattern is the key innovation. Instead of:
- Base class with few methods → Derived class with more methods (traditional OOP)

Animus does:
- Starting class that inherits everything → But methods are selectively exposed

This creates a "progressive revelation" pattern where:
1. You start with minimal options (just `.styles()`)
2. Each method call returns a new class instance
3. That new instance exposes the next logical methods
4. Invalid sequences are impossible at the type level

## Integration with Emotion

Animus builds on top of Emotion (a CSS-in-JS library):
- Uses `@emotion/styled` to create the actual styled components
- Uses `@emotion/is-prop-valid` to filter props intelligently
- The final output is a standard Emotion styled component
- Full compatibility with themes, SSR, and other Emotion features

## Performance Considerations

- All type checking happens at compile time - zero runtime overhead
- The inheritance chain is resolved during build
- Final components are standard Emotion components
- Parser and stylist are created once and reused

## Summary

This architecture ensures that every styled component is configured correctly, with all the power of CSS-in-JS but none of the footguns! The type-state machine pattern combined with backwards inheritance creates a unique developer experience where the API guides you to success.
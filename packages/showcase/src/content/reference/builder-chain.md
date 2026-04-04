# Builder Chain

The builder chain is a type-state machine. Each method returns a narrower type, enforcing cascade order at the type level.

## Chain order

```
ds.styles() → .variant() → .compound() → .states() → .system() → .props() → terminal
```

| Method | Layer | Can repeat? | Available after |
|--------|-------|-------------|-----------------|
| `.styles(css)` | `@layer base` | No | Entry point |
| `.variant(config)` | `@layer variants` | Yes | `.styles()` |
| `.compound(condition, css)` | `@layer compounds` | Yes | `.variant()` |
| `.states(map)` | `@layer states` | No | `.compound()` |
| `.system(groups)` | `@layer system` | No | `.states()` |
| `.props(config)` | `@layer custom` | No | `.system()` |

Terminal methods (`.asElement()`, `.asComponent()`, `.asClass()`) are available at any point after `.styles()`.

## .styles(css)

```typescript
ds.styles(css: ThemedCSSProps) → AnimusWithBase
```

Base styles for the component. Accepts shorthand props with scale lookups, standard CSS properties, token references for composite strings, and nested selectors (one level deep).

```typescript
ds.styles({
  display: 'flex',
  p: 16,
  bg: 'surface',
  '&:hover': { opacity: '0.8' },
  '& > *': { mt: 8 },
})
```

## .variant(config)

```typescript
.variant(config: {
  prop?: string;           // Prop name (default: 'variant')
  defaultVariant?: string; // Option used when prop is omitted
  base?: CSSProps;         // Styles shared across all options
  variants: Record<string, CSSProps>;
}) → AnimusWithVariants
```

Declares a named variant prop. Call multiple times for multiple variant dimensions.

```typescript
.variant({
  prop: 'size',
  defaultVariant: 'md',
  variants: {
    sm: { fontSize: 12, p: 4 },
    md: { fontSize: 14, p: 8 },
    lg: { fontSize: 18, p: 16 },
  },
})
```

## .compound(condition, css)

```typescript
.compound(
  condition: Record<string, string | string[]>,
  css: CSSProps
) → AnimusWithCompounds
```

Styles applied when multiple variant values match simultaneously. Condition keys must be declared variant props; values must be declared options.

```typescript
.compound(
  { size: 'lg', intent: 'primary' },
  { fontWeight: 700, letterSpacing: '-0.01em' }
)
```

Condition values can be arrays for matching multiple options:

```typescript
.compound(
  { size: ['md', 'lg'], intent: 'primary' },
  { boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }
)
```

## .states(map)

```typescript
.states(map: Record<string, CSSProps>) → AnimusWithStates
```

Boolean state props. Each key becomes a boolean prop on the component. Styles emit at `@layer states`, which overrides variants and compounds via cascade position.

```typescript
.states({
  disabled: { opacity: '0.4', cursor: 'not-allowed' },
  loading: { opacity: '0.7', pointerEvents: 'none' },
  active: {
    fontWeight: '700',
    '&::after': { content: '""', display: 'block', height: '2px', bg: 'primary' },
  },
})
```

States are not CSS pseudo-classes. `:hover`, `:focus`, `:disabled` belong in `.styles()` as nested selectors.

## .system(groups)

```typescript
.system(groups: Record<string, true>) → AnimusWithSystem
```

Enables named prop groups on the component. Group names come from `createSystem().addGroup()`.

```typescript
.system({ space: true, surface: true })
```

System props accept responsive breakpoint objects:

```tsx
<Box p={{ _: 8, sm: 16, lg: 32 }} />
```

## .props(config)

```typescript
.props(config: Record<string, CustomPropConfig>) → AnimusWithAll
```

Component-scoped custom props. Each prop maps to a CSS property with an optional scale and transform.

```typescript
.props({
  elevation: { property: 'boxShadow', scale: 'elevation' },
})
```

## Terminals

### .asElement(tag)

```typescript
.asElement(tag: keyof JSX.IntrinsicElements) → AnimusComponent
```

Creates a React component for an HTML element. All components created with `.asElement()` forward refs via `forwardRef`. Ref type narrows to match the tag.

The returned component accepts an `as` prop to override the rendered element at the callsite: `<Button as="a" href="/foo">`. The `as` prop changes the rendered DOM node but does not narrow the accepted props -- `href` passes through regardless of whether the target element supports it. For strict polymorphism with full type narrowing, use `.extend().asElement()` to create a typed variant:

```typescript
const ButtonLink = Button.extend().asElement('a');
// <ButtonLink href="/foo"> — href is typed, size/intent variants inherited
```

### .asComponent(Component)

```typescript
.asComponent(Component: React.ComponentType<{ className?: string }>) → AnimusWrappedComponent
```

Wraps an existing React component. The wrapped component must accept a `className` prop. All Animus-managed props (variants, states, system props) are filtered out before forwarding — only standard HTML attributes, `data-*`, `aria-*`, and unrecognized props pass through to the wrapped component.

```typescript
import { Link } from 'react-router-dom';

const NavLink = ds
  .styles({
    color: 'primary',
    fontWeight: 500,
    textDecoration: 'none',
    '&:hover': { textDecoration: 'underline' },
  })
  .variant({
    prop: 'active',
    variants: {
      true: { fontWeight: 700, color: 'text' },
      false: {},
    },
  })
  .asComponent(Link);

// Usage — `to` is forwarded to Link, `active` is consumed by Animus:
<NavLink to="/about" active="true">About</NavLink>
```

### .asClass()

```typescript
.asClass() → (props?: Record<string, unknown>) => string
```

Returns a class resolver function instead of a React component. The resolver accepts variant/state props and returns the resolved class name string. Useful for non-React contexts, headless UI integration, or manual class application.

```typescript
const buttonClass = ds
  .styles({ display: 'inline-flex', p: 8, cursor: 'pointer' })
  .variant({
    prop: 'size',
    variants: { sm: { p: 4 }, lg: { p: 16 } },
  })
  .states({ disabled: { opacity: '0.4' } })
  .asClass();

// Returns a class name string:
const cls = buttonClass({ size: 'lg', disabled: true });
// → "animus-btn-x3k9f animus-btn-x3k9f--size-lg animus-btn-x3k9f--disabled"
```

## .extend()

```typescript
Component.extend() → AnimusWithBase
```

Available on components created with `.asElement()` or `.asComponent()`. Opens a new builder chain that inherits the parent's variants, states, and system config. Not available on composed components.

## CSS output

Each method's styles are scoped to a cascade layer. The layer order guarantees precedence:

```
@layer base < variants < compounds < states < system < custom
```

The generated class name format is `.animus-{Name}-{hash}`. Variant selectors append `--{prop}-{option}`, state selectors append `--{state}`, and compound selectors append `--compound-{index}`.

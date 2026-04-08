# TypeScript

## Autocomplete

After augmenting the `Theme` interface, the builder chain provides autocomplete for:

- **Scale values** in shorthand props: `p={` suggests space scale keys (4, 8, 16, 24, 32), `bg='` suggests color names
- **Variant option names**: `<Button size="` suggests 'sm' and 'lg'
- **Group names** in `.system()`: `.system({ ` suggests registered group names
- **CSS properties** in `.styles()`: shorthand props and standard CSS property names
- **Token references** in composite strings: `'{colors.'` shows all color paths

## Type errors for invalid scale values

```typescript
const Card = ds
  .styles({
    p: 999,        // Error: 999 is not a key in the space scale
    bg: 'nope',    // Error: 'nope' is not a color name
  })
  .asElement('div');
```

Scale values are validated against the actual theme. If a key doesn't exist, TypeScript catches it at authoring time.

## Type errors for invalid variant values

```typescript
const Button = ds
  .styles({ display: 'inline-flex' })
  .variant({
    prop: 'size',
    variants: {
      sm: { fontSize: 12 },
      lg: { fontSize: 18 },
    },
  })
  .asElement('button');

// Usage:
<Button size="xl" />  // Error: '"xl"' is not assignable to '"sm" | "lg"'
```

Variant props are narrowed to their declared option keys. Invalid options are caught in JSX.

## Builder chain ordering

The type system enforces cascade ordering. Each method returns a narrower type that removes earlier methods:

```typescript
ds.styles({})
  .variant({ prop: 'size', variants: { sm: {}, lg: {} } })
  .compound({ size: 'lg' }, { fontWeight: 700 })
  .states({ disabled: { opacity: '0.4' } })
  .system({ space: true })
  .asElement('div');
```

Calling methods out of order produces a type error:

```typescript
ds.styles({})
  .states({ disabled: { opacity: '0.4' } })
  .variant({})  // Error: .variant() doesn't exist after .states()
```

This matches the cascade: `@layer base` < `@layer variants` < `@layer compounds` < `@layer states` < `@layer system`. The builder chain's type state guarantees the same ordering.

## Missing terminal

The builder chain is not a component until you call a terminal method:

```typescript
// This is a builder, not a component:
const builder = ds.styles({ display: 'block' });

// These are components:
const Box = builder.asElement('div');
const Custom = builder.asComponent(MyReactComponent);

// This is a class resolver:
const resolveClass = builder.asClass();
```

If you try to use a builder in JSX without calling `.asElement()` or `.asComponent()`, TypeScript will error because it's not a valid React component type.

## Shared variant validation in compose

```typescript
const Card = compose(
  { Root: CardRoot, Title: CardTitle },
  { shared: { color: true } }
  // Error: 'color' is not a variant key on CardRoot
);
```

The `shared` config is validated against the Root component's actual variant keys. Only declared variants can be shared.

## Ref type narrowing

`.asElement()` narrows the ref type to match the HTML element:

```typescript
const Input = ds.styles({}).asElement('input');

const ref = useRef<HTMLInputElement>(null);
<Input ref={ref} />  // Correct: ref type matches 'input' element

const divRef = useRef<HTMLDivElement>(null);
<Input ref={divRef} />  // Error: HTMLDivElement is not assignable to HTMLInputElement
```

## Going further

- [Builder Chain reference](/docs/reference/builder-chain) -- full method signatures and types
- [Troubleshooting](/docs/support/troubleshooting) -- debugging in devtools, common issues

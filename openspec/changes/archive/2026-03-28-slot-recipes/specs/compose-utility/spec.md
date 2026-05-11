## compose() — Slot Composition Utility

### Overview

A utility function in `@animus-ui/system` that takes independently-authored Animus components and produces a sealed, namespaced component family with type-enforced shared variants and React context propagation.

### Function Signature

```ts
function compose<
  Slots extends Record<string, AnimusComponent<any, any, any, any, any, any, any, any>>,
  Shared extends readonly (SharedVariantKeys<Slots>)[]
>(
  slots: Slots,
  options: { shared: Shared }
): ComposedFamily<Slots, Shared>
```

### Type Constraints

#### SharedVariantKeys<Slots>

Derives the intersection of all variant prop names across all slot components. Only variant keys that exist on EVERY slot are valid `shared` entries:

```ts
type SharedVariantKeys<Slots> = keyof Intersection<VariantPropsOf<Slots[keyof Slots]>>
```

If `Root` has `size | variant` and `Control` has `size | checked`, then `SharedVariantKeys` = `'size'` (only `size` appears on all slots).

#### Variant Value Set Enforcement

For each key in `shared`, the variant value sets must be identical across all slots:

```ts
// Root:   size: 'sm' | 'md'
// Control: size: 'sm' | 'md'
// Label:  size: 'sm' | 'md'
compose({ Root, Control, Label }, { shared: ['size'] as const }) // OK

// Root:   size: 'sm' | 'md' | 'lg'
// Label:  size: 'sm' | 'md'
compose({ Root, Label }, { shared: ['size'] as const }) // TS ERROR
```

This is the compile-time guarantee against variant divergence.

#### VariantPropsOf<C>

Extracts the variant prop types from an `AnimusComponent`. Requires reading the `V` generic from the component type:

```ts
type VariantPropsOf<C> = C extends AnimusComponent<any, any, any, any, infer V, any, any, any>
  ? VariantProps<V>
  : never
```

### Output Type: ComposedFamily

```ts
type ComposedFamily<Slots, Shared> = {
  [K in keyof Slots as Capitalize<K & string>]: ComposedSlot<Slots[K], Shared>
}
```

Each slot becomes a capitalized property on the family (`root` → `Root`). If input keys are already capitalized, they pass through unchanged.

#### ComposedSlot

A sealed React component. Accepts the same props as the source component MINUS the shared variant props (which come from context instead of direct props):

```ts
type ComposedSlot<C, Shared> = ForwardRefExoticComponent<
  Omit<ComponentPropsOf<C>, Shared[number]> & { className?: string }
>
```

The Root slot is special — it KEEPS the shared variant props (it's the provider):

```ts
type ComposedRoot<C, Shared> = ForwardRefExoticComponent<
  ComponentPropsOf<C> & { className?: string; children?: ReactNode }
>
```

### Sealed Output

Composed slots are plain `ForwardRefExoticComponent` — NOT `AnimusComponent`. They have no `.extend()` method. The builder chain is closed.

To extend a composed family:
1. Extend the source slot builder (e.g., `CheckboxControl.extend()...`)
2. Call `compose()` again with the extended slot

### Runtime Behavior

#### Context

`compose()` creates a single React context per family:

```ts
const FamilyContext = createContext<Record<string, unknown>>({})
```

#### Root Component

The Root slot wraps its children in a context provider. The shared variant prop values are the context value:

```ts
// Generated Root wrapper (simplified)
const ComposedRoot = forwardRef((props, ref) => {
  const sharedValues = pick(props, sharedKeys)
  const ownProps = omit(props, sharedKeys)
  return (
    <FamilyContext.Provider value={sharedValues}>
      <OriginalRoot {...ownProps} {...sharedValues} ref={ref} />
    </FamilyContext.Provider>
  )
})
```

Root passes shared props BOTH to context (for children) AND to the original component (for its own variant resolution).

#### Child Slots

Child slots read shared variant values from context and merge with directly-passed props (direct props win):

```ts
// Generated child wrapper (simplified)
const ComposedChild = forwardRef((props, ref) => {
  const shared = useContext(FamilyContext)
  return <OriginalChild {...shared} {...props} ref={ref} />
})
```

Direct prop override: `<Checkbox.Control size="lg" />` overrides the context value. This is intentional — it allows per-slot exceptions.

### Extraction Compatibility

Zero extraction changes required. Each source slot is extracted independently by the Rust crate as a normal `AnimusComponent`. The `compose()` wrapper is invisible to extraction — it's a pure React wrapper around already-extracted components.

### Cross-Slot Compound Variants

Out of scope for `compose()`. Cross-slot conditional styling (e.g., "when `checked=true AND size=sm`, both control and label change") is a component-library concern handled via runtime logic in the component body.

### Edge Cases

- **Portal-mounted slots**: Slots rendered inside a React portal lose context. This is the standard React context limitation. Workaround: pass shared props directly to portal-mounted slots.
- **Nested families**: Two `compose()` families nested in the DOM use separate contexts. No collision.
- **Empty shared list**: `compose({ ... }, { shared: [] as const })` is valid — produces a namespaced family with no context wiring. Useful for pure organizational grouping.

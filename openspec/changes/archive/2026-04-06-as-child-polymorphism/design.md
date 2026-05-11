## Context

Animus components are created via `createComponent(element, className, config, ...)` in the runtime. At render time, `resolveClasses(className, props, config, ...)` produces `{ classes, dynamicStyle }`, then `createElement(renderElement, domProps)` renders the element. The `as` prop allows swapping `renderElement` at runtime but doesn't change the type signature — consumers lose type narrowing for the target element's attributes.

The `asChild` pattern (Radix, Ark, Melt) delegates rendering entirely to the child: the component resolves its styles, then merges className/ref/style onto the single child via `cloneElement`. The child keeps its own types and props.

`resolveClasses` already decouples style resolution from rendering. The asChild path only replaces the final `createElement` call — the rest of the runtime is unchanged.

## Goals / Non-Goals

**Goals:**
- Type-safe polymorphism via child delegation
- Ref composition (component ref + child ref both receive the element)
- className merging (Animus classes + child's existing className)
- Dynamic style merging (CSS variables + child's existing inline style)
- Coexistence with `as` prop (no deprecation, no breaking change)
- Works with compose() families (composed className merges onto child)

**Non-Goals:**
- Deprecating or removing the `as` prop
- Changing the extraction pipeline
- Event handler merging (Radix does this for interactive components — Animus components are styling primitives, not behavioral)
- Compile-time enforcement that children is a single element (runtime enforcement via `Children.only`, matching Radix precedent)
- Supporting `asChild` on `.asClass()` output (class resolvers don't render)

## Decisions

### 1. asChild branch in createComponent

When `props.asChild` is truthy, after resolveClasses:

```typescript
if (props.asChild) {
  const child = Children.only(props.children);
  if (!isValidElement(child)) {
    throw new Error('asChild requires a single React element as children');
  }
  return cloneElement(child, {
    ref: composeRefs(ref, (child as any).ref),
    className: [classes.join(' '), child.props.className].filter(Boolean).join(' '),
    ...(dynamicStyle || props.style ? {
      style: { ...child.props.style, ...props.style, ...prevDynStyle }
    } : {}),
  });
}
```

This is placed BEFORE the existing `createElement` call. The `asChild` prop is added to `filterProps` so it's never forwarded to the DOM.

Key: we do NOT forward any other props from the parent to the child. The parent's variant/state/system props are consumed by `resolveClasses` and converted to className. The child keeps its own props. Only className, ref, and style are merged.

### 2. composeRefs utility

A small utility that merges two refs (callback or object) into a single callback ref:

```typescript
function composeRefs<T>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
}
```

Placed in `runtime/index.ts` (private, not exported). ~5 lines.

### 3. `as` prop interaction

When both `asChild` and `as` are provided, `asChild` wins. The `as` prop is ignored. This matches Radix behavior. No warning — the two props serve different use cases and shouldn't be combined, but erroring would be overly strict.

### 4. Type system: `asChild?: boolean` on AnimusConsumerProps

Added alongside the existing `as` and `className` in the consumer props intersection. No conditional types — `children` remains `ReactNode` regardless. Runtime enforcement via `Children.only` is sufficient (Radix uses the same approach).

### 5. Prop forwarding: only merge className, ref, style

Unlike Radix's Slot (which merges all props), Animus asChild only merges styling concerns:
- `className` — the resolved Animus classes + child's existing
- `ref` — composed from forwarded ref + child's ref
- `style` — dynamic CSS variables + child's existing inline styles

We do NOT merge event handlers, data attributes, or aria attributes from the parent onto the child. Animus components are styling primitives — they don't carry behavioral props. If the consumer needs to pass `onClick` or `aria-label`, they put it on the child directly:

```tsx
<Button kind="ghost" asChild>
  <a href="/foo" onClick={handleClick} aria-label="Go">Link</a>
</Button>
```

This is simpler and more predictable than Radix's full prop merge. It also avoids the complexity of event handler chaining.

### 6. compose() interaction

Works naturally. When a composed slot uses `asChild`:

```tsx
<Card.Header asChild>
  <Link href="/details">Card title</Link>
</Card.Header>
```

Card.Header's className (base + variant classes from CSS cascade or context) gets merged onto the Link. The CSS cascade doesn't care about element type — it matches on class selectors.

## Risks / Trade-offs

- **[Risk] Children.only throws on fragments or multiple children**: This is intentional — `asChild` requires exactly one element child. The error message from React is clear. Could wrap with a more descriptive error.

- **[Trade-off] No event handler merging**: Unlike Radix Slot, we don't chain onClick/onFocus etc. Animus components are styling primitives, not interactive widgets. If this becomes a need (e.g., for composed families with behavioral concerns), we can add it later without breaking the existing API.

- **[Trade-off] Runtime-only children enforcement**: TypeScript can't enforce "exactly one ReactElement child" without making the children type incompatible with JSX's default ReactNode. Runtime enforcement via Children.only matches Radix precedent and keeps the type ergonomics simple.

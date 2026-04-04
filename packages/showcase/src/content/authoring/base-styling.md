# Base Styling

## Change the rendered element

Every component accepts an `as` prop to override the HTML element at the callsite:

```tsx
<Card as="section">Now renders as a section.</Card>
<Card as="a" href="/about">Now renders as a link.</Card>
```

The styles, variants, and states are preserved -- only the underlying DOM node changes. The `as` prop accepts any HTML tag or React component.

For strict polymorphism with full type narrowing, use `.extend().asElement()` to create a typed variant instead:

```typescript
const CardLink = Card.extend().asElement('a');
// <CardLink href="/about"> — href is typed, all Card styles inherited
```

## Pass custom class names

Consumer `className` is appended to the component's generated classes:

```tsx
<Card className="my-override">Merged class names.</Card>
```

Because Animus styles live inside `@layer` blocks, unlayered CSS (your plain `.my-override` class) naturally takes higher precedence in the cascade. Consumer overrides win without specificity tricks.

## Dynamic runtime styles

Animus extracts styles at build time. For truly dynamic values that can't be known at build time (mouse position, computed widths, progress percentages), use React's `style` prop:

```tsx
<Card style={{ width: `${progress}%` }}>
  Static Animus styles + dynamic inline style.
</Card>
```

The `style` prop is merged with any styles Animus manages at runtime. Consumer properties are applied last, so your values win for any property you set. This makes it safe to layer dynamic behavior on top of extracted styles without worrying about ordering.

## HTML attributes and event handlers

Standard HTML attributes, `data-*`, `aria-*`, and event handlers pass through to the DOM element. Animus only consumes its own managed props (variants, states, system props) -- everything else is forwarded.

```tsx
<Card
  id="main-card"
  data-testid="card"
  aria-label="Main content"
  onClick={handleClick}
>
  All attributes forwarded to the underlying div.
</Card>
```

## Going further

- [Variants & States](/docs/authoring/variants-states) -- add prop-driven style variants and boolean state flags
- [Builder Chain reference](/docs/reference/builder-chain) -- terminal methods, `as` prop typing, `.asComponent()` examples

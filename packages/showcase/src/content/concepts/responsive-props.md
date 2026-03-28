# Responsive Props

Any prop exposed by `.groups()` accepts either a scalar value or a breakpoint object. The key `_` is the base — applied without a media query. Named keys correspond to breakpoints defined in your system configuration. Both forms are valid on the same prop at the same time.

```tsx
// Scalar — applied at all breakpoints
<Text fontSize={14} />

// Breakpoint object — _ is base, named keys add media queries
<Text fontSize={{ _: 14, md: 16, lg: 18 }} />
```

Each unique prop/value/breakpoint triple generates exactly one utility class. Classes are de-duplicated globally — if two components both use `fontSize=16` at `md`, that class is emitted once and shared between them. The extracted CSS never grows proportionally to how many components use a given value.

```tsx
export const Article = ds
  .styles({ color: 'text' })
  .groups({ text: true, space: true })
  .asElement('article');

// _ is the base breakpoint — no media query.
// Named keys map to breakpoints in your system config.
<Article
  fontSize={{ _: 14, md: 16, lg: 18 }}
  px={{ _: 16, md: 48, lg: 80 }}
/>
```

```css
/* Base — no media query */
@layer system {
  .bp-fontSize-14 { font-size: 14px; }
  .bp-px-16       { padding-inline: 16px; }
}

/* md breakpoint */
@media (min-width: 768px) {
  @layer system {
    .bp-md-fontSize-16 { font-size: 16px; }
    .bp-md-px-48       { padding-inline: 48px; }
  }
}

/* lg breakpoint */
@media (min-width: 1024px) {
  @layer system {
    .bp-lg-fontSize-18 { font-size: 18px; }
    .bp-lg-px-80       { padding-inline: 80px; }
  }
}
```

# Animus — RFC: Architecture & Roadmap

> A zero-runtime, statically-extracted, type-safe CSS-in-JS design system framework for React.

**Status:** Request for Comment
**Consumer packages:** `@animus-ui/system` + `@animus-ui/vite-plugin`
**Runtime footprint:** 528 lines, 0 production dependencies, 0 effects hooks
**Extraction engine:** Rust (OXC parser + Lightning CSS)
**Cascade model:** 7 CSS `@layer` tiers with deterministic precedence

---

## Table of Contents

1. [The Trade](#1-the-trade)
2. [Getting Started](#2-getting-started)
3. [The Builder Chain](#3-the-builder-chain)
4. [Theme Architecture](#4-theme-architecture)
5. [System Model](#5-system-model)
6. [Component Composition](#6-component-composition)
7. [Extraction Pipeline](#7-extraction-pipeline)
8. [Runtime Audit](#8-runtime-audit)
9. [Bundler Integration](#9-bundler-integration)
10. [Roadmap](#10-roadmap)

---

## 1. The Trade

Static extraction is a strategic tradeoff. Every design decision in this framework flows from one thesis:

> **If you constrain style values to static literals, you can move CSS out of JavaScript entirely — and the constraint pays for itself.**

### What you give up

| Constraint | What it means in practice |
|-----------|--------------------------|
| **Static values only** | Prop values must be string/number/boolean literals. No `size={isLarge ? 'lg' : 'md'}` in JSX. |
| **Declarative builder chain** | Styles are defined via a chain API, not arbitrary functions. No `css={myFunction()}`. |
| **Build step required** | A Vite plugin (Rust-powered) runs at build time. There is no "just import and use" without a bundler. |
| **Finite variant space** | Variants must be enumerable at build time. You cannot generate variant names dynamically. |

### What you get back

| Benefit | How it works |
|---------|-------------|
| **Zero-runtime CSS** | All styles are extracted to static `.css` at build time. No style injection, no CSSOM manipulation, no hydration mismatch. |
| **Deterministic cascade** | 7 ordered `@layer` tiers guarantee precedence: `global → base → variants → compounds → states → system → custom`. No specificity wars. No `!important`. |
| **Type-safe tokens** | Scale values, token references, variant names, and state names are all validated at compile time via TypeScript's type system. |
| **Sub-kilobyte runtime** | The component runtime is pure class name resolution — string concatenation from a pre-computed lookup table. No effects, no DOM manipulation, no style objects. |
| **Predictable output** | Every component's CSS is traceable to a specific `@layer`. Every prop maps to a specific class. You can inspect the output and understand exactly what happened. |

### The dynamic escape hatch

When a prop value *is* dynamic (variable reference, function call, conditional), the system doesn't break — it degrades gracefully:

1. The extractor generates a **CSS variable slot** for that prop
2. The runtime sets the variable via `style` attribute at render time
3. The CSS still lives in the correct `@layer` — cascade ordering is preserved

This means you can mix static and dynamic props on the same component. Static props extract. Dynamic props fall back to CSS variables. The cascade remains correct in both cases.

---

## 2. Getting Started

Three concepts, one rendered component.

### Concept 1: Theme — your design tokens

```typescript
// src/ds.ts
import { createTheme, createSystem } from '@animus-ui/system';

const theme = createTheme()
  .addScale('space', { 0: '0px', 4: '4px', 8: '8px', 16: '16px', 24: '24px' })
  .addScale('fontSizes', { 12: '12px', 14: '14px', 16: '16px', 20: '20px' })
  .addScale('colors', {
    text: '#e4e4e7',
    'text-muted': '#a1a1aa',
    bg: '#09090b',
    surface: '#18181b',
    border: '#27272a',
    primary: '#6366f1',
  })
  .addBreakpoints({ sm: 768, md: 1024, lg: 1200 })
  .build();
```

### Concept 2: System — your prop vocabulary

```typescript
// src/ds.ts (continued)
import { space, typography, color, layout } from '@animus-ui/system/groups';

export const { system: ds, createGlobalStyles } = createSystem()
  .addGroup('space', space)
  .addGroup('text', typography)
  .addGroup('surface', { ...color, ...layout })
  .build();
```

The system registers **prop groups** — named collections of CSS properties that components can opt into. This is the vocabulary your components speak.

### Concept 3: Component — styles + variants + element

```typescript
// src/components/Divider.tsx
import { ds } from '../ds';

export const Divider = ds
  .styles({ width: '1px', bg: 'border', border: 'none', mx: 'auto' })
  .system({ space: true })
  .asElement('hr');
```

That's it. `Divider` is a React component. It renders an `<hr>` with extracted CSS classes. The `space` system group means it accepts `m`, `p`, `mx`, `py`, etc. as props. All values resolve through your theme's `space` scale.

### The Vite plugin

```typescript
// vite.config.ts
import { animusExtract } from '@animus-ui/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), animusExtract({ system: './src/ds.ts' })],
});
```

### The entry point

```typescript
// src/main.tsx
import 'virtual:animus/styles.css';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);
```

One import. The virtual module `virtual:animus/styles.css` contains all extracted CSS: token variables, global styles, and every component's cascade-layered rules.

### What happens at build time

```
┌──────────────────────────────────────────────────────────────┐
│                      Vite Build                              │
│                                                              │
│  1. Plugin loads your system module via subprocess           │
│  2. Rust crate parses every .tsx file via OXC                │
│  3. Builder chains are walked, styles evaluated statically   │
│  4. Theme scales resolve token values to CSS                 │
│  5. CSS generated into 7 @layer tiers                        │
│  6. Source files transformed: chains → createComponent()     │
│  7. Lightning CSS autoprefixes + minifies the output         │
│                                                              │
│  Input: TypeScript builder chains                            │
│  Output: Static CSS + lightweight React components           │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. The Builder Chain

The builder chain is the component authoring API. It's a fluent interface where each method adds a **cascade layer** to the component's styling. The order of methods maps directly to CSS specificity via `@layer`:

```
METHOD          → LAYER          PRECEDENCE
────────────────────────────────────────────
.styles()       → @layer base       lowest
.variant()      → @layer variants
.compound()     → @layer compounds
.states()       → @layer states
.system()       → @layer system
.props()        → @layer custom     highest
```

This isn't incidental — it's the core architectural contract. A variant can override a base style. A state can override a variant. A system prop can override a state. The cascade order is guaranteed because each method writes to a different `@layer`.

### Framework primitives vs consumer recipes

The examples below show the builder chain at increasing complexity. An important distinction: the framework provides **primitives** (methods, cascade layers, type enforcement). How consumers combine those primitives into patterns is their choice. Where an example demonstrates a consumer-discovered recipe rather than a framework-prescribed feature, it's labeled as such.

### Progressive complexity

The chain scales with your component's needs. Simple components use 1-2 methods. Complex components use more. The complexity is always proportional to the problem.

**Minimal — base styles + element**

```typescript
// 3 lines. Static styles, rendered as <hr>.
export const Divider = ds
  .styles({ width: '1px', bg: 'border', border: 'none', mx: 'auto' })
  .asElement('hr');
```

**Variants — prop-driven style branching**

```typescript
// Each .variant() adds a typed prop to the component.
// Variant values are enumerated — TypeScript enforces valid values.
export const Button = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    border: 'none',
    '&:focus-visible': {
      outline: '2px solid {colors.primary}',
      outlineOffset: '2px',
    },
  })
  .variant({
    prop: 'kind',
    variants: {
      fill: { bg: 'primary', color: 'text' },
      outline: { borderWidth: '1px', borderStyle: 'solid', borderColor: 'primary', color: 'primary' },
      ghost: { color: 'primary' },
    },
    defaultVariant: 'fill',
  })
  .variant({
    prop: 'size',
    variants: {
      sm: { px: 8, py: 4, fontSize: 12 },
      md: { px: 16, py: 8, fontSize: 14 },
      lg: { px: 24, py: 12, fontSize: 16 },
    },
    defaultVariant: 'md',
  })
  .asElement('button');

// Usage: <Button kind="outline" size="lg">Submit</Button>
// TypeScript: kind accepts 'fill' | 'outline' | 'ghost', nothing else.
```

**States — data-attribute selectors**

```typescript
// .states() creates CSS that activates on data-state="name" attributes.
// Toggle states imperatively without touching CSS.
export const RevealBlock = ds
  .styles({
    opacity: '0',
    transform: 'translateY(24px)',
    transition: 'opacity 0.8s ease, transform 0.8s ease',
  })
  .states({
    visible: { opacity: '1', transform: 'translateY(0)' },
  })
  .asElement('div');

// Usage: <RevealBlock data-state={isVisible ? 'visible' : undefined} />
```

**Recipe: element polymorphism via the `as` prop**

Every Animus component accepts an `as` prop that swaps the rendered element — this is a framework primitive. Independently, `.variant()` lets you name your variant prop anything you want. A consumer can combine these two primitives by naming a variant `as`, which couples element swapping with style branching:

```typescript
// This is a consumer recipe, not a framework feature.
// The framework provides: (1) `as` prop for element swapping, (2) `.variant()` with any prop name.
// The consumer chose to combine them.
const Heading = ds
  .styles({
    fontFamily: 'display',
    fontWeight: 500,
    color: 'text',
    m: 0,
  })
  .variant({
    prop: 'as',
    defaultVariant: 'h2',
    variants: {
      h1: { fontSize: 24, mt: 0, mb: 24 },
      h2: { fontSize: 20, mt: 48, mb: 16 },
      h3: { fontSize: 16, color: 'text-muted', mt: 32, mb: 12 },
      h4: { fontSize: 14, color: 'text-muted', mt: 24, mb: 8 },
    },
  })
  .asElement('h2');

// <Heading as="h1">Title</Heading> — renders <h1> with h1 styles.
// The `as` prop does double duty: swaps element (framework) + selects variant (consumer choice).
```

**System groups — opt-in runtime prop flexibility**

```typescript
// .system() activates prop groups for runtime use.
// Only the groups you activate generate utility classes.
export const Prose = ds
  .styles({ fontFamily: 'body', lineHeight: 'relaxed', color: 'text-muted', m: 0 })
  .system({ text: true, surface: true, space: true })
  .asElement('p');

// <Prose fontSize={20} color="primary" mt={16}>...</Prose>
// Each prop resolves through its scale. fontSize=20 → '20px' from fontSizes scale.
```

**Custom props — component-specific properties**

```typescript
// .props() defines properties unique to this component.
// They can have their own inline scales, transforms, and CSS targets.
export const Logo = ds
  .styles({ fontFamily: 'logo', fontWeight: 700 })
  .props({
    logoSize: {
      property: 'fontSize',
      scale: { xs: 28, sm: 32, md: 64, lg: 72, xl: 96, xxl: 128 },
    },
  })
  .asElement('h1');

// <Logo logoSize="xl" /> — fontSize: 96px, but only on Logo.
```

**Compound variants — conditional style overrides**

```typescript
// .compound() applies styles when multiple variant conditions are met simultaneously.
const Tag = ds
  .styles({ display: 'inline-flex', px: 8, py: 4, borderRadius: 4 })
  .variant({
    prop: 'color',
    variants: { neutral: { bg: 'surface' }, danger: { bg: 'red-100' } },
  })
  .variant({
    prop: 'outlined',
    variants: { true: { bg: 'transparent', border: 1 }, false: {} },
  })
  .compound({
    conditions: { color: 'danger', outlined: 'true' },
    styles: { borderColor: 'red-400', color: 'red-400' },
  })
  .asElement('span');
```

### Token references

Style values can reference theme tokens using `{scale.path}` syntax. These resolve to CSS `var()` references at build time:

```typescript
.styles({
  color: 'primary',                           // → var(--colors-primary)
  bg: 'surface',                              // → var(--colors-surface)
  border: 1,                                  // → 1px solid currentColor (via transform)
  boxShadow: '0 4px 12px {colors.primary/20}', // → 0 4px 12px var(--colors-primary / 0.2)
  scrollMarginTop: 'calc({sizes.navHeight} + 16px)', // → calc(var(--sizes-navHeight) + 16px)
})
```

The `{scale.path/opacity}` syntax is supported for color tokens — it generates CSS color-mix or variable-based opacity.

### Pseudo-selectors and nested rules

Base styles support standard CSS nesting:

```typescript
.styles({
  color: 'text',
  '&:hover': { color: 'primary' },
  '&:focus-visible': { outline: '2px solid {colors.primary}', outlineOffset: '2px' },
  '&::before': { content: '""', position: 'absolute' },
  '&:disabled': { opacity: '0.4', pointerEvents: 'none' },
  '&[data-state="active"]': { transform: 'scale(0.98)' },
})
```

---

## 4. Theme Architecture

The theme defines your design tokens — scales of values that components reference by name. It's built with `createTheme()` and evaluated at build time in a subprocess. **Zero bytes of theme code ship to the browser.** The theme becomes CSS variables.

### Token scales

```typescript
const theme = createTheme()
  .addScale('space', {
    0: '0px', 4: '4px', 8: '8px', 12: '12px', 16: '16px',
    24: '24px', 32: '32px', 48: '48px', 64: '64px',
  })
  .addScale('fontSizes', { 12: '12px', 14: '14px', 16: '16px', 20: '20px', 24: '24px' })
  .addScale('radii', { none: '0', sm: '4px', md: '8px', lg: '12px', full: '9999px' })
  .addScale('colors', {
    text: '#e4e4e7',
    bg: '#09090b',
    primary: '#6366f1',
    // ... palettes with numbered stops (50-950)
  })
  .build();
```

Each `.addScale()` call defines a named collection of tokens. The scale name determines which CSS properties can reference it — `space` feeds `margin`, `padding`, `gap`; `colors` feeds `color`, `backgroundColor`, `borderColor`; etc.

Scale values are emitted as CSS custom properties at `:root`:

```css
:root {
  --space-0: 0px;
  --space-4: 4px;
  --space-8: 8px;
  --colors-text: #e4e4e7;
  --colors-bg: #09090b;
  --colors-primary: #6366f1;
  /* ... */
}
```

### Color modes

Color modes are semantic token overrides scoped to `[data-color-mode="name"]` selectors:

```typescript
const theme = createTheme()
  .addScale('colors', { /* base palette */ })
  .addColorModes({
    default: 'dark',
    modes: {
      dark: {
        text: '{gray-200}',
        bg: '{gray-950}',
        primary: '{violet-500}',
        surface: '{gray-900}',
      },
      light: {
        text: '{gray-800}',
        bg: '{gray-50}',
        primary: '{violet-600}',
        surface: '{white}',
      },
    },
  })
  .build();
```

This generates:

```css
[data-color-mode="dark"] {
  --colors-text: var(--colors-gray-200);
  --colors-bg: var(--colors-gray-950);
  --colors-primary: var(--colors-violet-500);
}
[data-color-mode="light"] {
  --colors-text: var(--colors-gray-800);
  --colors-bg: var(--colors-gray-50);
  --colors-primary: var(--colors-violet-600);
}
```

Color mode switching is pure CSS — set `data-color-mode` on the root element. No JavaScript re-render. No flash of wrong theme.

### Contextual variables

The framework primitive: `addContextualVars()` generates CSS variables that automatically track the most recently set value of a scale token as it inherits through the DOM tree.

```typescript
const theme = createTheme()
  // ...scales and modes...
  .addContextualVars({ colors: ['bg'] })
  .build();
```

This generates a `current-bg` variable that updates whenever any component in the subtree sets `bg`. The variable inherits downward via standard CSS inheritance.

**Recipe:** A consumer can reference `current-bg` in borders, shadows, or overlays to create contrast-aware styling that adapts to whatever background is set above it in the tree — without the component knowing which specific color that is. The framework provides the tracking mechanism; the consumer decides what to track and how to use the tracked value.

### Breakpoints

Breakpoints are fully configurable:

```typescript
const theme = createTheme()
  .addBreakpoints({ sm: 768, md: 1024, lg: 1200 })
  .build();
```

These breakpoints define the responsive prop syntax. Any system prop or variant can receive a breakpoint-keyed object:

```tsx
<Box p={{ _: 8, sm: 16, md: 24 }} />
```

This generates:

```css
.animus-Box-abc12345 { padding: 8px; }
@media (min-width: 768px) { .animus-Box-abc12345 { padding: 16px; } }
@media (min-width: 1024px) { .animus-Box-abc12345 { padding: 24px; } }
```

The breakpoint names and values are reflected in the TypeScript types — `ResponsiveProp<T>` only accepts keys that exist in your configured breakpoints. Add or remove breakpoints and the types expand or contract accordingly via `Theme` interface augmentation.

---

## 5. System Model

The system is where you define your design system's **prop vocabulary** — the set of CSS properties that components can use as React props.

### Creating a system

```typescript
import { createSystem } from '@animus-ui/system';
import { space, typography, color, flex, grid } from '@animus-ui/system/groups';

export const { system: ds, createGlobalStyles } = createSystem()
  .addGroup('space', space)
  .addGroup('text', typography)
  .addGroup('surface', { ...color, ...flex })
  .addGroup('layout', { ...grid })
  .addProps({
    ratio: { property: 'aspectRatio', transform: myTransform },
  })
  .build();
```

> **Note:** The group names above (`space`, `text`, `surface`, `layout`) and their compositions (`{ ...color, ...flex }`) are consumer choices — not framework prescriptions. The framework ships pre-built prop collections (`space`, `typography`, `color`, `flex`, `grid`, etc.) as raw building blocks. How you name your groups and which props you bundle together is entirely your decision.

`createSystem()` returns a `SystemBuilder` with two registration methods:

- **`.addGroup(name, props)`** — Register a named collection of props. Components activate groups by name: `.system({ space: true })`.
- **`.addProps(props)`** — Register individual props not belonging to any group. Components activate them by name: `.system({ ratio: true })`.

### Namespace isolation

Group names and prop names occupy disjoint namespaces. The system enforces this at both the type level and runtime:

```typescript
createSystem()
  .addGroup('space', spaceGroup)
  .addProps({ space: { property: 'gap' } })
  // ❌ TypeScript error: 'space' collides with group name

createSystem()
  .addProps({ gap: { property: 'gap' } })
  .addGroup('gap', { p: { property: 'padding' } })
  // ❌ TypeScript error: 'gap' collides with prop name
```

### Mixed namespace activation

Components can activate both groups and individual props in the same `.system()` call:

```typescript
const Card = ds
  .styles({ /* ... */ })
  .system({ space: true, surface: true, ratio: true })
  .asElement('div');

// Card accepts all props from 'space' group + all from 'surface' group + 'ratio' individually.
```

### Prop definition

Each prop maps a React prop name to a CSS property, with optional scale binding and value transformation:

```typescript
{
  p: { property: 'padding', scale: 'space' },                    // scale-bound
  bg: { property: 'backgroundColor', scale: 'colors' },          // scale-bound
  border: { property: 'border', transform: borderShorthand },     // transformed
  ratio: { property: 'aspectRatio' },                             // direct passthrough
  pull: { property: 'marginTop', scale: 'space', negative: true }, // negated scale
}
```

When a prop is scale-bound, its values are looked up in the theme scale. `p={16}` with `scale: 'space'` resolves to `var(--space-16)`. When a transform is attached, the raw value passes through the transform function before becoming CSS.

### Pre-built prop groups

The system ships with 13 pre-built prop groups covering standard CSS domains:

| Group | Props | Example |
|-------|-------|---------|
| `space` | m, p, mx, my, mt, mb, ml, mr, px, py, pt, pb, pl, pr, gap | `<Box p={16} mx="auto" />` |
| `typography` | fontSize, fontFamily, fontWeight, lineHeight, letterSpacing, textAlign, textDecoration | `<Text fontSize={14} fontWeight={500} />` |
| `color` | color, bg, borderColor, gradient, opacity | `<Box bg="surface" color="text" />` |
| `flex` | flexDirection, flexWrap, alignItems, justifyContent, gap | `<Flex alignItems="center" gap={8} />` |
| `grid` | gridTemplateColumns, gridTemplateRows, gridArea | `<Grid gridTemplateColumns="1fr 1fr" />` |
| `layout` | display, width, height, overflow, minWidth, maxWidth | `<Box w={200} display="flex" />` |
| `border` | borderWidth, borderStyle, borderColor, borderRadius | `<Box rounded="md" border={1} />` |
| `positioning` | position, top, right, bottom, left, zIndex | `<Box pos="absolute" top={0} />` |
| `shadows` | boxShadow, textShadow | `<Card shadow="lg" />` |
| `background` | backgroundImage, backgroundSize, backgroundRepeat, backgroundPosition | `<Box bgImage="url(...)" />` |
| `transitions` | transition, animation | `<Box transition="all 0.2s ease" />` |
| `mode` | mode (color mode selector) | `<Box mode="dark" />` |
| `vars` | vars (CSS variable injection) | `<Box vars={{ '--custom': 'value' }} />` |

These are **building blocks**, not prescriptive groups. You choose which to register, how to name your groups, and how to compose them. `{ ...color, ...flex }` bundled into a group called `surface` is a consumer choice — the framework doesn't prescribe group composition or naming. Unregistered groups don't exist — no code, no types, no CSS generated.

### Global styles

`createGlobalStyles` (returned from `.build()` alongside `system`) creates global CSS blocks:

```typescript
export const globalStyles = createGlobalStyles({
  '*, *::before, *::after': { boxSizing: 'border-box' },
  body: { fontFamily: 'body', bg: 'bg', color: 'text', m: 0 },
  '::selection': { bg: 'primary', color: 'text' },
  '@keyframes fadeIn': {
    from: { opacity: '0' },
    to: { opacity: '1' },
  },
});
```

Global styles use the same prop shorthand as components (`bg` → `backgroundColor`, scale lookups, token refs). They're exported as a const — the Vite plugin discovers them automatically via module export scanning. No manual registration needed.

---

## 6. Component Composition

For multi-slot components (Card, Dialog, Tabs), Animus provides `compose()`:

```typescript
import { compose } from '@animus-ui/system';
import { ds } from '../ds';

// Define each slot independently
const CardRoot = ds
  .styles({ display: 'flex', flexDirection: 'column', color: 'text' })
  .variant({
    prop: 'density',
    variants: {
      compact: { p: 12, gap: 4 },
      comfortable: { p: 24, gap: 12 },
    },
    defaultVariant: 'comfortable',
  })
  .variant({
    prop: 'variant',
    variants: {
      elevated: { bg: 'surface', border: 1, borderColor: 'border', boxShadow: 'glow-accent' },
      outlined: { bg: 'transparent', border: 1, borderColor: 'border' },
      ghost: { bg: 'transparent', border: 1, borderColor: 'transparent' },
    },
    defaultVariant: 'elevated',
  })
  .asElement('article');

const CardHeader = ds
  .styles({ display: 'flex', alignItems: 'center', fontWeight: 500, color: 'text' })
  .variant({
    prop: 'density',
    variants: {
      compact: { fontSize: 13, pb: 4 },
      comfortable: { fontSize: 16, pb: 8 },
    },
    defaultVariant: 'comfortable',
  })
  .asElement('header');

const CardBody = ds
  .styles({ color: 'text-muted', lineHeight: 'relaxed' })
  .variant({
    prop: 'density',
    variants: {
      compact: { fontSize: 12 },
      comfortable: { fontSize: 14 },
    },
    defaultVariant: 'comfortable',
  })
  .asElement('div');

const CardFooter = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: 'current-bg',
  })
  .variant({
    prop: 'density',
    variants: {
      compact: { gap: 6, pt: 8, mt: 4, fontSize: 12 },
      comfortable: { gap: 12, pt: 16, mt: 8, fontSize: 13 },
    },
    defaultVariant: 'comfortable',
  })
  .asElement('footer');

// Compose into a family with shared variant propagation
export const Card = compose(
  { Root: CardRoot, Header: CardHeader, Body: CardBody, Footer: CardFooter },
  { shared: { density: true } }
);
```

### How `compose()` works

```
┌──────────────────────────────────────────────────────────────────┐
│  <Card.Root density="compact" variant="outlined">               │
│    ┌────────────────────────────────────────────────────────┐    │
│    │  <Card.Header>Title</Card.Header>                     │    │
│    │  density="compact" inherited via React context         │    │
│    ├────────────────────────────────────────────────────────┤    │
│    │  <Card.Body>Content here</Card.Body>                  │    │
│    │  density="compact" inherited via React context         │    │
│    ├────────────────────────────────────────────────────────┤    │
│    │  <Card.Footer>Actions</Card.Footer>                   │    │
│    │  density="compact" inherited via React context         │    │
│    └────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

- The `Root` slot is the **context provider**. Shared variants set on Root propagate to all children.
- Child slots **receive shared variants via React context** — no prop drilling.
- Each slot maintains its own `@layer` cascade independently — composition doesn't flatten specificity.
- The `shared` config is **type-enforced**: you can only share variant props that exist on every slot with matching value sets.
- Non-shared variants remain slot-local. `variant="outlined"` only applies to Root because only Root defines it.

### Compared to other composition models

| Feature | Animus `compose()` | Panda `sva()` | Chakra `defineSlotRecipe` | Vanilla Extract `recipe()` |
|---------|-------------------|---------------|--------------------------|---------------------------|
| Independent slot authoring | ✓ Each slot is a standalone component | ✗ Slots defined in one config object | ✗ Slots defined in one config object | ✗ Single recipe config |
| Cascade isolation per slot | ✓ Each slot has its own `@layer` stack | ✗ Shared specificity space | ✗ Shared specificity space | N/A (no cascade model) |
| Type-safe shared variants | ✓ Compile-time enforcement | ✓ Runtime only | Partial | ✗ |
| Context propagation | ✓ React context | ✗ Manual | ✓ React context | ✗ Manual |
| Slots usable standalone | ✓ They're regular components | ✗ | ✗ | ✗ |

---

## 7. Extraction Pipeline

The extraction pipeline is the build-time engine that converts builder chains into static CSS. It runs in Rust via NAPI, using the OXC parser for TypeScript/JSX analysis.

### What gets extracted

The extractor walks builder chain method calls and evaluates their arguments statically:

```
EXTRACTABLE VALUES (static literals)
═══════════════════════════════════════════════════
  String:     "primary", "1px solid", "center"
  Number:     16, 0.5, -8
  Boolean:    true, false
  Null:       null
  Negative:   -16 (unary negation of numeric)
  Object:     { sm: 768, md: 1024 } (if all values static)
  Template:   `1px solid` (no interpolations only)
```

```
NON-EXTRACTABLE VALUES (dynamic fallback)
═══════════════════════════════════════════════════
  Variable:       size={myVar}           → CSS variable slot
  Conditional:    size={x ? 'lg' : 'sm'} → CSS variable slot
  Function call:  size={getSize()}       → CSS variable slot
  Spread:         {...props}             → silently skipped (correct behavior)
  Member access:  size={obj.size}        → CSS variable slot
  Template+expr:  size={`${base}px`}     → CSS variable slot
```

### The three-tier diagnostic model

The extraction pipeline never produces wrong output silently. Every prop encounter has one of three outcomes:

| Outcome | What happens | When | Visibility |
|---------|-------------|------|-----------|
| **Extracted** | Static value → utility class in correct `@layer` | Value is a static literal | Verbose log |
| **Dynamic fallback** | CSS variable slot generated, runtime sets `--var` | Value is a dynamic expression | Verbose log |
| **Bail** | Component not extracted, warning emitted | Chain can't be resolved | **Always-on warning** |

Bail warnings fire unconditionally — you don't need verbose mode to see them:

```
[animus] ⚠ MyComponent not extracted: chain root not found
[animus] ⚠ MyComponent variant 'size' pruned: non-static variant values
```

### Strict mode

For CI pipelines, enable `strict: true` in the plugin config. This promotes all warnings to errors — a bail that would be a terminal warning in development becomes a build failure in CI:

```typescript
animusExtract({
  system: './src/ds.ts',
  strict: true, // CI: throw on any extraction failure
});
```

### The serialization boundary

The system configuration crosses a TS → JSON → Rust boundary at build time:

```
TypeScript (SystemBuilder)
    │
    ├─ .serialize() → JSON
    │   ├─ propConfig: { name → { property, scale?, transform? } }
    │   ├─ groupRegistry: { groupName → [propName, ...] }
    │   └─ transforms: { name → function }
    │
    ▼
Rust (project_analyzer)
    │
    ├─ Parses JSON config
    ├─ Parses all .tsx via OXC
    ├─ Walks chains, evaluates styles, resolves tokens
    ├─ Generates CSS into @layer tiers
    │
    ▼
JSON Manifest → back to TypeScript
    │
    ├─ components: { name → { className, variants, states, ... } }
    ├─ css: complete @layer-structured stylesheet
    ├─ utilities: { className → css declaration }
    ├─ report: { extracted, total, pruned, eliminated }
    └─ diagnostics: [{ file, component, kind, message }]
```

The manifest contains everything needed for both the virtual CSS module and the per-file source transformations.

### Source transformation

Each source file containing builder chains is transformed. The builder chain is replaced with a `createComponent()` call:

```typescript
// Before (authored)
export const Box = ds.styles({ p: 16 }).asElement('div');

// After (transformed)
import { createComponent } from '@animus-ui/system';
export const Box = createComponent('div', 'animus-Box-a1b2c3d4', {
  variants: {},
  states: {},
  defaultVariants: {},
  compoundVariants: [],
});
```

The transformed code is what ships to the browser. The builder chain, theme, system, and all build-time dependencies are tree-shaken.

---

## 8. Runtime Audit

This section documents exactly what ships to the browser.

### File inventory

| File | Lines | Purpose |
|------|-------|---------|
| `runtime/index.ts` | 126 | `createComponent()` — React component factory |
| `runtime/resolveClasses.ts` | 258 | Class name resolution from variant/state/prop config |
| `runtime/createClassResolver.ts` | 32 | Framework-agnostic class resolver (no React) |
| `compose.ts` | 112 | `compose()` — multi-slot composition with React context |
| **Total** | **528** | |

### Browser APIs used

| API | Where | Why |
|-----|-------|-----|
| `React.createElement` | createComponent | Render the element |
| `React.forwardRef` | createComponent | Pass refs through |
| `React.useRef` | createComponent | Memoize dynamic style objects |
| `React.createContext` | compose | Shared variant context |
| `React.useContext` | compose | Consume shared variants |

### Browser APIs NOT used

- No `useEffect`, `useLayoutEffect`, `useInsertionEffect`
- No `document`, `window`, `navigator`
- No `CSSStyleSheet`, `insertRule`, `adoptedStyleSheets`
- No `MutationObserver`, `ResizeObserver`, `IntersectionObserver`
- No dynamic `import()`, no `fetch`, no `XMLHttpRequest`

### Dependencies

```json
{
  "dependencies": {},
  "peerDependencies": { "react": "^18.0.0 || ^19.0.0" }
}
```

Zero production dependencies. React is the only peer dependency.

### What `createComponent` does at render time

```typescript
// Pseudocode of the render path:
function render(props) {
  // 1. Separate variant/state/system props from HTML props
  // 2. Look up class names from pre-computed config
  //    - Base class: always applied
  //    - Variant classes: lookup[propName][value] → className
  //    - State classes: if data-state includes name → className
  //    - System prop classes: lookup[propName][value] → className
  // 3. Join all class names with space
  // 4. Pass remaining props + className to React.createElement
  return createElement(element, { ...htmlProps, className });
}
```

This is **string concatenation from a lookup table**. No style computation. No CSS generation. No DOM measurement. The lookup table is the pre-computed config injected by the source transformation.

---

## 9. Bundler Integration

### Shipped: Vite

Animus ships a first-class Vite plugin. Minimum configuration:

```typescript
// vite.config.ts
import { animusExtract } from '@animus-ui/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), animusExtract({ system: './src/ds.ts' })],
});
```

Full configuration options:

```typescript
animusExtract({
  // Required: path to your system module
  system: './src/ds.ts',

  // File discovery
  include: ['src/**/*.{ts,tsx}'],
  exclude: ['**/*.test.*', '**/*.spec.*'],
  packagePatterns: ['@animus-ui/*'], // workspace packages to analyze

  // CSS output
  prefix: 'my-ds',    // Namespace: --my-ds-colors-primary, my-ds-Button-hash
  targets: '> 0.5%',  // Browserslist for autoprefixing
  minify: true,        // CSS minification (default: prod only)

  // Custom cascade layers (must include all 7 Animus layers in order)
  layers: ['reset', 'global', 'base', 'variants', 'compounds', 'states', 'system', 'custom', 'overrides'],

  // Diagnostics
  strict: true,  // Throw on extraction failures (CI)
  verbose: true, // Enable phase checkpoints + timing
});
```

#### Dev server

The dev server runs the full extraction pipeline at `buildStart` and serves CSS via virtual modules. HMR is surgical:

- **Component file changes** → re-extract affected component, hot-replace CSS via adopted stylesheets
- **System file changes** → geological reset: full re-analysis via subprocess
- **Content-hash diffing** → unchanged files are skipped (no redundant work)

#### Production build

Production builds go through Lightning CSS for autoprefixing and minification. The output is a single CSS file with all `@layer` declarations.

### Planned: Next.js

The `distribution-pipeline` proposal covers Next.js support:

- **Webpack plugin + loader** for Pages Router and App Router
- **Configurable `EmitterConfig`** in the Rust crate so the Next.js plugin can inject real file paths instead of Vite virtual modules
- **React 19 migration** — `forwardRef` → ref-as-prop, enabling React Server Components without `"use client"` boundaries
- Target packages: `@animus-ui/next-plugin`

### Planned: Route-level CSS splitting

The `route-css-splitting` proposal enables per-route CSS chunks:

- Component CSS is hash-scoped — class selectors can't cascade-conflict across routes
- Shared components are deduplicated across chunks
- The `@layer` declaration appears once in the entry chunk; route chunks contain only their components' rules
- Prerequisite: `tiered-cascade-key` (shorthand-aware sort keys for cascade correctness across unordered chunks)

---

## 10. Roadmap

### Active — In Design or Proposed

| Proposal | Summary | Impact |
|----------|---------|--------|
| **distribution-pipeline** | Next.js webpack plugin, React 19 ref-as-prop, EmitterConfig configurable | Unblocks Next.js adoption |
| **route-css-splitting** | Per-route CSS chunks with hash-scoped selectors | Production performance at scale |
| **tiered-cascade-key** | Shorthand-aware sort keys for cascade correctness across chunks | Prerequisite for splitting |
| **group-scale-factories** | Parameterized prop group factories for consumer scale customization | DX flexibility |
| **selector-registry** | `.addSelectors()` for named CSS selector shorthand vocabulary | Authoring ergonomics |
| **color-token-ref-types** | `{colors.X/alpha}` token ref syntax validated in TypeScript | Type safety completeness |
| **animus-provider** | Typed import anchor for distributed consumption | Multi-package adoption |
| **integration-test-workspace** | Dedicated consumer-perspective test workspace | Infrastructure quality |

### Near-term — Iceboxed but Scoped

| Item | Summary | Status |
|------|---------|--------|
| **Scale rebinding** | Pre-built group scale bindings for distribution | Needs design spike |
| **Incremental extraction** | Two-track dev/prod architecture (fast dev, full prod) | Scoped, not started |
| **Token-aware CSSTypes** | Template literal type caching for CSS value validation | Performance investigation needed |

### Documentation — Planned

Comprehensive documentation is planned as a dedicated effort, covering:

- Getting started guide
- Builder chain reference
- Theme configuration
- System registration
- Composition patterns
- Extraction constraints and diagnostics
- Migration guides (from styled-components, Tailwind, CSS modules)
- API reference (auto-generated from types)

---

## Appendix A: Cascade Layer Reference

```css
@layer global, base, variants, compounds, states, system, custom;
```

| Layer | Source | Precedence | Content |
|-------|--------|-----------|---------|
| `global` | `createGlobalStyles()` | Lowest | Reset, typography, keyframes |
| `base` | `.styles()` | ↑ | Component base styles |
| `variants` | `.variant()` | ↑ | Variant option styles |
| `compounds` | `.compound()` | ↑ | Multi-condition overrides |
| `states` | `.states()` | ↑ | Data-attribute state styles |
| `system` | `.system()` | ↑ | System prop utility classes |
| `custom` | `.props()` | Highest | Custom prop utility classes |

Higher-precedence layers override lower ones regardless of source order or selector specificity. This is the W3C CSS Cascade Layers specification — not a framework convention.

### Layer interaction example

```
Component: Button with kind="fill" + size="lg" + p={32} via system

  @layer base     → display: inline-flex; cursor: pointer;
  @layer variants → background: var(--colors-primary);    ← kind="fill"
                    padding: 24px; font-size: 16px;       ← size="lg"
  @layer system   → padding: 32px;                        ← p={32} overrides size padding
```

The system layer (`p={32}`) overrides the variant layer (`size="lg"` sets padding to 24px) — because `@layer system` has higher precedence than `@layer variants`. This is deterministic and inspectable.

## Appendix B: Class Name Format

```
{prefix}-{ComponentName}-{contentHash}              Base class
{prefix}-{ComponentName}-{contentHash}--{prop}-{val} Variant class
{prefix}-{ComponentName}-{contentHash}--{state}      State class
{prefix}-u-{prop}-{valueHash}                        System utility class
{prefix}-dyn-{prop}                                  Dynamic slot class
```

Class names are content-hashed for cache stability. Renaming a variable that holds a component doesn't change the hash — the hash is derived from the component's style content, not its binding name.

## Appendix C: Type Safety Depth

Animus validates at compile time:

| What | How | Example error |
|------|-----|---------------|
| Variant values | Literal union from `variants` keys | `kind="invalid"` → TS error |
| Scale token names | `Theme` augmentation narrows accepted values | `color="nonexistent"` → TS error |
| Token ref paths | `ValidateScaleRef` checks `{scale.key}` paths | `'{colors.missing}'` → TS error |
| Breakpoint keys | `Breakpoints` type from `createTheme` | `p={{ xxl: 16 }}` → TS error (if no `xxl` breakpoint) |
| Group/prop collision | `Partial<Record<Extract<keyof GroupReg, string>, never>>` | Adding prop `'space'` when group `'space'` exists → TS error |
| Compound conditions | Condition keys must match existing variant props | `conditions: { invalid: 'x' }` → TS error |
| Shared variant keys | `compose()` enforces matching value sets across slots | Sharing `density` when a slot is missing it → TS error |

These are **negative type tests** — the system doesn't just accept valid input, it actively rejects invalid input at compile time. The type test suite uses `@ts-expect-error` assertions to verify rejection.

# Animus V1 — FAQ

## What Is This

Animus is a zero-runtime CSS-in-JS system that statically extracts styles at build time via a Rust NAPI crate. You define themes, prop vocabularies, and component styles using TypeScript builder chains; the extraction plugin compiles them into `@layer`-structured CSS with deterministic cascade ordering. It requires a bundler plugin (Vite or Next.js) and produces standard CSS — no style computation happens at render time.

## How It Works

1. **Builder chains describe styles** — `createTheme()` defines tokens, `createSystem()` defines prop vocabularies, `ds.styles()` defines components. All static, all type-safe.
2. **Rust crate extracts at build time** — The extraction pipeline walks your AST, evaluates static style objects, resolves token references to CSS variables, and emits `@layer`-structured CSS.
3. **Seven cascade layers enforce specificity** — `global → base → variants → compounds → states → system → custom`. Layer position determines priority, not selector specificity.
4. **Zero runtime means zero style computation** — The 128-line runtime is pure string lookup: map props to pre-computed class names, filter non-DOM props, forward ref. No hooks, no CSSOM, no browser APIs beyond `className`.
5. **Graceful degradation for dynamic values** — Static values become utility classes. Non-static values (variables, conditionals) degrade to CSS variable slots with runtime setting. Truly unresolvable patterns bail with a diagnostic. See RFC.md §7: Extraction Pipeline.

## Common Misconceptions

### "Token ref opacity syntax is dead code in createTheme.ts"

- **Claim**: The `{colors.x/40}` opacity modifier appears unused or dead in theme creation code.
- **Truth**: Token ref opacity is resolved in two places, neither of which is `createTheme.ts`:
  - The **Rust crate** handles it during extraction via `resolve_single_alias` in `theme_resolver.rs`, emitting `color-mix(in srgb, var(--color-x) 40%, transparent)`.
  - The **TS pipeline** handles it for global styles via `resolveTokenAliases` in `extract/pipeline/resolve-global-styles.ts`, using the same `color-mix` formula.
- **Verify**: `grep -r "color-mix" packages/extract/src/theme_resolver.rs` and `grep "color-mix" packages/extract/pipeline/resolve-global-styles.ts`

### "includes() is a runtime no-op — must be a bug"

- **Claim**: `SystemBuilder.includes()` returns `this` unchanged, so it does nothing.
- **Truth**: `includes()` is a **by-design AST marker**. At build time, `extractSystemFilePackages` in `extract/pipeline/discover-packages.ts` parses the `.includes([...])` call syntax to discover external DS package dependencies. The runtime no-op is intentional — extraction reads the source code, not the runtime behavior.
- **Verify**: `grep "extractSystemFilePackages" packages/extract/pipeline/discover-packages.ts` and `grep "includes" packages/system/src/SystemBuilder.ts`

### "Module augmentation is an unusual pattern"

- **Claim**: `declare module '@animus-ui/system' { interface Theme extends MyTheme {} }` looks non-standard.
- **Truth**: This is the **industry-standard pattern** for TypeScript theme typing. Emotion, styled-components, and MUI all use the same `declare module` + interface merging approach. It enables IDE autocomplete and type checking for all token references across your codebase without requiring wrapper types.
- **Verify**: See [TypeScript Module Augmentation docs](https://www.typescriptlang.org/docs/handbook/declaration-merging.html#module-augmentation) and `grep "declare module" packages/showcase/src/ds.ts`

### "Zero-runtime is misleading — there's still JavaScript"

- **Claim**: Calling it "zero-runtime" is inaccurate because JavaScript runs at render time.
- **Truth**: "Zero-runtime" means **no style computation at render time**. The runtime (`system/src/runtime/index.ts`, 128 lines) does three things: (1) map prop values to pre-computed class name strings, (2) filter Animus-managed props before passing to the DOM, (3) forward refs. No `useEffect`, no `useLayoutEffect`, no CSSOM manipulation, no style injection, no browser measurement APIs. It is a pure string lookup. See RFC.md §8: Runtime Audit.
- **Verify**: `wc -l packages/system/src/runtime/index.ts` and `grep -c "useEffect\|useLayoutEffect\|createElement.*style\|document\.\|window\." packages/system/src/runtime/index.ts` (should return 0)

### "Animus ships with built-in prop groups like space, color, typography"

- **Claim**: The framework provides pre-built prop groups that define how CSS properties are organized.
- **Truth**: **All prop groups are 100% user-defined** via `createSystem().addGroup(name, config)`. The `name` is any string you choose. The `config` is a record of prop definitions you author. The showcase application happens to define groups named `space`, `surface`, `text`, `arrange`, `motion`, and `positioning` — those are that app's design choices, not the framework's opinions. Animus provides convenience prop definition helpers (`space`, `color`, `typography` etc. from `@animus-ui/system/groups`) but using them is optional, and they can be mixed, renamed, or ignored entirely.
- **Verify**: `grep "addGroup" packages/system/src/SystemBuilder.ts` — note the fully generic `<Name extends string, Conf extends Record<string, Prop>>` signature

## Feature Matrix

| Feature | Supported | How |
|---------|-----------|-----|
| CSS custom properties | Yes | `createTheme().addScale({ emit: true })` emits `var()` references |
| Color modes (dark/light/custom) | Yes | `createTheme().addColorModes()` — pure CSS via `[data-color-mode]` selectors |
| Responsive props | Yes | Breakpoint-keyed objects: `{ _: 4, md: 8 }` — extracted to `@media` queries |
| Token references | Yes | `{scale.path}` syntax resolved by Rust crate to `var()` or raw values |
| Opacity modifiers | Yes | `{colors.x/40}` → `color-mix(in srgb, var(...) 40%, transparent)` |
| Custom transforms | Yes | `createTransform(name, fn)` — serialized for extraction, applied at build time |
| Cascade layers | Yes | 7-tier `@layer` declaration: global → base → variants → compounds → states → system → custom |
| Global styles | Yes | `createGlobalStyles()` with full prop shorthand + token resolution |
| Multi-slot composition | Yes | `compose({ Root, Child }, { shared: { variant: true } })` — React context sync |
| Framework-agnostic output | Yes | `.asClass()` terminal returns `(props?) => string` — no React dependency |
| Vite plugin | Yes | `@animus-ui/vite-plugin` — `animusExtract()` with HMR + prod optimization |
| Next.js plugin | Yes | `@animus-ui/next-plugin` — `withAnimus()` webpack integration |
| CSS variable prefixing | Yes | `prefix` option on plugin — namespaces all `--var` names and `var()` refs |
| Incremental HMR | Yes | Content-hash file tracking, per-file re-analysis, geological reset on system changes |
| Custom prop definitions | Yes | `.props({ name: { property, scale, transform } })` on any component |
| Contextual CSS variables | Yes | `declareContextualVars()` — `--current-{name}` vars that flow through DOM |
| Nested selectors / pseudo-classes | Yes | Standard CSS nesting in style objects: `'&:hover'`, `'& > div'`, `'&[data-state]'` |
| Extend components | Yes | `Component.extend().styles({...})` — chain additional styles onto existing components |
| Strict mode (CI) | Yes | `strict: true` on plugin — extraction failures throw instead of warning |

## User Stories

### 1. Core Styling & Dynamic Behavior

#### How do I achieve dynamic styling based on props?

> _"I want to apply different styles based on component props (e.g., `variant="primary"`, `size="large"`) so my components are reusable."_

Use `.variant()` — each variant is a named prop with statically enumerable options. The extraction pipeline sees every combination at build time and emits a CSS class per option. No runtime style computation.

```typescript
const Button = ds
  .styles({
    display: 'inline-flex',
    cursor: 'pointer',
    fontFamily: 'mono',
  })
  .variant({
    prop: 'variant',
    variants: {
      primary: { bg: 'primary', color: 'bg' },
      secondary: { bg: 'surface', color: 'text' },
      ghost: { bg: 'transparent', color: 'primary' },
    },
    defaultVariant: 'primary',
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

// Usage: <Button variant="secondary" size="lg">Click</Button>
```

For **multi-variant conditions** (e.g., "when variant=primary AND size=sm"), use `.compound()`:

```typescript
  .compound({ variant: 'primary', size: 'sm' }, { fontWeight: 600 })
```

For **ad-hoc per-component props** with custom scales or transforms, use `.props()`:

```typescript
  .props({
    logoSize: {
      property: 'fontSize',
      scale: { xs: 28, sm: 32, md: 64, lg: 72 },
    },
  })
```

For **system-level utility props** (spacing, colors, layout), use `.system()` to expose named prop groups:

```typescript
  .system({ space: true, surface: true })
// Enables: <Button mt={16} bg="accent" />
```

All of these are statically extracted. Values that can't be statically analyzed (variables, ternaries, function calls) gracefully degrade to CSS variable slots with runtime setting — the component still works, it just uses a different delivery mechanism for that specific property. See RFC.md §7.

#### How do I achieve style composition and overriding?

> _"I want to predictably merge external styles with internal styles so consumers can override defaults without specificity wars."_

Every other framework's override story is adversarial — you fight the cascade, fight specificity, reach for `!important`. Animus's override story is cooperative: **the cascade contract IS the override mechanism.**

Each builder method maps to a progressively higher-priority `@layer`:

```
@layer base       .styles()       "This is what it looks like"
     ↑ overridden by
@layer variants   .variant()      "Unless it's this kind"
     ↑ overridden by
@layer compounds  .compound()     "Unless these combine"
     ↑ overridden by
@layer states     .states()       "Unless it's in this state"
     ↑ overridden by
@layer system     .system()       "Unless the consumer sets this prop"
     ↑ overridden by
@layer custom     .props()        "Unless the consumer needs this exact thing"
```

Every override is **safe** because the layer ordering is deterministic. You can't accidentally break something by adding a variant — it lands in `@layer variants`, which is below `@layer states`, so states always win. The cascade contract is a **guarantee**, not a convention.

**`className` passthrough** still works for external overrides. The runtime appends any external `className` after internal Animus classes:

```tsx
<Button className="custom-override" variant="primary" />
// Renders: className="animus-Button-abc animus-Button-primary custom-override"
```

**`Component.extend()` re-enters the ladder.** This is the most powerful composition primitive. An extension returns a fresh builder chain with the parent's entire config accumulated — and each contribution lands in the **correct layer**, after the parent's (source-order win within the same layer). No specificity escalation. Ever.

```typescript
// Parent: a strict base Button
const Button = ds
  .styles({ display: 'inline-flex', cursor: 'pointer' })
  .variant({ prop: 'size', variants: { sm: { px: 8 }, md: { px: 16 } } })
  .asElement('button');
```

Five things you can do with `.extend()`:

**1. Override or add variants at any layer:**

```typescript
const BrandButton = Button.extend()
  .styles({ fontFamily: 'brand', letterSpacing: '-0.01em' })  // adds to @layer base
  .variant({                                                    // adds to @layer variants
    prop: 'intent',
    variants: { cta: { bg: 'accent', color: 'bg' }, subtle: { bg: 'surface' } },
  })
  .asElement('button');
// BrandButton has size (inherited) + intent (new)
```

**2. Enable system props the parent locked down:**

```typescript
const LayoutButton = Button.extend()
  .system({ space: true })  // parent had no system props
  .asElement('button');
// <LayoutButton mt={16} size="sm" /> — spacing now available
```

**3. Polymorphism via element re-casting:**

```typescript
const LinkButton = Button.extend()
  .styles({ textDecoration: 'none' })
  .asElement('a');  // renders as <a>, not <button>
// Carries all Button's variants, states, and logic — but renders as an anchor
```

No `as={Component}` runtime polymorphism. The element is chosen at the creation boundary, and the Rust crate extracts it as a distinct entity.

**4. Inject compound rules targeting parent variants:**

```typescript
const SpecialButton = Button.extend()
  .variant({ prop: 'special', variants: { yes: {}, no: {} } })
  .compound({ size: 'sm', special: 'yes' }, { fontWeight: 700 })  // references parent's 'size'
  .asElement('button');
```

The compound condition has access to the full variant registry — parent and extension combined.

**5. Each extension is a distinct extraction entity.** The Rust crate gives each extension its own class names, its own CSS rules, its own variant pruning ledger. An extension's CSS is generated independently and emitted after its parent (topological sort ensures correct ordering). No runtime class merging, no specificity fights.

#### How do I achieve global styling?

> _"I want an API to inject global styles (resets, font-face, keyframes) alongside scoped component styles."_

`createGlobalStyles()` is returned from `createSystem().build()`. It accepts blocks keyed by selector, and supports the same prop shorthand and token references as component styles:

```typescript
const { system: ds, createGlobalStyles } = createSystem()
  .addGroup('space', space)
  .addGroup('surface', { ...color, ...background })
  .build();

export const globalStyles = createGlobalStyles({
  '*, *::before, *::after': { boxSizing: 'border-box' },
  'html, body': { bg: 'bg', color: 'text', m: 0 },
  a: { color: 'primary', textDecoration: 'none' },
  '::selection': { bg: 'selection', color: 'selection.text' },
  '@keyframes fadeIn': {
    '0%': { opacity: '0' },
    '100%': { opacity: '1' },
  },
  '@font-face': {
    fontFamily: 'MyFont',
    src: 'url(/fonts/MyFont.woff2) format("woff2")',
  },
});
```

Global styles emit into `@layer global` — the lowest-priority layer, so component styles always override them.

---

### 2. Responsive Design & Interactivity

#### How do I achieve responsive design?

> _"I want to apply styles across screen sizes using shorthand syntax without manually writing @media rules."_

Use breakpoint-keyed objects. Breakpoints are defined in your theme:

```typescript
const tokens = createTheme()
  .addBreakpoints({ sm: 768, md: 1024, lg: 1200 })
  .build();
```

Then use responsive objects on any prop. `_` is the base (no media query):

```typescript
const Container = ds
  .styles({
    px: { _: 16, sm: 24, md: 32, lg: 48 },
    maxWidth: { _: '100%', md: '960px', lg: '1200px' },
  })
  .asElement('div');
```

This extracts to `@media` rules at build time — no runtime breakpoint detection. Works in variants, states, system props, and custom props.

#### How do I achieve state-driven styling?

> _"I want to declare styles for `:hover`, `:focus-visible`, `:disabled` directly in my component."_

Two mechanisms, both colocated in the component definition:

**Pseudo-selectors in any style object** — use CSS nesting syntax:

```typescript
const Link = ds
  .styles({
    color: 'primary',
    textDecoration: 'none',
    '&:hover': { textDecoration: 'underline', color: 'primary.hover' },
    '&:focus-visible': { outline: '2px solid {colors.accent}', outlineOffset: '2px' },
    '&:disabled': { opacity: '0.4', pointerEvents: 'none' },
  })
  .asElement('a');
```

**`.states()` for consumer-overridable boolean conditions** — activated via boolean props:

```typescript
const Button = ds
  .styles({ cursor: 'pointer', opacity: '1' })
  .variant({
    prop: 'variant',
    variants: {
      primary: { bg: 'primary', color: 'bg' },
      danger: { bg: 'status.error', color: 'bg' },
    },
  })
  .states({
    isDisabled: { opacity: '0.4', pointerEvents: 'none', cursor: 'default' },
    isActive: { transform: 'scale(0.97)' },
    isLoading: { cursor: 'wait', opacity: '0.7' },
  })
  .system({ surface: true })
  .asElement('button');

// State overrides variant styling:
<Button variant="primary" isDisabled />

// But the consumer can STILL override state styling via system props:
<Button variant="primary" isDisabled opacity={0.8} />
// system prop wins — @layer system > @layer states
```

States sit at the **sweet spot** in the cascade: above variants and compounds, but **below** system and custom props. This is the key to understanding them:

- **Above variants/compounds** — `isDisabled` overrides any variant combination without specificity tricks. In traditional CSS, making `.btn--disabled` beat `.btn--primary.btn--lg` requires `!important`. With states in a higher layer, it just works.
- **Below system/custom** — the consumer can still override state styles via system props or custom props. The component author asserts defaults for `isDisabled`; the consumer has the final say.

States are boolean toggles — typed props, statically analyzable, and extracted to CSS classes (`.component--stateName`). They represent **conditions that cross-cut all variant combinations** (disabled, loading, active, selected) at the same specificity as consumer-overridable styles.

Active states preserve their semantics on the DOM via **data-attribute passthrough** (`data-{stateName}=""`). The CSS uses class selectors (no specificity cost within the layer); the data attributes exist for **interop with external frameworks** that inspect element state — not as a user-facing feature.

#### Headless UI interop (Radix, Ark-UI, etc.)

States and variants can **piggyback** on external frameworks' prop contracts. The typical use case: slot an Animus component into a Radix or Ark-UI primitive, then map the headless library's data attributes directly to Animus variants or states — placing them in the correct, overridable cascade position.

**Variant piggybacking** — map `data-state` directly as a variant prop:

```typescript
// Radix/Ark-UI passes data-state="open" | "closed" to slot elements.
// Map it directly as a variant — styles land in @layer variants:
const DialogContent = ds
  .styles({
    opacity: '0',
    transform: 'translateY(-8px)',
    transition: 'opacity 0.2s, transform 0.2s',
  })
  .variant({
    prop: 'data-state',
    variants: {
      open: { opacity: '1', transform: 'translateY(0)' },
      closed: { opacity: '0', transform: 'translateY(-8px)' },
    },
  })
  .system({ space: true, surface: true })
  .asComponent(Dialog.Content);
```

**State piggybacking** — map `data-open` as a state key for cascade-positioned overrides:

```typescript
// The headless library sets data-open on the element when active.
// Map it as a state — styles land in @layer states (consumer-overridable):
const AccordionContent = ds
  .styles({ maxHeight: '0', overflow: 'hidden', transition: 'max-height 0.2s' })
  .states({
    'data-open': { maxHeight: '500px' },
  })
  .system({ space: true })
  .asComponent(Accordion.Content);
```

**Boolean prop interop** — headless libraries that pass `disabled={true}`:

```typescript
const Trigger = ds
  .styles({ cursor: 'pointer' })
  .states({
    disabled: { opacity: '0.4', cursor: 'default', pointerEvents: 'none' },
  })
  .system({ surface: true })
  .asComponent(Popover.Trigger);
// Consumer can still override: <Trigger disabled opacity={0.8} />
```

**Why this works:** `data-*` and `aria-*` attributes always pass through to the DOM — even when used as variant or state keys. The attribute is consumed for styling AND forwarded to the underlying element, so the headless library sees it. Animus handles the visual layer in the cascade contract; the headless library controls behavior.

#### How do I achieve complex targeting (pseudo-elements & selectors)?

> _"I want to target `::before`, `::after`, and child selectors without breaking component isolation."_

Standard CSS nesting syntax works in all style positions (base, variants, states):

```typescript
const ListItem = ds
  .styles({
    position: 'relative',
    '&::before': {
      content: '"—"',
      color: 'primary',
      position: 'absolute',
      left: '-24px',
    },
    '&::after': {
      content: '""',
      display: 'block',
      height: '1px',
      bg: 'border',
    },
    '& > span': { fontWeight: 600 },
    '& + &': { mt: 8 },
  })
  .asElement('li');
```

The extraction pipeline handles nested selectors by scoping them under the component's generated class name, maintaining isolation. Token references (`'primary'`, `'border'`) and prop shorthands (`bg`, `mt`) work inside nested selectors identically to top-level styles.

---

### 3. Theming & Design Tokens

#### How do I achieve strict design system enforcement?

> _"I want to define tokens that the library enforces, so developers can't use magic numbers or off-brand colors."_

Three-layer enforcement:

**1. Typed scales** — `addScale()` with `emit: true` creates CSS variables. TypeScript restricts prop values to scale keys:

```typescript
const tokens = createTheme()
  .addColors({ brand: { primary: '#3b82f6', danger: '#ef4444' } })
  .addScale({ name: 'space', values: { 4: '0.25rem', 8: '0.5rem', 16: '1rem' } })
  .build();
```

**2. Module augmentation** — once declared, ALL components get type-checked token access:

```typescript
declare module '@animus-ui/system' {
  interface Theme extends typeof tokens {}
}

// Now: bg: 'brand.primary' ✅  bg: 'not-a-token' ❌ (TS error)
// And: p: 4 ✅ (maps to 0.25rem)  p: 7 ⚠ (not in scale)
```

**3. Strict extraction mode** — `strict: true` on the plugin config makes extraction failures throw instead of warn, catching off-system usage in CI.

The system is intentionally **not absolute** — you can still use raw CSS values (`fontSize: '13px'`). The type system warns, but doesn't block. This is by design: constraining expression, not capability.

#### How do I achieve dark mode and multiple themes?

> _"I want to switch themes dynamically without duplicated CSS bundles, using CSS variables."_

`addColorModes()` defines semantic color aliases per mode. All modes compile to a single CSS file using CSS custom properties with `[data-color-mode]` attribute selectors:

```typescript
const tokens = createTheme()
  .addColors({
    gray: { 50: '#fafafa', 900: '#171717', 950: '#000' },
    blue: { 500: '#3b82f6', 600: '#2563eb' },
  })
  .addColorModes('dark', {
    dark: {
      primary: 'blue.500',
      bg: { _: 'gray.950', muted: 'gray.900' },
      text: { _: 'gray.50', muted: 'gray.400' },
    },
    light: {
      primary: 'blue.600',
      bg: { _: 'gray.50', muted: 'gray.100' },
      text: { _: 'gray.950', muted: 'gray.600' },
    },
  })
  .build();
```

**Switching** is a single DOM attribute — no JS re-render, no duplicated bundles:

```typescript
document.documentElement.setAttribute('data-color-mode', 'light');
```

Components reference semantic tokens (`bg: 'bg'`, `color: 'text'`), and the CSS variables resolve per mode automatically. The showcase app runs 10 color modes from a single extracted stylesheet.

#### How do I achieve strong TypeScript integration?

> _"I want autocomplete and type-checking for all style objects and theme tokens."_

Module augmentation gives you full IDE support across the entire builder chain:

```typescript
// After: declare module '@animus-ui/system' { interface Theme extends MyTheme {} }

// ✅ Autocomplete on token names
ds.styles({ color: 'primary' })           // suggests: primary, text, bg, ...
ds.styles({ p: 8 })                       // suggests scale keys: 0, 2, 4, 8, 16, ...
ds.styles({ bg: '{colors.blue.500/40}' }) // opacity modifier syntax

// ✅ Type-state machine prevents out-of-order calls
ds.styles({}).variant({}).compound({})     // ✅ correct order
ds.styles({}).compound({}).variant({})     // ❌ TS error — compound after variant

// ✅ Variant prop types are inferred
const Button = ds.styles({}).variant({
  prop: 'size',
  variants: { sm: {}, md: {}, lg: {} },
}).asElement('button');

// <Button size="xl" /> → TS error: "xl" not in "sm" | "md" | "lg"

// ✅ System group activation is typed
ds.styles({}).system({ space: true })      // ✅ enables p, m, gap, etc.
ds.styles({}).system({ nonexistent: true }) // ❌ TS error
```

Type safety extends to `compose()` shared props, `.extend()` chains, and custom `.props()` definitions.

---

### 4. Architecture, Performance, & Frameworks

#### How do I achieve React Server Component (RSC) compatibility?

> _"I want styles to work on the server without React Context or client-side JavaScript."_

**Individual components are RSC-safe by default.** The runtime is a pure function: props in → className string out. No `useState`, no `useEffect`, no `useContext`, no `createContext`. Components created via `.asElement()`, `.asComponent()`, or `.asClass()` work in Server Components without any directive.

**The exception is `compose()`.** Multi-slot composition uses React context to synchronize shared variant props between Root and child slots. Components created via `compose()` require `'use client'` in App Router. If you need RSC-compatible multi-slot components, use individual `.asElement()` components and pass variant props explicitly instead of relying on context synchronization.

```typescript
// ✅ RSC-safe — no context
const Card = ds.styles({ bg: 'surface', p: 16 }).asElement('article');
const CardHeader = ds.styles({ fontWeight: 600 }).asElement('header');

// ⚠ Needs 'use client' — uses React context
const Composed = compose({ Root: Card, Header: CardHeader }, { shared: { density: true } });
```

#### How do I achieve a small bundle size?

> _"I want styles extracted to static CSS so the browser doesn't pay a JS parsing penalty."_

This is the core value proposition. At build time:

1. **All styles extract to a single `.css` file** — no JavaScript ships for style definitions
2. **Builder chains are replaced with `createComponent()` calls** — the multi-method chain disappears from the bundle entirely
3. **The remaining runtime is 128 lines** — pure string lookup mapping props to pre-computed class names
4. **No style injection at runtime** — no `<style>` tags, no `CSSStyleSheet.insertRule()`, no CSSOM manipulation

The browser loads one CSS file (cacheable, parseable in parallel with JS) and a minimal runtime that maps prop values to class name strings. See RFC.md §8: Runtime Audit.

#### How do I avoid unused CSS (dead code elimination)?

> _"I want the build tool to automatically remove styles for unused components."_

The Rust extraction pipeline includes a **reconciliation phase** that prunes CSS at two levels:

**1. Component-level elimination** — if a component is defined but never rendered in JSX anywhere in your codebase, its entire CSS output (base + variants + states) is eliminated. The Rust crate scans all JSX in your project to build a usage ledger.

**2. Variant/state pruning** — for components that ARE rendered, only the variant options and states actually used in JSX are kept. If you define `size: { sm, md, lg }` but only ever write `<Button size="sm" />` and `<Button size="md" />`, the CSS for `lg` is pruned from the output.

**Exceptions** (conservatively kept):
- Components used as parents in `.extend()` chains — children inherit their styles
- `.asClass()` resolvers — usage can't be detected via JSX scanning
- `compose()` slot components — marked as rendered via separate analysis
- Variant props with no detectable usage data — kept entirely (conservative fallback)

**Important:** Reconciliation runs in **production builds only**. Dev mode keeps everything for fast iteration. Diagnostics report what was pruned:

```
[animus] Reconciliation: 12 kept, 8 variants pruned, 3 states pruned
⚠ Ghost eliminated: component not rendered and not a parent
```

## Architectural Edge Cases

These address specific concerns raised during external review about where static extraction might break down.

### "What happens when variant values are dynamic or CMS-driven?"

> _`<Button size={userSettings.compact ? 'sm' : 'lg'} />` — won't DCE prune `'lg'` if the scanner can't see it?_

**No.** The scanner classifies any non-string-literal expression as `__dynamic__`. The reconciler treats `__dynamic__` as "usage exists but options are unknown" and **conservatively keeps ALL variant options** for that prop.

The pruning logic only removes a variant option when it can **prove** the option is never used — meaning every single JSX usage of that prop across the entire codebase uses static string literals, and none of those literals match the option in question.

| JSX Pattern | Scanner Records | Reconciler Behavior |
|-------------|----------------|---------------------|
| `size="sm"` | `"sm"` | Keeps only `"sm"` (if sole usage) |
| `size={variable}` | `__dynamic__` | Keeps ALL options |
| `size={x ? 'sm' : 'lg'}` | `__dynamic__` | Keeps ALL options |
| `size={cmsValue}` | `__dynamic__` | Keeps ALL options |
| prop omitted, has default | `__default__` → resolved | Keeps default option |
| prop omitted, no default | `__default__` → cleaned | Keeps ALL options |

**No safelist configuration is needed.** The architecture is conservative by default — it only prunes what it can prove is dead. One dynamic usage of a variant prop anywhere in the project disables pruning for ALL options of that prop on that component.

**The narrow edge case:** If a component is used 100% statically in all JSX (`size="sm"` and `size="md"` everywhere), but a CMS injects `size="lg"` at runtime — that CSS *would* be pruned. This requires: (a) zero dynamic usage sites AND (b) the CMS uses a value not present in any static site. In practice, if you have CMS-driven variants, at least one usage site will be dynamic (`size={cmsValue}`), which triggers the conservative path.

### "Don't complex generics tank the TypeScript language server?"

> _Type-state machines with deep generic chaining can make TS crawl in large monorepos._

This is a real concern we actively mitigate at the type architecture level:

1. **Generic defaults = lazy evaluation** — TypeScript doesn't instantiate a generic until it's needed. Default type parameters (`= {}`) on builder methods mean unused branches never evaluate.

2. **Mapped flatten = cache boundary** — Where the type system accumulates generic depth (e.g., after chaining `.variant().variant().variant()`), we insert explicit `Flatten<T>` mapped types that force TypeScript to resolve and cache the intermediate type, resetting the depth counter.

3. **Narrowing, not widening** — The type-state machine REMOVES methods at each phase (e.g., after `.variant()`, the `.styles()` method disappears). This means the type gets simpler as you chain, not more complex. The widest type is at the start; the narrowest is at the terminal.

4. **Known TS2589/TS2590 mitigations** — We've encountered and solved both "type instantiation is excessively deep" errors. The fix pattern: always inline narrowed primitive types at constraint boundaries rather than relying on type alias caching. See `AnyBrandedComponent` constraint on `compose()`.

### "How do custom transforms execute if extraction is Rust?"

> _`createTransform(name, fn)` is JavaScript, but the Rust crate does extraction. How does the bridge work?_

**Transforms don't execute in Rust.** The pipeline uses a placeholder pattern:

1. **Rust emits placeholders** — When the crate encounters a prop with a named transform, it emits `__TRANSFORM__name__rawValue__` as the CSS value (e.g., `flex-basis: __TRANSFORM__size__4__`).

2. **TS post-processing resolves them** — After the Rust crate returns CSS, the plugin runs `resolveTransformPlaceholders(css, transforms)` in JavaScript, which finds each placeholder, calls the corresponding JS function, and replaces the placeholder with the result.

3. **Serialization for subprocesses** — In the Next.js plugin, transform functions are serialized via `.toString()` in the `loadSystem` subprocess and reconstructed via `new Function()` in-process. No cross-process function calls needed.

This means transforms can be arbitrary JavaScript — closures, math, string manipulation, anything. The Rust crate never needs to understand the transform logic; it just preserves the name and raw value for JS to resolve later.

**Verify:** `grep "__TRANSFORM__" packages/extract/src/theme_resolver.rs` and `grep "resolveTransformPlaceholders" packages/extract/pipeline/resolve-transforms.ts`

## Known Limitations

| Limitation | Status | Detail |
|------------|--------|--------|
| Single CSS file output | `planned` | All styles in one file — no per-route code splitting. See `openspec/changes/route-css-splitting/`. |
| Static-only extraction values | `known-constraint` | Style values must be static literals (strings, numbers, booleans). Dynamic expressions degrade to CSS variable slots. This is fundamental to the zero-runtime model. See RFC.md §7: What Gets Extracted. |
| `compose()` requires `'use client'` | `known-constraint` | Uses React context (`createContext` + `useContext`) for shared prop synchronization. Not RSC-compatible without the directive. |
| Standalone Webpack plugin | `not-planned` | Webpack support exists via the Next.js plugin. No standalone `@animus-ui/webpack-plugin` is planned. |
| Scale name rebinding for helpers | `designing` | Pre-built prop helpers (e.g., `space` from `@animus-ui/system/groups`) hardcode scale names. Customizing which scale a helper binds to requires copying the definition. See `openspec/changes/group-scale-factories/`. |
| Named selector registry | `designing` | No `.addSelectors()` for a shared CSS selector vocabulary. See `openspec/changes/selector-registry/`. |
| Typed opacity modifier syntax | `designing` | `{colors.x/40}` works at extraction time but TypeScript doesn't validate the syntax in prop types yet. |

## Adoption

### Vite Setup (minimum)

```typescript
// vite.config.ts
import { animusExtract } from '@animus-ui/vite-plugin';

export default defineConfig({
  plugins: [react(), animusExtract({ system: './src/ds.ts' })],
});
```

```typescript
// src/main.tsx — you must import the virtual stylesheet
import 'virtual:animus/styles.css';
```

The `virtual:animus/styles.css` import is a Vite virtual module served by the plugin. Without it, no styles load.

### Next.js Setup (minimum)

```typescript
// next.config.ts
import { withAnimus } from '@animus-ui/next-plugin';

export default withAnimus({ system: './src/ds.ts' })({
  // ...your Next.js config
});
```

CSS injection is automatic — the plugin's webpack loader injects `import '.animus/styles.css'` into your root layout (`app/layout`) or custom app (`pages/_app`). No manual import needed. The `.animus/` directory is generated at build time and should be gitignored.

### Module Augmentation (required for type safety)

```typescript
// src/ds.ts
import { createTheme, createSystem } from '@animus-ui/system';

export const tokens = createTheme()
  .addColors({ /* your palettes */ })
  .addScale({ name: 'space', values: { /* your scale */ } })
  .build();

export type MyTheme = typeof tokens;

declare module '@animus-ui/system' {
  interface Theme extends MyTheme {}
}

export const { system: ds } = createSystem()
  .addGroup('layout', { /* your prop definitions */ })
  .build();
```

### Incremental Adoption

Animus works alongside existing CSS. You can adopt it one component at a time:

- The plugin processes only files that use `ds.styles()` chains — all other files pass through unchanged.
- Generated CSS uses `@layer` scoping, so it won't conflict with existing stylesheets (unless your existing styles also use the same layer names).
- You can start with `.asClass()` for framework-agnostic class names if you're not using React, or `.asElement()` / `.asComponent()` for full React integration.
- One `system` file per application. One `import` of the virtual stylesheet. Define components as needed.

## Proof Points

Consolidated verification paths grouped by package. All references use stable identifiers (function/export names), not line numbers.

### `@animus-ui/system`

| Claim | Verify |
|-------|--------|
| Runtime is 128 lines, no hooks | `wc -l packages/system/src/runtime/index.ts` |
| No browser APIs in runtime | `grep -c "useEffect\|document\.\|window\." packages/system/src/runtime/index.ts` → 0 |
| `createComponent` is pure string lookup | `packages/system/src/runtime/index.ts` — `createComponent` function |
| `addGroup` is fully generic / user-defined | `packages/system/src/SystemBuilder.ts` — `addGroup` method |
| `includes()` is a no-op by design | `packages/system/src/SystemBuilder.ts` — `includes` method returns `this` |
| `compose()` uses React context | `packages/system/src/compose.ts` — `createContext` + `useContext` |
| `.asClass()` is framework-agnostic | `packages/system/src/AnimusExtended.ts` — `asClass` method |
| `.extend()` element re-casting | `packages/system/src/AnimusExtended.ts` — `asElement` accepts independent `<El>` generic |
| `.extend()` system prop expansion | `packages/system/src/AnimusExtended.ts` — `system()` merges with parent's `activeGroups` via `deepMerge` |
| `.extend()` compound on parent variants | `packages/system/src/AnimusExtended.ts` — `compound()` condition uses full merged `Variants` type |
| Module augmentation pattern | `packages/showcase/src/ds.ts` — `declare module` block |

### `@animus-ui/extract`

| Claim | Verify |
|-------|--------|
| Token ref opacity via Rust | `packages/extract/src/theme_resolver.rs` — `resolve_single_alias` function, `color-mix` output |
| Token ref opacity via TS pipeline | `packages/extract/pipeline/resolve-global-styles.ts` — `resolveTokenAliases` function |
| `includes()` AST analysis | `packages/extract/pipeline/discover-packages.ts` — `extractSystemFilePackages` function |
| Graceful degradation model | `packages/extract/src/` — three-tier: extracted → dynamic → bail |
| `.extend()` distinct extraction entity | `packages/extract/src/chain_walker.rs` — `ChainDescriptor.extends_from` field |
| Extension provenance resolution | `packages/extract/src/project_analyzer.rs` — topological sort ensures parent CSS before child |
| Dynamic variant → conservative keep | `packages/extract/src/jsx_scanner.rs` — `classify_jsx_attribute_as_variant_value` returns `__dynamic__` |
| Reconciler conservative fallback | `packages/extract/src/reconciler.rs` — `reconcile` function, `None` match arm keeps all |
| Transform placeholder pattern | `packages/extract/src/theme_resolver.rs` — `__TRANSFORM__` format string |
| Transform resolution in TS | `packages/extract/pipeline/resolve-transforms.ts` — `resolveTransformPlaceholders` function |

### `@animus-ui/vite-plugin`

| Claim | Verify |
|-------|--------|
| HMR with content-hash tracking | `packages/vite-plugin/src/index.ts` — `fileContentHash` map |
| Geological reset on system change | `packages/vite-plugin/src/index.ts` — `handleHotUpdate` checks system file path |
| `assembleStylesheet` for deterministic output | `packages/extract/pipeline/assemble-stylesheet.ts` — shared by both plugins |

### `@animus-ui/next-plugin`

| Claim | Verify |
|-------|--------|
| Webpack integration exists | `packages/next-plugin/src/plugin.ts` — `AnimusWebpackPlugin` class |
| Same `assembleStylesheet` as Vite | `packages/next-plugin/src/plugin.ts` — imports from `@animus-ui/extract/pipeline` |
| Transform serialization for subprocess | `packages/next-plugin/src/plugin.ts` — `transformSources` in `loadSystem` |

### Cross-references to RFC.md

| Topic | RFC Section |
|-------|-------------|
| What you give up / get back | §1: The Trade |
| Builder chain phases and ordering | §3: The Builder Chain |
| Theme token scales and color modes | §4: Theme Architecture |
| System model and prop definitions | §5: System Model |
| Composition and compose() | §6: Component Composition |
| Extraction pipeline and diagnostics | §7: Extraction Pipeline |
| Runtime audit and browser API inventory | §8: Runtime Audit |
| Bundler integration | §9: Bundler Integration |
| Cascade layer reference | Appendix A |

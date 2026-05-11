## Context

Animus style objects currently accept raw CSS selector strings like `'&:hover': { ... }` for pseudo-state and pseudo-element targeting. These are untyped, require the author to remember exact CSS syntax, and have no equivalent at the component callsite. The extraction pipeline handles `&`-leading selectors but silently skips non-leading `&` patterns (e.g. `h1 + &`).

With the discovery that CSS `@layer` makes specificity invariant across layers, there is renewed pressure to provide typed, layer-aware pseudo-state/element support at every level of the system — from component authoring through to callsite consumption.

## Goals / Non-Goals

**Goals:**
- Single `_`-prefixed vocabulary for pseudo selectors, usable in `.styles()`, `.variant()`, `.compound()`, `.states()`, and callsite props
- Built-in alias set that covers 90% of use cases out of the box
- User-extensible registry via `createSystem().addSelectors()` for project-specific selectors
- Prop shorthand resolution inside alias blocks
- `_before`/`_after` auto-default `content: ''`
- Extraction pipeline support (Rust-side key recognition and selector expansion)

**Non-Goals:**
- Deprecating raw `'&:hover'` syntax — it remains for edge cases and custom selectors
- `css` escape hatch prop — separate concern, not part of this change
- Callsite extraction of system props (system props remain runtime; this change adds pseudo-state support to the runtime resolver, not to the extraction pipeline's JSX walker)
- Group/peer selectors (`_groupHover`, `_peerFocus`) — future expansion, not in initial set

## Decisions

### 1. Built-in alias set and compound selectors

The built-in set ships as defaults on every system. Aliases map to one or more CSS selectors joined with `,`.

```ts
const BUILT_IN_SELECTORS = {
  // Interactive
  _hover:        '&:hover',
  _focus:        '&:focus',
  _active:       '&:active',
  _focusVisible: '&:focus-visible',
  _focusWithin:  '&:focus-within',
  _visited:      '&:visited',
  _target:       '&:target',

  // Disabled — compound selector covering all common patterns
  _disabled:     '&:disabled, &[disabled], &[aria-disabled="true"], &[data-disabled]',

  // Other form states
  _checked:      '&:checked, &[aria-checked="true"], &[data-checked]',
  _invalid:      '&:invalid, &[aria-invalid="true"], &[data-invalid]',
  _required:     '&:required, &[aria-required="true"]',
  _readOnly:     '&:read-only, &[aria-readonly="true"], &[data-readonly]',
  _expanded:     '&[aria-expanded="true"], &[data-expanded]',
  _selected:     '&[aria-selected="true"], &[data-selected]',
  _pressed:      '&[aria-pressed="true"], &[data-pressed]',

  // Pseudo-elements
  _before:       '&::before',
  _after:        '&::after',
  _placeholder:  '&::placeholder',
  _selection:    '&::selection',

  // Positional
  _first:        '&:first-child',
  _last:         '&:last-child',
  _even:         '&:nth-child(even)',
  _odd:          '&:nth-child(odd)',
  _empty:        '&:empty',
} as const;
```

**Why compound selectors for `_disabled`:** Native `:disabled` only applies to form elements. Custom components, ARIA widgets, and component library conventions use `aria-disabled`, `data-disabled`, or the bare `disabled` attribute. A single `_disabled` alias should target all of them so authors don't need to remember which pattern their context uses.

**Why include ARIA/data states:** Component libraries (Radix, React Aria, Headless UI) use data attributes for states like pressed, expanded, selected. Including these in the built-in set means Animus components interop with those libraries without custom selectors.

### 2. User extension via `addSelectors()`

```ts
createSystem()
  .addSelectors({
    // Override a built-in
    _disabled: '&:disabled, &[disabled], &[aria-disabled="true"], &[data-disabled], &[data-state="disabled"]',
    // Project-specific aliases
    _open: '&[data-state="open"]',
    _closed: '&[data-state="closed"]',
    _groupHover: '[data-group]:hover &',
  })
  .addGroup('surface', { ...color, ...border })
  .build();
```

`addSelectors()` merges with built-ins. Later calls override earlier ones. The merged map is serialized into the system manifest so the extraction pipeline has access at build time.

**Why on `createSystem()` not `createTheme()`:** Selectors are a system concern (they affect how styles are emitted), not a theming concern (they don't relate to tokens or color modes).

### 3. Style object key recognition

Every style object in the chain gains `_`-prefixed optional keys. When the style resolver encounters a `_`-prefixed key:

1. Look up the alias in the system's selector map
2. If found, treat the value as a nested style object with the resolved CSS selector as the wrapper
3. Resolve prop shorthands inside the nested object (same as top-level resolution)
4. For `_before` / `_after`: if the nested object does not contain a `content` property, inject `content: ''`
5. Emit the resolved CSS in the same `@layer` as the parent context

```ts
// Author writes
ds.styles({
  bg: 'surface',
  _hover: { bg: 'primary', boxShadow: 'glow' },
  _before: { display: 'block', bg: 'accent', height: '2px' },
})

// Resolves to (conceptually)
{
  backgroundColor: 'var(--color-surface)',
  '&:hover': { backgroundColor: 'var(--color-primary)', boxShadow: '...' },
  '&::before': { content: '""', display: 'block', backgroundColor: 'var(--color-accent)', height: '2px' },
}
```

### 4. Callsite props

Components with `.system()` or `.props()` gain `_`-prefixed props. Each accepts the same prop interface as the component's system groups.

```tsx
// Component definition
const Box = ds.styles({ ... }).system({ space: true, surface: true }).asElement('div');

// Callsite — _hover accepts { bg?, color?, p?, m?, ... }
<Box bg="surface" _hover={{ bg: 'primary' }} _disabled={{ opacity: '0.4' }} />
```

**Type generation:** The callsite props type is derived from the union of the component's system group props, wrapped in `Partial<>`. Each `_`-prefixed key maps to `Partial<SystemProps>`.

### 5. Extraction pipeline changes

The Rust evaluator in `style_evaluator.rs` currently recognizes keys starting with `&` as nested selectors. Two additions:

1. Recognize keys starting with `_` as selector alias references
2. Look up the alias in the system manifest's selector map (loaded at pipeline init)
3. Expand to the resolved CSS selector(s) and process the nested value object normally

For compound selectors (comma-separated), emit duplicate rule blocks — one per selector in the comma list.

### 6. Layer interaction

The alias does NOT affect layer placement. Layer is determined entirely by chain position:

| Chain method | Layer | `_hover` emits in |
|---|---|---|
| `.styles()` | `@layer base` | `@layer base` |
| `.variant()` | `@layer variants` | `@layer variants` |
| `.compound()` | `@layer compounds` | `@layer compounds` |
| `.states()` | `@layer states` | `@layer states` |
| `.system()` callsite | `@layer system` | `@layer system` |
| `.props()` callsite | `@layer custom` | `@layer custom` |

Within a layer, the pseudo-selector adds specificity naturally. `&:hover` is more specific than `&` within the same layer, so hover styles override base styles. This is standard CSS specificity, working correctly within the layer boundary.

## Risks / Trade-offs

- **Type complexity**: Every style object type and every callsite prop type grows by ~25 optional keys. → Mitigation: use a shared `SelectorAliasMap` type, intersected once. Monitor tsc performance.
- **Extraction pipeline scope**: The Rust evaluator needs the selector map at init time. → Mitigation: serialize the map into the system manifest (already loaded by the pipeline).
- **Compound selector duplication**: `_disabled` with 4 selectors emits 4 copies of the rule block in CSS. → Mitigation: this is how CSS comma-separated selectors compile. The gzip delta is negligible.
- **`_before`/`_after` content auto-default**: Could surprise authors who intentionally omit content. → Mitigation: only inject `content: ''` for `_before`/`_after` aliases, not for raw `'&::before'`. Authors who need no-content pseudo-elements use the raw syntax.

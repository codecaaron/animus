## Why

CSS `@layer` makes specificity invariant across layers. This is the cascade contract's strength — but it creates a gap: there is no typed, portable way to express pseudo-state or pseudo-element styles that follow the same layer rules as their surrounding context. Today, authors write raw `'&:hover': { ... }` selector strings inside style objects. These are untyped (typos like `'&:hovr'` are silent), prop shorthands may not resolve inside them, and consumers have no equivalent at the callsite — system props like `<Box bg="surface" />` have no way to add `hover:bg` in the same `@layer system`.

Selector aliases unify pseudo-state and pseudo-element targeting across the entire builder chain and callsite into a single typed vocabulary: `_hover`, `_before`, `_disabled`, etc. The alias determines the CSS selector. The chain position determines the layer. One syntax everywhere.

## What Changes

- New `_`-prefixed keys recognized in every style object position: `.styles()`, `.variant()`, `.compound()`, `.states()`, and callsite system/custom props
- Built-in alias set covering interactive pseudo-states, pseudo-elements, and compound selectors (e.g. `_disabled` maps to `&:disabled, &[aria-disabled="true"], &[data-disabled]`)
- `_before` / `_after` auto-default `content: ''` when not explicitly provided
- New `createSystem().addSelectors()` method for registering custom aliases and overriding built-in defaults
- Prop shorthands (`bg`, `p`, `mt`, etc.) resolve inside alias blocks — `_hover: { bg: 'primary' }` is equivalent to `_hover: { backgroundColor: 'primary' }`
- Raw `'&:...'` selector strings remain supported as a fallback for truly custom selectors
- Extraction pipeline (Rust) updated to recognize `_`-prefixed keys and expand them to their CSS selector equivalents

## Capabilities

### New Capabilities
- `selector-alias-registry`: System-level registry of `_`-prefixed selector aliases, built-in defaults, user override/extension via `addSelectors()`, and resolution at every builder chain level
- `selector-alias-callsite`: Callsite pseudo-state/element props (`_hover`, `_before`, etc.) on system and custom prop interfaces, emitting in the same `@layer` as their parent props

### Modified Capabilities

## Impact

- **@animus-ui/system** — `Animus.ts` (builder chain style object handling), `SystemBuilder.ts` (`addSelectors()` method), `createClassResolver.ts` (runtime alias expansion), type definitions for style objects and callsite props
- **@animus-ui/extract** — `style_evaluator.rs` (recognize `_`-prefixed keys, expand to CSS selectors), `css_generator.rs` (emit expanded selectors in correct layer)
- **Type surface** — Every style object type gains optional `_hover?`, `_before?`, etc. keys. Callsite component props gain the same keys with the component's system prop interface as the value type.
- **No breaking changes** — raw `'&:hover'` strings continue to work, aliases are additive

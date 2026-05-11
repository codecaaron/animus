# @animus-ui/system — Design System Builder

Primary consumer package. Provides the builder chain API for defining components and themes. Extraction-compatible: every builder chain in this package is statically analyzable by the Rust crate.

## Architecture Decision: Zero Internal Dependencies

system's `package.json` declares one internal dependency: `@animus-ui/properties` (static CSS property data — unitless properties, shorthands). The builder-chain and theme-builder implementations live directly in `packages/system/src/` (`Animus.ts`, `AnimusExtended.ts`, `createTheme`, `ThemeBuilder`). Consumers install `@animus-ui/system` and get the complete API surface; `properties` is the only transitive `@animus-ui/*` install.

Earlier iterations split the implementation across `@animus-ui/core` (builder) and `@animus-ui/theming` (theme utilities); both are archived under `legacy/` and no longer participate in the active build graph. See root `CLAUDE.md` § Legacy Packages.

## Builder Chain: Type-State Machine

The builder chain enforces cascade ordering via backwards inheritance. Each method returns a narrower type:

```
ds.styles() → .variant() → .compound() → .states() → .system() → .props() → .asElement()
```

This maps directly to `@layer base, variants, compounds, states, system, custom`. The ordering isn't just convention — it's enforced by the type system. You cannot call `.variant()` after `.compound()`.

**Implementation:** 6 classes in `packages/system/src/Animus.ts` using backwards inheritance (child extends parent). Each class removes the methods that precede it in the cascade.

## Terminals

- `.asElement(tag)` — HTML element component, ref type narrows to tag
- `.asComponent(Component)` — wraps existing React component
- `.asClass()` — returns `(props) => className` (no React component)
- `.extend()` — available on asElement/asComponent output, creates extension chain

Composed output (via `compose()`) is sealed — no `.extend()` available.

## compose() — Slot Composition

```typescript
compose(
  { Root: RootComponent, Child: ChildComponent },
  { shared: { size: true } }
);
```

- `shared` config validated against Root's variant keys at the type level
- Returns sealed `ForwardRefExoticComponent` for each slot
- Root receives shared props and distributes via context
- Children can override shared values via direct props

## Serialization Contract

Two serialize methods produce the inputs the extraction pipeline needs:

**`ds.serialize()`** returns `SerializedConfig`:

- `propConfig` — JSON map of prop name → `{ property, scale, transform, strict }`
- `groupRegistry` — JSON map of group name → prop name array
- `transforms` — live JS transform functions (not serializable, used by subprocess)

**`tokens.serialize()`** returns `SerializedTheme`:

- `scalesJson` — flattened theme: `"scale.key" → "value"`
- `variableMapJson` — token path → CSS variable name: `"colors.primary" → "--color-primary"`
- `variableCss` — `:root { --color-primary: ... }` declarations
- `contextualVarsJson` — per-scale contextual variable names

## Type System

Key type utilities:

- `ThemedCSSProps` — CSS properties narrowed by theme scales (nested selectors carry full constraints)
- `EmittedScales<T>` / `EmittedTokenPaths<T>` — derive valid `{scale.key}` token ref paths from theme
- `VariantPropsOf<T>` — extract variant prop union from component
- `SharedConfig<T>` — validate shared keys against Root's variants in compose()

Type tests run via `verify:types` (tsc --noEmit against `tsconfig.test-d.json`). Self-guarding pattern: unused `@ts-expect-error` triggers TS2578, making regressions self-detecting. For verification commands see root `CLAUDE.md` § Verification Tiers.

## Relationship to Other Packages

| Package                     | Relationship                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------- |
| properties                  | Static CSS property data (unitless set, shorthands). Only runtime `@animus-ui/*` dep. |
| extract                     | Processes the output of serialize(). system describes, extract processes.             |
| vite-plugin                 | Hosts extraction. Loads system via NAPI, calls serialize().                           |
| next-plugin                 | Next.js equivalent of vite-plugin.                                                    |
| legacy/core, legacy/theming | Archived predecessors of system. No runtime link. See root § Legacy Packages.         |

## Exports

Two subpaths:

- `@animus-ui/system` — everything (builder, theme, runtime, types)
- `@animus-ui/system/groups` — pre-built prop groups (space, color, typography, etc.)

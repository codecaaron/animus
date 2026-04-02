## Why

CSS property knowledge (unitless behavior, shorthand ordering, prop validity, type definitions) is consumed by multiple pipeline stages — build-time extraction, post-processing, and runtime — but has no canonical home. The unitless property set is duplicated between `extract/pipeline` and `system/runtime` with divergent sort order. Shorthand properties are duplicated across TypeScript (core) and Rust (extract crate). csstype is depended on directly by system with no augmentation layer. This creates drift risk and forces each consumer to independently maintain CSS domain knowledge that should be shared.

## What Changes

- **Create `@animus-ui/properties` package** — a zero-internal-dependency package that owns all CSS property classification data. Only external dep: `csstype` for property type re-exports.
- **Extract `UNITLESS_PROPERTIES`** — canonical `Set<string>` of 42 CSS properties that should not receive automatic `px` unit fallback. Imported by `extract/pipeline/unit-fallback.ts` and `system/src/runtime/resolveClasses.ts`, replacing their inline definitions.
- **Extract `SHORTHAND_PROPERTIES`** — canonical ordered array of CSS shorthand properties used for declaration ordering (shorthands before longhands). Replaces the inline list in `core/src/properties/orderPropNames.ts`.
- **Re-export csstype** — own the csstype relationship so consumers import property types from `@animus-ui/properties` instead of depending on csstype directly. Provides a single augmentation point.
- **Establish future home** for `isPropValid` if/when we move off `@emotion/is-prop-valid`.

## Capabilities

### New Capabilities
- `css-property-data`: Shared CSS property classification data (unitless set, shorthand list, type re-exports) consumed by multiple pipeline stages

### Modified Capabilities
- `unit-fallback`: Both pipeline and runtime import UNITLESS_PROPERTIES from `@animus-ui/properties` instead of inline definitions
- `extract-pipeline`: Pipeline utilities import shared property data from `@animus-ui/properties`

## Impact

- New package: `packages/properties/` with `src/`, `package.json`, `tsdown.config.ts`, `tsconfig.build.json`
- `packages/extract/pipeline/unit-fallback.ts` — remove inline UNITLESS set, import from `@animus-ui/properties`
- `packages/system/src/runtime/resolveClasses.ts` — remove inline UNITLESS set, import from `@animus-ui/properties`
- `packages/system/package.json` — add `@animus-ui/properties` dependency
- `packages/extract/package.json` — add `@animus-ui/properties` dependency
- Build order: `properties → extract → system → plugins` (properties has zero internal deps, slots at front)
- Subsumes R2 task from `v1-review-fixes` change

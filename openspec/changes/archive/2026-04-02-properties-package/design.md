## Context

CSS property classification data (unitless behavior, shorthand ordering, type definitions) is consumed at multiple pipeline stages but has no shared home. The unitless set is duplicated in `extract/pipeline/unit-fallback.ts` (42 properties) and `system/src/runtime/resolveClasses.ts` (42 properties, different sort order). Shorthand properties are duplicated across TypeScript (`core/src/properties/orderPropNames.ts`) and Rust (`extract/src/css_generator.rs`). csstype is depended on directly by system with no augmentation layer.

The ecosystem pattern (Emotion model) is a zero-dep package exporting plain data: `@emotion/unitless` (6KB, 28M downloads) is the canonical example. The anti-pattern is Panda's `@pandacss/shared` (143KB kitchen sink).

## Goals / Non-Goals

**Goals:**
- Create `@animus-ui/properties` as the single source of truth for CSS property classification data
- Eliminate the inline UNITLESS_PROPERTIES duplication between extract and system
- Establish the csstype ownership point for future augmentations
- Provide SHORTHAND_PROPERTIES as canonical TS source
- Keep the package zero-internal-dependency (only csstype as external)

**Non-Goals:**
- Moving processing logic (applyUnitFallback, orderPropNames functions) — those stay in their respective packages
- Replacing the Rust shorthand list (cross-language duplication is a codegen concern, not a shared-package concern)
- Moving isPropValid now — future home only, @emotion/is-prop-valid stays for now
- Touching core or theming packages (legacy)

## Decisions

### 1. Package name: `@animus-ui/properties`

Boundary test: "Does this answer a question about a CSS property's behavior or classification?" Unitless → yes. Shorthand → yes. Property types → yes. `camelToKebab` → no (string utility). `ANIMUS_LAYERS` → no (cascade architecture).

**Alternative considered:** `@animus-ui/css-data` — rejected as too generic, doesn't communicate the focus on properties specifically.

### 2. Package structure

```
packages/properties/
  src/
    unitless.ts           # UNITLESS_PROPERTIES: Set<string>
    shorthands.ts         # SHORTHAND_PROPERTIES: string[]
    csstype.ts            # Re-export + augmentation point for csstype
    index.ts              # Barrel export
  package.json
  tsconfig.json
  tsconfig.build.json
  tsdown.config.ts
```

**Rationale:** One file per concern. The barrel re-exports everything. Barrel-only for v1 — no subpath exports (three internal consumers don't need them).

### 3. Export shapes

- `UNITLESS_PROPERTIES` as `Set<string>` — consumers do `.has()` lookups, Set is the natural structure. Property names in **kebab-case** (CSS convention, matching how they appear in declarations). 44 properties (42 existing + `aspect-ratio` + `scale`).
- `SHORTHAND_PROPERTIES` as `readonly string[]` — consumers need ordered iteration for declaration sorting. Property names in **camelCase** (matching how they appear in prop configs). Scoped to registered prop-config shorthands, not all CSS shorthands. Deduplicated (current source has duplicate `transition` entry).
- csstype re-exported via wildcard (`export type * from 'csstype'`) — provides `Properties`, `Property`, `Pseudos`, `AtRule`, etc. from a single augmentation point.

**Casing convention rationale:** The two exports use different naming conventions because their consumers operate at different stages. Unitless lookups happen against kebab-case CSS declaration names in post-processing output. Shorthand lookups happen against camelCase prop config keys in the builder. Each file SHALL carry a JSDoc comment explaining this to prevent well-intentioned "normalization" by future contributors.

### 4. Build order insertion

`properties` has zero internal deps. Build order becomes: `properties → extract → system → vite-plugin/next-plugin → showcase`.

The root `package.json` `build:ts` script is a hand-maintained sequential `&&` chain. Insert `bun run --filter '@animus-ui/properties' build &&` at the start of the chain, before `core`. Also add `properties` to the `compile` script's tsc chain. Both `extract` and `system` package.json files get `@animus-ui/properties: workspace:*` added to dependencies.

**Note on system's dependency invariant:** system currently declares zero `@animus-ui/*` dependencies. Adding `@animus-ui/properties` is intentional — it's pure data that gets inlined at build time by tsdown. The published system package remains self-contained. Both extract and system will inline the properties data into their dist (tsdown `platform: neutral` with no externals config), which is the desired behavior — the data IS part of their runtime.

### 5. Consumer migration

- `extract/pipeline/unit-fallback.ts`: Remove inline `UNITLESS_PROPERTIES` Set (lines 6-49). Import from `@animus-ui/properties`.
- `system/src/runtime/resolveClasses.ts`: Remove inline unitless Set (lines 44-87). Import from `@animus-ui/properties`.
- `system/package.json`: Add `@animus-ui/properties` to dependencies. Move `csstype` from direct dep to properties package.

The Rust crate's `SHORTHAND_PROPERTIES` is not changed — cross-language sharing requires a different mechanism (codegen or build-time JSON read), which is out of scope.

## Risks / Trade-offs

- **[New package overhead]** → A new package adds build step and maintenance surface. Mitigation: package is tiny (~100 lines of data), zero internal deps, builds in <1s. The overhead is minimal compared to the drift risk of duplication.
- **[tsdown bundling behavior]** → system's tsdown config uses `platform: neutral` with no explicit externals. When system imports from `@animus-ui/properties`, tsdown will bundle the data inline into system's dist. This is actually desirable — the properties data IS part of system's runtime, and inlining eliminates the runtime dep. Mitigation: verify with a test build.
- **[csstype version coupling]** → Properties package owns csstype dep, consumers get whatever version properties pins. Mitigation: csstype follows semver and breaking changes are rare. Properties re-exports the types, so version bumps happen in one place.

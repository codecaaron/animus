## Why

The design system's provenance is fragmented across three packages with independent loading, serialization, and typing:

1. **Tokens** (`@animus-ui/theming`) — scales, colors, color modes, breakpoints
2. **Properties** (`@animus-ui/core`) — prop registry, group registry, transforms, Emotion runtime, CompatTheme fallback chain
3. **Instance** (`createAnimus().addGroup().build()`) — the builder entry point, typed against a global augmentable `Theme` interface

This fragmentation causes:

- **3 bun subprocesses** in the Vite plugin: one for config, one for theme, one for transforms. Each adds ~50ms to startup and (for transforms) to every HMR cycle.
- **`declare module` ceremony**: consumers must augment a global `Theme` interface for type-safe scale resolution.
- **CompatTheme fallback chain**: Scale types resolve through `keyof Theme` → MapScale → ArrayScale → `keyof CompatTheme` → PropertyValues. A leaky abstraction from the Emotion era.
- **Emotion coupling in core**: The builder chain uses `styled()`, `ThemeProvider`, and `css` — none of which are needed in the extraction world where static CSS replaces runtime style compilation.
- **Transform subprocess on every HMR**: `resolve-transforms.ts` runs via bun on every file save. The transform functions exist in the prop registry — they should be loaded once and held in memory.
- **Dead code accumulation**: `createStylist`, `createParser`, `createPropertyStyle`, `AbstractTheme`, `CompatTheme` — all exist to support the Emotion runtime path that extraction replaces.

## What Changes

New package `@animus-ui/system` — a clean-room design system definition layer that combines tokens, properties, and the builder chain with no Emotion dependency. Core stays as a stable reference for the Emotion-based path.

### Consumer API — Concentric Builder

The system builder mirrors the design system dependency graph: tokens → properties → components. Each phase is a callback with its own builder, providing lexical isolation and sequential TypeScript generic inference.

```typescript
import { createSystem } from '@animus-ui/system';
import { color, border, shadows, background, flex, grid, layout,
         typography, transitions, space, positioning } from '@animus-ui/system/groups';

export const ds = createSystem()
  // Phase 1: TOKENS — what values exist (captures T)
  .withTokens(t => t
    .breakpoints({ xs: 480, sm: 768, md: 1024, lg: 1280, xl: 1440 })
    .colors({ primary: '#4f46e5', secondary: '#7c3aed', /* ... */ })
    .space([0, 4, 8, 12, 16, 24, 32, 48, 64])
    .colorModes('light', { bg: '#fff', text: '#1a1a1a' })
    .build()
  )
  // Phase 2: PROPERTIES — how tokens map to CSS, grouped into vocabularies (captures PropReg, GroupReg)
  .withProperties(p => p
    .addGroup('surface', { color, border, shadows, background })
    .addGroup('arrange', { flex, grid, layout })
    .addGroup('text', { typography })
    .addGroup('motion', { transitions })
    .addGroup('space', space)
    .addGroup('positioning', positioning)
    .build()
  )
  // Terminal — returns SystemInstance<T, PropReg, GroupReg>
  .build();

// Component creation (builder chain, fully typed with T)
const Card = ds.styles({ bg: 'surface', borderRadius: 'md' })
  .variant({ elevated: { boxShadow: 'lg' } })
  .groups(['surface', 'arrange'])
  .asElement('div');

// Plugin serialization (one call, one subprocess)
ds.serialize()
// → { tokens, propConfig, groupRegistry, transforms }
```

### Why Concentric Builders (Not a Config Object)

Each `.with*()` call is a separate TypeScript generic inference boundary. The builder chain enforces sequential resolution:

1. `.withTokens()` resolves `T` — the token scales
2. `.withProperties()` resolves `PropReg` and `GroupReg` — which can reference `T` for scale-aware prop types
3. `.build()` produces `SystemInstance<T, PropReg, GroupReg>` — fully narrowed

A config object (`createSystem({ tokens, groups })`) would require TypeScript to infer all generics simultaneously, causing circular inference when property types reference token scales.

This is the same reason the component builder chain exists — TypeScript needs sequential inference boundaries for dependent generics.

### The Narrative

The chain order mirrors the actual dependency order of design system concepts:

```
TOKENS           →  PROPERTIES         →  COMPONENTS
what values exist   how they map to CSS   using them in action

.withTokens()       .withProperties()     ds.styles()
  colors              surface: {            bg: 'primary'
  space                 color, border     }
  breakpoints         }                   .groups(['surface'])
                                          .asElement('div')
```

### Transforms Are an Extraction Concern

Transforms stay on prop definitions (`{ property: 'width', transform: size }`). The builder chain never executes transforms — by the time a component exists, transforms have been resolved into static CSS by the extraction pipeline:

```
Source: ds.styles({ elevation: 3 })
  → Rust: __TRANSFORM__[elevation](3)     ← placeholder
  → Plugin: elevationFn(3)                ← JS execution
  → CSS: box-shadow: 0 10px 15px ...      ← static output
  → Runtime: className only               ← transform invisible
```

The system collects transform functions from prop definitions during `.serialize()`. No separate transform registration API needed.

### Plugin Simplification

```
Before: 3 subprocesses           After: 1 subprocess
─────────────────────            ──────────────────────
bun -e loadConfig()              bun -e loadSystem()
bun -e loadTheme()                 → tokens, propConfig, groups,
bun -e resolveTransforms()           transforms ALL from ds.serialize()
```

### Plugin API

```typescript
// Before: multiple options for separate concerns
animusExtract({
  configPath: './src/custom-vocabulary.tsx',
  themePath: './src/theme.ts',
})

// After: one option
animusExtract({
  system: './src/ds.ts',  // or auto-detect
})
```

## What This Kills

- `CompatTheme` type and its fallback chain
- `AbstractTheme` interface (`[key: string]: any` escape hatch)
- `Theme` augmentable interface (no more `declare module`)
- `resolve-transforms.ts` as a subprocess script (transforms in-process)
- `evaluateThemeObject` as a separate code path (tokens come from system instance)
- Separate `themePath` / `configPath` plugin options
- `serializeExtractConfig` as a standalone utility (system serializes itself)
- The ~50-100ms bun subprocess cost on every HMR cycle
- Emotion as a dependency for the extraction path
- `@animus-ui/ui` package (dead code, no consumers in monorepo)

## What Stays

- **`@animus-ui/core`** — stays as stable reference for Emotion-based path. Not modified.
- **`@animus-ui/theming`** — ThemeBuilder reused inside `.withTokens()` callback. Package may be kept or folded in.
- **Prop group objects** — the 13 groups are pure data, shared or copied from core.
- **Transform syntax** — `createTransform('name', fn)` and `{ transform: namedFn }` on prop definitions. Unchanged.
- **Component builder chain** — `styles → variant → states → groups → props → asElement`. Same pattern, now generic over `<T, PropReg, GroupReg>`.
- **AnimusExtended** — extension chains work the same, now carrying `T`.

## Capabilities

### New Capabilities
- `system-builder`: Concentric builder (`createSystem().withTokens().withProperties().build()`) as unified design system entry point
- `system-serialization`: Single `.serialize()` method produces all plugin-needed config

### Modified Capabilities
- `builder-chain`: Theme generic `T` added to all 6 builder classes + AnimusExtended (in new package)
- `prop-system`: `ScaleValue`, `Scale`, `CSSProps`, `ParserProps` all parameterized by `T` (in new package)
- `vite-extraction-plugin`: Single `system` option, one subprocess, in-process transform registry
- `custom-instance-extraction`: `configPath`/`themePath` replaced by `system` option

### Removed Capabilities
- `compat-theme-fallback`: CompatTheme type and fallback chain not present in system package

## Impact

### New Package: `packages/system/`
- `src/SystemBuilder.ts` — concentric builder: `.withTokens()`, `.withProperties()`, `.build()`
- `src/PropertyBuilder.ts` — `.addGroup()` accumulating PropReg + GroupReg
- `src/Animus.ts` — builder chain (6 classes) rewritten with `T` as first-class generic
- `src/AnimusExtended.ts` — extension system with `T`
- `src/types/` — clean type system: `ScaleValue<Config, T>`, `CSSProps<..., T>`, no compat fallbacks
- `src/groups/` — re-exported prop group objects (from core or standalone)
- `src/transforms/` — createTransform utility + named transforms

### Modified: `packages/vite-plugin/`
- `src/index.ts` — single `system` option, one `loadSystem()` subprocess, in-process transform registry
- Delete `src/resolve-transforms.ts`
- Simplify `src/config-serializer.ts` (system handles serialization)
- Simplify `src/theme-evaluator.ts` (tokens come from system)

### Modified: `packages/showcase/`
- Consolidate `theme.ts` + `custom-vocabulary.tsx` into one `ds.ts` using `createSystem()`
- Remove `declare module` augmentation
- Import from `@animus-ui/system` instead of `@animus-ui/core`

### Unchanged
- `packages/core/` — stays as-is, stable reference
- `packages/extract/` — Rust crate unchanged (consumes same serialized config format)
- `packages/runtime/` — createComponent shim unchanged

## Open Questions

- **TypeScript generic depth**: Threading `T` through 6 nested builder classes + type utilities creates deep generic instantiation chains. Need to spike with the showcase's theme (~30 color tokens, 6 scales, color modes) to verify TypeScript doesn't hit instantiation depth limits.
- **ThemeBuilder reuse**: Does the existing ThemeBuilder's `.build()` output type cleanly satisfy what `SystemBuilder` needs? It has `_variables`, `_tokens`, `mode` — non-scale keys. May need a type-level filter or a new builder that wraps/adapts ThemeBuilder.
- **Prop group sharing**: Copy the 13 group objects into system, or import from core? Importing creates a dependency on the legacy package. Copying risks drift. Best option may be extracting groups to a shared `@animus-ui/props` package or co-locating in system as the new source of truth.
- **lodash.merge**: Currently used in AnimusExtended for variant accumulation. The rewrite is the right time to remove it.
- **`createSystem` return shape**: Does `ds` expose the builder chain methods directly (`ds.styles()`) or via a property (`ds.builder.styles()`)? Direct is cleaner DX but mixes component-creation methods with system-level methods (`.serialize()`, `.theme`).

## Supersedes

- `openspec/changes/archive/2026-03-23-unified-theme-instance/` — that proposal threaded `T` through existing core. This creates a new package instead, avoiding legacy entanglement.

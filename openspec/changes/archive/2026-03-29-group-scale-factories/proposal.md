## Why

Pre-built prop groups (space, color, typography, etc.) hardcode scale names as string literals. A consumer who names their space scale "smidgens" must recreate all ~15 entries by hand. The `Prop.scale` field is typed as `string` — no compile-time guarantee that a scale name exists in the consumer's theme.

With the theming absorption (change 1) removing the `T` generic from SystemBuilder, scale narrowing now depends entirely on the augmented `Theme` interface. This is the right architecture — but the pre-built groups need a way to be parameterized by scale name so consumers can adapt them to their theme shape.

The core package's `compatTheme` fallback pattern (where `Prop.scale` accepts `keyof Theme | keyof CompatTheme`) is the anti-pattern: it creates phantom scale names that TypeScript says exist but don't at runtime.

## What Changes

**Step 1: Group Factory Functions (this change)**
- Groups become factory functions parameterized by scale name(s)
- Single-scale groups (space, shadows, transitions): factory takes one scale name `<S extends string>(scale: S)`
- Multi-scale groups (typography, border, positioning, color): factory takes a mapping object `<M extends { fonts: string; fontSizes: string; ... }>(scales: M)`
- No-scale groups (flex, grid, layout, background): remain static objects
- Existing static exports become factory invocations: `export const space = spaceGroup('space')`
- `as const` return type preserves literal scale names through the existing `ScaleValue` type machinery
- Zero changes to `Prop` interface, `ScaleValue`, `PropertyBuilder`, or Rust pipeline

**Step 2: Optional addGroup Validation (future, not this change)**
- `PropertyBuilder.addGroup` gains a `ValidateScales<Conf>` conditional type that emits errors when scale names don't match `keyof TokenScales<Theme>`
- Only fires in consumer code (after module augmentation) — library code is unaffected
- Layered on top of step 1, not a prerequisite

**Explicit decision: NO default theme.** Module augmentation with phantom scale names is actively dangerous — the types say `space` exists but the runtime theme may only have `smidgens`. The clean-slate `Theme extends BaseTheme {}` is correct.

## Capabilities

### New Capabilities
- `group-scale-factories`: Factory functions for parameterizing pre-built prop groups with consumer-defined scale names

### Modified Capabilities
- `prop-system`: Pre-built groups become factory invocations internally. Static exports preserved for backward compatibility.

## Impact

- **system/src/groups/index.ts**: Primary target. Factory functions added alongside static objects. Statics redefined as factory invocations.
- **system/src/index.ts**: Export factory functions from package.
- **Type regression tests**: New assertions for factory-created groups with custom scale names resolving against augmented Theme.
- **Showcase**: No change (uses standard scale names).
- **Rust pipeline**: No change (scale names serialize as strings regardless of origin).
- **Consumer API**: Purely additive. `spaceGroup('smidgens')` is new; `space` still works.

## Progression

This is change 3 in the sequence:
1. `absorb-theming-into-system` — decouple theming, kill withTokens (done)
2. `animus-provider` — AnimusProvider + distribution story (proposed)
3. `group-scale-factories` — this change

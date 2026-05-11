## Why

When a numeric style value doesn't resolve through a theme scale (e.g., `p={8}` where `8` isn't in the space scale), the Rust crate emits the raw number without units: `padding: 8`. This is invalid CSS for length properties — browsers ignore it. Emotion and React DOM both handle this by appending `px` to bare numerics on non-unitless properties. This is the single most common "styles look wrong" moment for new users.

## What Changes

- **Unit fallback pass in transform post-processing**: After the existing `__TRANSFORM__` placeholder resolution, a second regex pass detects bare numeric values in CSS declarations and appends `px` for properties that expect length units. Properties in the unitless set (`lineHeight`, `opacity`, `zIndex`, `fontWeight`, `flex`, `order`, etc.) are skipped.
- **Applied in both code paths**: The in-memory `applyTransformPlaceholders()` and the subprocess `resolveTransformPlaceholders()` both gain the unit fallback pass.
- **Matches Emotion/React DOM behavior**: Uses the same unitless property set as `@emotion/unitless` / React DOM's style handling.

## Capabilities

### New Capabilities
- `unit-fallback`: Bare numeric CSS values on non-unitless properties receive `px` suffix during post-processing.

### Modified Capabilities
- `vite-extraction-plugin`: Transform post-processing gains unit fallback pass after `__TRANSFORM__` resolution.

## Impact

- **`packages/vite-plugin/src/index.ts`**: `applyTransformPlaceholders()` gains a `applyUnitFallback()` call after transform resolution. `resolveTransformPlaceholders()` subprocess path also gains the call.
- **No Rust changes**: The Rust crate continues emitting raw numeric values. Unit handling is a JS post-processing concern.
- **No runtime changes**: Unit resolution happens at build time.
- **Showcase**: Any bare numeric values that currently render incorrectly will now get `px` appended.

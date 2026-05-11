## MODIFIED Requirements

### Requirement: Prop definitions support transform functions
Each prop definition SHALL support a `transform` field containing a transform function that converts prop values to CSS values. Transforms SHALL run AFTER scale resolution. The transform field SHALL accept both `NamedTransform` (created via `createTransform`) and bare `TransformFn` functions. `NamedTransform` is the canonical form for extraction compatibility.

#### Scenario: Size transform converts numbers
- **WHEN** a prop `width` has `transform: size` (where `size` is a `NamedTransform` with `.transformName === 'size'`) and receives value `0.5`
- **THEN** the transform SHALL convert `0.5` to `'50%'` (fractional numbers 0-1 become percentages)

#### Scenario: Size transform handles pixels
- **WHEN** a prop `width` has `transform: size` and receives value `100`
- **THEN** the transform SHALL convert `100` to `'100px'` (numbers > 1 become pixel values)

#### Scenario: Size transform passes strings through
- **WHEN** a prop `width` has `transform: size` and receives value `'auto'`
- **THEN** the transform SHALL return `'auto'` unchanged

#### Scenario: NamedTransform is callable at runtime
- **WHEN** `createPropertyStyle` encounters a `NamedTransform` in a prop config's `transform` field
- **THEN** it SHALL call `transform(value, property, props)` directly — the `NamedTransform` is a callable function, no special handling needed

#### Scenario: Bare function still works at runtime
- **WHEN** a prop config uses a bare function `transform: (v) => `${v}px`` (no `createTransform` wrapper)
- **THEN** the runtime SHALL call it identically — `createPropertyStyle` does not distinguish between `NamedTransform` and bare `TransformFn`

## REMOVED Requirements

### Requirement: Prop forwarding filters system props from DOM
**Reason:** The `@emotion/is-prop-valid` dependency is removed from core. Prop forwarding responsibility moves to the runtime shim (`@animus-ui/runtime`) which uses its own prop filtering based on the registered prop names from the config, without Emotion's validation.
**Migration:** The runtime shim's `createComponent` already handles prop forwarding by filtering known system prop names from the DOM element props. The `shouldForwardProp` pattern from Emotion's `styled()` is not needed when components are extracted.

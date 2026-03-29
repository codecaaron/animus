## ADDED Requirements

### Requirement: SystemBuilder serializes inline MapScale objects
The SystemBuilder.serialize() method SHALL serialize prop entries where `scale` is an object (MapScale) as JSON in the serialized output, so the Rust extractor can resolve inline scale lookups.

#### Scenario: Prop group entry with inline MapScale
- **WHEN** a prop is registered via `withProperties()` with `scale: { sm: '640px', md: '768px', lg: '1024px' }`
- **THEN** the serialized config SHALL include the scale object as a JSON value
- **AND** the Rust extractor SHALL resolve `<Component prop="md" />` to `768px`

#### Scenario: Prop group entry with string scale reference (unchanged)
- **WHEN** a prop is registered with `scale: 'colors'`
- **THEN** the serialized config SHALL include the scale as a string reference (existing behavior, no change)

### Requirement: SystemBuilder serializes inline ArrayScale
The SystemBuilder.serialize() method SHALL serialize prop entries where `scale` is an array (ArrayScale) as JSON in the serialized output.

#### Scenario: Prop group entry with inline ArrayScale
- **WHEN** a prop is registered via `withProperties()` with `scale: [0, 4, 8, 16, 32]`
- **THEN** the serialized config SHALL include the scale array as a JSON value
- **AND** the Rust extractor SHALL resolve index-based lookups against the array

### Requirement: SystemBuilder serializes negative flag
The SystemBuilder.serialize() method SHALL include the `negative: boolean` field in serialized prop entries when present.

#### Scenario: Prop with negative enabled
- **WHEN** a prop is registered with `negative: true`
- **THEN** the serialized config SHALL include `"negative": true`
- **AND** the Rust extractor SHALL resolve negative scale values (e.g., `mt={-8}` → `margin-top: -0.5rem`)

### Requirement: deepMerge extracted to shared utility
The `deepMerge` function SHALL exist in a single shared module and be imported by both `Animus.ts` and `AnimusExtended.ts`.

#### Scenario: No behavioral change
- **WHEN** deepMerge is called from either Animus or AnimusExtended
- **THEN** the merge behavior SHALL be identical to the current implementation
- **AND** all existing tests SHALL pass without modification

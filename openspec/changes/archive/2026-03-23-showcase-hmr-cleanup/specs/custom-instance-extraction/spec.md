## ADDED Requirements

### Requirement: Custom instance extraction via explicit config
The extraction pipeline SHALL support custom Animus instances when their config and group registry are passed to the Vite plugin via options. The Rust pipeline's chain walker already recognizes any root identifier — this requirement covers the config wiring.

#### Scenario: Custom instance with custom groups extracts correctly
- **WHEN** a custom Animus instance defines groups like `surface`, `arrange`, `text`
- **THEN** the Vite plugin receives the custom group registry mapping those names to prop arrays
- **THEN** the Rust pipeline resolves system props against the custom group definitions
- **THEN** extracted CSS includes utility classes for system props used on custom-instance components

#### Scenario: Transforms resolve for custom instance
- **WHEN** a custom instance's groups include props with transforms (e.g., `borderRadius` with `size`, `gridTemplateColumns` with `gridItemRatio`)
- **THEN** the Vite plugin's transform post-processing resolves those transforms using the same registry
- **THEN** CSS output contains transformed values (e.g., `border-radius: 12px` not `border-radius: 12`)

### Requirement: Theme augmentation for custom instance type safety
A custom Animus instance's consuming app SHALL augment `@animus-ui/core`'s `Theme` interface with the actual theme type so Scale types resolve against real theme values.

#### Scenario: Scale type resolution with augmented Theme
- **WHEN** the theme defines `fontSizes: { 12, 14, 16, 18, 20, 24, 30, 36, 48, 64 }`
- **THEN** `fontSize: 24` is accepted by the type system
- **THEN** `fontSize: 99` is rejected by the type system (not in the scale)

### Requirement: Custom getExtractConfig export
A custom Animus instance SHALL export a `getExtractConfig()` function that serializes its prop config and group registry for the extraction pipeline.

#### Scenario: Custom config serialization
- **WHEN** calling `getExtractConfig()` from the custom instance module
- **THEN** it returns `{ propConfig: string, groupRegistry: string }` with JSON-serialized maps
- **THEN** the propConfig includes all props from all custom groups with transform names resolved
- **THEN** the groupRegistry maps custom group names to their constituent prop name arrays

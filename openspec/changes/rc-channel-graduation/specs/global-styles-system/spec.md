## ADDED Requirements

### Requirement: Top-level keyframes primitive
The `@animus-ui/system` package SHALL export a top-level `keyframes()` primitive that accepts a frame map (percent-stops → style objects) and returns a branded, typed reference. The primitive SHALL coexist with the existing structured `@keyframes <name>` selector form inside `createGlobalStyles` — this requirement is additive and SHALL NOT remove or alter the structured form.

#### Scenario: Basic keyframes declaration
- **WHEN** a consumer writes `const fadeIn = keyframes({ "0%": { opacity: 0 }, "100%": { opacity: 1 } })`
- **THEN** `fadeIn` SHALL be an object branded as a keyframes reference
- **AND** the returned value SHALL expose (at minimum) a stable generated name suitable for use in an `animationName:` CSS property

#### Scenario: Keyframes reference used as animationName
- **WHEN** a consumer uses `fadeIn` as a value for `animationName:` in a styled component's styles
- **THEN** the emitted CSS SHALL reference the keyframes by its generated name
- **AND** the `@keyframes` block SHALL be emitted into `@layer global` of the virtual stylesheet

#### Scenario: Structured form continues to work
- **WHEN** a consumer uses the existing `createGlobalStyles({ "@keyframes pulse": { ... } })` form alongside the new primitive
- **THEN** both SHALL produce valid `@keyframes` blocks in `@layer global`
- **AND** neither form SHALL interfere with the other's name resolution or emission

### Requirement: Keyframes primitive resolves prop shorthand and tokens
Frames passed to `keyframes()` SHALL resolve prop shorthand, scale lookups, transforms, and token aliases using the same pipeline as the structured `@keyframes` selector form. This preserves parity between the two forms.

#### Scenario: Scale lookup inside frames
- **WHEN** a frame contains `{ bg: "primary" }` and the consumer's theme has `colors.primary → "var(--color-primary)"`
- **THEN** the emitted frame SHALL contain `background-color: var(--color-primary)`

#### Scenario: Token alias inside frames
- **WHEN** a frame contains `{ boxShadow: "0 0 8px {colors.accent/40}" }`
- **THEN** the emitted frame SHALL contain the resolved alpha-color-mix expression

#### Scenario: Transform application inside frames
- **WHEN** a frame uses a prop bound to a named transform
- **THEN** the transform SHALL be applied during resolution — not deferred as a `__TRANSFORM__` placeholder

### Requirement: Keyframes primitive integrates with plugin discovery
The Vite and Next plugins SHALL discover `keyframes()` output from the system module's named exports, following the same `__brand`-based discovery pattern used for `GlobalStyleBlock`.

#### Scenario: Brand-based discovery
- **WHEN** the plugin loads the system module and iterates named exports
- **THEN** it SHALL identify keyframes references by checking a `__brand` property (e.g., `__brand === 'Keyframes'`)
- **AND** it SHALL emit the corresponding `@keyframes` block into `@layer global` alongside any `GlobalStyleBlock` outputs

#### Scenario: No keyframes exported
- **WHEN** the system module does not export any `keyframes()` references
- **THEN** no additional `@keyframes` blocks SHALL be emitted
- **AND** no error or warning SHALL be produced

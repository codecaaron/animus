## ADDED Requirements

### Requirement: Top-level keyframes collection factory
The `@animus-ui/system` package SHALL export a top-level `keyframes()` factory that accepts a record of named frame maps (`{ name: { percent-stop: styles } }`) and returns a branded **collection object** containing one branded reference per named keyframe. The factory SHALL coexist with the existing structured `@keyframes <name>` selector form inside `createGlobalStyles` — this requirement is additive and SHALL NOT remove or alter the structured form.

#### Scenario: Collection factory returns branded record
- **WHEN** a consumer writes `const motion = keyframes({ ember: {...}, flow: {...} })`
- **THEN** the returned `motion` SHALL be an object with `__brand === 'Keyframes'`
- **AND** `motion` SHALL expose a `__frames` field carrying the raw frame data
- **AND** `motion.ember` and `motion.flow` SHALL each be branded `KeyframeRef` objects (`__brand === 'KeyframeRef'`) preserving their literal-type name

#### Scenario: Keyframe ref used as animationName
- **WHEN** a consumer uses `motion.ember` as the value of `animationName:` in a styled component's styles
- **THEN** the extractor SHALL trace the `motion` binding to its `keyframes(...)` factory call, resolve `ember` to its generated name, and substitute the static name into the emitted CSS
- **AND** the corresponding `@keyframes <name>` block SHALL be emitted into `@layer global`

#### Scenario: Keyframe ref used in animation shorthand via template literal
- **WHEN** a consumer writes `animation: \`${motion.flow} 5s linear infinite\`` in a styled component's styles
- **THEN** the extractor SHALL trace the `motion.flow` ref and substitute its resolved name into the emitted CSS animation-shorthand string

#### Scenario: Structured form continues to work in parallel
- **WHEN** a consumer uses the existing `createGlobalStyles({ "@keyframes pulse": { ... } })` form alongside the primitive
- **THEN** both paths SHALL produce valid `@keyframes` blocks in `@layer global` via the same `theme_resolver` pipeline
- **AND** neither form SHALL interfere with the other's name resolution or emission

### Requirement: Keyframes frame body vocabulary
Frame bodies passed to `keyframes()` SHALL accept CSS property names (camelCase; converted to kebab-case), raw CSS values, and `{scale.key}` token references. Frame bodies SHALL NOT resolve bare scale keys (e.g., `textShadow: 'glow-text'`), because the factory is not bound to a system's propConfig. Consumers referencing theme-resolved values SHALL use the token-ref syntax (e.g., `textShadow: '{shadows.glow-text}'`), consistent with `{colors.primary}` refs used elsewhere in Animus.

#### Scenario: Token ref inside frame body
- **WHEN** a frame body contains `textShadow: '{shadows.glow-text}'` and the consumer's theme has `shadows.glow-text → 'var(--shadow-glow-text)'`
- **THEN** the emitted frame SHALL contain `text-shadow: var(--shadow-glow-text)`

#### Scenario: Nested token-ref color-mix inside frame body
- **WHEN** a frame body contains `boxShadow: '0 0 8px {colors.accent/40}'`
- **THEN** the emitted frame SHALL contain the resolved alpha-color-mix expression

#### Scenario: Bare scale key in frame body is NOT resolved
- **WHEN** a frame body contains `textShadow: 'glow-text'` (bare, no `{scale.key}` syntax)
- **THEN** the emitted frame SHALL contain the literal string `glow-text` (unresolved)
- **AND** this SHALL be documented as the required authoring pattern for keyframes (use `{shadows.glow-text}` instead)

### Requirement: Extraction-time binding substitution for keyframe references
The Rust extractor SHALL resolve `motion.ember`-style member-expression references in component style values by tracing the `motion` binding to its `keyframes(...)` factory call (across import boundaries) and substituting the resolved keyframe name into the emitted CSS. This SHALL work for both direct `animationName:` values and template-literal expressions in shorthand `animation:` values.

#### Scenario: Direct ref in animationName
- **WHEN** a component in `Logo.tsx` writes `animationName: motion.flow` and `motion` is imported from `./animations`
- **THEN** the extractor SHALL trace `motion` to its `keyframes(...)` factory, resolve `flow` to its generated name, and emit the static name into the component's extracted CSS

#### Scenario: Template-literal ref in animation shorthand
- **WHEN** a component writes `animation: \`${motion.ember} 1s infinite\``
- **THEN** the extractor SHALL substitute `motion.ember` with the resolved name string at emission time

#### Scenario: Binding shadowed or unresolvable
- **WHEN** the extractor encounters a ref it cannot resolve statically (e.g., shadowed import, runtime-dynamic path)
- **THEN** production builds SHALL produce a hard build error naming the binding
- **AND** development builds MAY fall back to the runtime `toString()` path without erroring

### Requirement: Plugin brand-based discovery of keyframes collections
The Vite and Next plugins SHALL discover `keyframes()` output from the system module's named exports, following the same `__brand`-based discovery pattern used for `GlobalStyleBlock`.

#### Scenario: Brand-based collection discovery
- **WHEN** the plugin loads the system module and iterates named exports
- **THEN** it SHALL identify keyframes collections by `__brand === 'Keyframes'`
- **AND** it SHALL iterate the collection's `__frames` record, resolving each frame body via `theme_resolver::resolve_keyframes_block`, and emit the corresponding `@keyframes <resolved-name>` block into `@layer global`

#### Scenario: No keyframes exported
- **WHEN** the system module does not export any `keyframes()` collections
- **THEN** no additional `@keyframes` blocks SHALL be emitted
- **AND** no error or warning SHALL be produced

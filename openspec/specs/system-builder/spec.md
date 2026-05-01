## Purpose

The `system-builder` capability defines the `createSystem({...})` factory and its `.build()` return shape. The builder accumulates prop registries, groups, and selectors via a chainable API and produces the consumer-facing `{ system, createGlobalStyles, createKeyframes }` bundle that downstream code destructures to author components, global-style blocks, and keyframe collections.

## Requirements

### Requirement: Concentric builder with sequential generic inference

The system builder SHALL provide a fluent API with callback-isolated phases: `.withProperties()` and `.withGlobalStyles()`. The `.withProperties()` phase SHALL capture its generics via TypeScript's sequential method-chain inference. The terminal `.build()` SHALL return a `SystemInstance<PropRegistry, GroupRegistry>`.

#### Scenario: Full system definition

- **WHEN** consumer calls `createSystem().withProperties(p => p.addGroup('surface', { color, border }).build()).withGlobalStyles({...}).build()`
- **THEN** the return type SHALL be `SystemInstance<PropReg, GroupReg>` where PropReg/GroupReg are inferred from the property builder callback return

#### Scenario: Property phase captures PropRegistry and GroupRegistry

- **WHEN** consumer calls `.withProperties(p => p.addGroup('surface', { color, border }).addGroup('text', { typography }).build())`
- **THEN** PropRegistry SHALL be the union of all prop definitions across groups, and GroupRegistry SHALL map group names to their prop keys

#### Scenario: No token phase

- **WHEN** consumer calls `createSystem()`
- **THEN** the returned builder SHALL NOT have a `.withTokens()` method. Theme construction is handled separately by the consumer.

### Requirement: Property builder accumulates groups

The `.withProperties()` callback SHALL receive a PropertyBuilder instance with `.addGroup(name, props)` method. Each `.addGroup()` call SHALL accumulate into PropRegistry and GroupRegistry generics.

#### Scenario: Multiple groups registered

- **WHEN** consumer calls `p.addGroup('surface', { color, border }).addGroup('text', { typography })`
- **THEN** PropRegistry SHALL contain all props from color, border, and typography, and GroupRegistry SHALL map `surface → ['color', 'borderColor', ...]` and `text → ['fontFamily', 'fontSize', ...]`

#### Scenario: Property builder terminal

- **WHEN** consumer calls `.build()` on the PropertyBuilder
- **THEN** the accumulated PropRegistry and GroupRegistry SHALL be captured and returned to the SystemBuilder

### Requirement: SystemInstance provides builder chain entry

The `.build()` terminal on SystemBuilder SHALL return a SystemInstance that exposes the Animus builder chain methods directly (`.styles()`, `.variant()`, etc.) with PropRegistry and GroupRegistry pre-filled from the system definition. Scale resolution uses the augmented `Theme` interface.

#### Scenario: Component creation from system instance

- **WHEN** consumer calls `ds.styles({ bg: 'primary' }).groups(['surface']).asElement('div')`
- **THEN** `bg` SHALL autocomplete with values from the augmented `Theme['colors']` and `groups` SHALL only accept keys from `GroupRegistry`

#### Scenario: Scale resolution via module augmentation

- **WHEN** the consumer has augmented `Theme` with `{ colors: { primary: string; secondary: string } }` and a prop definition has `scale: 'colors'`
- **THEN** autocomplete for that prop SHALL show `'primary' | 'secondary'` plus raw CSS values

### Requirement: Augmentable Theme interface

The system package SHALL export an augmentable `Theme` interface from `@animus-ui/system`. Consumers extend this via module augmentation to enable compile-time scale constraints in `.styles()`, `.variant()`, and `.states()` CSS objects.

#### Scenario: Module augmentation

- **WHEN** consumer writes `declare module '@animus-ui/system' { interface Theme extends ShowcaseTheme {} }` in their system definition file
- **THEN** all CSS object types in the builder chain SHALL constrain property values to the theme's scale keys

#### Scenario: Theme interface is empty by default

- **WHEN** `Theme` is NOT augmented
- **THEN** it SHALL extend `BaseTheme` with no additional properties, and CSS object values SHALL fall back to standard CSS property types

#### Scenario: Theme exported from package index

- **WHEN** consumer imports from `@animus-ui/system`
- **THEN** `Theme` SHALL be available as a named type export alongside `BaseTheme`, `Breakpoints`, and `TokenScales`

#### Scenario: ThemedCSSProps and ThemedScale exported

- **WHEN** the system package is consumed as a library
- **THEN** `ThemedCSSProps`, `ThemedCSSPropMap`, `ThemedScale`, and `ThemedScaleValue` SHALL be exported from the package index to satisfy TS2742 declaration portability requirements

### Requirement: Serialization excludes tokens

The `serialize()` method on SystemInstance SHALL return `{ propConfig, groupRegistry, transforms, globalStyles }`. It SHALL NOT include a `tokens` field. The plugin loads tokens independently from the module's named exports.

#### Scenario: serialize() return shape

- **WHEN** `ds.serialize()` is called
- **THEN** the return SHALL contain `propConfig` (JSON string), `groupRegistry` (JSON string), `transforms` (record of named transforms), and optionally `globalStyles` — but NOT `tokens`

### Requirement: System package exports

The `@animus-ui/system` package SHALL export `createComponent` alongside the existing builder chain, theme construction, and type exports. The package SHALL declare `react` as a peer dependency.

#### Scenario: Package exports include createComponent

- **WHEN** a consumer imports from `@animus-ui/system`
- **THEN** `createComponent` SHALL be available as a named export

#### Scenario: React peer dependency

- **WHEN** `@animus-ui/system` is installed
- **THEN** the package SHALL require `react` as a peer dependency with range `^18.0.0 || ^19.0.0`

#### Scenario: No runtime package dependency

- **WHEN** `@animus-ui/system/package.json` is inspected
- **THEN** `@animus-ui/runtime` SHALL NOT appear in `dependencies` or `peerDependencies`

### Requirement: Builder-bound `createKeyframes` factory with theme-typed frame bodies

The `createSystem(config?).build()` return SHALL expose a `createKeyframes` method alongside the existing `system` and `createGlobalStyles` fields. The factory SHALL accept a record of named keyframes where each keyframe is a `Record<StopKey, ThemedCSSProps<Theme>>` — `StopKey` is a percentage literal (`'0%'`, `'50%'`, `'100%'`, etc.), a keyword (`'from'`, `'to'`), or a comma-separated list of either. Stop body values SHALL use the same `ThemedCSSProps<Theme>` type as `.styles()`, so theme-token references (`{colors.*}`, `{space.*}`, scale-token keys) autocomplete and type-check inside stop bodies. The factory SHALL return a branded `Keyframes` collection: `{ __brand: 'Keyframes', __frames, ...refs }` where each ref carries `__brand: 'KeyframeRef'` and coerces to the resolved FNV-hashed identifier via `toString()`/`valueOf()`.

Names SHALL be generated at authoring time via a deterministic FNV-1a content hash over the serialized frame body, producing `animus-kf-<hash>` identifiers. Identical frame bodies SHALL dedupe into a single `@keyframes` emission naturally. The frame body name depends only on content, not on the factory's binding site.

#### Scenario: Build return exposes `createKeyframes`

- **WHEN** `const { system, createKeyframes, createGlobalStyles } = createSystem({...}).build()` is evaluated
- **THEN** `createKeyframes` SHALL be a function

#### Scenario: Frame body types are theme-parameterized via `ThemedCSSProps`

- **WHEN** a consumer writes `ds.createKeyframes({ pulse: { '0%': { color: '{colors.primary}' } } })` where `ds` is derived from a theme that declares `colors.primary`
- **THEN** TypeScript SHALL accept the `{colors.primary}` value with precise typing
- **AND** writing `{colors.nonexistent}` SHALL produce a type error at the call site
- **AND** the stop body SHALL accept the same vocabulary as `.styles()` body values (via `ThemedCSSProps<Theme>` reuse)

#### Scenario: Returned collection preserves brand and ref shape

- **WHEN** `const anims = ds.createKeyframes({ fadeIn: {...}, pulse: {...} })` is called
- **THEN** `anims.__brand` SHALL equal `'Keyframes'`
- **AND** `anims.fadeIn` SHALL be a `KeyframeRef<'fadeIn'>` with `__brand === 'KeyframeRef'` and a `toString()` returning the resolved FNV-hashed name

#### Scenario: FNV hash stability across binding sites

- **WHEN** the same frame body `{ '0%': { opacity: 0 }, '100%': { opacity: 1 } }` is authored via `ds.createKeyframes({...})` on any system
- **THEN** the resolved keyframe name SHALL equal the FNV-1a hash produced from the serialized frame body content
- **AND** identical frame bodies across different call sites SHALL dedupe into a single `@keyframes` emission

### Requirement: Keyframes frame body vocabulary

Frame bodies passed to `ds.createKeyframes({...})` SHALL accept CSS property names (camelCase; converted to kebab-case at emission), raw CSS values, theme-token references in the `{scale.key}` form (e.g., `{colors.primary}`, `{shadows.glow-text}`), and prop shorthand that the surrounding system's prop registry resolves (e.g., `bg` → `background-color` via the prop config when the theme flows through `ThemedCSSProps<Theme>`). Frame bodies SHALL NOT resolve bare scale keys without the `{scale.key}` delimiter.

#### Scenario: Token ref inside frame body

- **WHEN** a frame body contains `textShadow: '{shadows.glow-text}'` and the consumer's theme has `shadows.glow-text → 'var(--shadow-glow-text)'`
- **THEN** the emitted frame SHALL contain `text-shadow: var(--shadow-glow-text)`

#### Scenario: Nested token-ref color-mix inside frame body

- **WHEN** a frame body contains `boxShadow: '0 0 8px {colors.accent/40}'`
- **THEN** the emitted frame SHALL contain the resolved alpha-color-mix expression

#### Scenario: Bare scale key without delimiter is NOT resolved

- **WHEN** a frame body contains `textShadow: 'glow-text'` (bare, no `{scale.key}` syntax)
- **THEN** the emitted frame SHALL contain the literal string `glow-text` (unresolved)
- **AND** this SHALL be documented as the required authoring pattern for keyframes (use `{shadows.glow-text}` instead)

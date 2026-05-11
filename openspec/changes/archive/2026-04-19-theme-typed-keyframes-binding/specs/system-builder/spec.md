## ADDED Requirements

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


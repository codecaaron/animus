# prop-strict-mode Specification

## Purpose
Per-prop `strict: false` option that widens scale-bound prop types from `scaleKeys | CSSGlobals` to `scaleKeys | (string & {})`, giving consumers an arbitrary-CSS-value escape hatch while preserving scale-key typeahead. Type-only: no runtime or extraction behavior changes. Implemented in `packages/system/src/types/config.ts`; backfilled from the archived `2026-03-29-prop-strict-mode` change.
## Requirements
### Requirement: Prop strict field

The `Prop` interface SHALL accept an optional `strict` field of type `boolean`. When omitted or `true`, prop typing behavior is unchanged from current behavior.

#### Scenario: Prop with strict omitted (default)

- **WHEN** a prop config does not include a `strict` field (e.g., `{ property: 'padding', scale: 'space' }`)
- **THEN** the prop type resolves to scale keys plus CSS globals only, matching current behavior exactly

#### Scenario: Prop with strict explicitly true

- **WHEN** a prop config includes `strict: true` (e.g., `{ property: 'padding', scale: 'space', strict: true }`)
- **THEN** the prop type resolves identically to when `strict` is omitted

### Requirement: Loose typing with strict false

When a prop config sets `strict: false`, the resolved type SHALL include scale keys with typeahead AND accept arbitrary CSS strings via `(string & {})`.

#### Scenario: Theme-referenced scale with strict false

- **WHEN** a prop config is `{ property: 'padding', scale: 'space', strict: false }` and the theme defines `space: { 0, 4, 8, 16 }`
- **THEN** the prop accepts `0 | 4 | 8 | 16 | (string & {}) | 0` — scale keys appear in TypeScript autocomplete, and arbitrary strings like `'2.5rem'` compile without error

#### Scenario: Inline MapScale with strict false

- **WHEN** a prop config uses an inline MapScale `{ property: 'gridAutoFlow', scale: createScale<'row' | 'column'>(), strict: false }`
- **THEN** the prop accepts `'row' | 'column' | (string & {})` — inline values appear in autocomplete, arbitrary strings accepted

#### Scenario: Inline ArrayScale with strict false

- **WHEN** a prop config uses an inline ArrayScale with `strict: false`
- **THEN** the prop accepts array values plus `(string & {})` — inline values appear in autocomplete, arbitrary strings accepted

### Requirement: Strict false with negative scales

When `strict: false` and `negative: true` are both set on a prop, the resolved type SHALL include negative scale keys alongside the loose string type.

#### Scenario: Negative margin with strict false

- **WHEN** a prop config is `{ property: 'margin', scale: 'space', negative: true, strict: false }` and the theme defines `space: { 0, 4, 8, 16 }`
- **THEN** the prop accepts `0 | 4 | 8 | 16 | -4 | -8 | -16 | (string & {}) | 0` — both positive and negative scale keys appear in autocomplete, arbitrary strings also accepted

### Requirement: Strict false with responsive props

When a prop has `strict: false`, the responsive prop wrapper SHALL apply the same loose typing at each breakpoint.

#### Scenario: Responsive value with strict false

- **WHEN** a prop has `strict: false` and is used with responsive syntax `{ sm: '2.5rem', md: 16 }`
- **THEN** each breakpoint value accepts both scale keys and arbitrary strings

### Requirement: Empty scale interaction

When a scale has no values, typing behavior SHALL be unchanged regardless of the `strict` setting.

#### Scenario: Empty scale with strict false

- **WHEN** a prop references an empty scale with `strict: false`
- **THEN** the type resolves to full CSS property values (same as current empty-scale behavior)

#### Scenario: Empty scale with strict true

- **WHEN** a prop references an empty scale with `strict: true` or `strict` omitted
- **THEN** the type resolves to full CSS property values (same as current behavior — no regression)

### Requirement: ThemedScaleValue consistency

The `ThemedScaleValue` type (used for CSS object constraints in `.styles()` and `.variant()`) SHALL respect `strict: false` identically to `ScaleValue`.

#### Scenario: Style object value with strict false prop

- **WHEN** a loose prop is used in `.styles({ p: '2.5rem' })` where `p` is bound to a space scale with `strict: false`
- **THEN** the value `'2.5rem'` compiles without error while scale keys still appear in autocomplete

### Requirement: No runtime behavior change

The `strict` field SHALL be a type-only concern with zero runtime impact. The runtime parser already accepts any value — `strict` only controls what TypeScript allows.

#### Scenario: Runtime with strict false

- **WHEN** a prop with `strict: false` receives a non-scale value at runtime (e.g., `p="2.5rem"`)
- **THEN** the runtime processes it identically to any other string value (pass-through to CSS)

#### Scenario: Extraction with strict false

- **WHEN** a component uses a `strict: false` prop with a static string literal value
- **THEN** the extraction pipeline processes it identically to any other static value (no extraction behavior change)


## MODIFIED Requirements

### Requirement: Custom prop (.props()) utility generation

Custom props defined via `.props()` SHALL have their CSS rules emitted in `@layer custom`. The CSS generation function for custom props (`generate_custom_prop_css`) SHALL accept an optional `slot_entries` parameter for dynamic custom prop variable slot classes. When slot entries are provided, they SHALL be interleaved with static custom prop utility classes in a single sorted `@layer custom {}` block using the same cascade ordering as `@layer system`.

Custom props MAY have inline scales (object or array in the `.props()` config), theme scale references (string), or no scale. Scale resolution follows the same rules as system props.

#### Scenario: Custom prop with inline scale
- **WHEN** a custom prop defines `scale: { xs: '10rem', sm: '15rem' }` and JSX uses `size="sm"`
- **THEN** a utility class is generated with the resolved scale value `15rem`

#### Scenario: Custom prop layer precedence
- **WHEN** a custom prop and a system prop both target the same CSS property
- **THEN** `@layer custom` rules take precedence over `@layer system` rules

#### Scenario: Custom prop with dynamic slot entry
- **WHEN** a custom prop has detected dynamic usage and slot entries are provided
- **THEN** the slot class appears in `@layer custom` interleaved with static custom utility classes, sorted by CSS property cascade key

### Requirement: Variable slot CSS generation

Variable slot classes SHALL be emitted alongside static utility classes in the appropriate `@layer`. For system props, slot classes appear in `@layer system`. For custom props, slot classes appear in `@layer custom`.

Each slot class contains CSS custom property references as values:
- Single-property: `.animus-dyn-p { padding: var(--animus-p); }`
- Multi-property: `.animus-dyn-px { padding-left: var(--animus-px); padding-right: var(--animus-px); }`
- Custom prop (component-scoped): `.animus-dyn-{hash}-size { flex-basis: var(--animus-size); }`

Responsive breakpoint rules use fallback chains:
```css
@media (min-width: 480px) {
  .animus-dyn-p { padding: var(--animus-p-sm, var(--animus-p)); }
}
```

Custom prop slot classes follow the same breakpoint fallback pattern.

#### Scenario: System prop variable slot in @layer system
- **WHEN** a system prop has dynamic usage detected
- **THEN** its slot class appears in `@layer system` interleaved with static utility classes

#### Scenario: Custom prop variable slot in @layer custom
- **WHEN** a custom prop has dynamic usage detected
- **THEN** its slot class appears in `@layer custom` with component-scoped class name (e.g., `animus-dyn-{hash}-{prop}`)

#### Scenario: No variable slot for static-only props
- **WHEN** a prop (system or custom) has only static usage detected (no dynamic)
- **THEN** no variable slot class is generated for that prop

### Requirement: Single sorted emission stream

Within each `@layer` block (`system` or `custom`), all rules — static utility classes AND variable slot classes — SHALL be emitted in a single sorted stream. Sorting uses the CSS property cascade key as primary sort, CSS property name as secondary, and class name as tertiary tiebreaker.

#### Scenario: System layer single stream
- **WHEN** system props have both static utility classes and dynamic variable slot classes
- **THEN** they are interleaved in one `@layer system {}` block sorted by cascade key

#### Scenario: Custom layer single stream
- **WHEN** custom props have both static utility classes and dynamic variable slot classes
- **THEN** they are interleaved in one `@layer custom {}` block sorted by cascade key

#### Scenario: Deterministic output
- **WHEN** the same project is analyzed twice with identical inputs
- **THEN** both `@layer system` and `@layer custom` CSS outputs are byte-identical

### Requirement: CSS property cascade ordering

Within each `@layer` block, CSS rules SHALL be sorted so that shorthand properties appear before longhand properties. This prevents shorthands from resetting longhands set by earlier rules.

The ordering mirrors `packages/core/src/properties/orderPropNames.ts`. Known shorthands (`border`, `margin`, `padding`, `flex`, `background`, `overflow`, `border-radius`, `grid`, `outline`, `transition`, `animation`, `gap`, `inset`, `place-items`, `place-content`, `place-self`) receive cascade key 0. All other properties receive cascade key 1.

This ordering applies to BOTH `@layer system` and `@layer custom`.

#### Scenario: Shorthand before longhand in @layer system
- **WHEN** `@layer system` contains both `border` and `border-bottom-color` rules
- **THEN** `border` rules appear before `border-bottom-color` rules in source order

#### Scenario: Shorthand before longhand in @layer custom
- **WHEN** `@layer custom` contains both `margin` (from a multi-property custom prop) and `margin-left` rules
- **THEN** `margin` rules appear before `margin-left` rules in source order

#### Scenario: Mixed static and dynamic with cascade ordering
- **WHEN** `@layer custom` has a static shorthand utility class and a dynamic longhand slot class
- **THEN** the shorthand static class appears before the longhand dynamic slot class

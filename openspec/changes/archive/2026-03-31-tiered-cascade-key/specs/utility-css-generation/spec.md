## MODIFIED Requirements

### Requirement: Single sorted emission stream
Within each `@layer` block (`system` or `custom`), all rules — static utility classes AND variable slot classes — SHALL be emitted in a single sorted stream. Sorting uses: CSS property cascade key (primary), CSS property name (secondary), breakpoint pixel value (tertiary, 0 for base/static), class name (quaternary tiebreaker).

The cascade key SHALL use the tiered cascade ordering defined in the `tiered-cascade-ordering` capability. This means:
- Super-shorthand utilities (e.g., `border`, `margin`) are emitted first within the layer
- Sub-shorthand utilities (e.g., `borderTop`, `borderWidth`) are emitted in the middle
- Leaf longhand utilities (e.g., `borderTopWidth`, `marginTop`) are emitted last

Overlapping sub-shorthands at the same tier (e.g., `borderTop` and `borderWidth`) SHALL be ordered alphabetically by CSS property name. This is semantically neutral — same-tier siblings have no inherent cascade priority over each other.

The breakpoint sort ensures per-bp slot classes appear in mobile-first order (smallest viewport first) within the same CSS property group.

#### Scenario: Layer ordering
- **WHEN** a component has base styles in `@layer base` and system prop utilities in `@layer system`
- **THEN** the system prop utilities SHALL override the base styles when both target the same CSS property, regardless of specificity or source order outside the layers

#### Scenario: Super-shorthand before sub-shorthand
- **WHEN** a component uses both system prop `border` and system prop `borderTop`
- **THEN** in `@layer system`, the `border` utility class SHALL appear before the `borderTop` utility class in source order, ensuring `borderTop` overrides `border`

#### Scenario: Sub-shorthand before longhand
- **WHEN** a component uses both system prop `borderWidth` and system prop `borderTopWidth`
- **THEN** in `@layer system`, the `borderWidth` utility class SHALL appear before the `borderTopWidth` utility class in source order, ensuring `borderTopWidth` overrides `borderWidth`

#### Scenario: Three-tier depth ordering
- **WHEN** a component uses system props `border`, `borderTop`, and `borderTopWidth`
- **THEN** in `@layer system`, the source order SHALL be: `border` utility first, `borderTop` utility second, `borderTopWidth` utility third

#### Scenario: Overlapping siblings ordered alphabetically
- **WHEN** a component uses system props `borderTop` and `borderWidth` (both tier 1)
- **THEN** their utility classes SHALL be ordered by CSS property name alphabetically (`border-top` before `border-width`), not by an arbitrary list index

#### Scenario: Radius depth chain
- **WHEN** a component uses system props `borderRadius` and `borderTopLeftRadius`
- **THEN** in `@layer system`, the `borderRadius` utility (tier 1 sub-shorthand) SHALL appear before `borderTopLeftRadius` utility (tier 2 longhand)

#### Scenario: Margin family ordering
- **WHEN** a component uses system props `m` (margin shorthand) and `mt` (marginTop longhand)
- **THEN** in `@layer system`, the `margin` utility (tier 0 super-shorthand) SHALL appear before `margin-top` utility (tier 2 longhand)

#### Scenario: Grid family depth ordering
- **WHEN** a component uses system props `grid`, `gridTemplate`, and `gridTemplateColumns`
- **THEN** in `@layer system`, the source order SHALL be: `grid` (tier 0), `grid-template` (tier 1), `grid-template-columns` (tier 2)

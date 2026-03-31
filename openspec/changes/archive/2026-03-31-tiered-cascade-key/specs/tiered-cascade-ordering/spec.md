## ADDED Requirements

### Requirement: Tiered cascade key function
The `css_property_cascade_key()` function SHALL return a numeric sort key that encodes the CSS shorthand tree depth of the given property. The key SHALL place super-shorthands earliest (lowest values), sub-shorthands in the middle tier, and leaf longhands latest (highest values). Tier boundaries SHALL be separated by a numeric range (not adjacent integers) to allow future insertion of intermediate tiers without renumbering.

#### Scenario: Super-shorthand properties
- **WHEN** `css_property_cascade_key` is called with `"border"`, `"margin"`, `"padding"`, `"background"`, `"flex"`, `"gap"`, `"grid"`, `"transition"`, or `"overflow"`
- **THEN** it SHALL return a value in the tier 0 range (lowest tier)

#### Scenario: Sub-shorthand properties
- **WHEN** `css_property_cascade_key` is called with `"borderTop"`, `"borderWidth"`, `"borderColor"`, `"borderStyle"`, `"borderRadius"`, `"gridTemplate"`, `"gridArea"`, `"gridColumn"`, or `"gridRow"`
- **THEN** it SHALL return a value in the tier 1 range, which is strictly greater than all tier 0 values

#### Scenario: Leaf longhand properties
- **WHEN** `css_property_cascade_key` is called with `"borderTopWidth"`, `"borderTopColor"`, `"marginTop"`, `"paddingLeft"`, `"gridTemplateColumns"`, `"flexGrow"`, `"backgroundColor"`, `"color"`, `"display"`, or any property not in tier 0 or tier 1
- **THEN** it SHALL return a value in the tier 2 range, which is strictly greater than all tier 1 values

#### Scenario: Kebab-case input equivalence
- **WHEN** `css_property_cascade_key` is called with `"border-top"` (kebab-case)
- **THEN** it SHALL return the same value as for `"borderTop"` (camelCase)

#### Scenario: Unknown properties fall to leaf tier
- **WHEN** `css_property_cascade_key` is called with a property not enumerated in any tier (e.g., `"customProperty"`)
- **THEN** it SHALL return a value in the leaf tier (tier 2), ensuring it has highest cascade priority (safest failure mode)

### Requirement: Tier 0 — super-shorthand enumeration
Tier 0 SHALL contain exactly the CSS properties that reset an entire property family. These are the most general shorthands. The following properties SHALL be in tier 0:

| Property | CSS shorthand for |
|----------|-------------------|
| `border` | All border sub-properties |
| `background` | All background sub-properties |
| `flex` | flex-grow, flex-shrink, flex-basis |
| `margin` | All margin sides |
| `padding` | All padding sides |
| `gap` | row-gap, column-gap |
| `grid` | All grid template/auto sub-properties |
| `transition` | All transition sub-properties |
| `overflow` | overflow-x, overflow-y |
| `outline` | outline-width, outline-style, outline-color |

#### Scenario: Tier 0 completeness
- **WHEN** the tiered structure is queried for all tier 0 entries
- **THEN** it SHALL contain all CSS super-shorthands listed above and no properties that are sub-shorthands or longhands

### Requirement: Tier 1 — sub-shorthand enumeration
Tier 1 SHALL contain CSS properties that are shorthands for a subset of a family — they reset some but not all sub-properties of a tier 0 shorthand. The following properties SHALL be in tier 1:

**Border family:**
`borderTop`, `borderRight`, `borderBottom`, `borderLeft`, `borderWidth`, `borderStyle`, `borderColor`, `borderRadius`, `borderImage`

**Grid family:**
`gridTemplate`, `gridArea`, `gridColumn`, `gridRow`

#### Scenario: Tier 1 completeness for border family
- **WHEN** the tiered structure is queried for tier 1 entries in the border family
- **THEN** it SHALL contain all directional sub-shorthands (`borderTop`, `borderRight`, `borderBottom`, `borderLeft`), all property-axis sub-shorthands (`borderWidth`, `borderStyle`, `borderColor`), and `borderRadius` and `borderImage`

#### Scenario: Overlapping siblings get same tier
- **WHEN** `css_property_cascade_key` is called with `"borderTop"` and `"borderWidth"`
- **THEN** both SHALL return values in the tier 1 range, and their relative ordering SHALL be determined by the secondary sort (alphabetical property name), not by their cascade key

### Requirement: Sort key is a pure function of CSS property name
The cascade key function SHALL depend only on the CSS property name string. It SHALL NOT depend on prop config, component context, file path, breakpoint, or any other state. This ensures any subset of utility rules can be independently sorted and merged correctly.

#### Scenario: Deterministic across calls
- **WHEN** `css_property_cascade_key("borderTop")` is called multiple times with different surrounding context
- **THEN** it SHALL return the same value every time

#### Scenario: No external state dependency
- **WHEN** `css_property_cascade_key` is called during initial extraction and again during HMR re-extraction
- **THEN** it SHALL return identical values for the same property inputs

## ADDED Requirements

### Requirement: Utility class generation

For each unique (prop, value) pair collected by the JSX scanner, the utility CSS generator SHALL produce a single CSS class rule containing the resolved CSS declarations. Resolution SHALL use the same theme scale lookup and transform pipeline as base style extraction.

#### Scenario: Simple numeric value with scale

- **WHEN** prop is `p` with value `8`, config has `{ property: "padding", scale: "space" }`, theme has `{ "space.8": "0.5rem" }`
- **THEN** the generator SHALL produce a class rule containing `padding: 0.5rem;`

#### Scenario: String value with scale

- **WHEN** prop is `color` with value `"primary"`, config has `{ property: "color", scale: "colors" }`, theme has `{ "colors.primary": "var(--colors-primary)" }`
- **THEN** the generator SHALL produce a class rule containing `color: var(--colors-primary);`

#### Scenario: Multi-property prop

- **WHEN** prop is `px` with value `16`, config has `{ property: "padding", properties: ["paddingLeft", "paddingRight"], scale: "space" }`, theme has `{ "space.16": "1rem" }`
- **THEN** the generator SHALL produce a class rule containing `padding-left: 1rem; padding-right: 1rem;`

#### Scenario: Value with transform

- **WHEN** prop is `width` with value `1`, config has `{ property: "width", transform: "size" }`
- **THEN** the generator SHALL apply the size transform producing a class rule containing `width: 100%;`

#### Scenario: Value with no scale match (passthrough)

- **WHEN** prop is `display` with value `"flex"`, config has `{ property: "display" }` (no scale)
- **THEN** the generator SHALL produce a class rule containing `display: flex;`

### Requirement: Responsive utility classes

For responsive values (objects with breakpoint keys), the generator SHALL produce a single class containing the base declaration and `@media` queries for each breakpoint.

#### Scenario: Responsive with default and one breakpoint

- **WHEN** prop is `mt` with value `{ _: 8, sm: 16 }`, config has `{ property: "marginTop", scale: "space" }`, theme has `{ "space.8": "0.5rem", "space.16": "1rem" }`, breakpoints has `{ sm: 768 }`
- **THEN** the generator SHALL produce a class rule containing `margin-top: 0.5rem;` and within `@media (min-width: 768px) { margin-top: 1rem; }`

#### Scenario: Responsive without \_ key

- **WHEN** prop is `position` with value `{ sm: "static" }`, breakpoints has `{ sm: 768 }`
- **THEN** the generator SHALL produce a class rule containing ONLY `@media (min-width: 768px) { position: static; }` — no base declaration

#### Scenario: Responsive with multiple breakpoints

- **WHEN** prop is `fontSize` with value `{ _: 16, xs: 18, md: 22 }`, config has `{ property: "fontSize", scale: "fontSizes" }`, theme has `{ "fontSizes.16": "1rem", "fontSizes.18": "1.125rem", "fontSizes.22": "1.375rem" }`, breakpoints has `{ xs: 480, md: 1024 }`
- **THEN** the generator SHALL produce `font-size: 1rem;` at base, and two @media blocks at 480px and 1024px with their respective values

### Requirement: Utility class naming

Utility class names SHALL follow the pattern `animus-u-{hash}` where `hash` is an 8-character content hash of the canonical CSS output (after resolution and transform). Two values that resolve to identical CSS SHALL produce the same class name.

#### Scenario: Same resolved value from different inputs

- **WHEN** prop `p` with value `8` resolves to `padding: 0.5rem` AND prop `p` with string value `"0.5rem"` also resolves to `padding: 0.5rem`
- **THEN** both SHALL produce the same class name

#### Scenario: Stable across builds

- **WHEN** the same (prop, value) pair is extracted in two separate builds
- **THEN** the class name SHALL be identical

#### Scenario: Different values produce different names

- **WHEN** prop `p` with value `8` and prop `p` with value `16` are both extracted
- **THEN** they SHALL produce different class names

### Requirement: @layer system placement

All utility class rules SHALL be emitted within `@layer system { }`. This ensures utility classes take precedence over base, variant, and state styles per the CSS cascade layer specification.

#### Scenario: Layer ordering

- **WHEN** a component has base styles in `@layer base` and system prop utilities in `@layer system`
- **THEN** the system prop utilities SHALL override the base styles when both target the same CSS property, regardless of specificity or source order outside the layers

#### Scenario: Utility and variant on same property

- **WHEN** a component has variant style `color: red` in `@layer variants` and system prop `color="primary"` producing a utility in `@layer system`
- **THEN** the utility SHALL win — `@layer system` has higher precedence than `@layer variants`

### Requirement: Custom prop (.props()) utility generation

Custom props defined via `.props()` SHALL have their CSS rules emitted in `@layer custom`. The CSS generation function for custom props (`generate_custom_prop_css`) SHALL accept an optional `slot_entries` parameter for dynamic custom prop variable slot classes. When slot entries are provided, they SHALL be interleaved with static custom prop utility classes in a single sorted `@layer custom {}` block using the same cascade ordering as `@layer system`.

Custom props MAY have inline scales (object or array in the `.props()` config), theme scale references (string), or no scale. Scale resolution follows the same rules as system props. Numeric values in inline scales SHALL have unit fallback applied at build time (e.g., `64` → `"64px"` for `font-size`), using the same unitless property set as the runtime.

#### Scenario: Custom prop with inline scale

- **WHEN** a custom prop defines `scale: { xs: '10rem', sm: '15rem' }` and JSX uses `size="sm"`
- **THEN** a utility class is generated with the resolved scale value `15rem`

#### Scenario: Custom prop with inline numeric scale

- **WHEN** a custom prop defines `scale: { md: 64 }` targeting `font-size`
- **THEN** the scale value is stored as `"64px"` (unit fallback applied at build time)

#### Scenario: Custom prop layer precedence

- **WHEN** a custom prop and a system prop both target the same CSS property
- **THEN** `@layer custom` rules take precedence over `@layer system` rules

#### Scenario: Custom prop with dynamic slot entry

- **WHEN** a custom prop has detected dynamic usage and slot entries are provided
- **THEN** the slot classes appear in `@layer custom` interleaved with static custom utility classes, sorted by CSS property cascade key then breakpoint order

### Requirement: Variable slot CSS generation

Variable slot classes SHALL use a per-breakpoint class pattern. Each dynamic prop produces a base slot class plus one slot class per breakpoint. The runtime applies only the classes for breakpoints the user actually provides.

Base slot class — no `@media` wrapper, simple `var()` reference:

- Single-property: `.animus-dyn-p { padding: var(--animus-p); }`
- Multi-property: `.animus-dyn-px { padding-left: var(--animus-px); padding-right: var(--animus-px); }`
- Custom prop (component-scoped): `.animus-dyn-{hash}-size { flex-basis: var(--animus-size); }`

Per-breakpoint slot classes — each wrapped in its own `@media`, targeting its own CSS variable:

```css
@media (min-width: 480px) {
  .animus-dyn-p-xs {
    padding: var(--animus-p-xs);
  }
}
@media (min-width: 768px) {
  .animus-dyn-p-sm {
    padding: var(--animus-p-sm);
  }
}
```

No nested `var()` fallback chains. Each breakpoint class directly references its own variable. Unset breakpoints never conflict because their class is not applied to the element.

#### Scenario: System prop variable slot in @layer system

- **WHEN** a system prop has dynamic usage detected
- **THEN** a base slot class and per-breakpoint slot classes appear in `@layer system`

#### Scenario: Custom prop variable slot in @layer custom

- **WHEN** a custom prop has dynamic usage detected
- **THEN** a base slot class and per-breakpoint slot classes appear in `@layer custom` with component-scoped class names (e.g., `animus-dyn-{hash}-{prop}`, `animus-dyn-{hash}-{prop}-sm`)

#### Scenario: No variable slot for static-only props

- **WHEN** a prop (system or custom) has only static usage detected (no dynamic)
- **THEN** no variable slot class is generated for that prop

#### Scenario: Runtime applies only used breakpoint classes

- **WHEN** a component receives `p={{ _: 8, md: 16 }}` dynamically
- **THEN** the runtime applies `.animus-dyn-p` (base) and `.animus-dyn-p-md` only — not xs, sm, lg, or xl classes

#### Scenario: Unset breakpoint does not conflict

- **WHEN** a component receives `p={{ _: 8, md: 16 }}` and the viewport is >1440px
- **THEN** the md value (16) is used because no xl class overrides it — the xl slot class is not on the element

### Requirement: Single sorted emission stream

Within each `@layer` block (`system` or `custom`), all rules — static utility classes AND variable slot classes — SHALL be emitted in a single sorted stream. Sorting uses: CSS property cascade key (primary), CSS property name (secondary), breakpoint pixel value (tertiary, 0 for base/static), class name (quaternary tiebreaker).

The breakpoint sort ensures per-bp slot classes appear in mobile-first order (smallest viewport first) within the same CSS property group.

#### Scenario: System layer single stream

- **WHEN** system props have both static utility classes and dynamic variable slot classes
- **THEN** they are interleaved in one `@layer system {}` block sorted by cascade key then breakpoint order

#### Scenario: Custom layer single stream

- **WHEN** custom props have both static utility classes and dynamic variable slot classes
- **THEN** they are interleaved in one `@layer custom {}` block sorted by cascade key then breakpoint order

#### Scenario: Per-bp classes sorted by pixel value

- **WHEN** slot classes exist for breakpoints xs(480), sm(768), md(1024), lg(1200), xl(1440)
- **THEN** they appear in source order: base, xs, sm, md, lg, xl

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

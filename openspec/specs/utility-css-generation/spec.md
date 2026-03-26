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

#### Scenario: Responsive without _ key
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
Custom props defined via `.props()` SHALL be handled identically to group props, except their CSS rules SHALL be emitted in `@layer custom` (not `@layer system`). Custom props MAY have inline scales (object or array) rather than theme string references.

#### Scenario: Custom prop with inline scale
- **WHEN** a chain has `.props({ logoSize: { property: 'fontSize', scale: { xs: 28, sm: 32, md: 64 } } })` and JSX has `<Logo logoSize="md" />`
- **THEN** the generator SHALL look up `"md"` in the inline scale `{ xs: 28, sm: 32, md: 64 }`, get `64`, and produce a class rule containing `font-size: 64px;` in `@layer custom`

#### Scenario: Custom prop layer precedence
- **WHEN** a component has a system group prop `fontSize={16}` in `@layer system` and a custom prop `logoSize="md"` in `@layer custom` both targeting `font-size`
- **THEN** the custom prop SHALL win — `@layer custom` has higher precedence than `@layer system`

### Requirement: Variable slot CSS generation
The CSS generator SHALL produce variable slot classes for props listed in `dynamic_props`. Variable slot classes SHALL be emitted alongside static utility classes in the appropriate `@layer`.

#### Scenario: Single-property variable slot class
- **WHEN** prop `p` (property: `padding`) has dynamic usage
- **THEN** the CSS generator SHALL emit `.animus-dyn-p { padding: var(--animus-p); }` in `@layer system`

#### Scenario: Multi-property variable slot class
- **WHEN** prop `px` (properties: `padding-left`, `padding-right`) has dynamic usage
- **THEN** the CSS generator SHALL emit `.animus-dyn-px { padding-left: var(--animus-px); padding-right: var(--animus-px); }` in `@layer system`

#### Scenario: Breakpoint fallback chain generation
- **WHEN** prop `p` has dynamic usage and breakpoints are `{ sm: "640px", md: "768px", lg: "1024px" }`
- **THEN** the CSS generator SHALL emit responsive rules where each breakpoint's `var()` falls back to the base variable:
  ```
  @media (min-width: 640px) { .animus-dyn-p { padding: var(--animus-p-sm, var(--animus-p)); } }
  @media (min-width: 768px) { .animus-dyn-p { padding: var(--animus-p-md, var(--animus-p)); } }
  @media (min-width: 1024px) { .animus-dyn-p { padding: var(--animus-p-lg, var(--animus-p)); } }
  ```

#### Scenario: Variable slot class name convention
- **WHEN** prop name is `mt`
- **THEN** the variable slot class name SHALL be `animus-dyn-mt`

#### Scenario: Custom prop variable slot in @layer custom
- **WHEN** a custom prop `logoSize` has dynamic usage
- **THEN** the variable slot class SHALL be placed in `@layer custom`

#### Scenario: No variable slot for static-only props
- **WHEN** prop `display` has only static usages (`display="flex"`, `display="block"`)
- **THEN** no variable slot class SHALL be generated for `display`

### Requirement: Single sorted emission stream
Variable slot classes and static utility classes SHALL be emitted in a single `@layer system {}` block, interleaved by CSS property cascade order. The `build_variable_slot_entries()` function produces `ResolvedStyles` entries that merge into the same emission pipeline as static utility classes.

#### Scenario: One @layer system block
- **WHEN** both static utility classes and dynamic slot classes exist
- **THEN** the CSS output SHALL contain exactly one `@layer system { ... }` block containing all rules interleaved

#### Scenario: Mixed static and dynamic generates both
- **WHEN** prop `p` has static usages `p={8}` and `p={16}` plus dynamic usage `p={variable}`
- **THEN** the CSS SHALL contain static classes `animus-u-{hash}` for values 8 and 16 AND variable slot class `animus-dyn-p` — all in the same `@layer system` block

#### Scenario: Static class takes precedence via runtime
- **WHEN** a component renders with `p={8}` and both a static class and variable slot class exist for `p`
- **THEN** the runtime SHALL apply the static class only — the variable slot class is NOT added (runtime resolution order: static match first)

### Requirement: CSS property cascade ordering
All rules within `@layer system` SHALL be sorted by CSS property cascade priority, mirroring `packages/core/src/properties/orderPropNames.ts`. Shorthand properties (border, margin, padding, etc.) SHALL appear before longhand properties in source order. This ensures longhands always override shorthands within the same layer and specificity.

#### Scenario: Shorthand before longhand
- **WHEN** both `border-bottom` (shorthand) and `border-bottom-color` (longhand) rules exist in `@layer system`
- **THEN** the `border-bottom` rule SHALL appear BEFORE the `border-bottom-color` rule in source order — the longhand wins when both are applied

#### Scenario: Padding shorthand before color longhand
- **WHEN** both `padding` utility classes and `color` utility classes exist
- **THEN** `padding` rules SHALL appear before `color` rules (padding is in SHORTHAND_PROPERTIES, color is not)

#### Scenario: Deterministic ordering across runs
- **WHEN** the same project is analyzed twice
- **THEN** the CSS output SHALL be byte-identical — the cascade sort is fully deterministic (cascade key → CSS property name → class name)

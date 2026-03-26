## ADDED Requirements

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

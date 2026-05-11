## MODIFIED Requirements

### Requirement: Dynamic style memoization is per-instance

The `createComponent` runtime SHALL memoize dynamic style objects per component INSTANCE, not per component TYPE. Multiple instances of the same component rendered with different dynamic system prop values SHALL each receive their own correct style object.

#### Scenario: Two instances with different dynamic props
- **WHEN** `<Button mt={4} />` and `<Button mt={8} />` render in the same tree
- **THEN** the first instance SHALL have `style` containing the CSS variable for `mt=4`
- **AND** the second instance SHALL have `style` containing the CSS variable for `mt=8`
- **AND** re-rendering either instance SHALL NOT affect the other's style

#### Scenario: Single instance memoization still works
- **WHEN** a single `<Button mt={4} />` re-renders with the same props
- **THEN** the style object SHALL be referentially identical across renders (memoized)

#### Scenario: RSC path unaffected
- **WHEN** `.asClass()` is used to generate class names (RSC-safe path)
- **THEN** no memoization state SHALL be involved
- **AND** the class resolver SHALL remain RSC-compatible

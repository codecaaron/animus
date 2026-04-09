## MODIFIED Requirements

### Requirement: TypeSignature uses variant-based token spans
TypeSignature SHALL replace 6 single-purpose styled spans (NameSpan, GenericSpan, PunctSpan, ParamNameSpan, ParamTypeSpan, ReturnSpan) with one `TokenSpan` element using `.variant({ prop: 'role' })` with options: name, generic, punct, param, paramType, return.

#### Scenario: Color mapping preserved
- **WHEN** TypeSignature renders a function signature
- **THEN** name tokens SHALL be `primary`, generic tokens `{colors.violet.400}`, punct tokens `text.dim`, param tokens `{colors.ocean.500}`, paramType tokens `{colors.violet.400}`, return tokens `{colors.forest.500}`

### Requirement: MethodCard uses states for expand/collapse
MethodCard Chevron SHALL use `.states({ expanded: { transform: 'rotate(180deg)' } })` instead of inline style for rotation.

#### Scenario: Chevron rotation via states
- **WHEN** the MethodCard is expanded
- **THEN** the Chevron element SHALL receive the `expanded` state prop
- **AND** the rotation SHALL be applied via `@layer states` CSS, not inline style

### Requirement: MethodCard accordion accessibility
MethodCard SHALL implement proper accordion ARIA semantics.

#### Scenario: ARIA attributes present
- **WHEN** a MethodCard renders
- **THEN** the header button SHALL have `aria-expanded` and `aria-controls` pointing to the detail section's `id`
- **AND** the detail section SHALL have `role="region"` and `aria-labelledby` pointing to the header

# selector-alias-callsite Specification

## Purpose
TBD - created by archiving change selector-aliases. Update Purpose after archive.
## Requirements
### Requirement: Callsite pseudo-state props on system components
Components with `.system()` SHALL accept `_`-prefixed props at the callsite. Each pseudo-state prop SHALL accept the same prop interface as the component's system groups, wrapped in `Partial<>`.

#### Scenario: Hover prop on a system component
- **WHEN** a component is defined as `ds.styles({...}).system({ space: true, surface: true }).asElement('div')`
- **AND** the consumer writes `<Box bg="surface" _hover={{ bg: 'primary' }} />`
- **THEN** the component emits `background-color: var(--color-surface)` in `@layer system` and `&:hover { background-color: var(--color-primary) }` in `@layer system`

#### Scenario: Disabled prop with compound selectors
- **WHEN** the consumer writes `<Box _disabled={{ opacity: '0.4', pointerEvents: 'none' }} />`
- **THEN** the component emits rules targeting `&:disabled`, `&[disabled]`, `&[aria-disabled="true"]`, and `&[data-disabled]` in `@layer system`

### Requirement: Callsite pseudo-element props on system components
Components with `.system()` SHALL accept `_before` and `_after` props at the callsite with auto-defaulted `content: ''`.

#### Scenario: Before pseudo-element at callsite
- **WHEN** the consumer writes `<Box _before={{ display: 'block', bg: 'primary', height: '2px' }} />`
- **THEN** the component emits `&::before { content: ""; display: block; background-color: var(--color-primary); height: 2px }` in `@layer system`

### Requirement: Callsite pseudo props on custom prop components
Components with `.props()` SHALL accept `_`-prefixed props at the callsite, emitting in `@layer custom`.

#### Scenario: Hover on custom prop component
- **WHEN** a component has `.props({ fluid: { ... } }).asElement('div')` and the consumer writes `<Comp _hover={{ bg: 'surface' }} />`
- **THEN** the hover rule emits in `@layer custom`

### Requirement: Callsite pseudo props type safety
The TypeScript types for `_`-prefixed callsite props SHALL be derived from the component's system group registration. Only props from registered groups SHALL appear in the pseudo-prop type.

#### Scenario: Type-narrowed pseudo props
- **WHEN** a component registers `.system({ space: true })` (only space group)
- **THEN** `_hover` on that component accepts `{ p?, m?, px?, py?, ... }` but NOT `{ bg?, color?, ... }`

#### Scenario: Custom selector aliases available at callsite
- **WHEN** the system has `.addSelectors({ _open: '&[data-state="open"]' })`
- **THEN** components from that system accept `_open={{ ... }}` as a callsite prop


## ADDED Requirements

### Requirement: Compound variant resolution in createComponent
The `createComponent` runtime SHALL accept an optional `compounds` array in the config object. Each entry SHALL have `conditions` (a `Record<string, string>` mapping variant prop names to expected values) and `className` (the compound class to apply). At render time, the runtime SHALL iterate the array and apply each matching compound's className.

#### Scenario: Config with compounds
- **WHEN** `createComponent('button', 'animus-Btn-hash', { variants: {...}, compounds: [{ conditions: { size: "sm", variant: "ghost" }, className: "animus-Btn-hash--compound-0" }] })` creates a component
- **THEN** the component SHALL check compound conditions at render time

#### Scenario: Compound class applied after variant classes
- **WHEN** a component has variants and compounds, and both match at render time
- **THEN** the className order SHALL be: base class, variant classes, compound classes, state classes — reflecting cascade layer order

#### Scenario: Compound props filtered from DOM
- **WHEN** compound conditions reference prop `size` and prop `variant`
- **THEN** these props SHALL already be filtered by the existing variant prop filtering — no additional filtering needed for compounds

#### Scenario: No compounds in config
- **WHEN** config does not include a `compounds` field
- **THEN** the runtime SHALL skip compound resolution with zero overhead

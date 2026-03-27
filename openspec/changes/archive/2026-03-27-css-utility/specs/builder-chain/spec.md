## MODIFIED Requirements

### Requirement: Builder chain terminals
The builder chain SHALL support three terminal methods: `.asElement()`, `.asComponent()`, and `.asClass()`. Each terminal consumes the accumulated chain configuration and produces a different output shape. Only one terminal may be called per chain.

#### Scenario: `.asClass()` terminal produces callable
- **WHEN** `.asClass()` is called on a builder chain
- **THEN** it returns a function `(props?: InferredProps) => string`

#### Scenario: `.asElement()` terminal produces React component
- **WHEN** `.asElement('div')` is called on a builder chain
- **THEN** it returns a React forwardRef component

#### Scenario: `.asComponent()` terminal produces extended React component
- **WHEN** `.asComponent(Base)` is called on a builder chain
- **THEN** it returns a React forwardRef component extending Base

#### Scenario: Terminals are mutually exclusive
- **WHEN** one terminal has been called on a chain
- **THEN** no other terminal method SHALL be available in the type system

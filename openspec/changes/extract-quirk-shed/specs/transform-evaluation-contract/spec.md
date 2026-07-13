# transform-evaluation-contract

## ADDED Requirements

### Requirement: Directive detection tolerates leading trivia
`'use client'` detection SHALL recognize the directive in the directive prologue position per ECMAScript semantics, including when preceded by comments or blank lines; injected imports SHALL always land below the directive.

#### Scenario: Comment precedes the directive
- **WHEN** a transformed file begins with a comment line followed by `'use client'`
- **THEN** the emitted file SHALL keep the directive above all import statements

### Requirement: Import emission derives from structured decisions
Runtime and virtual-module import decisions SHALL derive from the structured replacement metadata, not substring matching over generated text; user string content SHALL NOT trigger imports.

#### Scenario: User string contains an import-trigger token
- **WHEN** a component's style or config value contains the literal text `transforms.`
- **THEN** no transforms-registry import SHALL be added unless the replacement's structured config references a named transform

## MODIFIED Requirements

### Requirement: Prefix application covers all serialized artifacts
`applyPrefix` SHALL apply the namespace prefix to ALL serialized theme artifacts: `variableMapJson`, `variableCss`, `themeJson`, AND `contextualVarsJson`.

#### Scenario: Contextual variable CSS with prefix
- **WHEN** prefix is `"acme"` and the theme declares `declareContextualVars({ colors: ['bg'] })`
- **THEN** the emitted contextual variable CSS SHALL use `--acme-current-bg` (not `--current-bg`) and reference `var(--acme-color-bg)` (not `var(--color-bg)`)

#### Scenario: No prefix configured
- **WHEN** prefix is empty or undefined
- **THEN** `applyPrefix` SHALL return `contextualVarsJson` unchanged

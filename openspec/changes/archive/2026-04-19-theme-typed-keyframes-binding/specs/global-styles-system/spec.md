## MODIFIED Requirements

### Requirement: createGlobalStyles produces composable blocks
The `createGlobalStyles` factory SHALL accept a theme-typed selector-to-styles map where values use the same `ThemedCSSProps<Theme>` type as `.styles()`. Selector keys remain unconstrained strings (to admit complex CSS selectors). Selector-body values SHALL support theme-token references (`{colors.*}`, `{space.*}`, scale-token keys), prop shorthand resolved against the surrounding system's prop registry, and CSS literals. Each call produces an independent global style block. Runtime behavior is unchanged — this is a type-layer refinement.

#### Scenario: Single global style block
- **WHEN** a consumer calls `createGlobalStyles({ 'html, body': { bg: 'bg', color: 'text' } })`
- **THEN** it SHALL produce a global style block with resolved prop shorthand and token values

#### Scenario: Multiple independent blocks
- **WHEN** a consumer calls `createGlobalStyles` multiple times with different selector maps
- **THEN** each call SHALL produce an independent block
- **AND** blocks SHALL NOT share state or interfere with each other

#### Scenario: Keyframes in global styles
- **WHEN** a consumer includes `@keyframes` selectors in a global style block
- **THEN** the factory SHALL support nested keyframe structures (selector → percentages → props)
- **AND** keyframe values SHALL resolve prop shorthand and token aliases

#### Scenario: Invalid token reference produces a type error
- **WHEN** a consumer writes `createGlobalStyles({ body: { color: '{colors.nonexistent}' } })` with a theme that does not declare `colors.nonexistent`
- **THEN** TypeScript SHALL produce a type error at the call site

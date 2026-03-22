## ADDED Requirements

### Requirement: Vite build produces extracted output
The smoke test app SHALL build successfully via `vite build`, producing a `dist/` directory with HTML, JS bundle(s), and CSS file(s) containing extracted styles.

#### Scenario: Build succeeds
- **WHEN** `vite build` is run in the smoke test package
- **THEN** the build SHALL complete without errors and produce output in `dist/`

#### Scenario: CSS contains @layer structure
- **WHEN** the build output CSS is examined
- **THEN** it SHALL contain `@layer base, variants, states, system, custom;` and rules within each used layer

#### Scenario: JS uses createComponent
- **WHEN** the build output JS is examined
- **THEN** it SHALL contain `createComponent` calls (from the runtime shim) and SHALL NOT contain `animus.styles` builder chain expressions

### Requirement: Components render with correct classes
The smoke test app's components SHALL render with the extracted CSS class names that correspond to their extracted styles, variants, and states.

#### Scenario: Base styles applied
- **WHEN** a component with `.styles({ display: 'flex' })` renders
- **THEN** the element SHALL have a class like `animus-Box-{hash}` and the CSS SHALL contain `.animus-Box-{hash} { display: flex; }`

#### Scenario: Variant class applied
- **WHEN** `<Button variant="secondary">` renders
- **THEN** the element SHALL have both the base class and a variant modifier class `animus-Button-{hash}--variant-secondary`

#### Scenario: System prop utility class applied
- **WHEN** `<Box p={32}>` renders
- **THEN** the element SHALL have a utility class `animus-u-{hash}` and the CSS SHALL contain a matching rule with `padding: 2rem`

#### Scenario: Responsive utility class
- **WHEN** `<Box p={{ _: 16, sm: 32 }}>` renders
- **THEN** the CSS SHALL contain a utility class with base padding AND an `@media (min-width: 768px)` block with the sm padding value

### Requirement: App serves and renders visually
The smoke test app SHALL serve via `vite preview` and render visible, styled content in a browser.

#### Scenario: Preview serves the app
- **WHEN** `vite preview` is run after a successful build
- **THEN** the app SHALL be accessible at `http://localhost:4173` (or configured port)

#### Scenario: Styles are visible
- **WHEN** the app is viewed in a browser
- **THEN** components SHALL be visibly styled (colors, spacing, typography from the extracted CSS) — not unstyled raw HTML

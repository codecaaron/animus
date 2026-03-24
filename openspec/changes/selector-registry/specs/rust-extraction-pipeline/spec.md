## MODIFIED Requirements

### Requirement: CSS generation with @layer
The CSS generator SHALL produce CSS structured with shared `@layer` declarations. Base styles go in `@layer base`, variant styles in `@layer variants`, state styles in `@layer states`. Responsive values SHALL be emitted as `@media` queries within their respective layers. Pseudo-selectors SHALL be emitted as nested selectors within class rules. When a selector registry is provided, style object keys matching `&:name` where `name` is a registered selector key SHALL be expanded to `&${registeredValue}` before CSS emission.

#### Scenario: Generate base styles
- **WHEN** a chain has `.styles({ padding: '0.5rem', display: 'inline-flex' })`
- **THEN** the CSS output SHALL contain `@layer base { .animus-Name-hash { padding: 0.5rem; display: inline-flex; } }`

#### Scenario: Generate variant styles
- **WHEN** a chain has `.variant({ variants: { fill: { color: 'var(--colors-background)' }, stroke: { border: '1px solid' } } })`
- **THEN** the CSS output SHALL contain `@layer variants { .animus-Name-hash--variant-fill { color: var(--colors-background); } .animus-Name-hash--variant-stroke { border: 1px solid; } }`

#### Scenario: Generate state styles
- **WHEN** a chain has `.states({ loading: { opacity: 0 }, disabled: { cursor: 'not-allowed' } })`
- **THEN** the CSS output SHALL contain `@layer states { .animus-Name-hash--loading { opacity: 0; } .animus-Name-hash--disabled { cursor: not-allowed; } }`

#### Scenario: Generate responsive @media
- **WHEN** a chain has `.styles({ fontSize: { _: '1rem', sm: '1.125rem' } })` and breakpoints has `{ sm: 768 }`
- **THEN** the CSS output SHALL contain the default value outside any media query AND `@media (min-width: 768px) { .animus-Name-hash { font-size: 1.125rem; } }` within `@layer base`

#### Scenario: Generate pseudo-selector
- **WHEN** a chain has `.styles({ '&:hover': { color: 'var(--colors-primary)' } })`
- **THEN** the CSS output SHALL contain `.animus-Name-hash:hover { color: var(--colors-primary); }` within `@layer base`

#### Scenario: Generate variant with pseudo-selector
- **WHEN** a variant option contains `{ '&:before': { content: '""', position: 'absolute' } }`
- **THEN** the CSS output SHALL contain `.animus-Name-hash--variant-stroke::before { content: ""; position: absolute; }` within `@layer variants`

#### Scenario: @layer declaration order
- **WHEN** any extraction produces CSS
- **THEN** the CSS output SHALL begin with `@layer global, base, variants, states, system, custom;` to establish layer precedence

#### Scenario: Expand registered selector shorthand
- **WHEN** a selector registry contains `{ open: '[data-state="open"]' }` and a style object key is `'&:open'`
- **THEN** the CSS output SHALL emit `&[data-state="open"]` as the selector — the shorthand is expanded before CSS emission

#### Scenario: Unregistered pseudo-class passes through
- **WHEN** a style object key is `'&:hover'` and `hover` is NOT in the selector registry
- **THEN** the CSS output SHALL emit `&:hover` unchanged — standard CSS pseudo-class behavior

#### Scenario: Nested selector expansion
- **WHEN** a selector registry contains `open` and `disabled` and a style object has `'&:open': { '&:disabled': { opacity: '0.3' } }`
- **THEN** the CSS output SHALL expand both levels: the outer selector becomes `&[data-state="open"]` and the inner becomes `&[disabled]`

## ADDED Requirements

### Requirement: Selector registry in extraction config
The extraction functions SHALL accept an optional selector registry as part of their configuration. The registry SHALL be a JSON-serialized `Record<string, string>` passed alongside theme and prop config.

#### Scenario: analyze_project receives selector registry
- **WHEN** `analyze_project()` is called with a selector registry in its config
- **THEN** the CSS generator SHALL use the registry for selector shorthand expansion across all components in the project

#### Scenario: extract receives selector registry
- **WHEN** `extract()` is called with a selector registry in its config
- **THEN** per-file extraction SHALL expand selector shorthands using the provided registry

#### Scenario: No registry provided
- **WHEN** extraction functions are called without a selector registry (or with an empty registry)
- **THEN** no selector expansion SHALL occur — all `&:name` keys pass through as CSS pseudo-classes

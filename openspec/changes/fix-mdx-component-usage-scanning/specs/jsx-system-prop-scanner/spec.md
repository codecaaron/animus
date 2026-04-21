## ADDED Requirements

### Requirement: Scanner input set includes MDX-derived JSX regions
The JSX scanner's input SHALL include JSX regions extracted from `.mdx` source files. Bundler adapters (`vite-plugin`, `next-plugin`) are responsible for pre-processing MDX files into scanner-consumable JSX form BEFORE the scanner runs; the scanner's own JSX-recognition contract (JSX element tags, member-expression tags, `createElement(...)` CallExpressions per prior-arc Phase 1) applies unchanged to MDX-derived input.

Concretely: a ds-built component rendered via `<Component>` or `<Namespace.Member>` or `createElement(Component, ...)` inside an MDX file's JSX region SHALL be recorded in the usage ledger the same way as an identical render in a `.tsx` file. The reconciler SHALL NOT distinguish between MDX-sourced and TSX-sourced renderings when deciding elimination.

#### Scenario: Component used only from MDX is recognized as rendered
- **WHEN** a ds-built component is exported from a `.tsx` module and its only call sites are `<Component>` JSX tags inside `.mdx` files
- **THEN** the scanner's usage ledger SHALL list the component as rendered, and the reconciler SHALL NOT eliminate it in production builds (`dev_mode=false`)

#### Scenario: Dev-mode prospective entry SHALL NOT fire for MDX-rendered components
- **WHEN** a component is rendered only from `.mdx` and `dev_mode=true`
- **THEN** the manifest's `report.eliminated_details` SHALL NOT include a `kind: "prospective_component"` entry for that component — MDX renderings are first-class and should not trigger prospective-elimination warnings

#### Scenario: Component rendered via `createElement` from MDX is recognized
- **WHEN** a component is rendered via `createElement(Component, ...)` inside an MDX file's JSX region (e.g. in a code block or expression slot that compiles to a CallExpression)
- **THEN** the scanner SHALL record the rendering per the prior-arc Phase 1 createElement-recognition contract, producing the same usage ledger entry as an identical `.tsx` source

#### Scenario: Component rendered via both TSX and MDX resolves to a single ledger entry
- **WHEN** a component is rendered from both `.tsx` and `.mdx` sources
- **THEN** the scanner's usage ledger SHALL deduplicate the rendering records per the existing ledger's de-dup semantics — MDX and TSX sources combine, not accumulate separately

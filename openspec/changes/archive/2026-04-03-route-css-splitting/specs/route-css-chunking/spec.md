## ADDED Requirements

### Requirement: Global CSS chunk
When route splitting is enabled, the bundler plugin SHALL emit a global CSS chunk containing: the `@layer` declaration, theme variable CSS, global/reset CSS, and the complete `@layer system` block. This chunk SHALL be imported at the application root and load before any route CSS.

#### Scenario: Global chunk content
- **WHEN** `cssSplitting: true` is configured
- **THEN** the global CSS chunk SHALL contain the @layer declaration as its first content, followed by theme variables, global styles, and the full system utility layer

#### Scenario: Global chunk loads first
- **WHEN** a route is rendered (SSR or client-side)
- **THEN** the global CSS chunk SHALL be available before any route-specific CSS chunk

### Requirement: Per-route CSS chunks
When route splitting is enabled, the bundler plugin SHALL emit per-route CSS chunks containing only the component CSS (base, variants, compounds, states, custom) for components in that route's JS import subgraph.

#### Scenario: Route-specific component CSS
- **WHEN** route `/dashboard` imports components `Table`, `Chart`, and `Card`
- **THEN** the dashboard CSS chunk SHALL contain the base/variants/compounds/states/custom CSS for `Table`, `Chart`, and `Card` only

#### Scenario: Route chunks are order-independent
- **WHEN** route `/home` CSS chunk and route `/dashboard` CSS chunk both load
- **THEN** the cascade SHALL resolve correctly regardless of which chunk loads first, because all selectors are hash-scoped and cannot conflict

#### Scenario: Layer blocks span chunks
- **WHEN** the global chunk contains `@layer base { ... }` for hoisted components and a route chunk also contains `@layer base { ... }` for route-specific components
- **THEN** both `@layer base` blocks SHALL be valid CSS — the route chunk's rules append to the existing layer per CSS spec

### Requirement: Single-file mode is default
Route CSS splitting SHALL be opt-in via a `cssSplitting` option (default: `false`). When disabled, behavior SHALL be identical to the current single-file virtual module delivery.

#### Scenario: Default behavior unchanged
- **WHEN** no `cssSplitting` option is provided
- **THEN** the plugin SHALL emit a single CSS virtual module containing all styles, identical to current behavior

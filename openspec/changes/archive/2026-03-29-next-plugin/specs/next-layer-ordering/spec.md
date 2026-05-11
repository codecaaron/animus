## ADDED Requirements

### Requirement: Layer declaration is first CSS in output
The `@layer` declaration emitted by the Next plugin SHALL be the first CSS content in `.animus/styles.css`. No variable declarations, global styles, or component styles SHALL precede it.

#### Scenario: Default layer declaration
- **WHEN** no `layers` option is provided to `withAnimus()`
- **THEN** the first line of `.animus/styles.css` SHALL be `@layer global, base, variants, compounds, states, system, custom;`

#### Scenario: Custom layer declaration with consumer layers
- **WHEN** `withAnimus(nextConfig, { layers: ['reset', 'global', 'base', 'variants', 'compounds', 'states', 'system', 'custom', 'overrides'] })` is configured
- **THEN** the first line of `.animus/styles.css` SHALL be `@layer reset, global, base, variants, compounds, states, system, custom, overrides;`

#### Scenario: Layer validation rejects invalid ordering
- **WHEN** the `layers` option contains Animus layers in wrong relative order (e.g., `['base', 'global', ...]`)
- **THEN** the plugin SHALL throw a descriptive error at build start, same behavior as the Vite plugin's `validateLayerOrder()`

### Requirement: Consumer layer absorption
The `layers` option SHALL accept an array of layer names that includes all 7 Animus layers as a subsequence in their required order, with consumer layers interleaved. The plugin SHALL emit a single unified `@layer` declaration containing both Animus and consumer layers. This replaces any need for the consumer to write their own `@layer` declaration.

#### Scenario: Consumer with reset and overrides layers
- **WHEN** consumer configures `layers: ['reset', 'global', 'base', 'variants', 'compounds', 'states', 'system', 'custom', 'overrides']`
- **THEN** the plugin SHALL emit `@layer reset, global, base, variants, compounds, states, system, custom, overrides;` and the consumer does NOT need a separate `@layer` declaration

#### Scenario: Consumer with no custom layers
- **WHEN** consumer does not provide a `layers` option
- **THEN** the plugin SHALL emit the default 7-layer declaration

### Requirement: Strict CSS chunking default
`withAnimus()` SHALL set `experimental.cssChunking: 'strict'` in the returned Next.js config unless the consumer has explicitly set `experimental.cssChunking` to a different value.

#### Scenario: Default behavior
- **WHEN** consumer calls `withAnimus(nextConfig)` with no `experimental.cssChunking` set
- **THEN** the returned config SHALL include `experimental: { cssChunking: 'strict' }`

#### Scenario: Consumer override respected
- **WHEN** consumer calls `withAnimus({ experimental: { cssChunking: 'loose' } })`
- **THEN** the returned config SHALL preserve `experimental: { cssChunking: 'loose' }` — the plugin does not override explicit consumer choices

### Requirement: Import ordering documentation contract
The plugin SHALL document that `.animus/styles.css` must be the first CSS import in the consumer's root layout file (`layout.tsx` for App Router, `_app.tsx` for Pages Router). This ensures the Animus `@layer` declaration is the first `@layer` the browser encounters.

#### Scenario: Correct import ordering
- **WHEN** consumer imports `.animus/styles.css` as the first CSS import in `layout.tsx`
- **THEN** the Animus layer declaration takes precedence over any subsequent `@layer` declarations from other CSS files

#### Scenario: Incorrect import ordering warning
- **WHEN** the plugin detects (via webpack compilation hooks) that another CSS module is imported before `.animus/styles.css` in the root layout
- **THEN** the plugin SHALL print a warning: `[animus] ⚠ .animus/styles.css should be the first CSS import in your root layout to guarantee @layer ordering`

## ADDED Requirements

### Requirement: Package configuration
The test app SHALL be a private workspace package at `packages/next-test-app/` with `next`, `react`, `react-dom` as dependencies and `@animus-ui/system` and `@animus-ui/next-plugin` as dependencies.

#### Scenario: Package is private
- **WHEN** the package.json is inspected
- **THEN** it SHALL have `"private": true` and SHALL NOT be published to npm

#### Scenario: Workspace membership
- **WHEN** the root `package.json` workspaces array is inspected
- **THEN** it SHALL include `packages/next-test-app`

### Requirement: Dual-router directory structure
The app SHALL contain both `app/` (App Router) and `pages/` (Pages Router) directories, exercising both Next.js rendering models in a single build.

#### Scenario: App Router pages exist
- **WHEN** the `app/` directory is inspected
- **THEN** it SHALL contain `layout.tsx` (root layout), `page.tsx` (RSC page), and `client/page.tsx` (client component page)

#### Scenario: Pages Router pages exist
- **WHEN** the `pages/` directory is inspected
- **THEN** it SHALL contain `_app.tsx` (custom App) and at least one page file

#### Scenario: CSS imported in both routers
- **WHEN** `app/layout.tsx` and `pages/_app.tsx` are inspected
- **THEN** both SHALL import the extracted CSS stylesheet

### Requirement: Next.js config uses withAnimus
The `next.config.ts` (or `.js`) SHALL use `withAnimus()` from `@animus-ui/next-plugin` with the `system` option pointing to the design system module.

#### Scenario: Plugin configured
- **WHEN** `next.config.ts` is inspected
- **THEN** it SHALL call `withAnimus({ system: './src/ds.ts' })` wrapping the Next.js config

### Requirement: Design system module
The app SHALL have a `src/ds.ts` file exporting a `SystemInstance` and theme tokens built with `createSystem()` and `createTheme()` from `@animus-ui/system`.

#### Scenario: Theme with required scales
- **WHEN** the theme is built
- **THEN** it SHALL include at least `colors`, `space`, and `fontSizes` scales with enough entries to exercise variant and system prop resolution

#### Scenario: System with prop groups
- **WHEN** the system is built
- **THEN** it SHALL include at least `space` and `layout` prop groups via `addGroup()`

#### Scenario: Global styles
- **WHEN** the system is built
- **THEN** it SHALL include a CSS reset via `withGlobalStyles()` emitting into `@layer global`

## ADDED Requirements

### Requirement: Integration pattern compatibility audit
Each integration pattern SHALL be investigated and classified as works / fragile / broken with concrete evidence.

#### Scenario: Tailwind layer collision audit
- **WHEN** a project uses Tailwind's `@tailwind base` alongside Animus custom layers that include `base`
- **THEN** the audit SHALL determine whether Tailwind's `@layer base` and the consumer's `base` layer merge or conflict
- **AND** document whether the Animus `validateLayerOrder` function should warn about Tailwind layer name collisions

#### Scenario: Plugin ordering audit
- **WHEN** `reactRouter()` is registered before `animusExtract()` in the Vite plugin array
- **THEN** the audit SHALL verify that virtual module resolution, CSS import processing, and transform hooks execute correctly
- **AND** document any ordering requirements or recommendations

#### Scenario: CSS-in-JS coexistence audit
- **WHEN** Emotion/Chakra runtime CSS and Animus extracted CSS target the same element
- **THEN** the audit SHALL document cascade behavior (unlayered Emotion > layered Animus)
- **AND** identify any edge cases where this model breaks

#### Scenario: optimizeDeps interaction audit
- **WHEN** `@animus-ui/system` is in `optimizeDeps.include`
- **THEN** the audit SHALL verify that pre-bundling does not interfere with `loadSystemModule()` or `analyzeProject()`

#### Scenario: CSS minification interaction audit
- **WHEN** Vite's `build.cssMinify` is false (as in blockworks)
- **THEN** the audit SHALL determine whether this is required, recommended, or incidental
- **AND** document whether our Lightning CSS processing conflicts with Vite's default esbuild minification

#### Scenario: Monorepo workspace package audit
- **WHEN** a workspace package (e.g., `@blockworks/ui-kit`) contains Animus components not imported by the system file
- **THEN** the audit SHALL determine whether those components are discovered and extracted
- **AND** document the current discovery mechanism and any gaps

#### Scenario: CSS Modules coexistence audit
- **WHEN** `.module.css` files exist alongside Animus-extracted CSS
- **THEN** the audit SHALL verify that CSS Modules' scoped classes do not interfere with Animus `@layer` structure

#### Scenario: Library mode audit
- **WHEN** Vite is configured with `build.lib` to produce a component library
- **THEN** the audit SHALL determine whether extraction works and how CSS should be distributed

#### Scenario: SSR handling audit
- **WHEN** SSR is enabled (unlike blockworks' `ssr: false`)
- **THEN** the audit SHALL verify that `virtual:animus/styles.css` is handled correctly in server-side rendering

### Requirement: Compatibility matrix output
The audit SHALL produce a compatibility matrix documenting each pattern's status.

#### Scenario: Matrix format
- **WHEN** all 9 patterns have been investigated
- **THEN** the output SHALL be a table with columns: Pattern, Status (works/fragile/broken), Evidence, Action (document/harden/fix)
- **AND** any pattern marked "fix" SHALL reference a follow-up change proposal

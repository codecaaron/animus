## MODIFIED Requirements

### Requirement: Keyframes collection fixture exists in Next test app

The Next test app's system module (`e2e/next-app/src/ds.ts`) SHALL export a named `animations` binding that is the return value of `ds.createKeyframes({...})` — the builder-bound keyframes factory destructured from `createSystem({...}).build()`. The collection SHALL declare at least two distinct named keyframes with different frame bodies to exercise FNV-1a uniqueness and guard against accidental dedupe masking a regression. At least one frame body entry SHALL reference a theme token (e.g., `{colors.primary}`) so the `ThemedCSSProps<Theme>` typing contract is exercised end-to-end.

#### Scenario: `animations` export is produced by the bound factory

- **WHEN** `e2e/next-app/src/ds.ts` is inspected
- **THEN** it SHALL destructure `createKeyframes` from `createSystem({...}).build()` alongside `system`
- **AND** it SHALL export `animations = ds.createKeyframes({ <name1>: { ... }, <name2>: { ... } })` where `<name1>` and `<name2>` have different frame bodies
- **AND** the file SHALL NOT contain `import { keyframes } from '@animus-ui/system'`

#### Scenario: At least one frame body references a theme token

- **WHEN** the `animations` collection is inspected
- **THEN** at least one stop within at least one keyframe SHALL contain a value of the form `{scale.key}` referencing a scale defined on the fixture's theme
- **AND** the `@keyframes` block emitted by the build SHALL resolve that reference to the CSS variable produced by the theme emitter

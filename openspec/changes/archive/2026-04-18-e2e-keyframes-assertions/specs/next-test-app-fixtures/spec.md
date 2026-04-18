## ADDED Requirements

### Requirement: Keyframes collection fixture exists in Next test app

The Next test app's system module (`e2e/next-app/src/ds.ts`) SHALL export a named `animations` binding that is the return value of a `keyframes()` call from `@animus-ui/system`. The collection SHALL declare at least two distinct named keyframes with different frame bodies to exercise FNV-1a uniqueness and guard against accidental dedupe masking a regression.

#### Scenario: `animations` export is a Keyframes collection

- **WHEN** `e2e/next-app/src/ds.ts` is inspected
- **THEN** it SHALL `import { keyframes } from '@animus-ui/system'`
- **AND** it SHALL export `animations = keyframes({ <name1>: { ... }, <name2>: { ... } })` where `<name1>` and `<name2>` have different frame bodies

### Requirement: RSC page renders a keyframes-consuming component

The App Router index page (`e2e/next-app/app/page.tsx`) SHALL import and render at least one component whose `ds.styles()` declaration includes `animationName: animations.<key>` referencing the fixture's `animations` collection. The component SHALL remain renderable as a React Server Component (no `"use client"` required).

#### Scenario: Component consumes a branded keyframe ref

- **WHEN** `e2e/next-app/src/components/` is inspected
- **THEN** it SHALL contain at least one component file whose `ds.styles({...})` call includes `animationName: animations.<key>` as a literal member expression (no dynamic computed access)

#### Scenario: Component is rendered in the RSC page

- **WHEN** `e2e/next-app/app/page.tsx` is inspected
- **THEN** the keyframes-consuming component SHALL appear in the returned JSX tree
- **AND** the file SHALL NOT contain `"use client"`

#### Scenario: Component is exported from the components barrel

- **WHEN** `e2e/next-app/src/components/index.ts` is inspected
- **THEN** the keyframes-consuming component SHALL be re-exported

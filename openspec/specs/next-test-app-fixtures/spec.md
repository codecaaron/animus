## Purpose

The Next.js consumer fixture at `e2e/next-app/` SHALL include component and page fixtures that collectively exercise the extraction pipeline's behavioral taxonomy — base styles, variants, states, system props, compound variants, composition, and transforms — across both the App Router (RSC + client) and the Pages Router, proving the extraction pipeline works end-to-end in every Next.js rendering mode.
## Requirements
### Requirement: Component fixtures cover extraction behavioral taxonomy
The test app SHALL include component fixtures that collectively exercise base styles, variants, states, system props, compound variants, composition, and transforms.

#### Scenario: Base styles fixture
- **WHEN** a `Box` component is inspected
- **THEN** it SHALL use `.styles()` with static CSS properties and `.system()` for space + layout props, terminated with `.asElement('div')`

#### Scenario: Variant fixture
- **WHEN** a `Button` component is inspected
- **THEN** it SHALL use `.variant()` for at least two variant props (e.g., size, intent), `.states()` for hover and disabled, and terminate with `.asElement('button')`

#### Scenario: Compound variant fixture
- **WHEN** a `Badge` component is inspected
- **THEN** it SHALL use `.variant()` for at least two props and `.compound()` with a condition combining them

#### Scenario: Composition fixture
- **WHEN** a composed `Family` component is inspected
- **THEN** it SHALL use `compose()` with at least two slots (Root + Child) sharing a variant prop

#### Scenario: Transform fixture
- **WHEN** a `Card` component is inspected
- **THEN** it SHALL use a variant that triggers a named transform (e.g., `size` transform)

### Requirement: RSC page renders server-only components
The App Router index page (`app/page.tsx`) SHALL be a React Server Component (no `"use client"` directive) that renders extracted components.

#### Scenario: Server component renders
- **WHEN** `app/page.tsx` is inspected
- **THEN** it SHALL NOT contain `"use client"` and SHALL import and render at least Box, Button, and Card

### Requirement: Client page demonstrates interactivity
The App Router client page (`app/client/page.tsx`) SHALL use `"use client"` and demonstrate interactive variant switching with React state.

#### Scenario: Interactive variant toggling
- **WHEN** `app/client/page.tsx` is inspected
- **THEN** it SHALL use `useState` to toggle a variant prop (e.g., Button size) on user interaction

### Requirement: Pages Router page proves SSR extraction
The Pages Router page SHALL import and render shared components, proving extraction works in the traditional SSR model.

#### Scenario: Pages Router renders extracted components
- **WHEN** the Pages Router page is inspected
- **THEN** it SHALL import at least Box and Button (same components used by App Router) and render them

### Requirement: Cross-router shared component
At least one component SHALL be imported by both an App Router page and a Pages Router page.

#### Scenario: Shared import
- **WHEN** `Button` is traced through imports
- **THEN** it SHALL appear in both `app/page.tsx` (or its imports) and the Pages Router page

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


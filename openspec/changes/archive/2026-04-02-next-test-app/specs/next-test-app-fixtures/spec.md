## ADDED Requirements

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

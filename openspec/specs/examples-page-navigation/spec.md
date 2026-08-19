## Purpose

Requirements for the `examples-page-navigation` capability: Examples page has sticky section navigator; Active section tracking via IntersectionObserver; Section navigation via click; and 3 more.
## Requirements
### Requirement: Sections have stable ID anchors

Each demo section in Examples.tsx SHALL have a stable `id` attribute on its heading for scroll targeting and deep linking.

#### Scenario: Section IDs are kebab-case

- **WHEN** Examples page renders
- **THEN** each section heading SHALL have an `id` attribute derived from its text in kebab-case (e.g., "Slot Composition" → `id="slot-composition"`)

#### Scenario: Deep link scrolls to section

- **WHEN** user navigates to `/docs/examples#selector-aliases`
- **THEN** the page SHALL scroll to the Selector Aliases section on load


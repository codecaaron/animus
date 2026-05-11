## Headless Composition Specification

### Requirement: asChild composes with ark-ui primitives

Animus ds elements using `asChild` SHALL merge their resolved className onto ark-ui child elements, preserving both Animus extracted styles and ark-ui behavior (ARIA attributes, event handlers, data-state management).

#### Scenario: asChild merges classes onto Ark Tabs trigger

- **WHEN** an Animus ds element renders with `asChild` wrapping an `<Ark.Tabs.Trigger>`
- **THEN** the rendered DOM element has both the Animus extracted class and ark-ui's ARIA/data attributes

### Requirement: Selector aliases target ark-ui state attributes

Animus selector aliases (`_expanded`, `_checked`, `_disabled`, etc.) SHALL match ark-ui's data-attribute conventions, enabling Animus styles to react to headless state changes.

#### Scenario: \_expanded targets ark-ui expanded state

- **WHEN** an ark-ui accordion item is in expanded state (sets `data-expanded` or `aria-expanded="true"`)
- **THEN** Animus styles using `_expanded: { ... }` apply to the element

### Requirement: data-state variant key works via class reactivity

When a variant is defined with `prop: 'data-state'`, the runtime SHALL resolve the variant class from the prop value AND pass the `data-state` attribute through to the DOM. Both mechanisms update each React render cycle.

#### Scenario: data-state variant resolves correct class

- **WHEN** a component has `.variant({ prop: 'data-state', variants: { open: {...}, closed: {...} } })` and receives `data-state="open"` as a prop
- **THEN** the element receives both the class `Component--data-state-open` and the DOM attribute `data-state="open"`

### Requirement: Convenience wrappers hide headless internals

Components using ark-ui internally SHALL maintain their existing consumer-facing props API. ark-ui's concepts (parts, data-state values, internal context) MUST NOT leak through the wrapper.

#### Scenario: TabGroup API unchanged after ark-ui migration

- **WHEN** a consumer renders `<TabGroup tabs={['A','B']} activeTab="A" onChange={fn} />`
- **THEN** the component accepts and works with the same props as the hand-rolled version

### Requirement: Extraction unaffected by headless composition

The Rust extraction pipeline SHALL continue to produce correct CSS for ds elements that compose with headless primitives via asChild/asComponent. No extraction pipeline changes required.

#### Scenario: Extraction produces correct CSS for asChild component

- **WHEN** extraction processes a file containing `<StyledTab asChild><Ark.Tabs.Trigger>...</Ark.Tabs.Trigger></StyledTab>`
- **THEN** the extracted CSS for StyledTab is identical to what it would produce without asChild

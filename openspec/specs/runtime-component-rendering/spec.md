## Requirements

### Requirement: Dynamic style isolation per instance

The `createComponent` runtime SHALL compute dynamic style objects independently per render, with no shared mutable state between component instances. Multiple instances of the same component rendered with different dynamic system prop values SHALL each receive their own correct style object.

#### Scenario: Two instances with different dynamic props

- **WHEN** `<Button mt={4} />` and `<Button mt={8} />` render in the same tree
- **THEN** the first instance SHALL have `style` containing the CSS variable for `mt=4`
- **AND** the second instance SHALL have `style` containing the CSS variable for `mt=8`
- **AND** re-rendering either instance SHALL NOT affect the other's style

#### Scenario: RSC compatibility

- **WHEN** `createComponent` is used to create a component
- **THEN** the component SHALL use no React hooks (useRef, useState, useEffect, etc.)
- **AND** the component SHALL be renderable in React Server Components without a `'use client'` directive
- **AND** `.asClass()` (the headless class resolver path) SHALL remain RSC-compatible

#### Scenario: No cross-instance state leakage

- **WHEN** multiple instances of the same component type render in the same tree
- **THEN** no closure-scoped mutable state SHALL be shared between their render invocations
- **AND** each render SHALL compute its dynamic style from its own props via `resolveClasses()`

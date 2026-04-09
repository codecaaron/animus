## Icon Convention Specification

### Requirement: Icon imports use lucide-react named imports
Components SHALL import individual icons from `lucide-react` using named imports (e.g., `import { Check, Copy } from 'lucide-react'`).

#### Scenario: CopyButton uses lucide icons
- **WHEN** CopyButton renders in copied state
- **THEN** it displays the `Check` icon from lucide-react instead of an inline SVG

#### Scenario: CopyButton uses lucide icons in default state
- **WHEN** CopyButton renders in default state
- **THEN** it displays the `Copy` icon from lucide-react instead of an inline SVG

### Requirement: Icons inherit color from Animus parent
Icons SHALL use `currentColor` for their stroke/fill so that the Animus parent component controls color via token-resolved CSS.

#### Scenario: Icon color follows token
- **WHEN** a lucide icon renders inside an Animus ds element with `color: 'text.dim'`
- **THEN** the icon inherits the resolved CSS color from the parent element

### Requirement: Icons are implementation details
Icon imports SHALL remain internal to the component file that uses them. Components MUST NOT expose icon selection as a prop or re-export lucide icons.

#### Scenario: CopyButton public API unchanged
- **WHEN** a consumer renders `<CopyButton text="hello" />`
- **THEN** the component accepts the same props as before the lucide migration with no new required props

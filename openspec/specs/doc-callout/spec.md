## Purpose

Requirements for the `doc-callout` capability: Callout component; MDXProvider integration; Extraction compatibility; and 2 more.

## Requirements

### Requirement: Callout component

An admonition/callout component with 4 semantic variants. The component SHALL accept `variant` (`'info' | 'tip' | 'warn' | 'danger'`, default `'info'`), `title` (optional string), and `children` (ReactNode). Each variant SHALL have a distinct left border color, tinted background, and icon character.

#### Scenario: Variant rendering

- **WHEN** Callout renders with variant="tip" and title="Best Practice"
- **THEN** it displays with a green/teal left border, tinted background, arrow icon, "Best Practice" title, and children content

#### Scenario: Without title

- **WHEN** Callout renders with variant="warn" and no title prop
- **THEN** it displays with amber left border and icon, but no title text — children render directly after the icon

#### Scenario: All 4 variants are visually distinct

- **WHEN** info, tip, warn, and danger Callouts render
- **THEN** each has a distinct color scheme: info=blue, tip=teal/green, warn=amber, danger=red/accent

### Requirement: MDXProvider integration

Callout SHALL be available in .mdx files via explicit import. It SHALL also be registered in the MDXProvider componentMap as `Callout` (capital C) for convenience.

#### Scenario: Explicit import in MDX

- **WHEN** an .mdx file contains `import { Callout } from '../components'` and uses `<Callout variant="tip">content</Callout>`
- **THEN** the Callout renders correctly with the tip variant styling

#### Scenario: ComponentMap availability

- **WHEN** the MDXProvider componentMap includes Callout
- **THEN** .mdx files MAY use `<Callout>` without explicit import

### Requirement: Extraction compatibility

Callout SHALL be built with `ds.styles()` and `.variant()`. All variant styles SHALL extract to static CSS.

#### Scenario: Callout extracts

- **WHEN** the showcase builds
- **THEN** Callout produces extracted CSS with variant rules in `@layer variants`

### Requirement: Callout uses compose() for variant propagation

Callout SHALL use `compose()` to create a slot family (Root, Header, Icon, Title, Body) with `{ shared: { variant: true } }`. The variant (info/tip/warn/danger) SHALL be declared once on Root and flow to Icon and Title slots automatically via CSS.

#### Scenario: Variant flows to all slots

- **WHEN** a Callout is rendered with `variant="warn"`
- **THEN** the Root, Icon, and Title slots SHALL all receive the warn variant styles without manual prop passing

#### Scenario: MDX usage unchanged

- **WHEN** an MDX author writes `<Callout variant="tip" title="...">content</Callout>`
- **THEN** the component SHALL render identically to the pre-compose implementation
- **AND** no changes to the MDXProvider componentMap entry SHALL be required by content authors

### Requirement: Callout convenience wrapper preserved

The exported `Callout` function component SHALL maintain its existing props API (`variant`, `title`, `children`). Internal implementation changes to use the composed family. The wrapper is the public API; the compose family is internal.

#### Scenario: Backwards-compatible import

- **WHEN** existing code imports `{ Callout }` from the docs components
- **THEN** the import SHALL resolve to the convenience wrapper with the same type signature

## ADDED Requirements

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

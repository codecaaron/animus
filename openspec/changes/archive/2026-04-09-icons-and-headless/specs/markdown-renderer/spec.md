## MODIFIED Requirements

### Requirement: Heading renders anchor link with icon
Heading SHALL use a lucide-react icon (`Link`, `Check`) for the anchor copy button instead of inline SVGs. Hover reveal, click-to-copy, and copied feedback behavior remain unchanged.

#### Scenario: Heading anchor icon default state
- **WHEN** Heading renders with an id
- **THEN** the anchor button contains a lucide `Link` icon that appears on hover

#### Scenario: Heading anchor icon copied state
- **WHEN** user clicks the anchor button
- **THEN** the icon changes to lucide `Check` with copied state styling

### Requirement: SyntaxBlock renders collapse toggle with icon
SyntaxBlock SHALL use a lucide-react icon (`ChevronDown` or similar) for the collapse toggle instead of an inline SVG. Rotation via `.states({ collapsed })` remains unchanged.

#### Scenario: SyntaxBlock collapse toggle icon
- **WHEN** SyntaxBlock renders with collapsible content
- **THEN** the collapse toggle displays a lucide chevron icon that rotates via the `collapsed` state

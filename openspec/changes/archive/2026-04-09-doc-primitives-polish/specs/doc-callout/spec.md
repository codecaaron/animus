## MODIFIED Requirements

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

# rendered-usage-semantics

## ADDED Requirements

### Requirement: Usage-case fixture families with declared verdicts

The fixture corpus SHALL contain dedicated fixture families for MDX provider-scope rendering, aliased-import rendering, duplicate binding names across packages, bare createElement usage, and compose reassignment, each carrying an explicit expected parity verdict of identical or registered-divergence.

#### Scenario: Every family carries a verdict

- WHEN the parity harness enumerates the usage-case fixture families
- THEN each family declares its expected verdict, and the harness fails if any family is missing or verdict-less

### Requirement: MDX provider-scope rendering is preserved

Components rendered through MDX provider scope without an import statement SHALL be treated as rendered usage and SHALL NOT be eliminated, under either engine.

#### Scenario: Unimported MDX component keeps its CSS

- WHEN an MDX document renders a component provided via the MDX components provider with no import in the document
- THEN the component's CSS is present in the build output and the component is not reported as eliminated

### Requirement: Aliased imports attribute usage to the aliased component

Rendering a component through an import alias SHALL count as rendered usage of the original component.

#### Scenario: Alias render marks the origin

- WHEN a file imports a component under an alias and renders the alias in JSX
- THEN the original component is treated as rendered and its CSS is emitted

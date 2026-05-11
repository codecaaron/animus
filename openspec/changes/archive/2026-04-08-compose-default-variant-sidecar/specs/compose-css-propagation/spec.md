## MODIFIED Requirements

### Requirement: Two-rule composed variant emission
For each shared variant option on each child slot in a composed family, the extraction pipeline SHALL emit two CSS rules within `@layer variants`: an inheritance rule and an override rule.

#### Scenario: Inheritance rule structure
- **WHEN** a composed family has Root with variant `size` (options: `sm`, `md`) and Child is a slot with a `size` variant
- **THEN** the pipeline SHALL emit an inheritance rule: `.{root-class}.{root-class}--size-sm .{child-class} { ...child's size-sm declarations... }` for each option

#### Scenario: Override rule structure
- **WHEN** a composed family has Root with variant `size` and Child has a `size` variant
- **THEN** the pipeline SHALL emit an override rule: `.{root-class} .{child-class}.{child-class}--size-sm { ...child's size-sm declarations... }` for each option

#### Scenario: Equal specificity contract
- **WHEN** both the inheritance rule and override rule are emitted for the same variant option
- **THEN** both rules SHALL have identical CSS specificity (0, 3, 0) — three class selectors each

#### Scenario: Source order determines override
- **WHEN** both rules are emitted
- **THEN** the inheritance rule SHALL be emitted BEFORE the override rule in CSS source order, so that the override rule wins at equal specificity when both selectors match

#### Scenario: Override rule matches only explicit child props
- **WHEN** a child slot has `defaultVariant: 'comfortable'` and no explicit `density` prop is passed to the child
- **THEN** the child SHALL receive `--density-default` (not `--density-comfortable`), and the override rule `.Root .Child.Child--density-comfortable` SHALL NOT match — only the inheritance rule from the parent applies

#### Scenario: Override rule matches explicit child prop
- **WHEN** a child slot explicitly receives `density="comfortable"` as a prop
- **THEN** the child SHALL receive `--density-comfortable`, and the override rule `.Root .Child.Child--density-comfortable` SHALL match and win over inheritance by source order

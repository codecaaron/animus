## MODIFIED Requirements

### Requirement: Portal-mounted slot fallback (DEFERRED)
Portal-mounted child slots (e.g., Radix Dialog content, Tooltip content) render outside the Root DOM subtree. CSS descendant selectors do not reach portaled content. When `context: true` is specified on the compose call, shared variant prop values SHALL be propagated via React context, which crosses portal boundaries. Non-portaled slots in the same family also receive context but CSS cascade remains the primary styling mechanism for in-DOM children.

**Status**: Implemented via `context: true` option on compose().

#### Scenario: Portaled slot receives shared variant via context
- **WHEN** a composed family has `context: true` and a child slot renders via a portal (outside Root's DOM subtree)
- **THEN** the slot SHALL receive shared variant prop values via `useContext`, and its variant runtime SHALL resolve them to the correct CSS classes

#### Scenario: Non-portaled slots in context family use both mechanisms
- **WHEN** a composed family has `context: true` and a child slot renders within the Root's DOM subtree
- **THEN** the slot SHALL receive shared variant styling via BOTH CSS descendant selectors AND React context — CSS cascade is primary, context is redundant but harmless

#### Scenario: Context-free families remain CSS-only
- **WHEN** a composed family does NOT specify `context: true`
- **THEN** portal-mounted child slots SHALL NOT receive shared variant styling — CSS descendant selectors cannot reach them and no context fallback exists

### Requirement: Compose family extraction includes context flag
The extraction pipeline SHALL extract the `context` boolean from `compose()` call AST alongside shared keys. `ComposeFamilyInfo` SHALL include a `context: bool` field.

#### Scenario: Context flag extracted as true
- **WHEN** source contains `compose({ Root: R, Child: C }, { shared: { size: true }, context: true })`
- **THEN** the extractor SHALL produce a family record with `context: true`

#### Scenario: Context flag defaults to false
- **WHEN** source contains `compose({ Root: R, Child: C }, { shared: { size: true } })` without a `context` property
- **THEN** the extractor SHALL produce a family record with `context: false`

#### Scenario: Context flag does not affect CSS emission
- **WHEN** a compose family has `context: true`
- **THEN** the CSS generator SHALL emit the same two-rule composed variant CSS as a `context: false` family — CSS emission is unconditional

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

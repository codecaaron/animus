## ADDED Requirements

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

### Requirement: Composed rules reuse existing declarations
The extraction pipeline SHALL NOT re-resolve styles for composed variant rules. Composed rules SHALL reuse the already-resolved variant declarations from the per-component extraction pass.

#### Scenario: Declaration identity
- **WHEN** Child has variant `size: sm` that resolves to `{ font-size: 0.875rem; padding: 4px 8px; }`
- **THEN** both the inheritance rule and override rule for `size-sm` on that Child SHALL contain exactly those declarations

### Requirement: Root scope class as family namespace
The Root component's identity class SHALL appear in both composed rule selectors, providing family-scoped namespacing that prevents collision between multiple composed families on the same page.

#### Scenario: Two families with same shared key
- **WHEN** FamilyA (Root class `.animus-AccRoot-abc`) and FamilyB (Root class `.animus-TabRoot-def`) both share a `size` variant
- **THEN** FamilyA's composed rules SHALL use `.animus-AccRoot-abc` as the scope class and FamilyB's SHALL use `.animus-TabRoot-def` — no selector collision

### Requirement: Layer placement
Composed variant rules SHALL be emitted within `@layer variants`, the same layer as direct variant rules.

#### Scenario: Layer containment
- **WHEN** composed variant rules are emitted
- **THEN** they SHALL appear inside `@layer variants { }` alongside direct variant rules, not in a separate layer or sub-layer

### Requirement: Compose family extraction
The extraction pipeline SHALL extract full family structure from `compose()` call AST: root binding, slot-to-binding mapping, and shared variant keys.

#### Scenario: Family structure extraction
- **WHEN** source contains `compose({ Root: CardRoot, Header: CardHeader }, { shared: { size: true } })`
- **THEN** the extractor SHALL produce a family record with root binding `"CardRoot"`, slots `[("Root", "CardRoot"), ("Header", "CardHeader")]`, and shared keys `["size"]`

#### Scenario: Multiple compose calls in one file
- **WHEN** source contains two `compose()` calls
- **THEN** each SHALL produce its own family record with independent structure

### Requirement: Reconciler compose-family awareness
The reconciler SHALL NOT prune variant options on child slots that are used via composition, even if those options do not appear as direct JSX props on the child.

#### Scenario: Composed variant preserved
- **WHEN** Child has variant `size` with options `sm`, `md`, `lg` and Child appears only inside a composed family (never standalone with direct `size` prop)
- **THEN** the reconciler SHALL preserve all `size` variant options on Child (because Root may receive any option)

#### Scenario: Standalone-only variant still pruned normally
- **WHEN** Child has variant `color` that is NOT a shared key in any composed family, and `color="red"` never appears in JSX
- **THEN** the reconciler SHALL prune the `color: red` variant option as normal

### Requirement: Portal-mounted slot fallback
Portal-mounted child slots (e.g., Radix Dialog content, Tooltip content) render outside the Root DOM subtree. CSS descendant selectors do not reach portaled content. These slots SHALL fall back to a minimal React context that propagates a className string for shared variant classes.

#### Scenario: Portaled slot receives shared variant
- **WHEN** a composed family has a child slot that renders via a portal (outside Root's DOM subtree)
- **THEN** the slot SHALL receive shared variant styling via a context-provided className, not via CSS descendant selectors

#### Scenario: Non-portaled slots remain CSS-only
- **WHEN** a composed family has child slots that render within the Root's DOM subtree
- **THEN** those slots SHALL receive shared variant styling via CSS descendant selectors with no React context involvement

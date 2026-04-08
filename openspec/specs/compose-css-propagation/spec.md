## ADDED Requirements

### Requirement: Two-rule composed variant emission
For each shared variant option on each child slot in a composed family, the extraction pipeline SHALL emit two CSS rules within `@layer variants.composed`: an inheritance rule and an override rule.

#### Scenario: Inheritance rule structure
- **WHEN** a composed family has Root with variant `size` (options: `sm`, `md`) and Child is a slot with a `size` variant
- **THEN** the pipeline SHALL emit an inheritance rule: `.{root-class}--size-sm .{child-class} { ...child's size-sm declarations... }` for each option

#### Scenario: Override rule structure
- **WHEN** a composed family has Root with variant `size` and Child has a `size` variant
- **THEN** the pipeline SHALL emit an override rule: `.{root-class} .{child-class}.{child-class}--size-sm { ...child's size-sm declarations... }` for each option

#### Scenario: Specificity contract within composed sublayer
- **WHEN** both the inheritance rule and override rule are emitted for the same variant option
- **THEN** the inheritance rule SHALL have specificity (0,2,0) and the override rule SHALL have specificity (0,3,0) — a structural invariant of the selector shapes

#### Scenario: Override beats inheritance by specificity
- **WHEN** both inheritance and override rules match within `@layer variants.composed`
- **THEN** the override rule SHALL win by specificity regardless of source order

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

### Requirement: Composed rules include pseudo-selectors
Composed variant rules SHALL emit pseudo-selector declarations (`:hover`, `:focus`, etc.) alongside main declarations, using the same inheritance/override selector structure with the pseudo appended.

#### Scenario: Hover declarations in composed rules
- **WHEN** Child has variant `size: sm` with `:hover` declarations (e.g., `background-color: blue`)
- **THEN** the inheritance rule SHALL emit `.{root-class}.{root-class}--size-sm .{child-class}:hover { background-color: blue }` and the override rule SHALL emit `.{root-class} .{child-class}.{child-class}--size-sm:hover { background-color: blue }`

#### Scenario: Comma-separated pseudos
- **WHEN** a variant option has pseudo `:hover, :focus`
- **THEN** both composed rules SHALL expand to `.selector:hover, .selector:focus` for each rule

### Requirement: Layer placement
Composed variant rules SHALL be emitted within `@layer variants.composed` when sublayers are provisioned, or within `@layer variants` directly when no compose families exist.

#### Scenario: Sublayered placement
- **WHEN** composed variant rules are emitted and sublayers are provisioned
- **THEN** they SHALL appear inside `@layer variants { @layer composed { ... } }`, separate from standalone variant rules in `@layer variants { @layer standalone { ... } }`

#### Scenario: Flat placement without compose
- **WHEN** no compose families exist in the project
- **THEN** all variant rules SHALL appear inside `@layer variants { }` directly (unchanged behavior)

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

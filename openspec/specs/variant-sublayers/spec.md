## Purpose

Requirements for the `variant-sublayers` capability: Sublayer declaration within variants layer; Sublayer declaration within compounds layer; Standalone variant rules in standalone sublayer; and 4 more.

## Requirements

### Requirement: Sublayer declaration within variants layer

When compose families exist in the project, the CSS generator SHALL emit `@layer standalone, composed;` as the first content inside `@layer variants { }`, establishing sublayer ordering.

#### Scenario: Sublayer declaration emitted

- **WHEN** the project contains at least one compose family
- **THEN** the `@layer variants` block SHALL begin with `@layer standalone, composed;` before any rule blocks

#### Scenario: No sublayers without compose

- **WHEN** the project contains no compose families
- **THEN** the `@layer variants` block SHALL contain variant rules directly (no sublayer declarations or wrappers)

### Requirement: Sublayer declaration within compounds layer

When compose families exist in the project and compound variants reference shared props, the CSS generator SHALL emit `@layer standalone, composed;` inside `@layer compounds { }`.

#### Scenario: Compounds sublayer declaration emitted

- **WHEN** the project contains compose families AND at least one compound condition references a shared variant prop
- **THEN** the `@layer compounds` block SHALL begin with `@layer standalone, composed;` before any rule blocks

#### Scenario: No compounds sublayers without composed compounds

- **WHEN** no compound conditions reference shared variant props (even if compose families exist)
- **THEN** the `@layer compounds` block SHALL contain compound rules directly (no sublayer declarations)

### Requirement: Standalone variant rules in standalone sublayer

All per-component variant rules (including sidecar default rules) SHALL be emitted inside `@layer standalone { }` when sublayers are provisioned.

#### Scenario: Direct variant rule placement

- **WHEN** sublayers are provisioned and component Child has variant `size` with option `sm`
- **THEN** the rule `.animus-Child-{hash}--size-sm { ... }` SHALL appear inside `@layer variants { @layer standalone { ... } }`

#### Scenario: Sidecar default rule placement

- **WHEN** sublayers are provisioned and component Child has `defaultVariant: 'sm'` for variant `size`
- **THEN** the sidecar rule `.animus-Child-{hash}--size-default { ... }` SHALL appear inside `@layer variants { @layer standalone { ... } }`

#### Scenario: Chain definition order preserved

- **WHEN** a component defines `.variant('size', {...}).variant('intent', {...})`
- **THEN** within `@layer standalone`, all `size` variant rules SHALL appear before all `intent` variant rules

### Requirement: Composed variant rules in composed sublayer

All compose inheritance and override rules SHALL be emitted inside `@layer composed { }` when sublayers are provisioned.

#### Scenario: Inheritance rule placement

- **WHEN** sublayers are provisioned and Root composes Child with shared variant `size`
- **THEN** the inheritance rule `.animus-Root-{hash}--size-sm .animus-Child-{hash} { ... }` SHALL appear inside `@layer variants { @layer composed { ... } }`

#### Scenario: Override rule placement

- **WHEN** sublayers are provisioned and Root composes Child with shared variant `size`
- **THEN** the override rule `.animus-Root-{hash} .animus-Child-{hash}.animus-Child-{hash}--size-sm { ... }` SHALL appear inside `@layer variants { @layer composed { ... } }`

### Requirement: Standalone compound rules in standalone sublayer

Compound rules for non-composed usage SHALL be emitted inside `@layer compounds { @layer standalone { } }` when compounds sublayers are provisioned.

#### Scenario: Standalone compound placement

- **WHEN** compounds sublayers are provisioned and Child has compound `{ size: 'sm', intent: 'primary' }`
- **THEN** the standalone compound rule `.animus-Child-{hash}--size-sm.animus-Child-{hash}--intent-primary { ... }` SHALL appear inside `@layer compounds { @layer standalone { ... } }`

### Requirement: Composed compound rules in composed sublayer

Compound rules where at least one condition references a shared variant prop SHALL emit composed variants inside `@layer compounds { @layer composed { } }`, substituting the parent's inheritance selector for the shared prop dimension.

#### Scenario: Composed compound with one shared prop

- **WHEN** compounds sublayers are provisioned and Child has compound `{ size: 'sm', intent: 'primary' }` where `size` is a shared prop with Root
- **THEN** the composed compound rule SHALL be `.animus-Root-{hash}--size-sm .animus-Child-{hash}.animus-Child-{hash}--intent-primary { ... }` inside `@layer compounds { @layer composed { ... } }`

#### Scenario: Composed compound with multiple shared props

- **WHEN** Child has compound `{ size: 'sm', density: 'compact' }` where both `size` and `density` are shared with Root
- **THEN** the composed compound rule SHALL be `.animus-Root-{hash}--size-sm.animus-Root-{hash}--density-compact .animus-Child-{hash} { ... }` inside `@layer compounds { @layer composed { ... } }`

### Requirement: Cascade contract

The sublayer structure SHALL enforce this cascade ordering without relying on specificity arithmetic between categories:

- `variants.standalone` < `variants.composed` (layer ordering)
- `compounds.standalone` < `compounds.composed` (layer ordering)
- All `variants.*` < all `compounds.*` (top-level layer ordering, unchanged)

#### Scenario: Composed beats standalone regardless of specificity

- **WHEN** a `variants.standalone` rule has specificity (0,5,0) and a `variants.composed` rule has specificity (0,1,0) and both target the same element and property
- **THEN** the `variants.composed` rule SHALL win

#### Scenario: Inheritance vs override within composed

- **WHEN** both inheritance (0,2,0) and override (0,3,0) rules match within `variants.composed`
- **THEN** the override rule SHALL win by specificity (structural invariant of selector shapes)

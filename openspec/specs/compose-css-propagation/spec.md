## Purpose

Requirements for the `compose-css-propagation` capability: Two-rule composed variant emission; Default option propagation for shared variants; Shared-axis compound expansion; and 8 more.

## Requirements

### Requirement: Two-rule composed variant emission

For each shared variant option on each child slot in a composed family, the extraction pipeline SHALL emit two CSS rules within `@layer variants.composed`: an inheritance rule and an override rule.

#### Scenario: Inheritance rule structure

- **WHEN** a composed family has Root with variant `size` (options: `sm`, `md`) and Child is a slot with a `size` variant
- **THEN** the pipeline SHALL emit an inheritance rule: `.{root-class}--size-sm .{child-class} { ...child's size-sm declarations... }` for each option

#### Scenario: Override rule structure

- **WHEN** a composed family has Root with variant `size` and Child has a `size` variant
- **THEN** the pipeline SHALL emit an override rule: `.{root-class} .{child-class}.{child-class}--size-sm { ...child's size-sm declarations... }` for each option

#### Scenario: Specificity contract within composed sublayer

- **WHEN** both the inheritance rule and override rule are emitted for the same shared VARIANT option in `@layer variants.composed`
- **THEN** the inheritance rule SHALL have specificity (0,2,0) and the override rule SHALL have specificity (0,3,0) — a structural invariant of the two selector shapes this rule pair takes
- **AND** the invariant SHALL be scoped to that pair: shared-axis compound expansion emits into `@layer compounds`, where a selector's class count grows with the predicate's arity, and that growth SHALL NOT affect cross-layer precedence
- **AND** within `@layer compounds` the ordering consequence SHALL be understood: flat compound rules all tie at (0,1,0) and resolve by source order, while ancestor forms rank by class count (axes plus exclusions), so two overlapping compounds on one slot can resolve in a different order composed than they do standalone

#### Scenario: Override beats inheritance by specificity

- **WHEN** both inheritance and override rules match within `@layer variants.composed`
- **THEN** the override rule SHALL win by specificity regardless of source order

### Requirement: Default option propagation for shared variants

When a shared variant axis declares a default option on the Root, the pipeline SHALL additionally emit ONE inheritance rule keyed on the Root's `--{prop}-default` class — `.{root-class}--{prop}-default .{child-class} { ...child's default-option declarations... }` — so an omitted Root prop propagates the default option's styles to every descendant slot. No child-side `--{prop}-default` override rule SHALL be emitted: a defaulted child slot still yields to Root inheritance, preserving the existing suppression invariant. If a child slot does not define the Root's default option, no default rule is emitted for that slot — the option is skipped, never synthesized.

#### Scenario: Omitted Root prop propagates the default option

- **WHEN** a composed family has Root with variant `size` defaulting to `sm`, Child defines `size: sm`, and the callsite renders Root WITHOUT a `size` prop
- **THEN** the pipeline SHALL emit `.{root-class}--size-default .{child-class} { ...Child's size-sm declarations... }`, so Child renders the default option's styles

#### Scenario: No child-side default override

- **WHEN** the default inheritance rule above is emitted
- **THEN** no `.{child-class}--size-default` selector SHALL appear — the default axis emits exactly one rule, and a defaulted child cannot outrank Root inheritance

### Requirement: Shared-axis compound expansion

Under the CSS-only transport a shared axis reaches a child slot as a CSS selector, not as a prop — the slot's runtime resolves classes from its OWN props only — so a slot compound whose predicate (its `conditions` map) requires a shared axis cannot activate from its flat rule. For every child-slot compound whose predicate references at least one shared axis, the pipeline SHALL additionally emit an ancestor-form rule inside `@layer compounds`, reusing the compound's already-resolved declarations: the shared half of the predicate SHALL be expressed as Root classes on the ancestor side and the child-only half as the slot's own classes on the descendant side. Emission SHALL be unconditional — a `context: true` family also transports the prop, so the slot's flat rule may activate with the same declarations. Each axis SHALL contribute exactly one POSITIVE piece to its owner's side of the selector: the bare class when it accepts a single value, `:is(...)` over the alternatives when it accepts several (equal summed specificity, and linear in the number of accepted values). Every SHARED axis SHALL additionally contribute one `:not(.{child-class}--{axis}-{option})` per option the slot declares on that axis and the predicate does not accept, so a slot that sets the axis directly keeps its own flat compound. Axis order SHALL follow the predicate's stored (name-sorted) order, alternatives within an axis SHALL run value-order then the default-keyed class last, and exclusions SHALL follow the slot's declaration order after the positive pieces. Option names are interpolated verbatim into selectors, as everywhere else in the emitter — a malformed option name invalidates the rule that carries it. The flat `.{child-class}--compound-{N}` rules, their ordinals, their source order, and the runtime compound config lists SHALL be unchanged: the expansion reads compound data and never rewrites it.

#### Scenario: Fully shared predicate

- **WHEN** a family shares `size` and `tone` and a child slot declares `.compound({ size: 'sm', tone: 'loud' }, styles)`
- **THEN** the pipeline SHALL emit `.{root-class}--size-sm.{root-class}--tone-loud .{child-class} { ...styles... }` inside `@layer compounds`

#### Scenario: Mixed shared and child-only predicate

- **WHEN** a family shares `size` and a child slot with its own `weight` variant declares `.compound({ size: 'sm', weight: 'bold' }, styles)`
- **THEN** the pipeline SHALL emit `.{root-class}--size-sm .{child-class}.{child-class}--weight-bold { ...styles... }` — the shared axis on the ancestor, the slot's own axis chained on the slot, where its runtime writes that class
- **AND** when the slot declares a default for that child-only axis equal to the required value, that axis SHALL group both classes — `:is(.{child-class}--weight-bold,.{child-class}--weight-default)` — the mirror of the Root-default rule, since an omitted child prop makes the slot's own runtime write the `-default` class

#### Scenario: Accepted value list groups the axis

- **WHEN** a child slot declares `.compound({ size: ['sm', 'lg'] }, styles)` on a shared `size` axis
- **THEN** the emitted rule SHALL group that axis as `:is(.{root-class}--size-sm,.{root-class}--size-lg) .{child-class}` — one rule, one declaration block, no per-value selector list

#### Scenario: Root default activates a shared-axis compound

- **WHEN** the Root declares `size` defaulting to `sm`, a child slot declares `.compound({ size: 'sm' }, styles)`, and the callsite renders Root WITHOUT a `size` prop
- **THEN** the shared axis SHALL group as `:is(.{root-class}--size-sm,.{root-class}--size-default)`, matching the sidecar class the Root's runtime writes for an omitted prop
- **AND** no `.{child-class}--size-default` selector SHALL be emitted for the shared axis — the suppression invariant carried from the composed default rule keeps a defaulted slot losing to Root inheritance

#### Scenario: Explicit slot override suppresses the ancestor form

- **WHEN** a child slot declares its own variant on a shared axis and a callsite sets that prop directly on the slot
- **THEN** the ancestor form SHALL carry `:not(.{child-class}--{axis}-{option})` for every option the slot declares on that axis and the predicate does not accept, so a slot rendering a non-accepted option keeps its own flat compound instead of the Root's
- **AND** a slot that renders an ACCEPTED option, or that only defaults the axis, SHALL still receive the ancestor form — the accepted options and the `-default` class are never excluded

#### Scenario: Predicate free of shared axes is untouched

- **WHEN** a child slot's compound predicate references only the slot's own props
- **THEN** only the flat `.{child-class}--compound-{N}` rule SHALL be emitted — the slot's runtime already writes the classes that activate it

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
- **THEN** the slot SHALL receive shared variant styling via BOTH CSS descendant selectors AND React context — CSS cascade is primary and carries the whole shared surface for an in-DOM slot: shared variant options through the composed rule pair, and compounds whose predicates reference a shared axis through the ancestor forms in `@layer compounds`. Both activate from the Root's own classes under either transport, so context adds no styling the cascade does not already deliver

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

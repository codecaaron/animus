## ADDED Requirements

### Requirement: extend() provides flexible method ordering
The AnimusExtended class hierarchy SHALL mirror the primary Animus chain but allow methods to be called in ANY order. Each method SHALL merge its configuration with existing configuration using `merge({}, existing, new)` (immutable merge), enabling additive modification of any cascade layer.

#### Scenario: Styles can be added after states
- **WHEN** `Button.extend().states({ loading: {...} }).styles({ cursor: 'wait' })` is called
- **THEN** the chain SHALL compile successfully and the extended component SHALL have both the new state and the new base styles merged with the parent's configuration

#### Scenario: Merge is immutable
- **WHEN** `.variant({...})` is called on an AnimusExtended instance
- **THEN** a NEW object SHALL be created via `merge({}, this.variants, { [prop]: options })`, preserving the parent instance's state

### Requirement: Extension preserves parent configuration
When `.extend()` is called on a terminal component, the returned AnimusExtended instance SHALL be seeded with ALL 8 configuration fields from the parent: propRegistry, groupRegistry, parser, baseStyles, variants, statesConfig, activeGroups, and custom.

#### Scenario: Extended component inherits parent styles
- **WHEN** `const Primary = Button.extend().styles({ bg: 'blue' }).asElement('button')` is created from a Button with `.styles({ padding: 10 })`
- **THEN** Primary SHALL have BOTH `padding: 10` (from parent) AND `bg: 'blue'` (from extension) in its base styles, merged together

#### Scenario: Extended component inherits parent variants
- **WHEN** Button has `.variant({ prop: 'size', variants: { sm: {...}, lg: {...} } })` and Primary extends without adding variants
- **THEN** Primary SHALL accept the `size` prop with the same `sm` and `lg` options as the parent

### Requirement: Extension cascade ordering for CSS output
When styles are extracted to CSS, extended component rules SHALL be emitted AFTER their parent's rules within the same @layer. This guarantees that extension rules override parent rules through CSS source order (same specificity, later wins) without requiring specificity escalation.

#### Scenario: Extension base styles override parent base styles
- **WHEN** Button has `.styles({ padding: 10 })` and PrimaryButton extends with `.styles({ padding: 16 })`
- **AND** both are extracted to `@layer base`
- **THEN** PrimaryButton's `padding: 16` rule SHALL appear AFTER Button's `padding: 10` rule within `@layer base`, causing the extension to win via source order

#### Scenario: Deep extension chains maintain topological order
- **WHEN** A extends nothing, B extends A, C extends B
- **AND** all are extracted to `@layer base`
- **THEN** the rule order within `@layer base` SHALL be: A's rules, then B's rules, then C's rules

### Requirement: Extension supports multi-level chains
The `.extend()` method SHALL be available on both primary chain terminals and extended chain terminals, enabling arbitrary depth of extension.

#### Scenario: Chained extensions
- **WHEN** `const C = B.extend().styles({...}).asElement('div')` where B was itself created via `A.extend().styles({...}).asElement('div')`
- **THEN** C SHALL carry the merged configuration of A + B + C, with C's rules winning on conflicts via merge semantics and cascade ordering

### Requirement: Extension chains are extractable
Extension chains (e.g., `Button.extend().styles({...}).asElement('div')`) SHALL be extractable by the static analysis pipeline when all stages are statically evaluable. The `.extend()` call itself is NOT a bail condition — it is recognized as the chain root pattern for extension.

#### Scenario: Simple extension extracts
- **WHEN** `Button.extend().styles({ borderRadius: 8 }).asElement('button')` is analyzed and Button's definition is found in the project
- **THEN** the extension chain SHALL be extracted, producing merged CSS (Button's styles + borderRadius override) with a unique class name

#### Scenario: Extension with non-static stage bails
- **WHEN** `Button.extend().styles({ color: dynamicVar }).asElement('button')` is analyzed
- **THEN** the chain SHALL bail with a static evaluation error, same as primary chains

#### Scenario: Extension with unresolvable parent bails
- **WHEN** `UnknownComponent.extend().styles({...}).asElement('div')` is analyzed and `UnknownComponent` cannot be traced to any animus chain definition in the project
- **THEN** the chain SHALL bail with reason "could not resolve parent component"

### Requirement: Extension with .asComponent() is extractable
Extension chains terminating with `.asComponent(SomeComponent)` SHALL be extractable. The CSS comes from the merged chain (parent + extension overrides). The component reference (`SomeComponent`) is preserved as a runtime import in the transformed source.

#### Scenario: asComponent extension extracts CSS
- **WHEN** `Anchor.extend().states({ active: {} }).asComponent(NextLink)` is analyzed
- **THEN** the CSS SHALL contain the merged styles (Anchor's base + variant + state CSS, plus the state override) in the correct @layer blocks with the extension's own class name

#### Scenario: asComponent reference preserved in transform
- **WHEN** the above extension is transformed
- **THEN** the transformed source SHALL contain `createComponent(NextLink, 'animus-Link-hash', config)` where `NextLink` remains a runtime import reference, NOT a string literal

#### Scenario: asComponent on primary chain still bails
- **WHEN** `animus.styles({...}).asComponent(Link)` is analyzed (PRIMARY chain, not extension)
- **THEN** the chain SHALL still bail — `.asComponent()` on primary chains requires the full Emotion runtime for component wrapping. Only extension chains with a resolvable parent support `.asComponent()` extraction.

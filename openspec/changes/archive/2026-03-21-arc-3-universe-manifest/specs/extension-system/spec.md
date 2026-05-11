## ADDED Requirements

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

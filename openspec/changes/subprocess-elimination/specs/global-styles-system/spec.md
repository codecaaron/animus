## MODIFIED Requirements

### Requirement: Global style resolution
Global style blocks SHALL be resolved using the same prop config, theme scales, and token alias logic as component styles. For transform values, the resolver SHALL emit `__TRANSFORM__` placeholders (matching the component style behavior) instead of applying transforms directly. All `__TRANSFORM__` placeholders — from both global styles and component styles — SHALL be resolved in a single post-processing pass by the transform bin resolver.

#### Scenario: Global style prop shorthand resolved in Rust
- **WHEN** a global style block contains `{ body: { m: 0 } }`
- **THEN** Rust resolves `m` to `margin` via prop config and emits `margin: 0`

#### Scenario: Global style scale lookup resolved in Rust
- **WHEN** a global style block contains `{ body: { color: '{colors.primary}' } }`
- **THEN** Rust resolves the token alias to `color: var(--color-primary)`

#### Scenario: Global style transform emits placeholder
- **WHEN** a global style block contains `{ body: { p: 4 } }` and `p` has transform `size`
- **THEN** Rust emits `padding: __TRANSFORM__size__4__` which the bin file resolves to `padding: 1rem`

#### Scenario: Global style @keyframes resolved in Rust
- **WHEN** a global style block contains `{ '@keyframes pulse': { '0%, 100%': { transform: 'scale(1)' }, '50%': { transform: 'scale(1.02)' } } }`
- **THEN** Rust emits the keyframes block with CSS property values resolved

### Requirement: Global CSS emission in @layer anm-global
Global style blocks SHALL be emitted within `@layer anm-global { }`. The layer declaration SHALL use the `anm-` prefixed layer names. Block order SHALL match export order from the system module.

#### Scenario: Multiple global style blocks in layer
- **WHEN** the system module exports `globalStyles` and `globalReset` as GlobalStyleBlocks
- **THEN** both are emitted within `@layer anm-global { }` in export order

## REMOVED Requirements

### Requirement: Global styles resolution via standalone subprocess
**Reason**: Global styles are now resolved in Rust during `analyzeProject`, using the same theme_resolver pipeline as component styles. Transform values emit `__TRANSFORM__` placeholders resolved by the bin file post-processor.
**Migration**: No user action required. The `resolve-global-styles.ts` script is no longer invoked. The Vite plugin passes raw global style block JSON to `analyzeProject` instead of resolving them in a subprocess.

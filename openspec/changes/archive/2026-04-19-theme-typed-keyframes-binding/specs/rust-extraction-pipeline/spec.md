## ADDED Requirements

### Requirement: Keyframe-collection discovery preserved for builder-bound factory

The Rust extraction pipeline's existing named-export scan for `__brand === 'Keyframes'` SHALL continue to locate keyframe collections whose authoring site is the builder-bound `ds.createKeyframes({...})` factory. The returned branded shape is unchanged from the former standalone factory, so no discovery-path plumbing changes are required. The invariant: any module that exports a `createKeyframes`-returned collection as a named export (`export const animations = ds.createKeyframes({...})`) is discoverable by the existing scan.

Consumer contract: the `createKeyframes` return value MUST be assigned to a module-scope named export for the extractor to find it. Collections held in module-scope `const` bindings without export, or in non-top-level scope, remain outside the extractor's discovery path (same constraint as the standalone factory had).

#### Scenario: Bound-factory collection is discovered via named-export scan

- **WHEN** a module contains `export const animations = ds.createKeyframes({ pulse: {...} })`
- **AND** a sibling component's `ds.styles()` declaration includes `animationName: animations.pulse`
- **THEN** the extractor SHALL resolve the `animations.pulse` reference to the FNV-hashed name `animus-kf-<hash>`
- **AND** the consuming component's emitted CSS SHALL contain `animation-name: animus-kf-<hash>` with no unresolved placeholder

#### Scenario: FNV hash stability across the former standalone and the bound factory

- **WHEN** the same frame body content is authored via `ds.createKeyframes({...})` in one module
- **AND** the same frame body content were historically authored via the standalone `keyframes({...})` in another module
- **THEN** the extractor SHALL produce identical FNV-hashed names for both
- **AND** the emitted `@keyframes` block SHALL be byte-identical (dedupe holds across the surface change)

#### Scenario: No cross-package keyframe propagation through `includes()`

- **WHEN** a consuming system is built with `createSystem({ includes: [libDsSystem] })`
- **AND** `libDs` declares its own keyframe collection as a named export
- **THEN** cross-package keyframe references SHALL continue to resolve via regular TypeScript named imports (`import { animations } from 'libDs'`)
- **AND** `includes()` SHALL NOT extend to carry keyframe collections across system boundaries — propagation is handled by the existing import/named-export mechanism, not by builder semantics

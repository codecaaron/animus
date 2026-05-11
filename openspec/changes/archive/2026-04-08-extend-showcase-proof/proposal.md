## Why

`.extend()` is documented in 5 showcase markdown content files (builder-chain.md, composition.md, base-styling.md, variants-states.md, troubleshooting.md) but is never used in an actual showcase component. Every other builder chain feature has a live proof — variants, states, compound variants, system props, custom props, compose, selector aliases — except extension. This makes `.extend()` the only documented-but-undemonstrated feature in the showcase.

## What Changes

- **New showcase component**: At least one component uses `.extend()` to create a variant of an existing base component. Natural candidate: a `ButtonLink` extending the existing `Button` via `Button.extend().asElement('a')`, or a specialized `Card` variant.
- **Examples page section**: New "Extension Chains" section showing the base → extended component relationship with both rendering side-by-side.

## Capabilities

### New Capabilities
- `extend-showcase-demonstration`: Live showcase component using `.extend()` with side-by-side rendering of base and extended components on the Examples page.

### Modified Capabilities

(none)

## Impact

- **Files**: `packages/showcase/src/components/docs/Button.tsx` or a new extension component file, `packages/showcase/src/pages/Examples.tsx` (new section)
- **No API changes**: `.extend()` already exists and works. This is pure showcase/documentation.
- **Extraction verification**: Confirms that the Rust pipeline correctly handles extension chains in production — provenance tracking, @layer source ordering, variant inheritance.

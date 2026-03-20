## Why

The Animus core builder (Animus, AnimusExtended, AnimusConfig) is the proven, working heart of the project — but it has no canonical specification. As we move toward static CSS extraction with CSS @layer integration, we need authoritative specs that define the builder's behavioral contracts, cascade ordering guarantees, and extension semantics. Without these, the extraction layer has no formal contract to compile against.

## What Changes

- Create canonical specifications for the three core builder subsystems
- Document the type-state machine contract (method ordering, progressive type accumulation)
- Define the cascade ordering guarantees that extraction depends on
- Specify the extension mechanism and its ordering semantics
- Specify the prop system configuration architecture (groups, scales, transforms)
- No code changes — this is documentation of existing, working behavior

## Capabilities

### New Capabilities
- `builder-chain`: The type-state machine builder API — method ordering, class hierarchy, terminal methods (.asElement/.asComponent/.build), and the backwards inheritance pattern that enforces progressive revelation
- `extension-system`: The AnimusExtended escape hatch — flexible method ordering with merge semantics, how extensions thread into the cascade, and the ordering guarantee (extensions emit after parents)
- `prop-system`: The prop configuration architecture — AnimusConfig, groups, scales, transforms, the parser pipeline (createParser → createPropertyStyle → lookupScaleValue), and responsive value handling

### Modified Capabilities

## Impact

- `packages/core/src/Animus.ts` — specified, not modified
- `packages/core/src/AnimusExtended.ts` — specified, not modified
- `packages/core/src/AnimusConfig.ts` — specified, not modified
- `packages/core/src/config.ts` — prop group definitions specified
- `packages/core/src/styles/` — parser/stylist pipeline specified
- These specs become the formal contract for the upcoming static extraction work

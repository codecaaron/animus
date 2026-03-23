## Context

The Animus core builder has been the stable, working foundation of the project since its inception. The builder chain (Animus.ts), extension system (AnimusExtended.ts), and prop configuration (AnimusConfig.ts + config.ts) are proven in production via the docs site. However, no formal specification exists — the behavior is defined only by the implementation and inline CLAUDE.md documentation.

With static CSS extraction via CSS @layer on the roadmap, the extraction compiler needs a formal contract to compile against. These specs serve as that contract. They also serve as the canonical reference for any future AI-assisted work on the codebase.

Current state:
- `packages/core/src/Animus.ts` — 347 lines, 6 classes, backwards inheritance chain
- `packages/core/src/AnimusExtended.ts` — 417 lines, 6 classes, flexible ordering mirror
- `packages/core/src/AnimusConfig.ts` — entry point with `addGroup()` and `build()`
- `packages/core/src/config.ts` — 13 prop groups (394 lines), the default `animus` instance
- `packages/core/src/styles/` — createStylist, createParser, createPropertyStyle, responsive
- All of the above is working and stable. No code changes are proposed.

## Goals / Non-Goals

**Goals:**
- Create canonical, testable specifications for the three core subsystems
- Define cascade ordering guarantees that the extraction layer can depend on
- Specify extension ordering semantics (BEM-style source order within shared @layers)
- Establish the prop resolution pipeline as a formal contract (scale lookup → transform → output)
- Provide spec-level scenarios that map to existing and potential test cases

**Non-Goals:**
- Changing any existing behavior
- Specifying the extraction system (that's a separate change)
- Specifying the theming system (separate capability, separate spec)
- Specifying the UI components package (separate capability)
- Performance optimization of the builder

## Decisions

### Decision 1: Three capability specs, not one monolithic spec
The builder is decomposed into three capabilities: `builder-chain` (the type-state machine), `extension-system` (AnimusExtended), and `prop-system` (config + parser pipeline). This maps to the actual separation of concerns in the codebase and allows independent evolution.

**Alternative considered:** Single `core-builder` spec covering everything. Rejected because it would be too large and mix concerns that evolve at different rates.

### Decision 2: Specs describe observable behavior, not implementation
The specs define WHAT the system does (cascade ordering, type narrowing, prop resolution) not HOW it does it (backwards inheritance, lodash merge). This allows the implementation to change (e.g., replacing lodash.merge with a custom merge, or replacing the class hierarchy with a different pattern) without invalidating the spec.

**Alternative considered:** Specifying internal implementation details. Rejected because it would over-constrain the extraction work, which may need to reimplement the builder for compile-time execution.

### Decision 3: Extension ordering specified as source-order within shared @layers
The extension spec defines that extended component rules appear AFTER parent rules within the SAME CSS @layer. This matches the shared-layer architecture where all components inject into the same set of layers (base, variants, states, system, custom) rather than per-component layer namespaces.

**Alternative considered:** Per-component nested layers (`@layer btn.base`, `@layer primary-btn.base`). Rejected because it creates N*5 layers for N components, adds unnecessary complexity, and doesn't match how Tailwind v4 and Panda CSS successfully use shared layers.

## Risks / Trade-offs

- [Risk] Specs may not cover edge cases discovered during extraction work → Mitigation: specs are living documents; update them as edge cases surface
- [Risk] Specifying observable behavior without implementation detail may leave ambiguity → Mitigation: scenarios are concrete and testable; ambiguity surfaces as failing test cases
- [Risk] The shared-layer ordering guarantee depends on deterministic topological sort of extension dependencies → Mitigation: this is a well-solved algorithmic problem; the dependency graph is available from the builder chain structure

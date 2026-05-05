## ADDED Requirements

### Requirement: Binding to orchestration-architecture

The library bundler contract — Rolldown as the bundling engine, ES-module output, TypeScript and JSX compilation without Babel, externalization of `node_modules`, declaration emission — defined in this spec SHALL be realized through the orchestrator binding designated by the `orchestration-architecture` capability. The current binding invokes `tsdown` (which uses Rolldown internally) per package via `bun run --filter './packages/*' build:ts`.

A future rebind to direct `vp pack` invocation (per the `migrate-build-to-vp-pack` follow-on policy change) SHALL preserve the bundler-engine identity (Rolldown), the output format (ES module), the externalization contract, and the declaration-emission requirement. The rebind MAY replace `tsdown.config.ts` files with `rolldown.config.ts` (or the orchestrator's equivalent config surface) provided the output is functionally equivalent.

This spec's existing requirement text references legacy package paths (`packages/core`, `packages/theming`, `packages/ui`) that no longer exist in the active build graph (they live under `legacy/` per the `legacy-directory-topology` capability). The reference refresh — updating the requirement text to enumerate the current package set (`packages/extract`, `packages/system`, `packages/properties`, `packages/vite-plugin`, `packages/next-plugin`, `packages/_assertions`) — SHALL be performed in the `migrate-build-to-vp-pack` follow-on policy change as part of the rebind. This capability change does NOT modify the existing requirements' text.

#### Scenario: Rolldown engine identity survives bundler rebind

- **WHEN** a cutover follow-on rebinds the library-build invocation (e.g., `tsdown` → `vp pack`)
- **THEN** the underlying bundling engine continues to be Rolldown
- **AND** ES-module output continues to be the only emitted format
- **AND** all `node_modules` continue to be externalized from the bundle
- **AND** TypeScript declaration files continue to be emitted

#### Scenario: Stale package references refreshed by rebind follow-on

- **WHEN** the `migrate-build-to-vp-pack` follow-on policy change is proposed
- **THEN** it modifies the existing "Core package build" scenario (and similar legacy-package scenarios) to reference current packages
- **AND** this capability change does NOT pre-emptively modify those scenarios

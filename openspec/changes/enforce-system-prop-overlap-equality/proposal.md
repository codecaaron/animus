## Why

`SystemBuilder` currently accepts some conflicting overlapping prop
definitions and silently replaces the earlier registry entry. This violates
the builder's overlap-tolerance contract and can change emitted CSS for groups
that already captured the prop name. A focused equality seam and runtime
regression contract are needed before further work lands in this high-risk
boundary.

## What Changes

- Centralize complete prop-definition equality for `addGroup()` and `addProps()`.
- Reject conflicts in every current `Prop` field while preserving valid overlaps and identity-sensitive scale/transform behavior.
- Add focused runtime coverage for the builder overlap contract.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `system-builder`: Define complete runtime equality and rejection semantics for overlapping prop registrations.

## Impact

- Affected code: `packages/system/src/SystemBuilder.ts`.
- Affected tests: new focused runtime coverage under `packages/system/__tests__/`.
- Public API and dependencies: unchanged.
- Verification: system compile, type contracts, and TypeScript units.

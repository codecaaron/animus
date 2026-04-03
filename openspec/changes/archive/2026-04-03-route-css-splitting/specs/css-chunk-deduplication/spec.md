## ADDED Requirements

### Requirement: Shared component hoisting
Components whose CSS appears in more than a configurable threshold number of route chunks SHALL be hoisted to the global CSS chunk. The threshold SHALL default to 2 and be configurable via `cssSplitting.hoistThreshold`.

#### Scenario: Button used on 3 routes
- **WHEN** `Button` component is imported by routes `/home`, `/about`, and `/dashboard`, and the hoisting threshold is 2
- **THEN** `Button`'s component CSS SHALL appear in the global chunk, not in any route chunk

#### Scenario: Table used on 1 route
- **WHEN** `Table` component is imported only by route `/dashboard`, and the hoisting threshold is 2
- **THEN** `Table`'s component CSS SHALL appear in the `/dashboard` route chunk only

#### Scenario: Custom threshold
- **WHEN** `cssSplitting: { hoistThreshold: 5 }` is configured
- **THEN** only components used on 5 or more routes SHALL be hoisted to the global chunk

### Requirement: No duplicate component CSS across chunks
A component's CSS SHALL appear in exactly one chunk — either the global chunk (if hoisted) or a single route chunk (if route-specific). No duplication.

#### Scenario: Component in exactly one place
- **WHEN** route splitting is enabled and component `Card` is used on routes `/home` and `/about`
- **THEN** `Card`'s CSS SHALL appear in either the global chunk (if above threshold) or a shared route chunk, but never duplicated in both `/home` and `/about` chunks

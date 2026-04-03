## MODIFIED Requirements

### Requirement: Verification commands use derived build ordering
All verification commands SHALL use the `--filter`-based build scripts internally. The verification command surface (`verify`, `verify:full`, `verify:showcase`) SHALL remain unchanged.

#### Scenario: verify command
- **WHEN** `bun run verify` is executed
- **THEN** it SHALL run `build:ts` (via --filter), compile, test, test:rust, test:types, and check — same outputs as before

#### Scenario: verify:full command
- **WHEN** `bun run verify:full` is executed
- **THEN** it SHALL run `build:all` (Rust + --filter TS), test, check, and showcase build — same outputs as before

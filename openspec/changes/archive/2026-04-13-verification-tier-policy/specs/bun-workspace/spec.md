## MODIFIED Requirements

### Requirement: Simplified root scripts
The root `package.json` SHALL contain scripts organized by verb:scope naming convention. The script set SHALL cover: build (granular + all), test, type-check, lint, format, clean, and verification via the tier policy. Script commands SHALL use `bun` (not yarn, npx, or nx). Verification is handled by the `verification-tier-policy` capability (atomic tiers + composite orchestrators named `verify:<tier>[:<scope>]`); the root script set MUST include both the atomic tiers and the composite orchestrators defined there.

#### Scenario: Root script inventory
- **WHEN** examining root `package.json` scripts
- **THEN** each script uses `bun run`, `bun test`, `tsc`, or `biome` — no references to yarn, npx, nx, lerna, or jest
- **AND** build scripts include: `build`, `build:extract`, `build:ts`, `build:all`, `build:showcase`
- **AND** the raw test script `test` exists (delegates to `bun test` with no path args)
- **AND** utility scripts include: `clean`, `clean:light`, `clean:full`, `rebuild`, `compile`, `lint`, `format`, `check`, `check:fix`
- **AND** verification atomic-tier scripts include: `verify:lint`, `verify:compile`, `verify:types`, `verify:unit:rust`, `verify:unit:ts`, `verify:canary`, `verify:integration`, `verify:build:next`, `verify:build:showcase`, `verify:assert:next`, `verify:assert:showcase`
- **AND** verification composite scripts include: `verify`, `verify:full`, `verify:ci`, `verify:next`, `verify:showcase`
- **AND** orphaned pre-policy scripts `test:canary`, `test:next`, `test:showcase`, `test:types`, `test:rust` do NOT exist (removed in atomic cutover per `verification-tier-policy`)

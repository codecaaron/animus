## MODIFIED Requirements

### Requirement: Simplified root scripts
The root `package.json` SHALL contain scripts organized by verb:scope naming convention. The script set SHALL cover: build (granular + all), test (granular + all), type-check, lint, format, clean, and verify. Script commands SHALL use `bun` (not yarn, npx, or nx).

#### Scenario: Root script inventory
- **WHEN** examining root `package.json` scripts
- **THEN** each script uses `bun run`, `bun test`, `tsc`, or `biome` — no references to yarn, npx, nx, lerna, or jest
- **THEN** build scripts include: `build`, `build:extract`, `build:ts`, `build:all`
- **THEN** test scripts include: `test`, `test:canary`, `test:showcase`
- **THEN** utility scripts include: `clean`, `verify`, `compile`, `check`, `check:fix`

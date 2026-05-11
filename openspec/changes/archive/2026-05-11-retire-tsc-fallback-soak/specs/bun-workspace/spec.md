## MODIFIED Requirements

### Requirement: Simplified root scripts

The root `package.json` `scripts` block SHALL be split between MIGRATED tasks (defined in `vite.config.ts` `run.tasks`, ABSENT from `package.json` `scripts`) and UNMIGRATED tasks (PRESENT in `package.json` `scripts`, NOT migrated to vp).

Migrated tasks: every `verify:*` (atomic tiers + composite orchestrators), `build:*` (build:all, build:extract, build:ts, build:showcase, rebuild), and `hygiene`. After migration, NONE of these names appear in `package.json` `scripts`; their canonical invocation is `vp run <task>`.

Unmigrated tasks: `clean`, `clean:light`, `clean:full` (destructive shells, must always execute); `dev:showcase` (long-running watch); `test` (bun test, future migration); `lint`, `format`, `check`, `check:fix` (biome wrappers, separate future migration); `release` (one-shot release.sh); `deploy:showcase` (one-shot deploy). These keep their `package.json` entries and `bun run X` invocation surface.

#### Scenario: Root script inventory

- **WHEN** examining root `package.json` `scripts`
- **THEN** tier-related migrated names (`verify:*`, `build:*`, `hygiene`, composite orchestrators) DO NOT appear in `scripts`
- **AND** unmigrated entries (`clean*`, `dev:showcase`, `test`, `lint`, `format`, `check`, `check:fix`, `release`, `deploy:showcase`) DO appear with their existing command bodies
- **AND** `bun.lockb`-related operations and `--filter` ad-hoc dispatch remain bun-native
- **AND** no references to yarn, npx, nx, lerna, or jest exist in any script

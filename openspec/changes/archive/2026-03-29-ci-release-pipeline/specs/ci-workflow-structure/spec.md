## ADDED Requirements

### Requirement: Four-job CI topology
The CI workflow SHALL have exactly four jobs: `lint`, `build-extract`, `verify`, and `release`. No job SHALL duplicate work performed by another job.

#### Scenario: Lint runs independently
- **WHEN** a push or PR triggers CI
- **THEN** the `lint` job SHALL run `bun run check` (biome) with no other steps, in parallel with `build-extract`

#### Scenario: Verify depends on build-extract
- **WHEN** `build-extract` completes successfully
- **THEN** `verify` SHALL download the linux binary artifact and run the full pipeline: build TS, compile, test, showcase build

#### Scenario: Release depends on verify
- **WHEN** `verify` completes successfully AND the trigger is a tag push (`v*`) or manual dispatch
- **THEN** the `release` job SHALL run

#### Scenario: Release skipped on regular push
- **WHEN** the trigger is a regular push or PR (not a tag)
- **THEN** the `release` job SHALL NOT run

### Requirement: NAPI binary build via bunx
The `build-extract` job SHALL use `bunx @napi-rs/cli build` instead of bare `napi` to ensure the CLI is found in CI environments.

#### Scenario: NAPI CLI resolved via bunx
- **WHEN** the `build-extract` job runs on any platform
- **THEN** it SHALL execute `bunx @napi-rs/cli build --platform --release --target ${{ matrix.target }}`

### Requirement: Workflow triggers
The CI workflow SHALL trigger on push to `main` and `next` branches, pull requests to those branches, tag pushes matching `v*`, and manual dispatch.

#### Scenario: Tag push triggers release
- **WHEN** a tag matching `v*` is pushed
- **THEN** all four jobs SHALL run, including `release`

#### Scenario: Manual dispatch triggers release
- **WHEN** `workflow_dispatch` is triggered
- **THEN** all four jobs SHALL run, including `release`

#### Scenario: Branch push skips release
- **WHEN** a commit is pushed to `main` or `next`
- **THEN** `lint`, `build-extract`, and `verify` SHALL run, but `release` SHALL NOT

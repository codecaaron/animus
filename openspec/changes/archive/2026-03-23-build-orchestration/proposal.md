## Why

Every session rediscovers the build order manually — which packages need rebuilding after a Rust change, whether the `.node` binary is stale, what order TS packages must compile in. This burns context tokens and developer time on mechanical steps instead of design work. The root `package.json` only builds core/theming/ui, omitting the extraction pipeline (Rust crate, vite-plugin, runtime) entirely. There is no clean command, no single verification command, and no way to go from "I changed something" to "everything is green" without tribal knowledge.

## What Changes

- Add build scripts for the full dependency DAG: extract (Rust) → core → theming → runtime → vite-plugin → ui
- Add `build:all` that executes the complete DAG in correct order
- Add `build:extract` for rebuilding just the Rust crate (the most common "stale artifact" problem)
- Add `clean` to wipe all build artifacts (dist/, target/, .node binaries)
- Replace the existing `verify` script with a comprehensive pipeline: build → test → typecheck → lint
- Add `test:canary` for running just the extraction snapshot test
- Add `test:showcase` for building the showcase app as an integration smoke test
- **BREAKING**: `verify` changes from `compile && check` to the full build+test+typecheck+lint pipeline
- Ensure vite-plugin and runtime have correct tsdown configs (currently missing)

## Capabilities

### New Capabilities
- `build-orchestration`: Encodes the full monorepo build DAG in root package.json scripts, including Rust NAPI builds, TS package ordering, and verification pipeline

### Modified Capabilities
- `bun-workspace`: The "no more than 6 scripts" constraint needs relaxing — the extraction pipeline introduces legitimate build stages that don't exist in a pure-TS monorepo. Script count expands to ~10-12 covering: build, build:extract, build:ts, build:all, test, test:canary, test:showcase, clean, compile, verify, check, check:fix

## Impact

- **Root package.json**: Scripts section rewritten
- **packages/vite-plugin/**: Needs tsdown.config.ts added
- **packages/runtime/**: Needs tsdown.config.ts added (if missing)
- **Developer workflow**: `bun run verify` becomes the single command for full validation
- **AI sessions**: Eliminates the build-order rediscovery loop that burns context

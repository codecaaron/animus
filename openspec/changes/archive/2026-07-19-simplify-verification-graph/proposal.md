## Why

Animus has necessary verification breadth but models package scope, production
phase, prerequisite state, and local/CI environment as a 57-task root command
cross-product. The same graph is repeated in documentation, shell wrappers,
CI, and policy, creating high contributor overhead while still allowing the
copies to drift. Package-owned claims and Vite+'s workspace graph can preserve
the evidence while making ordinary verification smaller and more honest.

## What Changes

- Give each supported consumer one package-owned, complete `verify` claim.
- Derive owner prerequisite closure from workspace manifests; do not maintain a
  parallel package-dependency list.
- Aggregate owner claims through fail-closed Vite+ workspace targets and filters.
- Keep atomic evidence primitives directly runnable as diagnostics.
- Make `verify` the fast root gate and `verify:full` the sole complete local/current-host proof.
- Retire the misleading local `verify:ci` projection.
- Rewire CI consumer jobs to owner claims without changing release evidence.
- Remove obsolete target-phase aliases and one-command wrapper scripts after executable reachability proof.
- Retain only compatibility aliases still named by another active change.
- Replace command-combination routing with claim-oriented contributor guidance.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `verification-tier-policy`: replace root target-phase composites and local CI simulation with package-owned claims, workspace selection, and an honest public command contract.
- `typescript-toolchain`: update composite-orchestrator requirements after retiring `verify:ci` while retaining declaration-parity isolation.
- `build-verification`: replace focused root consumer commands with owner claims while retaining fast/full boundaries and artifact order.
- `next-test-app-assertions`: move Next build/assert ownership to the fixture package.
- `vite-test-app`: move Vite build/assert/dry-run ownership to the fixture package.
- `showcase-output-assertions`: address showcase assertions through the showcase owner claim.
- `structural-css-assertions`: replace per-target shell precondition wrappers with shared owner helpers.
- `vite-extraction-plugin`: update the showcase production-build proof command.
- `dual-engine-build`: update receipt-producing consumer lane names without changing engine evidence.
- `code-hygiene`: replace the obsolete `verify:build:*` nudge with claim-oriented recovery.
- `release-workflow`: preserve CI gate topology while invoking owner commands and protecting exact release-bundle wiring.
- `bun-workspace`: distinguish repository-owned Vite+ tasks from package-owned consumer scripts and remove the obsolete root `build:showcase` requirement.

## Impact

Affected surfaces include package and fixture manifests, root Vite Task
orchestration, consumer verification wrappers and structural tests, AGENTS.md,
CLAUDE.md, GitHub Actions consumer commands, and the verification policy
specifications. Runtime packages, generated CSS, public APIs, release artifact
contents, and deployment identities are unchanged.

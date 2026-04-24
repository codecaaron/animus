## ADDED Requirements

### Requirement: Diff-Scoped File Selection
The hygiene cleanup script SHALL derive its working file set from `git diff --name-only <base>...HEAD`, filtered to files with extensions `.ts`, `.tsx`, `.js`, `.mjs`, or `.cjs`. Files outside this extension set SHALL pass through untouched. The base ref SHALL default to `main` and SHALL be overridable via a `--base <ref>` CLI flag or a `HYGIENE_BASE_REF` environment variable.

#### Scenario: Default base ref
- **WHEN** the script is invoked without `--base` or `HYGIENE_BASE_REF`
- **THEN** the working file set SHALL be `git diff --name-only main...HEAD` filtered to the allowed extensions

#### Scenario: Base ref overridden via flag
- **WHEN** the script is invoked with `--base origin/develop`
- **THEN** the working file set SHALL be `git diff --name-only origin/develop...HEAD` filtered to the allowed extensions

#### Scenario: Non-TS/JS file excluded from scope
- **WHEN** the diff includes a `.mdx` or `.rs` file
- **THEN** the file SHALL NOT appear in the working file set and SHALL NOT be touched by any layer

### Requirement: Three-Layer Cleanup Cascade
The script SHALL run three layers in order per iteration: (1) intra-file unused-declaration stripping, (2) cross-file unused-export and unused-dependency auto-fix, (3) empty-file detection and deletion. The script SHALL iterate the three-layer sequence until a full pass produces zero changes across all three layers. Layer order within an iteration SHALL NOT be rearranged.

#### Scenario: Cascade converges in one pass
- **WHEN** the first iteration of Layer 1 + Layer 2 + Layer 3 produces zero changes
- **THEN** the script SHALL exit the cascade loop and proceed to final reporting

#### Scenario: Cascade converges in multiple passes
- **WHEN** iteration N produces changes and iteration N+1 produces zero changes
- **THEN** the script SHALL exit the cascade loop after iteration N+1

### Requirement: Cascade Iteration Cap
The script SHALL cap the cascade loop at five iterations (`MAX_ITERATIONS=5`). Reaching the cap without producing a zero-change iteration SHALL be treated as a loud failure: the script SHALL exit with a nonzero exit code and report per-iteration change counts and current diff state.

#### Scenario: Cascade exceeds iteration cap
- **WHEN** iteration 5 produces nonzero changes
- **THEN** the script SHALL exit nonzero, print per-iteration change counts, and identify the files still being modified

### Requirement: Dry-Run Default
The script SHALL default to dry-run mode. In dry-run mode the script SHALL print the planned file modifications and deletions without writing to disk. An explicit `--apply` flag SHALL be required to perform mutations.

#### Scenario: Invocation without --apply
- **WHEN** the script is invoked without `--apply`
- **THEN** no file on disk SHALL be modified or deleted, and the script SHALL print a human-readable preview of planned changes

#### Scenario: Invocation with --apply
- **WHEN** the script is invoked with `--apply`
- **THEN** the cascade SHALL mutate the working file set in place

### Requirement: Safety Envelope on Apply
On successful cascade convergence in `--apply` mode, the script SHALL run `bun run verify:compile` followed by `bun run verify:lint`. Failure of either tier SHALL result in the script exiting with a nonzero exit code and reporting which tier failed. The script SHALL NOT auto-revert changes on safety-envelope failure.

#### Scenario: Safety envelope passes
- **WHEN** cascade converges under `--apply` AND `verify:compile` exits 0 AND `verify:lint` exits 0
- **THEN** the script SHALL exit 0 and print a summary of total changes

#### Scenario: Safety envelope fails on compile
- **WHEN** cascade converges under `--apply` AND `verify:compile` exits nonzero
- **THEN** the script SHALL exit nonzero, report the compile failure, and NOT restore any files

#### Scenario: Safety envelope fails on lint
- **WHEN** cascade converges under `--apply` AND `verify:compile` passes AND `verify:lint` exits nonzero
- **THEN** the script SHALL exit nonzero, report the lint failure, and NOT restore any files

### Requirement: Tool Precondition Assertions
The script SHALL assert the presence of required binaries (biome via the existing project toolchain, and fallow) before running any layer. Missing binaries SHALL produce an `ERROR: X missing. Run: <install-command>` message on stderr and exit nonzero.

#### Scenario: Fallow binary missing
- **WHEN** the `fallow` binary is not on `PATH`
- **THEN** the script SHALL print `ERROR: fallow missing. Run: bun install -g fallow` and exit nonzero

#### Scenario: Biome toolchain missing
- **WHEN** biome cannot be invoked via the project's bun toolchain
- **THEN** the script SHALL print `ERROR: biome missing. Run: bun install` and exit nonzero

### Requirement: Layer 1 — Intra-File Dec-Stripping
Layer 1 SHALL remove unused imports, local variables, function parameters, and private class members from each file in the diff-scoped working set. The initial implementation SHALL use `biome check --write` on the working set. Substitution with `webpro-nl/remove-unused-vars` (or another primitive) is permitted if empirical evidence shows that `biome check --write` fails to remove a category of unused declaration that matters in Animus.

#### Scenario: Layer 1 removes unused imports
- **WHEN** a diff-scoped file contains `import { unused, used } from 'x'` and only `used` is referenced
- **THEN** Layer 1 SHALL rewrite the import to `import { used } from 'x'` (or leave untouched if biome configuration excludes the rule)

#### Scenario: Layer 1 preserves side-effect imports
- **WHEN** a diff-scoped file contains `import './polyfill'` with no bound name
- **THEN** Layer 1 SHALL NOT remove the import

### Requirement: Layer 2 — Cross-File Export and Dependency Auto-Fix
Layer 2 SHALL invoke fallow's auto-fix flow (`fallow fix --yes` in apply mode, `fallow fix --dry-run` in dry-run mode) scoped to the diff file set, removing unused exports and unused/unlisted dependency declarations exposed by Layer 1 or by prior iterations. Exit code 1 (issues found but fixed) SHALL be treated as success for this layer; exit code 2 SHALL be treated as a runtime failure that fails the layer.

#### Scenario: Layer 2 removes unused export in dry-run
- **WHEN** Layer 2 runs in dry-run mode and fallow reports an unused export
- **THEN** Layer 2 SHALL print the planned removal without mutating the file

#### Scenario: Layer 2 applies auto-fix
- **WHEN** Layer 2 runs in apply mode and fallow's auto-fix rewrites a file
- **THEN** the file SHALL be mutated by fallow and the layer SHALL report a nonzero change count for the iteration

#### Scenario: Fallow runtime error
- **WHEN** `fallow fix` exits with code 2
- **THEN** Layer 2 SHALL propagate the failure, exit the cascade, and produce an actionable error message

### Requirement: Layer 3 — Empty-File Deletion
Layer 3 SHALL identify diff-scoped files whose AST-level content after Layers 1-2 consists entirely of whitespace, comments, or re-exports referencing symbols that no longer exist anywhere else in the codebase. Such files SHALL be deleted in apply mode and SHALL be reported as planned-deletion in dry-run mode. Files containing any top-level declaration, any side-effect import, any `declare module` / ambient block, or any re-export with a live target SHALL NOT be deleted.

#### Scenario: File emptied to only whitespace and comments
- **WHEN** after Layers 1-2 a diff-scoped file contains only whitespace and comments
- **THEN** Layer 3 SHALL mark it for deletion; deletion SHALL occur only in apply mode

#### Scenario: File contains a side-effect import
- **WHEN** a diff-scoped file contains `import './setup';` and nothing else
- **THEN** Layer 3 SHALL NOT mark the file for deletion

#### Scenario: File contains a declare block
- **WHEN** a diff-scoped file contains a `declare module 'x'` block and nothing else
- **THEN** Layer 3 SHALL NOT mark the file for deletion

### Requirement: Read-Only Tier Independence
The `verify:*` tier family SHALL remain strictly read-only. The hygiene cleanup script SHALL NOT be composed into `verify`, `verify:full`, `verify:ci`, or any other `verify:*` orchestrator. Cleanup SHALL be invoked only via its dedicated `hygiene:*` npm scripts or by direct script invocation.

#### Scenario: Cleanup not composed into verify
- **WHEN** a developer reads `package.json`
- **THEN** no `verify:*` script SHALL reference the cleanup script directly or transitively

### Requirement: Dev Script Registration
The root `package.json` SHALL expose two scripts: `hygiene:preview` (invokes the cleanup script in default dry-run mode) and `hygiene:apply` (invokes the script with `--apply`). Neither script SHALL appear in any `verify:*` orchestrator or CI-facing aggregator.

#### Scenario: Preview script available
- **WHEN** a developer runs `bun run hygiene:preview`
- **THEN** the cleanup script SHALL execute in dry-run mode and exit 0 if no issues are found

#### Scenario: Apply script available
- **WHEN** a developer runs `bun run hygiene:apply`
- **THEN** the cleanup script SHALL execute with `--apply`, perform the cascade, and run the safety envelope

### Requirement: Iteration and Change Reporting
Each cascade iteration SHALL print a header identifying the iteration number and per-layer change counts (`Layer 1: N files modified`, `Layer 2: M files modified`, `Layer 3: K files deleted`). On cascade completion (whether by convergence, iteration cap, or runtime failure), a final summary line SHALL report total iterations, total per-layer cumulative changes, and the final disposition (converged / cap-hit / failed).

#### Scenario: Convergence report
- **WHEN** the cascade converges in 3 iterations
- **THEN** the final summary SHALL state `converged after 3 iterations` with cumulative per-layer change counts

#### Scenario: Iteration-cap report
- **WHEN** the cascade reaches `MAX_ITERATIONS` without convergence
- **THEN** the final summary SHALL state `iteration cap hit after 5 iterations` and the script SHALL exit nonzero

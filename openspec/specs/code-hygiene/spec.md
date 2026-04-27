# code-hygiene Specification

## Purpose
TBD - created by archiving change add-code-hygiene-protocol. Update Purpose after archive.
## Requirements
### Requirement: Single flag-driven hygiene entrypoint

The repository SHALL provide a single code-hygiene entrypoint invokable as `bun run hygiene` (or equivalently `bash scripts/hygiene/run.sh`) that accepts `--mode`, `--scope`, `--base`, and `--iterations` flags. The entrypoint SHALL be usable identically by humans and by agents through the Bash tool — no agent-specific wrapper SHALL be required.

#### Scenario: Default invocation reports changed-scope without mutating

- **WHEN** a user or agent runs `bun run hygiene` with no flags on a clean worktree
- **THEN** the system SHALL run the cascade in scan mode against files changed vs `main`, print a `git diff --stat` + `git diff --name-status` style report, restore the worktree, and exit without retaining any mutation

#### Scenario: Apply flag enables mutation

- **WHEN** a user or agent runs `bun run hygiene --apply`
- **THEN** the system SHALL run the cascade in fix mode against the changed-scope file set, retain mutations, and run the safety envelope

#### Scenario: All flag widens scope to full repo

- **WHEN** a user or agent runs `bun run hygiene --all`
- **THEN** the system SHALL run the cascade against the full repository, not restricted by `git diff`

### Requirement: Cascade is DELETE-only for dead declarations

The cascade SHALL remove dead declarations through DELETION, not rename. This applies to unused imports, unused top-level `const` / `function` / `let` / `class` / `type alias` / `interface` / `enum` declarations, unused destructured binding elements, unused private class members, unused cross-file exports, unused files, and unused `package.json` dependencies.

#### Scenario: Unused top-level const is deleted

- **WHEN** a source file contains `const unusedConst = 1;` that is not referenced anywhere in the file and not exported
- **AND** the cascade runs in fix mode against that file
- **THEN** the resulting file SHALL NOT contain the `unusedConst` declaration (the statement is removed, not renamed to `_unusedConst`)

#### Scenario: Unused named import is deleted

- **WHEN** a source file contains `import { usedFn, unusedFn } from 'foo';` where `unusedFn` is not referenced
- **AND** the cascade runs in fix mode
- **THEN** the resulting file SHALL contain `import { usedFn } from 'foo';` with `unusedFn` removed

#### Scenario: Unused private class member is deleted

- **WHEN** a class contains `private unusedMethod() { return 1; }` that is not referenced
- **AND** the cascade runs in fix mode
- **THEN** the method body SHALL be removed from the class

### Requirement: Side-effect imports are preserved

The cascade SHALL NOT remove side-effect imports (`import 'module-name';` without bindings). Biome does not flag side-effect imports as unused by design, and the home-roll deleter SHALL NOT augment biome's detection to include them.

#### Scenario: Side-effect import survives cascade

- **WHEN** a source file contains `import 'some-side-effect-module';` at the top
- **AND** the cascade runs in fix mode
- **THEN** the resulting file SHALL still contain that import statement

### Requirement: Positional function parameters preserve arity via rename, not delete

The cascade SHALL NOT DELETE positional function parameters. Biome's `noUnusedFunctionParameters` unsafe auto-fix renames unused positional parameters to `_`-prefixed names, which correctly preserves function arity contracts. The cascade SHALL leave this rule's reporting as a biome warning (not auto-applied) for human review; it SHALL NOT auto-rename positional parameters as part of the cascade.

#### Scenario: Positional param is not deleted

- **WHEN** a function `function f(a: number, unusedB: string) { return a; }` is present
- **AND** the cascade runs in fix mode
- **THEN** the function signature SHALL still contain two parameters (arity = 2) after the cascade

### Requirement: Destructured binding elements are deleted when unused

The cascade SHALL delete unused binding elements from destructuring patterns (object and array) because these are intra-file dead artifacts without an arity contract. Biome detects these but offers no fix; the home-roll deleter closes this gap.

#### Scenario: Unused destructured field is deleted

- **WHEN** a source file contains `const { a, b } = obj;` where `a` is not referenced and `b` is used
- **AND** the cascade runs in fix mode
- **THEN** the resulting file SHALL contain `const { b } = obj;`

### Requirement: Cascade iterates to convergence or iteration cap

The cascade SHALL run layers A (biome safe), B (biome unsafe-scoped delete), C (home-roll deleter), D (knip fix) in sequence, and SHALL repeat the full A→B→C→D sequence until either (a) one full pass produces no `git diff` change, or (b) the iteration cap (default 5, configurable via `--iterations`) is reached.

#### Scenario: Cascade converges in fewer iterations than the cap

- **WHEN** fix mode runs on a file set that stabilizes after 2 iterations
- **THEN** the orchestrator SHALL report "converged in 2 iterations" and exit successfully

#### Scenario: Iteration cap is hit

- **WHEN** fix mode runs and the cascade has not stabilized after `--iterations=N`
- **THEN** the orchestrator SHALL report "iteration cap hit — re-run or investigate" and exit non-zero

### Requirement: Safety envelope runs compile and lint after apply with no auto-revert

After any fix-mode cascade run (whether converged or cap-hit), the orchestrator SHALL run `bun run verify:compile` followed by `bun run verify:lint`. On any failure, the orchestrator SHALL print the failing output, the current `git status`, a list of hygiene mutations, and recovery options; it SHALL exit non-zero. It SHALL NOT automatically revert the mutations.

#### Scenario: Envelope passes after apply

- **WHEN** the cascade applies successfully and both `verify:compile` and `verify:lint` pass
- **THEN** the orchestrator SHALL print a success summary and exit zero

#### Scenario: Envelope fails after apply

- **WHEN** the cascade applies and either `verify:compile` or `verify:lint` fails
- **THEN** the orchestrator SHALL print the failure output, `git status`, the mutation file list, and a three-line recovery hint (discard via `git reset --hard HEAD`, fix forward, or partial-keep via `git add -p`)
- **AND** the orchestrator SHALL exit non-zero WITHOUT reverting any mutation

### Requirement: Scope=changed derives knip workspaces from git-diff

In `scope=changed` mode, the orchestrator SHALL derive knip's `--workspace` argument list by: (1) taking the output of `git diff --name-only "$BASE" -- '*.ts' '*.tsx' '*.js' '*.mjs' '*.cjs'`, (2) for each file, locating the nearest ancestor directory containing a `package.json` with a `"name"` field, (3) de-duplicating the name set, and (4) invoking knip with one `--workspace <name>` flag per distinct name.

#### Scenario: Single-workspace diff scopes knip to one workspace

- **WHEN** `git diff --name-only main` returns only files under `packages/system/src/`
- **AND** the orchestrator runs in `scope=changed` mode
- **THEN** knip is invoked with exactly one `--workspace @animus-ui/system` flag

#### Scenario: Multi-workspace diff scopes knip to the union

- **WHEN** the diff spans `packages/system/src/` and `packages/vite-plugin/src/`
- **THEN** knip is invoked with both `--workspace @animus-ui/system` and `--workspace @animus-ui/vite-plugin`

### Requirement: Scan mode requires a clean worktree

Scan mode SHALL refuse to run on a dirty worktree. "Dirty" is defined as `git status --porcelain` returning non-empty output (untracked OR modified files). On detection of a dirty worktree, scan mode SHALL abort with a non-zero exit code and an error directing the user to commit or stash before re-running.

#### Scenario: Scan refuses a dirty worktree

- **WHEN** `mode=scan` and `git status --porcelain` is non-empty
- **THEN** the orchestrator SHALL exit non-zero and print: "scan mode requires clean worktree. Commit or stash changes and re-run."

### Requirement: Scan mode provides a recovery snapshot

When scan mode runs on a clean worktree, the orchestrator SHALL capture a `git stash create` snapshot SHA before the cascade runs, and SHALL print that SHA at end-of-run with instructions for recovery via `git stash store`.

#### Scenario: Snapshot SHA is printed after scan

- **WHEN** scan mode completes on a clean worktree
- **THEN** the orchestrator SHALL print a line of the form "recovery snapshot: <sha> (recover via: `git stash store <sha>` then `git stash pop`)"

### Requirement: Scan mode restores worktree after reporting

After scan mode runs the cascade destructively and captures the report, the orchestrator SHALL restore the worktree to its pre-run state via `git reset --hard HEAD` followed by `git clean -fd`.

#### Scenario: Scan restores tracked and untracked state

- **WHEN** scan mode has completed its cascade and captured the diff as a report
- **THEN** the orchestrator SHALL run `git reset --hard HEAD && git clean -fd` before exiting
- **AND** `git status --porcelain` after exit SHALL be empty

### Requirement: code-hygiene is excluded from CI workflows

The code-hygiene capability SHALL NOT be invoked from any CI workflow file under `.github/workflows/`. Any addition of a `bun run hygiene` or `bash scripts/hygiene/run.sh` step to a CI workflow would violate the end-of-work-only contract and SHALL be rejected in code review.

#### Scenario: No hygiene invocation in CI

- **WHEN** the repo's `.github/workflows/*.yaml` files are inspected
- **THEN** no step invokes `bun run hygiene`, `bash scripts/hygiene/run.sh`, or any hygiene orchestrator path

### Requirement: Preconditions fail loud with actionable messages

The orchestrator SHALL require knip, biome, and typescript to be available; it SHALL detect missing tooling at startup and exit non-zero with an actionable "Run: <command>" message in the format established by `scripts/verify/_preconditions.sh`.

#### Scenario: knip missing emits actionable error

- **WHEN** `knip` is not installed (not present in `node_modules/`)
- **AND** the orchestrator starts
- **THEN** it SHALL exit non-zero with the message "ERROR: knip missing. Run: bun install"

#### Scenario: biome missing emits actionable error

- **WHEN** the biome binary is not reachable via `bunx --bun @biomejs/biome --version`
- **THEN** the orchestrator SHALL exit non-zero with the message "ERROR: biome missing. Run: bun install"

### Requirement: Rename-as-fix is never auto-applied for top-level declarations

The cascade SHALL NOT invoke biome's `noUnusedVariables` unsafe auto-fix (which renames to `_`-prefix) as part of Layer B or any other layer. Rename-as-fix is rejected for top-level declarations; deletion via the home-roll deleter (Layer C) is the authoritative semantic.

#### Scenario: Top-level unused const is not renamed

- **WHEN** a file contains `const unusedConst = 1;` (not referenced, not exported)
- **AND** the cascade runs in fix mode
- **THEN** the resulting file SHALL NOT contain `const _unusedConst = 1;` (no rename-to-underscore occurs)
- **AND** the `unusedConst` declaration SHALL be absent from the resulting file entirely (deleted by Layer C)

### Requirement: `noConsole` auto-fix is excluded from Layer B

Layer B's biome invocation SHALL use `--only` scoping that limits the applied rules to `correctness/noUnusedImports` and `correctness/noUnusedPrivateClassMembers` exclusively. Biome's `noConsole` rule, whose auto-fix strips `console.log` / `console.warn` calls, SHALL NOT be included in the scope.

#### Scenario: console.warn survives Layer B

- **WHEN** a source file contains `console.warn('diagnostic')` as a genuine runtime-observable line
- **AND** Layer B runs against that file
- **THEN** the `console.warn` call SHALL remain in the resulting file


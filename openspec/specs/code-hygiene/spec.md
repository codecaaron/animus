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

The cascade SHALL run layers A (biome safe), B (biome unsafe-scoped delete), C (home-roll deleter), D (knip fix), D1 (reconcile-after-knip) in sequence, and SHALL repeat the full A→B→C→D→D1 sequence until either (a) the final iteration's deletion-receipt count is zero (semantic convergence), or (b) the iteration cap (default 5, configurable via `--iterations`) is reached. The convergence verdict SHALL be derived from iteration-tagged receipts in `.hygiene/receipts.jsonl`, not from `git diff` fingerprint stability — fingerprint stability is vulnerable to idempotent A/B churn around whitespace, mtime, and `.gitattributes` filters and SHALL NOT be the basis for the convergence decision.

#### Scenario: Cascade converges in fewer iterations than the cap

- **WHEN** fix mode runs and the deletion-receipt count for some iteration N is zero (no receipts where `verb="delete"`)
- **AND** N is less than `--iterations`
- **THEN** the orchestrator SHALL report `converged in N iterations` and exit zero

#### Scenario: Iteration cap is hit but final iteration produced no deletions

- **WHEN** fix mode runs with `--iterations=N` and iteration N's deletion-receipt count is zero
- **THEN** the orchestrator SHALL emit `INFO: cascade settled at iteration cap (idempotent A/B churn caused fingerprint drift)` and exit zero
- **AND** the orchestrator SHALL NOT emit a WARN for this case

#### Scenario: Iteration cap is hit with persistent semantic deletions

- **WHEN** fix mode runs with `--iterations=N` and iteration N has at least one receipt with `verb="delete"` from layer C, D, or D1
- **THEN** the orchestrator SHALL emit `WARN: cascade did not converge — Layer <C|D|D1> still deleting at iteration N` and exit non-zero

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

### Requirement: Cascade emits deletion-receipts to a structured audit file

The cascade SHALL emit one structured JSON record per layer-applied operation to `.hygiene/receipts.jsonl` (newline-delimited JSON, one record per line). The file SHALL be truncated at orchestrator startup. Each record SHALL conform to schema version 1 with the fields `v` (integer, schema version, `1` for v1), `iter` (integer, cascade iteration starting at 1), `layer` (one of `"A"`, `"B"`, `"C"`, `"D"`, `"D1"`), `verb` (one of `"delete"`, `"format"`, `"stub"`), `target` (string identifying file path with optional line or export name), and `kind` (string semantic category such as `"named-import"`, `"const-decl"`, `"file"`, `"dependency"`). Records MAY include an `extras` object for layer-specific metadata. The file SHALL be append-only within a single run; concurrent writes from different layers within the same iteration SHALL NOT occur (layers run sequentially).

#### Scenario: Layer C deletion produces a receipt

- **WHEN** Layer C deletes an unused top-level `const` declaration at `packages/system/src/util.ts:42`
- **THEN** `.hygiene/receipts.jsonl` SHALL contain a line equivalent to `{"v":1,"iter":1,"layer":"C","verb":"delete","target":"packages/system/src/util.ts:42","kind":"const-decl","extras":{...}}`

#### Scenario: Layer D file removal produces a file-kind receipt

- **WHEN** Layer D removes the entire file `packages/system/src/orphan.ts`
- **THEN** `.hygiene/receipts.jsonl` SHALL contain a record where `layer="D"`, `verb="delete"`, `kind="file"`, and `target="packages/system/src/orphan.ts"`

#### Scenario: Receipts file is truncated at run start

- **WHEN** the orchestrator starts a fix-mode run and `.hygiene/receipts.jsonl` from a prior run exists
- **THEN** the file SHALL be truncated to zero bytes before any layer runs
- **AND** records from prior runs SHALL NOT appear in the post-run file

#### Scenario: Each receipt is valid JSON on its own line

- **WHEN** the cascade completes and `.hygiene/receipts.jsonl` contains N records
- **THEN** each line SHALL be parseable as a standalone JSON object
- **AND** every line SHALL include the required fields `v`, `iter`, `layer`, `verb`, `target`, `kind`

### Requirement: Layer D high-volume removals trigger an informational nudge

The orchestrator SHALL emit a `NOTE` line in the run summary when the receipt stream contains at least one record matching `layer="D"` AND `kind="file"`, OR at least five records matching `layer="D"` AND `kind∈{"export-clause","export-default"}`. The NOTE SHALL inform the user that build-time-only consumers (Vite virtual modules, MDX, custom plugins, the Rust extractor) are invisible to knip and SHALL recommend running `verify:build:*` before committing. The NOTE SHALL NOT change the exit code; it is informational only.

#### Scenario: Single Layer D file removal triggers the NOTE

- **WHEN** the cascade completes with one `layer="D" kind="file"` receipt
- **THEN** the run summary SHALL include a `NOTE` line referencing build-time-only consumers and recommending `verify:build:*`

#### Scenario: Five Layer D export removals trigger the NOTE

- **WHEN** the cascade completes with five or more `layer="D" kind∈{"export-clause","export-default"}` receipts
- **THEN** the run summary SHALL include the same NOTE

#### Scenario: Two Layer D export removals do not trigger the NOTE

- **WHEN** the cascade completes with exactly two `layer="D" kind="export-clause"` receipts and no file removals
- **THEN** the run summary SHALL NOT include the Layer D NOTE

### Requirement: Layer C category-drift is detected at startup

When Layer C (`delete-unused.ts`) reads biome's JSON diagnostic output and finds diagnostics present but ZERO of those diagnostics match `TARGET_CATEGORIES` after normalization, Layer C SHALL emit a sentinel receipt with `layer="C"`, `verb="drift-suspected"`, `kind="category-drift"`, and `extras.categoriesSeen` containing the list of distinct categories observed in the diagnostic stream. The orchestrator's summary SHALL surface this as a `WARN` indicating possible biome category renaming and listing the categories seen.

#### Scenario: Biome diagnostics with no matching categories produce a drift receipt

- **WHEN** biome reports five diagnostics all under category `lint/correctness/noUnusedVariables` (a renamed category)
- **AND** Layer C's `TARGET_CATEGORIES` includes only the unprefixed `correctness/noUnusedVariables`
- **THEN** Layer C SHALL emit one receipt with `verb="drift-suspected"` and `extras.categoriesSeen=["lint/correctness/noUnusedVariables"]`
- **AND** the run summary SHALL include `WARN: biome diagnostics present but none matched known categories — biome may have renamed. Categories seen: lint/correctness/noUnusedVariables`

#### Scenario: Biome diagnostics with at least one matching category do not trigger drift

- **WHEN** biome reports diagnostics including at least one under a known target category
- **THEN** Layer C SHALL NOT emit a `drift-suspected` receipt for that iteration
- **AND** the run summary SHALL NOT include the category-drift WARN

### Requirement: Cross-workspace dist-staleness is a precondition before fix mode

In fix mode, the orchestrator SHALL verify before running any cascade layer that each targeted workspace's `dist/` artifacts are not older than the latest file under its `src/**`. Targeted workspaces SHALL be derived using the same workspace-derivation logic as `Scope=changed derives knip workspaces from git-diff` (in `scope=changed`) or all workspaces with a published `dist/` entry (in `scope=all`). On detection of any stale `dist/`, fix mode SHALL exit non-zero with an actionable error in the format established by `scripts/verify/_preconditions.sh`. In scan mode, the same staleness condition SHALL emit a `WARN` and the cascade SHALL continue (preserving preview ergonomics).

#### Scenario: Stale dist in fix mode aborts before cascade

- **WHEN** `bun run hygiene --apply` is invoked
- **AND** `packages/system/dist/index.js` mtime is older than the latest mtime under `packages/system/src/`
- **THEN** the orchestrator SHALL exit non-zero with the message `ERROR: packages/system/dist stale vs src. Run: bun run build:ts`
- **AND** no Layer A/B/C/D/D1 invocation SHALL occur

#### Scenario: Stale dist in scan mode warns and continues

- **WHEN** `bun run hygiene` (default scan mode) is invoked
- **AND** any targeted workspace has a stale `dist/`
- **THEN** the orchestrator SHALL print a `WARN: <pkg>/dist stale vs src` line and continue with the cascade

#### Scenario: Workspace without a dist entry is skipped

- **WHEN** a targeted workspace's `package.json` has no `main` or `module` field
- **THEN** the dist-staleness check SHALL skip that workspace
- **AND** SHALL NOT cause an error or warning

### Requirement: Reconciler partial-clause edits preserve original-source spans

When `reconcile-after-knip.ts` removes individual elements from an `export { a, b, c }` re-export clause where one or more elements have become stale (target file emptied, target export removed, target file deleted), the reconciler SHALL apply span-preserving deletions to the original source rather than reconstructing the clause text. Per-element trivia (leading JSDoc, `biome-ignore` directives, comments, per-element `type` modifiers) for retained elements SHALL be preserved exactly as it appeared in the original source.

#### Scenario: JSDoc above a retained export element is preserved

- **GIVEN** a barrel containing `export { /** doc-A */ a, b, c } from './m';` where only `b` is stale
- **WHEN** the reconciler runs
- **THEN** the resulting source SHALL contain `export { /** doc-A */ a, c } from './m';` (or equivalent with `b` and its leading separator removed) with the JSDoc above `a` intact

#### Scenario: Per-element type modifier is preserved

- **GIVEN** a barrel containing `export { type Foo, bar, baz } from './m';` where only `baz` is stale
- **WHEN** the reconciler runs
- **THEN** the resulting source SHALL contain `export { type Foo, bar } from './m';`

#### Scenario: biome-ignore directive on a retained element is preserved

- **GIVEN** a barrel containing `export { /* biome-ignore lint/correctness/X: reason */ a, b } from './m';` where only `b` is stale
- **WHEN** the reconciler runs
- **THEN** the directive comment above `a` SHALL remain in the resulting source

### Requirement: --apply --all requires explicit confirmation

When the orchestrator is invoked with both `--apply` and `--all`, it SHALL require explicit confirmation before proceeding. In a TTY, the orchestrator SHALL prompt `Type 'apply-all' to continue: ` and SHALL refuse to proceed unless stdin returns exactly `apply-all`. In non-TTY (agent or scripted) invocation, the orchestrator SHALL require the additional flag `--yes-apply-all`; absence of this flag SHALL produce a non-zero exit with an actionable error message identifying the flag. The daily-driver `--apply` (changed scope) SHALL NOT require any confirmation.

#### Scenario: Interactive --apply --all without confirmation aborts

- **WHEN** a user runs `bun run hygiene --apply --all` in a TTY
- **AND** types `no` (or anything other than `apply-all`) at the prompt
- **THEN** the orchestrator SHALL exit non-zero without running any layer

#### Scenario: Non-TTY --apply --all without --yes-apply-all aborts

- **WHEN** an agent invokes `bun run hygiene --apply --all` (non-TTY) without `--yes-apply-all`
- **THEN** the orchestrator SHALL exit non-zero with `ERROR: --apply --all requires --yes-apply-all in non-interactive context`

#### Scenario: --apply (changed scope) does not prompt

- **WHEN** a user or agent runs `bun run hygiene --apply`
- **THEN** the orchestrator SHALL proceed without prompting and without requiring `--yes-apply-all`

### Requirement: Help text reflects resolved environment-variable defaults

The orchestrator's help text (`bun run hygiene --help`) SHALL be constructed AFTER environment-variable resolution and SHALL show the resolved default for any flag that has an env-var override. Specifically, the `--base` line SHALL include `(env: HYGIENE_BASE_REF, currently: <resolved-value>)` and the `--iterations` line SHALL include `(env: HYGIENE_ITERATIONS, currently: <resolved-value>)`. The help text SHALL NOT show stale or hard-coded defaults that diverge from the values the run will actually use.

#### Scenario: Help shows env-var-overridden base ref

- **WHEN** `HYGIENE_BASE_REF=develop bun run hygiene --help` is invoked
- **THEN** the `--base` line SHALL contain `currently: develop`

#### Scenario: Help shows hard-coded default when env var is unset

- **WHEN** `bun run hygiene --help` is invoked with no `HYGIENE_BASE_REF` set
- **THEN** the `--base` line SHALL contain `currently: main`

### Requirement: Receipts file is the postmortem audit artifact

When the safety envelope (`verify:compile` followed by `verify:lint`) fails after a fix-mode cascade, the orchestrator's failure output SHALL reference `.hygiene/receipts.jsonl` as the structured audit trail of "what was deleted by which layer in which iteration." The receipts file SHALL persist after the failure (no automatic cleanup) and SHALL be valid JSONL parseable line-by-line, including in the case where the orchestrator was interrupted mid-cascade.

#### Scenario: Envelope failure references the receipts file

- **WHEN** the cascade applies, `verify:compile` fails, and the orchestrator prepares its failure summary
- **THEN** the failure output SHALL include a line directing the user to `.hygiene/receipts.jsonl` for the structured deletion log

#### Scenario: Mid-cascade interrupt leaves valid partial JSONL

- **WHEN** the cascade is interrupted with SIGINT during Layer D of iteration 2
- **THEN** `.hygiene/receipts.jsonl` SHALL be parseable as JSONL up to its last complete line
- **AND** any partial trailing line SHALL be safely ignorable by line-by-line parsers


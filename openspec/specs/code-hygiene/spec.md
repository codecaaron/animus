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

The cascade SHALL remove dead declarations through DELETION, not rename. This applies to unused imports, unused top-level `const` / `function` / `let` / `class` / `type alias` / `interface` / `enum` declarations, unused destructured binding elements, unused cross-file exports, unused files, and unused `package.json` dependencies.

Earlier revisions of this requirement included `unused private class members` in the deletion scope. The cascade's current linter binding (oxlint) provides `no-unused-private-class-members` which fires only on `#field` syntax (per ESLint 1:1 spec); it has empty scope on the codebase's TypeScript `private`-keyword syntax. The capability is dormant and SHALL be reintroduced (or scoped to `#field`) only if the codebase or linter binding changes.

#### Scenario: Unused top-level const is deleted

- **WHEN** a source file contains `const unusedConst = 1;` that is not referenced anywhere in the file and not exported
- **AND** the cascade runs in fix mode against that file
- **THEN** the resulting file SHALL NOT contain the `unusedConst` declaration (the statement is removed, not renamed to `_unusedConst`)

#### Scenario: Unused named import is deleted

- **WHEN** a source file contains `import { usedFn, unusedFn } from 'foo';` where `unusedFn` is not referenced
- **AND** the cascade runs in fix mode
- **THEN** the resulting file SHALL contain `import { usedFn } from 'foo';` with `unusedFn` removed

### Requirement: Side-effect imports are preserved

The cascade SHALL NOT remove side-effect imports (`import 'module-name';` without bindings). The active linter does not flag side-effect imports as unused by design, and the home-roll deleter SHALL NOT augment the linter's detection to include them.

#### Scenario: Side-effect import survives cascade

- **WHEN** a source file contains `import 'some-side-effect-module';` at the top
- **AND** the cascade runs in fix mode
- **THEN** the resulting file SHALL still contain that import statement

### Requirement: Positional function parameters preserve arity via rename, not delete

The cascade SHALL NOT DELETE positional function parameters. When the active linter offers an unsafe auto-fix that renames unused positional parameters to `_`-prefixed names, the cascade SHALL leave that rule's reporting as a warning (not auto-applied) for human review; it SHALL NOT auto-rename positional parameters as part of the cascade.

oxlint's `no-unused-vars` rule does not offer rename-as-fix for positional parameters; under the oxlint binding, parameters are reported as errors and left for human resolution. The home-roll deleter (Layer C) SHALL NOT delete positional parameters because doing so would change function arity, which is a public-API contract.

#### Scenario: Positional param is not deleted

- **WHEN** a function `function f(a: number, unusedB: string) { return a; }` is present
- **AND** the cascade runs in fix mode
- **THEN** the function signature SHALL still contain two parameters (arity = 2) after the cascade

### Requirement: Destructured binding elements are deleted when unused

The cascade SHALL delete unused binding elements from destructuring patterns (object and array) because these are intra-file dead artifacts without an arity contract. The active linter (oxlint) detects these via `no-unused-vars` but offers no fix that removes the dead binding element while preserving the surrounding pattern; the home-roll deleter (Layer C) closes this gap.

#### Scenario: Unused destructured field is deleted

- **WHEN** a source file contains `const { a, b } = obj;` where `a` is not referenced and `b` is used
- **AND** the cascade runs in fix mode
- **THEN** the resulting file SHALL contain `const { b } = obj;`

### Requirement: Cascade iterates to convergence or iteration cap

The cascade SHALL run layers A (linter safe-fix + import removal), C (home-roll deleter), D (knip fix), D1 (reconcile-after-knip) in sequence, and SHALL repeat the full A→C→D→D1 sequence until either (a) the final iteration's deletion-receipt count is zero (semantic convergence), or (b) the iteration cap (default 5, configurable via `--iterations`) is reached. The convergence verdict SHALL be derived from iteration-tagged receipts in `.hygiene/receipts.jsonl`, not from `git diff` fingerprint stability — fingerprint stability is vulnerable to idempotent Layer A churn around whitespace, mtime, and `.gitattributes` filters and SHALL NOT be the basis for the convergence decision.

Earlier revisions of the cascade included Layer B (linter unsafe-scoped delete). Layer B was removed when the cascade rebound to a linter whose private-class-member rule has empty scope on the codebase's `private`-keyword syntax. The A→C→D→D1 sequence preserves the cascade's original semantic contract.

#### Scenario: Cascade converges in fewer iterations than the cap

- **WHEN** fix mode runs and the deletion-receipt count for some iteration N is zero (no receipts where `verb="delete"`)
- **AND** N is less than `--iterations`
- **THEN** the orchestrator SHALL report `converged in N iterations` and exit zero

#### Scenario: Iteration cap is hit but final iteration produced no deletions

- **WHEN** fix mode runs with `--iterations=N` and iteration N's deletion-receipt count is zero
- **THEN** the orchestrator SHALL emit `INFO: cascade settled at iteration cap (idempotent Layer A churn caused fingerprint drift)` and exit zero
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

The orchestrator SHALL require knip, the active linter (oxlint via vite-plus), and typescript to be available; it SHALL detect missing tooling at startup and exit non-zero with an actionable "Run: <command>" message in the format established by `scripts/verify/_preconditions.sh`.

#### Scenario: knip missing emits actionable error

- **WHEN** `knip` is not installed (not present in `node_modules/`)
- **AND** the orchestrator starts
- **THEN** it SHALL exit non-zero with the message "ERROR: knip missing. Run: bun install"

#### Scenario: Linter missing emits actionable error

- **WHEN** the active linter binary is not reachable via `bunx vp lint --version`
- **THEN** the orchestrator SHALL exit non-zero with the message "ERROR: vp lint missing. Run: bun install"

### Requirement: Rename-as-fix is never auto-applied for top-level declarations

The cascade SHALL NOT invoke any linter auto-fix that renames unused top-level declarations (e.g., to `_`-prefix). Rename-as-fix is rejected for top-level declarations because deletion is the authoritative semantic — renamed declarations are still dead code, just disguised. The home-roll deleter (Layer C) is the authoritative semantic for top-level dead-decl removal.

The current linter binding (oxlint) does not offer rename-as-fix for top-level declarations, so the invariant is naturally preserved without explicit exclusion. Future linter rebinds SHALL preserve this invariant: any rule whose auto-fix renames top-level declarations to `_`-prefix SHALL be excluded from cascade auto-fix scope.

#### Scenario: Top-level unused const is not renamed

- **WHEN** a file contains `const unusedConst = 1;` (not referenced, not exported)
- **AND** the cascade runs in fix mode
- **THEN** the resulting file SHALL NOT contain `const _unusedConst = 1;` (no rename-to-underscore occurs)
- **AND** the `unusedConst` declaration SHALL be absent from the resulting file entirely (deleted by Layer C)

### Requirement: Diagnostic-logging-stripping rules are excluded from cascade auto-fix

Cascade layers that invoke the active linter's auto-fix capability SHALL NOT enable rules whose auto-fix removes diagnostic logging output (e.g., a `no-console` rule in any linter). The cascade preserves `console.log` / `console.warn` / `console.error` calls as runtime-observable diagnostic surfaces; the linter's safe-fix configuration in cascade layers MUST exclude any rule whose fix strips these calls.

This requirement is linter-neutral and applies to any cascade layer using auto-fix — historically Layer B (biome `--unsafe` scoped to specific rules), now Layer A (oxlint `--fix-suggestions`). It survives layer-set restructuring as long as some cascade layer invokes auto-fix.

#### Scenario: console.warn survives cascade auto-fix layer

- **WHEN** a source file contains `console.warn('diagnostic')` as a genuine runtime-observable line
- **AND** the cascade's auto-fix layer runs against that file
- **THEN** the `console.warn` call SHALL remain in the resulting file

### Requirement: Cascade emits deletion-receipts to a structured audit file

The cascade SHALL emit one structured JSON record per layer-applied operation to `.hygiene/receipts.jsonl` (newline-delimited JSON, one record per line). The file SHALL be truncated at orchestrator startup. Each record SHALL conform to schema version 1 with the fields `v` (integer, schema version, `1` for v1), `iter` (integer, cascade iteration starting at 1), `layer` (one of `"A"`, `"C"`, `"D"`, `"D1"`), `verb` (one of `"delete"`, `"format"`, `"stub"`, `"drift-suspected"`), `target` (string identifying file path with optional line or export name), and `kind` (string semantic category such as `"named-import"`, `"const-decl"`, `"file"`, `"dependency"`, `"code-drift"`). Records MAY include an `extras` object for layer-specific metadata. The file SHALL be append-only within a single run; concurrent writes from different layers within the same iteration SHALL NOT occur (layers run sequentially).

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

For export-volume Layer D nudges, the hygiene orchestrator SHALL retain the existing informational-only exit behavior and thresholds. The nudge SHALL recommend a claim-oriented verification command: a package owner claim for a local owner, a fail-closed dependent-owner filter for a shared package, or `vp run verify:full` when the affected build-time consumer is uncertain. It SHALL NOT recommend the removed root `verify:build:*` family.

This requirement changes command wording only. It does not determine the overall hygiene verdict. A whole-file deletion remains subject to the active blocking behavior-proof policy and MAY make the run non-zero.

#### Scenario: Single Layer D file removal triggers the NOTE

- **WHEN** a Layer D file removal crosses the existing threshold
- **THEN** the summary includes a claim-oriented build-time-consumer verification message
- **AND** its exit status follows the separate whole-file behavior-proof policy

#### Scenario: Five Layer D export removals trigger the NOTE

- **WHEN** five Layer D export removals cross the existing threshold
- **THEN** the same claim-oriented nudge is emitted

#### Scenario: Two Layer D export removals do not trigger the NOTE

- **WHEN** only two Layer D export removals occur
- **THEN** no high-volume nudge is emitted

### Requirement: Layer C code-drift is detected at startup

When Layer C (`delete-unused.ts`) reads the active linter's JSON diagnostic output and finds diagnostics present but ZERO of those diagnostics match `TARGET_CODES` after normalization, Layer C SHALL emit a sentinel receipt with `layer="C"`, `verb="drift-suspected"`, `kind="code-drift"`, and `extras.codesSeen` containing the list of distinct codes observed in the diagnostic stream. The orchestrator's summary SHALL surface this as a `WARN` indicating possible linter rule renaming and listing the codes seen.

This requirement is linter-neutral. Under biome the discriminator was the `category` field; under oxlint it is the `code` field (with `eslint(...)` wrapper unwrap normalization). The drift-detection mechanism is preserved across linter rebinds.

#### Scenario: Linter diagnostics with no matching codes produce a drift receipt

- **WHEN** the active linter reports five diagnostics all under code `eslint(no-renamed-rule)` (a renamed rule)
- **AND** Layer C's `TARGET_CODES` includes only `eslint(no-unused-vars)`
- **THEN** Layer C SHALL emit one receipt with `verb="drift-suspected"` and `extras.codesSeen=["eslint(no-renamed-rule)"]`
- **AND** the run summary SHALL include `WARN: oxlint diagnostics present but none matched known codes — oxlint may have renamed. Codes seen: eslint(no-renamed-rule)`

#### Scenario: Linter diagnostics with at least one matching code do not trigger drift

- **WHEN** the active linter reports diagnostics including at least one under a known target code
- **THEN** Layer C SHALL NOT emit a `drift-suspected` receipt for that iteration
- **AND** the run summary SHALL NOT include the code-drift WARN

### Requirement: Cross-workspace dist-staleness is a precondition before fix mode

In fix mode, the orchestrator SHALL verify before running any cascade layer that each targeted workspace's `dist/` artifacts are not older than the latest file under its `src/**`. Targeted workspaces SHALL be derived using the same workspace-derivation logic as `Scope=changed derives knip workspaces from git-diff` (in `scope=changed`) or all workspaces with a published `dist/` entry (in `scope=all`). On detection of any stale `dist/`, fix mode SHALL exit non-zero with an actionable error in the format established by `scripts/verify/_preconditions.sh`. In scan mode, the same staleness condition SHALL emit a `WARN` and the cascade SHALL continue (preserving preview ergonomics).

#### Scenario: Stale dist in fix mode aborts before cascade

- **WHEN** `vp run hygiene --apply` is invoked
- **AND** `packages/system/dist/index.js` mtime is older than the latest mtime under `packages/system/src/`
- **THEN** the orchestrator SHALL exit non-zero with the message `ERROR: packages/system/dist stale vs src. Run: vp run build:ts`
- **AND** no Layer A/C/D/D1 invocation SHALL occur

#### Scenario: Stale dist in scan mode warns and continues

- **WHEN** `vp run hygiene` (default scan mode) is invoked
- **AND** any targeted workspace has a stale `dist/`
- **THEN** the orchestrator SHALL print a `WARN: <pkg>/dist stale vs src` line and continue with the cascade

#### Scenario: Workspace without a dist entry is skipped

- **WHEN** a targeted workspace's `package.json` has no `main` or `module` field
- **THEN** the dist-staleness check SHALL skip that workspace
- **AND** SHALL NOT cause an error or warning

### Requirement: Reconciler partial-clause edits preserve original-source spans

When `reconcile-after-knip.ts` removes individual elements from an `export { a, b, c }` re-export clause where one or more elements have become stale (target file emptied, target export removed, target file deleted), the reconciler SHALL apply span-preserving deletions to the original source rather than reconstructing the clause text. Per-element trivia (leading JSDoc, linter-disable directives in the active or historical syntax — e.g., `oxlint-disable-next-line`, `biome-ignore` — comments, per-element `type` modifiers) for retained elements SHALL be preserved exactly as it appeared in the original source.

#### Scenario: JSDoc above a retained export element is preserved

- **GIVEN** a barrel containing `export { /** doc-A */ a, b, c } from './m';` where only `b` is stale
- **WHEN** the reconciler runs
- **THEN** the resulting source SHALL contain `export { /** doc-A */ a, c } from './m';` (or equivalent with `b` and its leading separator removed) with the JSDoc above `a` intact

#### Scenario: Per-element type modifier is preserved

- **GIVEN** a barrel containing `export { type Foo, bar, baz } from './m';` where only `baz` is stale
- **WHEN** the reconciler runs
- **THEN** the resulting source SHALL contain `export { type Foo, bar } from './m';`

#### Scenario: Linter-disable directive on a retained element is preserved

- **GIVEN** a barrel containing `export { /* biome-ignore lint/correctness/X: reason */ a, b } from './m';` where only `b` is stale
- **WHEN** the reconciler runs
- **THEN** the directive comment above `a` SHALL remain in the resulting source

#### Scenario: oxlint-disable directive on a retained element is preserved

- **GIVEN** a barrel containing `export { /* oxlint-disable-next-line correctness/X -- reason */ a, b } from './m';` where only `b` is stale
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

### Requirement: Binding to orchestration-architecture

The code-hygiene cascade structure (Layer A linter safe-fix + import removal → Layer C home-roll deleter → Layer D knip → Layer D1 reconcile-after-knip), the safety envelope, the scan/fix-mode contract, and the recovery-snapshot semantics defined in this spec SHALL be realized through the orchestrator binding designated by the `orchestration-architecture` capability. The current binding uses `vp run hygiene` (or equivalently `bash scripts/hygiene/run.sh`) and shells out to `vp lint` (oxlint) for Layer A and `knip` for Layer D.

A future rebind to a different linter/formatter SHALL preserve the cascade structure: Layer A's safe-fix + import-removal semantics, Layer C's home-roll deleter (which closes the linter's intra-file dead-decl gap for top-level declarations and destructured binding elements), Layer D's knip-driven cross-file pruning, Layer D1's span-preserving reconcile-after-knip. The rebind MAY substitute the underlying tool for Layer A provided the layer's semantic contract is preserved.

The end-of-work-only contract (`vp run hygiene` SHALL NOT appear in any CI workflow) is invariant under orchestrator rebind. The hygiene surface remains a human-or-agent-invoked tool, never a CI gate, regardless of which orchestrator dispatches it.

Earlier revisions of the cascade included Layer B (linter unsafe-scoped delete). Layer B was removed when the cascade rebound to oxlint, whose `no-unused-private-class-members` rule fires only on `#field` syntax (per ESLint 1:1 spec) and therefore has empty scope on the codebase's `private`-keyword TypeScript code. Future rebinds MAY reintroduce a Layer B if the new linter offers a private-keyword-scoped rule with safe DELETE-only semantics; the cascade's invariants (safety envelope, end-of-work-only contract) hold regardless.

#### Scenario: Cascade structure survives linter rebind

- **WHEN** a future cutover rebinds the linter (e.g., oxlint → `<new-linter>`)
- **THEN** Layer A continues to apply only safe-fix transformations + import removal
- **AND** Layer C continues to delete intra-file dead declarations (top-level decls + destructured binding elements) the linter does not handle
- **AND** Layer D continues to invoke `knip --fix` for cross-file pruning
- **AND** Layer D1 continues to reconcile post-knip span-preserving fixups

#### Scenario: End-of-work-only contract survives orchestrator rebind

- **WHEN** any cutover follow-on rebinds the orchestrator or linter
- **THEN** the hygiene entrypoint continues to be excluded from `.github/workflows/*.yaml` files
- **AND** any addition of a hygiene step to CI is rejected in code review

### Requirement: Hygiene Entrypoint Dispatched via vp run

The single code-hygiene entrypoint defined elsewhere in this spec SHALL be dispatched through Vite+ as `vp run hygiene`. The canonical orchestrator-dispatch surface SHALL be `vp run hygiene` (with flags propagating: `vp run hygiene -- --apply`, `vp run hygiene -- --all`, etc.). The `hygiene` task name is defined ONLY in `vite.config.ts` `run.tasks` (not in `package.json` `scripts`) — `bun run hygiene` returns "script not found" post-migration by design (hard cutover). The direct shell invocation `bash scripts/hygiene/run.sh` continues to work unchanged for any caller that prefers shell-direct invocation.

The hygiene-cascade structure (Layer A linter safe-fix + import removal → C home-roll deleter → D knip → D1 reconcile-after-knip), the safety envelope, the scan/fix-mode contract, and the recovery-snapshot semantics defined elsewhere in this spec are preserved verbatim. Vite+ wraps the existing `bash scripts/hygiene/run.sh` invocation — it does NOT reimplement any cascade logic.

The end-of-work-only contract is invariant under any dispatch surface — `vp run hygiene`, `bun run hygiene`, and `bash scripts/hygiene/run.sh` all SHALL be excluded from `.github/workflows/*.yaml`. Adding any of these invocations to a CI workflow SHALL be rejected in code review regardless of which dispatch surface is used.

#### Scenario: vp run hygiene wraps existing shell script

- **WHEN** a user or agent runs `vp run hygiene` with no flags on a clean worktree
- **THEN** vp invokes `bash scripts/hygiene/run.sh` as the task body
- **AND** the script's scan-mode behavior is identical to direct `bash scripts/hygiene/run.sh` invocation (cascade runs against changed-scope, restores worktree, prints report, exits zero)
- **AND** the script's stderr, stdout, and exit code are propagated unchanged

#### Scenario: vp run hygiene -- --apply propagates flags

- **WHEN** a user runs `vp run hygiene -- --apply`
- **THEN** vp passes the `--apply` flag through to `bash scripts/hygiene/run.sh`
- **AND** fix mode runs as documented (cascade applies, safety envelope runs, no auto-revert on failure)

#### Scenario: bun run hygiene fails after cutover

- **WHEN** a developer runs `bun run hygiene` post-migration
- **AND** `hygiene` is defined ONLY in `vite.config.ts` `run.tasks` (not in `package.json` `scripts`)
- **THEN** bun emits its standard "script not found" error and exits non-zero
- **AND** the canonical invocation path remains `vp run hygiene`

#### Scenario: bash scripts/hygiene/run.sh continues to work

- **WHEN** a maintainer runs `bash scripts/hygiene/run.sh` directly without going through vp or bun
- **THEN** the script executes as before (vp dispatch is an additional surface, not a replacement)
- **AND** the cascade behavior is identical

#### Scenario: Hygiene remains excluded from CI under any dispatch surface

- **WHEN** the repo's `.github/workflows/*.yaml` files are inspected
- **THEN** no step invokes `vp run hygiene`, `bun run hygiene`, or `bash scripts/hygiene/run.sh`
- **AND** the end-of-work-only contract holds regardless of which dispatch surface a workflow author might attempt

### Requirement: Risky file deletion blocks completion

The hygiene orchestrator SHALL exit non-zero for a run containing a Layer D whole-file deletion unless the same run records the required behavior-build proof.

#### Scenario: Whole file is deleted without build proof

- **WHEN** the receipt stream contains `layer="D"`, `verb="delete"`, and `kind="file"` and no behavior-build proof is recorded
- **THEN** the verdict requires manual review and the orchestrator exits non-zero after its safety envelope

#### Scenario: Export-only cleanup completes

- **WHEN** the receipt stream contains no whole-file deletion and the cascade converges with a passing safety envelope
- **THEN** the whole-file deletion policy does not change the successful exit status


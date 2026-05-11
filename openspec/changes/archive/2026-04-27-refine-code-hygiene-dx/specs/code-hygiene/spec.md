## MODIFIED Requirements

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

## ADDED Requirements

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

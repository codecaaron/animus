## ADDED Requirements

### Requirement: Hygiene Entrypoint Dispatched via vp run

The single code-hygiene entrypoint defined elsewhere in this spec SHALL be dispatched through Vite+ as `vp run hygiene`. The canonical orchestrator-dispatch surface SHALL be `vp run hygiene` (with flags propagating: `vp run hygiene -- --apply`, `vp run hygiene -- --all`, etc.). The `hygiene` task name is defined ONLY in `vite.config.ts` `run.tasks` (not in `package.json` `scripts`) — `bun run hygiene` returns "script not found" post-migration by design (hard cutover). The direct shell invocation `bash scripts/hygiene/run.sh` continues to work unchanged for any caller that prefers shell-direct invocation.

The hygiene-cascade structure (Layer A biome safe → B biome unsafe-scoped → C home-roll deleter → D knip → D1 reconcile-after-knip), the safety envelope, the scan/fix-mode contract, and the recovery-snapshot semantics defined elsewhere in this spec are preserved verbatim. Vite+ wraps the existing `bash scripts/hygiene/run.sh` invocation — it does NOT reimplement any cascade logic.

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

# Increment 04: cli-mcp-surfaces

## Scope

- **Registry row**: 04 · mode: delegate · review: subagent
- **Resolves**: D7 (CLI + MCP as the agent surfaces, tier-registered)
- **Authors**: — (envelope: `specs/headless-analysis-session/spec.md`
  §Dual invocation surfaces + §Core query set;
  `specs/verification-tier-policy/spec.md` delta §Harness tier registration)
- **Depends on (deps:)**: 03
- **Inputs from (inputs:)**: none (consumes the session module's public
  exports as fixed by the envelope specs; if 03's landed exports diverge,
  journal a `friction` entry rather than improvising)
- **Footprint**: `packages/_verify/src/cli/**`, `packages/_verify/src/mcp/**`, `vite.config.ts`, `AGENTS.md`

## Context Capsule

Read first: the two spec files above; `design.md` §D7, §NS5;
`packages/_verify/src/session/queries.ts` (landed by 03).

Repo facts:
- Task orchestration is `vp run <task>` with tasks declared in root
  `vite.config.ts` under `run.tasks` (see `verification-tier-policy` spec in
  `openspec/specs/` for tier conventions; grep an existing task such as
  `verify:parity` for the declaration shape).
- The Change-Type Map in root `AGENTS.md` must gain a row for
  `packages/_verify/src/**` (ownership rule at the map's foot).
- MCP server: `@modelcontextprotocol/sdk` as a devDependency of
  `@animus-ui/verify-internal` only (no consumer-facing dependency change);
  stdio transport; one tool per query (`explain_component`,
  `explain_property`, `diff_universe`), each returning the serialized
  `VerdictEnvelope`.
- CLI: `packages/_verify/src/cli/main.ts`, runnable via
  `bun packages/_verify/src/cli/main.ts <query> [args]`; exit code 0 on
  `exact`/`conditional`, non-zero on `divergent`, `unverifiable`, or a
  preserve violation (spec scenario "CI usage").

## Plan

- [ ] 1. Failing test `__tests__/cli-exit-codes.test.ts`: spawn the CLI against the fixture workspace; `explain-property` returning `divergent` exits non-zero; `exact` exits 0.
- [ ] 2. Implement `cli/main.ts` (arg parsing, session invocation, JSON to stdout, exit-code mapping). PASS.
- [ ] 3. Failing test `__tests__/mcp-parity.test.ts`: the same query via the MCP tool handler and via the CLI produce identical envelopes for identical workspace state (invoke the tool handler in-process; no transport needed for parity).
- [ ] 4. Implement `mcp/server.ts` wrapping the same query module. PASS.
- [ ] 5. Register vp tasks (`style:explain`, `style:diff`) in `vite.config.ts` `run.tasks` mirroring an existing task's shape; verify `vp run style:explain -- --help` dispatches.
- [ ] 6. Add the `packages/_verify/src/**` row to the `AGENTS.md` Change-Type Map (run: `vp run verify:compile && bunx vp test run packages/_verify/__tests__/`).
- [ ] 7. Checkpoint: the step-6 commands PASS; `rg -n "_verify" AGENTS.md` shows the new row.

## Guardrail gate

G1/G2 remain active for this package's tests (they run in step 6's suite).

## Spec authorship checklist

- [x] — (envelope)

## Output contract (delegate)

Return: (a) CLI command names + exit-code table as implemented, (b) MCP tool
names + input schemas, (c) the `vite.config.ts` task names added, (d) the
AGENTS.md row text, (e) test names + PASS evidence tails, (f) surprises as
journal candidates. Do not edit spec files.

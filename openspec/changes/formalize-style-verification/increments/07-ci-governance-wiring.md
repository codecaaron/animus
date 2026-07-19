# Increment 07: ci-governance-wiring

## Scope

- **Registry row**: 07 · mode: delegate · review: subagent
- **Resolves**: — (operationalizes the governance artifact from
  `specs/semantic-universe-diff/spec.md` §Governance comment artifact)
- **Authors**: — (envelope)
- **Depends on (deps:)**: 05
- **Inputs from (inputs:)**: none
- **Footprint**: `.github/workflows/**`

## Context Capsule

Read first: `specs/semantic-universe-diff/spec.md`; `design.md` §Migration
Plan (shadow-first: lands disabled-by-default, flips on after one week of
shadow operation); the CLI surface from increment 04
(`packages/_verify/src/cli/main.ts`, `diff-universe` subcommand).

Repo facts:
- Existing CI lives at `.github/workflows/ci.yaml`; mirror its runner setup
  (bun via `bun-version-file`, Node via `node-version-file` per root
  `AGENTS.md` §Key Rules) rather than inventing a new toolchain block.
- New workflow `style-governance.yaml`, `pull_request` trigger, gated by a
  repository variable (e.g. `STYLE_GOVERNANCE=shadow|comment|off`, default
  `shadow`): `shadow` runs the diff and uploads it as a build artifact only;
  `comment` additionally posts/updates a single PR comment (use the
  marker-comment upsert pattern — one comment per PR, edited in place).
- The job: checkout base and head, run the CLI `diff-universe` between the
  two states (production mode), render the governance artifact, never fail
  the build on `divergent` in shadow mode.
- Per the Change-Type Map, workflow changes route to `vp run verify:full`;
  run it once at this increment's checkpoint (slow, expected).

## Plan

- [ ] 1. Write `.github/workflows/style-governance.yaml` per the capsule (trigger, variable gate, base/head analysis, artifact upload; comment step behind the `comment` mode).
- [ ] 2. Validate syntax locally: `bunx yaml-lint .github/workflows/style-governance.yaml` if available, else `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/style-governance.yaml'))"`; expected: clean parse.
- [ ] 3. Dry-run the job's script steps locally against the fixture workspace (the same CLI commands the workflow runs); expected: a rendered governance artifact file.
- [ ] 4. Checkpoint: `vp run verify:full`; expected: PASS (workflow-only change; failures here indicate an unrelated broken tree — journal a `friction` entry, do not proceed on red).

## Guardrail gate

None specific to this footprint. Gate = steps 2–4.

## Spec authorship checklist

- [x] — (envelope)

## Output contract (delegate)

Return: (a) the workflow file (paste), (b) the variable gate semantics table,
(c) local dry-run evidence (artifact path + first lines), (d) `verify:full`
tail, (e) journal candidates. Do not edit spec files.

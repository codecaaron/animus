## Context

The `adopt-orchestration-architecture` umbrella established Vite+ as the target orchestrator and enumerated five follow-on cutover slices. The first (`migrate-orchestrator-to-vp-run`) shipped the task-graph rebind. This is the second slice: lint/format binding to oxlint + oxfmt via `vp lint` and `vp fmt` subcommands.

Pre-this-slice state (post-orchestrator-migration):

- `verify:lint` exists in `vite.config.ts` `run.tasks` with a task body that originally wrapped `bash scripts/verify/lint.sh` (which invoked biome).
- `package.json` `scripts` retains 4 biome wrappers: `lint`, `format`, `check`, `check:fix`. CI invokes `bun run check` at `ci.yaml:26`.
- The hygiene cascade (`scripts/hygiene/run.sh`) invokes biome directly via `bunx --bun @biomejs/biome` at 7 call sites. The Layer C deleter (`scripts/hygiene/delete-unused.ts`) parses biome 2.x `--reporter=json` output to drive coordinate-based deletion.
- `@biomejs/biome: 2.4.9` is in root `devDependencies`.

Stakeholders: Aaron (sole repo author / sole maintainer). Pre-GA cutover requires maintainer-signed risk acceptance per `adopt-orchestration-architecture`'s Migration Trigger Criteria — this is documented in `proposal.md`'s Risk Acceptance section.

The slice landed in code via commits `e5653d2 oxlint oxfmt` and `510a664 Fix` ahead of this proposal being authored. Per the capability/policy decomposition pattern, each cutover should land with its policy artifact in the same change; this slice violated that ordering. The artifact is being authored retroactively to close the governance gap before any further cutover work proceeds. The umbrella's authorization (`adopt-orchestration-architecture/proposal.md:62` enumerates this slice) still covered the work in principle; what is being added now is the per-slice risk acceptance, the spec invariant, and the design rationale.

## Goals / Non-Goals

**Goals:**

- Rebind `verify:lint` atomic tier from biome to oxlint+oxfmt via `vp lint` and `vp fmt --check` as separate subcommands. Each subcommand invocation is independently isolatable; loud-fail at the tier level via `&&` chaining.
- Configure oxlint with 4 plugins (`react`, `jsx-a11y`, `nextjs`, `import`) and rule overrides matching the repo's actual usage patterns. Configure oxfmt with prettier-compatible options matching existing repo style.
- Delete the 4 orphaned biome user scripts (`lint`, `format`, `check`, `check:fix`) from root `package.json` `scripts`. Migrate `ci.yaml:26` from `bun run check` to `bunx vp run verify:lint`. Update root `CLAUDE.md:54` verify:lint table row text.
- Codify the atomic-tier-decoupling invariant in `verification-tier-policy` so unified-CLI rebinding (e.g., to `vp check`) is spec-prohibited. This is the umbrella's projected "atomic-tier conflation resolution."
- Preserve every existing invariant: `verify:lint` tier name unchanged, atomic-tier loud-fail message shape (`ERROR: <X>. Run: <Y>`) unchanged, `verify:compile` and `verify:types` independent and unchanged, hygiene cascade biome bindings unchanged.

**Non-Goals:**

- No hygiene cascade port. Layers A/B/C remain biome-JSON-shape-coupled (RESERVED for `migrate-hygiene-cascade-to-oxlint`).
- No `@biomejs/biome` devDep removal. Biome remains installed for the hygiene cascade.
- No `biome.json` deletion. The hygiene cascade and ad-hoc biome invocations (`bunx --bun @biomejs/biome`) consume it.
- No type-check rebinding. `verify:compile` and `verify:types` continue to use tsgo as established by `adopt-typescript-7-tsgo`.
- No unified `vp check` binding. This slice's added spec invariant prohibits it.
- No tier-script changes. `scripts/verify/lint.sh` (if present) or its task body wrapping is the only edit surface. `_preconditions.sh` `require_biome()` helper retained for hygiene tier.
- No `packages/*` or `e2e/*` source changes (other than the repo-wide oxfmt reformat that already shipped in `e5653d2`, retroactively documented).

## Decisions

**D1: Reject `vp check` unified command; bind to `vp lint` + `vp fmt` granular subcommands.**

Vite+ documents `vp check` as a unified command running lint + fmt + typecheck in one invocation. Binding `verify:lint` to `vp check` would conflate three atomic tiers (`verify:lint`, `verify:compile`, `verify:types`) into a single command surface, violating `verification-tier-policy`'s "Atomic Tier Isolation" requirement. Failure-attribution would degrade: a typecheck error surfaced via unified `vp check` could not be cleanly identified as `verify:types`-tier failure in CI logs without parsing the unified command's output, defeating the purpose of distinct atomic tiers.

This decision rejects `vp check` and binds `verify:lint` to `bunx vp lint && bunx vp fmt --check`. `vp lint` invokes oxlint; `vp fmt --check` invokes oxfmt in check-mode (non-mutating). The `&&` operator ensures either subcommand's non-zero exit short-circuits the tier; tier-level loud-fail is preserved.

`verify:compile` continues to invoke `tsgo --noEmit` (per `adopt-typescript-7-tsgo`); `verify:types` continues to invoke type-contract tests. Each tier's failure is attributable to its tier name in CI logs.

Alternative considered: bind `verify:lint` to `vp check`, then add separate `verify:typecheck-via-vp-check` synthetic tier to cover the typecheck portion. Rejected because (a) doubles the typecheck path (vp check + tsgo), (b) creates a new tier name not tracked in the Change-Type Map, (c) the unified-CLI failure-attribution problem persists.

**D2: Codify the granular-subcommand invariant as a spec-level requirement.**

The decision to reject `vp check` is load-bearing for the verification-tier-policy's atomic-tier-isolation contract. Without an explicit spec invariant, future maintainers (or future-Claude in a fresh session) may rebind to `vp check` for "simplicity," silently re-introducing the conflation. To prevent regression, this slice ADDS a `Linter and Formatter Decoupled from Type-Checker` requirement to `verification-tier-policy/spec.md`, with scenarios verifying that the linter binding is invoked as its own tier and that tier failures are individually identifiable in CI logs.

The requirement is general (applies to any future tool binding, not specifically vp check), so it survives orchestrator swaps per the umbrella's `Loud-Fail Atomic-Tier Preconditions Survive Orchestrator Swap` requirement.

**D3: Phase α / Phase β split — hygiene cascade port deferred to a separate slice.**

The hygiene cascade (Layer A/B/C deleter) is biome-JSON-shape-coupled at:

- `scripts/hygiene/delete-unused.ts` (Layer C — parses biome 2.x diagnostic JSON: `location.path: string`, `start/end {line, column}`, category prefix `lint/correctness/...`)
- `scripts/hygiene/_emit-biome-receipts.ts` (Layers A/B receipt emitter)
- `scripts/hygiene/presenter.ts:201` (drift WARN text)
- `scripts/hygiene/run.sh` (orchestrator — calls biome 4× via `bunx --bun @biomejs/biome`)
- Test suite (3 files, including `delete-unused.test.ts:74` which spawns the real biome binary as a contract test)

Porting this to oxlint requires:

1. Verifying oxlint's JSON output shape (file path + line/column + rule category + fix-info) is compatible with coordinate-based deletion.
2. Rewriting the Layer C deleter against oxlint's shape.
3. Updating Layers A/B to use `oxlint --fix` (or whatever the equivalent is).
4. Rewriting the test suite to spawn oxlint instead of biome and assert against oxlint JSON.
5. Removing `@biomejs/biome` from devDependencies.
6. Removing `biome.json`.
7. Removing `require_biome()` from `_preconditions.sh`.

This is a different blast radius than Phase α (which is read-only at the verify-tier level). Bundling Phase β into Phase α would:

- Mix two distinct change classes (verify-tier rebind + mutating-cascade rebind) under one rollback boundary.
- Make rollback non-atomic — Phase α can roll back to biome trivially, Phase β rollback would need to re-introduce the cascade's biome bindings.
- Inflate the proposal scope from a 4-edit-surface change to a 12+-edit-surface change with substantial test rewrite.

Therefore: Phase α ships now (this slice). Phase β is RESERVED as `migrate-hygiene-cascade-to-oxlint` (or similar — exact name decided when proposed). Until Phase β ships, biome remains installed and the cascade continues to invoke it. The `@biomejs/biome: 2.4.9` devDep, `biome.json`, and `require_biome()` helper all stay.

Alternative considered: ship both phases in this slice. Rejected per the blast-radius and rollback-atomicity arguments above. The capability/policy decomposition pattern (per `feedback_capability_vs_policy.md`) advises that each cutover slice should be its own follow-on, not a mega-change.

**D4: Retroactive proposal authoring is documented as a process violation, not a precedent.**

This slice's code work (commits `e5653d2 oxlint oxfmt`, `510a664 Fix`) landed before the policy artifact was authored. Per the capability/policy decomposition pattern, each cutover should ship with its policy artifact in the same change. This is documented in the proposal's Risk Acceptance as a one-time process violation. Going forward (Phase β, future vp-related cutovers): policy artifacts authored before code work lands.

The umbrella's authorization (`adopt-orchestration-architecture/proposal.md:62`) covered the slice in principle, so the work itself was not unauthorized — only the artifact ordering was inverted. Closing the governance gap retroactively is preferable to leaving it open.

**D5: Tasks.md captures retroactive [x] and pending [ ] items distinctly.**

Tasks performed in commits `e5653d2` / `510a664` are marked `[x]` retroactively in tasks.md, with a parenthetical (commit) reference for traceability. Tasks not yet performed (the 4 user-script deletions, the ci.yaml:26 redirect, the CLAUDE.md:54 doc update) are marked `[ ]` and are the work to land in the same change as this proposal.

This is similar to the pattern in `migrate-orchestrator-to-vp-run/tasks.md` (where the work landed before the task checkboxes were ticked, leaving the artifact out of sync). Phase α explicitly ticks retroactive boxes so the artifact reflects ground truth at the time of proposal authoring.

## Risks / Trade-offs

- **[oxlint rule-set divergence from biome]** → Mitigated by 4-plugin enablement (`react`, `jsx-a11y`, `nextjs`, `import`) and triage of the 16 errors that surfaced post-cutover (4 auto-fixed, 12 fix-forward). Verified: `vp lint` clean at HEAD `510a664`.

- **[oxfmt diff churn from biome formatter]** → ACCEPTED. Repo-wide reformat in `e5653d2` was substantial but reviewed before commit. Subsequent commits format cleanly under `vp fmt`. No mitigation beyond review-and-accept.

- **[Loud-fail under vp lint / vp fmt wrapping]** → Mitigated by `&&` chaining at the task body level. Falsification probe in tasks.md verifies that any subcommand failure surfaces a non-zero exit code at the `vp run verify:lint` boundary.

- **[Atomic-tier conflation re-emergence]** → Mitigated by D2 (spec invariant). Future maintainers consulting verification-tier-policy will see the prohibition explicitly.

- **[`@biomejs/biome` cannot be removed until Phase β]** → ACCEPTED tradeoff per D3. Phase α's value (user-facing oxlint+oxfmt) is independent of Phase β.

- **[Retroactive proposal pattern setting precedent]** → Mitigated by D4 (documented as one-time violation). Process correction codified for future slices.

- **[oxlint plugin set may shift across versions]** → Mitigated by `vite-plus@0.1.20` pinning (which controls the bundled oxlint version). Version bumps trigger smoke verification per the existing migration-methodology pattern.

- **[Hygiene cascade biome bindings remain in repo]** → ACCEPTED per D3. Phase β proposal (when authored) will surface this as its primary scope.

## Migration Plan

1. **Author this proposal + design + tasks + spec delta.** (This step.)
2. **Confirm retroactive [x] items in tasks.md.** Walk each task, verify against current repo state at HEAD `510a664 Fix`.
3. **Land remaining [ ] items in a single commit:**
   - Delete `lint`, `format`, `check`, `check:fix` from root `package.json` `scripts`.
   - Replace `bun run check` at `.github/workflows/ci.yaml:26` with `bunx vp run verify:lint`.
   - Update root `CLAUDE.md:54` verify:lint table row text from `biome check (linter + formatter)` to `vp lint + vp fmt --check (oxlint + oxfmt)`.
4. **Smoke verification.** `vp run verify:lint` clean. `bun run check` returns "script not found" (hard cutover semantics confirmed). `vp run verify` (composite fast-gate) green.
5. **Spec validation.** `openspec validate migrate-lint-to-vp-check --strict` clean.
6. **Maintainer review + sign Risk Acceptance.** Aaron reviews proposal, design, tasks, spec delta; signs the maintainer-signature line.
7. **Merge to `next`.** Same commit as the [ ]-item code changes. Single rollback boundary.

**Rollback path:** revert this commit. `package.json` `scripts` re-add the 4 biome wrappers. `ci.yaml:26` reverts to `bun run check`. `CLAUDE.md:54` reverts to biome text. `verification-tier-policy/spec.md` revert removes the new requirement. Spec delta directory removed. `vite.config.ts` lint+fmt blocks remain (orchestrator-slice property; Phase α doesn't touch them at this stage). Reverting the lint/fmt config requires reverting `e5653d2` separately — out of this slice's rollback boundary by design (separating proposal artifact from already-shipped code is intentional).

## Open Questions

- **Phase β scope.** Specifically: does oxlint's JSON output (`vp lint --format=json` or equivalent) contain `path`, `line`, `column`, `category` fields with semantics compatible with the Layer C deleter's coordinate-based deletion logic? PENDING empirical verification before Phase β is proposed. If oxlint JSON shape is incompatible, Phase β requires a deleter rewrite, not just a JSON-shape rebinding. If fully compatible, Phase β is a mechanical port. This question gates Phase β's effort estimation.
- **Phase β proposal name.** Tentative: `migrate-hygiene-cascade-to-oxlint`. Final name decided when Phase β is proposed. The umbrella's enumeration does not pre-name Phase β; this is one valid decomposition of the umbrella's `migrate-lint-to-vp-check` original scope.
- **`require_biome()` helper retirement.** RESOLVED — retained in this slice (consumed by hygiene tier). Removed when Phase β ships.
- **CLAUDE.md broader documentation refresh.** This slice updates only line 54 (verify:lint row). The CLAUDE.md "Key Rules" section may have additional biome references worth refreshing but Phase α scope is minimal — broader doc cleanup deferred.

## Why

The `adopt-orchestration-architecture` umbrella enumerated `migrate-lint-to-vp-check` as one of five required follow-on cutover slices to bind the repo's tooling to Vite+. The first slice (`migrate-orchestrator-to-vp-run`) shipped the task-graph rebind, leaving lint/format on biome as documented out-of-scope. This slice executes the lint/format cutover: biome → oxlint (linter) and oxfmt (formatter), surfaced through Vite+'s `vp lint` and `vp fmt` subcommands, with the `verify:lint` atomic tier rebound to `bunx vp lint && bunx vp fmt --check`.

Two additional motivations:

1. **Capability/policy decomposition pattern**: the umbrella authorized this slice in principle, but the cutover work landed in commits `e5653d2 oxlint oxfmt` and `510a664 Fix` without an accompanying openspec policy artifact. This proposal closes the governance gap retroactively — the work is already done in code; this artifact captures the design decisions, risk acceptance, and spec delta that should have preceded the cutover.

2. **Atomic-tier-isolation invariant resolution**: the umbrella's enumerated name (`migrate-lint-to-vp-check`) suggested binding to `vp check`, Vite+'s unified lint+format+typecheck command. This slice rejects that binding because `vp check` would conflate the `verify:lint` / `verify:compile` / `verify:types` atomic tiers into a single command surface, violating the `verification-tier-policy` "Atomic Tier Isolation" requirement. The slice instead binds to `vp lint` and `vp fmt` as granular subcommands, preserving each atomic tier's loud-fail isolation contract. This proposal documents that decision and adds the corresponding spec invariant.

## What Changes

- **Bind `verify:lint` task body** in `vite.config.ts` `run.tasks` to `bunx vp lint && bunx vp fmt --check`. The task body invokes oxlint via `vp lint` and oxfmt via `vp fmt --check` as separate subcommands; `vp check` (unified) is explicitly NOT used. (Already done in commit `e5653d2`.)
- **Configure oxlint** in `vite.config.ts` `lint` block: enable plugins `react`, `jsx-a11y`, `nextjs`, `import`; set `categories: { correctness: 'error', suspicious: 'error' }`; disable `react/react-in-jsx-scope` (modern React/Next App Router) and `import/no-unassigned-import` (CSS side-effect imports); declare per-fixture overrides for `**/*.test-d.{ts,tsx}` and `packages/extract/tests/fixtures/**`. (Already done.)
- **Configure oxfmt** in `vite.config.ts` `fmt` block: prettier-compatible options (`semi: true`, `singleQuote: true`, `tabWidth: 2`, `printWidth: 80`, `trailingComma: 'es5'`, `arrowParens: 'always'`, `endOfLine: 'lf'`); ignore archive markdown to keep the formatter stable across stale historical content. (Already done.)
- **Delete biome wrappers from root `package.json` `scripts`**: `lint`, `format`, `check`, `check:fix`. These are orphaned from the migrated `verify:lint` chain and represent stale invocation surfaces. (Pending — done as part of this slice.)
- **Migrate `.github/workflows/ci.yaml:26`** from `bun run check` (a biome invocation) to `bunx vp run verify:lint` to align CI with the canonical migrated tier. (Pending.)
- **Update root `CLAUDE.md:54`** verify:lint table row text from `biome check (linter + formatter)` to `vp lint + vp fmt --check (oxlint + oxfmt)`. (Pending.)
- **Retain `@biomejs/biome` devDep, `biome.json`, and `scripts/verify/_preconditions.sh:102-104` `require_biome()` helper** for the hygiene cascade. The hygiene cascade Layer A/B/C deleter is biome-JSON-shape-coupled at multiple call sites and represents a separate cutover slice (`migrate-hygiene-cascade-to-oxlint`, RESERVED — see Impact). Phase α removes only the user-facing biome surface; Phase β removes the cascade-internal biome surface and is out of scope for this proposal.
- **Update `verification-tier-policy` spec** to ADD one requirement codifying the atomic-tier decoupling invariant: linter and formatter SHALL be invokable as separate subcommands; unified surfaces (e.g., `vp check`) SHALL NOT replace the granular atomic tiers. This is the umbrella's enumerated "atomic-tier conflation resolution," now made spec-level.

This change is **NOT BREAKING for consumers** of `@animus-ui/*` packages — only repository-internal lint/format dispatch changes. It IS breaking for any developer or CI environment that invokes `bun run check`, `bun run lint`, `bun run format`, or `bun run check:fix` directly: post-cutover those entries no longer exist in `package.json`. All callers must use `bunx vp lint`, `bunx vp fmt`, or `bunx vp run verify:lint` (composite). The hygiene cascade (`bun run hygiene`) is unaffected — it continues to invoke biome via `bunx --bun @biomejs/biome` directly inside `scripts/hygiene/run.sh`.

## Capabilities

### New Capabilities

(none — this slice rebinds a tool surface and adds one invariant to an existing capability)

### Modified Capabilities

- `verification-tier-policy`: ADD `Linter and Formatter Decoupled from Type-Checker` requirement. Codifies the atomic-tier-decoupling invariant: linter, formatter, and type-checker are independently invokable atomic tiers (`verify:lint`, `verify:compile`, `verify:types`); unified CLI commands conflating these (e.g., `vp check`) SHALL NOT replace the granular tiers. This is the umbrella's projected "atomic-tier conflation resolution" made explicit. Existing requirements (Tier Naming Convention, Atomic Tier Isolation, Composite Orchestrators, Change-Type Map, etc.) are preserved unchanged.

## Impact

- **Code**: `vite.config.ts` lint + fmt blocks (already authored); root `package.json` `scripts` block (4 deletions); `.github/workflows/ci.yaml` line 26 (1-line redirect); root `CLAUDE.md` line 54 (1-row text update).
- **Dependencies**: `@biomejs/biome: 2.4.9` REMAINS in `devDependencies` (required by hygiene cascade per Phase β reservation). `vite-plus@0.1.20` already installed by the orchestrator slice. No dep additions or removals in this slice.
- **CI**: ci.yaml line 26 redirect only. No new install steps; vp install already done by orchestrator slice.
- **Out of scope** (RESERVED for separate follow-on `migrate-hygiene-cascade-to-oxlint`):
  - Layer A/B/C cascade port from biome JSON to oxlint JSON (`scripts/hygiene/delete-unused.ts`, `_emit-biome-receipts.ts`, `presenter.ts:201`)
  - `scripts/hygiene/run.sh` biome invocation removal (lines 234, 244, 247, 263, 266, 277, 279)
  - `scripts/verify/_preconditions.sh` `require_biome()` helper removal
  - `biome.json` deletion
  - `@biomejs/biome` devDep removal
  - Test rewrite in `scripts/hygiene/{delete-unused,reconcile-after-knip,presenter}.test.ts`
  - These touch the `code-hygiene` spec and represent a different blast radius (mutating cascade with load-bearing test suite) than this slice (read-only verify tier). Bundling Phase β into this slice would make rollback non-atomic.
- **Out of scope (umbrella-deferred)**: typecheck binding to `vp check` is permanently rejected by this slice's added invariant. Future slice MAY rebind type-check to a different orchestrator-native command provided it preserves the verify:compile / verify:types atomic-tier separation.
- **No `packages/*` or `e2e/*` source changes** — only repository-root infrastructure plus the spec delta.

## Risk Acceptance

Vite+ remains alpha at the time of this slice. oxlint v1.x is more battle-tested than vp's other subcommands but still less mature than biome 2.x for full-coverage repository linting. This proposal documents a cutover that has already shipped in code; risk acceptance is partially retrospective.

**Specific exposure for this slice (lint/format rebind only):**

- **oxlint rule-set divergence from biome 2.x.** oxlint and biome implement different (overlapping but not identical) lint rule sets. Some rules biome enforced may be absent from oxlint, and vice versa. Mitigation: enabling 4 oxlint plugins (`react`, `jsx-a11y`, `nextjs`, `import`) approximates biome's recommended coverage; the cutover landed with 0 lint errors after 16 errors were triaged (12 fix-forward + 4 auto-fixed). Verification: `vp lint` clean across full repo at HEAD `510a664`.
- **oxfmt formatting divergence from biome's formatter.** oxfmt is prettier-compatible; biome's formatter is biome-style. The repo-wide reformat that landed in commit `e5653d2` was substantial (>1k LOC reformatted). Mitigation: oxfmt was configured with prettier-compatible options matching the existing repo style as closely as possible (semi/singleQuote/tabWidth/printWidth/trailingComma); the diff was reviewed before commit; subsequent commits format cleanly under `vp fmt`.
- **Loud-fail message preservation under vp lint / vp fmt wrapping.** vp's task dispatch wrapping must not swallow stderr or alter exit codes from oxlint / oxfmt. Mitigation: `verify:lint` task body uses `&&` chaining so any subcommand failure surfaces a non-zero exit code at the tier level. This is the same loud-fail-via-shell pattern used by the orchestrator slice's atomic tiers; tasks.md falsification probe verifies it empirically.
- **Atomic-tier conflation re-emergence risk.** Future maintainers (or future-Claude in a fresh session) may be tempted to rebind `verify:lint` to `vp check` (unified) for "simplicity." Mitigation: the new spec requirement codifies the prohibition and the rationale. The granular subcommand binding is now spec-protected.
- **Phase β unblocking dependency.** `@biomejs/biome` cannot be removed from devDependencies until Phase β ships. Phase β is non-trivial (Layer C deleter is biome-2.x-JSON-shape-coupled). Mitigation: Phase α's value (user-facing oxlint+oxfmt) is independent of Phase β; Phase α ships now, Phase β proposed separately when oxlint JSON shape is verified compatible with coordinate-based deletion.
- **Retroactive proposal authoring.** This proposal documents a cutover that has already shipped in code (commits `e5653d2`, `510a664`). The capability/policy decomposition pattern (per `feedback_capability_vs_policy.md` memory) prescribes that each cutover should ship with its policy artifact in the same change. This slice violated that ordering. Mitigation: the artifact is being authored before any further cutover work proceeds; the umbrella's authorization (in `adopt-orchestration-architecture/proposal.md:62`) still covered the slice in principle. Process correction: future cutover slices will author their policy artifact before code work lands.

**Maintainer signature**: Aaron (sole repo author / sole maintainer) accepts the alpha-status and rule-divergence exposure described above for this specific slice. Acceptance is scoped to the lint/format rebind only — does NOT extend to Phase β (hygiene cascade port) or any other future vp-related cutover (each requires its own risk acceptance per follow-on change).

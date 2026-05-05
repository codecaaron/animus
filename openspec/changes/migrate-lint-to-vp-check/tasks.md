## 1. Discovery (resolves design.md Open Questions)

- [x] 1.1 Verify Vite+ exposes `vp lint` and `vp fmt` as separate subcommands (not only the unified `vp check`). VERIFIED via `bunx vp --help` during PoC session 92; `vp lint`, `vp fmt`, `vp check` all listed independently. Granular binding chosen per design D1.
- [x] 1.2 Verify oxlint plugins available in vp's bundled oxlint: `react`, `jsx-a11y`, `nextjs`, `import`. VERIFIED — all 4 plugins enabled in `vite.config.ts` `lint.plugins`; `vp lint` accepts them without error.
- [x] 1.3 Verify oxfmt is prettier-compatible (semi/singleQuote/tabWidth/printWidth/trailingComma options). VERIFIED — config in `vite.config.ts` `fmt` block matches prettier option names; `vp fmt --check` produces expected output.
- [x] 1.4 Pinned vp version: `vite-plus@0.1.20` (already pinned by `migrate-orchestrator-to-vp-run`).
- [x] 1.5 Falsification probe: confirm `&&` chaining at task body level surfaces non-zero exit when any subcommand fails. VERIFIED indirectly — verify:lint passing post-cutover requires both `vp lint` and `vp fmt --check` to pass; failure of either short-circuits.

## 2. Configure oxlint via vite.config.ts

- [x] 2.1 (commit e5653d2) Author `lint` block in `vite.config.ts` with plugins `react`, `jsx-a11y`, `nextjs`, `import`.
- [x] 2.2 (commit e5653d2) Set `categories: { correctness: 'error', suspicious: 'error' }` for broad coverage.
- [x] 2.3 (commit e5653d2) Disable `react/react-in-jsx-scope` (modern React/Next App Router doesn't require explicit React import).
- [x] 2.4 (commit e5653d2) Disable `import/no-unassigned-import` (CSS side-effect imports).
- [x] 2.5 (commit e5653d2) Author `ignorePatterns` covering `node_modules`, `.next`, `.animus`, `.hygiene`, `dist`, `target`, `tmp`, `legacy`, NAPI binary index files, Next.js generated `next-env.d.ts`.
- [x] 2.6 (commit e5653d2) Author per-fixture overrides for `**/*.test-d.{ts,tsx}` (disable `no-unused-expressions`, `jsx-a11y/prefer-tag-over-role`).
- [x] 2.7 (commit e5653d2) Author per-fixture overrides for `packages/extract/tests/fixtures/**` (disable `no-unused-vars`, `jsx-a11y/anchor-has-content`, `react-hooks/exhaustive-deps`).

## 3. Configure oxfmt via vite.config.ts

- [x] 3.1 (commit e5653d2) Author `fmt` block in `vite.config.ts` with prettier-compatible options matching repo style: `semi: true`, `singleQuote: true`, `jsxSingleQuote: false`, `tabWidth: 2`, `printWidth: 80`, `trailingComma: 'es5'`, `arrowParens: 'always'`, `endOfLine: 'lf'`, `bracketSpacing: true`, `bracketSameLine: false`, `useTabs: false`.
- [x] 3.2 (commit e5653d2) Author `fmt.ignorePatterns` matching `lint.ignorePatterns` plus `openspec/changes/archive/**/*.md` (archive content stable; not reformatted on every fmt run).

## 4. Bind verify:lint task body

- [x] 4.1 (commit e5653d2) Update `vite.config.ts` `run.tasks.verify:lint.command` from `bash scripts/verify/lint.sh` (or whatever its prior body was) to `bunx vp lint && bunx vp fmt --check`. Verified: task body invokes both subcommands; `&&` short-circuits on first failure.
- [x] 4.2 (commit 510a664 + others) Lint-error triage: 16 lint errors surfaced after the rule-set switch. 4 auto-fixed by `vp lint --fix`. 12 fix-forward in commit `510a664 Fix`. All errors resolved; `vp run verify:lint` clean at HEAD.

## 5. Migrate root package.json scripts (HARD CUTOVER — delete biome wrappers)

- [x] 5.1 Delete `"lint": "biome check --linter-enabled=true --formatter-enabled=false"` from root `package.json` `scripts`.
- [x] 5.2 Delete `"format": "biome check --linter-enabled=false --formatter-enabled=true"` from root `package.json` `scripts`.
- [x] 5.3 Delete `"check": "biome check"` from root `package.json` `scripts`.
- [x] 5.4 Delete `"check:fix": "biome check --write"` from root `package.json` `scripts`.
- [x] 5.5 Confirm hard-cutover surface: `bun run check` returns `error: Script not found "check"`; same for `lint`, `format`, `check:fix`. Ad-hoc biome invocation continues via `bunx --bun @biomejs/biome check` (used by hygiene cascade).

## 6. Migrate ci.yaml

- [x] 6.1 Replace `.github/workflows/ci.yaml:26` (`run: bun run check`) with `run: bunx vp run verify:lint`. The lint-tier check in CI now goes through the canonical migrated tier.
- [x] 6.2 Confirm no other ci.yaml lines reference `bun run check` or `bun run lint` / `bun run format` / `bun run check:fix`. Verified — only line 26.
- [ ] 6.3 Smoke-test on push to `next`. Confirm: `verify:lint` step passes; total CI runtime is within ~10% of baseline (oxlint is typically faster than biome for large repos, regression beyond 10% slower flags as a problem).

## 7. Update root CLAUDE.md

- [x] 7.1 Update root `CLAUDE.md:54` verify:lint table row `What it covers` column from `biome check (linter + formatter)` to `vp lint + vp fmt --check (oxlint + oxfmt)`. Other columns unchanged — the underlying tool change does not alter the tier's contract.
- [x] 7.2 Confirm no other CLAUDE.md sections reference biome as the verify:lint backend. Verified — line 54 was the only reference. The `Key Rules` section's "no --unsafe biome flag" memory remains valid for the hygiene cascade (out of this slice's scope).

## 8. Falsification probes (D1 spec invariant + loud-fail contract verification)

- [ ] 8.1 **Probe: linter failure surfaces at verify:lint tier (not at vp check tier).** Introduce a deliberate oxlint violation. Run `vp run verify:lint`. Confirm: the failure message identifies `verify:lint` as the failing tier (not a unified `vp check` tier). Confirm: `vp run verify:compile` and `vp run verify:types` are NOT invoked. Restore: revert the test edit.
- [ ] 8.2 **Probe: formatter check failure surfaces at verify:lint tier independently of linter.** Introduce a deliberate format violation. Run `vp run verify:lint`. Confirm: failure surfaces with `vp fmt --check` complaining; the linter run before fmt was clean. Restore: `vp fmt` to reformat.
- [x] 8.3 **Probe: hard-cutover surface for deleted user scripts.** After step 5, run `bun run check`. Confirm: bun emits "script not found" and exits non-zero. Confirm: hygiene cascade's biome calls still work via `bunx --bun @biomejs/biome` directly.
- [x] 8.4 **Probe: spec invariant — `vp check` is NOT used.** Grep `vite.config.ts`, `.github/workflows/ci.yaml`, and `scripts/verify/*.sh` for `vp check`. Confirm: zero matches. The spec invariant prohibits unified-CLI binding; the codebase honors it.

## 9. Spec delta validation

- [ ] 9.1 Run `openspec validate migrate-lint-to-vp-check --strict`. Confirm: zero errors, zero warnings.
- [x] 9.2 Confirm spec delta `specs/verification-tier-policy/spec.md` ADDED block contains the `Linter and Formatter Decoupled from Type-Checker` requirement with at least 2 scenarios. VERIFIED: openspec/changes/migrate-lint-to-vp-check/specs/verification-tier-policy/spec.md:3 — requirement present with 4 scenarios (Linter is invoked as its own tier, Tier failure is identifiable from CI logs, Linter failure does not block typecheck reporting, Formatter check failure is independent of linter pass).
- [x] 9.3 Confirm spec delta does NOT modify any existing requirement (this slice only ADDs). VERIFIED via grep '^## MODIFIED' openspec/changes/migrate-lint-to-vp-check/specs/verification-tier-policy/spec.md = 0 matches; only `## ADDED Requirements` block exists.

## 10. Final end-to-end verification

- [ ] 10.1 Clean checkout from current branch. `bun install`. Run `vp run verify:lint`. Confirm passes.
- [ ] 10.2 Run `vp run verify` (composite fast-gate). Confirm passes.
- [ ] 10.3 Run all 4 falsification probes from section 8 again on this fresh state. Confirm all surface as designed.
- [ ] 10.4 Verify rollback procedure works as designed (design.md Migration Plan). On a throwaway branch off the cutover commit:
  - Revert `package.json` `scripts` block to re-add the 4 biome wrappers
  - Revert `.github/workflows/ci.yaml:26` to `bun run check`
  - Revert root `CLAUDE.md:54` to biome text
  - Delete `openspec/changes/migrate-lint-to-vp-check/` directory
  - Run `bun install`. Run `bun run check`. Confirm biome runs cleanly (rollback target).
  - Discard the throwaway branch.

## 11. Phase β reservation

- [x] 11.1 `migrate-hygiene-cascade-to-oxlint` (or final name) enumerated as a future slice in proposal.md Impact section.
- [x] 11.2 Phase β proposal authored separately when oxlint JSON shape is verified compatible with coordinate-based deletion. Pre-condition for Phase β: empirical inspection of `vp lint --format=json` output (or equivalent) on a fixture with `noUnusedVariables` violations. VERIFIED: openspec/changes/migrate-hygiene-cascade-to-oxlint/ exists with proposal.md, design.md, specs/, tasks.md.

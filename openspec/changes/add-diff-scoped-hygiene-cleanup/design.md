## Context

The Animus hygiene stack has detection but no removal. `verify:lint` (biome) reports unused imports/vars per-file. `verify:hygiene:ts` (fallow) reports unused files, exports, dependencies, and duplicates across the module graph. Both are strictly read-only — running them never mutates the tree, which is load-bearing for authorial trust in the verify-tier contract.

Session-88 calibration empirically reduced fallow's finding count from 157 → 0 via a mix of `.fallowrc.json` entries/ignores plus 3 real source deletions. That workflow was manual: investigate, delete, re-run, repeat. It worked once, but doesn't scale to per-PR authoring, where authors need to close hygiene loops inside their diff rather than batching quarterly grooming waves.

Cross-file cleanup is also inherently iterative. Removing an unused export may orphan its only import, which in turn leaves another export unreferenced, and so on. Single-pass tools stop after one sweep. Fixed-point convergence requires external orchestration.

Fallow supports diff-scoped detection (`--changed-since <ref>`, `--file <path>`) and auto-fix (`fix --yes`), but does not cascade. Biome's `noUnusedImports` + `noUnusedVariables` + `noUnusedPrivateClassMembers` are auto-fixable per-file. Stitching them together into a diff-scoped cascade is the work.

## Goals / Non-Goals

**Goals:**
- Give authors a single command to close hygiene on their diff before pushing.
- Converge cross-file cascades (unused-export → orphaned import → orphaned export → ...) to fixed point.
- Keep blast radius bounded to the diff — files outside the diff are never touched.
- Make the surface safe-by-default (dry-run) with an explicit opt-in to mutate.
- Preserve the read-only contract on `verify:*` tiers; cleanup is a separable mutating surface.
- Fail loud and legibly on missing tools, non-convergence, or safety-envelope failure.

**Non-Goals:**
- CI wiring, pre-commit hook registration, cron automation. Those are policy changes on top of this capability.
- Auto-revert on safety-envelope failure. The author must see the cleanup's actual diff before deciding.
- Full-repo cleanup mode. Diff scope is the only scope.
- Handling non-TS/JS file types (MDX, CSS, Rust). Fallow doesn't parse them meaningfully; out of scope for this capability.
- Fallow-runtime paid-tier integration. Free static layer only.
- Replacing `verify:lint` or `verify:hygiene:ts`. Both remain as-is; cleanup orchestrates the same tools.

## Decisions

### D1. Mutating surface is separate from verify tiers

**Decision**: Cleanup lives at `scripts/hygiene/cleanup-diff.sh` + `hygiene:{preview,apply}` npm scripts. Not composed into any `verify:*` orchestrator.

**Rationale**: The `verify:*` read-only contract lets authors/agents run any tier without side effects. Mixing mutation into that surface erodes the contract's usefulness. Separating cleanup into its own script directory (`scripts/hygiene/`) mirrors `scripts/verify/` structurally while signaling the different safety class.

**Alternatives considered**:
- Expose via a `verify:hygiene:ts --fix` flag. Rejected — flag-coupling a mutating mode inside a read-only tier invites accidents.
- Make cleanup a mandatory pre-commit hook. Rejected — hook wiring is policy, not capability.

### D2. Bash orchestration (not TS/bun)

**Decision**: `scripts/hygiene/cleanup-diff.sh` is a bash script, parallel to the `scripts/verify/*.sh` family.

**Rationale**: Existing convention in this repo. No TS build dependency for the orchestrator itself (it just shells out to biome + fallow + filesystem ops). Aligns with `require_*` preconditions pattern already established in `scripts/verify/_preconditions.sh`.

**Alternatives considered**:
- TS script run via `bun`. Rejected — adds build/runtime cost without capability gain; the orchestrator is mostly subprocess-invocation + file-path filtering, which bash handles natively.

### D3. Layer 1 primitive selection is empirical

**Decision**: Default to `biome check --write` for intra-file dec-stripping. Treat `webpro-nl/remove-unused-vars` as a fallback only if biome empirically misses a category that matters for Animus. Spec does not commit to either.

**Rationale**: Biome already ships with `noUnusedImports`, `noUnusedVariables`, `noUnusedPrivateClassMembers` as auto-fixable rules. Introducing a second tool before empirically finding a gap is speculative work. The spec codifies the interface (layer 1 must strip unused intra-file decls); implementation picks the primitive.

**Alternatives considered**:
- Mandate `webpro-nl/remove-unused-vars` up front. Rejected — no evidence that biome is insufficient; introduces a dev dep without demonstrated value.
- Mandate biome-only. Rejected — forecloses an escape hatch before measuring.

### D4. Dry-run is the default

**Decision**: Script is non-mutating unless `--apply` is passed. `hygiene:preview` invokes default mode; `hygiene:apply` passes `--apply`.

**Rationale**: Destructive defaults accrue incidents. The explicit-apply form keeps the first-time user from accidentally rewriting their tree. Agent use (non-TTY) matches this without prompt-confirmation flows.

**Alternatives considered**:
- Apply by default with TTY confirmation. Rejected — non-TTY agent invocation can't prompt. Hardcoding TTY branches creates divergent paths for human vs agent callers.

### D5. Safety envelope but no auto-revert

**Decision**: On `--apply`, after the cascade converges, run `verify:compile` + `verify:lint`. If either fails, report the failure with exit nonzero. Do NOT auto-revert the cleanup.

**Rationale**: Auto-revert hides signal. If cleanup produces a broken tree, the author should see the actual broken diff — either to understand why (a bug in one of the layers) or to manually partial-revert. Auto-revert would erase the evidence of what went wrong. Git's own mutation history (pre-cleanup commit) is the real rollback surface; the script is always preceded by a committed state.

**Alternatives considered**:
- Auto-revert to pre-cleanup state. Rejected for signal-erasure reason above.
- Stash pre-cleanup + restore on failure. Rejected as same-class incident-masking with extra complexity.

### D6. Cascade iteration cap at 5

**Decision**: Outer loop iterates until zero changes, capped at `MAX_ITERATIONS=5`. Hitting the cap fails loud.

**Rationale**: Observed fallow cascades typically converge in 2-3 passes. Cap at 5 is defensive against pathological inputs (circular export chains, mutation interactions between biome + fallow). Unbounded loops can infinite-hang on tool bugs.

**Alternatives considered**:
- Unbounded with manual ^C. Rejected — silent hang fails worse than loud cap.
- Cap at 10. Considered, but 5 matches observed convergence comfortably; raising is cheap if empirical need arises.

### D7. Base ref defaults to `main`, override via flag/env

**Decision**: Default `BASE_REF=main`. Override via `--base <ref>` CLI flag or `HYGIENE_BASE_REF` env var.

**Rationale**: Matches `fallow --changed-since main` convention in the skill docs. Env var form lets CI or wrapper scripts set it once.

### D8. Scope filter is `.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`

**Decision**: After `git diff --name-only`, filter to those extensions. Everything else (including `.mdx`, `.css`, `.json`, `.rs`, `.toml`) passes through untouched.

**Rationale**: Biome and fallow operate on TS/JS. MDX is handled by `ignorePatterns` in fallow config, not auto-fixable. CSS/Rust/config files have different hygiene concerns outside this capability.

### D9. No new binary dependencies required

**Decision**: Capability install requires ONLY binaries already present (biome, fallow). `webpro-nl/remove-unused-vars` is an optional escape hatch, added only if Layer 1 primitive empirically needs it.

**Rationale**: Minimal adoption cost. Aligns with "capability vs policy" discipline — installing new dev deps mid-capability-install conflates the surface.

## Risks / Trade-offs

- [**Layer 3 empty-file false positive**] A file with only side-effect-only imports (e.g., `import './polyfill';`) or a declare-module block may look empty by naive content scan, but carries semantic weight.
  → Mitigation: Layer 3 detection MUST use AST parsing, not regex. Specifically: "empty" means parse AST has zero top-level declarations AND zero side-effect import statements AND zero `declare module` / ambient blocks.

- [**Biome's `noUnusedImports` removing side-effect imports**] If biome incorrectly strips `import './polyfill'` as unused, Layer 1 breaks production behavior.
  → Mitigation: biome's default `noUnusedImports` preserves side-effect imports (imports with no bound name). Empirically verify during implementation on an intentional side-effect-import fixture. If gap exists, use `biome check --write` with targeted rule config or swap Layer 1 primitive.

- [**Fallow fix cascade assumption**] Spec assumes `fallow fix` is single-pass. If fallow's behavior is actually multi-pass cascade internally, Layer 2 could double-sweep.
  → Mitigation: verify during implementation via small fixture with known chain (A → B → C unused). Adjust cascade math if fallow already cascades. Either way, outer loop terminates on zero-change, so incorrect assumption is self-healing cost-wise.

- [**Cleanup across workspace boundaries**] An unused export in `packages/foo/src/` may be consumed via package.json `exports` by `packages/bar/` — fallow's cross-package graph should catch this, but if `publicPackages` is misconfigured the cleanup could delete a real cross-package export.
  → Mitigation: rely on `.fallowrc.json` `publicPackages: ["@animus-ui/*"]` already set via prior calibration. Safety envelope catches any resulting compile break.

- [**Bash portability**] macOS bash 3.2 vs Linux bash 5.x. Avoid bash-4-only constructs.
  → Mitigation: stick to POSIX-compatible constructs; test on macOS + Linux CI.

- [**Concurrent invocation**] Two authors running `hygiene:apply` against the same branch simultaneously could corrupt state.
  → Mitigation: single-author-per-branch is an existing git norm. Document the constraint; no lockfile needed.

- [**Layer 1/2 ordering correctness**] If Layer 2 runs before Layer 1, fallow may not see the "newly-unused" exports that Layer 1 would expose.
  → Mitigation: spec mandates Layer 1 → 2 → 3 ordering per iteration. Layer ordering is part of the requirement set, not an implementation detail.

## Open Questions

- Is `fallow fix --file <path>` actually file-scoped for dep-removal, or does it still modify `package.json` (project-scoped)? Needs probe during implementation. If project-scoped, empty-file deletion must account for `package.json` possibly changing outside the diff scope (documented side effect).
- Should `--apply` also auto-stage the resulting changes (`git add`)? Current spec says no — author reviews, stages explicitly. Could revisit if friction observed.
- Is there value in a `--verify-only` mode that runs the safety envelope against a pre-cleanup dry-run diff? Deferred as YAGNI unless authors request.

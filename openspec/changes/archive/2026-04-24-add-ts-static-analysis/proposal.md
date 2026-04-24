> **SUPERSEDED by add-code-hygiene-protocol — not implemented.** See `openspec/changes/add-code-hygiene-protocol/` for the authoritative design.

## Why

The Animus TS surface (10 workspace packages, thousands of TS/TSX files) has no cross-module dead-code, duplicate-export, circular-dependency, or architecture-boundary detection capability today. `verify:lint` uses Biome which is per-file only; the one-way dependency topology (`packages/* ← e2e/*`, no imports of `legacy/*`) is documented in root `CLAUDE.md` but has no mechanical enforcement surface — the doc itself flags a future CI grep/lint rule as a gap.

`fallow-rs` is a stable-rust static analyzer whose capability surface (verified from README) covers every static-analysis concern the repo would want to apply: 13 dead-code subclasses, duplicate-code detection, complexity/health metrics, an architecture-boundaries mechanism, an audit orchestrator with verdict semantics, and native baseline + regression-ratchet support for staged enforcement. It ships 90 framework plugins including Vite, Rolldown, Tsdown, Next.js, and Vitest, and produces SARIF + PR-annotation output for GitHub CI.

This change installs that capability surface — the tier, the helper, the config file location, the baseline directory convention, the CI job, and the Change-Type Map registration. **It does NOT set policy.** Specific rule severities, threshold values, boundary rules, workspace scopes, suppression entries, baseline commit decisions, fast-gate inclusion, output formats on CI — all are deferred to separate policy changes. Once this capability is in place, each policy decision is a small, reviewable change on its own.

This change is the symmetric TS counterpart to `add-rust-dep-hygiene`. Together they establish the `verify:hygiene:*` tier family; each sibling installs a hygiene capability without prescribing its policy.

## What Changes

- **New atomic tier `verify:hygiene:ts`**: new script `scripts/verify/hygiene-ts.sh` that sources `_preconditions.sh`, calls new helper `require_fallow_binary`, and invokes `fallow audit`. Specific flag choices are deferred.
- **Extend helper library**: add `require_fallow_binary` to `scripts/verify/_preconditions.sh` following the existing `require_*` contract.
- **New config file `.fallowrc.json`** at repo root with a minimal, syntactically-valid shape: `$schema` pointer plus empty/default values for every key fallow natively supports (`entry`, `workspaces`, `ignorePatterns`, `ignoreDependencies`, `ignoreExports`, `rules`, `health`, `boundaries`, `audit`). The file's existence is the capability; population is policy.
- **New baseline directory `.fallow/`** at repo root as the convention location for baseline files. Whether specific baselines are generated and committed is a policy decision.
- **Reserve rationale registry location** at `.fallow/SUPPRESSIONS.md`. Whether entries must appear there is a policy decision; this change establishes the location.
- **CI job `hygiene-ts`**: parallel with existing CI jobs. Uses `fallow-rs/fallow@v2` GH Action with default invocation. Specific output formats, SARIF/annotations integration, and `--changed-since` scoping are policy decisions set by follow-on changes.
- **`verify:ci` composite orchestrator** updated to mirror the new CI job. The `verify` fast-gate composition is NOT modified (fast-gate membership is a policy decision).
- **Dev script namespace reservation**: root `package.json` gains a `fallow:*` script (at minimum `fallow:audit`). Specific additional `fallow:*` scripts are policy.
- **Root CLAUDE.md updates**: add `verify:hygiene:ts` row to Verification Tiers table; add Change-Type Map row for `.fallowrc.json` / `.fallow/**`; cross-reference the new `ts-static-analysis` spec. Existing TS-source Change-Type Map rows are NOT modified (policy decision).
- **Explicitly NOT included**: all policy decisions — rule severities, `boundaries` custom rules (including the topology codification), workspace list contents, ignorePatterns contents, initial suppression entries, health threshold values, baseline commit decisions, specific `--changed-since`/SARIF/annotations CI flag choices, fast-gate inclusion of the new tier, augmentation of existing Change-Type Map rows, custom MDX plugin, Phase-2/3 activation mechanics.

## Capabilities

### New Capabilities

- `ts-static-analysis`: the fallow capability surface — tool binding, config key surface, suppression mechanisms, workspace/boundary/dead-code/dupes/health/audit/baseline mechanisms, MDX gap acknowledgment, CI integration surface, dev script namespace. Mechanism only; policy is deferred.

### Modified Capabilities

- `verification-tier-policy`: register `verify:hygiene:ts` as an atomic tier with its tool precondition; extend the Shared Precondition Helper Library with `require_fallow_binary`; extend the Change-Type Map with a row for `.fallowrc.json` / `.fallow/**`; extend `verify:ci` CI-Simulation Semantics to mirror the new CI job. The Composite Orchestrators requirement (which defines `verify` fast-gate composition) is NOT modified — that's a policy decision.

## Impact

- **Code**:
  - New: `scripts/verify/hygiene-ts.sh`
  - New: `.fallowrc.json` at repo root (minimal shape)
  - New: `.fallow/` directory with placeholder
  - Modified: `scripts/verify/_preconditions.sh` (add `require_fallow_binary`)
  - Modified: `package.json` (register `verify:hygiene:ts` script, reserve `fallow:*` namespace, update `verify:ci` composition)
  - Modified: `.github/workflows/ci.yaml` (new `hygiene-ts` job)
  - Modified: root `CLAUDE.md` (tier table row + change-type map row + cross-reference note)
- **APIs**: None. Internal tooling only.
- **Dependencies**: adds `fallow` as a dev-time CLI tool (CI via `fallow-rs/fallow@v2` Action, local install documented in the helper's error message).
- **Release surface**: zero.
- **Developer experience**: a new atomic tier exists and can be run on demand (`bun run verify:hygiene:ts`). CI gains a new standalone parallel gate. Outcome semantics (what fails the tier, what does not) depend on follow-on policy changes; at this capability install, the tier will invoke fallow with default configuration.

## Follow-on policy changes (NOT in scope here)

To be proposed separately, each addressing one policy dimension:

- `apply-ts-workspace-scoping`: populate `workspaces` / `ignorePatterns` values in `.fallowrc.json`
- `apply-ts-boundary-rules`: codify the one-way dependency topology as custom `boundaries` rules
- `apply-ts-rule-severity`: set per-subclass severity in `rules`
- `apply-ts-health-thresholds`: set initial `health.max*` threshold values
- `apply-ts-suppression-rationale`: require rationale entries in `.fallow/SUPPRESSIONS.md` for config-level suppressions
- `apply-ts-mdx-suppressions`: populate `ignoreExports` (or JSDoc annotations) for MDX-only-consumed components
- `apply-ts-baseline-commit`: decide whether baselines are committed, regenerated on what cadence, and at what tolerance
- `apply-ts-ci-output-formats`: wire SARIF + annotations flags, `--changed-since` scoping, Code Scanning upload
- `apply-ts-fast-gate-inclusion`: add `verify:hygiene:ts` to the `verify` composition (conditional on measured runtime)
- `apply-ts-changetype-map-augmentation`: augment existing TS-source rows to include `verify:hygiene:ts`
- `fix-fallow-mdx-trace`: investigate writing a custom fallow plugin for `.mdx` imports
- `enforce-ts-static-analysis`: when baselines are empty, retire them and flip all rules to full severity (Phase 3)

These are enumerated so reviewers can see the expected policy landscape this capability is designed to support.

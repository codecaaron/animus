## 1. Precondition Helper Extension

- [ ] 1.1 Add `require_fallow_binary` function to `scripts/verify/_preconditions.sh` following the existing `require_*` pattern: `command -v fallow >/dev/null 2>&1` check, on failure emit `ERROR: fallow missing. Run: bun install -g fallow` to stderr and exit 1. The install command SHALL use `bun` (not `npm`) per root `CLAUDE.md` § MANDATORY RULES — the repo is bun-only.
- [ ] 1.2 Before the task group is marked done, run `bun install -g fallow` (or whatever fallow's actual bun-compatible recipe is) once locally and verify the binary resolves. If bun global install does not ship fallow, record the verified alternative install command (e.g., `cargo install fallow` if it's a Rust crate on crates.io) and use that in the helper's error message.
- [ ] 1.3 Confirm the helper remains `set -euo pipefail`-compatible.

## 2. Hygiene Tier Script

- [ ] 2.1 Create `scripts/verify/hygiene-ts.sh` with `#!/usr/bin/env bash` + `set -euo pipefail`, compute `ROOT` the same way the other tier scripts do, source `_preconditions.sh`, call `require_fallow_binary`, then `cd "$ROOT" && exec fallow audit`. (The specific `--base <ref>` and format flags are policy; leave the invocation bare so a follow-on policy change configures it via either command-line defaults or env-vars.)
- [ ] 2.2 `chmod +x scripts/verify/hygiene-ts.sh`.

## 3. Config Scaffold

- [ ] 3.1 Create `.fallowrc.json` at the repository root with a minimal, syntactically-valid shape: `$schema` pointer (if fallow publishes one — otherwise omit), empty `entry`, empty `workspaces`, `ignorePatterns: ["legacy/**"]` (the one topology-invariant exclusion required by the spec's Workspace Scoping Mechanism requirement), empty `ignoreDependencies`, empty-object `ignoreExports`, empty-object `rules`, empty-object `health`, empty-object `boundaries`, `audit` block pointing at `.fallow/*-baseline.json` paths.
- [ ] 3.2 Run `fallow` once against the scaffolded config to confirm it parses without error AND verifies that `legacy/**` is honored (no findings produced against `legacy/*`). The tier may otherwise produce findings — that is expected and is addressed by follow-on policy changes.
- [ ] 3.3 Create empty `.fallow/` directory; add a `.gitkeep` or README placeholder so the directory exists in the repo.

## 4. Package Script Registration

- [ ] 4.1 Add `"verify:hygiene:ts": "bash scripts/verify/hygiene-ts.sh"` to the `scripts` block of root `package.json`, positioned adjacent to `verify:hygiene:rust` for readability.
- [ ] 4.2 Reserve the `fallow:*` namespace by adding at least one script that exists as the namespace marker: `"fallow:audit": "fallow audit"`. Additional dev-only scripts (`fallow:fix`, `fallow:watch`, `fallow:baseline`) MAY be added here or by follow-on policy changes — both paths are valid capability-level since the namespace is now reserved.
- [ ] 4.3 Update the `verify:ci` composite orchestrator to invoke `verify:hygiene:ts` in the CI-mirroring sequence (since CI gains a `hygiene-ts` job in group 5). Do NOT modify the `verify` fast-gate composition — whether to include `verify:hygiene:ts` in the fast-gate is a separate policy decision.

## 5. CI Workflow Wiring

- [ ] 5.1 **Supply-chain validation (gate before wiring):** verify the fallow CI invocation mechanism actually exists. Run `gh api repos/fallow-rs/fallow` (or equivalent) to confirm the repository, maintainer identity, and latest released version. If fallow publishes an official GitHub Action, confirm its identity. If not, determine the correct bare-`fallow`-CLI invocation recipe for CI. Do NOT proceed until this is verified — the entire capability install is a no-op if the Action name or CLI distribution was misidentified.
- [ ] 5.2 Add new `hygiene-ts` job to `.github/workflows/ci.yaml`, positioned as a standalone parallel gate with `lint` / `test-rust` / `build-extract`.
- [ ] 5.3 Use the verified invocation mechanism from task 5.1 with a pinned tool version. Record the pin in a workflow step comment.
- [ ] 5.4 Pass the minimum flags required for the job to invoke fallow and report a result. Specific output-format choices (SARIF, annotations, JSON), `--changed-since` ref selection, and PR-vs-push scoping are policy — default invocation is acceptable for capability install.
- [ ] 5.5 Verify the `verify` job's `needs:` list does NOT include `hygiene-ts` (standalone parallel gate).
- [ ] 5.6 Push a CI preview branch; confirm `hygiene-ts` job runs parallel, executes fallow against the repo, and reports a result. Expected posture: **tier exists + job runs to completion without crashing.** The pass/warn/fail verdict depends on policy changes not yet landed — that is the intended capability-install state. Document the first-run verdict in the PR description so reviewers see it.

## 6. Root CLAUDE.md Updates

- [ ] 6.1 Add a new row to the Verification Tiers → Atomic Tiers table: `| bun run verify:hygiene:ts | fallow audit on TS surface | fallow binary on PATH | fallow audit returns fail verdict (or fallow missing) | TBD |`. The runtime cell value is left TBD since it depends on policy-driven config.
- [ ] 6.2 Add a new Change-Type Map row: `| .fallowrc.json, .fallow/** | verify:hygiene:ts |`. Place it adjacent to the `packages/extract/Cargo.toml` row established by the Rust-hygiene change.
- [ ] 6.3 Add a cross-reference note in the Verification Tiers section: "See `openspec/specs/ts-static-analysis/spec.md` for the authoritative fallow capability surface. Policy-level decisions (rule severities, boundary rules, suppression entries, threshold values, baseline commits) are set by separate policy changes."
- [ ] 6.4 Do NOT modify existing TS-source Change-Type Map rows to include `verify:hygiene:ts`. That's a policy decision set by a separate change.
- [ ] 6.5 Confirm no CLAUDE.md-level duplication of the tier table leaks into per-package CLAUDE.md files.

## 7. Validation

- [ ] 7.1 Run `openspec validate add-ts-static-analysis --strict` and confirm clean.
- [ ] 7.2 Run `bun run verify:hygiene:ts` locally; confirm it invokes fallow without crashing (outcome pass/fail is expected to be policy-dependent, not validated here).
- [ ] 7.3 Induce a tool-missing failure: on a machine without `fallow`, or by renaming the binary / overriding PATH, run `bash scripts/verify/hygiene-ts.sh`, confirm the exact error message matching "ERROR: fallow missing. Run: <install-command>" and exit 1.
- [ ] 7.4 Confirm the Change-Type Map row for `.fallowrc.json` resolves to the expected tier (`verify:hygiene:ts`).
- [ ] 7.5 Confirm `fallow` parses `.fallowrc.json` without schema errors and recognizes all enumerated config keys (even if values are empty).
- [ ] 7.6 Confirm the CI preview run completes: `hygiene-ts` job runs to completion, emits output.

## 8. Cross-Change Alignment with add-rust-dep-hygiene

- [ ] 8.1 **Bidirectional MODIFIED re-sync.** Both changes MODIFY the same four requirements in `verification-tier-policy` (Atomic Tier Isolation, Shared Precondition Helper Library, Change-Type Map, `verify:ci` CI-Simulation Semantics). OpenSpec MODIFIED semantics replace the full block. Before this change archives, confirm `add-rust-dep-hygiene`'s archive state (or lack thereof) and re-sync this change's MODIFIED blocks to preserve ALL prior content: (a) if Rust archived first, this change's MODIFIED blocks must contain both `verify:hygiene:rust` AND `verify:hygiene:ts` additions; (b) if this change archives first, add-rust-dep-hygiene's MODIFIED blocks must be updated before its own archive to preserve the ts additions. Either direction is valid; both must be guarded.
- [ ] 8.2 Confirm the `_preconditions.sh` helper additions from both changes do not conflict (different function names: `require_cargo_machete` vs `require_fallow_binary`).
- [ ] 8.3 Confirm the shared `verify:ci` orchestrator places both hygiene tiers adjacent in the CI-mirroring order.
- [ ] 8.4 Confirm the Change-Type Map contains both the `Cargo.toml` row (at its capability-only value `verify:hygiene:rust`) and the `.fallowrc.json` / `.fallow/**` row adjacent to each other. Do NOT augment the Cargo.toml row in this change — augmentation is a policy decision deferred to `apply-rust-hygiene-changetype-augmentation`.

## 9. First-Run Expectation Documentation

- [ ] 9.1 Document in the PR description (and optionally in `design.md`) that fallow's first-run output against the capability-install state is expected to contain noise from unreachable framework-plugin entry points. Specifically: `packages/_assertions/src/**` exports consumed only by `e2e/*/scripts/assert-build.ts`, `scripts/assert-showcase-build.ts`, and `packages/_integration/__tests__/manifest-shape.test.ts` are likely to flag as unused until policy changes populate `entry` or `ignoreExports`. This noise IS the signal for follow-on policy work — not a tier defect.
- [ ] 9.2 Add a note to the PR description naming the expected first-run verdict. If it is `fail` on the default invocation, the policy follow-ons (`apply-ts-workspace-scoping`, `apply-ts-suppression-rationale`) will flip it to `warn` or `pass` — that is the intended staged path.

## 1. Precondition Helper Extension

- [x] 1.1 Add `require_cargo_machete` function to `scripts/verify/_preconditions.sh` following the existing `require_*` pattern: `command -v cargo-machete >/dev/null 2>&1` check, on failure emit `ERROR: cargo-machete missing. Run: cargo install cargo-machete` to stderr and exit 1.
- [x] 1.2 Confirm the helper remains `set -euo pipefail`-compatible (no side effects that strict mode would trip on).

## 2. Hygiene Tier Script

- [x] 2.1 Create `scripts/verify/hygiene-rust.sh` with `#!/usr/bin/env bash` + `set -euo pipefail`, compute `ROOT` the same way the other tier scripts do, source `_preconditions.sh`, call `require_cargo_machete`, then `cd "$ROOT/packages/extract" && exec cargo machete`.
- [x] 2.2 `chmod +x scripts/verify/hygiene-rust.sh`.
- [x] 2.3 Smoke-run locally: `bash scripts/verify/hygiene-rust.sh`. Capture output (expected: either "no unused deps" success, or a specific list — record the list for task group 4).

## 3. Cargo Config Surface

- [x] 3.1 Add `[package.metadata.cargo-machete]` section to `packages/extract/Cargo.toml` with an empty `ignored = []` list, so the suppression mechanism exists. (What goes IN the list, if anything, is a follow-on policy decision not covered by this change.)
- [x] 3.2 Re-run `bash scripts/verify/hygiene-rust.sh` against the current crate. If the tier exits non-zero because machete flags `napi-derive` / `napi-build` / `once_cell` / any other genuinely-used-but-statically-invisible crate, stop here and hand off to a follow-on policy change — the capability is installed and the follow-on decides suppressions. If the tier exits 0, no further action needed in this group.

## 4. Package Script Registration

- [x] 4.1 Add `"verify:hygiene:rust": "bash scripts/verify/hygiene-rust.sh"` to the `scripts` block of root `package.json`, positioned near `verify:unit:rust` for readability.
- [x] 4.2 Update the `verify:ci` composite orchestrator in `package.json` to invoke `verify:hygiene:rust` in the CI-mirroring sequence (since CI gains a `hygiene-rust` job in group 5). Do NOT modify the `verify` fast-gate composition — whether to include `verify:hygiene:rust` in the fast gate is a separate policy decision.
- [x] 4.3 Run `bun run verify:hygiene:rust` locally and confirm the tier executes and passes on the current crate.

## 5. CI Workflow Wiring

- [x] 5.1 Pick the pinned `cargo-machete` version for `taiki-e/install-action` (latest stable release at implementation time). Record the version in the workflow step comment.
- [x] 5.2 Add new `hygiene-rust` job to `.github/workflows/ci.yaml`, positioned below `test-rust`. Use the same `runs-on: ubuntu-latest`, `actions/checkout@v4`, `dtolnay/rust-toolchain@stable`, and `Swatinem/rust-cache@v2 { workspaces: packages/extract }` setup as `test-rust`.
- [x] 5.3 Install `cargo-machete` via `taiki-e/install-action@v2` with `tool: cargo-machete@<pinned-version>`.
- [x] 5.4 Add the run step: `working-directory: packages/extract`, `run: cargo machete`.
- [x] 5.5 Verify that `hygiene-rust` does NOT appear in the `needs:` list of any other job (it is a standalone parallel job; the `verify` job currently depends on `[build-extract, test-rust]` and SHOULD NOT gain a new dependency from this change — the fast-gate tier locally covers that responsibility).

## 6. Root CLAUDE.md Updates

- [x] 6.1 Add a new row to the Verification Tiers → Atomic Tiers table: `| bun run verify:hygiene:rust | cargo-machete dep-hygiene check on packages/extract | cargo-machete binary on PATH | unused dep found (or machete missing) | fast |`.
- [x] 6.2 Add a new Change-Type Map row: `| packages/extract/Cargo.toml | verify:hygiene:rust |`. Place it immediately below the existing `packages/extract/src/**/*.ts` row.
- [x] 6.3 Confirm no CLAUDE.md-level duplication of the tier table leaks into per-package CLAUDE.md files (per the existing spec requirement that package-level files link back).

## 7. Cross-Change Alignment with add-ts-static-analysis

- [x] 7.1 **Bidirectional MODIFIED re-sync.** Both this change and `add-ts-static-analysis` MODIFY the same four requirements in `verification-tier-policy` (Atomic Tier Isolation, Shared Precondition Helper Library, Change-Type Map, `verify:ci` CI-Simulation Semantics). OpenSpec MODIFIED semantics replace the full block. Before this change archives, confirm the TS change's archive state and re-sync this change's MODIFIED blocks to preserve any TS-landed additions. Either change's archive-order must not erase the other's content.
- [x] 7.2 Confirm `_preconditions.sh` helper function names do not collide (`require_cargo_machete` vs `require_fallow_binary`).
- [x] 7.3 Confirm this change does NOT augment any Change-Type Map row beyond adding the `Cargo.toml` row at value `verify:hygiene:rust`. Augmentation to include `verify:unit:rust` on the same row is a policy decision deferred to `apply-rust-hygiene-changetype-augmentation`.

## 8. Validation

- [x] 8.1 Run `openspec validate add-rust-dep-hygiene --strict` and confirm clean.
- [x] 8.2 Run `bun run verify:hygiene:rust` locally; confirm it passes on the current crate.
- [x] 8.3 Induce a synthetic failure: temporarily add `unused_dep = "1"` to `[dependencies]` in `packages/extract/Cargo.toml`, run `bun run verify:hygiene:rust`, confirm exit 1 and `unused_dep` named in output, then revert the synthetic entry.
- [x] 8.4 Induce a tool-missing failure: on a machine without `cargo-machete`, run `bash scripts/verify/hygiene-rust.sh`, confirm the exact error message "ERROR: cargo-machete missing. Run: cargo install cargo-machete" and exit 1. (If implementing on a machine with machete already installed, temporarily rename the binary or prepend a PATH override to simulate.)
- [ ] 8.5 Push a CI preview branch; confirm `hygiene-rust` job appears in the Actions tab, runs parallel with `test-rust`, and exits 0 on the untouched crate. _(skipped 2026-04-27 — CI job is wired with pinned `cargo-machete@0.9.2` and is structurally identical to the working `test-rust` job; preview run not exercised this session.)_
- [x] 8.6 Confirm the Change-Type Map row for `packages/extract/Cargo.toml` resolves to the expected tier (`verify:hygiene:rust`) and that a no-op Cargo.toml edit exercised against that tier passes.

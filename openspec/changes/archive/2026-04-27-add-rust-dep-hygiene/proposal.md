## Why

The `packages/extract` Rust crate has 14 runtime dependencies plus one build dependency, and dependency rot is easy to miss in PR review — an `oxc_*` crate removed from code may linger in `Cargo.toml`, bloating the release binary and compile time. The repository already treats static verification as first-class (the `verify:*` tier family) but has no guard against unused Rust dependencies. Adding `cargo-machete` as a dedicated atomic tier closes this gap with a stable-rust, sub-five-second check that fits the existing fail-loud tier contract.

This change also establishes the `verify:hygiene:*` tier family naming, paired with a separately-proposed TS counterpart (`verify:hygiene:ts` via `fallow-rs`) that warrants its own audit cycle because of the repo's dynamic-discovery surfaces (MDX, JSX, factory patterns). Splitting the proposals keeps the drop-in Rust hygiene landing immediately while the riskier TS side gets scoped carefully.

## What Changes

- **Add atomic tier `verify:hygiene:rust`**: new script `scripts/verify/hygiene-rust.sh` that sources `_preconditions.sh`, calls a new helper `require_cargo_machete`, and runs `cargo machete` against `packages/extract`. Detect-and-fail semantics; no auto-fix.
- **Extend helper library**: add `require_cargo_machete` to `scripts/verify/_preconditions.sh` following the existing `require_*` contract (stderr error, exit 1, actionable install command).
- **Register config surface**: add `[package.metadata.cargo-machete]` section to `packages/extract/Cargo.toml` so the `ignored` list exists as the suppression mechanism. Specific entries (if any) are a follow-on policy decision, not part of this capability.
- **Update `verify:ci` composite orchestrator** to mirror the new CI job. The `verify` fast-gate composition is NOT modified — whether the new tier joins the fast gate is a policy decision for a follow-on change.
- **Add CI job `hygiene-rust`**: parallel with the existing `test-rust` job in `.github/workflows/ci.yaml`, reusing `dtolnay/rust-toolchain@stable` + `Swatinem/rust-cache@v2`. Installs `cargo-machete` via `taiki-e/install-action@v2` with a pinned version for prebuilt-binary speed (no cold compile).
- **Root CLAUDE.md updates**: add `verify:hygiene:rust` row to the Verification Tier Table, and add a Change-Type Map row mapping `packages/extract/Cargo.toml` edits to `verify:hygiene:rust`.
- **Explicitly NOT included**: `cargo-udeps` (nightly overhead not justified for one crate), `cargo machete --fix` auto-remove in CI, fast-gate inclusion of the new tier (follow-on policy), specific `ignored` entries in the config (follow-on policy), any TS-side static analysis (separate sibling proposal), broader Rust lint additions (clippy, rustfmt enforcement).

## Capabilities

### New Capabilities

_None._ This change extends an existing capability only.

### Modified Capabilities

- `verification-tier-policy`: register a new atomic tier in the Atomic Tier Isolation tier list; extend the Shared Precondition Helper Library with `require_cargo_machete`; extend the Change-Type Map with a `Cargo.toml` row; extend `verify:ci` CI-Simulation Semantics to mirror the new CI job. The Composite Orchestrators requirement (which governs `verify` fast-gate composition) is NOT modified — that's a policy decision.

## Follow-on policy changes (NOT in scope here)

- `apply-rust-hygiene-fast-gate-inclusion`: evaluate measured runtime and fold `verify:hygiene:rust` into the `verify` fast-gate
- `apply-rust-hygiene-suppressions`: populate `[package.metadata.cargo-machete].ignored` if first-run audit surfaces legitimate false positives (candidates: `napi-derive` proc-macro, `napi-build` build.rs-only)
- `apply-rust-hygiene-changetype-augmentation`: if desired, augment the `packages/extract/Cargo.toml` Change-Type Map row to also trigger `verify:unit:rust`

## Impact

- **Code**:
  - New: `scripts/verify/hygiene-rust.sh`
  - Modified: `scripts/verify/_preconditions.sh` (add `require_cargo_machete`)
  - Modified: `packages/extract/Cargo.toml` (add `[package.metadata.cargo-machete]`)
  - Modified: `package.json` (register `verify:hygiene:rust` script; update `verify:ci` to mirror the new CI job)
  - Modified: `.github/workflows/ci.yaml` (new `hygiene-rust` job)
  - Modified: root `CLAUDE.md` (tier table + change-type map rows)
- **APIs**: None. This is internal tooling only; no public surface changes.
- **Dependencies**: adds `cargo-machete` as a dev-time CLI tool (CI pinned via `taiki-e/install-action`; local installation via `cargo install cargo-machete`, documented in the precondition's install-command message).
- **Release surface**: zero. `cargo-machete` is not a build-time dep of the crate and does not ship in any published artifact.
- **Developer experience**: a new atomic tier exists (`bun run verify:hygiene:rust`) and can be run on demand. `verify:ci` mirrors CI's new job. Whether the tier joins the `verify` fast-gate is a follow-on policy decision. First run on the current crate is expected to find zero unused deps (tool functions as a guard, not a cleanup mechanism).

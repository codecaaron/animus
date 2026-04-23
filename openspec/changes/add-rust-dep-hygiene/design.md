## Context

The repository's `verify:*` tier family is the authoritative surface for static and dynamic verification. Each atomic tier has a single concern, fail-loud preconditions, and fits into one of two composite orchestrators (`verify` fast-gate or `verify:full`) plus the CI mirror `verify:ci`. The Rust crate in `packages/extract` currently has one atomic tier covering it — `verify:unit:rust` (cargo test --lib) — and no tier covering dependency hygiene.

The crate has 14 runtime dependencies (9 `oxc_*` crates pinned together at `0.124.0`, plus `rquickjs`, `rayon`, `rustc-hash`, `serde`/`serde_json`, `napi`/`napi-derive`, `once_cell`) plus one build dependency (`napi-build`). Dependency removals during refactors can leave orphaned `Cargo.toml` entries that survive PR review; a recent example would be an OXC submodule that stops being used when a Rust extractor phase is consolidated.

`cargo-machete` (stable-rust, prebuilt binaries via `taiki-e/install-action`) and `cargo-udeps` (nightly, compile-graph-based) are the two established options. For a single crate with a modest dep list, machete is right-sized and udeps is overhead. The tool is a guard against future rot rather than a cleanup mechanism — the current crate is expected to have zero unused deps on first run.

## Goals / Non-Goals

**Goals:**
- Catch unused Rust dependencies in the pre-commit / PR-gate layer, not at release time.
- Fit the existing atomic-tier contract: single concern, fail-loud, shared helper, CLAUDE.md-registered.
- Keep the fast-gate fast: machete runs in single-digit seconds and parses source without invoking the compiler.
- Establish the `verify:hygiene:*` naming family so a future TS-side counterpart slots in symmetrically without re-negotiation.
- Zero impact on published artifacts or consumer packages.

**Non-Goals:**
- `cargo-udeps` integration (nightly toolchain + full-graph compile cost not justified).
- `cargo machete --fix` auto-remove in CI. Humans review removals.
- TS-side dead-code detection (tracked separately as `add-ts-dead-code-detection`, pending fallow-rs audit against MDX + JSX + factory patterns).
- Broader Rust lint/format enforcement (`clippy`, `rustfmt`).
- Cargo workspace restructuring. The crate remains a single-crate project.

## Decisions

### Decision 1: `cargo-machete`, not `cargo-udeps`

**Chosen**: `cargo-machete`.

**Rationale**: Stable-rust, parses `Cargo.toml` + source `use` statements without compiling, sub-five-second runtime, prebuilt binary distribution via `taiki-e/install-action`. For a single crate with 15 total deps, this is the correct precision / cost tradeoff.

**Alternative considered**: `cargo-udeps`. Rejected because (a) requires nightly toolchain, adding a second Rust toolchain install to CI, (b) compiles the full dep graph, 10-30× slower, (c) its additional precision (dead-on-specific-feature detection) is not earned at this scale.

### Decision 2: Dedicated CI job `hygiene-rust`, parallel with `test-rust`

**Chosen**: New CI job `hygiene-rust` paralleling `test-rust`, reusing the Rust toolchain + rust-cache setup.

**Rationale**: Matches the existing single-concern job philosophy (lint, test-rust, build-extract are already isolated). Parallel execution hides the machete install and run time behind other jobs' runtime. Isolated failure surface — an unused-dep failure doesn't entangle with `cargo test` output.

**Alternative considered**: Fold machete into `test-rust` as a preceding step. Rejected because it mixes concerns in one job and makes the failure class harder to identify in CI output.

**Alternative considered**: Fold into the `lint` job. Rejected because `lint` does not install the Rust toolchain today, and adding one doubles the job's setup cost for a tier that is semantically Rust-specific.

### Decision 3: `taiki-e/install-action@v2` for CI install, `cargo install` for local

**Chosen**: `taiki-e/install-action@v2` with `tool: cargo-machete@<pinned-version>` in CI; `cargo install cargo-machete` in the local developer install-error message emitted by `require_cargo_machete`.

**Rationale**: `taiki-e/install-action` pulls prebuilt binaries from upstream releases (sub-second install). `cargo install` is the universal fallback for developers who do not want extra tooling. The helper's error message names the canonical install command so the developer is never stuck.

**Alternative considered**: `cargo install cargo-machete` directly in CI. Rejected because a cold install compiles the tool, adding 30-60s to the job on cache miss.

### Decision 4: Config surface is `[package.metadata.cargo-machete]` in `Cargo.toml`

**Chosen**: Add `[package.metadata.cargo-machete]` section with `ignored = []` to `packages/extract/Cargo.toml`.

**Rationale**: This is machete's native config key. Colocating the allowlist with the manifest it guards keeps edits local. Starting with an empty list makes suppressions explicit additions rather than default noise. Two candidates for eventual entries: `napi-derive` (proc-macro, usage is through `#[napi]` attribute rather than `use` statement) and `napi-build` (build.rs-only dependency). These are investigated during implementation tasks; if machete handles either natively they stay absent from the list.

### Decision 5: Fast-gate inclusion is a policy decision, not part of this capability install

**Chosen**: do NOT modify the `verify` fast-gate composition in this change. Update `verify:ci` to mirror the new CI job (capability-mirror); leave `verify` membership to a follow-on policy change.

**Rationale**: Peer directive — capabilities enable policies; adding a tier to the `verify` composition IS a policy decision about which tiers block inner-loop development. The capability is "the tier exists and can be invoked"; the policy is "it gates the fast loop." Follow-on `apply-rust-hygiene-fast-gate-inclusion` handles the decision once runtime has been measured.

### Decision 6: Precondition helper function, not inline check

**Chosen**: Add `require_cargo_machete` to `scripts/verify/_preconditions.sh` and have `hygiene-rust.sh` call it.

**Rationale**: The spec's Shared Precondition Helper Library requirement mandates this pattern — no inline precondition logic in tier scripts. The helper emits an actionable install command; the tier script stays a three-line wrapper.

## Risks / Trade-offs

- **`napi-derive` false positive** → Mitigation: initial implementation task includes running machete against the current crate and recording whether the proc-macro is flagged; if so, add it to `[package.metadata.cargo-machete].ignored` with a one-line rationale comment.
- **`napi-build` build.rs detection** → Mitigation: same as above. Verify machete traverses `[build-dependencies]` or list `napi-build` in `ignored` if not.
- **`cargo-machete` binary-distribution drift** → Mitigation: pin an explicit version in `taiki-e/install-action` (e.g., `cargo-machete@0.7.0` — exact pin chosen at implementation time). A machete release that changes flag semantics is an explicit version bump, not an implicit follow.
- **Developer without machete installed runs the fast-gate** → Mitigation: `require_cargo_machete` emits `ERROR: cargo-machete missing. Run: cargo install cargo-machete` and exits 1. No confusing output, no silent pass, no attempt to auto-install.
- **`verify` fast-gate time creep** → Mitigation: machete is sub-five-second on this crate. If future Rust expansion makes this too slow, move to `verify:full` only — but this is not expected.
- **Cache mis-pin**: `Swatinem/rust-cache@v2` caches cargo home; `cargo-machete` installed via `taiki-e/install-action` may or may not land in the cached directory. Mitigation: `taiki-e/install-action` is fast enough that cache participation is unimportant; we do not rely on caching its binary.

## Migration Plan

This is a purely additive change. No existing tier changes behavior, no public API moves, no consumer-visible surface. Rollback is revert-only (delete script, helper addition, CI job, package.json entries, Cargo.toml metadata, CLAUDE.md rows). No data, state, or artifact migration.

Rollout order (matches the Tasks ordering):

1. Script + helper land first (local runnable, no CI impact).
2. Cargo.toml config surface added (still no CI impact).
3. Composite orchestrator folded in (developers running `verify` now execute it; CI still unchanged).
4. CI job added last (activates PR gate).
5. CLAUDE.md updated alongside CI landing so agents and humans see the same tier in table and map.

## Open Questions

- Exact pinned version of `cargo-machete` for `taiki-e/install-action` — selected at implementation time based on latest stable release.
- Whether to emit a machete-specific CI annotation on failure (GitHub Actions `::error::` file pointer). Nice-to-have; not in initial scope.
- Whether to add a developer-ergonomic `bun run fix:hygiene:rust` that runs `cargo machete --fix`. Not in initial scope; developers can run `cargo machete --fix` directly when needed.

# Increment 07: Workers Cold-Build Reproducibility Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` and
> `superpowers:test-driven-development`. Run no version-control command and do
> not edit shared OpenSpec artifacts.

**Goal:** Make every Git-connected Cloudflare Worker build succeed from a cold
Ubuntu checkout with V2 extraction enabled and fail loudly if extraction cannot
produce CSS.

**Architecture:** One shared build script owns the V2 native prerequisite. It
uses the repository's `rust-toolchain.toml` as the Rust-version source, installs
that exact minimal toolchain only in Workers CI when Cargo is absent, and builds
the V2 NAPI binary from the checked-out source. Every app build depends on that
task and shared TypeScript output. `.node-version` mirrors the Node 24 LTS pin
for Cloudflare, and all four app configs enable verified, strict extraction.

**Tech Stack:** Node 24.18.0 LTS, Bun 1.3.11, Rust 1.97.0, NAPI-RS, Vite Plus,
Vitest, Cloudflare Workers Builds.

---

## Scope

- **Registry row**: 07 · mode: delegate · review: subagent
- **Resolves**: D12 and the cold-build portion of OPS-1 through OPS-4
- **Depends on**: accepted increment 06 and the first Git-triggered build signal
- **Footprint**: `.tool-versions`, `.node-version`, `AGENTS.md`, `CLAUDE.md`,
  `packages/extract/package.json`, `vite.config.ts`,
  `scripts/cloudflare/build-extract-v2.sh`,
  `scripts/verify/build-extract-v2.test.ts`,
  `scripts/verify/workers-config.test.ts`, `scripts/verify/workers-contracts.sh`,
  and the four Worker Vite configs
- **Prohibitions**: no Git commands, dependency upgrades, V1 fallback, checked-in
  native binary, remote deployment, or edits to shared OpenSpec artifacts.

## Context capsule

- Cloudflare's first Git builds ran on Ubuntu x64 with Node 22.16 and no V2
  `.node` artifact. Vinext/React Router failed strictly; showcase/Vite warned,
  emitted empty extraction output, and deployed false greens.
- Cloudflare recognizes `.node-version`, not `.tool-versions`, and exposes
  `WORKERS_CI=1`. Its image includes `curl` and `build-essential` but not Rust.
- `packages/extract/crates/extract-v2/rust-toolchain.toml` pins Rust `1.97.0`.
- Node `24.18.0` is the current Node 24 LTS release. Bun remains `1.3.11` because
  the repository documents a later-version `createRequire` regression.

## Task 07.1: Write and run the failing cold-build contracts

- [x] Extend `scripts/verify/workers-config.test.ts` to require:
  - `.tool-versions` and `.node-version` both pin `24.18.0`;
  - `build:extract-v2` invokes `bash scripts/cloudflare/build-extract-v2.sh`;
  - `build:{showcase,vite,vinext,react-router}` each depend on both
    `build:extract-v2` and `build:ts`;
  - all four Worker Vite configs contain `verify: true` and `strict: true` in
    their Animus options;
  - the build script reads the V2 `rust-toolchain.toml`, gates installation on
    `WORKERS_CI`, requests rustup's minimal profile, and runs `build:v2`.
- [x] Run `bunx vp test run scripts/verify/workers-config.test.ts` and record RED
  only on the absent cold-build behavior.

## Task 07.2: Implement the pinned toolchain surface

- [x] Change `.tool-versions` to `nodejs 24.18.0` and add `.node-version` with
  exactly `24.18.0`; update matching Node guidance in `AGENTS.md` and
  `CLAUDE.md` without changing the Bun pin.
- [x] Create `scripts/cloudflare/build-extract-v2.sh` with fail-loud Bash behavior. Read the
  exact channel from the V2 `rust-toolchain.toml`. If Cargo is absent outside
  `WORKERS_CI=1`, print an actionable error and exit. In Workers CI, download
  the official rustup installer over TLS to a temporary file, install the exact
  channel with `--profile minimal --no-modify-path`, add `$HOME/.cargo/bin` to
  `PATH`, print the resolved Rust version, and execute the workspace `build:v2`.

## Task 07.3: Connect every Worker build and remove false greens

- [x] Change the root `build:extract-v2` command to the shared script and add
  `build:extract-v2` beside `build:ts` in every public Worker build dependency.
- [x] Add `verify: true` and `strict: true` to showcase and Vite; preserve the
  already verified/strict Vinext and React Router configs and all V2 escape
  hatches.

## Task 07.4: Prove GREEN locally

- [x] Re-run the focused contract and `vp run verify:workers:contracts`.
- [x] Run `bash -n scripts/cloudflare/build-extract-v2.sh` and
  `vp run build:extract-v2`.
- [x] Run `vp run verify:ci`, required by the `.tool-versions`, script, task
  graph, and Worker config surfaces.
- [x] Run the G1-G6 guardrails and `openspec validate
  add-workers-canary-matrix --strict`.

## Output contract

- [x] Record the RED/GREEN test counts, exact Node/Rust versions, V2 build
  evidence, CI-mirror result, and guardrail results.
- [x] List modified files and any remaining remote-only variable.
- [x] Return proposed journal signal/review/surprise entries; do not write
  `design.md`, `tasks.md`, `journal.md`, or `specs/**`.

## Review correction 07.R1

The first quality review rejected five cold-build failure modes. This correction
must receive a clean re-review before row 07 closes.

- [x] **R1.1 — Verify as well as fail strictly:** require both `verify: true`
  and `strict: true` in every Worker Animus options object; add missing showcase
  verification and make the contract ignore comments while inspecting the
  balanced options block.
- [x] **R1.2 — Deduplicate the native build graph:** expose a V1-only package
  script and root `build:extract-v1` node. Make `verify:ci` use the unique V1,
  V2, and TypeScript nodes instead of the monolithic `build:extract` command,
  so every V2 consumer reaches one shared graph node.
- [x] **R1.3 — Enforce the exact Rust release:** after resolving `rustc`, compare
  its reported release to the parsed channel and fail with an actionable error
  on mismatch, including cargo-present/non-rustup environments.
- [x] **R1.4 — Execute every bootstrap branch:** add hermetic tests with injected
  command paths proving missing Cargo outside Workers CI fails without curl,
  Cargo-present skips bootstrap and validates the exact release, a mismatched
  release fails, and Workers CI missing-Cargo requests the parsed channel plus
  minimal/no-path-modification flags before invoking `build:v2`. Register this
  test in the permanent Worker contract tier.
- [x] **R1.5 — Clean the installer before process replacement:** remove the
  downloaded installer immediately after rustup succeeds and clear the EXIT
  trap before replacing the shell with the Bun build.
- [x] **R1.6 — Re-prove:** run the focused structural and executable contracts,
  shell syntax, the V1 and V2 nodes, Worker contracts, `verify:ci`, G1-G6, strict
  OpenSpec validation, and registry lint; record exact results.
- [x] **R1.7 — Stage complete graphs:** prevent `build:ts` from cleaning shared
  package output while parity/integration consumes it. Add contract-proven
  private build and after-build phases for both `verify:full` and `verify:ci`;
  keep public atomic tasks unchanged and ensure each complete graph runs all
  native/TypeScript builds before its verification/application phase.

## Implementation record

- **TDD:** The initial cold-build contract ran RED at 17/21 with only the Node,
  V2 prerequisite, public build-edge, and strict-extraction expectations failing,
  then GREEN at 21/21. Review correction 07.R1 began at 21/27, with six intended
  failures across executable bootstrap branches, V1/CI graph ownership, and
  showcase verification. The staged-graph contracts also failed before both
  complete graphs gained build-only barriers. Final focused evidence is 28/28.
- **Toolchains:** `.tool-versions` and `.node-version` pin Node `24.18.0`; Bun
  remains `1.3.11`. `vp run build:extract-v1` and
  `vp run build:extract-v2` exit 0; V2 reports rustc `1.97.0` matching its
  repository channel. The helper rejects absent Cargo outside Workers CI and a
  mismatched Rust release before building.
- **Cold-bootstrap behavior:** Four hermetic tests execute Cargo-present,
  Cargo-missing/non-Workers, release-mismatch, and Cargo-missing/Workers paths.
  The Workers branch passes the exact channel, minimal profile, and
  no-path-modification flags to rustup, removes its installer, verifies Cargo,
  and invokes the workspace V2 build.
- **Extraction and graph:** Showcase and Vite join Vinext and React Router with
  `verify: true` plus `strict: true`. Every public Worker build reaches the one
  shared V2 node. `verify:ci` and `verify:full` run unique V1/V2/TypeScript
  build-only barriers before their consumer graphs; this removes two reproduced
  dist/declaration races while preserving public atomic tasks.
- **Verification:** The permanent Worker tier passes 30 root/Vite, 15 Vinext,
  and 20 React Router tests. Fresh delegated runs passed `verify:ci` with 28
  uncached tasks and `verify:full` with 29 uncached tasks. G1-G6, strict OpenSpec
  validation, registry lint, formatter checks, shell syntax, and diff checks are
  clean. The same reviewer accepted the corrected implementation with no
  remaining finding.
- **Modified implementation surface:** `.tool-versions`, `.node-version`,
  `AGENTS.md`, `CLAUDE.md`, `packages/extract/package.json`, `vite.config.ts`,
  `scripts/cloudflare/build-extract-v2.sh`,
  `scripts/verify/build-extract-v2.test.ts`,
  `scripts/verify/workers-config.test.ts`, `scripts/verify/workers-contracts.sh`,
  `packages/showcase/vite.config.ts`, and `e2e/vite-app/vite.config.ts`.
  Vinext and React Router already satisfied the verified/strict contract.
- **Remote build environment:** Cloudflare Build variables now pin
  `NODE_VERSION=24.18.0` and `BUN_VERSION=1.3.11` on `animus`,
  `animus-vite-canary`, `animus-vinext-canary`, and
  `animus-react-router-canary`; each value was re-read from the service UI after
  saving. No build was triggered because the implementation is not yet landed.
- **Remaining remote variable:** the next Git-triggered Cloudflare cold checkout
  must prove these changes on all four connected services.

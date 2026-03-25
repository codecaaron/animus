## Why

The Rust extraction crate only builds on the development machine (darwin-arm64). CI runs on Ubuntu but never compiles the crate, so linux breakages are invisible until someone tries to use the package outside macOS. Any contributor on Linux, any Docker-based dev environment, and any CI pipeline that runs `verify:full` needs a working `.node` binary for their platform.

## What Changes

- **Trim NAPI targets to 2026 reality**: Remove `x86_64-apple-darwin` (Intel Mac is dead) and `x86_64-pc-windows-msvc` (frontend devs on Windows use WSL2 → linux binary). Keep `aarch64-apple-darwin`, `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`.
- **GitHub Actions CI workflow for Rust builds**: Matrix build across the three targets. macOS arm64 runner for darwin, ubuntu runners for linux. Produces `.node` binaries as artifacts.
- **CI runs `verify:full`** on linux after building the crate, proving the full pipeline (extraction + showcase) works cross-platform.
- **Optional: `napi pre-publish` npm package scaffolding** for future npm distribution via scoped platform packages (`@animus-ui/extract-linux-x64-gnu`, etc.). Not publishing yet — just the infrastructure.

## Capabilities

### New Capabilities
- `napi-cross-platform-ci`: GitHub Actions workflow for building the Rust crate across target platforms, uploading binary artifacts, and running full verification on linux.

### Modified Capabilities
- `rust-extraction-pipeline`: NAPI target list trimmed from 5 to 3 platforms. No behavioral change to extraction functions.

## Impact

- **`packages/extract/package.json`**: `napi.targets` trimmed to 3 entries.
- **`.github/workflows/`**: New or modified CI workflow with Rust build matrix.
- **CI runtime**: Adds ~2-3 minutes for Rust compilation on each platform runner.
- **No API changes**: Extraction functions, NAPI signatures, and binary loader are unchanged.
- **No runtime changes**: The auto-generated `index.js` loader already handles all platforms.

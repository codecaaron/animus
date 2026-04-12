## Why

Commit `58e4dad` ("fix tests") moved `cargo test --lib` from the `build-extract` CI job into the `verify` job. This required adding Rust toolchain setup and `Swatinem/rust-cache@v2` to `verify`. The Rust cache restore step now runs AFTER the NAPI binary download — and the integration tests fail with `TypeError: clearAnalysisCache is not a function`, indicating `require('@animus-ui/extract')` returns a module without NAPI functions. The fix works locally; the failure is CI-only.

The root cause is the Rust cache/toolchain setup in `verify` interfering with the downloaded `.node` binary. The simplest fix: remove the Rust unit test step from `verify` entirely and restore it to `build-extract` where it ran before, eliminating the need for Rust toolchain/cache in the verify job.

## What Changes

- **Revert verify job**: Remove Rust toolchain, Rust cache, and `cargo test --lib` steps from the `verify` job
- **Restore build-extract**: Move `cargo test --lib` back into `build-extract`, running before the NAPI binary build (original position)
- **Add binary verification**: Add a diagnostic step in `verify` after binary download to confirm the `.node` file exists and is loadable

## Capabilities

### New Capabilities

- `ci-napi-binary-verification`: Add a verification step in the verify job that confirms the downloaded NAPI binary is present and loadable before running tests

### Modified Capabilities

- `build-verification`: Restore Rust unit tests to `build-extract` job, remove Rust toolchain/cache from `verify` job

## Impact

- `.github/workflows/ci.yaml` — revert verify job structure, restore build-extract test step
- No code changes — this is purely CI pipeline configuration
- Build times: `build-extract` slightly longer (adds cargo test back), `verify` slightly shorter (removes Rust setup)

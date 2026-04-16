## Context

The CI pipeline has three jobs: `lint` (parallel), `build-extract` (builds NAPI binary), and `verify` (downloads binary, builds TS, runs tests). Commit `58e4dad` moved `cargo test --lib` from `build-extract` to `verify`, requiring Rust toolchain and `Swatinem/rust-cache@v2` to be added to `verify`.

Current `verify` step order:
```
checkout → bun → download .node → bun install → rust toolchain → rust cache → build TS → cargo test → compile → bun test
```

The Rust cache step restores `packages/extract/target/` between the binary download and test execution. Integration tests fail with NAPI functions being `undefined` — the binary either gets corrupted, displaced, or bun's module resolution is disrupted by the cache restore touching the workspace directory.

## Goals / Non-Goals

**Goals:**
- Restore green CI by isolating Rust unit tests from the verify pipeline
- Add observability for NAPI binary status in CI
- Keep `cargo test --lib` running in CI (just in the right place)

**Non-Goals:**
- Diagnosing the exact Swatinem/rust-cache interaction (pragmatic fix over root-cause archaeology)
- Changing the NAPI binary build process
- Modifying package.json exports or module resolution

## Decisions

### 1. Move `cargo test --lib` back to `build-extract`

Restore the original position: Rust unit tests run in `build-extract` before the NAPI binary build. This is where Rust toolchain and cache already exist.

**Why not keep in verify?** The Rust cache/toolchain setup in `verify` is the only new variable correlating with the failure. Removing it is the minimal change.

**Why not a separate parallel job?** Adds CI complexity for no benefit. The tests share the same Rust compilation with `napi build` — running them sequentially in `build-extract` reuses cached artifacts.

### 2. Add binary verification step in `verify`

After downloading the binary and running `bun install`, add:
```yaml
- name: Verify NAPI binary
  run: |
    ls -la packages/extract/*.node
    bun -e "const m = require('./packages/extract/index.js'); console.log('NAPI exports:', Object.keys(m));"
```

This catches future binary issues immediately with clear diagnostics instead of cryptic "not a function" errors downstream.

### 3. Remove Rust toolchain/cache from `verify`

With `cargo test --lib` back in `build-extract`, there's no need for Rust in `verify`. Removing it simplifies the job and eliminates the interference vector.

## Risks / Trade-offs

- **[Risk] build-extract takes slightly longer** → Acceptable; cargo test was always there before and shares compilation cache with napi build
- **[Risk] Root cause unknown** → The verification step provides diagnostics if the issue resurfaces. Pragmatic over perfect.
- **[Risk] cargo test failure blocks binary upload** → This is desired behavior; a failing test suite should not produce a release binary

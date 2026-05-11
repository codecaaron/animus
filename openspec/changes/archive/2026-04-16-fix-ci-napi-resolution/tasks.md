## 1. Revert verify job

- [x] 1.1 Remove `dtolnay/rust-toolchain@stable` step from `verify` job
- [x] 1.2 Remove `Swatinem/rust-cache@v2` step from `verify` job
- [x] 1.3 Remove `cargo test --lib` step from `verify` job

## 2. Restore build-extract test step

- [x] 2.1 Add `cargo test --lib` step to `build-extract` job, positioned before the NAPI binary build step (after `bun install`)
  - NOTE: Shipped as a separate `test-rust` CI job rather than a step within `build-extract`. `verify` depends on both via `needs: [build-extract, test-rust]`. Effect achieved — Rust unit tests gate the pipeline.

## 3. Add binary verification

- [x] 3.1 Add "Verify NAPI binary" step in `verify` job after `bun install`, before `bun run build`: list `.node` files and confirm NAPI exports are loadable via `bun -e`
  - NOTE: Shipped as two verification steps — repo root context AND _integration context — exceeding the original spec.

## 1. Revert verify job

- [ ] 1.1 Remove `dtolnay/rust-toolchain@stable` step from `verify` job
- [ ] 1.2 Remove `Swatinem/rust-cache@v2` step from `verify` job
- [ ] 1.3 Remove `cargo test --lib` step from `verify` job

## 2. Restore build-extract test step

- [ ] 2.1 Add `cargo test --lib` step to `build-extract` job, positioned before the NAPI binary build step (after `bun install`)

## 3. Add binary verification

- [ ] 3.1 Add "Verify NAPI binary" step in `verify` job after `bun install`, before `bun run build`: list `.node` files and confirm NAPI exports are loadable via `bun -e`

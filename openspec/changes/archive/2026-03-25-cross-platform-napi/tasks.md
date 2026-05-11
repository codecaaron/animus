## 1. Trim NAPI Targets

- [x] 1.1 Update `packages/extract/package.json` `napi.targets` to `["aarch64-apple-darwin", "x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu"]`
- [x] 1.2 Regenerate `index.js` and `index.d.ts` via `napi artifacts` (or rebuild) to reflect trimmed targets

## 2. CI Workflow — Rust Build Matrix

- [x] 2.1 Add `build-extract` job to `.github/workflows/ci.yaml` with matrix strategy: `[{target: aarch64-apple-darwin, runner: macos-14}, {target: x86_64-unknown-linux-gnu, runner: ubuntu-latest}, {target: aarch64-unknown-linux-gnu, runner: ubuntu-24.04-arm}]`
- [x] 2.2 Each matrix job: checkout, setup Rust (dtolnay/rust-toolchain@stable), cache Cargo (Swatinem/rust-cache), setup bun, `bun install`, `napi build --platform --release --target $TARGET`
- [x] 2.3 Upload `.node` binary as artifact per platform job
- [x] 2.4 Set `continue-on-error: true` on the linux-arm64 matrix entry

## 3. CI Workflow — Full Verification

- [x] 3.1 Add `verify` job that `needs: build-extract`, runs on `ubuntu-latest`
- [x] 3.2 Download linux-x64-gnu `.node` artifact into `packages/extract/`
- [x] 3.3 Run `bun install && bun run verify:full` — proves extraction + showcase + tests on linux

## 4. CI Workflow — Release Job (Manual)

- [x] 4.1 Add `release` job triggered by `workflow_dispatch` or tag push
- [x] 4.2 Download ALL platform `.node` artifacts
- [x] 4.3 Run `napi pre-publish -t npm` to generate scoped platform packages
- [x] 4.4 Add `optionalDependencies` for scoped platform packages to `packages/extract/package.json`
- [x] 4.5 Publish via `npm publish` (or leave as manual step with instructions)

## 5. Verification

- [ ] 5.1 Push branch, confirm build-extract matrix runs on all 3 platforms
- [ ] 5.2 Confirm verify job downloads linux binary and `verify:full` passes
- [ ] 5.3 Confirm ARM build failure does not block CI (continue-on-error)

## 1. Release script

- [x] 1.1 Create `scripts/release.sh` with semver bump logic (patch/minor/major/pre*/graduate)
- [x] 1.2 Add branch guard (must be on `main`)
- [x] 1.3 Add clean working tree guard
- [x] 1.4 Add `--dry-run` flag
- [x] 1.5 Add `--channel` flag for prerelease identifier
- [x] 1.6 Tag filter regex excludes malformed tags (slash separators, `v` prefix in prerelease)
- [x] 1.7 Verify semver arithmetic for all bump types
- [x] 1.8 Add `release` script alias to root `package.json`
- [x] 1.9 Make script executable (`chmod +x`)

## 2. Narrow publish surface

- [x] 2.1 Remove `core` and `theming` from CI version-bump loop
- [x] 2.2 Remove `core` and `theming` from CI publish loop
- [x] 2.3 Add `private: true` to `packages/core/package.json`
- [x] 2.4 Add `private: true` to `packages/theming/package.json`

## 3. Verification

- [ ] 3.1 Dry-run release script on `main` branch after merge
- [ ] 3.2 Verify CI workflow YAML is valid (push to branch, check Actions tab)

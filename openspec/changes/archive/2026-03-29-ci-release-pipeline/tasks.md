## 1. Workspace Cleanup (DONE)

- [x] 1.1 Change root `package.json` workspaces from `["packages/*"]` to explicit list of 7 active packages
- [x] 1.2 Remove `packages/ui` from `build:ts` script
- [x] 1.3 Exclude `__tests__/**/*.test-d.*` from `packages/system/tsconfig.json` include

## 2. Per-Workspace Compile (DONE)

- [x] 2.1 Replace root `compile` script with per-package `tsc -p <pkg>/tsconfig.json --noEmit` chain
- [x] 2.2 Add `compile` to `verify` script after `build:ts`
- [x] 2.3 Reorder CI `check` job: build before compile

## 3. NAPI Build Fix (DONE)

- [x] 3.1 Change CI `napi build` to `bunx @napi-rs/cli build` in `build-extract` job

## 4. Collapse CI Jobs (DONE)

- [x] 4.1 Rename `check` job to `lint` — only runs `bun run check` (biome), no build/compile/test
- [x] 4.2 Move build, compile, and test steps from old `check` into `verify` job (after binary download)
- [x] 4.3 Verify `lint` and `build-extract` run in parallel (no `needs` dependency)
- [x] 4.4 Verify `verify` depends on `build-extract` only

## 5. Workflow Triggers (DONE)

- [x] 5.1 Add `tags: ['v*']` to push trigger in CI workflow
- [x] 5.2 Verify `workflow_dispatch` trigger is present

## 6. Release Job — Version from Tag (DONE)

- [x] 6.1 Add `release` job conditioned on `if: startsWith(github.ref, 'refs/tags/v') || github.event_name == 'workflow_dispatch'`
- [x] 6.2 Release job `needs: verify`
- [x] 6.3 Parse version from tag: `VERSION="${GITHUB_REF#refs/tags/v}"`
- [x] 6.4 Write version script: loop all publishable packages, run `npm version $VERSION --no-git-tag-version` in each
- [x] 6.5 Detect prerelease (version contains `-`) → set `NPM_TAG=next`, else `NPM_TAG=latest`

## 7. Release Job — NAPI Platform Packages (DONE)

- [x] 7.1 Download all 3 platform binary artifacts into `packages/extract/`
- [x] 7.2 Run `bunx @napi-rs/cli pre-publish -t npm` to generate synthetic platform packages
- [x] 7.3 Configure npm auth: write `.npmrc` with `//registry.npmjs.org/:_authToken=${{ secrets.NPM_TOKEN }}`
- [x] 7.4 Publish each platform package from `packages/extract/npm/*/` with `npm publish --access public --tag $NPM_TAG`
- [x] 7.5 Publish `@animus-ui/extract` with `npm publish --access public --tag $NPM_TAG`

## 8. Release Job — TS Packages (DONE)

- [x] 8.1 Run `bun run build:ts` to ensure fresh dist artifacts
- [x] 8.2 Publish in dependency order: core → theming → runtime → system → vite-plugin, each with `npm publish --access public --tag $NPM_TAG`
- [x] 8.3 Skip already-published versions gracefully (`|| true` on publish commands)

## 9. Verification

- [ ] 9.1 Run `bun run verify` locally — confirm build, compile, test, types all pass
- [ ] 9.2 Run `npm pack --dry-run` on each publishable package — verify tarball contents
- [ ] 9.3 Push to `next` branch — confirm lint, build-extract, verify jobs run (no release)
- [ ] 9.4 Create test tag `v0.1.0-next.1` — confirm release job triggers and publishes with `--tag next`

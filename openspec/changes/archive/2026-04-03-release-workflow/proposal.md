## Why

The monorepo has a working CI release job (tag-driven, builds Rust matrix, publishes to npm) but no local workflow for creating releases. Version bumping requires manually editing 5+ package.json files, computing the next semver, creating a tag, and pushing. Meanwhile, legacy packages (core, theming) are still in the publish pipeline despite being absorbed into system at the source level — publishing them risks consumer confusion.

## What Changes

### 1. Release script (`scripts/release.sh`)

A single command — `bun release <bump>` — that handles the full local ceremony:

- Parses current version from the latest valid semver git tag
- Computes next version via standard semver bump types: `patch`, `minor`, `major`, `prepatch`, `preminor`, `premajor`, `prerelease`, `graduate`
- Stamps `.version` in all publishable package.json files
- Commits (`release: v<version>`), tags (`v<version>`), and pushes (commit + tag)
- CI takes over from the tag push — no auto-publish on merge

Guards:
- Must be on `main` branch
- Working tree must be clean
- `--dry-run` flag previews without touching anything
- `--channel <name>` overrides the prerelease identifier (default: `next`)

### 2. Publish surface narrowed

5 packages ship: `properties`, `system`, `extract`, `vite-plugin`, `next-plugin`.

3 packages removed from publish pipeline:
- `core` — legacy Emotion-based builder, source absorbed into system
- `theming` — legacy theme builder, source absorbed into system
- (runtime and ui were already marked private in rc-surface-hardening)

### 3. Fixed versioning

All publishable packages share one version derived from the git tag. CI already implements this — the release script matches. Independent versioning adds no value for a tightly coupled system with a single author.

## Capabilities

### New Capabilities

- `release-script`: Local release automation via `bun release <bump>`. Semver arithmetic, tag creation, package.json stamping, branch/cleanliness guards.

### Modified Capabilities

- `ci-release-pipeline`: Version-bump and publish loops narrowed from 7 packages to 5. core and theming removed.
- `legacy-package-isolation`: core and theming marked `private: true`, preventing accidental publish.

## Impact

- `scripts/release.sh` — new file, release automation
- `package.json` (root) — `release` script alias added
- `.github/workflows/ci.yaml` — version-bump loop and publish loop narrowed to 5 packages
- `packages/core/package.json` — `private: true` added
- `packages/theming/package.json` — `private: true` added
- No changes to: builder chain, extraction pipeline, runtime, type system, tests

# `legacy/` — Archived Packages

Packages here are preserved for reference only. They do not install, build, or publish, and are excluded from the active dependency graph.

For the import-prohibition rule (`packages/*` and `e2e/*` MUST NOT import from `legacy/*`), see root `CLAUDE.md` § One-Way Dependency Rule.

## Current Legacy Packages

| Path | Former published name | Status |
|---|---|---|
| `legacy/core/` | `@animus-ui/core` | Old emotion-runtime CSS-in-JS foundation. Superseded by `@animus-ui/system`. |
| `legacy/theming/` | `@animus-ui/theming` | Theme utilities built on `core`. `createTheme` / `ThemeBuilder` re-exported by `@animus-ui/system`. |
| `legacy/ui/` | `@animus-ui/components` | Legacy component library built on `core` + `theming`. No replacement in active graph. |
| `legacy/_docs/` | `@animus-ui/docs` | Old documentation app. Superseded by `@animus-ui/showcase`. |
| `legacy/runtime/` | `@animus-ui/runtime` | Runtime shim stub. Orphan — imported by nothing. |

## No Manifests

Legacy packages have no `package.json` files — they are pure reference source. This is intentional: there's no installable target, and the omission removes legacy declarations from the surface that security scanners (Dependabot, GitHub Advisory) crawl. Anyone trying to build or install from a legacy subdirectory will fail at the manifest lookup; that failure is the intended signal. For the version each package shipped at before archival, use `git log --follow legacy/<name>/package.json` to recover the deleted manifest.

## Archived Openspec Path References

Archived `openspec/changes/archive/*/` content may reference `packages/<legacy-name>/` paths that no longer exist on disk. These are historical records and are NOT rewritten. Use `git log --follow legacy/<name>/<file>` to trace history across the move.

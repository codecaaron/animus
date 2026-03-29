## Why

The monorepo's package graph was designed around the old Emotion-based world (core → theming → components). The extraction pipeline changes what ships: the entire extraction pipeline is framework-agnostic, and the ONLY framework coupling is the runtime shim (`createComponent`). The current package structure leaks implementation details (consumers shouldn't need to know about `@animus-ui/theming` or `@animus-ui/runtime` as separate packages), and four of six publishable packages are blocked by `private: true` and missing metadata. The `next` branch needs a clean publishing surface for beta releases under `--tag next`.

## What Changes

- **BREAKING**: Rename `@animus-ui/runtime` → `@animus-ui/react`. The runtime shim is React-specific — naming it `react` makes the framework coupling explicit and opens the door for `@animus-ui/vue` etc.
- **`@animus-ui/system` re-exports theming**: `createTheme` and other theming public API re-exported from system so consumers never import `@animus-ui/theming` directly. Theming becomes an internal dependency.
- **Vite plugin gains `runtime` option**: String option (defaults to `'@animus-ui/react'`) controlling which package the transformed source imports `createComponent` from. Makes the plugin framework-agnostic.
- **Kill vite-plugin's `@animus-ui/core` dependency**: `config-serializer.ts` and `resolve-transforms.ts` import from core but are legacy — the system's `.serialize()` already provides everything they compute. Remove these files and the core dependency.
- **Publishing metadata**: Remove `private: true`, add `author`, `license`, `repository`, `publishConfig`, `exports`, `files` to system, react, extract, vite-plugin.
- **Version alignment**: All publishable packages to `0.1.0-next.1` for initial beta.
- **`workspace:*` → version ranges**: Convert workspace protocol references to real semver ranges for npm compatibility.

### Packages that ship (new world)

| Package | Role | Framework-specific? |
|---------|------|-------------------|
| `@animus-ui/system` | Authoring surface (system + theming) | No |
| `@animus-ui/react` | React runtime shim | Yes (React) |
| `@animus-ui/vite-plugin` | Build tool | No |
| `@animus-ui/extract` | Rust NAPI crate | No |

### Packages that DO NOT ship

| Package | Reason |
|---------|--------|
| `@animus-ui/core` | Old Emotion-based builder. System has its own. |
| `@animus-ui/theming` | Re-exported through system. Internal dep only. |
| `@animus-ui/components` | Old Emotion UI components. Showcase replaces. |

## Capabilities

### New Capabilities
- `publishing-config`: Package metadata, exports fields, files fields, version alignment, and npm publishing configuration for all publishable packages.

### Modified Capabilities
- `extraction-runtime-shim`: Package renamed from `@animus-ui/runtime` to `@animus-ui/react`. Same API, new package name.
- `system-builder`: System re-exports theming public API (`createTheme` and related types).
- `vite-extraction-plugin`: Gains `runtime` option for framework-agnostic transform output. Removes `@animus-ui/core` dependency — legacy serialization code replaced by system's serialize output.

## Impact

- **`packages/runtime/`**: Renamed to `packages/react/`. `package.json` name changes to `@animus-ui/react`.
- **`packages/system/`**: Gains re-exports from `@animus-ui/theming`. Dependency on runtime changes to `@animus-ui/react`.
- **`packages/vite-plugin/`**: `@animus-ui/core` dependency removed. `config-serializer.ts` and `resolve-transforms.ts` deleted or rewritten. Transform output references configurable runtime package.
- **`packages/extract/`**: No code changes — only package.json metadata.
- **All publishable packages**: `private: true` removed, metadata added, `exports`/`files` fields added.
- **Showcase**: Import paths update from `@animus-ui/runtime` → `@animus-ui/react` (if any explicit imports exist — most are inserted by extraction).
- **Build order**: `extract → core → theming → react → system → vite-plugin` (core/theming still build for internal use, just don't publish).

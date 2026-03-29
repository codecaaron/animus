## Context

The monorepo has 8+ packages from the old Emotion-based architecture. The extraction pipeline (shipped on `next` branch) replaces Emotion entirely, but the package graph still reflects the old world. Four packages need to publish but are blocked by `private: true` and missing metadata. The runtime shim is named generically (`@animus-ui/runtime`) despite being React-specific. The vite-plugin still imports from `@animus-ui/core` (legacy dead code) despite the system's `.serialize()` providing everything it needs.

The `next` branch is the new publishing baseline. No packages have been published from it yet.

## Goals / Non-Goals

**Goals:**
- Clean publishable surface: 4 packages (`system`, `react`, `vite-plugin`, `extract`)
- Framework-agnostic extraction pipeline — only the runtime shim couples to a framework
- Consumers install 2 packages: `@animus-ui/system` + `@animus-ui/vite-plugin` (+ `@animus-ui/react` as a dep or explicit install)
- Beta publish under `npm publish --tag next` as `0.1.0-next.1`

**Non-Goals:**
- Vue/Svelte/Solid runtime shims — future work, just ensuring the architecture allows it
- Removing core/theming packages from the monorepo — they stay for internal use and backward compat, just don't publish
- Automated release pipeline — manual `npm publish` for now, CI release job is a separate change
- Bundling theming INTO system's dist — system re-exports from theming, theming ships as a dependency

## Decisions

### 1. Runtime → React: rename the package

`packages/runtime/` → `packages/react/`. Package name `@animus-ui/runtime` → `@animus-ui/react`. The API is unchanged — `createComponent` stays the same. Only the package identity changes.

**Why rename the directory too?** Convention. The package name and directory name should match. `packages/react/` makes it obvious what framework this package serves.

**Migration:** Update all import paths in the monorepo. The extraction pipeline inserts `import { createComponent } from '@animus-ui/runtime'` — this changes to `@animus-ui/react`. The vite-plugin controls this string.

### 2. Vite plugin `runtime` option

```typescript
animusExtract({
  system: './src/ds.ts',
  runtime: '@animus-ui/react',  // default
})
```

The plugin uses this string when generating `createComponent` imports in transformed source. Currently hardcoded to `'@animus-ui/runtime'` — becomes configurable with a default.

**Why a string, not an enum?** Future framework runtimes are unknown. A string allows `'@animus-ui/vue'`, `'my-custom-runtime'`, or any package that exports `createComponent`.

### 3. System re-exports theming

```typescript
// packages/system/src/index.ts
export { createTheme } from '@animus-ui/theming';
export type { ThemeBuilder, /* etc */ } from '@animus-ui/theming';
```

Consumers write `import { createSystem, createTheme } from '@animus-ui/system'`. Theming stays as a separate internal package (for build order and separation of concerns) but isn't part of the public API surface.

**Why not bundle theming into system's dist?** Theming is also used by core (old world). Keeping it as a separate package avoids circular dependencies and keeps the build graph clean. Re-exporting is simpler and maintains a single source of truth.

### 4. Kill vite-plugin's core imports

Two files import from `@animus-ui/core`:
- `config-serializer.ts` — builds a `TRANSFORM_MAP` and serializes prop config. **Replaced by** `ds.serialize().propConfig` and `ds.serialize().transforms`.
- `resolve-transforms.ts` — builds a transform registry from core's prop groups. **Replaced by** the in-memory transform registry from `ds.serialize().transforms`.

Both are legacy from before the system package existed. The system's `.serialize()` already provides everything these files compute. Delete both files and remove the `@animus-ui/core` dependency from vite-plugin.

### 5. Version alignment: `0.1.0-next.1`

All four publishable packages start at `0.1.0-next.1`. The `-next.N` suffix keeps `latest` tag clean on npm. Publish with `npm publish --tag next`. Consumers install via `bun add @animus-ui/system@next`.

Theming stays at whatever version it's at internally — it's a dependency of system but not directly published to consumers.

### 6. Package metadata pattern

All four publishable packages get:

```json
{
  "author": "Aaron Robb <airrobb@gmail.com>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/codecaaron/animus.git",
    "directory": "packages/<name>"
  },
  "homepage": "https://github.com/codecaaron/animus",
  "publishConfig": { "access": "public" },
  "files": ["dist"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs"
    }
  }
}
```

Extract's `files` field is different: `["index.js", "index.d.ts", "*.node"]` (NAPI binary pattern).

System has additional subpath exports: `"./groups"` for the prop group re-exports.

## Risks / Trade-offs

**Theming as transitive dependency** → Consumers don't install it directly, but it appears in their `node_modules`. If theming has a bug, consumers can't pin it independently. → Mitigated by versioning system and theming together.

**`resolve-transforms.ts` deletion** → This subprocess is used during buildStart for transform post-processing. Need to verify the system's serialize path fully replaces it. → The system path already works for showcase (it was shipped in the global styles subprocess change).

**React in package name** → Commits to "this package is React-only." If someone uses it with Preact (compatible API), the name is misleading. → Acceptable — Preact users can set `runtime: '@animus-ui/react'` and it works. The name reflects the primary target.

## Open Questions

- **Should `@animus-ui/react` re-export system types?** E.g., `import type { AnimusComponent } from '@animus-ui/react'`. Probably not — keep react as a thin shim. Types come from system.
- **Should theming be listed as a `dependency` or `peerDependency` of system?** Dependency (consumers shouldn't need to know about it). But this means version coordination is on us, not the consumer.

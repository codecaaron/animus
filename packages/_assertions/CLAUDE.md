# @animus-ui/assertions

Shared, position-aware assertion utilities for post-build verification.

## Surface

```ts
import {
  assertLayerOrder,
  assertNoPlaceholders,
  assertClassNameFormat,
  assertNoUnresolvedTokens,
  assertNoEmotionImports,
  findCssFiles,
  findJsFiles,
  readAsset,
  readAllConcat,
  AssertionError,
} from '@animus-ui/assertions';
```

All assertion helpers throw `AssertionError` (with a `details` payload) on failure and return `void` on success. They are pure functions over strings — no I/O, no globals — except for the `find*Files` / `read*` helpers, which read the filesystem.

## Why position-aware

Shell `grep` checks string presence but cannot validate cascade order. The Lightning CSS cascade bug (`fix-lightningcss-cascade`) shipped through `grep`-based assertions because the layer markers were present — just in the wrong position. `assertLayerOrder` uses character-index comparison so misordered output fails fast.

Default expected order:

```
@layer (declaration) → :root (variables) → @layer anm-global → @layer anm-base → @layer anm-variants
```

Pass a custom `layers` array to override.

## Consumers

- `e2e/next-app/scripts/assert-build.ts` — Next consumer fixture
- `e2e/vite-app/scripts/assert-build.ts` — Vite consumer fixture
- `scripts/assert-showcase-build.ts` — Showcase post-build assertions
- `packages/_integration/__tests__/manifest-shape.test.ts` — manifest shape (re-exports may live here later)

The one-way dependency rule (root `CLAUDE.md` § Workspace Topology) means `_assertions` must NOT import from `e2e/`. If a consumer needs to share types with `_assertions`, declare the type in `_assertions` and import it from the consumer — never the reverse.

## Build pipeline

Standard `tsdown && tsc -p tsconfig.build.json` (matches every other TS package). Picked up by `bun run build:ts` via the workspace filter. Consumers depend on the dist via `"@animus-ui/assertions": "workspace:*"`.

Unit tests live at `__tests__/assert-css.test.ts` and run via `verify:unit:ts` (path added in change `integration-test-infrastructure`).

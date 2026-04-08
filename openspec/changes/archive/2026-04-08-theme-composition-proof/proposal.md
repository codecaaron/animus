## Why

`.from()` theme composition works today — verified: deep merges colors, scales, breakpoints, and color modes; same-name scales merge (union of keys); serialization round-trips correctly. But there is zero visibility into this capability: no showcase section, no docs page, no example code. The "second app" story — a consumer extending a library theme — is the first question any team evaluating Animus for org-wide adoption will ask, and currently the answer is "trust us, it works."

## What Changes

- **Showcase Examples page**: New "Theme Composition" section demonstrating `createTheme().from(referenceTokens)` with additive colors and scales, rendering test-ds components against the extended consumer theme.
- **Docs content**: New `content/architecture/theme-extension.md` documenting the three extension mechanisms: `.from()` (full theme), `.addColors()` / `.addScale()` after `.from()` (additive), and selective spread (cherry-pick scales).
- **test-ds reference**: The showcase already imports `referenceTokens` from `@animus-ui/test-ds` — the docs page will explain what this token contract means and how consumers honor or extend it.

## Capabilities

### New Capabilities
- `theme-composition-showcase`: Showcase section demonstrating `.from()` theme extension with test-ds referenceTokens — import, extend, render, verify.
- `theme-extension-docs`: Docs page explaining the three theme extension patterns (from, additive, selective spread) with code examples and the token contract concept.

### Modified Capabilities

(none)

## Impact

- **Files**: `packages/showcase/src/pages/Examples.tsx` (new section), `packages/showcase/src/content/architecture/theme-extension.md` (new), `packages/showcase/src/constants/docsNav.ts` (nav entry)
- **No code changes**: All changes are showcase content and documentation. No runtime, type, extract, or plugin changes.
- **Dependencies**: Uses existing `@animus-ui/test-ds` exports (`referenceTokens`, `Button`, `Card`) — no new dependencies.

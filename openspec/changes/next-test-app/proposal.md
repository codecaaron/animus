## Why

The `next-webpack-plugin` change needs an integration proof — a real Next.js application that builds and renders using the extraction pipeline through webpack. Showcase serves this role for Vite but can't validate webpack, App Router RSC, Pages Router SSR, or the multi-compiler lifecycle. Without a test app, the plugin is untestable until a consumer adopts it.

Next.js uniquely supports both `app/` (App Router, RSC by default) and `pages/` (Pages Router) in the same project. A single test app can exercise both rendering models, proving extraction works across server components, client components, and traditional SSR pages.

## What Changes

### 1. New Package: `packages/next-test-app/`

Minimal Next.js application — not a design showcase but a pipeline verification fixture. Private package, not published.

**Design system** (`src/ds.ts`): Shared `createSystem()` + `createTheme()` with ~3 scales (colors, space, fontSizes), 1 color mode (dark/light), basic reset via `withGlobalStyles`. Reuses patterns from showcase but stripped to minimum viable config.

**Components** (6-8 total, covering behavioral taxonomy):
- **Base styles** — simple box/container with `.styles()` only
- **Variants** — button with size + intent variants
- **States** — toggle with hover/disabled states
- **System props** — layout box with `.system({ space: true, layout: true })`
- **Composition** — `compose()` family with Root + Child slots sharing a variant
- **Transforms** — component using a named transform (e.g., `size`)

**App Router pages** (`app/`):
- RSC page — server component importing extracted components directly (no `"use client"`)
- Client page — `"use client"` component with interactive variant toggling (useState)
- Root layout — imports `.animus/styles.css` (or `virtual:animus/styles.css` depending on plugin)

**Pages Router page** (`pages/`):
- One page importing shared extracted components, proving traditional SSR extraction works
- `_app.tsx` imports the CSS stylesheet

**Shared component** — at least one component imported by both App Router and Pages Router pages, proving cross-router extraction produces consistent output.

### 2. Post-Build Assertions

Shell script (like `scripts/assert-showcase.sh`) that greps the build output for:
- `@layer` declarations present in CSS output
- `animus-` class name pattern in HTML
- No `@emotion` imports in JS bundles
- No `__TRANSFORM__` placeholders in CSS output
- Both App Router and Pages Router pages rendered

### 3. Verification Command

Root-level script: `bun run test:next` (or similar) that builds the Next.js app and runs assertions.

## Capabilities

### New Capabilities
- `next-test-app-structure`: Package layout, Next.js config with withAnimus, dual-router directory structure
- `next-test-app-fixtures`: Component fixtures covering extraction behavioral taxonomy
- `next-test-app-assertions`: Post-build validation of extraction output

### Modified Capabilities
(none — this is a new test fixture, no existing specs change)

## Impact

- **New package:** `packages/next-test-app/` — Next.js app, private, not published
- **Root `package.json`:** Add to workspaces array
- **Root scripts:** Add `test:next` verification command
- **Dependencies:** `next`, `react`, `react-dom`, `@animus-ui/system`, `@animus-ui/next-plugin`
- **No changes to:** any existing packages, extraction pipeline, type system, or test infrastructure

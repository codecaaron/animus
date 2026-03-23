## Context

The extraction pipeline (Arcs 1-5) is complete: static styles, variants, states, system props, extension chains, dead variant elimination, package resolution, and CSS variable emission all work. The smoke test validates individual features but uses an inline Vite plugin that bypasses real package integration. The showcase app is the first REAL consumer of the published package surface.

## Goals / Non-Goals

**Goals:**
- Demonstrate real-world Vite plugin setup (import, configure, build)
- Use ThemeBuilder with evaluateTheme for color mode variable emission
- Exercise the full Animus API vocabulary in a visually polished app
- Discover integration gaps that unit tests and the smoke test miss
- Serve as a reference implementation for future consumers

**Non-Goals:**
- Routing / multi-page app (single page with sections is sufficient)
- Server-side rendering (pure SPA for now)
- Fixing Emotion type dependencies in theming package (noted tech debt)
- Publishing packages to npm (workspace resolution is sufficient)

## Decisions

### 1. Package setup: workspace deps, no source aliases

The showcase uses Bun workspace resolution to depend on `@animus-ui/core`, `@animus-ui/theming`, `@animus-ui/vite-plugin`, and `@animus-ui/runtime`. No Vite `resolve.alias` pointing at source directories. This tests the actual package exports and dist builds.

**Constraint:** Packages must be built first (`bun run build` at root). The showcase's `package.json` lists workspace deps, and Bun resolves them to `packages/*/dist/`.

### 2. Theme evaluation via Bun subprocess

`evaluateTheme` requires `ssrLoadModule`, which is a Vite server API. For build-time evaluation in `vite.config.ts`, we use a Bun subprocess pattern:

```ts
import { execSync } from 'child_process';
const themeData = JSON.parse(
  execSync('bun -e "..."', { encoding: 'utf-8' })
);
```

The subprocess imports `ThemeBuilder`, builds the theme, and calls `evaluateTheme` with a mock ssrLoadModule that just returns the built theme. This produces `{ scalesJson, variableCss }` which is passed to `animusExtract({ theme: { scales, variables } })`.

**Alternative considered:** Direct `import()` in vite.config.ts. Rejected because the theme module may import from `@animus-ui/theming` which has CJS/ESM interop issues in Vite's config context.

### 3. Component architecture: primitives → compositions → sections

```
COMPONENT HIERARCHY
═══════════════════

Primitives (animus.styles + groups + asElement):
  Box, Text, Stack, Container

Compositions (Primitive.extend + variants + states):
  Button, Card, Badge, Input, Link

Sections (React components using compositions):
  Hero, Features, ComponentShowcase, Footer
```

Each level exercises different extraction capabilities:
- Primitives: base styles + system props (groups)
- Compositions: extension chains + variants + states + responsive values + pseudo-selectors
- Sections: JSX usage of all the above, demonstrating reconciliation (dead variant elimination)

### 4. Frontend design skill for visual implementation

The actual component styling and page layout will be implemented via the `frontend-design` skill. The design should be distinctive — not a generic Tailwind-style landing page. It should feel like a design system documentation site that IS the design system.

## Risks / Trade-offs

- **[Package build order]** → Showcase depends on built dist/ for all packages. If a package hasn't been built, imports fail. Mitigation: document build prerequisite, or add a `prebuild` script.
- **[ThemeBuilder Emotion type dep]** → `@animus-ui/theming` imports `Theme` from `@emotion/react` at the type level. This doesn't affect runtime but may cause tsc errors if `@emotion/react` isn't installed. Mitigation: include `@emotion/react` as a dev dependency in the showcase, or skip typecheck for now.
- **[evaluateTheme gap]** → `evaluateTheme` expects `_variables` and `_tokens.modes` on the theme object. If the ThemeBuilder doesn't populate these correctly (hasn't been tested end-to-end), the Bun subprocess will fail. This IS the gap we're testing for.

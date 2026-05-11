## Context

The extraction pipeline (Arcs 1-5) is fully tested at the NAPI function level but has never been exercised through a real Vite build. The smoke test app validates the full vertical: Vite plugin → Rust analysis → CSS generation → source transformation → React rendering → browser styling.

The app is intentionally minimal — just enough components to exercise each extraction feature. It lives in `packages/smoke-test/` as a private, non-published package.

## Goals / Non-Goals

**Goals:**
- `vite build` succeeds with extraction enabled
- Produced `dist/` contains HTML, JS bundle, and extracted CSS
- CSS contains `@layer base, variants, states, system, custom;` with real rules
- JS bundle uses `createComponent` from the runtime shim (no Emotion imports)
- App renders correctly when served via `vite preview`

**Non-Goals:**
- Production-ready app (this is a smoke test, not a demo)
- Dev mode / HMR (extraction is production-only for now)
- Theme provider or color modes (static theme values only)
- Testing the Vite plugin's package resolution (the app uses direct workspace aliases)
- Source maps (not implemented yet)

## Decisions

### 1. Inline extraction plugin instead of importing @animus-ui/vite-plugin

The Vite plugin package imports from `@animus-ui/core/transforms` which requires workspace package resolution. In the smoke test's isolated context, this creates circular resolution issues. Instead, the smoke test defines a minimal inline plugin function that:
- Loads the NAPI addon directly via `require('../extract/index.js')`
- Loads the serialized config via Bun subprocess (to handle TypeScript generics)
- Calls `analyzeProject` and `transformFile` directly

This avoids workspace resolution complexity while testing the same Rust functions.

### 2. Pre-serialized config via Bun subprocess

The `serialize-config.ts` fixture contains TypeScript generics (`Map<Function, string>`) that Node's CJS `require()` can't parse. The smoke test runs Bun as a subprocess to evaluate the fixture and produce JSON, which is then consumed by the Vite config.

### 3. Workspace aliases for @animus-ui/* imports

```typescript
resolve: {
  alias: {
    '@animus-ui/core': join(__dirname, '../core/src'),
    '@animus-ui/runtime': join(__dirname, '../runtime/src'),
  },
}
```

This lets the app's source files use standard `import { animus } from '@animus-ui/core'` and `import { createComponent } from '@animus-ui/runtime'` — the same imports that extraction produces in transformed code.

### 4. Static theme (no theme provider)

The smoke test uses hardcoded CSS values in the theme JSON (e.g., `colors.primary: '#6366f1'`), not CSS variables from a ThemeProvider. This means the app works without Emotion, without a provider tree, and without color mode support. Colors are static hex values, not `var(--colors-primary)`.

### 5. Components exercise all extraction features

The smoke test components cover:
- `.styles()` with static values and pseudo-selectors (`&:hover`)
- `.variant()` with `defaultVariant` and multiple options
- `.states()` with boolean toggles
- `.groups()` with system props (space, layout, color, typography, flex)
- Responsive values (object syntax: `{ _: 16, sm: 32 }`)
- JSX callsites with static system prop values

## Risks / Trade-offs

**[Risk] NAPI addon not loadable from smoke test context** → Mitigation: use relative path `../extract/index.js`. The addon must be pre-built (`bunx @napi-rs/cli build --platform`).

**[Risk] Bun subprocess for config serialization adds build time** → Mitigation: one-time cost at vite config load. ~50ms for Bun to evaluate the fixture.

**[Trade-off] Inline plugin vs real plugin** → The inline plugin tests the same Rust functions but doesn't test the real Vite plugin's file discovery, package resolution, or theme evaluation. Those are tested separately in the canary integration tests.

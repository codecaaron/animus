## Context

The Animus extraction pipeline is split into two layers: a bundler-agnostic Rust crate (OXC + Lightning CSS + NAPI) and a thin bundler-specific glue layer. Today the only glue is `@animus-ui/vite-plugin`. The Rust crate's three NAPI functions (`extract`, `analyze_project`, `transform_file`) take and return plain JSON strings with zero bundler coupling.

Next.js uses webpack (configurable) or Turbopack (default in dev, limited extensibility). Turbopack has no plugin API for custom Rust transforms — every CSS extraction tool in the ecosystem (vanilla-extract, StyleX, Panda) requires webpack mode for custom build integration. This is an industry-wide gap, not an Animus-specific limitation.

The Vite plugin currently hardcodes `virtual:animus/styles.css` as the CSS delivery mechanism and `@animus-ui/runtime` as the runtime import path. Both need to become configurable to support alternative bundler integrations.

## Goals / Non-Goals

**Goals:**
- Next.js webpack integration that reuses 100% of the existing Rust crate
- Single analysis pass shared across Next.js multi-compilation (server, client, edge)
- Both Pages Router and App Router supported with the same plugin/loader — no separate entry points
- RSC-compatible runtime path via React 19 ref-as-prop
- Dev-mode HMR with geological reset detection
- Config wrapper DX matching vanilla-extract's `withVanillaExtract(nextConfig)` pattern

**Non-Goals:**
- Turbopack plugin (no API exists; revisit when one ships)
- Auto-injection of `"use client"` directives (user controls component boundaries)
- Auto-detection of CSS import location (user adds the import in `_app.tsx` or `layout.tsx`)
- SWC plugin (unnecessary — webpack loader calls our NAPI binary directly)
- Incremental/per-file analysis in the webpack plugin (whole-project analysis is fast enough — 57ms/32 files benchmarked)

## Decisions

### Decision 1: Webpack plugin + loader, not SWC plugin

**Choice:** Custom webpack plugin (for build lifecycle) + webpack loader (for per-file transforms), calling our existing NAPI binary.

**Alternatives considered:**
- SWC plugin: Would require rewriting chain-walking logic in SWC's visitor API. SWC plugins are Wasm-based with limited capabilities. We'd lose OXC's zero-copy arena AST and our entire crate composition. Massive effort, no benefit.
- Babel plugin: Slower than NAPI by orders of magnitude. Would need to reimplement all extraction logic in JS. No.
- Turbopack loader: Only supports JS output, no `emitFile`, no virtual modules. Cannot do what we need today.

**Rationale:** The NAPI binary is already compiled for 3 platforms. Webpack loaders run in Node.js. Calling a NAPI function from a webpack loader is trivially cheap (~1ms overhead). We keep our entire pipeline and just write thin glue.

### Decision 2: Real CSS file on disk, not virtual modules

**Choice:** Write extracted CSS to `.animus/styles.css` in the project root. User imports it explicitly.

**Alternatives considered:**
- `webpack-virtual-modules`: Works but adds a dependency and complexity. Virtual module state management across multi-compilation is fragile.
- Inline `<style>` injection via `useServerInsertedHTML`: Runtime approach, defeats the purpose of build-time extraction.
- CSS module output via webpack `emitFile`: Ties CSS to the webpack compilation lifecycle, harder to share across server/client passes.

**Rationale:** A real file is the simplest, most debuggable approach. It works with both Pages Router and App Router. The user controls exactly where the CSS import goes. No virtual module abstraction to maintain. Vanilla-extract and Panda both use this pattern.

### Decision 3: Single manifest cached above compiler instances

**Choice:** The webpack plugin runs `analyze_project()` once and stores the manifest in a module-level variable shared across all compilation passes.

**Why:** Next.js webpack runs 2-3 times per build (server, client, edge). Each gets its own `compiler` instance. If we analyze per-compiler, we waste 2-3x the time for identical results. The manifest is deterministic — same source + same config = same manifest regardless of compilation target.

**Implementation:** Module-level `let cachedManifest: string | null = null` outside the plugin class. First compiler to reach `make` hook runs analysis and populates cache. Subsequent compilers read from cache.

### Decision 4: Router-agnostic plugin — no separate entry points

**Choice:** One plugin, one loader, works for both Pages Router and App Router. No detection of which router is in use.

**Why:** The webpack layer is identical for both. The only difference is where the user puts their CSS import (`_app.tsx` vs `layout.tsx`). That's user-land configuration, not plugin logic. The loader transforms files identically regardless of routing model.

Pages Router components are all client-side. App Router components may be server or client. The plugin doesn't need to know — it transforms the source code the same way. The `"use client"` boundary is the user's concern, not ours.

### Decision 5: Configurable runtime import path via manifest

**Choice:** The Rust `transform_emitter.rs` reads the runtime import path and CSS module ID from a config section in the manifest JSON, instead of hardcoding `@animus-ui/runtime` and `virtual:animus/styles.css`.

**Why:** The Vite plugin needs `virtual:animus/styles.css`. The Next plugin needs no per-file CSS import (or a different path). The publishing-surface change renames runtime to `@animus-ui/react`. Making these configurable at the manifest level means the Rust crate serves any bundler integration without per-bundler code.

**Manifest config shape:**
```json
{
  "config": {
    "runtimeImport": "@animus-ui/react",
    "cssImport": "virtual:animus/styles.css"  // or "" for Next plugin
  }
}
```

### Decision 6: React 19 ref-as-prop for RSC compatibility

**Choice:** Update `createComponent` to accept `ref` as a regular prop instead of wrapping in `forwardRef`.

**Why:** `forwardRef` is deprecated in React 19. Components using it are forced into `"use client"` in Next.js App Router. Removing it makes fully-extracted Animus components server-component compatible — they're just functions that concatenate classNames and call `createElement`.

**Migration:** Non-breaking. React 19 supports both `forwardRef` and ref-as-prop. The change is purely internal to the runtime shim.

## Risks / Trade-offs

**[Webpack-only limitation]** → Users on Turbopack must pass `--webpack` flag. Mitigation: document clearly; this matches vanilla-extract and every other extraction tool's current guidance. Revisit when Turbopack ships plugin API.

**[Multi-compilation race condition]** → Two compiler instances could both try to run `analyze_project()` simultaneously. Mitigation: mutex via a simple boolean flag (`let analyzing = false`) plus a promise that subsequent callers await.

**[CSS file write timing]** → The CSS file must exist before webpack resolves imports to it. Mitigation: write CSS in `beforeCompile` hook, which fires before module resolution begins.

**[React 19 minimum version]** → ref-as-prop requires React 19. Mitigation: check React version at runtime; fall back to `forwardRef` for React 18. Or: just require React 19 — Next.js 15+ ships with it.

**[Dev HMR latency]** → Re-analysis + CSS file write on every save. Mitigation: content-hash caching (skip unchanged files) — same strategy as Vite plugin. Benchmarked at ~2ms/file.

**[No auto-detection of system path]** → Unlike Vite plugin, no auto-detection heuristic initially. Mitigation: require `system` option in v1. Add auto-detection later if demand warrants.

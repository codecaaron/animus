## Context

Pre-release cleanup driven by a 5-persona API surface audit. Three categories: correctness bug (memoization), dead code removal (serialize), and API clarity exploration (includes). Plus housekeeping for stale changes.

## Goals / Non-Goals

**Goals:**
- Fix the per-component-type memoization bug so dynamic system props work correctly with multiple instances
- Remove dead code that confuses source readers
- Document the `includes()` design question for future resolution
- Clean up stale openspec changes

**Non-Goals:**
- Implementing `includes()` multi-system composition (separate change)
- Adding `keyframes` first-class API (separate design exploration)
- Changing the `anm-system > anm-states` layer ordering (documented, intentional)
- Removing SHORTHAND_PROPERTIES from the TS properties package (harmless, useful as reference)

## Decisions

### Decision 1: Remove dynamic style memoization entirely

**Choice:** Remove closure-scoped `prevDynKey` / `prevDynStyle` variables from `createComponent`. Use `dynamicStyle` from `resolveClasses()` directly each render.

**Why removal over per-instance memoization:**
- `useRef` would break RSC compatibility — `forwardRef` works in server components but hooks do not. The original code comment explicitly noted "avoids useRef so createComponent stays hook-free and RSC-compatible."
- The memoization saved one object allocation per stable re-render — negligible cost for a small `Record<string, string>` with CSS variable assignments
- The closure-scoped cache caused cross-instance state leakage (last-rendered instance's cache could affect other instances via the asChild branch)
- No hooks = no client boundary requirement = RSC-compatible by default

### Decision 2: Remove GlobalStyleBlock.serialize()

**Choice:** Delete the `serialize()` method from the `GlobalStyleBlock` type and the `createGlobalStyles` factory. The `GlobalStyleMap` type and `GlobalStyleBlock.__brand` remain (they're used by the Rust system loader for brand checking).

**Why safe to remove:** Zero callers in the entire codebase. Actual serialization happens in Rust (`system_loader.rs` line ~1012 checks `__brand === "GlobalStyleBlock"`, extracts `.styles`). The TS method is dead code from before the Rust pipeline.

### Decision 3: Document includes() as exploration point

**Choice:** Add a JSDoc comment to `includes()` noting it's a no-op stub reserved for future multi-system composition. Do not remove or implement — the method is called in showcase and next-app fixtures, and removing it would break those files without providing value. The design question (constructor args vs method vs full implementation) is deferred to a separate change.

### Decision 4: Archive stale changes

**Choice:** Archive `rc-consumer-surface` and `vite-integration-patterns` as stale without applying or syncing (0 tasks completed in either, no delta specs).

## Risks / Trade-offs

**[Risk] useRef in the render path** — React strict mode double-invokes render functions. The ref persists across both invocations, which is correct for memoization (the cache should survive strict mode re-renders). No risk.

**[Risk] Removing serialize() breaks external consumers** — `serialize()` is on an internal branded type (`GlobalStyleBlock`) that's not part of the documented API. The type is used via `createGlobalStyles()` which returns the block; consumers pass blocks to system config, not call methods on them. Zero external call sites possible.

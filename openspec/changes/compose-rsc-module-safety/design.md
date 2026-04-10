## Context

`compose()` creates sealed component families with shared variant propagation. It currently accepts a `context: boolean` option — `false` (default) uses CSS descendant selectors, `true` adds React context for portal-crossing. The implementation imports `createContext`/`useContext` unconditionally at module scope, poisoning the entire `@animus-ui/system` package for React Server Components.

The extraction pipeline replaces `compose()` calls with `createComposedFamily()` at build time. But a use-after-drain bug in `project_analyzer.rs` causes `compose_replacements` to always be empty — compose calls are never actually replaced in production builds.

**Current module graph (all paths lead to createContext):**
```
@animus-ui/system (barrel)
  └─ index.js → createComposedFamily-USB1a_4O.js (shared chunk)
                  └─ import { createContext, useContext } from 'react'  ← POISONED

@animus-ui/system/runtime
  └─ runtime-entry.js → createComposedFamily-USB1a_4O.js (same chunk)  ← POISONED

@animus-ui/system/compose
  └─ compose.js → 'use client' → createContext/useContext              ← BOUNDED
```

## Goals / Non-Goals

**Goals:**
- Barrel (`@animus-ui/system`) and runtime entry (`/runtime`) MUST be RSC-safe — zero `createContext`/`useContext` in their transitive import graph
- Default `compose()` MUST be RSC-safe — CSS-only propagation, no hooks
- Context-based composition MUST be an explicit opt-in via a separate function and import path
- The extraction pipeline MUST correctly replace both `compose()` and `composeWithContext()` calls
- The drain bug MUST be fixed so compose replacements actually appear in manifests

**Non-Goals:**
- Making `composeWithContext` itself RSC-safe (it's inherently client-only — that's the point)
- Changing the CSS cascade propagation model (unchanged)
- Modifying the Vite plugin or Next plugin emitter config JSON (derive compose-context path from runtime_import)

## Decisions

### 1. Declarative function split over config flag

**Choice:** Two functions (`compose` / `composeWithContext`) instead of one function with `context: boolean`.

**Why:** RSC safety is a module-level property. A runtime config flag cannot create a module boundary. The function name IS the opt-in — you import from the safe path or the client path. No ambiguity, no accidental poisoning.

**Alternative considered:** Keep `context` flag, lazy-require createContext inside the function body. Rejected because `require()` in ESM is non-standard, behaves differently across bundlers, and doesn't communicate intent at the call site.

### 2. Separate subpath export for composeWithContext

**Choice:** `@animus-ui/system/compose-with-context` is a dedicated entry point with `'use client'`. Not re-exported from the barrel.

**Why:** If the barrel re-exports from a `'use client'` module, tsdown may inline the client code into the barrel chunk, re-poisoning it. Keeping client-only code out of the barrel's transitive graph is the only reliable defense. The subpath name makes the boundary visible.

**Alternative considered:** Re-export from barrel with `sideEffects: false` for tree-shaking. Rejected because RSC module analysis in Next.js runs before tree-shaking — the import graph includes all re-exports regardless of usage.

### 3. Extraction runtime split mirrors authoring split

**Choice:** `createComposedFamily` (context-free, in runtime) and `createComposedFamilyWithContext` (context-aware, in compose-with-context module).

**Why:** The extraction replacement must preserve the RSC boundary. If `compose()` is replaced with a function from the RSC-safe runtime, the file stays RSC-safe. If `composeWithContext()` is replaced, the emitter imports from the client module and injects `'use client'`.

### 4. Derive compose_context_import from runtime_import

**Choice:** `apply_replacements` derives the compose-context import path by stripping the subpath from `runtime_import` and appending `/compose-with-context`. No new EmitterConfig field needed.

**Why:** Both hosts (Vite: `@animus-ui/system`, Next: `@animus-ui/system/runtime`) share the same base package. Deriving keeps the emitter config stable and avoids NAPI signature changes.

**Derivation:** `@animus-ui/system/runtime` → `@animus-ui/system` → `@animus-ui/system/compose-with-context`.

### 5. Fix drain bug by reordering, not cloning

**Choice:** Move the `compose_replacements` build block before the cache storage loop in `project_analyzer.rs`.

**Why:** The cache loop drains `per_file_compose` via `.remove()`. Moving the build block before the drain is a one-line structural fix. Cloning the map would work but wastes memory for no reason.

## Risks / Trade-offs

**[Breaking change: `context` option removed]** → Mitigated by the fact that `context: true` was introduced in the same session as compose and has no known external consumers. Internal tests are the only migration.

**[Barrel could be re-poisoned by future changes]** → Mitigated by the structural rule: no `'use client'` module may be re-exported from the barrel. This is enforced by the subpath-only pattern for client code. A CI check could verify barrel RSC safety (future work).

**[tsdown chunk deduplication could merge modules]** → Risk: tsdown might merge `createComposedFamily` back into a chunk with client code. Mitigated by ensuring `createComposedFamily.ts` has zero transitive imports that touch hooks. After the fix, its only React imports are `forwardRef` and `createElement`.

**[Scanner must match both function names]** → Risk: consumer aliases `composeWithContext as cwc` would evade detection. Accepted: the scanner already requires literal `compose` as the callee name. Renaming via import alias is an unsupported pattern (same as existing compose).

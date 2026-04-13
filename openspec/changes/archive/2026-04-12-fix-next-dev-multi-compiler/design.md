## Context

The Next.js plugin writes CSS to disk via `writeFileSync` inside `runFullPipeline()` and `runIncrementalPipeline()`. In multi-compiler dev mode, non-executing instances have empty state and overwrite the good file. The Vite plugin avoids this with virtual modules. Webpack needs a different mechanism.

StyleX (Meta) demonstrates the proven webpack pattern: module-scope shared state + `processAssets` hook. CSS is injected into webpack's asset pipeline in-memory. The disk file is a resolution stub. All compilers read the same module-scope variable, making injection naturally idempotent.

## Goals / Non-Goals

**Goals:**
- Eliminate the multi-compiler CSS overwrite bug
- Deliver CSS via `processAssets` (in-memory) instead of disk writes
- Make multi-compiler handling naturally idempotent (no ownership/gating needed for correctness)
- Retain HMR functionality for CSS changes in dev mode

**Non-Goals:**
- Changing the Vite plugin (already uses virtual modules)
- Per-module CSS delivery (would require restructuring the extraction pipeline)
- Changing the NAPI/Rust extraction pipeline
- Changing the production `next build` output format

## Decisions

### Decision 1: Module-scope shared CSS via singleton

**Choice:** Add `sharedCss` getter/setter to `singleton.ts` using a module-scope variable (or `globalThis` for ESM/CJS safety, since singleton.ts already uses `globalThis`). All compiler instances read the same CSS.

**Why:** Module-scope sharing is the simplest mechanism (StyleX uses it). Our singleton.ts already uses `globalThis` to cross the ESM/CJS boundary — extend the same pattern for CSS. No new mechanism needed.

**Alternative considered:** Per-instance CSS with ownership gating. Rejected — requires tracking which compiler "owns" writes, adds complexity for the same result.

### Decision 2: `processAssets` hook replaces CSS asset content

**Choice:** In `apply()`, register `compilation.hooks.processAssets.tap()` at `PROCESS_ASSETS_STAGE_ADDITIONAL` (or `PRE_PROCESS`). The hook reads `sharedCss` from the singleton and replaces the `.animus/styles.css` asset content.

**Why:** `processAssets` fires after module resolution but before emission. The disk stub satisfies module resolution; `processAssets` injects the real content. Every compiler independently does this — all inject the same CSS from the shared variable. Naturally idempotent, zero coordination needed.

**Alternative considered:** Pitch loader that serves CSS from memory. Rejected — would bypass Next.js's CSS processing pipeline (postcss, etc.). `processAssets` operates within the pipeline.

### Decision 3: Disk writes for HMR trigger only

**Choice:** After the extraction pipeline updates `sharedCss`, write the CSS to disk to trigger webpack's file watcher. This causes a recompilation where `processAssets` picks up the new content. The disk content doesn't need to be perfect — `processAssets` overwrites it in-memory.

**Why:** webpack's HMR is driven by file system changes. Without a disk write, webpack doesn't know CSS changed. StyleX uses synthetic watcher events (`watcher.emit('change')`), but that requires reaching into webpack internals. A disk write is simpler and uses the existing mechanism. The race is now harmless because `processAssets` always replaces with the correct content.

**Alternative considered:** Synthetic watcher events (StyleX pattern). Viable but requires accessing `compiler.watchFileSystem.watcher.fileWatchers` — deep internal API that could break across webpack versions. Disk write is more stable.

### Decision 4: Edge compiler early exit

**Choice:** Check `compiler.options?.name === 'edge-server'` in `apply()` and skip hook registration entirely.

**Why:** Edge runtime has no CSS dependencies. Skipping it avoids unnecessary processAssets hooks and eliminates a redundant extraction trigger.

## Risks / Trade-offs

**[Risk: processAssets timing vs module resolution]** → The `.animus/styles.css` stub must exist on disk BEFORE webpack resolves modules. `with-animus.ts` creates it during the `webpack()` callback, which runs before compilation starts. Safe.

**[Risk: HMR disk write still races]** → Multiple instances could write to disk after extraction. This is now harmless — the disk content is only a trigger signal. `processAssets` replaces it with the correct content regardless of what's on disk. The race becomes a cosmetic issue (multiple writes of the same content), not a correctness issue.

**[Risk: processAssets stage ordering]** → Other plugins may also use processAssets. Using `PROCESS_ASSETS_STAGE_ADDITIONAL` (early stage) ensures our CSS is in place before other plugins process assets. If conflicts arise, the stage can be tuned.

**[Risk: Production build compatibility]** → `next build` uses a single compiler with `run` hook (not `watchRun`). `processAssets` still fires during production compilation. The same mechanism works for both dev and prod — no special-casing needed.

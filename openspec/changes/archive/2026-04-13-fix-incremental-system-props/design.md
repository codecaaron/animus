## Context

The Next.js webpack plugin has two pipeline paths: `runFullPipeline()` (first boot) and `runIncrementalPipeline()` (subsequent HMR updates). Both call `analyzeProject()` which returns a manifest containing `system_prop_map` and `dynamic_props`. The full pipeline extracts these, constructs `system-props.js` content, stores it in the globalThis singleton, and writes it to disk. The incremental pipeline skips all of this — it only handles CSS and the manifest JSON.

The Vite plugin has a single `runAnalysis()` function used for both initial and incremental paths, so it never has this divergence. The virtual module is always fresh.

A secondary bug: the incremental pipeline's `emitterConfig` was copy-pasted incorrectly. It sets `css_module_id` to the system-props.js path and omits `system_props_module_id`, causing incorrect import paths in Rust-emitted replacement strings after incremental re-analysis.

## Goals / Non-Goals

**Goals:**
- New system prop usages added during Next.js dev HMR resolve correctly at runtime
- Content-hash guarded disk write prevents unnecessary JS module invalidation
- EmitterConfig consistency between full and incremental pipeline paths
- Follow established patterns (identical to CSS write path)

**Non-Goals:**
- Virtual module approach for system-props in webpack (longer-term, separate change)
- Unifying full/incremental into a single method (would require larger refactor)
- Dynamic prop transform function serialization (not yet supported, tracked separately)

## Decisions

### 1. Mirror the full pipeline's system-props extraction in incremental

Extract `system_prop_map` and `dynamic_props` from the manifest, construct the same 4-export module content, call `setSharedSystemProps()`, and write to disk with a content-hash guard.

**Rationale**: This is the minimal correct fix. The Vite plugin does exactly this — every `runAnalysis()` call updates the stored system prop map. The code is already written in `runFullPipeline()` lines 595-629; the incremental path just needs the same block.

**Alternative considered**: Extracting a shared helper method for system-props construction. Decided against — would require refactoring `runFullPipeline()` at the same time, increasing scope beyond bug fix.

### 2. Content-hash guard (lastSystemPropsHash) to prevent unnecessary disk writes

Add a `lastSystemPropsHash` instance field, same pattern as existing `lastCssHash`. Only write to disk when content actually changed.

**Rationale**: System-props.js disk write triggers webpack's file watcher → JS module invalidation → React re-render cascade. If the system prop map didn't change (e.g., only a style value changed, not a new prop usage), writing is wasteful and causes unnecessary JS HMR churn.

### 3. Fix emitterConfig to match full pipeline

Set `css_module_id: '.animus/styles.css'` and add `system_props_module_id: join(animusDirPath, 'system-props.js')`.

**Rationale**: Direct copy-paste bug. The Rust emitter uses these values to generate import paths in replacement strings. Wrong values produce incorrect imports that won't be properly handled by the loader's CSS import regex or webpack's module resolution.

## Risks / Trade-offs

**[Risk: HMR storm from system-props write]** → Mitigated by content-hash guard. The write only happens when the map actually changes (new prop usage detected). The re-render triggered by the JS module update does not produce new CSS changes, so the cycle terminates.

**[Risk: groupRegistryJson stale in incremental]** → Not a risk. `groupRegistryJson` is set during `loadSystem()` and only changes on geological reset (system file change), which triggers a full pipeline re-run. It's safe to reuse in the incremental system-props construction.

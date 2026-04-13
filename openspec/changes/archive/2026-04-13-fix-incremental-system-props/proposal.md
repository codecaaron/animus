## Why

In Next.js dev mode, adding a new system prop usage to JSX (e.g., `px={16}` where `px` wasn't previously used) generates the correct CSS utility class but the runtime never applies it. The `systemPropMap` in `.animus/system-props.js` is frozen at the initial boot state because `runIncrementalPipeline()` never rebuilds or rewrites it. A secondary copy-paste bug in the incremental pipeline's `emitterConfig` sets `css_module_id` to the system-props path instead of `styles.css` and omits `system_props_module_id` entirely, producing incorrect import paths in transformed output after incremental re-analysis.

## What Changes

- `runIncrementalPipeline()` extracts `system_prop_map` and `dynamic_props` from the manifest after re-analysis (same logic as `runFullPipeline()`)
- Reconstructs and writes `system-props.js` with content-hash guard (no-write-if-unchanged) to trigger JS HMR only when the map actually changes
- Calls `setSharedSystemProps()` so all compiler instances share the updated content
- Fixes the `emitterConfig` in `runIncrementalPipeline()` to match `runFullPipeline()`: correct `css_module_id` and includes `system_props_module_id`

## Capabilities

### New Capabilities

_None — this is a gap-fill in existing capabilities._

### Modified Capabilities

- `next-dev-hmr`: Add requirement that incremental re-analysis updates system-props.js alongside CSS, with content-hash guard and HMR trigger
- `extraction-emitter-config`: Add `system_props_module_id` field requirement and require emitterConfig consistency between full and incremental pipeline paths

## Impact

- **Code**: `packages/next-plugin/src/plugin.ts` — `runIncrementalPipeline()` method (~15 lines added), `emitterConfig` object (2-line fix)
- **Runtime**: New system prop usages in JSX will resolve at runtime during Next.js dev HMR (currently broken)
- **Performance**: Additional disk write only when system-props content actually changes (content-hash guard). No impact on unchanged-file case.
- **No breaking changes**: Additive fix, no API surface changes

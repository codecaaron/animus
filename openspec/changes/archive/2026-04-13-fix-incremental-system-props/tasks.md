## 1. Fix emitterConfig copy-paste bug

- [x] 1.1 In `runIncrementalPipeline()`, fix `emitterConfig`: set `css_module_id` to `'.animus/styles.css'` and add `system_props_module_id: join(animusDirPath, 'system-props.js')`

## 2. Add system-props reconstruction to incremental pipeline

- [x] 2.1 Add `lastSystemPropsHash` instance field (same pattern as `lastCssHash`)
- [x] 2.2 After manifest parse in `runIncrementalPipeline()`, extract `system_prop_map` and `dynamic_props` from manifest, construct `systemPropsContent` (same 4-export format as `runFullPipeline()` lines 595-626)
- [x] 2.3 Call `setSharedSystemProps(systemPropsContent)` and write to disk with content-hash guard (`lastSystemPropsHash`)
- [x] 2.4 Include `lastSystemPropsHash` in `resetForHmr()` null-reset (same as `lastCssHash`)

## 3. Verify

- [x] 3.1 Build the next-plugin package (`bun run --filter '@animus-ui/next-plugin' build`) and confirm no TS errors

## Why

Three-lens DX review (agnostic, adversarial, evangelist) of the consumer surface identified two real bugs and several hygiene items. The bugs affect serialization correctness for inline scales and create maintenance risk from code duplication. The hygiene items are low-effort fixes that eliminate DX traps and stale artifacts. Fixing these now hardens the system before broader adoption.

## What Changes

- Fix MapScale/ArrayScale serialization in `SystemBuilder.serialize()` — inline object/array scales are silently dropped when serializing prop configs to Rust. The Rust side already handles them; the TS serializer only passes string scale references.
- Extract duplicate `deepMerge` from `Animus.ts` and `AnimusExtended.ts` into a shared utility module.
- Deprecate or remove vestigial `.build()` method on the component builder chain — it returns `() => ({})` cast to `(props) => CSSObject`, which is a type-level lie.
- Namespace `globalThis` keys in vite-plugin with system path hash to prevent multi-build collisions.
- Remove stale comment in `Card.tsx:12-14` that claims slots need export for extraction — `scan_compose_calls` already handles this.
- Make subprocess failures throw in strict mode instead of warning silently.

## Capabilities

### New Capabilities
- `inline-scale-serialization`: Fix SystemBuilder.serialize() to pass inline MapScale/ArrayScale objects to Rust extractor alongside string scale references
- `build-pipeline-hardening`: Strict mode subprocess failures, globalThis namespacing, stale artifact cleanup

### Modified Capabilities

## Impact

- `packages/system/src/SystemBuilder.ts` — serialize() scale handling
- `packages/system/src/Animus.ts` — deepMerge extraction, .build() deprecation
- `packages/system/src/AnimusExtended.ts` — deepMerge extraction
- `packages/vite-plugin/src/index.ts` — globalThis namespacing, strict mode throw
- `packages/showcase/src/components/surfaces/Card.tsx` — stale comment removal

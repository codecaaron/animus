## Why

Session 46 audit of RC readiness surfaced three gaps: (1) `.props()` transform return type allows CSSObject which the extraction pipeline doesn't handle yet, (2) `@animus-ui/properties` package missing from CI publish loops despite being a runtime dependency of both system and extract, (3) deprecated packages (ui/, runtime/) not marked private, risking accidental publish.

## What Changes

- Add `CustomPropConfig` type guard restricting `.props()` transform returns to `string | number` (CSSObject expansion tracked via TODO for rule-level transforms)
- Add `properties` to CI version-bump and publish loops in dependency-first position
- Mark `@animus-ui/components` (ui/) and `@animus-ui/runtime` as `private: true`
- Update system CLAUDE.md to document the properties runtime dependency

## Capabilities

### Modified Capabilities

- None — changes are type-level guard, CI config, and documentation. No behavioral changes to extraction or runtime.

## Impact

- `packages/system/src/types/config.ts` — new `CustomPropConfig` interface
- `packages/system/src/Animus.ts` — `.props()` constraint narrowed
- `packages/system/src/AnimusExtended.ts` — `.props()` constraint narrowed
- `packages/system/src/index.ts` — export `CustomPropConfig`
- `packages/system/__tests__/types.test-d.tsx` — positive + negative type assertions
- `.github/workflows/ci.yaml` — properties in publish loops
- `packages/ui/package.json` — private: true
- `packages/runtime/package.json` — private: true
- `packages/system/CLAUDE.md` — updated dependency documentation

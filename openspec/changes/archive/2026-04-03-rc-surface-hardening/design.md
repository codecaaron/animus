## Approach

### Transform Return Type Guard

The `Prop` interface is shared infrastructure — used by both group definitions (from core, wide type including CSSObject) and `.props()` calls (consumer-authored custom props). Narrowing `Prop` directly breaks group compatibility because core's Prop allows CSSObject returns.

**Solution**: Create `CustomPropConfig extends Prop` that overrides `transform` with a narrower return type (`string | number` only). Apply this constraint only at the `.props()` method boundary in both `Animus.ts` and `AnimusExtended.ts`. This is covariant-safe: `() => string | number` satisfies `() => string | number | CSSObject`.

The TODO documents the future expansion to CSSObject for rule-level transforms (one input prop mapping to multiple CSS declarations, e.g. font-smoothing → -webkit-font-smoothing + -moz-osx-font-smoothing).

### CI Publish Loop

`@animus-ui/properties` was created in the `properties-package` change but the CI workflow predated it. Properties publishes first in the TS package loop since both system and extract depend on it at runtime.

### Legacy Package Isolation

`@animus-ui/components` (packages/ui/) and `@animus-ui/runtime` are deprecated per CLAUDE.md ("not in build pipeline"). Adding `private: true` prevents accidental `npm publish`.

## Why

The public `withAnimus` adapter silently drops valid `extensions` and `layers`
options before constructing the Next webpack plugin, while the package README
shows an obsolete wrapper call shape. Addressing the typed boundary now gives
the high-churn plugin surface a focused behavioral guard without broad,
speculative refactoring.

## What Changes

- Forward the complete typed wrapper options object to the injected plugin.
- Add a public-boundary regression test for extension and layer options.
- Update the README setup example to the curried wrapper API.
- Strengthen the canonical wrapper option-forwarding requirement.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `next-config-wrapper`: Require every valid wrapper option, including
  `extensions` and `layers`, to reach the injected plugin.

## Impact

Affected surfaces are `packages/next-plugin/src/with-animus.ts`, a focused
next-plugin test, the package README, and the `next-config-wrapper`
specification. No public types, dependencies, plugin internals, build outputs,
or deployment systems change.

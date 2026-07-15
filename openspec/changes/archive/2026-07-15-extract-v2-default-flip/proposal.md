# Proposal: extract-v2-default-flip

## Why

The v2 extraction engine is parity-proven (47-unit differential, three
consumer oracles byte-identical, archived `2026-07-13-extract-v2-spine`)
and already runs the showcase by user directive — but npm consumers
cannot reach it: the `./engine-v2` export has no published binary behind
it, and the plugins still default to v1. Every day the two engines
coexist unshipped is dual-maintenance cost without the payoff (8× fewer
parses, no cache machinery, faster dev loops). Shipping the binary and
flipping the defaults are one release event — done together, observably
inert to consumers, reversible via config until v1 retires.

## What Changes

- The npm release pipeline ships the v2 NAPI binary (CI artifacts exist;
  packaging does not).
- `@animus-ui/vite-plugin` and `@animus-ui/next-plugin` default
  `engine: 'v1'` → `'v2'`; fixtures follow; `ANIMUS_ENGINE=v1` stays the
  escape hatch.
- The A3 transform-source residue is decided (see design ledger when
  authored; deferred with signal in brainstorm.md).
- Interim dual-engine scaffolding retires: archived change-local parity
  tools, the `index-v2.js` fail-loud Proxy.
- v1 and `loadSystemModule` are RETAINED (oracle + system-loading roles;
  removal belongs to `extract-quirk-shed`).

## Capabilities

### New Capabilities

- `engine-release-packaging`: the npm package SHALL carry both engine
  binaries with fail-loud load contracts (postpack smoke; no silent
  engine fallback).

### Modified Capabilities

- `vite-extraction-plugin`: default engine requirement flips to v2.
- `next-config-wrapper`: default engine requirement flips to v2.
- `dual-engine-build`: the dual build becomes ship-both rather than
  ship-v1-build-v2.
- `verification-tier-policy`: consumer tiers' default-engine
  preconditions (v2 binary gates) become requirements, not additions.

## Impact

- Code: `packages/extract/package.json` (files/exports), release
  workflow in `.github/workflows/`, `packages/vite-plugin/src/index.ts`,
  `packages/next-plugin/src/{plugin,singleton}.ts`, fixture configs
  (`e2e/*`, `packages/showcase`), `scripts/verify/*` preconditions.
- APIs: plugin `engine` option default changes; no signature changes.
- Dependencies: none new; npm package size grows by one `.node` binary
  per platform.
- Systems: npm publish pipeline; CI verify job already downloads v2
  artifacts.

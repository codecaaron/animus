## Why

A system prop value that misses `systemPropMap` and has no `dynamicPropConfig` entry is silently dropped at runtime — no class, no CSS variable, and `filterProps` strips it from the DOM. Because dynamic metadata is only generated for props with a statically *detected* dynamic usage, and the JSX scanner ignores spread attributes entirely, any runtime value arriving through a spread/wrapper boundary on an otherwise-static prop renders nothing, silently. This is a correctness cliff discovered during the 2026-07 prop-flow investigation. The fix is cheap because the prop universe is finite and the CSS-var slot machinery already exists — it is gated only by detection.

## What Changes

- Dynamic prop metadata + CSS variable slots become **total over active system props** (every prop in any evaluated component's `systemPropNames`), no longer gated on detected dynamic usage. See design.md for engine sequencing (v2-only, post-flip).
- `resolveClasses` gains a **dev-mode diagnostic** in the drop branch (engine-agnostic, independently shippable).
- A **CSS byte-delta measurement** on showcase/next-app decides whether custom props are also totalized (deferred decision; see design.md Ledger).

## Capabilities

### New Capabilities

_None — all requirement changes land in the existing `dynamic-prop-fallback` capability._

### Modified Capabilities

- `dynamic-prop-fallback`: "Lazy generation" requirement is replaced for system props (total floor over active props; lazy retained for custom props pending measurement); manifest-gating requirement updated accordingly; new requirement added for the runtime drop diagnostic.

## Impact

- `packages/extract/crates/extract-v2/` — dynamic metadata construction (`dynamic_meta.rs` / analyze pipeline): enumerate active system props instead of detected-dynamic set. v1 (`packages/extract/src/`) is NOT touched (frozen behind the extract-v2-spine parity gate; this change sequences after the flip).
- `packages/system/src/runtime/resolveClasses.ts` — dev-mode diagnostic in the fall-through branch; stripped from production bundles.
- CSS output — additional `@layer system` slot rules, O(|active props| × |breakpoints|); measured before custom-prop scope is decided.
- Manifest shape unchanged (`dynamic_props` simply gains entries); plugins and virtual modules unaffected.
- Tests: unit tests in extract-v2 + runtime tests in `packages/system/__tests__`; verification per Change-Type Map rows for `packages/system/src/**` and the v2 crate.

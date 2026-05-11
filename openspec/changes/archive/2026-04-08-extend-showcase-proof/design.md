## Context

The builder chain's `.extend()` method returns a new `AnimusWithBase` builder that inherits the parent's styles, variants, states, and system config. Extension chains are resolved by the Rust crate's `chain_merger.rs` — parent and child emit to the same `@layer`, source-ordered, so child styles predictably override parent styles. This is provenance-tracked extension, architecturally distinct from Stitches' `styled(Base)` (which re-wraps) or Vanilla Extract's composition arrays (which concatenate).

The showcase's existing `Button` component (`components/docs/Button.tsx`) is a natural extension base — it has variants (`variant`, `size`) and is simple enough to extend meaningfully.

## Goals / Non-Goals

**Goals:**
- Add at least one `.extend()` usage to the showcase components
- Show the base and extended components rendering side-by-side on the Examples page
- Verify extraction handles extension chains in production (provenance tracking, @layer ordering)

**Non-Goals:**
- Not designing new extension API or changing `.extend()` behavior
- Not adding extension to composed families (composed output is sealed — this is by design)

## Decisions

**1. Extend Button into ButtonLink**

`Button.extend().asElement('a')` is the most natural extension: same visual treatment, different element, type-narrowed to accept `href`. This matches the pattern already documented in `base-styling.md` and `builder-chain.md`.

**2. Optional: extend into a specialized variant**

A second extension that adds styles or overrides variants demonstrates that `.extend()` isn't just for element swapping. E.g., `Button.extend().styles({ textTransform: 'uppercase', letterSpacing: '0.1em' }).asElement('button')` for a display/CTA variant.

## Risks / Trade-offs

- [Risk] Extending `Button` creates a dependency — changing `Button` affects `ButtonLink`. → This is the point: extension chains create real architectural relationships, and the showcase should demonstrate that honestly.

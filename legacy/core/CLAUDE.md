# LEGACY — this package is archived. See root CLAUDE.md § Legacy Packages.

# @animus-ui/core — Legacy Builder Implementation

**Status: Legacy.** Consumers use `@animus-ui/system`, which contains its own flattened implementation. Do not add new API surface here — extend system instead.

## What This Package Is

Runtime implementation of the builder chain (Animus.ts, AnimusExtended.ts) and prop system (config.ts, groups). System imports from core at build time and flattens into its own dist.

## Architecture: Backwards Inheritance

The 6-class hierarchy (`Animus` → `AnimusWithBase` → ... → `AnimusWithAll`) uses backwards inheritance — each child class extends its parent and removes preceding methods. This enforces cascade ordering at the type level without runtime checks.

**Why backwards:** The chain builds UP (styles → variant → states), but each new stage needs to hide previous-stage methods. In normal inheritance, children add methods. Here, children constrain by inheriting only what's still callable. The "parent" in the class hierarchy is actually the LATER stage.

## Prop Config

`src/config.ts` defines the canonical prop registry: 13 groups (space, color, typography, layout, etc.) with ~80 individual props. Each prop specifies `{ property, scale?, transform?, negative?, strict? }`.

This config is serialized by `ds.serialize()` and consumed by both the Rust extraction crate and the runtime.

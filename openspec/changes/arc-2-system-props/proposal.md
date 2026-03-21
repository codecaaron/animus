## Why

Arc 1 built the extraction pipeline for static builder chain stages (`.styles()`, `.variant()`, `.states()`) but bails on any chain containing `.groups()` or `.props()`. This means the most common layout primitives — Box, FlexBox, GridBox, Text, Anchor, Image — all fall through to Emotion at runtime. These components account for the majority of JSX usage across the doc site and UI package. Until the pipeline can extract system props, extraction coverage remains limited to specialized components without group-based APIs.

System props from `.groups()` are the utility layer of the Finite Style Machine. Like Tailwind's utilities, they take precedence over component-level styles (base, variants, states) via `@layer system`. Unlike Tailwind, they derive from the type system's prop registry — not string scanning — making the universe of valid values provably finite and bounded by theme scales.

## What Changes

- **Chain walker stops bailing on `.groups()` and `.props()`**: These stages are parsed as first-class chain members, recording active group names and custom prop configs on the ChainDescriptor.
- **JSX scanner (new Rust module)**: Walks JSX elements in each file, matches element tags to extracted component bindings, collects static system prop values (literals + responsive objects). Skips dynamic expressions.
- **Utility CSS generation in `@layer system`**: Each unique (prop, value) pair found across JSX callsites emits a single utility class rule. Shared across components — `p={8}` produces the same class whether on Box or Text.
- **Runtime shim gains system prop → class name mapping**: `createComponent` receives a lookup table mapping system prop values to utility class names. No style computation at runtime — just className concatenation.
- **`.props()` extraction**: Custom props with inline scales (e.g., Logo's `logoSize`) are handled identically to group props but with their scale defined in the chain rather than the theme.

## Capabilities

### New Capabilities
- `jsx-system-prop-scanner`: JSX AST scanning to collect static system prop values from callsites, matching against extracted component bindings and their active group configurations.
- `utility-css-generation`: Deterministic utility class emission in `@layer system` from (prop, value) pairs, with theme scale resolution, transforms, and responsive @media support.

### Modified Capabilities
- `rust-extraction-pipeline`: Chain walker stops bailing on `.groups()` and `.props()`. ChainDescriptor gains group config and custom prop fields. Pipeline orchestrates JSX scanning after chain walking.
- `extraction-runtime-shim`: `createComponent` accepts system prop class map, applies utility classes from prop values, filters system props from DOM forwarding.
- `vite-extraction-plugin`: Passes group registry metadata alongside theme and config. Utility CSS deduplication across files.

## Impact

- **`packages/extract/src/`**: chain_walker.rs (remove bail, add group/prop parsing), new jsx_scanner.rs module, css_generator.rs (utility class emission in @layer system), transform_emitter.rs (emit system prop class map), lib.rs (pipeline orchestration)
- **`packages/runtime/src/index.ts`**: System prop → className lookup, expanded prop filtering
- **`packages/vite-plugin/src/`**: Cross-file utility CSS deduplication, group registry serialization
- **`packages/extract/tests/`**: New canary fixtures with `.groups()` components and JSX callsites
- **No breaking changes**: Components without `.groups()` continue to extract as before. Components with `.groups()` that previously bailed now extract. Emotion fallback remains for `.extend()` (Arc 3).

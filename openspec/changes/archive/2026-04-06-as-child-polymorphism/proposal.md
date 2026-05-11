## Why

The `as` prop provides runtime polymorphism but breaks type safety — `<Button as="a" href="/foo">` accepts `href` only because the type union is overly permissive. There's no way to get anchor-specific autocomplete or type checking. The `asChild` pattern (pioneered by Radix) solves this: instead of rendering its own element, the component merges its resolved className onto the single child element. The child keeps its own props and types. This is the standard approach for headless UI interop — Radix, Ark, and Melt all use it.

## What Changes

- **`asChild` prop on all Animus components**: When `true`, the component does not render its own element. Instead, it resolves className/style as usual, then merges them onto the single child element via `cloneElement`. The child must be a single React element (`Children.only` enforced at runtime).
- **`composeRefs` utility**: Merges the component's forwarded ref with the child element's ref into a single callback ref. Required for asChild to properly compose ref forwarding.
- **`asChild` added to prop filter**: The `asChild` prop is stripped by `filterProps` — never forwarded to the DOM.
- **`as` prop coexistence**: `as` continues to work unchanged. When `asChild` is `true`, `as` is ignored. No deprecation.
- **Extraction pipeline unchanged**: `resolveClasses` already decouples style resolution from rendering. `asChild` only changes the rendering step (`createElement` → `cloneElement`). Zero impact on the Rust crate.

## Capabilities

### New Capabilities

- `as-child-rendering`: Covers the asChild prop behavior — child delegation, ref composition, className/style merging, interaction with existing `as` prop, compose() compatibility, and error handling for invalid children.

### Modified Capabilities

- `extraction-runtime-shim`: The `createComponent` factory gains awareness of `asChild` — new rendering branch alongside the existing createElement path.

## Impact

- **packages/system/src/runtime/index.ts**: `createComponent` gains ~15 lines for the asChild branch + `composeRefs` utility.
- **packages/system/src/types/component.ts**: `asChild?: boolean` added to `AnimusConsumerProps`.
- **Tests**: Runtime tests for asChild rendering, ref composition, className merging, error on non-element children.
- **No extraction changes**: `resolveClasses`, `css_generator`, `jsx_scanner`, `project_analyzer` — all unchanged.

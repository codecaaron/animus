## Why

Composed families that include portal-mounted slots (Radix Dialog, Tooltip, Popover; Ark Menu) cannot receive shared variant styles via CSS cascade — portaled content renders outside Root's DOM subtree, so descendant selectors don't reach it. React context DOES cross portal boundaries. The context-free compose refactor (session 48) deferred this as a known limitation since no portal-using families existed yet. As headless primitive integration approaches, this gap blocks real-world composed families that include overlay/dialog slots.

## What Changes

- **`context` option on compose()**: New optional boolean in compose options. When `true`, compose() creates a React context, Root wraps children in a Provider passing shared prop values, and children use `useContext` to receive shared props through their own variant runtime. Default `false` preserves current CSS-only behavior.
- **CSS rules always emitted**: The two-rule composed variant CSS model is unchanged. `context: true` families still get full CSS emission — context is an additive fallback for portal-escaped children, not a replacement.
- **Extraction pipeline `context` detection**: `jsx_scanner.rs` extracts `context: true/false` from compose() AST. `ComposeFamilyInfo` gains a `context: bool` field.
- **`"use client"` directive injection**: When the extraction pipeline detects `context: true` in a compose call and the source file lacks a `"use client"` directive, `transform_emitter.rs` injects the directive at the top of the transformed output. Files that already have the directive are unchanged.
- **Type system**: `context` is an optional boolean on compose options. No impact on `SharedConfig`, `ComposedFamily`, or consumer-facing types.

## Capabilities

### New Capabilities

_None_ — this extends existing compose capabilities.

### Modified Capabilities

- `compose-slot-composition`: The "No React context in shared variant path" requirement becomes conditional — context is absent by default but present when `context: true` is specified. The compose() API signature gains an optional `context` boolean.
- `compose-css-propagation`: The DEFERRED portal fallback requirement becomes implemented. Portal-mounted slots receive shared variant styling via context-provided prop values when `context: true`.

## Impact

- **packages/system/src/compose.ts**: Conditional context creation (~30 lines for context branch). Default branch unchanged.
- **packages/system/src/types/component.ts**: `context?: boolean` added to compose options type.
- **packages/extract/src/jsx_scanner.rs**: Extract `context` field from compose AST. `ComposeFamilyInfo` gains `context: bool`.
- **packages/extract/src/transform_emitter.rs**: Inject `"use client"` when compose family uses `context: true` and file lacks directive.
- **packages/extract/src/project_analyzer.rs**: Thread `context` field through pipeline (already has ComposeFamilyInfo plumbing from context-free compose).
- **Tests**: compose.test.tsx (context branch), canary tests (context detection + "use client" injection), type tests (context option typing).

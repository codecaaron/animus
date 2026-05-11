## Context

Currently, `SystemBuilder` manages three concerns: property registration, property grouping, and global style configuration. The `.withGlobalStyles({ reset, global })` method stores global styles on the builder, and `.build()` includes them in the `SerializedConfig` returned by `serialize()`. The Vite plugin then launches a subprocess (`resolve-global-styles.ts`) that imports the system module, calls `.serialize()`, extracts `globalStyles`, and resolves prop shorthand + token aliases to produce final CSS emitted into `@layer global`.

The current approach couples document-level CSS emission to the system builder chain. Global styles serve the browser, not the component authoring API. They're a different lifecycle concern.

## Goals / Non-Goals

**Goals:**
- Remove `withGlobalStyles` from SystemBuilder so it only manages prop/group concerns
- Return `createGlobalStyles` as a sibling from `.build()` so global styles share the token vocabulary without polluting the component authoring instance
- Allow composable global style blocks — consumers organize resets, theming, keyframes however they want (no prescribed `{ reset, global }` structure)
- Maintain the existing global styles resolution pipeline (prop shorthand, token aliases, transforms, keyframes)

**Non-Goals:**
- Changing how the Rust crate emits `@layer global` (that stays as-is)
- Changing the resolve-global-styles subprocess architecture
- Adding new global style capabilities (nesting, conditionals, etc.)
- Renaming `createSystem` (handled by a separate change)

## Decisions

### 1. `.build()` returns a tuple object instead of a bare instance

**Choice:** `createSystem().addProperties(...).build()` returns `{ system: Animus, createGlobalStyles: (styles) => GlobalStyleBlock }`

**Why:** This cleanly separates the two products of system configuration. The `system` (Animus instance) is the component authoring API. `createGlobalStyles` is a factory that captures the prop registry and transform map from the same build, so it can resolve shorthand and tokens without the consumer re-supplying config.

**Alternative considered:** Keep build returning a bare instance, add `createGlobalStyles` as a standalone export. Rejected because it would need the prop config passed in manually or looked up from a global — the factory closure is cleaner.

### 2. Global style blocks are flat selector maps, not `{ reset, global }`

**Choice:** `createGlobalStyles` accepts `Record<string, Record<string, any>>` — a flat map of CSS selectors to style objects. The consumer decides how many blocks to create and what goes in each.

**Why:** The `{ reset, global }` split was arbitrary — it implied a structure the system doesn't enforce. Consumers might want `reset`, `theme`, `animations` as three blocks, or everything in one. The system shouldn't prescribe this.

**Impact on plugin:** The plugin currently checks `parsed.globalStyles.reset` and `parsed.globalStyles.global` separately. With the new approach, global styles arrive as an array of named blocks (or a single merged block). The resolve-global-styles subprocess processes each block identically.

### 3. Plugin discovers global styles via a separate export

**Choice:** The consumer exports global style blocks as named exports alongside the system. The plugin config gains an optional `globalStyles` field pointing to the export names (defaulting to conventional names).

**Why:** Currently the plugin finds global styles inside `serialize().globalStyles`. With global styles separated from the system instance, they need a new discovery path. Named exports from the same file keeps everything colocated.

```typescript
// ds.ts
export const { system: ds, createGlobalStyles } = createSystem()...build()

export const reset = createGlobalStyles({...})
export const globalStyles = createGlobalStyles({...})
```

The resolve-global-styles subprocess imports the module and looks for these exports.

### 4. `serialize()` no longer includes globalStyles

**Choice:** `SerializedConfig` drops the `globalStyles` field. The system instance's `serialize()` only returns `propConfig`, `groupRegistry`, and `transforms`.

**Why:** Global styles are no longer part of the system builder's state. The plugin gets them through a separate channel.

**Note:** `serialize()` itself may be further refactored in a separate change. For now, it remains on the system instance but with reduced scope.

## Risks / Trade-offs

- **Breaking change for consumers:** Any code using `withGlobalStyles` must restructure. Mitigated by: clear migration path, the showcase is the only known consumer, and this is pre-v0.10.
- **Plugin needs updated discovery:** The subprocess must be updated to find global styles from module exports rather than from `serialize()`. Low risk — the resolution logic stays identical, only the input channel changes.
- **Two imports from ds.ts instead of one:** Consumers now destructure `{ system, createGlobalStyles }` from build, then export both the system and global style blocks. Slightly more ceremony in the setup file, but this file is written once.

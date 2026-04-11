# Compose Replacement Spec

## Purpose

Define the extraction-time replacement of `compose()` calls and the runtime shim contract so that `context: false` compose families produce RSC-safe output.

## Runtime Shim: `createComposedFamily`

### Location

`packages/system/src/runtime/createComposedFamily.ts`

Exported from `@animus-ui/system/runtime` (existing subpath).

### Signature

```typescript
export function createComposedFamily(
  slots: Record<string, ForwardRefExoticComponent<any>>,
  config: {
    name: string;
    context: boolean;
    sharedKeys: string[];
  }
): Record<string, ForwardRefExoticComponent<any>>
```

### Behavior

**When `config.context === false`:**

For each slot, wrap with `forwardRef` + `createElement` passthrough. Set `displayName` to `{config.name}.{slotName}`. No hooks, no context, no `createContext` import.

```typescript
// Generated per slot
const Wrapper = forwardRef((props, ref) =>
  createElement(SourceComponent, { ...props, ref })
);
Wrapper.displayName = `${name}.${slotName}`;
```

This is RSC-safe. The function must NOT import `createContext` or `useContext` at module scope.

**When `config.context === true`:**

Create a `React.createContext` instance. Root slot extracts shared props and provides via context Provider wrapping `props.children`. Child slots read context, merge under direct props (direct wins).

```typescript
const Ctx = createContext<Record<string, unknown>>({});
const keySet = new Set(config.sharedKeys);

// Root slot
const Root = forwardRef((props, ref) => {
  const shared = {};
  for (const key of keySet) if (key in props) shared[key] = props[key];
  return createElement(
    SourceComponent,
    { ...props, ref },
    createElement(Ctx.Provider, { value: shared }, props.children)
  );
});

// Child slots
const Child = forwardRef((props, ref) => {
  const inherited = useContext(Ctx);
  return createElement(SourceComponent, { ...inherited, ...props, ref });
});
```

### RSC Safety Contract

The module MUST structure its imports so that `createContext` and `useContext` are only imported/evaluated when `config.context === true`. Two acceptable patterns:

**Option A — conditional require:**
```typescript
import { createElement, forwardRef } from 'react';
// createContext/useContext imported lazily
if (config.context) {
  const { createContext, useContext } = require('react');
  // ...
}
```

**Option B — separate module:**
```typescript
// createComposedFamily.ts — RSC-safe, only forwardRef/createElement
// createComposedFamilyWithContext.ts — has createContext/useContext
```

With Option B, the emitter imports from different paths based on `context`. This is cleaner for tree-shaking but requires two import targets in the emitter.

**Recommended: Option A.** Simpler emitter, one import target. The conditional require is evaluated at compose-definition time (not render time), so the performance cost is negligible. Bundlers with dead code elimination will remove the `require('react')` branch when `config.context` is the literal `false`.

## Rust Crate Changes

### jsx_scanner.rs — Span Capture

Add `span: (u32, u32)` to `ComposeFamilyInfo`. Set it from the `CallExpression` span in `extract_compose_family`. This is the byte range of the `compose(...)` expression — NOT including the assignment (`const Card =`).

### project_analyzer.rs — Manifest Extension

Add to `UniverseManifest`:

```rust
#[serde(default)]
pub compose_replacements: Vec<ComposeReplacementDescriptor>,
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComposeReplacementDescriptor {
    pub file_path: String,
    pub family_binding: Option<String>,
    pub slots: Vec<(String, String)>,
    pub name: String,
    pub context: bool,
    pub shared_keys: Vec<String>,
}
```

Populated in the existing compose family loop (around line 1128-1139) after CSS generation is complete.

### transform_emitter.rs — Replacement Generation

New function:

```rust
pub fn generate_compose_replacement(desc: &ComposeReplacementDescriptor) -> String
```

Emits:
```javascript
createComposedFamily({ Root: RootBinding, Body: BodyBinding }, { name: "Card", context: false, sharedKeys: ["size"] })
```

Slot values reference the original binding names (which are preserved through chain replacement).

### lib.rs — transform_file Integration

In `transform_file`, after processing component replacements:

1. Read `manifest.compose_replacements` for the current file
2. Re-walk the source to find compose call spans (needed because the manifest stores file-level data)
3. Add `SourceReplacement` entries for each compose call
4. Add `createComposedFamily` to the import injection set
5. Add `compose` to `extracted_bindings` (strips the source import)

### Import Injection

When compose replacements exist, the runtime import line becomes:

```javascript
import { createComponent, createComposedFamily } from '@animus-ui/system/runtime';
```

Or if only compose (no component chains in this file):

```javascript
import { createComposedFamily } from '@animus-ui/system/runtime';
```

## Canary Test

Add one canary test case to `packages/extract/tests/canary.test.ts`:

```typescript
// Input
const CardRoot = ds.styles({ display: 'flex' }).asElement('div');
const CardBody = ds.styles({ p: 16 }).asElement('div');
const Card = compose({ Root: CardRoot, Body: CardBody }, { shared: { size: true }, name: 'Card' });

// Expected: compose() call replaced with createComposedFamily()
// Expected: import includes createComposedFamily
// Expected: no import of compose from @animus-ui/system
```

## Success Criteria

1. `context: false` compose output has zero `createContext`/`useContext` in the module graph
2. `context: true` compose output has `'use client'` directive (existing behavior preserved)
3. `createComposedFamily` with `context: false` is importable in a React Server Component without error
4. Composed families retain identical runtime behavior (displayName, prop forwarding, ref forwarding)
5. Existing canary tests pass unchanged
6. New canary test verifies compose replacement

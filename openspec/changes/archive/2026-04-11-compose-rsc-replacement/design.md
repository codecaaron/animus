## Context

The extraction pipeline replaces builder chains (`ds.styles()...asElement()`) with `createComponent()` calls. The `compose()` call is scanned for metadata (slots, shared keys, context flag) but the call itself survives into the transformed output. This drags `createContext`/`useContext` into every file that uses compose, breaking RSC.

The `context: false` path in compose.ts (lines 85-88) is trivial — `forwardRef` + `createElement` passthrough per slot plus `displayName` assignment. This is already RSC-safe. The extraction pipeline just needs to emit it directly instead of leaving the `compose()` call intact.

## Goals / Non-Goals

**Goals:**
- Replace `compose()` calls in transformed output with `createComposedFamily()` — a thin runtime shim
- `context: false` (default): shim uses only `forwardRef` + `createElement` — RSC-safe
- `context: true`: shim uses `createContext` + `useContext`, file gets `'use client'` (existing mechanism)
- Strip `compose` import from `@animus-ui/system` in transformed files (same as `animus` builder stripping)
- Preserve existing TypeScript types — `ComposedFamily<Slots>` return type stays identical

**Non-Goals:**
- Changing the `compose()` source API or consumer call sites
- Modifying how composed variant CSS is generated (that's already correct)
- Handling dynamic slot maps (compose already requires static object literals)

## Decisions

### 1. Runtime Shim: `createComposedFamily`

A new function in `@animus-ui/system/runtime` (or a dedicated compose-runtime module) that the transform emitter targets.

**Signature:**
```typescript
function createComposedFamily(
  slots: Record<string, ForwardRefExoticComponent<any>>,
  config: {
    name: string;
    context: boolean;
    sharedKeys: string[];
  }
): Record<string, ForwardRefExoticComponent<any>>
```

The emitter generates a call with the config pre-resolved from static analysis:

```javascript
// context: false — emitted replacement
const Card = createComposedFamily(
  { Root: CardRoot, Body: CardBody, Header: CardHeader },
  { name: "Card", context: false, sharedKeys: ["size"] }
);
```

```javascript
// context: true — emitted replacement (file also gets 'use client')
const Card = createComposedFamily(
  { Root: CardRoot, Body: CardBody, Header: CardHeader },
  { name: "Card", context: true, sharedKeys: ["size"] }
);
```

The shim internally branches on `config.context`:
- `false`: thin `forwardRef`/`createElement` wrappers, no hooks, no context — RSC-safe
- `true`: `createContext`, `useContext`, Provider wrapping — requires client boundary

**Why one function, not two:** The emitter already handles the `'use client'` injection via `use_client_files`. Having one function with a boolean flag keeps the replacement generation simple and avoids needing two import targets. The bundler tree-shakes the unused branch when `context` is a literal `false`.

### 2. Span Capture in ComposeFamilyInfo

`jsx_scanner.rs` already captures compose call metadata. Add a `span: (u32, u32)` field recording the byte range of the entire `compose(...)` call expression. This is what the transform emitter needs to splice the replacement.

Current `ComposeFamilyInfo`:
```rust
pub struct ComposeFamilyInfo {
    pub family_binding: Option<String>,
    pub root_binding: String,
    pub slots: Vec<(String, String)>,
    pub shared_keys: Vec<String>,
    pub context: bool,
}
```

Add:
```rust
    pub span: (u32, u32),  // byte range of the compose() call expression
```

The span covers only the `compose(...)` call, not the `const Card =` assignment. The replacement splices the call expression itself, preserving the binding declaration.

### 3. Replacement Generation in transform_emitter.rs

New function `generate_compose_replacement`:

```rust
pub fn generate_compose_replacement(
    family: &ComposeFamilyInfo,
    // The class names of the slot components (from the manifest)
    slot_class_names: &HashMap<String, String>,
) -> String
```

Emits:
```javascript
createComposedFamily(
  { Root: SlotRootBinding, Body: SlotBodyBinding },
  { name: "FamilyName", context: false, sharedKeys: ["size", "tone"] }
)
```

The slot bindings in the replacement reference the already-replaced `createComponent()` variables — compose replacement runs AFTER individual chain replacement.

### 4. Import Injection

The emitter already injects runtime imports. Add `createComposedFamily` to the import set when compose replacements exist:

```javascript
import { createComponent, createComposedFamily } from '@animus-ui/system/runtime';
```

For `context: true` families, the `createComposedFamily` import internally pulls `createContext`/`useContext`. Combined with the existing `'use client'` injection on those files, the RSC boundary is correct.

For `context: false`, the import resolves to an RSC-safe code path. If the runtime shim is structured with conditional `require()` or a separate import for the context path, tree-shaking eliminates the dead branch entirely.

### 5. Import Stripping

The `compose` import from `@animus-ui/system` must be stripped from transformed files, same as the `animus` builder import. The emitter already tracks `consumed_sources` and `extracted_bindings` for this purpose. Add `compose` to `extracted_bindings` when compose replacements are present.

### 6. Manifest Storage

The `UniverseManifest` needs to carry compose replacement data. Add a new field:

```rust
pub compose_replacements: Vec<ComposeReplacement>,
```

Where:
```rust
pub struct ComposeReplacement {
    pub file_path: String,
    pub family_binding: Option<String>,
    pub slots: Vec<(String, String)>,  // (slot_name, binding_name)
    pub name: String,
    pub context: bool,
    pub shared_keys: Vec<String>,
}
```

`transform_file` reads these to generate compose replacements alongside component replacements.

## Risks / Trade-offs

### Compose replacement runs after chain replacement
**Risk:** The slot bindings in the compose replacement must reference the post-replacement variables. If a slot's builder chain was replaced, the binding name stays the same (the `const CardRoot = createComponent(...)` assignment preserves the variable name). So compose replacement can safely reference the binding.
**Mitigation:** Verify in tests that compose replacement sees the correct binding names.

### createComposedFamily must not import createContext at module scope
**Risk:** If the shim unconditionally imports `createContext`, we're back to the same problem.
**Mitigation:** The shim must lazy-import or conditionally require `createContext` only when `config.context === true`. Since `context` is a literal boolean in the emitted call, bundlers can tree-shake the dead path.

### External packages pre-built with Vite
**Risk:** Pre-built external packages still ship the old `compose()` call. The next-plugin loader won't transform them if there are no builder chains to replace.
**Mitigation:** The loader's CSS import stripping (already fixed in this session) handles the CSS side. For the compose call, external packages should rebuild against the updated system package. Document this as a breaking change for pre-built external DS packages.

## Context

The Animus extraction pipeline currently maintains a fragile parity contract: 4 JS transform functions are reimplemented in Rust (`transforms.rs`, ~265 lines), bridged by a manual `TRANSFORM_MAP` in `config.ts`. Custom transforms cannot cross this bridge. The `legacy/` directory (10 files) blocks the `createTransform` export name. Emotion's `Theme` type is woven into `types/theme.ts` and `types/props.ts` despite having zero active production consumers — only legacy integration tests use it.

These are entangled: removing legacy clears the namespace for `createTransform`, which enables named transforms, which makes `TRANSFORM_MAP` and `transforms.rs` dead code, which moves transform execution to JS, which removes the last structural dependency on Emotion types in core.

## Goals / Non-Goals

**Goals:**
- Config is self-describing: transform identity travels with the function, no external mapping needed
- Custom transforms work in extraction without Rust changes
- Remove ~500 lines of dead code (legacy directory + Rust transforms + TRANSFORM_MAP)
- Core package has zero Emotion dependencies
- Transform execution happens in JS at build time — one implementation, one source of truth

**Non-Goals:**
- Changing the consumer-facing prop config API (transform field still accepts functions)
- Modifying the builder chain type-state machine (Animus.ts, AnimusExtended.ts unchanged)
- Changing how transforms work at runtime in dev mode (createPropertyStyle.ts call pattern preserved)
- Removing Emotion from the UI package (`packages/ui/`) — that's a separate scope
- Dynamic transform support (transforms that need runtime context) — future work

## Decisions

### 1. `createTransform(name, fn)` decorator utility

Transform functions are wrapped via `createTransform` which returns a NEW callable function decorated with `.transformName`. The wrapper is a fresh function (not Object.assign on the original) to prevent shared-reference mutation bugs.

```ts
type TransformFn = (value: string | number, property?: string, props?: any) => string | number | Record<string, any>;
type NamedTransform = TransformFn & { transformName: string };

export function createTransform(name: string, fn: TransformFn): NamedTransform {
  const wrapper: TransformFn = (value, property, props) => fn(value, property, props);
  return Object.assign(wrapper, { transformName: name }) as NamedTransform;
}
```

**Why not string references on config (`addTransform` + `transform: 'name'`):** Decouples definition from usage. Requires a new type parameter on AnimusConfig flowing through 6+ builder classes. Prop configs defined outside the builder chain (`const border = {...}`) can't validate string names against a registry they don't know about.

**Why not bare Function.name:** Destroyed by bundler minification. The framework's correctness would depend on bundler configuration (`keepNames: true`), which is fragile. Function.name is used as a FALLBACK (`entry.transform.transformName ?? entry.transform.name`) for backward compatibility, not as the primary mechanism.

**Why a new wrapper function, not Object.assign on the original:** Two `createTransform` calls with the same underlying function would overwrite each other's `.transformName` if we mutated in place. The wrapper avoids this:

```ts
const shared = (v) => `${v}px`;
const a = createTransform('a', shared);  // new function, .transformName = 'a'
const b = createTransform('b', shared);  // new function, .transformName = 'b'
// a.transformName === 'a' ✓ (not overwritten)
```

### 2. Serialization via `.transformName` with `.name` fallback

In `getExtractConfig()`, the TRANSFORM_MAP is replaced with:

```ts
if (entry.transform) {
  s.transform = entry.transform.transformName ?? entry.transform.name ?? undefined;
}
```

This means:
- `createTransform`-wrapped transforms: use `.transformName` (primary)
- Bare named functions from legacy consumers: use `.name` (fallback)
- Inline anonymous functions: `undefined` → transform not serialized → Rust emits raw value → runtime handles it

### 3. Rust emits raw values + transform metadata, does NOT execute transforms

The Rust pipeline's `theme_resolver.rs` stops calling `apply_transform()`. Instead, when a prop config has a `transform` field, Rust emits:
- The raw value (after scale lookup but BEFORE transform application)
- The transform name as metadata

The `transforms.rs` file is deleted entirely. The `apply_transform` dispatch function in `theme_resolver.rs` is removed.

The manifest format gains a transform metadata field per CSS declaration that needs post-processing.

### 4. Vite plugin applies transforms as a JS post-processing step

After `analyze_project()` returns the manifest, the Vite plugin:
1. Loads the config module to get the actual transform functions
2. Walks the manifest CSS, finding transform placeholders
3. For each placeholder: looks up the transform function by name, calls it with the raw value, substitutes the result
4. The final CSS has all transforms applied

This happens ONCE at build time, not per-render. The performance impact is negligible — there are only ~20 prop definitions with transforms across all groups.

### 5. Legacy directory removal

All 10 files in `packages/core/src/legacy/` are deleted. The `export * from './legacy/core'` line is removed from `index.ts`. Integration tests in `packages/_integration/` that use `animusProps` are updated to use the modern builder API or archived.

This is a **BREAKING** change for any external consumer using `animusProps.create()`, `animusProps.compose()`, etc. These APIs have been superseded by the builder chain since the core rewrite.

### 6. Emotion type removal from core and theming

- `declare module '@emotion/react'` in `types/theme.ts` → deleted
- `Theme` import from `@emotion/react` in `types/props.ts` → replaced with standalone interface
- `@emotion/react`, `@emotion/styled`, `@emotion/is-prop-valid` removed from core's `package.json`
- `Theme` import in `packages/theming/src/utils/serializeTokens.ts` → replaced with `{ breakpoints: Record<string, string> }` parameter type
- `@emotion/react`, `@emotion/styled` removed from theming's `package.json`

The standalone theme interface in core is minimal — just the shape that the prop system needs for scale resolution and responsive breakpoints.

## Risks / Trade-offs

**[Transform placeholder format in CSS]** → The format for how Rust emits "raw value + transform name" needs careful design. If it's inline in the CSS string (like a custom function marker), the regex for finding/replacing could be fragile. **Mitigation:** Use the manifest's structured data (JSON) rather than embedding markers in the CSS string itself. The manifest already tracks per-component, per-declaration metadata.

**[Legacy removal is BREAKING]** → External consumers using `animusProps` will break. **Mitigation:** The `animusProps` API was the pre-builder-chain API. The builder chain has been the documented API since the core rewrite. Check npm download stats for `@animus-ui/core` imports of `animusProps` — expected to be zero external usage.

**[Emotion type removal may surface hidden type dependencies]** → Other packages or consumer code may import types that transitively depend on Emotion's `Theme`. **Mitigation:** Run `tsc --noEmit` across the entire monorepo after the change. The smoke test and showcase already verify extracted components type-check.

**[Function.name fallback may mislead]** → A bare function with `.name === ''` (anonymous) silently drops the transform from extraction without any diagnostic. **Mitigation:** In `strict` mode, the extraction report should warn when a transform has no serializable name. This is existing behavior for TRANSFORM_MAP misses.

## Open Questions

- **Manifest format for transform metadata:** Should the manifest carry a separate `transforms` map alongside the CSS, or should each CSS declaration carry its own transform info? The former is simpler to post-process; the latter is more self-contained.
- **Dev-mode transform execution:** In dev mode, transforms run via the Emotion runtime (createPropertyStyle.ts). After Emotion is fully removed from the UI package (future scope), dev mode will need the same build-time transform path. Should we pre-wire that now or defer?

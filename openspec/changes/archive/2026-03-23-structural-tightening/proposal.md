## Why

The extraction pipeline reimplements 4 JS transform functions in Rust (`size`, `borderShorthand`, `gridItemRatio`, `gridItem`), maintaining a fragile parity contract across two languages. A manual `TRANSFORM_MAP` bridges function references to string identifiers for serialization. Custom transforms cannot cross this bridge — they work at runtime but are silently dropped during extraction. Meanwhile, the `legacy/` directory in core (10 files) occupies the `createTransform` export name with a completely different signature, and threads Emotion's `Theme` type through the type system despite having zero production consumers.

These are symptoms of the same structural issue: the config is not self-describing. Transform identity requires manual mapping, theme types are borrowed from Emotion instead of derived from the system's own data, and dead code blocks the namespace needed for the fix.

## What Changes

- **Remove `packages/core/src/legacy/` directory** (10 files). Only consumed by integration tests via `animusProps` export. Update or archive integration tests that depend on it.
- **Remove `export * from './legacy/core'` from core's `index.ts`**. **BREAKING** for any consumer using `animusProps.create()`, `animusProps.compose()`, etc.
- **Introduce `createTransform` utility** in `packages/core/src/transforms/`. Returns a callable function decorated with `.transformName` via `Object.assign` on a new wrapper function (not in-place mutation). Enforces naming for extraction serialization while preserving the existing function call interface.
- **Update built-in transforms** (`size`, `borderShorthand`, `gridItemRatio`, `gridItem`) to use `createTransform`.
- **Replace `TRANSFORM_MAP` in `config.ts`** with computed serialization: `entry.transform.transformName ?? entry.transform.name`. Delete the manual map.
- **Rust pipeline stops applying transforms**. For props with transforms, Rust emits the raw value + transform name as metadata. No reimplementation, no dispatch.
- **Vite plugin post-processes transforms in JS**. After receiving Rust's intermediate output, the plugin resolves transform names to functions from the loaded config and applies them to produce final CSS values.
- **Delete `transforms.rs`** (~265 lines of Rust reimplementations) and the `apply_transform` dispatch in `theme_resolver.rs`.
- **Remove `declare module '@emotion/react'` from `types/theme.ts`**. Replace with standalone theme interface derived from the system's own types.
- **Remove `@emotion/react`, `@emotion/styled`, `@emotion/is-prop-valid` from core's `package.json`** dependencies.

## Capabilities

### New Capabilities
- `named-transforms`: The `createTransform(name, fn)` utility and the serialization contract for extraction. Covers: the Transform interface, the naming convention, the `.transformName` property protocol, and how the Vite plugin resolves transform names to functions at build time.

### Modified Capabilities
- `rust-extraction-pipeline`: Rust no longer applies transforms. Emits raw values + transform name metadata for transformed props. `transforms.rs` removed. `apply_transform` dispatch removed from `theme_resolver.rs`.
- `vite-extraction-plugin`: Post-processes Rust output to apply transforms via JS. Loads transform functions from the config module at build time. Resolves transform names to functions and applies them to produce final CSS values.
- `prop-system`: Transform field on prop config entries now accepts `NamedTransform` (a callable function with `.transformName`). Bare functions still work at runtime but require `.name` preservation for extraction. `createTransform` is the canonical way to define transforms.

## Impact

- **`packages/core/src/legacy/`** — Deleted (10 files)
- **`packages/core/src/index.ts`** — Remove legacy re-export, add `createTransform` export
- **`packages/core/src/transforms/`** — All 4 transforms updated to use `createTransform`
- **`packages/core/src/config.ts`** — `TRANSFORM_MAP` deleted, `getExtractConfig()` uses `.transformName ?? .name`
- **`packages/core/src/types/theme.ts`** — Emotion module augmentation removed, standalone interface
- **`packages/core/package.json`** — `@emotion/*` dependencies removed
- **`packages/extract/src/transforms.rs`** — Deleted
- **`packages/extract/src/theme_resolver.rs`** — `apply_transform` calls removed, emit raw values + metadata
- **`packages/extract/src/css_generator.rs`** — May need to emit transform placeholders
- **`packages/extract/src/lib.rs`** — Updated manifest format includes transform metadata
- **`packages/vite-plugin/src/index.ts`** — Transform post-processing step added
- **`packages/_integration/__tests__/`** — Tests updated to use modern builder API or archived
- **`packages/theming/src/utils/serializeTokens.ts`** — Replace `Theme` import with local interface
- **`packages/theming/package.json`** — `@emotion/*` dependencies removed

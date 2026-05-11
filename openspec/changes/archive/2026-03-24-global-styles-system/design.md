## Context

The system builder (`createSystem()`) currently provides `.withTokens()` and `.withProperties()` to define the design language. Components use prop shorthand (`p: 8`, `color: 'primary'`, `border: 1`) which gets resolved through theme scales and transforms during extraction. But global styles (resets, base typography, scrollbar, selection) are authored as raw CSS files that bypass this vocabulary.

The showcase currently imports `reset.css` and `global.css` in `main.tsx`. These files hardcode CSS variable names (`var(--color-background)`) and raw values instead of using the design system's shorthand.

## Goals / Non-Goals

**Goals:**
- `.withGlobalStyles()` method on `SystemBuilder` that accepts selector-keyed style objects using the same prop shorthand as components
- Global styles resolved through theme scales, transforms, and token aliases at extraction time
- Global CSS emitted in the virtual stylesheet before `@layer` blocks
- Replace hand-written CSS files in the showcase

**Non-Goals:**
- Runtime global style injection (this is extraction-only)
- Scoping or CSS modules for global styles (they're intentionally global)
- Responsive breakpoint support within global styles (keep it simple — global styles rarely need responsive values)
- Animation keyframe definitions (separate concern, `@keyframes` can stay in CSS files)

## Decisions

### 1. API: `.withGlobalStyles()` on SystemBuilder

```ts
export const ds = createSystem()
  .withTokens((t) => tokens)
  .withProperties((p) => p.addGroup(...).build())
  .withGlobalStyles({
    '*, *::before, *::after': { boxSizing: 'border-box' },
    'html, body': { m: 0, bg: 'background', color: 'text', fontFamily: 'base' },
    a: { color: 'primary', textDecoration: 'none' },
    '::selection': { bg: 'primary', color: 'background' },
    '::-webkit-scrollbar': { width: 4 },
    '::-webkit-scrollbar-thumb': { bg: 'primary' },
  })
  .build();
```

**Why**: Same position in the builder chain as tokens and properties — system-level configuration, not component-level. The method comes AFTER `.withProperties()` because it uses the prop registry for shorthand resolution.

**Alternative considered**: A separate function like `createGlobalStyles(ds, {...})`. Rejected because it fragments the system definition — one file, one instance, one truth.

### 2. Style objects use prop shorthand, not CSS properties

The value objects use the same keys as component `.styles()` blocks: `bg` not `backgroundColor`, `p` not `padding`, `m` not `margin`. They resolve through the same prop config → scale lookup → transform pipeline.

**Why**: Consistency. If `bg: 'primary'` works in a component, it should work in global styles. No second vocabulary.

### 3. Resolution happens in JS during serialization, not in Rust

Global styles are resolved at `loadSystem()` time in the Vite plugin, using the serialized prop config and theme. The resolved CSS is emitted as a string alongside theme variable CSS.

**Why**: Global styles are a flat selector → declarations map. They don't need chain walking, JSX scanning, or any of the Rust pipeline's component analysis. Resolving in JS during serialization keeps the Rust boundary clean. The theme resolver logic (`resolve_styles`) can be reimplemented as a simple JS function for this purpose — or we can call the Rust `extract()` function with a synthetic source that wraps global styles in animus chains (ugly but reuses the pipeline).

**Preferred approach**: JS-side resolution. The prop config map, flat theme, and variable map are all available as JSON at plugin load time. A `resolveGlobalStyles(globalStyles, propConfig, flatTheme, variableMap)` function in the Vite plugin resolves each selector's style object to CSS declarations using the same lookup logic as the Rust resolver (scale lookup → transform placeholder → value).

### 4. Global CSS emitted before @layer blocks

Global styles go BEFORE the `@layer base, variants, states, system, custom;` declaration. They have no layer — they're root-level CSS. This matches the convention for resets and base styles.

**Why**: Resets and base typography should be overrideable by any layer. Putting them outside layers gives them the lowest specificity in the cascade.

### 5. `SerializedConfig` gains `globalStyles` field

The serialized output from `ds.serialize()` includes a new field:

```ts
interface SerializedConfig {
  tokens: any;
  propConfig: string;
  groupRegistry: string;
  transforms: Record<string, NamedTransform>;
  globalStyles?: Record<string, Record<string, any>>;  // NEW
}
```

The value is the raw style objects (not yet resolved) — resolution happens in the Vite plugin where theme data is available.

**Why**: The system builder stores the global styles as-is. Resolution requires the flattened theme (which comes from evaluating the tokens). Keeping them unresolved in `serialize()` means the system doesn't need to self-resolve during construction.

## Risks / Trade-offs

**[Risk: Transform placeholders in global CSS]** If global styles use props with transforms (e.g., `border: 1` → `borderShorthand`), the JS resolver needs to apply transforms directly — not emit `__TRANSFORM__` placeholders. The transforms are available in `serialize().transforms`.
→ **Mitigation**: The JS resolver calls transform functions directly from the transforms map. No placeholder round-trip needed.

**[Risk: Pseudo-elements and complex selectors]** Some selectors (`body::after`, `*::before`) need to be emitted as-is. The resolver only processes VALUES, not selectors.
→ **Mitigation**: Selectors are pass-through strings. Only the style object values get resolved.

**[Risk: Token alias syntax in global styles]** If a global style uses `{colors.primary/50}`, the JS resolver needs token alias resolution too.
→ **Mitigation**: Implement the same `{...}` scanning in the JS resolver. Or skip token alias support in global styles for v1 — it's a compound feature.

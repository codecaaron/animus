## Context

The Animus extraction pipeline produces raw CSS strings — unminified, un-autoprefixed. CSS exits as `String` from Rust via `analyze_project()` → `UniverseManifest`, then gets served by the Vite plugin through two delivery paths:

- **Dev mode**: Component CSS delivered via `virtual:animus/components.js` (JS-exported string) → adopted stylesheets. Variables + globals delivered via `virtual:animus/styles.css`.
- **Prod mode**: All CSS concatenated into `virtual:animus/styles.css`.

Transform placeholder resolution (`__TRANSFORM__[name](value)__`) already happens as a post-processing step in the Vite plugin after receiving CSS from Rust. Unit fallback for bare numerics also happens in the plugin. Lightning CSS integration adds one more step to this existing post-processing chain.

Lightning CSS (`lightningcss` npm package / Rust crate) preserves `@layer` blocks and CSS custom properties untouched — confirmed safe for our architecture.

## Goals / Non-Goals

**Goals:**
- Production CSS is minified (reduced file size)
- CSS is autoprefixed for configured browser targets in both dev and prod
- Browser targets are configurable with sensible defaults
- Integration is a clean post-processing step — no changes to extraction logic
- Zero breaking changes — unconfigured behavior matches current output

**Non-Goals:**
- CSS nesting lowering (we don't emit nested CSS)
- CSS Modules support (we have our own scoping)
- Source map integration (future work, separate concern)
- Rust-side integration (the Vite plugin is the right integration point — extraction crate stays focused on extraction)
- Replacing Vite's built-in CSS pipeline (we control our own virtual modules)

## Decisions

### Decision 1: Integration point — Vite plugin, not Rust crate

**Choice:** Post-process CSS in the Vite plugin using `lightningcss` Node.js bindings.

**Why not Rust:** The Rust crate's concern is extraction + CSS generation. Adding optimization blurs its purpose. The Vite plugin already does post-processing (transform resolution, unit fallback). Dev mode should skip minification for debuggability — this is a build-tool concern, not an extraction concern. The `lightningcss` npm package is what Vite itself uses, so it's already in the dependency tree.

**Alternative considered:** Rust-native `lightningcss` crate as optional dependency. Rejected because: adds compile-time cost to every Rust build, configuration (browser targets) is a build-tool concern, and non-Vite consumers are a future hypothetical.

### Decision 2: Single `postProcessCss()` function

**Choice:** A single function that takes a CSS string and returns a processed CSS string. Called at the end of the existing post-processing chain, after transform resolution and unit fallback.

```
CSS from Rust → resolve transforms → unit fallback → postProcessCss() → serve
```

Both dev and prod paths call this function. The function's behavior varies by mode:
- **Dev:** Autoprefix only (preserves formatting for readability)
- **Prod:** Autoprefix + minify

This keeps the integration surface minimal — one function, called in two places (component CSS delivery and styles.css delivery).

### Decision 3: Browser targets configuration

**Choice:** Three-level fallback for browser targets:

1. Explicit `targets` option in plugin config → highest priority
2. Project's browserslist config (`.browserslistrc`, `package.json#browserslist`) → auto-detected
3. Default: `defaults` browserslist query → sensible baseline

The plugin config surface:
```typescript
animusExtract({
  system: './src/ds.ts',
  // New options:
  targets?: string | string[],  // browserslist query string(s)
  minify?: boolean,              // override: true = always minify, false = never
})
```

`minify` defaults to `undefined` (auto: minify in prod, skip in dev). Explicit `true`/`false` overrides the auto behavior.

**Why browserslist strings, not Lightning CSS `Targets` objects:** Browserslist is the ecosystem standard. Users already have `.browserslistrc` files. Lightning CSS's `browsersToTargets()` converts browserslist output to its internal format.

### Decision 4: Dev mode autoprefixes but does not minify

**Choice:** Dev mode runs Lightning CSS with `minify: false`. This preserves readable CSS in browser devtools while still adding necessary vendor prefixes (e.g., `-webkit-backdrop-filter`).

**Why autoprefix in dev:** If a developer tests on Safari during development and we don't autoprefix, features like `backdrop-filter` or `user-select` may not work. The dev/prod CSS should be functionally equivalent.

**Why not minify in dev:** Minification destroys readability. Dev mode CSS needs to be inspectable in browser devtools. The adopted stylesheet path already makes dev CSS slightly harder to inspect — minification would make it impossible.

### Decision 5: Error handling — graceful degradation

**Choice:** If Lightning CSS processing fails (malformed CSS, version mismatch, etc.), fall back to serving the unprocessed CSS with a console warning.

**Why:** A post-processing failure should never block development. The unprocessed CSS is functionally correct — it just lacks vendor prefixes and minification. This is a safe degradation path.

### Decision 6: lightningcss as a dependency, not a peer dependency

**Choice:** `@animus-ui/vite-plugin` adds `lightningcss` as a direct dependency.

**Why not peer dep:** Lightning CSS is an implementation detail of the plugin, not a consumer-facing API. The consumer shouldn't need to install it separately. The npm package is small (~2MB, platform-specific binary).

**Why not optional:** Autoprefixing is a baseline expectation for production CSS tools. Making it optional means consumers ship un-autoprefixed CSS by default — an antipattern.

## Risks / Trade-offs

**[Risk] Lightning CSS is alpha (1.0.0-alpha.71)** → Mitigated: Parcel and Vite both depend on it in production. The API is stable in practice. Pin the exact version.

**[Risk] Vendor prefix additions change CSS output size** → Acceptable: prefixes are small and necessary. Net size change should be negative (minification savings >> prefix additions).

**[Risk] Adjacent @layer merging during minification** → Investigate: Lightning CSS merges adjacent `@layer` blocks with the same name during minification. We emit separate layer blocks (base, variants, states, system, custom). If they have different names (they do), no merging occurs. Safe.

**[Risk] Lightning CSS modifies `calc()` expressions** → Low risk: our CSS uses simple calc expressions. Lightning CSS simplifies but doesn't break them. Verify in canary tests.

**[Trade-off] Dev mode gets vendor prefixes it may not need** → Acceptable: the processing overhead is <5ms for our CSS volume. The correctness benefit outweighs the marginal cost.

**[Trade-off] New dependency adds ~2MB to plugin package size** → Acceptable: this is a build-time tool. The runtime bundle is unaffected.

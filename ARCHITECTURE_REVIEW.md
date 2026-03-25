# Animus: Architecture Review

> **For external review.** This document describes the complete Animus CSS extraction architecture as implemented on the `next` branch. The goal is adversarial analysis — probe the architectural invariants, find pathological cases, and identify genuine weaknesses. Each section states what the system does, why, and where the real attack surface is.

---

## 1. The Thesis

Animus is a **type-state machine for CSS**. The TypeScript builder chain enforces method ordering at compile time via progressive generic narrowing:

```
styles() → variant() → states() → groups() → props() → asElement()
```

Each step maps to a CSS `@layer`:

```
@layer global, base, variants, states, system, custom;
```

**The cascade contract:** later layers ALWAYS override earlier layers. A variant always beats a base style. A state always beats a variant. System props always beat states. This ordering is enforced by TypeScript generics at author-time and by CSS `@layer` at runtime. They are the same constraint expressed in two type systems.

**The extraction thesis:** because the builder chain is a finite state machine with static transitions, the complete CSS universe is enumerable at build time. Every possible style rule can be computed ahead of time. No runtime style computation is needed.

**There is no runtime fallback.** Emotion is fully eliminated. The `next` branch has zero Emotion dependency. Components that cannot be statically analyzed are eliminated from the build with console warnings. Per-property bail extracts what's static and warns about what isn't. The developer writes extractable code; the build system enforces it.

**Dynamic values use CSS custom property slots.** Static analysis covers the vast majority of style values. For truly unknowable runtime values (user input, server-driven config), the architecture uses CSS variable slots — extracted CSS references `var(--runtime-value)` and the runtime shim sets the variable. This is the designed mechanism for runtime dynamism, not a fallback.

**Variant reconciliation uses conservative fallback.** The JSX scanner identifies which variant values and state props are used at callsites. If a variant value can't be statically resolved (dynamic expression, function parameter), ALL options for that variant are retained in CSS output. Dynamic usage triggers safe retention, not aggressive elimination — identical to how Rollup tree-shaking handles dynamic imports.

**Runtime cost:** 1.3KB gzipped shim (`createComponent`) that concatenates class names and filters props. No style computation. No CSS injection. No Emotion. No styled-components. No runtime CSS-in-JS of any kind.

---

## 2. Architecture

### Package Graph (build order)

```
extract (Rust/NAPI) → core → theming → runtime → system → vite-plugin → showcase
```

**Ships to npm (4 packages):**
- `@animus-ui/system` — builder chain + theme + token system
- `@animus-ui/react` — 1.3KB runtime shim (currently named `runtime`, rename pending)
- `@animus-ui/vite-plugin` — extraction + HMR + CSS delivery
- `@animus-ui/extract` — Rust NAPI binary (per-platform)

**Internal only:** `core` (legacy Emotion builder), `theming` (re-exported via system), `components` (old Emotion UI library)

### Rust Crate (`@animus-ui/extract`)

The extraction pipeline is a single Rust crate composed from:
- **OXC** (oxc_parser, oxc_ast) — TypeScript/JSX parsing. Same parser Rolldown uses.
- **NAPI-RS** — Rust↔Node.js bridge. Same bridge Rolldown uses.
- **serde/serde_json** — Serialization across the NAPI boundary.

**Three NAPI functions:**

| Function | Input | Output | When |
|----------|-------|--------|------|
| `analyze_project()` | All source files + theme + config | Full manifest (components, CSS, sheets, report) | buildStart |
| `transform_file()` | Single file + manifest | Replaced source code | Per-file transform |
| `extract()` | Single file + theme + config | Per-file CSS + metadata | Legacy/incremental |

**Crate modules (11):**

| Module | Responsibility |
|--------|---------------|
| `chain_walker.rs` | Find `.asElement()`/`.asComponent()` terminals, walk builder chain backwards |
| `style_evaluator.rs` | `ObjectExpression` AST → JSON values. Per-property bail on non-static expressions |
| `theme_resolver.rs` | Token alias resolution (`{colors.primary}` → `var(--colors-primary)`) |
| `css_generator.rs` | Resolved styles → `@layer`-structured CSS. Returns `CssSheets` struct |
| `jsx_scanner.rs` | Walk JSX elements + CallExpression args for prop usage, variant values, state activations |
| `transform_emitter.rs` | Generate `createComponent()` replacement code with source spans |
| `project_analyzer.rs` | Multi-file universe analysis. Manifest generation. Ordering + reconciliation |
| `chain_merger.rs` | Extension chain merging (`.extend()` across files) |
| `import_resolver.rs` | Cross-file import/re-export resolution. Barrel file traversal |
| `reconciler.rs` | Dead variant/state elimination based on JSX usage ledger |
| `size_transform.rs` | Reimplements the `size` transform from JS in Rust |

### Vite Plugin Lifecycle

```
configResolved → buildStart → resolveId/load → transform → handleHotUpdate
```

**buildStart (full initialization):**
1. Load system instance via bun subprocess (ESM isolation)
2. Evaluate theme → CSS custom properties + variable map
3. Resolve global styles via bun subprocess (prop shorthand expansion)
4. Discover all `.ts/.tsx/.js/.jsx` files + workspace package sources
5. Call `analyze_project()` in Rust → manifest + CSS + sheets
6. Post-process any `__TRANSFORM__` placeholders via subprocess
7. Surface elimination warnings (always-on) + verbose diagnostics

**Virtual modules (CSS delivery):**

| Module | Dev | Prod |
|--------|-----|------|
| `virtual:animus/styles.css` | Layer declaration + CSS variables + globals (static only) | All CSS concatenated |
| `virtual:animus/components.js` | Component CSS as JS string export | N/A |
| `virtual:animus/hmr-bridge.js` | Adopted stylesheet manager with HMR | N/A |

**Dev CSS delivery (split mode):**
- Static CSS (layer declaration, variables, globals) → regular `<style>` tag via Vite CSS pipeline
- Component CSS (base, variants, states, system, custom) → Constructable `CSSStyleSheet` + `replaceSync()`
- HMR updates call `replaceSync()` — browser internally diffs rules, preserving CSS animations
- Bridge injected via `transform` hook (first transformed file), NOT `transformIndexHtml` (browser treats `virtual:` as a URL protocol in inline scripts → CORS block)

**HMR strategy:**
- **Geological changes** (theme/config/system file edit): full re-analysis via Rust, invalidate all virtual modules, full page behavior
- **Component changes** (any other file): content-hash check, re-extract only if changed, invalidate component CSS module only
- Current latency: ~57ms for 32 files. Target with incremental caching: <5ms.

### Runtime Shim

```typescript
createComponent(element, className, config) → React.forwardRef component
```

- Builds class list: `[baseClass, ...variantClasses, ...stateClasses, ...systemPropClasses, externalClassName]`
- Filters Animus-managed props before forwarding to element
- HTML elements: `isPropValid()` check. Components: forward all non-managed props.
- `.extend()` throws with message directing to source-code extension
- No style computation. No CSS injection. No theme context reads.
- **Server-safe:** pure computation — no hooks, state, effects, or browser APIs. `React.forwardRef` is available in server contexts. Extracted CSS is static files served independently of the component tree. RSC-compatible by design.

### System Builder

```typescript
createSystem()
  .withTokens(themeBuilder => { ... })     // Token scales + CSS variables
  .withProperties(propBuilder => { ... })  // Prop groups (space, color, typography, etc.)
  .withGlobalStyles({ reset, global })     // @layer global CSS
  .build()                                 // → SystemInstance with .serialize()
```

`SystemInstance.serialize()` returns the complete extraction config: prop definitions, group registry, tokens, transforms, global styles. This is the single source of truth passed to the Rust crate.

---

## 3. The Cascade Contract

This is the architectural invariant. Everything else can change; this cannot.

```
@layer global, base, variants, states, system, custom;
```

| Layer | Source | Overrides | Overridden by |
|-------|--------|-----------|---------------|
| `global` | `.withGlobalStyles()` | nothing | everything |
| `base` | `.styles()` | global | variants, states, system, custom |
| `variants` | `.variant()` | base | states, system, custom |
| `states` | `.states()` | variants | system, custom |
| `system` | `.groups()` (system props at JSX callsite) | states | custom |
| `custom` | `.props()` | system | nothing |

**Cross-layer specificity is irrelevant.** CSS `@layer` spec guarantees that a higher-priority layer wins regardless of selector specificity in a lower layer. A `div > .foo:hover` in `@layer base` CANNOT override a `.bar` in `@layer variants`. This is the entire point of `@layer`.

**`!important` is passed through, not stripped.** The CSS spec reverses `@layer` priority for `!important` declarations — an `!important` rule in a lower layer beats a normal rule in a higher layer. Animus does not strip, reject, or interfere with `!important`. This matches every CSS framework in the ecosystem: Tailwind actively provides it via `!` prefix and a global `important: true` config; Emotion, styled-components, StyleX, Panda CSS, Vanilla Extract, and CSS Modules all pass it through unchanged. No CSS tooling strips `!important` — doing so would be unprecedented and hostile to developers who need it for third-party overrides, testing, and edge cases. If a developer uses `!important` and breaks their own cascade, that is an authoring decision, not an architectural flaw.

**Intra-layer specificity is normal CSS.** Within a single layer, standard CSS specificity rules apply. The framework generates flat class-based selectors (`.animus-Component-hash { property: value }`), which are all equal specificity. Complex selectors (`'&:hover > span'`) in style objects are user-authored — specificity management within a layer is a CSS authoring concern, not an architectural flaw. This is true of all CSS ever written.

**Extensions** (`.extend()`) emit AFTER parents within the same layer. Same specificity, later source order wins. This matches CSS `@layer` spec behavior.

**States are NOT variants.** States are composable boolean toggles (multiple can be active simultaneously). Variants are exclusive options (one value per variant prop). This distinction matters for CSS generation — variants use `.component--variantName-value` selectors, states use `.component--stateName` selectors.

**Semantic DOM states** (disabled, open, hidden) are NOT handled by `.states()`. They're handled via selector syntax in `.styles()`: `'&[disabled]': { opacity: 0.6 }`. The `.withSelectors()` system builder method (designed, implementation pending) registers shorthands for these.

**Layer coexistence with external frameworks:** The plugin accepts configuration to declare external `@layer` names and weave Animus layers into the correct position. The cascade contract invariant is validated at build time — Animus's 6 layers must appear in the correct relative order. External layers can be interleaved freely. If the configuration violates the internal ordering, the build fails:

```typescript
animusExtract({
  layers: {
    external: ['tailwind.base', 'tailwind.components', 'tailwind.utilities'],
    // Emits: @layer tailwind.base, tailwind.components, animus.global, animus.base,
    //        animus.variants, animus.states, animus.system, animus.custom, tailwind.utilities;
  }
})
```

---

## 4. Runtime Complexity Model

### Build Time

| Phase | Complexity | Current Benchmark |
|-------|-----------|-------------------|
| File discovery | O(files) | <10ms |
| Rust analysis (parse + walk + evaluate + generate) | O(files × chains × properties) | ~2ms/file |
| JSX scanning (prop usage) | O(files × JSX elements × props) | Included in above |
| Reconciliation (dead code elimination) | O(components × variants) | <5ms |
| Transform (per-file replacement) | O(files × chains) | <1ms/file |
| Total (32-file showcase) | | ~130ms |

**Pathological cases to probe:**
- File with 100+ builder chains (many components in one file)
- Barrel file re-exporting 500+ components (import resolver traversal)
- Component with 50+ variants × 10+ options each (CSS output size explosion)
- Deeply nested extension chain (A extends B extends C extends D...)
- Circular import graph (does import resolver detect and bail?)

### Dev Time (HMR)

| Scenario | Current | With incremental cache |
|----------|---------|----------------------|
| Single component file edit | ~57ms (full re-analysis) | <5ms (re-extract one file) |
| Theme/config edit | Full reload | Full reload (correct) |
| New file added | Full re-analysis | Full re-analysis (correct) |
| Import graph change | Full re-analysis | Full re-analysis (correct) |

### Runtime

| Operation | Cost |
|-----------|------|
| Component render | className concatenation (string ops only) |
| Variant resolution | Object key lookup → className |
| State resolution | Boolean check → className |
| System prop resolution | Object key lookup → className |
| Style computation | **Zero.** All CSS is static. |

### CSS Output Size

For 23-component showcase:
- Total CSS: ~15KB (uncompressed, all layers)
- JS bundle: ~277KB (gzip ~80KB) — zero Emotion runtime
- Eliminated vs Emotion: entire `@emotion/react`, `@emotion/styled`, `@emotion/cache`, `stylis` removed from bundle

---

## 5. What Ships at RC (Known Roadmap)

### Must-Have (blocks RC)

| Change | Status | Impact |
|--------|--------|--------|
| **scale-miss-fallback** | Ready | `px` unit suffix for bare numeric values that miss theme scale. Currently emits invalid CSS (`padding: 8` instead of `padding: 8px`). JS post-processing using unitless property set. |
| **bail-visibility** | Ready | Surface per-component bail reasons and per-property skip warnings to console by default (currently verbose-gated). `strict` option escalates to build errors. |
| **cross-platform-napi** | Ready | GitHub Actions CI matrix build for 3 targets (arm64-darwin, x64-linux, arm64-linux). Blocks npm publishing. |
| **publishing-surface** | Ready | Rename `runtime` → `react`. System re-exports theming. Plugin gains `runtime` option for framework-agnostic output. Version align to `0.1.0-next.1`. |

### Should-Have (improves DX)

| Change | Status | Impact |
|--------|--------|--------|
| **incremental-hmr** | Ready | Per-file extraction cache + delta merge. 57ms → <5ms HMR. |
| **cascade-assertions** | Design | Clarify states vs selectors. `.withSelectors()` system builder method. |
| **selector-registry** | Design | System-level selector shorthand vocabulary (`'&:open'` → `'&[data-state="open"]'`). |

### Future

| Change | Status | Impact |
|--------|--------|--------|
| **Prod CSS split via emitFile** | Designed | CDN-cacheable static CSS (vars/globals) separate from per-deploy component CSS |
| **Incremental dev extraction** | Spike needed | CSSOM-level patching for sub-ms HMR. Two-track dev/prod architecture. |
| **Lightning CSS post-processing** | Not started | Minification, autoprefixing, deduplication of extracted CSS |
| **Layer coexistence config** | Designed | Plugin option to declare external `@layer` names and weave Animus layers into correct position. |
| **Subprocess timeout hardening** | Not started | ms-level timeout on transform/theme subprocesses. Restart on timeout with diagnostic. |

---

## 6. Known Gaps (Honest Assessment)

### Architectural

1. **Per-property bail produces partial CSS.** Non-static properties are omitted from output. No runtime fallback — omitted properties are simply missing. The `bail-visibility` change (ready to implement) surfaces all skips as console warnings by default. `strict` mode escalates to build errors. This is intentional: extract what's static, warn about what isn't, let the developer decide.

2. **Bun subprocess coupling.** System loading, global style resolution, and transform resolution use `bun` subprocesses for ESM isolation. Non-bun environments (Node.js, Deno) would need adaptation. The Rust crate itself is environment-agnostic.

3. **Single-shot analysis model.** `buildStart` runs full project analysis once. No incremental compilation yet — `incremental-hmr` proposal addresses this.

4. **Transform subprocess fragility.** Named transforms emit `__TRANSFORM__` placeholders resolved by JS subprocess. Silent subprocess failure leaks placeholders into CSS. Currently caught by verbose logging. Timeout hardening is planned.

5. **No source maps for extracted CSS.** Class names are deterministic (`animus-{binding}-{hash}`) but no mapping back to TypeScript source.

### Testing

6. **Canary tests, not comprehensive unit tests.** Design decision: canary tests validate end-to-end pipeline. Showcase build is the integration test. Type regression tests cover the builder chain.

7. **No visual regression testing.** Verified by manual inspection and bundle analysis.

### Ecosystem

8. **React-only runtime.** Plugin's `runtime` option (planned) enables framework swapping, but no non-React runtime exists yet.

9. **Vite-only plugin.** Rust crate's NAPI functions are bundler-agnostic, but only a Vite plugin exists.

10. **No ad-hoc `css()` utility.** Every styled element uses the builder chain. Escape hatches: `.withGlobalStyles()` or plain CSS files.

---

## 7. Adversarial Prompts

Stress-test these. Each probes a specific architectural assumption.

### Cascade & Correctness

> **A1.** The cascade contract says `@layer variants` always overrides `@layer base`. CSS spec confirms cross-layer specificity is irrelevant. But: construct a scenario using `!important` within a lower layer — does `!important` in `@layer base` override normal declarations in `@layer variants`? (CSS spec says yes — `!important` reverses layer order.)

> **A2.** Extension chains (`.extend()`) emit child CSS after parent within the same `@layer`. What happens in diamond inheritance: A extends B, A extends C, both B and C define the same base style property? What's the resolution order? Is it deterministic?

> **A3.** The reconciler uses conservative fallback for dynamic variant values (keep all options). But what's the CSS size impact at scale? A component with 20 variants × 5 options each, where none are statically resolved, retains 100 CSS rule blocks. Multiply by 50 components. What's the worst-case CSS output size with fully-dynamic usage?

### Runtime Complexity

> **B1.** `analyze_project()` processes all files in a single call. For a monorepo with 500 components across 50 workspace packages, what's the memory footprint? OXC allocates per-file arenas — are they freed between files or held until analysis completes?

> **B2.** The import resolver follows re-export chains through barrel files. For a barrel `index.ts` that re-exports from 200 files, each of which re-exports from sub-barrels, what's the resolution complexity? Is there cycle detection?

> **B3.** The JSX scanner traces import bindings to identify extracted components. In a file with 50 component imports rendered inside nested `.map()` / `.filter()` chains — what's the scanner's time complexity? Graceful degradation or cliff?

### Build Pipeline

> **C1.** The `__TRANSFORM__` placeholder pattern: (a) subprocess times out, (b) transform throws, (c) transform returns invalid CSS. What's the failure mode for each? Is there validation after resolution?

> **C2.** Theme evaluation at `buildStart` — the theme module can import other modules, use dynamic expressions, call APIs. What constraints exist? Timeout? Side effects?

> **C3.** Content-hash HMR checks source text of the changed file. If a file's content is identical but its dependency changed (re-export renamed, type narrowed), would HMR miss the invalidation?

### CSS Output

> **D1.** Responsive values generate `@media` queries. What's the interaction between `@layer` and `@media`? Are `@media` rules nested inside `@layer` blocks? Does nesting order affect cascade priority?

> **D2.** Pseudo-selectors and combinators in style objects — what's the full supported set? `:has()`, `:is()`, `:where()`, `& > div`, `& + span`?

> **D3.** Layer coexistence: if a third-party library declares `@layer base, components, utilities` and Animus declares `@layer global, base, variants, states, system, custom` — the shared `base` name creates ambiguity. CSS treats them as the same layer. How does the coexistence config prevent name collisions?

### Developer Experience

> **E1.** Non-static property bail: the developer writes `.styles({ color: someImportedConst })`, per-property bail skips it with a warning. In a busy terminal, warnings get buried. What's the DX for catching these before production? Does `strict` mode exist?

> **E2.** The type-state machine enforces method order. What's the error message when a developer calls `.states()` before `.styles()`? Clear guidance or TypeScript inference wall?

> **E3.** System prop utility classes use content hashes (`animus-u-{hash}`). In browser DevTools, how does a developer trace `animus-u-a1b2c3d4` back to `padding: 16px`?

### Ecosystem & Scaling

> **F1.** Shared component libraries in a monorepo: each consuming app runs its own extraction. Shared components extracted N times. Is there a caching/sharing story across apps?

> **F2.** The runtime shim is server-safe (pure computation, no hooks/state/effects). But: streaming SSR where CSS must be available before component renders — how does the static CSS file get linked in the HTML `<head>` before React streams the body?

> **F3.** CSS `@layer` browser support: Chrome 99+, Safari 15.4+, Firefox 97+ (all 2022). Is `@layer` a hard requirement? Fallback mode?

---

## 8. Key Numbers

| Metric | Value |
|--------|-------|
| Packages (total / shipping) | 9 / 4 |
| Rust crate modules | 11 |
| NAPI exported functions | 3 |
| Vite hooks used | 6 |
| Virtual modules | 3 |
| CSS cascade layers | 6 |
| Canonical specs | 33 |
| Archived implementation changes | 34 |
| Open proposals | 8 |
| Showcase components | 23 (fully extracted, zero Emotion) |
| JS bundle (showcase) | ~277KB (~80KB gzip) |
| Runtime shim size | ~1.3KB gzip |
| Extraction speed | ~2ms/file |
| HMR latency (current) | ~57ms / 32 files |
| HMR latency (target) | <5ms single file |
| Platform targets | 3 (arm64-darwin, x64-linux, arm64-linux) |
| Test suites | 7 (canary, types, core, theming, plugin, integration, showcase build) |

---

## 9. What Makes This Novel

No other CSS framework combines all of these:

1. **Type-state machine → CSS `@layer` isomorphism.** The TypeScript generic narrowing that enforces builder method order IS the CSS cascade priority. Same constraint, two type systems.

2. **Finite style universe.** Because the builder chain is a finite state machine, the complete set of possible style rules is enumerable. Extraction is total, not heuristic. Dynamic values use CSS variable slots. Unresolvable variant usage triggers conservative retention.

3. **Rust extraction via OXC.** Same parser as Rolldown. Not a regex-based extractor (Tailwind) or a Babel plugin. Full AST analysis with per-property granularity.

4. **Reconciliation as dead code elimination.** JSX scanning builds a usage ledger. Variants and states not used in any JSX callsite are eliminated from CSS output. This is tree-shaking for CSS, driven by actual usage analysis — with conservative fallback for dynamic usage.

5. **Adopted stylesheets for animation-safe HMR.** Dev mode uses `CSSStyleSheet.replaceSync()` which triggers browser-internal CSS diffing. Unchanged rules preserve running animations.

6. **Extension ordering via source order within shared layers.** `.extend()` doesn't create new layers or increase specificity. Child CSS appears after parent CSS within the same `@layer`. CSS spec guarantees later source order wins at equal specificity within a layer.

7. **Layer coexistence.** External framework layers can be interleaved with Animus layers via plugin configuration. The cascade contract invariant (internal layer ordering) is validated at build time.

---

*All code references are to the `next` branch of the Animus monorepo.*

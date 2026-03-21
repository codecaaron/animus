## 1. Rust Crate Scaffolding

- [x] 1.1 Initialize Cargo workspace at `packages/extract/` with `Cargo.toml` (oxc 0.121.0, lightningcss 1.0.0-alpha.71, string_wizard 0.0.27, napi 3.x, napi-derive 3.x, serde, serde_json)
- [x] 1.2 Set up napi-rs build scaffolding: `build.rs`, `.cargo/config.toml`, `package.json` with napi build scripts and platform-specific optional deps
- [x] 1.3 Create `lib.rs` with NAPI `extract()` function stub that returns an empty `ExtractionResult` struct. Verify it compiles and is callable from JS.

## 2. Chain Walker

- [x] 2.1 Implement `chain_walker.rs`: parse source via `oxc_parser`, traverse AST to find `.asElement(tag)` terminal calls, walk CallExpression chain backwards to `animus` identifier
- [x] 2.2 Collect chain stages: for each method call in the chain, record the method name and argument AST node span. Produce `ChainDescriptor` struct with terminal type, tag, and stage entries.
- [x] 2.3 Handle bail detection: mark chains as non-extractable when `.groups()`, `.props()`, `.extend()`, or `.asComponent()` are found. Record reason string.
- [x] 2.4 Handle multiple chains per file: walk all terminals independently, produce `Vec<ChainDescriptor>`
- [x] 2.5 Extract the JS binding name (variable name the chain is assigned to) from the parent VariableDeclarator

## 3. Style Evaluator

- [x] 3.1 Implement `style_evaluator.rs`: convert ObjectExpression AST nodes to `serde_json::Value`. Handle StringLiteral, NumericLiteral, nested ObjectExpression, ArrayExpression.
- [x] 3.2 Implement bail detection for non-static expressions: TemplateLiteral with expressions, Identifier references, CallExpression, SpreadElement, ComputedMemberExpression. Return `Err` with reason.
- [x] 3.3 Parse variant stage arguments: extract `prop` (default `"variant"`), `defaultVariant`, `base`, and `variants` map from the options object.
- [x] 3.4 Parse states stage arguments: extract state name → style object map.

## 4. Theme Resolver

- [x] 4.1 Implement `theme_resolver.rs`: accept flattened theme JSON (`HashMap<String, String>` keyed by `"scale.key"`) and prop config JSON. For each style prop, look up config to get CSS property, scale, and transform identifier.
- [x] 4.2 Implement scale lookup: given a prop value and scale name, look up `"scale_name.value"` in the theme map. If found, use the theme value. If not, pass through raw value.
- [x] 4.3 Implement multi-property expansion: when config has `properties` array, emit the resolved value for each property in the array.
- [x] 4.4 Separate pseudo-selectors from prop keys: keys starting with `&` or `:` are CSS selectors, not prop names. Route them to nested rule generation.
- [x] 4.5 Separate responsive objects from scalar values: values that are objects with `_`, `xs`, `sm`, `md`, `lg`, `xl` keys are responsive breakpoint maps. Route them to @media generation.

## 5. Transforms (Port from JS)

- [x] 5.1 Implement `transforms.rs`: port `size` / `percentageOrAbsolute` (0→0, 0<n≤1→%, n>1→px, string passthrough with unit detection, calc passthrough)
- [x] 5.2 Port `borderShorthand`: `numberToTemplate(val, width => "${width}px solid currentColor")`
- [x] 5.3 Port `gridItemRatio` / `parseGridRatio` / `gridItem`: parse `"15rem:1"` ratio strings into `minmax(0, ...)` repeat patterns
- [x] 5.4 Wire transforms to resolver via string identifiers: `"size"`, `"borderShorthand"`, `"gridItemRatio"` in config JSON → Rust function dispatch

## 6. CSS Generator

- [x] 6.1 Implement `css_generator.rs`: take resolved style maps and produce @layer-structured CSS strings. Generate `@layer base, variants, states, system, custom;` declaration.
- [x] 6.2 Generate base layer CSS: `.animus-{binding}-{hash} { prop: value; }` inside `@layer base {}`
- [x] 6.3 Generate variant layer CSS: `.animus-{binding}-{hash}--{prop}-{option} { ... }` inside `@layer variants {}`. Handle variant `base` styles as shared styles across all options of that variant.
- [x] 6.4 Generate state layer CSS: `.animus-{binding}-{hash}--{state} { ... }` inside `@layer states {}`
- [x] 6.5 Generate pseudo-selector rules: `&:hover` → `.animus-Name-hash:hover`, `&:before` → `.animus-Name-hash::before`, `&:nth-child(even)` → `.animus-Name-hash:nth-child(even)`. Handle within each layer.
- [x] 6.6 Generate responsive @media queries: for responsive objects, emit default value unscoped and breakpoint values wrapped in `@media (min-width: Npx)`. Place within the appropriate layer.
- [x] 6.7 Implement deterministic class name hashing: `animus-{binding}-{8-char content hash of normalized chain descriptor}`

## 7. Source Replacer

- [x] 7.1 Implement `transform_emitter.rs` using string_wizard: replace chain expression spans with `createComponent(tag, className, config)` calls
- [x] 7.2 Generate the runtime config object for createComponent: `{ variants: { propName: { options: [...], default: ... } }, states: [...] }`
- [x] 7.3 Add import statements to transformed source: `import { createComponent } from '@animus-ui/runtime'` and CSS virtual module import
- [x] 7.4 Handle multiple replacements per file: apply all span replacements via string_wizard in a single pass (spans must not overlap)

## 8. Wire NAPI Bridge

- [x] 8.1 Wire all stages together in `lib.rs`: parse → walk → evaluate → resolve → generate → replace. Return `ExtractionResult` with css, code, components, extractable, errors.
- [x] 8.2 Handle partial extraction: when a file has both extractable and non-extractable chains, extract what's possible and leave the rest.

## 9. Vite Plugin

- [x] 9.1 Create `packages/vite-plugin/` package with `src/index.ts` exporting `animusExtract(options?) -> Plugin`
- [x] 9.2 Implement `theme-evaluator.ts`: at `buildStart`, use `ssrLoadModule()` to import and evaluate the theme module, flatten all scales to `{ "scale.key": "value" }` JSON map
- [x] 9.3 Implement prop config serialization: import config from `@animus-ui/core`, map transform functions to string identifiers, serialize to JSON
- [x] 9.4 Implement `transform` hook: for matching files, call Rust `extract()` with source, filename, theme JSON, config JSON. Return transformed code or null.
- [x] 9.5 Implement CSS virtual module system: `resolveId` for `virtual:animus/*` imports, `load` hook to serve extracted CSS content, ensure @layer declaration appears once

## 10. Runtime Shim

- [x] 10.1 Create `packages/runtime/` package with `src/index.ts` exporting `createComponent(tag, className, config)`
- [x] 10.2 Implement className assembly: base class + variant modifier classes + active state classes. Merge with external `className` prop.
- [x] 10.3 Implement prop filtering: strip variant/state/config props from DOM element, forward everything else (children, event handlers, ARIA, data attrs)
- [x] 10.4 Implement ref forwarding via `React.forwardRef`
- [x] 10.5 Implement `.extend()` method on returned component: returns `AnimusExtended` initialized with the extracted config

## 11. Canary Integration Test

- [x] 11.1 Create test fixture: a `.tsx` file containing `ButtonContainer` (styles + variant + pseudo-selectors) and `ButtonForeground` (variant + variant) chains from `_docs/elements/Button.tsx`
- [x] 11.2 Write canary test: call `extract()` on the fixture, assert CSS output contains @layer structure with correct class names, pseudo-selectors, and scale-resolved values
- [x] 11.3 Write canary test: assert transformed JS contains `createComponent` calls with correct variant/state config
- [x] 11.4 Write bail test: fixture with `.groups()` chain, assert `extractable: false` and source unchanged

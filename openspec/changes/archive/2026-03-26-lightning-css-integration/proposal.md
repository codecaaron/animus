## Why

The extraction pipeline produces functionally correct CSS but ships it raw — unminified, un-autoprefixed, with no syntax lowering. Every production CSS tool (Tailwind, Panda, vanilla-extract) autoprefixes and minifies. This is table stakes for production readiness. Lightning CSS is Rust-native, ~100x faster than PostCSS equivalents, preserves `@layer` blocks and CSS custom properties untouched, and is already the engine Vite uses internally. Integration closes a real competitive gap with zero architectural risk.

## What Changes

- **Vite plugin gains a post-processing step** that runs Lightning CSS on all generated CSS before serving virtual modules. Autoprefixing applies in both dev and prod modes. Minification applies in prod only (dev stays readable for debugging).
- **Browser targets are configurable** via the plugin's `targets` option, falling back to the project's browserslist config, falling back to sensible defaults.
- **Dev mode adopted stylesheet path and prod mode virtual CSS module path both receive autoprefixing** — the post-processing step sits after transform placeholder resolution and before final delivery, covering both paths.
- **CSS output size decreases** in production builds (minification removes whitespace, merges adjacent rules, folds longhands into shorthands where safe).
- **Vendor prefixes added automatically** for configured browser targets (flexbox gap, backdrop-filter, etc.).
- **Optional: Rust crate gains `lightningcss` as an optional dependency** for standalone post-processing in non-Vite contexts (test output formatting, future bundler plugins).

## Capabilities

### New Capabilities
- `css-post-processing`: CSS minification, autoprefixing, and syntax lowering via Lightning CSS. Covers browser target configuration, dev/prod mode behavior, and integration with the existing transform resolution pipeline.

### Modified Capabilities
- `vite-extraction-plugin`: Plugin gains post-processing hooks, new configuration surface (`targets`, `minify`), and modified virtual module load paths that run CSS through Lightning CSS before delivery.

## Impact

- **packages/vite-plugin**: New dependency on `lightningcss` Node.js bindings. Modified `load()` hook for virtual modules. New config options surface.
- **packages/extract** (optional): New optional Cargo dependency on `lightningcss` crate. New public `post_process()` function behind feature flag.
- **packages/showcase**: Serves as validation — prod build CSS should be measurably smaller. Dev build CSS should gain vendor prefixes without losing readability.
- **Consumer API**: New optional fields in `animusExtract()` plugin config. Zero breaking changes — defaults to current behavior if unconfigured.

## Purpose

Requirements for the `layer-declaration-delivery` capability: Vite delivers layer declaration via HTML style tag; Next.js delivers layer declaration inline in CSS.

## Requirements

### Requirement: Vite delivers layer declaration via HTML style tag

The Vite plugin SHALL inject the `@layer` ordering declaration into the HTML document head as a `<style>` tag, bypassing all CSS processing pipelines (both the plugin's Lightning CSS pass and Vite's internal esbuild minification).

#### Scenario: Declaration injected as first head child

- **WHEN** the Vite plugin's `transformIndexHtml` hook fires (dev page load or prod build)
- **THEN** it SHALL return an `HtmlTagDescriptor` with `tag: 'style'`, `injectTo: 'head-prepend'`, and `order: 'pre'`
- **AND** the `<style>` tag children SHALL contain the full `@layer` declaration (e.g., `@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;`)
- **AND** the declaration SHALL reflect custom layers if configured via the plugin `layers` option

#### Scenario: Declaration absent from CSS virtual module

- **WHEN** the virtual module `virtual:animus/styles.css` is loaded (dev or prod)
- **THEN** the returned CSS SHALL NOT contain the `@layer` ordering declaration
- **AND** the CSS SHALL begin with variable CSS (`:root` blocks) followed by processed body content

#### Scenario: Declaration survives Vite prod build

- **WHEN** a Vite prod build completes
- **THEN** `dist/index.html` SHALL contain a `<style>` tag in `<head>` with the `@layer` declaration
- **AND** the declaration SHALL appear before any `<link>` stylesheet references

#### Scenario: Declaration stable across HMR

- **WHEN** a file change triggers HMR in Vite dev mode
- **THEN** the `@layer` declaration in the HTML `<style>` tag SHALL remain unchanged
- **AND** `transformIndexHtml` does not fire on HMR (only on page load), which is correct because the declaration is config-time and static

### Requirement: Next.js delivers layer declaration inline in CSS

The Next.js plugin SHALL continue delivering the `@layer` declaration as part of the assembled CSS string. Next.js's CSS pipeline (webpack + built-in processing) does not strip `@layer` declarations, so no HTML injection is needed.

#### Scenario: Next.js CSS contains declaration

- **WHEN** the Next.js plugin assembles the full CSS via `assembleStylesheet({ split: true })`
- **THEN** the CSS written to `.animus/styles.css` SHALL contain the `@layer` declaration followed by variables followed by body
- **AND** the declaration SHALL survive Next.js's CSS processing intact

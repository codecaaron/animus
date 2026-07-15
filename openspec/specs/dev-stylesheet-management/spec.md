## Purpose

Requirements for the `dev-stylesheet-management` capability: Static CSS served via regular virtual module; Component CSS delivered via adopted stylesheet in dev; HMR bridge auto-injected in dev mode; and 4 more.

## Requirements

### Requirement: Static CSS served via regular virtual module

In dev mode, `virtual:animus/styles.css` SHALL serve only the static portion: layer declaration, CSS variable declarations (`:root` + color mode selectors), and global styles (`@layer global { ... }`). Component CSS (`@layer base/variants/states/system/custom`) SHALL NOT be included.

#### Scenario: Static module content in dev

- **WHEN** `virtual:animus/styles.css` is loaded in dev mode
- **THEN** it contains the `@layer` declaration statement
- **AND** it contains `:root` variable declarations
- **AND** it contains `@layer global { ... }` with reset and global styles
- **AND** it does NOT contain `@layer base`, `@layer variants`, `@layer states`, `@layer system`, or `@layer custom` blocks

#### Scenario: Static module content in prod

- **WHEN** `virtual:animus/styles.css` is loaded in production build
- **THEN** it contains ALL CSS (layer declaration + variables + globals + component CSS) — identical to current behavior

### Requirement: Component CSS delivered via adopted stylesheet in dev

In dev mode, component CSS SHALL be delivered via a Constructable StyleSheet managed by an auto-injected HMR bridge module. The bridge SHALL create a `CSSStyleSheet`, call `replaceSync()` with the component CSS string, and add the sheet to `document.adoptedStyleSheets`.

#### Scenario: Component CSS applied via adopted stylesheet

- **WHEN** the dev server starts and the page loads
- **THEN** `document.adoptedStyleSheets` contains a stylesheet with the component CSS
- **AND** all `@layer base/variants/states/system/custom` rules are present in the adopted sheet

#### Scenario: HMR update preserves animations

- **WHEN** a component file is edited and saved during dev
- **AND** CSS animations are running on other components
- **THEN** the bridge calls `replaceSync()` with the updated component CSS
- **AND** running CSS animations on unchanged components are NOT reset

### Requirement: HMR bridge auto-injected in dev mode

The plugin SHALL inject the HMR bridge via the `transformIndexHtml` hook. The bridge MUST NOT be injected during production builds.

#### Scenario: Bridge present in dev HTML

- **WHEN** the dev server serves index.html
- **THEN** a `<script type="module">` tag is present that imports the bridge module

#### Scenario: Bridge absent in prod build

- **WHEN** a production build is performed
- **THEN** the built HTML does NOT contain the bridge module import
- **AND** no bridge-related JS is in the production bundle

### Requirement: Bridge is a singleton

The HMR bridge SHALL maintain a single `CSSStyleSheet` instance across HMR updates. It MUST NOT create duplicate adopted stylesheets on module re-evaluation.

#### Scenario: No duplicate stylesheets on HMR

- **WHEN** the bridge module is re-evaluated due to HMR
- **THEN** `document.adoptedStyleSheets` contains exactly one Animus-managed stylesheet
- **AND** the existing sheet is updated via `replaceSync()`, not replaced with a new sheet

### Requirement: Graceful fallback when Constructable StyleSheets unavailable

If the browser does not support `CSSStyleSheet` constructor or `adoptedStyleSheets`, the bridge SHALL fall back to injecting component CSS via a `<style>` tag (current behavior) and log a warning.

#### Scenario: Fallback to style tag

- **WHEN** `typeof CSSStyleSheet === 'undefined'` or `!('adoptedStyleSheets' in document)`
- **THEN** the bridge creates a `<style>` element with the component CSS
- **AND** a warning is logged indicating the fallback

### Requirement: Component CSS virtual module serves JS string

A virtual JS module (`virtual:animus/components.js`) SHALL export the component CSS as a default string export. This module is consumed by the HMR bridge, not by user code.

#### Scenario: Virtual JS module content

- **WHEN** `virtual:animus/components.js` is loaded in dev mode
- **THEN** it exports a string containing all component layer CSS (`@layer base { ... }` through `@layer custom { ... }`)

#### Scenario: Virtual JS module not resolved in prod

- **WHEN** a production build is performed
- **THEN** `virtual:animus/components.js` is NOT resolved (component CSS is in the static CSS file)

### Requirement: Transform emitter unchanged

The Rust `transform_emitter` SHALL continue to emit `import 'virtual:animus/styles.css'` in transformed files. No changes to per-file transform output.

#### Scenario: Transformed file imports unchanged

- **WHEN** a file containing an extractable builder chain is transformed
- **THEN** the transformed output includes `import 'virtual:animus/styles.css'`
- **AND** it does NOT import the bridge or component JS module

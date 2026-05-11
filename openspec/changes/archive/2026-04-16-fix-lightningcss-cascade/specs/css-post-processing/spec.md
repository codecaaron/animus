## MODIFIED Requirements

### Requirement: Post-processing operates on body content only
The vite-plugin `postProcessCss` function SHALL receive only the body segment (global CSS + component CSS) from the split assembly, never the `@layer` cascade declaration or variable CSS. The final virtual module output is reconstructed by concatenating the unprocessed declaration and variables with the processed body.

#### Scenario: Layer declaration delivered via HTML style tag (Vite)
- **WHEN** the Vite plugin processes an HTML page (dev page load or prod build)
- **THEN** the plugin SHALL inject a `<style>` tag into the HTML `<head>` containing the `@layer` declaration
- **AND** the `<style>` tag SHALL be the first child of `<head>` (via `injectTo: 'head-prepend'`)
- **AND** the `transformIndexHtml` hook SHALL use `order: 'pre'` to run before Vite's internal transforms
- **AND** the `@layer` declaration SHALL NOT appear in the virtual module CSS output

#### Scenario: Prod mode virtual module contains variables and processed body only
- **WHEN** the virtual module `virtual:animus/styles.css` is loaded in prod mode
- **THEN** the output SHALL begin with variable CSS (`:root` blocks)
- **AND** only the `@layer` block content (global + component CSS) SHALL have been processed by Lightning CSS
- **AND** the `@layer` ordering declaration SHALL NOT be present in the virtual module output (it is in the HTML `<style>` tag)

#### Scenario: Dev mode virtual module contains variables and processed body only
- **WHEN** the virtual module is loaded in dev mode (split delivery: static CSS via virtual module, component CSS via adopted stylesheet)
- **THEN** the virtual module output SHALL begin with variable CSS followed by processed global CSS
- **AND** the `@layer` ordering declaration SHALL NOT be present in the virtual module output
- **AND** Lightning CSS SHALL NOT reorder, strip, or consolidate any part of the variables

#### Scenario: Dev adopted stylesheet strips embedded declaration
- **WHEN** the component CSS is served via the adopted stylesheet bridge (`RESOLVED_COMPONENTS_ID`)
- **THEN** any `@layer ...;` declaration embedded in `resolvedComponentCss` SHALL be stripped before Lightning CSS processing
- **AND** the adopted stylesheet SHALL NOT contain a duplicate `@layer` declaration

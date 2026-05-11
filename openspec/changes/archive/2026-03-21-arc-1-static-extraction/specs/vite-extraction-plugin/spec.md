## ADDED Requirements

### Requirement: Plugin factory function
The Vite plugin SHALL be exported as `animusExtract(options?) -> Plugin` from `@animus-ui/vite-plugin`. The options object MAY include `theme` (path to theme module, default auto-detected), `config` (path to prop config module, default `@animus-ui/core/config`), and `include`/`exclude` globs for file filtering.

#### Scenario: Default configuration
- **WHEN** `animusExtract()` is called with no options
- **THEN** the plugin SHALL auto-detect the theme module by searching for `theme.ts` or `theme.js` in the project root and src directory

#### Scenario: Custom theme path
- **WHEN** `animusExtract({ theme: './src/design/theme.ts' })` is called
- **THEN** the plugin SHALL use the specified path for theme evaluation

### Requirement: Production-only activation
The plugin SHALL only perform extraction during production builds. In development mode, the plugin SHALL be a no-op, allowing Emotion runtime to function as-is.

#### Scenario: Production build
- **WHEN** Vite runs in production mode (`vite build`)
- **THEN** the plugin SHALL activate its transform hook and perform extraction

#### Scenario: Development server
- **WHEN** Vite runs in development mode (`vite dev`)
- **THEN** the plugin SHALL not transform any files, leaving Emotion runtime intact

### Requirement: Theme evaluation at build start
The plugin SHALL evaluate the theme module at `buildStart` using Vite's `ssrLoadModule()`. It SHALL flatten all theme scales into a JSON map of `{ "scale_name.key": "css_value" }` format and hold it in memory for passing to the Rust `extract()` function.

#### Scenario: Theme with computed scales
- **WHEN** the theme uses `.addScale('shadows', ({ colors }) => ({...}))` with function-based scale definitions
- **THEN** the plugin SHALL evaluate the full theme build chain, resolving all function-based scales to their final values, and include them in the flattened JSON map

#### Scenario: Theme with color modes
- **WHEN** the theme uses `.addColorModes()` generating CSS custom properties
- **THEN** the flattened map SHALL contain CSS variable references (e.g., `"colors.background": "var(--colors-background)"`) rather than raw color values

### Requirement: Prop config serialization
The plugin SHALL serialize the prop configuration from `@animus-ui/core/config` into a JSON map at build start. Each prop entry SHALL include `property`, `properties` (if multi-property), `scale` (if theme-linked), and `transform` (as a string identifier: `"size"`, `"borderShorthand"`, `"gridItemRatio"`, or `null`).

#### Scenario: Serialize prop with scale and transform
- **WHEN** config has `borderRadius: { property: 'borderRadius', scale: 'radii', transform: size }`
- **THEN** the serialized entry SHALL be `{ "property": "borderRadius", "scale": "radii", "transform": "size" }`

#### Scenario: Serialize multi-property prop
- **WHEN** config has `px: { property: 'padding', properties: ['paddingLeft', 'paddingRight'], scale: 'space' }`
- **THEN** the serialized entry SHALL include both `property` and `properties` array

### Requirement: Transform hook
The plugin SHALL implement the Vite `transform` hook. For each `.ts`, `.tsx`, `.js`, `.jsx` file matching the include/exclude filters, it SHALL call the Rust `extract()` function with the source code, filename, serialized theme JSON, and serialized config JSON.

#### Scenario: Extractable file
- **WHEN** a file contains extractable chains and `extract()` returns `extractable: true`
- **THEN** the transform hook SHALL return the transformed code as the new source and emit the extracted CSS

#### Scenario: Non-extractable file
- **WHEN** a file contains no chains or only non-extractable chains and `extract()` returns `extractable: false`
- **THEN** the transform hook SHALL return `null` (no transformation), leaving the original source unchanged

#### Scenario: Partial extraction
- **WHEN** a file contains multiple chains and some are extractable while others are not
- **THEN** extractable chains SHALL be transformed and non-extractable chains SHALL be left as-is in the same file. CSS SHALL only be emitted for extracted chains.

### Requirement: CSS emission
The plugin SHALL emit extracted CSS using Vite's virtual module system. Each source file with extracted styles SHALL produce a corresponding virtual CSS module that is imported by the transformed source.

#### Scenario: Virtual CSS module
- **WHEN** `src/Button.tsx` has extracted styles
- **THEN** the transformed source SHALL import from a virtual module (e.g., `virtual:animus/src/Button.css`) and the plugin SHALL resolve and serve that module with the extracted CSS content

#### Scenario: @layer declaration
- **WHEN** any file produces extracted CSS
- **THEN** the plugin SHALL ensure the `@layer base, variants, states, system, custom;` declaration appears exactly once in the final CSS bundle

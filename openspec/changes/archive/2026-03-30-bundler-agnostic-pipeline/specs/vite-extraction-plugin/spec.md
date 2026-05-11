## MODIFIED Requirements

### Requirement: Theme evaluation at build start
Theme evaluation SHALL continue using the legacy evaluation path within the vite-plugin's subprocess model. The subprocess serializes the theme via `JSON.stringify`, which strips the non-enumerable `.manifest` and `.evaluate()` properties. The legacy `evaluateThemeObjectLegacy()` path remains the production evaluation path for the vite-plugin.

#### Scenario: Subprocess theme evaluation uses legacy path
- **WHEN** the plugin loads the theme via subprocess and the deserialized theme object has no `.evaluate()` method (stripped by JSON serialization)
- **THEN** the plugin SHALL use the local `evaluateThemeObjectLegacy()` function with flatten + var() pattern-match logic

#### Scenario: Direct theme evaluation uses evaluate method
- **WHEN** a future host (not the current vite-plugin subprocess) has a live theme object with `.evaluate()` method
- **THEN** it SHALL call `theme.evaluate()` to obtain `{ scalesJson, variableMapJson, variableCss, contextualVarsJson }` — no local evaluation needed

#### Scenario: Output identical regardless of path
- **WHEN** a theme is evaluated via `.evaluate()` (direct) vs `evaluateThemeObjectLegacy()` (subprocess)
- **THEN** the 4 JSON strings produced SHALL be byte-identical

### Requirement: Global styles resolution imports from system
The plugin SHALL import `resolveGlobalStyles` from `@animus-ui/system/pipeline` instead of using a local implementation.

#### Scenario: resolveGlobalStyles from system pipeline
- **WHEN** the plugin resolves global style blocks during `buildStart`
- **THEN** it SHALL call `resolveGlobalStyles` imported from `@animus-ui/system/pipeline`, passing the same propConfig, flat theme, and transforms as before

#### Scenario: Global styles output unchanged
- **WHEN** global styles are resolved using the imported function
- **THEN** the produced CSS SHALL be byte-identical to the previous local implementation's output

## ADDED Requirements

### Requirement: NAPI loadSystemModule function
The extraction crate SHALL expose a NAPI function `loadSystemModule(systemPath, rootDir)` that reads a TypeScript system file, strips types, resolves dependencies, executes the module, and returns serialized system configuration. The function SHALL be synchronous from the caller's perspective.

#### Scenario: Load a standard system file
- **WHEN** `loadSystemModule("src/ds.ts", "/project/root")` is called with a valid system file that exports a SystemInstance and theme
- **THEN** it returns a `SystemConfig` object with all config fields populated (propConfig, groupRegistry, scalesJson, variableMapJson, variableCss, contextualVarsJson)

#### Scenario: System file with no SystemInstance export
- **WHEN** `loadSystemModule` is called with a file that has no export with a `.toConfig()` method
- **THEN** it returns an error describing which exports were found and that none had `.toConfig()`

#### Scenario: System file with no theme export
- **WHEN** `loadSystemModule` is called with a file that has no export with a `.serialize()` method named `tokens` or `theme`
- **THEN** it returns an error indicating no serializable theme was found

### Requirement: OXC type-stripping for full modules
The system loader SHALL use oxc_transformer to strip TypeScript type annotations from the system file and any .ts/.tsx dependencies before execution. The type-stripped output SHALL preserve all runtime semantics (imports, exports, expressions, function bodies).

#### Scenario: TypeScript system file with type annotations
- **WHEN** the system file contains `export const tokens: ShowcaseTheme = createTheme()...` and `declare module` blocks
- **THEN** type annotations and ambient declarations are removed, runtime code is preserved, and the module executes correctly in rquickjs

#### Scenario: JavaScript dependency file
- **WHEN** a resolved dependency is a `.js` or `.mjs` file (built dist artifact)
- **THEN** it is loaded as-is without OXC transformation

### Requirement: Rust-side dependency resolution
The system loader SHALL resolve all import specifiers in Rust before passing source to rquickjs. The rquickjs Resolver/Loader SHALL use pre-built HashMaps with no filesystem access from the JS engine.

#### Scenario: Bare specifier resolution
- **WHEN** the system file contains `import { createSystem } from '@animus-ui/system'`
- **THEN** Rust reads the package's `package.json`, follows the `exports` map's `import` condition, reads the resolved dist file, and provides it to rquickjs as a pre-loaded module

#### Scenario: Subpath export resolution
- **WHEN** the system file contains `import { space } from '@animus-ui/system/groups'`
- **THEN** Rust follows the `exports["./groups"]` entry in `package.json` to resolve the subpath dist file

#### Scenario: Relative import resolution
- **WHEN** a dependency file contains `import { foo } from './utils'`
- **THEN** Rust resolves the relative path against the importing file's directory, applying `.ts`/`.js`/`/index.ts`/`/index.js` extension resolution

#### Scenario: Transitive dependency resolution
- **WHEN** the system file imports package A which imports package B
- **THEN** Rust recursively resolves and pre-loads all transitive dependencies before rquickjs execution begins

### Requirement: rquickjs module execution
The system loader SHALL execute the type-stripped system module in rquickjs with all dependencies pre-loaded. It SHALL traverse the module's exports to find the SystemInstance (via `.toConfig()`) and theme (via `.serialize()`).

#### Scenario: Execute system with createTheme + createSystem chains
- **WHEN** the system file calls `createTheme().addColors(...).addColorModes(...).addScale(...).build()` and `createSystem().addGroup(...).build()`
- **THEN** rquickjs executes all chained method calls and the resulting objects are accessible from Rust

#### Scenario: Extract global style blocks
- **WHEN** the system file exports objects with `__brand === 'GlobalStyleBlock'`
- **THEN** the loader identifies these exports and includes their `.styles` data in the returned config

### Requirement: SystemConfig return type
The NAPI function SHALL return a structured `SystemConfig` object (not raw JSON strings) with the following fields: `prop_config`, `group_registry`, `scales_json`, `variable_map_json`, `variable_css`, `contextual_vars_json`, `selector_aliases` (optional), `selector_order` (optional), `global_style_blocks` (optional).

#### Scenario: Complete config extraction
- **WHEN** the system file has a SystemInstance, theme with serialize(), selector aliases, and global styles
- **THEN** all fields of SystemConfig are populated with the serialized values from `.toConfig()` and `.serialize()`

#### Scenario: Optional fields absent
- **WHEN** the system file has no selector aliases and no global style blocks
- **THEN** `selector_aliases`, `selector_order`, and `global_style_blocks` are `None`/null

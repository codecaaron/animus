## Purpose

Requirements for the `rust-system-loader` capability: NAPI loadSystemModule function; OXC type-stripping for full modules; Rust-side dependency resolution; and 3 more.

## Requirements

### Requirement: NAPI loadSystemModule function

The extraction crate SHALL expose a NAPI function `loadSystemModule(systemPath, rootDir, exportName?)` that reads a TypeScript system file, strips types, resolves dependencies, executes the module, and returns serialized system configuration. The function SHALL be synchronous from the caller's perspective.

#### Scenario: Load a standard system file

- **WHEN** `loadSystemModule("src/ds.ts", "/project/root")` is called with a valid system file that exports a SystemInstance and theme
- **THEN** it returns a `SystemConfig` object with all config fields populated (propConfig, groupRegistry, scalesJson, variableMapJson, variableCss, contextualVarsJson)

#### Scenario: Load with explicit export name

- **WHEN** `loadSystemModule("src/ds.ts", "/project/root", "ds")` is called with an explicit export name
- **THEN** it uses the named export `ds` directly to call `.toConfig()`, without duck-typing iteration

#### Scenario: System file with no SystemInstance export

- **WHEN** `loadSystemModule` is called with a file that has no export with a `.toConfig()` method and no `exportName` specified
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

ALL bare specifiers SHALL be resolved with the Node-style resolver (`exports` map conditions, `module`/`main` fallback, `node_modules` walk-up) regardless of package prefix — there is no prefix-scoped resolution path and no generic stub fallback. An enumerated runtime stub list — exactly `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, and `react-dom` — SHALL be evaluated as no-op stub modules instead of resolved source; membership SHALL be matched exactly (package or subpath), never by prefix. Any other bare specifier that fails to resolve SHALL fail the system load with an error naming the specifier and the importing module. A resolved module that is CommonJS-shaped (no ESM syntax at all, yet mentions `module.exports` or `require(`) SHALL fail the load with a message naming the specifier and its resolved path. Type-only imports and exports (`import type`, `export type`, and declarations whose specifiers are all type-only) SHALL be excluded from resolution entirely.

#### Scenario: Bare specifier with exports map

- **WHEN** the system file contains `import { createSystem } from '@animus-ui/system'` and the package has an `exports` field
- **THEN** Rust reads the package's `package.json`, follows the `exports` map's `import` condition (supporting nested condition objects), reads the resolved dist file, and provides it to rquickjs as a pre-loaded module

#### Scenario: Subpath export resolution

- **WHEN** the system file contains `import { space } from '@animus-ui/system/groups'`
- **THEN** Rust follows the `exports["./groups"]` entry in `package.json` to resolve the subpath dist file

#### Scenario: Package without exports field (module/main fallback)

- **WHEN** the system file imports from a package whose `package.json` has no `exports` field but has `module` and/or `main`
- **THEN** Rust falls back to the `module` field first, then `main`, to resolve the entry point

#### Scenario: Relative import resolution

- **WHEN** a dependency file contains `import { foo } from './utils'`
- **THEN** Rust resolves the relative path against the importing file's directory, applying `.ts`/`.js`/`/index.ts`/`/index.js` extension resolution

#### Scenario: Transitive dependency resolution

- **WHEN** the system file imports package A which imports package B
- **THEN** Rust recursively resolves and pre-loads all transitive dependencies before rquickjs execution begins

#### Scenario: Enumerated runtime package is stubbed, a near-miss is not

- **WHEN** a module in the graph imports `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, or `react-dom`
- **THEN** each is registered as a no-op stub module rather than resolved from disk
- **AND** a near-miss such as `react-dom/client` or `react-router` is NOT stubbed — it goes through the ordinary Node-style resolver like any other bare specifier

#### Scenario: Unresolvable bare specifier fails the load

- **WHEN** a module imports a bare specifier that is not on the runtime stub list and the Node-style resolver cannot resolve it
- **THEN** the system load fails with an error naming both the specifier and the importing module — it is NOT silently stubbed

#### Scenario: CommonJS-shaped dependency fails the load

- **WHEN** a bare specifier resolves to a module with no ESM import/export syntax that mentions `module.exports` or `require(`
- **THEN** the system load fails with a message naming the specifier and its resolved path, and stating that an ESM entry (or the runtime stub list) is required

#### Scenario: Type-only import does not drive resolution

- **WHEN** a module contains `import type { Foo } from 'csstype'` (or a named import whose specifiers are all `type`-marked)
- **THEN** `csstype` is never resolved and its absence does not fail the load — the declaration is erased by type-stripping and contributes no runtime dependency

#### Scenario: Namespace re-export binds the module object

- **WHEN** a module contains `export * as ns from './mod'`
- **THEN** the bundled module binds the resolved module's exports object to the exported name `ns` (rather than spreading its members into the re-exporting module's exports, which is the `export * from` form)

### Requirement: rquickjs module execution

The system loader SHALL execute the type-stripped system module in rquickjs with all dependencies pre-loaded. It SHALL traverse the module's exports to find the SystemInstance (via `.toConfig()`) and theme (via `.serialize()`).

#### Scenario: Execute system with createTheme + createSystem chains

- **WHEN** the system file calls `createTheme().addColors(...).addColorModes(...).addScale(...).build()` and `createSystem().addGroup(...).build()`
- **THEN** rquickjs executes all chained method calls and the resulting objects are accessible from Rust

#### Scenario: Extract global style blocks

- **WHEN** the system file exports objects with `__brand === 'GlobalStyleBlock'`
- **THEN** the loader identifies these exports and includes their `.styles` data in the returned config

### Requirement: Evaluation host globals and bundle diagnostics

The QuickJS context SHALL provide a no-op `console` shim covering `log`, `warn`, `error`, `info`, `debug`, and `trace`, so top-level logging anywhere in the system's module graph does not abort the load. No other Node globals (`process`, `setTimeout`, `require`, `module`, …) SHALL be provided — a system module must evaluate without Node APIs. When bundle evaluation fails, the reported error SHALL name the module that owns the failing line and list the stubbed specifiers in force. Bundle output SHALL be deterministic for identical inputs: stub modules are emitted in sorted key order with sorted export names, and real modules follow a deterministic topologically sorted module order.

#### Scenario: Top-level console call does not abort the load

- **WHEN** the system file or any dependency executes `console.log(...)` at module top level
- **THEN** the call is a no-op and the load completes normally
- **AND** a top-level reference to any other Node global (e.g. `process.env`, `setTimeout`) is NOT satisfied by the host — those globals are not installed

#### Scenario: Evaluation failure names the owning module and the stubs

- **WHEN** bundle evaluation throws (e.g. `X is not a function`)
- **THEN** the returned error names the module path that owns the failing bundle line
- **AND** it lists the specifiers that were replaced by no-op stubs, so a stub-induced failure is traceable to the stubbing decision

#### Scenario: Identical inputs produce identical bundle output

- **WHEN** the same system file and dependency graph are loaded twice
- **THEN** the generated bundle is byte-identical — stub modules and their export names are emitted in sorted order and real modules in a deterministic topological order

### Requirement: SystemConfig return type

The NAPI function SHALL return a structured `SystemConfig` object (not raw JSON strings) with the following fields: `prop_config`, `group_registry`, `scales_json`, `variable_map_json`, `variable_css`, `contextual_vars_json`, `selector_aliases` (optional), `selector_order` (optional), `global_style_blocks` (optional).

#### Scenario: Complete config extraction

- **WHEN** the system file has a SystemInstance, theme with serialize(), selector aliases, and global styles
- **THEN** all fields of SystemConfig are populated with the serialized values from `.toConfig()` and `.serialize()`

#### Scenario: Optional fields absent

- **WHEN** the system file has no selector aliases and no global style blocks
- **THEN** `selector_aliases`, `selector_order`, and `global_style_blocks` are `None`/null

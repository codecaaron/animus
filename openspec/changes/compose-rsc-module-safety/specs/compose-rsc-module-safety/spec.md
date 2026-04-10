## ADDED Requirements

### Requirement: RSC-safe default entry points

The barrel export (`@animus-ui/system`), runtime export (`@animus-ui/system/runtime`), and compose export (`@animus-ui/system/compose`) MUST NOT transitively import `createContext`, `useContext`, `useState`, `useEffect`, or any other React hook at module scope. These entry points SHALL be usable in React Server Components without a `'use client'` boundary.

#### Scenario: Barrel import in RSC
- **WHEN** a server component imports `{ createComponent }` from `@animus-ui/system`
- **THEN** the module graph contains no RSC-banned API imports and the component renders on the server

#### Scenario: Runtime import in RSC
- **WHEN** an extracted component imports `{ createComponent, createComposedFamily }` from `@animus-ui/system/runtime`
- **THEN** the module graph contains no RSC-banned API imports

#### Scenario: Compose import in RSC
- **WHEN** a server component imports `{ compose }` from `@animus-ui/system/compose`
- **THEN** the module graph contains no RSC-banned API imports

### Requirement: compose() is RSC-safe

`compose()` SHALL use only `forwardRef` and `createElement` from React. It SHALL NOT import, reference, or conditionally invoke `createContext` or `useContext`. The `context` option SHALL NOT exist on `compose()`.

#### Scenario: compose with CSS-only propagation
- **WHEN** `compose({ Root, Child }, { shared: { size: true } })` is called
- **THEN** the result contains `ForwardRefExoticComponent` wrappers with displayName set, no React context is created, and shared variant propagation relies on CSS descendant selectors

#### Scenario: compose has no context option
- **WHEN** a consumer passes `{ context: true }` to `compose()`
- **THEN** TypeScript reports a type error (unknown property)

### Requirement: composeWithContext is explicitly client-only

`composeWithContext()` SHALL be exported from a module with a `'use client'` directive. It SHALL use `createContext` and `useContext` to propagate shared variant values through React context. It SHALL be importable from `@animus-ui/system/compose-with-context`.

#### Scenario: composeWithContext with context propagation
- **WHEN** `composeWithContext({ Root, Child }, { shared: { size: true } })` is called
- **THEN** the Root wrapper provides shared values via React context, child wrappers consume via `useContext`, and direct props on children override context values

#### Scenario: composeWithContext import path
- **WHEN** a consumer imports `{ composeWithContext }` from `@animus-ui/system/compose-with-context`
- **THEN** the import resolves to a module with `'use client'` and the bundler creates a client boundary

### Requirement: createComposedFamily is RSC-safe

The extraction runtime shim `createComposedFamily()` SHALL use only `forwardRef` and `createElement`. It SHALL NOT import `createContext` or `useContext`. It SHALL be exported from `@animus-ui/system/runtime`.

#### Scenario: Extracted compose replacement in RSC
- **WHEN** the extraction pipeline replaces `compose()` with `createComposedFamily()`
- **THEN** the transformed file imports from `@animus-ui/system/runtime` and contains no RSC-banned APIs

### Requirement: createComposedFamilyWithContext is client-only

The extraction runtime shim `createComposedFamilyWithContext()` SHALL be exported from `@animus-ui/system/compose-with-context` (the same `'use client'` module as `composeWithContext`). It SHALL use `createContext` and `useContext`.

#### Scenario: Extracted composeWithContext replacement
- **WHEN** the extraction pipeline replaces `composeWithContext()` with `createComposedFamilyWithContext()`
- **THEN** the transformed file imports from `@animus-ui/system/compose-with-context` and the emitter injects a `'use client'` directive

### Requirement: Extraction scanner detects both compose functions

The Rust scanner (`jsx_scanner.rs`) SHALL detect both `compose()` and `composeWithContext()` call expressions. When `composeWithContext` is the callee, the scanner SHALL set `context: true` on the `ComposeFamilyInfo` regardless of any options argument.

#### Scenario: Scanner detects compose
- **WHEN** source contains `const F = compose({ Root, Child }, { shared: { size: true } })`
- **THEN** the scanner produces a `ComposeFamilyInfo` with `context: false`

#### Scenario: Scanner detects composeWithContext
- **WHEN** source contains `const F = composeWithContext({ Root, Child }, { shared: { size: true } })`
- **THEN** the scanner produces a `ComposeFamilyInfo` with `context: true`

### Requirement: Emitter routes to correct runtime function

The transform emitter SHALL generate `createComposedFamily()` for `context: false` compose families and `createComposedFamilyWithContext()` for `context: true` families. The import source SHALL differ: runtime path for context-free, compose-with-context path for context-aware.

#### Scenario: Emitter for context-free compose
- **WHEN** a compose replacement has `context: false`
- **THEN** the emitter generates `createComposedFamily({...}, { name: "..." })` and imports from the runtime module

#### Scenario: Emitter for context-aware compose
- **WHEN** a compose replacement has `context: true`
- **THEN** the emitter generates `createComposedFamilyWithContext({...}, { name: "...", sharedKeys: [...] })` and imports from the compose-with-context module

### Requirement: compose_replacements populated correctly

The `compose_replacements` field in `UniverseManifest` SHALL be built from `per_file_compose` BEFORE the cache storage loop drains the map. The field SHALL contain one entry per `compose()` or `composeWithContext()` call in the project.

#### Scenario: Manifest contains compose replacements
- **WHEN** `analyzeProject` processes a file with a `compose()` call
- **THEN** the returned manifest JSON contains a non-empty `compose_replacements` array with the correct `file_path`, `slots`, `name`, `context`, and `shared_keys`

#### Scenario: Cache drain does not affect replacements
- **WHEN** `analyzeProject` runs with file caching enabled
- **THEN** `compose_replacements` is populated identically whether files are cache-hits or cache-misses

## MODIFIED Requirements

### Requirement: System prop map virtual module
The Vite plugin SHALL serve a virtual module at `virtual:animus/system-props` that exports the shared system prop map, system prop groups, dynamic prop configuration, and transform functions. The dynamic prop configuration and transforms SHALL only be included when dynamic prop usage is detected.

#### Scenario: Resolve virtual module ID
- **WHEN** a source file imports `from 'virtual:animus/system-props'`
- **THEN** the plugin's `resolveId` hook SHALL resolve it to an internal virtual module ID (e.g., `\0virtual:animus/system-props`)

#### Scenario: Load virtual module with dynamic props
- **WHEN** the extraction detected dynamic usage for props `p` and `borderRadius` with `borderRadius` having a `size` transform
- **THEN** the plugin's `load` hook SHALL return exports including `systemPropMap`, `systemPropGroups`, `dynamicPropConfig`, and `transforms` — with `transforms` containing only the `size` function

#### Scenario: Load virtual module without dynamic props
- **WHEN** no dynamic prop usage was detected across the project
- **THEN** the plugin's `load` hook SHALL return exports including only `systemPropMap` and `systemPropGroups` — `dynamicPropConfig` and `transforms` SHALL NOT be exported

#### Scenario: Module available during dev
- **WHEN** the Vite dev server is running
- **THEN** `virtual:animus/system-props` SHALL be resolvable and serve the current data from the most recent extraction

#### Scenario: Module available during build
- **WHEN** `vite build` runs in production mode
- **THEN** `virtual:animus/system-props` SHALL be resolvable and serve data from the full-project extraction

## ADDED Requirements

### Requirement: Transform function serialization in virtual module
The Vite plugin SHALL serialize transform functions into the virtual module source code for runtime use. Only transform functions used by props in `dynamic_props` SHALL be included.

#### Scenario: Transform function emitted as source
- **WHEN** prop `borderRadius` has dynamic usage and uses the `size` transform
- **THEN** the virtual module SHALL export `transforms` containing a `size` key with the function body from `ds.serialize().transforms.size`

#### Scenario: Unused transform not shipped
- **WHEN** the system defines transforms `size` and `color` but only `size` is used by dynamic props
- **THEN** the virtual module SHALL only include the `size` transform — `color` SHALL NOT appear

#### Scenario: Transform function serialization failure
- **WHEN** a transform function cannot be serialized to source text (e.g., it closes over external state)
- **THEN** the plugin SHALL emit a warning and omit that transform — dynamic props using it SHALL fall back to raw value passthrough

### Requirement: Dynamic prop config in virtual module
The Vite plugin SHALL export a `dynamicPropConfig` object from `virtual:animus/system-props` when dynamic props exist. Each entry SHALL contain the CSS variable name (kebab-case), slot class name, optionally a transform name (string reference, not bound function), and optionally pre-resolved scale values. Transform binding happens at component definition time via generated code, not in the virtual module.

#### Scenario: Dynamic prop config shape
- **WHEN** prop `p` has dynamic usage with no transform and no scale
- **THEN** `dynamicPropConfig.p` SHALL be `{ varName: "--animus-p", slotClass: "animus-dyn-p" }`

#### Scenario: Dynamic prop config with transform name
- **WHEN** prop `borderRadius` has dynamic usage with transform `size`
- **THEN** `dynamicPropConfig.borderRadius` SHALL be `{ varName: "--animus-border-radius", slotClass: "animus-dyn-border-radius", transformName: "size" }` — the `transforms` export is separate

#### Scenario: Dynamic prop config with scale values
- **WHEN** prop `borderBottom` has dynamic usage with scale `borders` containing `{ "1": "1px solid", "2": "2px solid" }`
- **THEN** `dynamicPropConfig.borderBottom` SHALL include `scaleValues: { "1": "1px solid", "2": "2px solid" }` for runtime scale resolution

#### Scenario: HMR invalidation on dynamic props change
- **WHEN** a file change causes a prop to gain or lose dynamic usage
- **THEN** the plugin SHALL invalidate the `virtual:animus/system-props` module to propagate the updated `dynamicPropConfig`

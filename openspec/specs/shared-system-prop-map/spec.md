## Purpose

Requirements for the `shared-system-prop-map` capability: Shared system prop map artifact; Shared map virtual module; HMR invalidation of shared map; and 1 more.

## Requirements

### Requirement: Shared system prop map artifact

The Rust extraction pipeline SHALL produce a global system prop map as a separate artifact from `analyzeProject`, alongside the existing manifest and CSS outputs. The map SHALL aggregate all `(propName, valueKey, className)` tuples across all components into a single `{ propName: { valueKey: className } }` structure.

#### Scenario: Map includes all group prop usages

- **WHEN** component A uses `.groups({ space: true })` with JSX `<A p={8} />` and component B uses `.groups({ space: true })` with JSX `<B p={8} mt={4} />`
- **THEN** the shared map SHALL contain `{ p: { "8": "animus-u-xxx" }, mt: { "4": "animus-u-yyy" } }` — a single entry for `p=8` shared by both components

#### Scenario: Map includes custom prop usages

- **WHEN** a component uses `.props({ logoSize: { property: 'fontSize', scale: { sm: 32, md: 64 } } })` with JSX `<Logo logoSize="md" />`
- **THEN** the shared map SHALL include `{ logoSize: { "md": "animus-u-zzz" } }` alongside any group prop entries

#### Scenario: Map deduplicates identical CSS across props

- **WHEN** prop `p` with value `8` and prop `m` with value `8` resolve to CSS with the same content hash
- **THEN** both map entries SHALL reference the same class name (deduplication behavior unchanged from current per-component maps)

#### Scenario: Responsive values in shared map

- **WHEN** JSX contains `<Box mt={{ _: 8, sm: 16 }} />`
- **THEN** the shared map SHALL contain `{ mt: { "_:8|sm:16": "animus-u-resp" } }` with the canonical serialized key

### Requirement: Shared map virtual module

The Vite plugin SHALL serve the shared system prop map as `virtual:animus/system-props`, a JavaScript module exporting two named bindings: `systemPropMap` (the full prop→value→className lookup table) and `systemPropGroups` (an object mapping each group name to an array of its prop names).

#### Scenario: Virtual module resolution

- **WHEN** a transformed file contains `import { systemPropMap } from 'virtual:animus/system-props'`
- **THEN** the Vite plugin SHALL resolve this to the generated module containing `export const systemPropMap = { ... }`

#### Scenario: systemPropGroups export available

- **WHEN** a consumer imports `import { systemPropGroups } from 'virtual:animus/system-props'`
- **THEN** the module SHALL export `systemPropGroups` as an object whose keys are group names and whose values are arrays of prop name strings (e.g., `{ space: ["p", "m", "mt", "mb", "ml", "mr", "px", "py"] }`)

#### Scenario: Module content matches extraction output

- **WHEN** the extraction pipeline produces a system prop map JSON `{"p":{"8":"animus-u-abc"}}`
- **THEN** the virtual module SHALL contain `export const systemPropMap = {"p":{"8":"animus-u-abc"}};`

#### Scenario: Module available in both dev and build

- **WHEN** the Vite plugin runs in either `serve` (dev) or `build` (production) mode
- **THEN** the `virtual:animus/system-props` module SHALL be resolvable and serve the current map

### Requirement: HMR invalidation of shared map

During dev mode HMR, the plugin SHALL invalidate the `virtual:animus/system-props` module when the system prop map changes, and SHALL NOT invalidate it when the map is unchanged.

#### Scenario: New prop value triggers invalidation

- **WHEN** a developer adds `<Box p={24} />` (a previously unused value) and saves the file
- **THEN** the plugin SHALL detect the new entry in the system prop map, invalidate `virtual:animus/system-props`, and Vite SHALL propagate the update to all importing modules

#### Scenario: Unchanged map skips invalidation

- **WHEN** a developer edits a component file but does not add, remove, or change any system prop values
- **THEN** the plugin SHALL NOT invalidate `virtual:animus/system-props`

#### Scenario: Theme change triggers invalidation

- **WHEN** the theme/system file changes (geological reset) causing utility class hashes to change
- **THEN** the plugin SHALL invalidate `virtual:animus/system-props` with the new map

#### Scenario: Component files not re-transformed on map change

- **WHEN** the system prop map changes due to a new prop value in file A
- **THEN** other component files (B, C, D) SHALL NOT be re-transformed by the Rust pipeline — only the virtual module updates, and Vite propagates re-renders through the import graph

### Requirement: Transform emitter shared map import

The Rust transform emitter SHALL add `import { systemPropMap } from 'virtual:animus/system-props'` to any transformed file that contains components with system props, and SHALL pass `systemPropMap` as a parameter to `createComponent`.

#### Scenario: File with system props gets import

- **WHEN** a file contains `const Box = animus.styles({...}).groups({ space: true }).asElement('div')`
- **THEN** the transformed output SHALL include `import { systemPropMap } from 'virtual:animus/system-props'` in the import block

#### Scenario: File without system props omits import

- **WHEN** a file contains only `const Label = animus.styles({...}).asElement('span')` with no `.groups()` or `.props()`
- **THEN** the transformed output SHALL NOT include the `virtual:animus/system-props` import

#### Scenario: Import deduplicated per file

- **WHEN** a file defines multiple components with system props (Box and Stack both with `.groups()`)
- **THEN** the transformed output SHALL include the `virtual:animus/system-props` import exactly ONCE

#### Scenario: systemPropMap passed to createComponent

- **WHEN** a component with system props is transformed
- **THEN** the emitted code SHALL be `createComponent('div', 'animus-Box-hash', { systemPropNames: [...] }, systemPropMap)` — the shared map reference as the 4th argument

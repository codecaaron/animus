## MODIFIED Requirements

### Requirement: Transform function serialization in virtual module

The plugin SHALL serialize transform functions used by dynamic props (both system and custom) into the `virtual:animus/system-props` module as the `transforms` export. Each transform is serialized using `Function.prototype.toString()`. Only transforms actually referenced by dynamic prop configurations (system or custom) SHALL be included.

When custom props reference transforms (via `transformName` in their `PropConfig`), those transform functions SHALL be included in the shared `transforms` export alongside system prop transforms. The transforms are shared by name — the same `size` transform used by system props and custom props is serialized once.

#### Scenario: System prop transform serialized
- **WHEN** a system prop has dynamic usage and references transform `size`
- **THEN** the `transforms` export includes `size` serialized via `Function.prototype.toString()`

#### Scenario: Custom prop transform serialized
- **WHEN** a custom prop has dynamic usage and its `PropConfig` specifies `transform: 'size'`
- **THEN** the `transforms` export includes `size` (shared with system props if both use it)

#### Scenario: Custom-only transform serialized
- **WHEN** a custom prop references a transform not used by any system prop (e.g., a user-defined transform)
- **THEN** the `transforms` export includes that transform function

#### Scenario: No dynamic usage means no transform serialized
- **WHEN** a custom prop has a transform in its config but only static usage detected
- **THEN** that transform is NOT included in the `transforms` export

### Requirement: Dynamic prop config in virtual module

The `virtual:animus/system-props` module SHALL export `dynamicPropConfig` containing metadata for system props with dynamic usage. This config is shared across all components.

Custom prop dynamic config SHALL NOT be included in the virtual module. Custom dynamic config is per-component and is inlined in each component's `createComponent` config object by the transform emitter.

#### Scenario: System dynamic config in virtual module
- **WHEN** system props have dynamic usage detected
- **THEN** `dynamicPropConfig` is exported from `virtual:animus/system-props`

#### Scenario: Custom dynamic config NOT in virtual module
- **WHEN** custom props have dynamic usage detected
- **THEN** `dynamicPropConfig` does NOT include custom prop entries — they are inlined per-component

#### Scenario: Both system and custom dynamic props
- **WHEN** both system and custom props have dynamic usage
- **THEN** `dynamicPropConfig` contains only system prop entries; custom entries are in per-component config objects

## ADDED Requirements

### Requirement: Custom prop transform discovery

During `buildStart` analysis, the plugin SHALL discover transform references from custom prop configs in the manifest. For each component with custom props that have dynamic usage, the plugin SHALL check the component's custom prop config for `transform_name` fields and include those transforms in the serialization set.

Transform discovery SHALL iterate all components in the manifest, not just system prop configs. This ensures custom-prop-only transforms (not used by any system prop) are still serialized.

#### Scenario: Transform used only by custom props
- **WHEN** a custom prop references transform `borderShorthand` but no system prop uses it dynamically
- **THEN** `borderShorthand` is still serialized in the `transforms` export

#### Scenario: No custom props with transforms
- **WHEN** no custom props reference any transforms
- **THEN** transform discovery is unchanged from pre-change behavior (system props only)

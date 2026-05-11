## MODIFIED Requirements

### Requirement: createComponent factory
The runtime shim SHALL export `createComponent(element, className, config, systemPropMap?, dynamicPropConfig?)` which returns a `React.forwardRef` component. The `element` parameter accepts EITHER an HTML tag string (e.g., `'button'`) OR a React component reference (for `.asComponent()` extensions). The `className` is the base extracted class name. The `config` describes variant props, state props, and system prop names. The optional `systemPropMap` parameter provides the shared prop→value→className lookup table. The optional `dynamicPropConfig` parameter provides CSS variable fallback metadata for props with dynamic usage. The function SHALL be exported from `@animus-ui/system` (not `@animus-ui/runtime`).

#### Scenario: Render with HTML tag
- **WHEN** `createComponent('button', 'animus-Btn-x7f2', {})` creates a component and it is rendered
- **THEN** the rendered element SHALL be `<button class="animus-Btn-x7f2" />`

#### Scenario: Render with component reference
- **WHEN** `createComponent(NextLink, 'animus-Link-abc', {})` creates a component with a React component as the element
- **THEN** the rendered element SHALL be `<NextLink className="animus-Link-abc" />` — the component reference is used as the element type in `React.createElement`

#### Scenario: Render with variant prop
- **WHEN** config has variants and component is rendered with `variant="stroke"`
- **THEN** the rendered element SHALL have the variant modifier class appended

#### Scenario: Render with system prop via shared map
- **WHEN** `systemPropMap` is `{ p: { "8": "animus-u-a1b2c3" } }`, config has `{ systemPropNames: ["p"] }`, and component is rendered with `p={8}`
- **THEN** the rendered element SHALL have class `"animus-Btn-x7f2 animus-u-a1b2c3"`

#### Scenario: Render with state prop
- **WHEN** config is `{ states: ['loading', 'disabled'] }` and component is rendered with `loading={true}`
- **THEN** the rendered element SHALL have class `"animus-Btn-x7f2 animus-Btn-x7f2--loading"`

#### Scenario: Default variant applied
- **WHEN** config has `{ variants: { variant: { options: ['fill', 'stroke'], default: 'fill' } } }` and component is rendered with no `variant` prop
- **THEN** the rendered element SHALL have class `"animus-Btn-x7f2 animus-Btn-x7f2--variant-fill"`

#### Scenario: Dynamic fallback for unmatched system prop value
- **WHEN** `systemPropMap` is `{ p: { "8": "animus-u-a1b2c3" } }`, `dynamicPropConfig` is `{ p: { varName: "--animus-p", slotClass: "animus-dyn-p" } }`, and component is rendered with `p="24px"`
- **THEN** the rendered element SHALL have class `"animus-Btn-x7f2 animus-dyn-p"` and inline style `{ "--animus-p": "24px" }`

#### Scenario: Dynamic fallback with transform
- **WHEN** `dynamicPropConfig` is `{ "border-radius": { varName: "--animus-border-radius", slotClass: "animus-dyn-border-radius", transform: sizeTransform } }` and component is rendered with `borderRadius={4}`
- **THEN** the inline style value SHALL be the result of `sizeTransform(4)`, not raw `4`

#### Scenario: Dynamic fallback resolves through scale values
- **WHEN** `dynamicPropConfig` is `{ borderBottom: { varName: "--animus-border-bottom", slotClass: "animus-dyn-border-bottom", scaleValues: { "1": "1px solid", "2": "2px solid" } } }` and component is rendered with `borderBottom={1}`
- **THEN** the runtime SHALL resolve `1` through `scaleValues` to `"1px solid"` and set inline style `{ "--animus-border-bottom": "1px solid" }`

#### Scenario: Dynamic fallback applies unit fallback when no scale match
- **WHEN** `dynamicPropConfig` is `{ p: { varName: "--animus-p", slotClass: "animus-dyn-p" } }` and component is rendered with `p={24}` (unitless numeric, no scaleValues match)
- **THEN** the runtime SHALL apply unit fallback before setting the CSS variable — inline style SHALL be `{ "--animus-p": "24px" }` (not `"24"`)

#### Scenario: Responsive dynamic fallback with unit fallback
- **WHEN** `dynamicPropConfig` is `{ p: { varName: "--animus-p", slotClass: "animus-dyn-p" } }` and component is rendered with `p={{ _: variable, sm: 16 }}`
- **THEN** the rendered element SHALL have class `"animus-dyn-p"` and inline style with unit fallback applied to each breakpoint value: `{ "--animus-p": applyUnitFallback(variable), "--animus-p-sm": "16px" }`

#### Scenario: Static match takes precedence over dynamic fallback
- **WHEN** `systemPropMap` has `{ p: { "8": "animus-u-a1b2c3" } }` and `dynamicPropConfig` has `{ p: { ... } }` and component is rendered with `p={8}`
- **THEN** the static class `"animus-u-a1b2c3"` SHALL be used — the dynamic fallback SHALL NOT fire and the slot class SHALL NOT be added

#### Scenario: No dynamicPropConfig provided (no dynamic props)
- **WHEN** `createComponent('span', 'animus-Label-abc', { states: ['active'] }, systemPropMap)` is called without a 5th argument
- **THEN** the component SHALL render normally — system prop values not in the map are silently ignored (backward compatible)

#### Scenario: systemPropNames filters DOM props
- **WHEN** config has `{ systemPropNames: ["p", "mt"] }` and component is rendered with `p={8} mt={4} onClick={fn}`
- **THEN** only `onClick` SHALL be forwarded to the DOM — `p` and `mt` are filtered regardless of whether they matched statically or dynamically

#### Scenario: Null or undefined dynamic values skip entirely
- **WHEN** component is rendered with `p={null}` or `p={undefined}` and no static match exists
- **THEN** the dynamic fallback SHALL NOT set any CSS variable AND SHALL NOT add the slot class to the element — the prop is treated as absent

### Requirement: Dynamic style memoization
The runtime shim SHALL memoize the inline style object for dynamic prop CSS variables using a `useRef`-based cache. A new style object SHALL only be allocated when the dynamic prop values have changed, preventing unnecessary React DOM mutations on re-renders with stable values.

#### Scenario: Stable dynamic value produces no DOM mutation
- **WHEN** a component with `dynamicPropConfig` is re-rendered with the same `p={variable}` value as the previous render
- **THEN** the same style object reference SHALL be returned — React SHALL NOT schedule a DOM mutation for the style attribute

#### Scenario: Changed dynamic value produces new style object
- **WHEN** a component with `dynamicPropConfig` is re-rendered with a different `p={newValue}` than the previous render
- **THEN** a new style object SHALL be created with the updated CSS variable value

### Requirement: System prop value serialization for lookup
The runtime shim SHALL serialize system prop values to string keys for lookup in the shared map. Numeric values SHALL be converted to their string representation. Responsive objects SHALL be serialized to a canonical string format that matches the extraction pipeline's key generation.

#### Scenario: Numeric value lookup key
- **WHEN** component receives `p={8}`
- **THEN** the runtime SHALL look up key `"8"` in `systemPropMap.p`

#### Scenario: String value lookup key
- **WHEN** component receives `color="primary"`
- **THEN** the runtime SHALL look up key `"primary"` in `systemPropMap.color`

#### Scenario: Responsive value lookup key
- **WHEN** component receives `mt={{ _: 8, sm: 16 }}`
- **THEN** the runtime SHALL serialize to a canonical key (e.g., `"_:8|sm:16"`) and look up in `systemPropMap.mt`

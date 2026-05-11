## MODIFIED Requirements

### Requirement: Built-in transforms use createTransform
Built-in transforms (`size`, `borderShorthand`, `gridItemRatio`, `gridItem`) SHALL be wrapped with `createTransform`. Their callbacks SHALL be self-contained — all helper logic (e.g., `percentageOrAbsolute`, `numberToTemplate`, `isUnitlessNumber`, `gridItemMap`) MUST be inlined into the callback body. The helper functions MAY remain as separate exports for non-extraction use, but SHALL NOT be referenced from within any `createTransform` callback.

#### Scenario: size transform wraps with createTransform and is self-contained
- **WHEN** `size` is imported from `@animus-ui/system`
- **THEN** it has `.transformName === 'size'` AND its callback body contains no external references

#### Scenario: borderShorthand inlines numberToTemplate logic
- **WHEN** `borderShorthand` callback is extracted by Rust
- **THEN** the extracted source contains the number-to-template logic inline, not a reference to `numberToTemplate`

#### Scenario: gridItem inlines map and utility
- **WHEN** `gridItem` callback is extracted by Rust
- **THEN** the extracted source contains the `gridItemMap` object and `isUnitlessNumber` regex inline

### Requirement: Custom transforms follow the same protocol
Users SHALL use `createTransform` for named transforms that participate in extraction. Custom transforms are serialized identically to built-ins. Custom transform callbacks MUST satisfy the self-contained constraint — no external references.

#### Scenario: User-defined self-contained transform extracts correctly
- **WHEN** user defines `createTransform('fluid', (value) => { const [min, max] = String(value).split('-').map(Number); ... })`
- **THEN** extraction succeeds and the callback is included in the manifest

#### Scenario: User-defined transform with external reference gets diagnostic
- **WHEN** user defines `createTransform('slugify', (value) => lodash.kebabCase(value))`
- **THEN** extraction emits `[bail] Transform 'slugify': callback references external symbol 'lodash'`

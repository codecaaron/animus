## ADDED Requirements

### Requirement: Import alias resolution before JSX scanning
The project analyzer SHALL resolve import aliases for each file before passing component prop maps to the JSX scanner. When a file imports a component under a different local name (`import { Button as TestDsButton }`), the scanner SHALL match `<TestDsButton>` against `Button`'s active system props, custom props, and usage configs.

#### Scenario: Renamed import with system props
- **WHEN** a file contains `import { Button as Btn } from './components'` and `<Btn px={8} />`, and `Button` has active group `{ space: true }`
- **THEN** the scanner SHALL collect `{ px: 8 }` as a system prop usage — resolving `Btn` → `Button`'s active props

#### Scenario: Renamed import from external package
- **WHEN** a file contains `import { Button as TestDsButton } from '@my-ds/components'` and `<TestDsButton px={16} py={8} />`
- **THEN** the scanner SHALL collect `{ px: 16, py: 8 }` as system prop usages for the `Button` component

#### Scenario: Renamed import with variant props
- **WHEN** a file contains `import { Button as Btn } from './components'` and `<Btn variant="primary" />`, and `Button` has variant prop `variant`
- **THEN** the scanner SHALL collect the variant usage `{ component: "Button", variant_prop: "variant", value: "primary" }`

#### Scenario: Renamed import with custom props
- **WHEN** a file contains `import { Card as MyCard } from './components'` and `<MyCard size="sm" />`, and `Card` has custom prop `size`
- **THEN** the scanner SHALL collect a static custom prop usage for `Card`'s `size` prop

#### Scenario: No rename — zero cost
- **WHEN** a file contains `import { Button } from './components'` (no alias)
- **THEN** the scanner SHALL use the original maps without cloning or augmentation

#### Scenario: Multiple renamed imports in one file
- **WHEN** a file contains `import { Button as Btn, Card as MyCard } from './components'` and uses both as JSX elements with system props
- **THEN** the scanner SHALL resolve both aliases and collect system prop usages for both components

#### Scenario: Alias collides with existing binding
- **WHEN** a file aliases `import { IconButton as Button }` and `Button` is ALSO a definition binding for a different component
- **THEN** the augmented map SHALL contain the union of both components' active props for the `Button` key — the scanner collects usages for any matching attribute names

## MODIFIED Requirements

### Requirement: JSX element scanning
The JSX scanner SHALL walk all JSX elements in a source file and match element tags against component bindings that have active groups from chain walking. For each matching element, it SHALL collect JSX attributes whose names match active group prop names. The component prop maps passed to the scanner SHALL include import alias entries so that renamed imports resolve to their original component's active props.

#### Scenario: Match Box with system props
- **WHEN** chain walking produces a binding `Box` with active groups `{ space: true, layout: true }` and the file contains `<Box p={8} mt={16} display="flex" />`
- **THEN** the scanner SHALL collect `{ p: 8, mt: 16, display: "flex" }` as system prop usages for the `Box` binding

#### Scenario: No match for non-group props
- **WHEN** chain walking produces a binding `Button` with active groups `{ space: true }` and the file contains `<Button variant="fill" p={8} />`
- **THEN** the scanner SHALL collect `{ p: 8 }` only — `variant` is not a group prop and SHALL be ignored by the scanner

#### Scenario: Non-extracted component ignored
- **WHEN** the file contains `<SomeComponent p={8} />` but `SomeComponent` is not a binding from chain walking and not an import alias for any extracted component
- **THEN** the scanner SHALL not collect any system props from that element

#### Scenario: Same component used multiple times
- **WHEN** the file contains `<Box p={8} />` and `<Box p={16} mt={8} />`
- **THEN** the scanner SHALL collect all unique (prop, value) pairs: `{ p: 8 }, { p: 16 }, { mt: 8 }`

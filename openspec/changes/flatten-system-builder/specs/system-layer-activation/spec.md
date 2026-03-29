## ADDED Requirements

### Requirement: Rename groups to system on component chain
The component builder chain method `.groups()` SHALL be renamed to `.system()` to match the cascade layer name `@layer system`.

#### Scenario: Method name on component chain
- **WHEN** a consumer builds a component using the builder chain
- **THEN** the method to activate system props SHALL be `.system()`, not `.groups()`
- **AND** `.groups()` SHALL NOT exist on the chain

#### Scenario: Cascade layer alignment
- **WHEN** a consumer reads the component chain `.styles({...}).variant({...}).system([...]).props({...})`
- **THEN** each method SHALL correspond to its cascade layer: styles→base, variant→variants, system→system, props→custom

### Requirement: Mixed namespace activation
`.system()` SHALL accept an array of identifiers that can be either group names or individual prop names.

#### Scenario: Group name activation
- **WHEN** a consumer calls `.system(['surface', 'text'])`
- **THEN** all props in the `surface` group and all props in the `text` group SHALL be activated as callsite React props

#### Scenario: Individual prop activation
- **WHEN** a consumer calls `.system(['ratio'])` and `ratio` is a registered prop (ungrouped or in any group)
- **THEN** only the `ratio` prop SHALL be activated as a callsite React prop

#### Scenario: Mixed group and prop activation
- **WHEN** a consumer calls `.system(['surface', 'ratio'])` where `surface` is a group name and `ratio` is a prop name
- **THEN** all props in the `surface` group AND the individual `ratio` prop SHALL be activated

#### Scenario: Unknown identifier
- **WHEN** a consumer passes an identifier to `.system()` that is neither a group name nor a registered prop name
- **THEN** a type error SHALL be produced at compile time

### Requirement: Type safety for system activation
The `.system()` method SHALL accept only valid group names and prop names as determined by the system's `GroupReg` and `PropReg` generics.

#### Scenario: Autocomplete shows available identifiers
- **WHEN** a consumer types `.system([` in an IDE with TypeScript
- **THEN** autocomplete SHALL suggest all group names and all individual prop names from the system

#### Scenario: Prop activated by group and individually
- **WHEN** a consumer calls `.system(['surface', 'bg'])` and `bg` is already in the `surface` group
- **THEN** `bg` SHALL be activated (redundant but not an error)
- **AND** no duplicate prop SHALL appear in the component's type

### Requirement: Rust crate recognizes system method
The extraction pipeline SHALL recognize `.system()` as the chain method for system prop activation, replacing `.groups()`.

#### Scenario: Extraction detects system stage
- **WHEN** the Rust crate parses a component chain containing `.system({ surface: true })`
- **THEN** it SHALL detect the `system` stage and resolve activated props identically to the former `groups` stage

#### Scenario: Individual prop in system stage
- **WHEN** the Rust crate parses `.system({ surface: true, ratio: true })`
- **THEN** it SHALL activate all props from the `surface` group AND the individual `ratio` prop

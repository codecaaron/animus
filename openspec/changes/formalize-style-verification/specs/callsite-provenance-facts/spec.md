## ADDED Requirements

### Requirement: Static callsite records

The universe manifest SHALL record, for every statically-classified system-prop usage at a JSX callsite, a record containing the component binding, the prop name, the file path, and the byte span of the attribute.

#### Scenario: Static prop usage

- **WHEN** a scanned file contains `<Box p={8} />` for a tracked component
- **THEN** the manifest contains a callsite record for binding `Box`, prop `p`, that file, and the attribute's byte span

#### Scenario: Reading callsites from the manifest alone

- **WHEN** a reader consumes only the manifest
- **THEN** it can enumerate every static callsite of a given prop across the project, with file and span, without re-parsing any source

### Requirement: Spread-presence markers

The universe manifest SHALL record, for every JSX element of a tracked component that carries a spread attribute, a marker containing the component binding, the file path, and the byte span of the spread.

#### Scenario: Spread on a tracked component

- **WHEN** a scanned file contains `<Box {...rest} />` for a tracked component
- **THEN** the manifest contains a spread marker for binding `Box` with that file and the spread's byte span

#### Scenario: No spreads present

- **WHEN** no element of any tracked component carries a spread attribute
- **THEN** the manifest's spread markers are empty for that project

### Requirement: Additive fact emission

The presence of callsite records and spread markers SHALL NOT alter any previously emitted manifest field, generated CSS, or transformed code.

#### Scenario: Existing outputs preserved

- **WHEN** the extraction corpus that produced the committed parity baselines is re-analyzed with fact emission active
- **THEN** every pre-existing baseline artifact (CSS, transformed code, existing observables) remains byte-identical

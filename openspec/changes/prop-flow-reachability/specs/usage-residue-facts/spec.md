# Delta — usage-residue-facts

## ADDED Requirements

### Requirement: Per-site dynamic usage records

Every dynamic prop usage detected during JSX scanning SHALL produce a per-site record
containing: the component binding, the prop name, the source file path, the byte span of
the attribute value expression, and an expression kind drawn from a closed set:
`identifier`, `member`, `call`, `conditional`, `logical`, `template`, `binary`,
`responsive-object-dynamic`, `array`, `other`. Multiple dynamic sites for the same
(prop, binding) pair SHALL each produce their own record — per-site multiplicity is
preserved.

#### Scenario: Identifier site recorded with kind and span

- **WHEN** a file contains `<Box p={spacing} />` at bytes 120–127 for the value expression
- **THEN** the analysis output contains a residue record with binding `Box`, prop `p`,
  kind `identifier`, and span `120..127`

#### Scenario: Two sites, two records

- **WHEN** one file contains `<Box p={a} />` and another contains `<Box p={b ? 4 : 8} />`
- **THEN** the analysis output contains two residue records for prop `p` — one with kind
  `identifier`, one with kind `conditional` — each carrying its own file and span

#### Scenario: Static sites produce no residue records

- **WHEN** a file contains only `<Box p={8} />`
- **THEN** the analysis output contains zero residue records for that site

### Requirement: Residue records are additive manifest data

Residue records SHALL be exposed under a v2-native manifest field, alongside — not
replacing — the existing dynamic prop aggregation. Existing manifest fields, emitted
CSS, and transformed code SHALL be unaffected by the presence of residue records.

#### Scenario: Existing outputs unchanged

- **WHEN** the same project is analyzed before and after residue recording exists
- **THEN** emitted CSS is byte-identical, transformed code is AST-equivalent, and every
  pre-existing manifest field is unchanged

### Requirement: Histogram derivability

The residue records SHALL be sufficient to compute, without re-parsing any source file,
counts of dynamic sites grouped by expression kind, by prop name, and by component
binding.

#### Scenario: Kind histogram from manifest alone

- **WHEN** a build manifest contains residue records
- **THEN** a reader consuming only the manifest can produce a table of
  `expression kind → site count` for every prop

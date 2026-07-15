# Delta — shared-system-prop-map

## MODIFIED Requirements

### Requirement: Shared system prop map artifact

The Rust extraction pipeline SHALL produce a global system prop map as a separate
artifact from `analyzeProject`, alongside the existing manifest and CSS outputs. The map
SHALL aggregate all `(propName, valueKey, className)` tuples across all components into a
single `{ propName: { valueKey: className } }` structure. Tuples are sourced from
directly observed static usages AND from members of statically-enumerable value sets
recorded at conditional/logical JSX sites; both kinds produce identical map entries and
emitted utility classes.

#### Scenario: Map includes all group prop usages

- **WHEN** component A uses `.groups({ space: true })` with JSX `<A p={8} />` and component B uses `.groups({ space: true })` with JSX `<B p={8} mt={4} />`
- **THEN** the shared map SHALL contain `{ p: { "8": "animus-u-xxx" }, mt: { "4": "animus-u-yyy" } }` — a single entry for `p=8` shared by both components

#### Scenario: Map includes custom prop usages

- **WHEN** a component uses `.props({ logoSize: { property: 'fontSize', scale: { sm: 32, md: 64 } } })` with JSX `<Logo logoSize="md" />`
- **THEN** the shared map SHALL include `{ logoSize: { "md": "animus-u-zzz" } }` alongside any group prop entries

#### Scenario: Map includes enumerable-set members

- **WHEN** JSX contains `<Box display={isOpen ? 'block' : 'none'} />` and no other usage
  of `display` exists
- **THEN** the shared map SHALL contain entries for both `display: "block"` and
  `display: "none"`, each with its emitted utility class

#### Scenario: Map deduplicates identical CSS across props

- **WHEN** prop `p` with value `8` and prop `m` with value `8` resolve to CSS with the same content hash
- **THEN** both map entries SHALL reference the same class name (deduplication behavior unchanged from current per-component maps)

#### Scenario: Responsive values in shared map

- **WHEN** JSX contains `<Box mt={{ _: 8, sm: 16 }} />`
- **THEN** the shared map SHALL contain `{ mt: { "_:8|sm:16": "animus-u-resp" } }` with the canonical serialized key

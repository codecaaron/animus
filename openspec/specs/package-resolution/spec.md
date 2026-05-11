## ADDED Requirements

### Requirement: Package resolution map

The extraction pipeline SHALL accept a package resolution map that maps package specifiers to their resolved entry file paths. Non-relative import sources that match a key in this map SHALL be resolved to the mapped file path, enabling the import resolver to trace bindings through package boundaries.

#### Scenario: Resolve package import

- **WHEN** a file imports `{ Box } from '@animus-ui/components'` and the package resolution map contains `{ "@animus-ui/components": "packages/ui/src/index.ts" }`
- **THEN** the import resolver SHALL resolve `Box` by looking up exports in `packages/ui/src/index.ts` and following re-export chains to the definition file

#### Scenario: Unmatched package import

- **WHEN** a file imports `{ Link } from 'next/link'` and the package resolution map does NOT contain `next/link`
- **THEN** the import resolver SHALL return None for this binding — it is external and not an animus component

#### Scenario: Multiple packages resolved

- **WHEN** the resolution map contains `{ "@animus-ui/components": "packages/ui/src/index.ts", "@animus-ui/core": "packages/core/src/index.ts" }`
- **THEN** imports from both packages SHALL be resolved to their respective entry files

### Requirement: Package source file inclusion

When a package is resolved to an entry file, ALL source files in that package's directory tree SHALL be included in the analysis file set. This ensures the import resolver can follow re-export chains from the entry file to the actual component definition files.

#### Scenario: Entry file re-exports from internal files

- **WHEN** `packages/ui/src/index.ts` re-exports `{ Box } from './elements/Box'`
- **AND** `packages/ui/src/elements/Box.tsx` is included in the file entries
- **THEN** the resolver SHALL trace `Box` from `index.ts` → `elements/Box.tsx` and find the chain definition

#### Scenario: Internal files not included

- **WHEN** `packages/ui/src/index.ts` is in the file entries but `packages/ui/src/elements/Box.tsx` is NOT
- **THEN** the resolver SHALL NOT be able to trace `Box` to its definition — the re-export chain is broken and the binding is treated as unresolvable

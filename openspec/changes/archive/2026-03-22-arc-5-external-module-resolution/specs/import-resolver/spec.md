## MODIFIED Requirements

### Requirement: Cross-file binding resolution
The import resolver SHALL resolve a binding in one file to its original definition file by following import chains transitively. For non-relative import sources (package specifiers), the resolver SHALL consult the package resolution map to determine the entry file path.

#### Scenario: Direct import resolution
- **WHEN** `App.tsx` imports `Box` from `./elements/Box.tsx` and `Box.tsx` defines `export const Box = animus...`
- **THEN** resolving binding `Box` in `App.tsx` SHALL yield `{ file: "./elements/Box.tsx", binding: "Box" }`

#### Scenario: Barrel file resolution
- **WHEN** `App.tsx` imports `Box` from `./elements` and `elements/index.ts` re-exports `Box` from `./Box.tsx`
- **THEN** resolving binding `Box` in `App.tsx` SHALL transitively resolve to `{ file: "./elements/Box.tsx", binding: "Box" }`

#### Scenario: Package import resolution via map
- **WHEN** `App.tsx` imports `{ Box } from '@animus-ui/components'` and the package resolution map maps `@animus-ui/components` to `packages/ui/src/index.ts` and that file re-exports `Box` from `./elements/Box.tsx`
- **THEN** resolving binding `Box` SHALL transitively resolve through the package entry file to `{ file: "packages/ui/src/elements/Box.tsx", binding: "Box" }`

#### Scenario: Package import with rename
- **WHEN** `App.tsx` imports `{ Anchor as Link } from '@animus-ui/components'` and the package entry file exports `Anchor`
- **THEN** resolving binding `Link` in `App.tsx` SHALL resolve to Anchor's definition, preserving the rename chain

#### Scenario: Unresolvable package
- **WHEN** a binding is imported from a package NOT in the resolution map (e.g., `next/link`)
- **THEN** the resolver SHALL return None — the binding is external

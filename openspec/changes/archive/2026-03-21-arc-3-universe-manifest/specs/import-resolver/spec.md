## ADDED Requirements

### Requirement: ES module import parsing
The import resolver SHALL parse ES module import statements from OXC AST to extract binding-to-source mappings. It SHALL handle named imports, default imports, and namespace imports.

#### Scenario: Named import
- **WHEN** a file contains `import { Button } from './Button'`
- **THEN** the resolver SHALL map binding `Button` in this file to source file `./Button` with export name `Button`

#### Scenario: Renamed import
- **WHEN** a file contains `import { Anchor as Link } from '@animus-ui/components'`
- **THEN** the resolver SHALL map binding `Link` in this file to export name `Anchor` from `@animus-ui/components`

#### Scenario: Default import
- **WHEN** a file contains `import Button from './Button'`
- **THEN** the resolver SHALL map binding `Button` to the default export of `./Button`

### Requirement: Export parsing
The import resolver SHALL parse export statements to build a map of what each file exports, enabling transitive resolution through barrel files.

#### Scenario: Named re-export
- **WHEN** `index.ts` contains `export { Box } from './elements/Box'`
- **THEN** the resolver SHALL record that `index.ts` exports `Box`, sourced from `./elements/Box`

#### Scenario: Direct export
- **WHEN** a file contains `export const Box = animus.styles({...}).asElement('div')`
- **THEN** the resolver SHALL record that this file exports `Box` as a locally-defined binding

### Requirement: Cross-file binding resolution
The import resolver SHALL resolve a binding in one file to its original definition file by following import chains transitively.

#### Scenario: Direct import resolution
- **WHEN** `App.tsx` imports `Box` from `./elements/Box.tsx` and `Box.tsx` defines `export const Box = animus...`
- **THEN** resolving binding `Box` in `App.tsx` SHALL yield `{ file: "./elements/Box.tsx", binding: "Box" }`

#### Scenario: Barrel file resolution
- **WHEN** `App.tsx` imports `Box` from `./elements` and `elements/index.ts` re-exports `Box` from `./Box.tsx`
- **THEN** resolving binding `Box` in `App.tsx` SHALL transitively resolve to `{ file: "./elements/Box.tsx", binding: "Box" }`

#### Scenario: Package import resolution
- **WHEN** `App.tsx` imports `Anchor` from `@animus-ui/components` and the Vite plugin resolves this to `packages/ui/src/index.ts` which re-exports from `./elements/Anchor.tsx`
- **THEN** resolving binding `Anchor` SHALL transitively resolve to `{ file: "packages/ui/src/elements/Anchor.tsx", binding: "Anchor" }`

#### Scenario: Unresolvable binding
- **WHEN** a binding cannot be traced to any file in the project (e.g., imported from `next/link`)
- **THEN** the resolver SHALL return `None` — the binding is external and not an animus component

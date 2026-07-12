## Purpose

Requirements for the `import-resolver` capability: ES module import parsing; Export parsing; Cross-file binding resolution.

## Requirements

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

The import resolver SHALL resolve a binding in one file to its original definition file by following import chains transitively. For non-relative import sources, the resolver SHALL first check path aliases (if provided), then consult the package resolution map to determine the entry file path.

#### Scenario: Direct import resolution

- **WHEN** `App.tsx` imports `Box` from `./elements/Box.tsx` and `Box.tsx` defines `export const Box = animus...`
- **THEN** resolving binding `Box` in `App.tsx` SHALL yield `{ file: "./elements/Box.tsx", binding: "Box" }`

#### Scenario: Barrel file resolution

- **WHEN** `App.tsx` imports `Box` from `./elements` and `elements/index.ts` re-exports `Box` from `./Box.tsx`
- **THEN** resolving binding `Box` in `App.tsx` SHALL transitively resolve to `{ file: "./elements/Box.tsx", binding: "Box" }`

#### Scenario: Alias import resolution

- **WHEN** `NavBar.tsx` imports `Button` from `@admin/components/Button` and the alias map contains `{ pattern: "@admin/", replacement: "src/", type: "prefix" }`
- **THEN** the resolver SHALL expand `@admin/components/Button` to `src/components/Button`
- **AND** probe the known file set for `src/components/Button.tsx` (or `.ts`, `.js`, `.jsx`, `/index.*`)
- **AND** resolve the binding transitively from that file

#### Scenario: Exact alias resolution

- **WHEN** a file imports from `@config` and the alias map contains `{ pattern: "@config", replacement: "src/config.ts", type: "exact" }`
- **THEN** the resolver SHALL resolve directly to `src/config.ts` without wildcard expansion

#### Scenario: Alias miss falls through to package map

- **WHEN** a non-relative import specifier does not match any alias pattern
- **THEN** the resolver SHALL fall through to the package resolution map
- **AND** behavior for non-aliased package imports SHALL be unchanged

#### Scenario: Alias expands but no file found

- **WHEN** an alias expands to a path that does not exist in the known file set
- **THEN** the resolver SHALL return None (same as unresolvable)
- **AND** a debug-level log SHALL indicate the alias expanded but no matching file was found

#### Scenario: Package import resolution via map

- **WHEN** `App.tsx` imports `{ Box } from '@animus-ui/components'` and the package resolution map maps `@animus-ui/components` to `packages/ui/src/index.ts` and that file re-exports `Box` from `./elements/Box.tsx`
- **THEN** resolving binding `Box` SHALL transitively resolve through the package entry file to `{ file: "packages/ui/src/elements/Box.tsx", binding: "Box" }`

#### Scenario: Package import with rename

- **WHEN** `App.tsx` imports `{ Anchor as Link } from '@animus-ui/components'` and the package entry file exports `Anchor`
- **THEN** resolving binding `Link` in `App.tsx` SHALL resolve to Anchor's definition, preserving the rename chain

#### Scenario: Unresolvable package

- **WHEN** a binding is imported from a package NOT in the resolution map (e.g., `next/link`)
- **THEN** the resolver SHALL return None — the binding is external

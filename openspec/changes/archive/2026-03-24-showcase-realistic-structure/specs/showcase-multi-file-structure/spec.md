## ADDED Requirements

### Requirement: Per-file component definitions
Each component in the showcase SHALL be defined in its own file within `src/components/`. Each file SHALL export exactly one component as a named export.

#### Scenario: Single component per file
- **WHEN** a component file like `layout/StratumRow.tsx` is examined
- **THEN** it exports exactly one component (`export const StratumRow = ...`) and imports `ds` from the shared design system module

#### Scenario: HMR granularity
- **WHEN** a system prop value is changed on a component rendered inside a `.map()` callback in App.tsx
- **THEN** only the definition file for that component is re-transformed (not all 22 component files)

### Requirement: Barrel index re-exports
The showcase SHALL have a `src/components/index.ts` barrel file that re-exports all components using named re-exports (`export { X } from './path'`).

#### Scenario: Named re-export resolution
- **WHEN** `App.tsx` imports `{ StratumRow } from './components'`
- **THEN** the extraction pipeline's import resolver follows the chain: `./components` → `components/index.ts` → `layout/StratumRow.tsx` and correctly resolves the component binding

#### Scenario: All components accessible via barrel
- **WHEN** `App.tsx` imports any component from `'./components'`
- **THEN** the import resolves to the correct individual component file

### Requirement: Grouped subdirectories
Components SHALL be organized into subdirectories within `src/components/` grouped by function (e.g., `layout/`, `typography/`, `surfaces/`, `decorative/`).

#### Scenario: Recursive file discovery
- **WHEN** the Vite plugin discovers source files at buildStart
- **THEN** all component files in subdirectories are included in the analysis

#### Scenario: Relative import resolution across depths
- **WHEN** a component in `components/layout/StratumRow.tsx` imports `ds` from `../../ds`
- **THEN** the import resolves correctly in both the extraction pipeline and Vite bundler

### Requirement: Cross-file extension chain
At least one component SHALL extend a base component defined in a different file, exercising the extraction pipeline's cross-file provenance resolution.

#### Scenario: Extension resolved across files
- **WHEN** component A in `file-a.tsx` extends component B in `file-b.tsx`
- **THEN** `analyzeProject` correctly resolves the provenance (A's parent is B) and generates merged CSS for A that inherits B's base styles

#### Scenario: Extension chain in production CSS
- **WHEN** the showcase is built for production
- **THEN** the extended component's CSS includes inherited styles from its parent, and the parent's CSS is emitted before the child's in topological order

### Requirement: Visual output preservation
The rendered showcase SHALL be visually identical before and after the restructure. No component styles, variants, or behavior SHALL change.

#### Scenario: Production build comparison
- **WHEN** the showcase is built for production after restructure
- **THEN** the HTML output and visual rendering are identical to the pre-restructure build

#### Scenario: Component count preserved
- **WHEN** `ANIMUS_DEBUG=1` build is run after restructure
- **THEN** the same number of components are extracted (minus any intentional reconciler eliminations for unused components)

### Requirement: Unused components retained for pipeline coverage
Components that are defined but never rendered in App.tsx (CodeBlock, Divider, GoldDash) SHALL be retained in the component directory. Their elimination by the reconciler exercises the pipeline's dead-code detection.

#### Scenario: Reconciler elimination warnings
- **WHEN** `ANIMUS_DEBUG=1` showcase build runs
- **THEN** unused components appear as elimination warnings: `[animus] ⚠ CodeBlock eliminated: component not rendered and not a parent`

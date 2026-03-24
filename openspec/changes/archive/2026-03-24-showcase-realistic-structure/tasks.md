## 1. Directory Scaffolding

- [x] 1.1 Create `src/components/` directory with subdirectories: `layout/`, `typography/`, `surfaces/`, `decorative/`
- [x] 1.2 Snapshot current production build output (CSS size, component count via `ANIMUS_DEBUG=1`) as baseline

## 2. Component Migration

- [x] 2.1 Move layout components to `layout/`: Scene, Slab, Stack, Row, StratumRow, EmberDivider
- [x] 2.2 Move typography components to `typography/`: Display, Prose, Mono, Label, SectionLabel, Accent, Strong
- [x] 2.3 Move surface components to `surfaces/`: CodeBlock, Callout, RevealBlock, SyntaxBlock (from `src/SyntaxBlock.tsx`)
- [x] 2.4 Move decorative components to `decorative/`: GradientBar, ReadingBarTrack, GoldDash, VerticalBleed, HorizontalMark, Divider
- [x] 2.5 Each file: single named export, import `ds` from relative path to `../../ds` (or appropriate depth)

## 3. Barrel Index

- [x] 3.1 Create `src/components/index.ts` with named re-exports for all components
- [x] 3.2 Remove old `src/components.tsx`
- [x] 3.3 Remove old `src/SyntaxBlock.tsx` (now in `surfaces/`)

## 4. Cross-File Extension Chain

- [x] 4.1 SectionLabel extends Label across files (typography/SectionLabel.tsx imports from typography/Label.tsx)
- [x] 4.2 Verified: Label kept as parent (not eliminated), SectionLabel inherits base styles, provenance resolved across files

## 5. Consumer Update

- [x] 5.1 Update `App.tsx` imports to use barrel: `import { Scene, Slab, ... } from './components'`
- [x] 5.2 SyntaxBlock import merged into barrel import (was separate `from './SyntaxBlock'`)

## 6. Verification

- [x] 6.1 Run `ANIMUS_DEBUG=1` build — 19/22 extracted, CSS 9062 bytes, 10.51 kB output (matches baseline exactly)
- [x] 6.2 Barrel re-export resolution works — all 22 components found across 22 individual transform passes
- [x] 6.3 Cross-file extension: Label→SectionLabel provenance resolved, Label kept as parent
- [x] 6.4 Unused components eliminated with warnings: CodeBlock, Divider, GoldDash
- [x] 6.5 `bun run verify` passes clean
- [ ] 6.6 Dev server HMR test — deferred to manual verification by user
- [x] 6.7 Update `packages/showcase/CLAUDE.md` to reflect new directory structure

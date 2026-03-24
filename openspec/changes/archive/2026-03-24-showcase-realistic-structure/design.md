## Context

The showcase (`packages/showcase/`) is the extraction pipeline's primary integration test. It currently defines 22 components in a single `src/components.tsx`, with a separate `SyntaxBlock.tsx` already split out. `App.tsx` imports everything from `components.tsx`. The design system instance lives in `ds.ts`.

The surgical HMR invalidation we just built (compare per-component replacement strings, invalidate only stale definition files) works correctly but is effectively all-or-nothing when everything is colocated. The pipeline's import resolver, provenance resolution, and barrel export handling have never been exercised by the showcase.

## Goals / Non-Goals

**Goals:**
- Structure components so HMR invalidation is surgical (one component change = one file re-evaluated)
- Exercise import resolver's re-export chain resolution (barrel index)
- Exercise cross-file extension provenance (component extends base from different file)
- Exercise sub-directory file discovery
- Maintain identical visual output — the rendered showcase is the acceptance test
- Surface any extraction pipeline bugs that only manifest in multi-file codebases

**Non-Goals:**
- Changing any component's styles, variants, or behavior
- Adding new components or removing existing ones
- TSConfig path aliases for now — the risk of breaking extraction transforms (known issue with Vite resolve aliases) outweighs the testing value. Revisit after extraction is more mature.
- Changing `ds.ts` or the design system configuration

## Decisions

### 1. Component grouping by function, not alphabet

Group components into subdirectories that reflect their purpose:

```
src/components/
  index.ts                    ← barrel: re-exports everything
  layout/
    Scene.tsx                 ← full-page container
    Slab.tsx                  ← section container
    Stack.tsx                 ← vertical flex
    Row.tsx                   ← horizontal flex
    StratumRow.tsx            ← data row with variant
    EmberDivider.tsx          ← thematic divider
  typography/
    Display.tsx               ← hero headings
    Prose.tsx                 ← body text
    Mono.tsx                  ← monospace text
    Label.tsx                 ← small labels
    SectionLabel.tsx          ← section headings
    Accent.tsx                ← accent inline
    Strong.tsx                ← strong inline
  surfaces/
    CodeBlock.tsx             ← code display (unused, kept for pipeline coverage)
    SyntaxBlock.tsx           ← syntax-highlighted code (move from src/SyntaxBlock.tsx)
    Callout.tsx               ← callout boxes
    RevealBlock.tsx           ← reveal/spoiler blocks
  decorative/
    GradientBar.tsx           ← gradient line
    ReadingBarTrack.tsx       ← reading progress
    GoldDash.tsx              ← decorative dash (unused, kept for coverage)
    VerticalBleed.tsx         ← vertical bleed effect
    HorizontalMark.tsx        ← horizontal mark
    Divider.tsx               ← simple divider (unused, kept for coverage)
```

**Rationale**: Functional grouping mirrors real app organization. Keeping unused components (CodeBlock, Divider, GoldDash) exercises the reconciler's elimination path — they should appear as warnings in verbose mode.

### 2. Barrel index with named re-exports

```typescript
// src/components/index.ts
export { Scene } from './layout/Scene';
export { Slab } from './layout/Slab';
// ...etc
```

Not `export * from` — named re-exports are more realistic and more precisely test the import resolver's binding resolution (it must match specific export names, not wildcard).

**Rationale**: Named re-exports are the common pattern in production codebases and are the harder case for the import resolver.

### 3. Cross-file extension chain

Create at least one extension chain across files. Candidate: `EmberDivider` could extend a `BaseDivider` defined in `layout/` or `decorative/`. Or `SectionLabel` could extend `Label`.

**Rationale**: Cross-file extension exercises the provenance resolution in `project_analyzer.rs` Phase 3, which resolves `extends_from` bindings across file boundaries via the binding map.

### 4. Each component file imports `ds` from the same path

```typescript
// Every component file
import { ds } from '../../ds';
```

The relative path depth changes per subdirectory but always resolves to the same `ds.ts`.

**Rationale**: This is how real apps work — shared design system instance imported from a central location.

### 5. No TSConfig path aliases (for now)

Known danger: Vite resolve aliases have broken extraction transforms before. The extraction plugin's transform hook can be bypassed when Vite applies alias resolution. Deferring this to a separate change where we can isolate and test the interaction carefully.

**Rationale**: Risk/reward is wrong for this change. The restructure already exercises 4 new pipeline patterns without aliases.

## Risks / Trade-offs

- **[Risk] Import resolver doesn't follow barrel re-exports** → If the import resolver can't resolve `from './components'` → `components/index.ts` → individual files, cross-file provenance breaks. Mitigation: the resolver already handles index file resolution; barrel re-exports add named export resolution on top.
- **[Risk] Relative path depth changes break something** → Component files now import `ds` from `../../ds` instead of `./ds`. Mitigation: these are standard relative imports; the extraction pipeline resolves them the same way.
- **[Risk] File discovery misses subdirectories** → The `discoverFiles()` function in the plugin recursively walks directories. Subdirectories should be found. Mitigation: verify during implementation.
- **[Trade-off] More files = slightly slower full build** → 22+ files instead of 1. Mitigation: each file is tiny (one component); parse + extract time per file is minimal.

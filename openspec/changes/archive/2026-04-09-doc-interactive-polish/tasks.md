## 1. SyntaxBlock Line Features

- [x] 1.1 Add `SyntaxLine` ds element with `.states({ highlighted })` and `.variant({ prop: 'diff', variants: { added, removed } })` for line-level styling
- [x] 1.2 Add `DiffMarker` ds element for the gutter +/- indicator, colored by diff variant
- [x] 1.3 Add `highlights` and `diffs` props to SyntaxBlock component signature
- [x] 1.4 Integrate line-level styling into the existing `tokenLines.map()` render loop — wrap each line in SyntaxLine, apply highlighted/diff states based on line number
- [x] 1.5 Verify existing SyntaxBlock usage is unchanged (no highlights/diffs = identical rendering)
- [x] 1.6 Add a kitchen-sink example demonstrating highlights + diffs on the component-test page

## 2. ChainVisualizer

- [x] 2.1 Extend ChainStep step data interface to include `description`, `code`, `repeatable`, and `available` fields (optional, for backward compat)
- [x] 2.2 Add active glow to StepButton: `boxShadow: '0 0 20px {colors.fire.500/12}'` in the `active` state
- [x] 2.3 Create `DetailPanel` ds element — 2-column grid layout (description left, SyntaxBlock right), below the chain strip
- [x] 2.4 Create `CascadeBar` — array of small ds elements with height proportional to step index, active step accent, earlier steps dimmed, later steps ghost
- [x] 2.5 Create `MetaBadge` ds element with `.variant({ prop: 'kind', variants: { repeatable, once } })` for step metadata
- [x] 2.6 Render DetailPanel conditionally — only when active step has description/code data
- [x] 2.7 Update the builder-chain MDX page with enriched step data (descriptions + code examples for each chain method)
- [x] 2.8 Verify ChainStep still renders correctly when given minimal step data (label + layer only)

## 3. LivePreview

- [x] 3.1 Create `PreviewCanvas` ds element with dot grid background (`radial-gradient` with `{colors.text.dim/8}`)
- [x] 3.2 Create `VariantControl` ds element — segmented button group with `.states({ selected })` for the active variant option
- [x] 3.3 Create `LivePreview` component wrapping Ark Tabs with preview/code panes, PreviewCanvas in preview tab
- [x] 3.4 Add `variants` prop to LivePreview — renders VariantControl toolbar when provided
- [x] 3.5 Implement variant state management — selected values passed to children via render prop
- [x] 3.6 Migrate existing preview/code tab usage on component-test page to use LivePreview
- [x] 3.7 Add a kitchen-sink example demonstrating LivePreview with variant controls

## 4. Verification

- [x] 4.1 Build verification — showcase builds cleanly
- [x] 4.2 Visual check — all new features render correctly across color modes
- [x] 4.3 Verify no regressions — existing SyntaxBlock, ChainStep, and preview tab usage unchanged

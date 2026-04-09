## Context

Session 55-56 shipped polished doc primitives and validated ark-ui headless composition. The components are idiomatically "in Animus" but lack interactive teaching features. An external design reference (tmp/doc-refine.jsx) provided concrete UI concepts. This change extracts the best ideas and implements them with Animus patterns — no inline styles, no hardcoded colors, all ds elements with token references.

Current component state:
- **SyntaxBlock** — prism-react-renderer, title bar, collapsible, copy button, line numbers. No line highlighting or diff support.
- **ChainStep** — step buttons with `.states({ active })`, lucide ArrowRight connectors. Click changes active step but shows no detail about what that step does.
- **Preview areas** — TabGroup (now ark-ui Tabs) with preview/code panes. Empty dark background in preview, no interactive variant switching.

## Goals / Non-Goals

**Goals:**
- SyntaxBlock gains `highlights` and `diffs` props that compose with existing line rendering
- ChainStep evolves into ChainVisualizer with a detail panel that teaches the builder chain
- Preview areas get a dot grid canvas background and optional variant controls
- All new features use ds elements, token opacity syntax, and .states()/.variant() patterns
- MDX authors can use new features declaratively

**Non-Goals:**
- Building a Storybook replacement (variant controls are simple, not a full component playground)
- Rewriting SyntaxBlock's syntax highlighting (prism-react-renderer stays)
- Animated connector dots or keyframe pulse rings (glow is static box-shadow, not animation)
- Sidebar redesign, search, or status dots
- "CSS output" tab showing extraction results (interesting, separate scope)

## Decisions

### Decision 1: SyntaxBlock line features as additive props

**Choice:** Add `highlights?: number[]` and `diffs?: Record<number, '+' | '-'>` to SyntaxBlock's props. These compose with the existing line rendering loop — each line checks if its number is in highlights or diffs and applies additional styling.

**Why:** Zero disruption to existing usage. Every current SyntaxBlock renders unchanged. New features are opt-in per code block.

**Implementation approach:**
- Line highlight: wrap each line in a ds element with `.states({ highlighted: { bg: '{colors.amber.500/8}', borderLeft: '2px solid {colors.amber.500}' } })`
- Diff markers: variant with `prop: 'diff'`, variants `{ added: { bg: '{colors.forest.500/8}', borderLeft: '2px solid {colors.forest.500}' }, removed: { bg: '{colors.fire.500/6}', borderLeft: '2px solid {colors.fire.500}' } }`
- Gutter marker (+ or -) uses the same diff variant for color

### Decision 2: ChainVisualizer as evolution of ChainStep

**Choice:** Rename ChainStep to ChainVisualizer (or keep ChainStep as the import but refactor internals). Add a detail panel below the chain strip that renders per-step content.

**Why:** The chain strip (step buttons + connectors) already works. The detail panel is additive — it appears below the strip and changes content when the active step changes.

**Data model:** Each step gains `description`, `code`, `repeatable`, and `available` fields alongside existing `label` and `layer`. The detail panel is a 2-column grid: description left, SyntaxBlock right.

**Active glow:** Replace the current `active` state's `bg: '{colors.fire.500/12}'` with the addition of `boxShadow: '0 0 20px {colors.fire.500/12}'`. Glow IS the bg color bleeding outward — same token, same intent, just visible beyond the border.

**Cascade bar:** Array of small ds elements, one per step, with height proportional to cascade position. Active step gets accent color; earlier steps get dimmed accent; later steps get ghost.

### Decision 3: LivePreview as a new component wrapping TabGroup

**Choice:** Create a LivePreview component that wraps TabGroup (Ark Tabs) and adds preview-specific features: dot grid background and optional variant controls.

**Why:** TabGroup is a generic tabs primitive. LivePreview is a doc-specific pattern that adds the canvas feel and variant switching. Keeps TabGroup clean for non-preview uses.

**Dot grid:** A single ds element with `backgroundImage: 'radial-gradient(circle, {colors.text.dim/8} 0.5px, transparent 0.5px)'` and `backgroundSize: '20px 20px'`. Applied to the preview pane only.

**Variant controls:** `variants` prop accepts `Record<string, string[]>` — key is variant name, values are options. Renders a segmented control in the toolbar. Selected values passed to the preview children via render prop or context. MDX authors use it like: `<LivePreview variants={{ size: ['sm', 'md', 'lg'] }}>`.

### Decision 4: No keyframe animations

**Choice:** The active glow is a static `box-shadow`, not an animated pulse ring. Transitions use `transition: 'all 0.2s ease'` for smooth state changes, but no `@keyframes`.

**Why:** The reference's pulse ring draws the eye repeatedly. A static glow draws it once. Once is enough — the user clicked the step, they know where they are. Transitions make state changes feel smooth; animations make the page feel busy.

## Risks / Trade-offs

**[ChainVisualizer data model]** → The detail panel requires step data (description, code) that currently doesn't exist. This data lives in the MDX page that uses ChainStep, not in the component itself. The component accepts it as props — the MDX page provides it.

**[Variant controls complexity]** → The render prop / context pattern for passing selected variants to preview children adds API surface. Mitigated by keeping it simple: `children` receives a `variants` object with current selections, or we use React context.

**[MDX code fence integration]** → `highlights` and `diffs` need to be passable through MDX code fences. May require MDX plugin configuration or manual `<SyntaxBlock>` usage instead of triple-backtick fences. Investigate during implementation.

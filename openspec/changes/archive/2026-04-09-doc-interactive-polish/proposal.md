## Why

The doc primitives are functionally correct but miss opportunities to teach effectively. Code examples can't draw attention to specific lines, migration guides can't show diffs, the chain visualizer gives no detail when you click a step, and component previews sit in empty dark voids. An external design reference (tmp/doc-refine.jsx) surfaced concrete ideas that map directly onto our existing components as additive upgrades — no rewrites, no new dependencies.

## What Changes

### SyntaxBlock — line highlighting + diff markers
- `highlights` prop: array of line numbers → amber glow background, highlighted gutter number. "Look at these lines."
- `diffs` prop: object mapping line numbers to `"+"` or `"-"` → colored gutter markers (forest for added, fire for removed) + tinted line background. Essential for migration guides and before/after comparisons.

### ChainStep → ChainVisualizer — active glow + detail panel
- Active step glow: `box-shadow: 0 0 20px {colors.fire.500/12}` on the active button. Makes active step visually unambiguous.
- Detail panel below the chain strip: split-pane showing description (left) + code example via SyntaxBlock (right) for the active step. Turns "click to highlight" into "click to learn."
- Cascade specificity bar: stacked bars showing relative cascade depth per step.
- "Repeatable" vs "once" indicator badge per step.

### LivePreview — dot grid background + variant controls
- Dot grid background in preview areas: `radial-gradient(circle, {colors.text.dim/8} 0.5px, transparent 0.5px)` with 20px spacing. Makes preview feel like a design canvas instead of empty dark space.
- Variant controls toolbar: segmented control in the preview toolbar for switching between variant values. MDX authors declare which variants are switchable. Not Storybook — just declarative interactive examples leveraging our existing component + MDX infrastructure.

## Capabilities

### New Capabilities
- `syntax-line-features`: Line highlighting and diff marker support for SyntaxBlock
- `chain-visualizer`: Enhanced chain step component with detail panel, cascade bar, and step metadata
- `live-preview`: Preview component with dot grid canvas and optional variant controls toolbar

### Modified Capabilities
- `doc-interactive`: ChainStep upgraded to ChainVisualizer with active glow and detail panel
- `markdown-renderer`: SyntaxBlock gains `highlights` and `diffs` props for MDX code fences

## Impact

- **Modified components**: SyntaxBlock, ChainStep (renamed/upgraded to ChainVisualizer)
- **New component**: LivePreview (or upgraded pattern on existing preview usage)
- **MDX authoring**: New props available in code fences (`highlights`, `diffs`) and preview blocks (variant controls)
- **No new dependencies**: All features built with existing ds primitives, tokens, and Animus patterns
- **No extraction changes**: All new styles use .styles(), .states(), .variant() — standard extraction targets

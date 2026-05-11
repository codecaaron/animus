## Why

The showcase doc primitives cover API reference well (ParamTable, TypeSignature, MethodCard, SyntaxBlock) but lack **narrative** components — the ones that tell the extraction story visually. A competitive audit against docs-v4.html revealed 7 pattern gaps, 3 of which directly communicate Animus's core value proposition: zero-runtime extraction, cascade-layer architecture, and bundle size advantage. The existing primitives also have micro-pattern opportunities (required dots, file-type indicators, deprecation styling) that would bring them to parity with modern compiler docs.

## What Changes

**New components:**
- **BeforeAfter** — side-by-side split view showing ds source code → extracted CSS output. Two SyntaxBlocks in a grid with labeled pane headers and status tags. THE proof of extraction.
- **MetricCard** — stat card with big mono number, unit suffix, label, and delta badge. Grid layout for 3-up performance/build metrics.
- **BundleBar** — horizontal bar chart comparing bundle sizes across approaches (runtime vs extracted vs static). Labeled tracks with animated fills.

**Upgraded existing primitives:**
- **Callout** — add `deprecated` variant with dashed border-left and purple/violet color scheme
- **ParamTable** — replace text "required" with a tiny accent dot (5px circle) after param name
- **SyntaxBlock** — add file-type colored dot before filename in title bar
- **APIBlock** — new wrapper component that unifies TypeSignature + ParamTable into a single bordered container (like v4's sig-block)

**Kitchen sink additions:**
- New sections in component-test.mdx exercising all new components
- BeforeAfter with real ds → CSS extraction example
- MetricCard grid with actual build stats
- BundleBar with Animus size data

## Capabilities

### New Capabilities
- `narrative-components`: BeforeAfter, MetricCard, and BundleBar — components that tell the extraction story through visual comparison and metrics
- `primitive-upgrades`: Micro-pattern enhancements to Callout, ParamTable, SyntaxBlock, and a new APIBlock wrapper

### Modified Capabilities

## Impact

- `packages/showcase/src/components/docs/` — 3 new files, 3 modified files
- `packages/showcase/src/components/surfaces/SyntaxBlock.tsx` — file-type dot addition
- `packages/showcase/src/content/support/component-test.mdx` — new demo sections
- No API changes to `@animus-ui/system` — all work is showcase-layer
- No new dependencies required

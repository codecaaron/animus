## Context

The showcase has 19 doc primitives built over sessions 54-57. They cover API reference patterns (ParamTable, TypeSignature, MethodCard, ChainStep) and interactive patterns (LivePreview, SyntaxBlock with diffs/highlights). What's missing are **narrative** patterns — components that visually demonstrate what Animus does rather than document how to use it.

Reference file `tmp/docs-v4.html` provides 14 patterns from a fictional CSS-in-JS compiler doc site. Three gaps map directly to Animus's story. Several micro-patterns improve existing primitives.

## Goals / Non-Goals

**Goals:**
- Build 3 new narrative components that tell the extraction story
- Upgrade 4 existing primitives with micro-pattern polish
- Add kitchen sink sections exercising all new/upgraded patterns
- All components use ds elements, bare scale keys, token opacity syntax idiomatically

**Non-Goals:**
- Interactive playground / browser REPL (massive engineering, separate scope)
- Framework compatibility grid (React-only, not useful yet)
- Responsive props table (responsive variants aren't the hot story yet)
- Migration timeline/stepper (useful but lower priority than narrative components)

## Decisions

### 1. BeforeAfter uses two embedded SyntaxBlocks, not raw pre elements

SyntaxBlock already handles Prism highlighting, copy buttons, line numbers, and the bordered prop. BeforeAfter is a **layout container** that positions two SyntaxBlocks side-by-side with pane headers. No syntax highlighting logic duplicated.

Structure: `BeforeAfterContainer > [PaneHeader + SyntaxBlock] × 2`

The pane headers carry labels ("Input · file.tsx" / "Output · styles.css") and status tags ("runtime" / "extracted"). Grid layout `1fr 1fr` with shared outer border, inner divider via border-left on the right pane.

SyntaxBlocks render with `bordered={false}` since the outer container provides the border.

### 2. MetricCard is a simple ds element family, not a compose() family

Three styled elements: `MetricGrid` (3-column grid), `MetricCard` (border + padding), `MetricValue/MetricUnit/MetricLabel/MetricDelta`. No shared variant propagation needed — each card is independent. Delta badge uses a variant for positive/negative/neutral styling.

### 3. BundleBar is a variant-driven bar with CSS width transitions

Each bar row: `BundleLabel` (right-aligned mono text) + `BundleTrack` (background track) + `BundleFill` (colored fill with width set via style prop). Fill color via variant: `runtime | extracted | static`. Width is a percentage string passed as a style prop (not extractable, intentionally — it's data-driven).

The `style={{ width }}` is the correct pattern here — this IS a SNOWFLAKE value (data-driven, not design-token-driven). The color and typography are token-driven; the width is content-driven.

### 4. Callout deprecated variant uses borderLeftStyle override

Add a 5th variant `deprecated` to CalloutContainer and matching entries in CalloutIcon/CalloutTitle. The dashed border is achieved by adding `borderLeftStyle: 'dashed'` in the variant styles alongside the purple/violet color tokens. The compose() family with `shared: { variant: true }` means adding the variant to Root automatically propagates.

### 5. ParamTable required dot replaces text marker

Replace `RequiredMark` text element with `RequiredDot` — a 5px × 5px circle with `bg: 'primary'`, `borderRadius: '50%'`, `display: 'inline-block'`, positioned after the param name with `ml: 4`, `verticalAlign: 'middle'`.

### 6. SyntaxBlock file-type dot in title bar

Add a `FileDot` ds element (8px circle) before the title text in TitleBarLeft. Color determined by language: blue for TS/TSX, green for CSS, amber for shell/config. Rendered only when `title` is provided. Implemented as a small variant-driven element.

### 7. APIBlock wrapper unifies TypeSignature + ParamTable

A thin container component that wraps TypeSignature and ParamTable in a single bordered div with the signature as header and table as body. Removes individual borders from both children. Simple layout wrapper, not a new primitive — just a convenience composition.

## Risks / Trade-offs

- **BundleFill width as style prop** — not extractable, but this is intentional. Data-driven values are SNOWFLAKE by design. The extraction pipeline handles this correctly (style prop passes through).
- **SyntaxBlock file dot adds visual weight** — only rendered when title is present, so inline code blocks (no chrome) are unaffected.
- **5 Callout variants means 5 entries in 3 sub-components** — compose() shared variant handles propagation, but the variant map grows. Manageable at 5, would need rethinking at 8+.

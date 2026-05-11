## Why

Session 54 shipped 12 doc-primitive components rapidly to professionalize the showcase docs. They extract, they build, they render. But a seam audit against the gold standard components (Button, Card, Tooltip) reveals systematic anti-patterns: JS event handlers where CSS selectors exist, duplicate elements where `.states()` exists, manual variant passing where `compose()` exists, and missing accessibility semantics.

This is not visual design polish. This is making the doc primitives idiomatically "in Animus" — using the ds features that exist for exactly these purposes.

## What Changes

**Category 1 — States anti-patterns** (4 components):
- ChainStep: 4 duplicate elements (StepLabel/StepLabelActive, LayerLabel/LayerLabelActive) → 2 elements with `.states({ active })`
- Heading: JS onMouseEnter/onMouseLeave → CSS `_hover` on wrapper. Inline style copied state → `.states({ copied })`. span+role=button → `<button>`
- MethodCard: Chevron inline style rotation → `.states({ expanded })`
- SyntaxBlock: CollapseToggle inline style rotation → `.states({ collapsed })`. SyntaxPre conditional inline style → variant

**Category 2 — compose() for Callout**:
- 3 sub-elements (Container, Icon, Title) share identical variant axis → `compose()` with `{ shared: { variant: true } }`

**Category 3 — Consolidation** (2 components):
- TypeSignature: 6 single-purpose spans → 1 element with `.variant({ prop: 'role' })`
- SyntaxBlock: `tokens.colors.text` → `tokens.varRef('colors.text')` in animusTheme

**Category 4 — Accessibility** (4 components):
- CopyButton, TabGroup, Heading: `_focusVisible` focus rings
- TabGroup: keyboard navigation (arrow keys, roving tabindex)
- MethodCard: `aria-controls`, `role="region"`, `aria-labelledby` on detail section

**Category 5 — Playwright verification baseline**:
- Screenshot kitchen sink across all 10 color modes
- Capture baseline for visual regression

## Capabilities

### Modified Capabilities
- `doc-atoms`: CopyButton focus ring, TokenBadge unchanged
- `doc-callout`: Callout → compose() migration
- `doc-reference`: TypeSignature consolidation, MethodCard states + a11y
- `doc-interactive`: ChainStep dedup, TabGroup keyboard nav
- `markdown-renderer`: Heading CSS hover + states + button, SyntaxBlock states + token fix

## Impact

- **Files modified**: 7 component files (ChainStep, Heading, MethodCard, SyntaxBlock, Callout, TypeSignature, CopyButton) + TabGroup + MDXProvider + kitchen sink MDX
- **No new dependencies**: All fixes use existing ds features
- **No API changes**: Component props remain the same, only internals change
- **Extraction**: All changes remain statically extractable — states, compose, variants are all extraction-compatible
- **Risk**: Callout compose() migration changes the JSX usage pattern — MDXProvider componentMap may need adjustment

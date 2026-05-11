## Why

The showcase docs site renders content through MDX but lacks the component vocabulary that professional documentation requires. API reference pages need type signatures, parameter tables, and expandable method cards. All docs pages need admonition callouts, copy-to-clipboard, and live preview panels. The mock registry (`tmp/doc-atoms.jsx`, `tmp/doc-components.jsx`) prototypes ~39 components in raw inline styles — the high-value subset needs to be implemented as proper Animus ds components that exercise variants, states, system props, and MDX integration.

## What Changes

- **New atoms**: CopyButton (clipboard with animated feedback), TokenBadge (7-variant semantic badge), Callout (4-variant admonition — registered in MDXProvider componentMap)
- **Enhanced existing**: SyntaxBlock gains title bar, copy button, collapsible mode, line numbers (keeps prism-react-renderer). Heading gains hover anchor icon + click-to-copy `#id`
- **New reference components**: TypeSignature (color-coded function types), ParamTable (wraps existing Table primitives + TokenBadge), MethodCard (expandable API reference accordion)
- **New interactive components**: TabGroup (generic, extracted from Examples.tsx pattern), LivePreview (preview/code toggle — the key MDX enabler), ChainStep (interactive builder-chain visualization)
- **MDXProvider expansion**: Callout added to componentMap. LivePreview, TokenBadge, TypeSignature, ParamTable available as explicit imports in .mdx files.
- **Barrel export expansion**: All new components exported from `components/index.ts`

## Capabilities

### New Capabilities
- `doc-atoms`: Foundational documentation atoms — CopyButton, TokenBadge. Small, reusable, no internal dependencies.
- `doc-callout`: Admonition/callout component with variant system. MDXProvider-integrated for automatic availability in .mdx content.
- `doc-reference`: API reference components — TypeSignature, ParamTable, MethodCard. Composed from atoms and existing table primitives.
- `doc-interactive`: Interactive documentation components — TabGroup, LivePreview, ChainStep. Enable live demos and visualizations in MDX pages.

### Modified Capabilities
- `markdown-renderer`: MDXProvider componentMap expanded with Callout mapping. SyntaxBlock enhanced with chrome features (title, copy, collapse, line numbers).
- `mdx-authoring`: New components available for import in .mdx files (LivePreview, TokenBadge, etc.). No pipeline changes.

## Impact

- **Files created**: ~8-10 new component files in `packages/showcase/src/components/docs/` and `components/surfaces/`
- **Files modified**: `MDXProvider.tsx` (Callout in componentMap), `SyntaxBlock.tsx` (wrapper chrome), `Heading.tsx` (anchor interactivity), `components/index.ts` (barrel exports)
- **Dependencies**: None new for core work. Follow-up spike: lucide-react or createIcon for icon system, ark-ui for headless primitives (Dialog, Accordion, Tabs)
- **Extraction**: All new components use `ds.styles()` / `.variant()` / `.states()` — standard extraction path. No new extraction concerns.
- **Risk**: TokenBadge rgba() background colors have no token equivalents — will use raw CSS strings. Mock's manual syntax tokenizer must NOT be ported (keep prism-react-renderer).

## 1. Atoms — CopyButton & TokenBadge

- [x] 1.1 Create CopyButton component (`components/docs/CopyButton.tsx`): ds-styled button with copy/check SVG icons, useState for copied state, setTimeout(1500ms) reset, size variant (sm/md). Ref: `tmp/doc-atoms.jsx` CopyButton lines 82-106.
- [x] 1.2 Create TokenBadge component (`components/docs/TokenBadge.tsx`): ds.styles + .variant() with 7 variants (method/layer/type/prop/tag/danger/success). ALL colors via token opacity syntax — bg uses `'{colors.palette.weight/12}'`, border/color use raw palette paths for mode-stable identity. Zero hardcoded hex/rgba. See design.md Decision 3 for exact mappings. Ref: `tmp/doc-components.jsx` TokenBadge lines 30-49.
- [x] 1.3 Export CopyButton and TokenBadge from `components/index.ts`

## 2. Callout — MDX Admonition Primitive

- [x] 2.1 Create Callout component (`components/docs/Callout.tsx`): ds.styles + .variant() with 4 variants (info/tip/warn/danger). Each has left border color via raw palette path, tinted bg via token opacity syntax (`'{colors.ocean.500/6}'` etc.), icon via `_before` pseudo-element. Optional title prop. Zero hardcoded hex/rgba. See design.md Callout color strategy. Ref: `tmp/doc-components.jsx` Callout lines 201-221.
- [x] 2.2 Register Callout in MDXProvider componentMap (`components/docs/MDXProvider.tsx`)
- [x] 2.3 Export Callout from `components/index.ts`

## 3. SyntaxBlock Enhancement

- [x] 3.1 Add title bar to SyntaxBlock: optional `title` prop, header div with monospace filename + language indicator, surface bg, bottom border. Wrap existing Highlight in a new container div.
- [x] 3.2 Add CopyButton to SyntaxBlock: in title bar if title present, otherwise positioned overlay. Copies raw children string.
- [x] 3.3 Add collapsible mode: optional `collapsible` prop + useState for collapsed. Chevron in title bar with CSS rotation transition. Hides code content when collapsed.
- [x] 3.4 Add line numbers: optional `showLineNumbers` prop. Render line number column in existing line map loop — dim color, right-aligned, user-select:none.

## 4. Heading Enhancement

- [x] 4.1 Add anchor link icon to Heading: hover-visible SVG link icon via opacity transition. Uses ds._hover for opacity control.
- [x] 4.2 Add click-to-copy anchor: clicking icon copies `#${id}` to clipboard using CopyButton's pattern (useState, setTimeout feedback). Show check icon briefly.

## 5. Reference Doc Components

- [x] 5.1 Create TypeSignature component (`components/docs/TypeSignature.tsx`): monospace layout with color-coded spans (name=primary/accent, generics=secondary, params=info/blue, returns=success/teal). Left accent border, surface bg. Ref: `tmp/doc-components.jsx` TypeSignature lines 177-199.
- [x] 5.2 Create ParamTable component (`components/docs/ParamTable.tsx`): renders existing TableContainer/Th/Td with 4-column API structure. TokenBadge in type column. Accent color for "required" defaults. Ref: `tmp/doc-components.jsx` ParamTable lines 149-175.
- [x] 5.3 Create MethodCard component (`components/docs/MethodCard.tsx`): expandable card with header (name, description, returnType TokenBadge, chevron) + detail section (available-after badge, example ReactNode). Use `.states({ expanded: {...} })` for CSS-driven visibility + chevron rotation via data-expanded attribute. useState for toggle logic, but styling is states-layer. aria-expanded for a11y. Ref: `tmp/doc-components.jsx` MethodCard lines 287-327.
- [x] 5.4 Export TypeSignature, ParamTable, MethodCard from `components/index.ts`

## 6. Interactive Components

- [x] 6.1 Create TabGroup component (`components/docs/TabGroup.tsx`): controlled tab bar with accent bottom border on active tab, monospace font, shared bottom border line. Ref: `tmp/doc-components.jsx` TabGroup lines 223-235.
- [x] 6.2 Create LivePreview component (`components/docs/LivePreview.tsx`): bordered container with TabGroup toggling preview/code views. preview=ReactNode rendered in padded container, code=ReactNode (typically SyntaxBlock). Ref: `tmp/doc-components.jsx` LivePreview lines 237-253.
- [x] 6.3 Create ChainStep component (`components/docs/ChainStep.tsx`): interactive chain visualization — array of step buttons with SVG arrow connectors. Active step has accent bg/border. Flex-wrap for responsive. Ref: `tmp/doc-components.jsx` ChainStep lines 52-71 + doc-components.jsx layout lines 478-514.
- [x] 6.4 Export TabGroup, LivePreview, ChainStep from `components/index.ts`

## 7. Verification

- [x] 7.1 Build showcase (`bun run build` from showcase dir) — verify all new components extract to CSS with animus- prefixed class names, no build errors
- [x] 7.2 Spot-check dev server: render at least one instance of each new component on an existing page or a test .mdx page to confirm styling and interactivity

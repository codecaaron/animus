## Context

The showcase documentation site has 20 MDX files dynamically routed via `import.meta.glob('./content/**/*.mdx')` in App.tsx, with navigation defined in `src/constants/docsNav.ts` (26 routes across 6 sections). Two pages are preserved: `support/component-test.mdx` (kitchen sink exercising all doc components) and `pages/Examples.tsx` (interactive test matrices).

The documentation infrastructure is production-ready — 23 verified MDX components, responsive 3-column layout, MDXProvider with styled markdown mappings. The gap is systematic content, not tooling.

## Goals / Non-Goals

**Goals:**
- Produce an outline guaranteeing 100% public API coverage with zero gaps or duplicates
- Categorize each page by Diataxis type to prevent structural homogeneity
- Map the real MDX component palette to appropriate sections
- Define page ordering that mirrors the builder chain cascade learning curve
- Make the outline format structured enough that Phase 2 can consume it mechanically

**Non-Goals:**
- Writing any documentation prose (Phase 2)
- Building new MDX components (palette is complete)
- Modifying docsNav.ts (outline may recommend changes, execution is Phase 2)
- Documenting internal/non-public APIs

## Decisions

### 1. Quarantine Strategy: Stub Files

Replace stale MDX content with a single `# Page Title` heading. Preserves `import.meta.glob` routing, `docsNav.ts` navigation, and git history.

**Alternative rejected**: Delete files + update routing — higher risk, touches App.tsx and docsNav.ts.
**Alternative rejected**: Move to archive — breaks routing, adds cleanup step.

### 2. Page Structure: Discovery-Driven, Not Prescribed

The page count and boundaries are determined by the API surface discovered during Task Group 2 (enumeration), not fixed in advance. The outline prompt provides starting suggestions but explicitly instructs the Cartographer to add, merge, or split pages as coverage demands.

Ordering principle: pages should follow the learning curve from concept to advanced usage. The cascade provides a natural ordering backbone (intro → setup → theme → build → compose → extract → configure → debug), but the Cartographer decides granularity.

Areas likely to need their own pages beyond the initial suggestions:
- Selector aliases and nested selectors
- Custom transforms
- Prop shorthand and scale binding
- Global styles and CSS output structure
- Theme distribution patterns (.from(), .extend())
- Type exports and utilities (if enough surface for a reference page)

### 3. Verified Component Palette

Content-authoring components (used directly in MDX):

| Component | What It Does | Best Section Type |
|-----------|-------------|-------------------|
| `SyntaxBlock` | Syntax-highlighted code with copy, collapse, line numbers, diff marks | All code examples |
| `CodeExample` | Split/stacked input-to-output comparison | Before/after transformations |
| `BeforeAfter` | Two-pane comparison with labeled headers | Runtime vs extracted CSS |
| `LivePreview` | Tabbed preview + code with variant toolbar | Interactive component demos |
| `TypeSignature` | Formatted function signature with role-based token coloring | API method signatures |
| `MethodCard` | Accordion-based method documentation | API reference per-method |
| `ParamTable` | Parameter table with TokenBadge type annotations | Function parameter docs |
| `TokenBadge` | Inline semantic badge (method/layer/type/prop/tag/danger/success) | Inline API annotations |
| `APIBlock` | Bordered container grouping related API docs elements | API reference groupings |
| `Callout` | 4 variants (info/tip/warn/danger) with composed header | Warnings, design rationale, tips |
| `ChainStep` | Interactive step visualizer with detail panel | Builder chain walkthrough |
| `TabGroup` | @ark-ui tabs wrapper | Side-by-side comparisons |
| `MetricCard` | Metric display card with value, unit, label, delta | Performance/bundle stats |
| `BundleBar` | Horizontal bar chart for bundle sizes | Bundle size breakdowns |
| `Button` | Full styled button (6 colors, 4 kinds, 3 sizes) | Interactive call-to-action |

Auto-provided (not manually imported in MDX — MDXProvider + DocsLayout handle these):
`Heading` (auto-anchor), `Sidebar`, `PageNav`, `PageToc`, `DocsBreadcrumb`, `CopyButton`, `ColorPalette`, `ColorModeToggle`

### 4. Coverage Contract Format

Each page's outline ends with a coverage checklist using the format `package#export.method`:

```
### Coverage Checklist
- [ ] system#ds.styles()
- [ ] system#ds.styles().variant()
- [ ] system#ds.styles().variant().compound()
...
```

Rules:
- Every public export appears on exactly ONE page's checklist
- If an API appears in a narrative page AND the API reference, the narrative page owns primary documentation; the reference page cross-references
- Mark uncertain APIs with `[VERIFY]` for author confirmation before Phase 2

## Risks / Trade-offs

### Quarantine Destroys Content in Working Tree
**Risk**: Stale content only recoverable via git after stubbing.
**Mitigation**: Git history preserves everything. The introduction.mdx prose is genuinely strong — the outline should note its philosophical framing for Phase 2 to reference from git history.

### Outline May Propose Different Page Structure Than docsNav.ts
**Risk**: Outline restructures pages in ways that require nav/routing changes.
**Mitigation**: The outline IS the authority. Navigation updates are a Phase 2 implementation task if the outline demands different page boundaries.

### API Surface Enumeration May Miss Exports
**Risk**: Enumeration misses re-exported types, conditional exports, or methods only discoverable by reading class implementations.
**Mitigation**: Task Group 2 requires reading actual source files (not just index.ts), including the 6-class Animus.ts implementation, ThemeBuilder.ts, selectors.ts, and the real-world ds.ts usage. Cross-check against CLAUDE.md. The seed inventory explicitly lists known gaps to investigate.

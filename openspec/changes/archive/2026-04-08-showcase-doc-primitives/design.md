## Context

The showcase app has a working MDX pipeline (shipped session 53) and 33 existing ds components. The mock registry (`tmp/doc-atoms.jsx`, `tmp/doc-components.jsx`) contains 39 prototype components in raw inline styles. This design covers migrating 12 high-value components into proper Animus ds components, organized in dependency order across 4 groups.

Current showcase component layout:
```
components/
  docs/       — Button, CodeExample, ColorModeToggle, ColorPalette,
                DocsBreadcrumb, Heading, MDXProvider, PageNav, PageToc, Sidebar
  surfaces/   — Card, RevealBlock, SyntaxBlock, Table, Tooltip
  typography/  — Display, InlineCode, Label, Logo, Mono, Prose, Strong
  layout/     — CascadeLayer, Drawer, NavBar, Responsive, Row, Scene, SkipLink, Stack
  decorative/ — FireLine, HorizontalMark, ReadingBarTrack
```

## Goals / Non-Goals

**Goals:**
- Implement 12 doc-grade components as Animus ds components with full extraction support
- Enhance 2 existing components (SyntaxBlock, Heading) with professional chrome
- Expand MDXProvider componentMap with Callout for automatic .mdx availability
- Exercise variant, states, system prop, and composition patterns as dogfood
- Maintain dependency ordering: atoms first, then compositions that use them
- All colors through token references — zero hardcoded hex/rgba values

**Non-Goals:**
- Full port of all 39 mock components (27 are out of scope — see proposal)
- Search/command palette implementation (needs index infrastructure)
- Icon system design (follow-up spike)
- Headless UI library integration (follow-up exploration)
- Content authoring or doc rewriting — this is component infrastructure only
- Responsive/mobile layout changes

## Decisions

### 1. File organization: `docs/` subdirectory for all new components

New components go in `components/docs/` alongside existing docs components (Heading, CodeExample, etc.). Rationale: these are documentation-specific primitives, not general-purpose surfaces or typography.

Exception: enhanced SyntaxBlock stays in `surfaces/` where it already lives.

### 2. CopyButton as shared atom, not inlined

The copy-to-clipboard pattern appears in SyntaxBlock (code copy), Heading (anchor copy), and potentially TypeSignature. Extract it as a standalone atom rather than duplicating the clipboard + animated feedback logic.

Implementation: `useState` for copied state, `setTimeout(1500ms)` for reset, SVG icon swap between copy/check icons. The icon swap is inherently stateful — do not attempt to model with `.states()`.

### 3. TokenBadge: all colors via token opacity syntax — ZERO hardcoded values

~~The mock defines 7 variants with rgba() backgrounds. Our token system has no alpha-channel color tokens.~~

**CORRECTED:** The Animus token system supports **color opacity syntax**: `'{colors.primary/12}'` produces the color at 12% opacity. This eliminates the need for raw rgba() entirely. Every TokenBadge variant uses token references with opacity for backgrounds, and direct token references for border/text:

```
variant: 'method'  → bg: '{colors.primary/12}',    borderColor: '{colors.fire.700}',   color: 'primary'
variant: 'layer'   → bg: '{colors.forest.500/12}',  borderColor: '{colors.forest.700}', color: '{colors.forest.500}'
variant: 'type'    → bg: '{colors.violet.400/12}',  borderColor: '{colors.violet.700}', color: '{colors.violet.400}'
variant: 'prop'    → bg: '{colors.gold.300/12}',    borderColor: '{colors.gold.700}',   color: '{colors.gold.300}'
variant: 'tag'     → bg: '{colors.ocean.500/12}',   borderColor: '{colors.ocean.700}',  color: '{colors.ocean.500}'
variant: 'danger'  → bg: '{colors.primary/8}',      borderColor: '{colors.fire.700}',   color: 'primary'
variant: 'success' → bg: '{colors.forest.500/8}',   borderColor: '{colors.forest.700}', color: '{colors.forest.500}'
```

**Design choice on palette vs semantic tokens:** Border and text use raw palette paths (`fire.700`, `forest.500`, etc.) rather than semantic tokens (`primary`, `status.success`) because these badges need **stable identity across color modes**. A "layer" badge should always read green regardless of whether the page is in ocean mode or violet mode. Raw palette provides that stability. Semantic tokens would shift with the mode — `status.success` is `gold.300` in dark mode but `fire.700` in light mode, which would make badge colors unpredictable.

The bg alpha values (12% and 8%) create subtle tints that work on any background because they're transparent overlays.

### 4. SyntaxBlock: wrap, don't replace

Enhance the existing `SyntaxBlock` by adding optional wrapper chrome AROUND the existing `<Highlight>` + `<SyntaxPre>` internals. The prism-react-renderer engine stays untouched.

New props: `title?: string`, `copyable?: boolean` (default true), `collapsible?: boolean`, `showLineNumbers?: boolean`

The title bar, copy button, and collapse toggle are added as sibling elements above the existing pre block, wrapped in a new container. Line numbers are injected into the existing line rendering loop.

**Pattern choice:** The outer container uses `ds.styles()` for structure. The collapsible state should use React `useState` (not `.states()`) because it controls content visibility via conditional rendering, not CSS class toggling. The chevron rotation CAN use a CSS transition on a data-attribute though.

### 5. Callout: MDXProvider integration via direct component

Register Callout in the MDXProvider componentMap. Two integration paths considered:

**Option A — Custom element**: `<Callout variant="tip">content</Callout>` — explicit import in .mdx files. Clear, no magic, works now.

**Option B — Blockquote directive**: `> [!TIP] content` (GitHub-flavored) — parsed from blockquote children. More markdown-native but requires parsing logic.

**Decision: Option A for now.** Direct component import in MDX is the standard pattern. Callout is also added to the componentMap as `Callout` for convenience, but primary usage is explicit import. Option B can be added later via a remark plugin if desired.

**Pattern choice:** `.variant()` for the 4 semantic variants. Each variant sets `borderLeftColor`, `bg` (token opacity syntax for tinted backgrounds: `'{colors.ocean.500/6}'` for info), and a color for the icon/title. Icon characters are static text content in a `_before` pseudo-element — this keeps the icon out of the component API and lets the variant control it through selector aliases.

### 6. LivePreview: accept content duplication

In MDX, LivePreview renders a live component and shows its source code. Authors write the component twice — once as live JSX and once as a code string. This is the standard pattern in Storybook, Docusaurus, and every MDX-based doc site.

Alternative considered: auto-extracting source from the rendered JSX via a remark/rehype plugin. Rejected — this is a deep rabbit hole (AST manipulation, import resolution, formatting) for marginal DX improvement. The duplication is explicit and maintainable.

```mdx
<LivePreview
  preview={<Button color="primary" kind="fill" size="md">Click me</Button>}
  code={`<Button color="primary" kind="fill" size="md">Click me</Button>`}
/>
```

### 7. ParamTable composes existing Table primitives

ParamTable is not a new table implementation. It renders `<TableContainer>`, `<Th>`, `<Td>` from `surfaces/Table.tsx` with API-specific column structure (Parameter | Type | Default | Description). TokenBadge used in the Type column.

### 8. Inline SVG icons — hardcoded for now, spike later

The mock uses ~15 inline SVGs (anchor link, copy, check, chevron, collapse). For this change, inline SVGs are acceptable — they're small, static, and few. A follow-up spike should evaluate:
- **lucide-react**: tree-shakeable, 1400+ icons, popular, zero config
- **createIcon utility**: Chakra-style factory that wraps SVG paths into ds-compatible components. Interesting as a system-level feature (exercises ds as component factory), but over-engineered for 15 icons.
- **ark-ui integration**: headless primitives (Dialog, Accordion, Tabs) that Animus styles via `.asComponent()`. Great extraction dogfood test but needs compatibility verification.

### 9. MethodCard: `.states()` for expand/collapse — not useState

**Revised from original plan.** MethodCard's expanded/collapsed state maps cleanly to `.states({ expanded: { ... } })`. The `_expanded` selector alias generates `&[aria-expanded="true"], &[data-expanded]` — this is the accessibility-correct pattern for disclosure widgets. The detail section visibility and chevron rotation are both CSS-driven via the expanded state data-attribute.

The component still needs a `useState` for the toggle, but the STYLING is `.states()`, and the attribute is `data-expanded` / `aria-expanded`. This exercises `.states()` as a real dogfood test rather than treating every interactive component as a React-state-with-inline-styles problem.

---

## API Feature → Problem Mapping

A reference for choosing the right Animus feature for each styling problem. This codifies local conventions for these doc components.

### When to use each feature

| Problem | Feature | Why |
|---------|---------|-----|
| Base appearance (always-on CSS) | `.styles()` | @layer base. One-time structural CSS. |
| Named visual variants (type, size, color) | `.variant()` | @layer variants. Type-safe prop → CSS mapping. |
| Multi-variant conditionals | `.compound()` | @layer compounds. When size=lg AND kind=fill needs extra padding. |
| Boolean interactive states (expanded, active, open) | `.states()` | @layer states. Data-attribute driven. Use for MethodCard expand, SyntaxBlock collapse. |
| Spacing/color/typography escape hatches | `.system({ space: true })` | @layer system. Consumer-facing shorthand props. Use sparingly on doc components — most don't need runtime prop flexibility. |
| Custom behavior props (sizing, depth) | `.props()` | Custom layer. Transform functions. Not needed for these doc components. |
| Pseudo-states in base styles | `_hover`, `_focusVisible`, `_disabled` etc. | Selector aliases inside `.styles()`. Preferred over `'&:hover'` — typed, ordered, extraction-aware. |
| Pseudo-elements | `_before`, `_after` | Selector aliases. Use for Callout icon, AnchorIcon dot, decorative elements. Auto-sets `content: ""`. |
| Color with alpha | `'{colors.primary/12}'` | Opacity syntax on any color path. Use for tinted backgrounds. |
| Color mode stability | Raw palette: `'{colors.forest.500}'` | Stable across modes. Use when color identity matters more than mode adaptation. |
| Color mode adaptation | Semantic tokens: `'primary'`, `'text.muted'` | Changes per mode. Use for text, borders, backgrounds that should follow the theme. |
| Responsive layout | `{ _: value, sm: value }` | Breakpoint maps. Use if any doc component needs mobile adaptation. |
| Polymorphic rendering | `asChild` | Delegate rendering to child element. Use if we need a styled wrapper that renders as its child. |
| Slot families | `compose()` | Multi-component families with shared variants. NOT for these doc components — they're all single-component or simple parent/child. |
| Extension/specialization | `.extend()` | Inherit full chain, change terminal or add styles. Could use if we build a base DocCard and specialize for MethodCard/ParamTable. |
| Emitted sizes | `'{sizes.navHeight}'` | Token refs to emitted size values. Use for position offsets. |

### Color strategy for doc components

**Semantic tokens** for: text content, borders, backgrounds, interactive states — anything that should adapt to color mode.
```
color: 'text.muted'       ← adapts per mode
bg: 'surface'             ← adapts per mode  
borderColor: 'border'     ← adapts per mode
_hover: { bg: 'surface.hover' }
```

**Raw palette + opacity** for: badge identity colors, accent tints, category markers — anything that should maintain stable meaning across modes.
```
bg: '{colors.forest.500/12}'     ← green tint, always green
color: '{colors.violet.400}'     ← purple text, always purple
borderColor: '{colors.ocean.700}' ← blue border, always blue
```

**Semantic accent/status** for: success/warning/error states in callouts — these SHOULD adapt because their meaning is mode-contextual.
```
borderLeftColor: 'status.success'  ← green in dark, adapts in other modes
borderLeftColor: 'status.warning'  ← amber, adapts
borderLeftColor: 'status.error'    ← red, adapts
```

Wait — actually `status.warning` is `fire.400` in dark mode, which is the same red family as the accent. And `status.success` is `gold.300` in dark mode, which is... gold, not green. These semantic tokens don't map to the intuitive info/tip/warn/danger colors.

**Revised Callout color strategy:** Use raw palette paths for variant identity (same reasoning as TokenBadge):
```
info:   borderLeftColor: '{colors.ocean.500}',   bg: '{colors.ocean.500/6}'
tip:    borderLeftColor: '{colors.forest.500}',   bg: '{colors.forest.500/6}'
warn:   borderLeftColor: '{colors.gold.300}',     bg: '{colors.gold.300/6}'
danger: borderLeftColor: '{colors.fire.500}',     bg: '{colors.fire.500/6}'
```

---

## Per-Component Implementation Process

Every component follows this 5-step cycle. This prevents hallucination drift and ensures cleanup.

### Step 1: IDENTIFY

Before writing any code, answer:
- What cascade layers does this component need? (styles? variants? states? system?)
- What props does the consumer see?
- What interactive behavior exists? (hover, click, toggle, animation)
- What other components does it depend on or compose?

### Step 2: MAP mock → Animus features

For each styling concern in the mock, choose the Animus feature:
- Inline style object → `.styles()` with token refs
- Color variants → `.variant()` with palette opacity syntax
- Hover/focus/disabled → selector aliases (`_hover`, `_focusVisible`, `_disabled`)
- Expand/collapse → `.states({ expanded: {...} })` + data-attribute
- Spacing escape hatch → `.system({ space: true })` only if consumer needs it
- Pseudo-element content → `_before`/`_after` with auto `content: ""`
- Static text/number values → use token scale values (`fontSize: 12` → `fontSize: 12` from fontSizes scale, `gap: 8` → `gap: 8` from space scale)

**Rule: if the mock uses a hardcoded color value, find the closest token path. If no semantic token matches, use raw palette + opacity. Never write a hex/rgba literal.**

### Step 3: BUILD the chain

Write the builder chain in cascade order. Checklist:
- [ ] `.styles()` — base structural CSS, selector aliases for pseudo-states
- [ ] `.variant()` — each named prop axis, with `defaultVariant` where sensible
- [ ] `.compound()` — only if multi-variant conditionals exist (rare)
- [ ] `.states()` — boolean toggle states (expanded, collapsed, active, copied)
- [ ] `.system()` — only props the consumer actually needs on instances
- [ ] `.asElement()` — correct HTML element (semantic: `button`, `nav`, `span`, not always `div`)

### Step 4: VERIFY

- Does it extract? (`bun run build` from showcase)
- Does the className appear in the CSS output with `animus-` prefix?
- Do variants produce distinct rules in `@layer variants`?
- Does it render correctly in the dev server?
- Do color tokens resolve to visible CSS variables?

### Step 5: CLEANUP

After each component is verified:
- Remove any dead imports or unused mock references
- Update `components/index.ts` barrel export
- If this component replaces or enhances an existing one, remove the old code
- If Examples.tsx had an ad-hoc version of this pattern (e.g., TabBar), note it for future decomposition (but don't refactor Examples.tsx in this change)

---

## Risks / Trade-offs

**[SyntaxBlock complexity creep]** → Adding 4 optional features (title, copy, collapse, line numbers) to an existing component risks bloat. Mitigation: all features are opt-in props with sensible defaults (no title, copyable, not collapsible, no line numbers). The wrapper chrome is structurally separate from the highlighting core.

**[LivePreview content duplication]** → Authors write code twice. Mitigation: this is industry standard. The code string is typically shorter than the live JSX (no prop spreading, simplified). If it becomes painful, a remark plugin can be added later.

**[Mock → Animus translation fidelity]** → The mock uses specific spacing, font sizes, and color values tuned to its hardcoded theme. Direct pixel-matching is not the goal — the components should look RIGHT in our theme, not identical to the mock. Use token values (spacing scale, font scale) where they exist.

**[Raw palette color stability]** → TokenBadge and Callout use raw palette paths (forest.500, violet.400, etc.) for stable identity across color modes. These colors won't shift when the user changes modes — this is intentional (a "type" badge should always read purple). But it means they may not harmonize perfectly with every mode's overall palette. Acceptable trade-off for doc components.

## Open Questions

1. **Icon system direction** — lucide-react vs createIcon vs raw SVGs. Needs a spike to evaluate extraction compatibility and DX. Not blocking this change.
2. **ark-ui integration** — Does `.asComponent(ArkDialog)` extract correctly? Unknown. Worth a focused spike. Not blocking.
3. **Callout blockquote syntax** — Should we eventually support `> [!TIP]` GitHub-style admonitions via a remark plugin? Deferred — explicit `<Callout>` import works now.
